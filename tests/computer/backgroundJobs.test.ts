import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import type { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("ComputerRuntime background jobs", (): void => {
  it("owns sleep jobs across ps, stop, bg, and wait", (): void => {
    const record = new ComputerRecord("c-000831", "standard");
    const runtime = poweredRuntime(record);
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => shellAcceptsInput(runtime, record));

    submitLine(runtime, record, "sleep 2 &");
    const job = state.jobs(1_000)[0];
    expect(job).toMatchObject({ command: "sleep 2", state: "running" });
    const process = state.process(job!.pid);
    const shell = state
      .processes()
      .find(({ command }) => command === "/bin/bash");
    expect(process).toMatchObject({
      command: "sleep 2",
      parentPid: shell?.pid,
      state: "sleeping",
      uid: 1_000,
    });
    expect(terminalText(record)).toContain(
      `[${String(job!.jobId)}] ${String(job!.pid)}`,
    );

    submitLine(runtime, record, `kill -STOP ${String(job!.pid)}`);
    expect(state.process(job!.pid)).toMatchObject({
      lastSignal: "SIGSTOP",
      state: "stopped",
    });
    expect(state.job(job!.jobId)).toMatchObject({ state: "stopped" });
    runTicks(runtime, 45);
    expect(state.job(job!.jobId)).toMatchObject({ state: "stopped" });

    submitLine(runtime, record, `bg %${String(job!.jobId)}`);
    runUntil(runtime, () => state.job(job!.jobId)?.state === "done");
    expect(state.process(job!.pid)).toMatchObject({
      exitStatus: 0,
      lastSignal: "SIGCONT",
      state: "zombie",
    });
    expect(terminalText(record)).toContain(
      `[${String(job!.jobId)}] Done sleep 2`,
    );

    submitLine(runtime, record, `wait %${String(job!.jobId)}`);
    expect(state.job(job!.jobId)).toBeUndefined();
    expect(state.process(job!.pid)).toBeUndefined();
  });

  it("waits for a running job and promotes a job through fg", (): void => {
    const record = new ComputerRecord("c-000832", "standard");
    const runtime = poweredRuntime(record);
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => shellAcceptsInput(runtime, record));

    submitLine(runtime, record, "sleep 1 &");
    const waited = state.jobs(1_000)[0]!;
    queueLine(runtime, record, `wait %${String(waited.jobId)}`);
    runUntil(runtime, () => {
      const process = runtime.vmState(record.computerId);
      return (
        process?.kind === "waiting_event" &&
        process.filter?.includes(":wait:") === true
      );
    });
    expect(state.job(waited.jobId)?.state).toBe("running");
    runUntil(runtime, () => state.job(waited.jobId) === undefined);
    runUntil(runtime, () => shellAcceptsInput(runtime, record));
    expect(state.process(waited.pid)).toBeUndefined();
    expect(shellAcceptsInput(runtime, record)).toBe(true);

    submitLine(runtime, record, "sleep 30 &");
    const foreground = state.jobs(1_000)[0]!;
    queueLine(runtime, record, `fg %${String(foreground.jobId)}`);
    runUntil(
      runtime,
      () => runtime.vmState(record.computerId)?.kind === "sleeping",
    );
    expect(runtime.vmState(record.computerId)?.kind).toBe("sleeping");
    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "foreground_interrupted",
    });
    runUntil(runtime, () => state.job(foreground.jobId) === undefined);
    expect(state.process(foreground.pid)).toBeUndefined();
    runUntil(runtime, () => shellAcceptsInput(runtime, record));
  });

  it("runs Python as a scheduler-owned background process and reaps it through wait", (): void => {
    const record = new ComputerRecord("c-000834", "standard");
    const runtime = poweredRuntime(record);
    record.filesystem.writeFile("/tmp/background.py", "print(6 * 7)\n");
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => shellAcceptsInput(runtime, record));

    submitLine(runtime, record, "python --stats /tmp/background.py &");
    const job = state.jobs(1_000)[0]!;
    const shell = state
      .processes()
      .find(({ command }) => command === "/bin/bash");
    expect(job).toMatchObject({
      command: "python --stats /tmp/background.py",
      state: "running",
      uid: 1_000,
    });
    expect(state.process(job.pid)).toMatchObject({
      command: "python --stats /tmp/background.py",
      parentPid: shell?.pid,
      state: "running",
      uid: 1_000,
    });

    runUntil(runtime, () => state.job(job.jobId)?.state === "done");
    expect(state.process(job.pid)).toMatchObject({
      exitStatus: 0,
      state: "zombie",
    });
    expect(state.process(job.pid)!.cpuCycles).toBeGreaterThan(0);
    expect(terminalText(record)).toContain("42");
    expect(terminalText(record)).toContain("Python/CS486DX:");
    expect(terminalText(record)).toContain("machine instructions");
    expect(terminalText(record)).toContain(
      `[${String(job.jobId)}] Done python --stats /tmp/background.py`,
    );

    submitLine(runtime, record, `wait %${String(job.jobId)}`);
    expect(state.job(job.jobId)).toBeUndefined();
    expect(state.process(job.pid)).toBeUndefined();
  });

  it("runs an already-linked CS486 executable in the background", (): void => {
    const record = new ComputerRecord("c-000835", "standard");
    const runtime = poweredRuntime(record);
    record.filesystem.writeFile(
      "/tmp/answer.asm",
      [
        "mov eax, 0",
        "mov ecx, 100",
        "loop:",
        "add eax, 1",
        "sub ecx, 1",
        "cmp ecx, 0",
        "jg loop",
        "mov eax, 31415",
        "print eax",
        "halt",
      ].join("\n"),
    );
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => shellAcceptsInput(runtime, record));
    submitLine(runtime, record, "as /tmp/answer.asm -o /tmp/answer");
    expect(record.filesystem.exists("/tmp/answer")).toBe(true);

    submitLine(runtime, record, "run --stats /tmp/answer &");
    const job = state.jobs(1_000)[0]!;
    expect(job).toMatchObject({
      command: "run --stats /tmp/answer",
      state: "running",
      uid: 1_000,
    });
    expect(state.process(job.pid)).toMatchObject({
      command: "run --stats /tmp/answer",
      state: "running",
    });

    runUntil(runtime, () => state.job(job.jobId)?.state === "done");
    expect(state.process(job.pid)).toMatchObject({
      exitStatus: 0,
      state: "zombie",
    });
    expect(state.process(job.pid)!.cpuCycles).toBeGreaterThan(0);
    expect(terminalText(record)).toContain("31415");
    expect(terminalText(record)).toContain("CS486DX:");
    expect(terminalText(record)).toContain("instructions");
    expect(terminalText(record)).toContain(
      `[${String(job.jobId)}] Done run --stats /tmp/answer`,
    );

    submitLine(runtime, record, `wait %${String(job.jobId)}`);
    expect(state.job(job.jobId)).toBeUndefined();
    expect(state.process(job.pid)).toBeUndefined();
  });

  it("rolls back the process atomically when the bounded job table is full", (): void => {
    const record = new ComputerRecord("c-000836", "standard");
    const runtime = poweredRuntime(record);
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => shellAcceptsInput(runtime, record));

    for (let index = 0; index < 32; index += 1) {
      submitLine(runtime, record, "sleep 1000 &");
    }
    expect(state.jobs(1_000)).toHaveLength(32);
    const processIdsBefore = state.processes().map(({ pid }) => pid);
    const jobsBefore = state.jobs(1_000);

    submitLine(runtime, record, "sleep 1000 &");

    expect(state.jobs(1_000)).toEqual(jobsBefore);
    expect(state.processes().map(({ pid }) => pid)).toEqual(processIdsBefore);
    expect(terminalText(record)).toContain(
      "OS runtime jobs capacity 32 exceeded",
    );
  });

  it("hangs up and reaps jobs owned by an authenticated login on logout", (): void => {
    const password = "background-password";
    const record = new ComputerRecord("c-000837", "standard");
    const setup = new ShellSession(record.filesystem, {
      osProfile: "linux",
      requireLogin: true,
    });
    expect(setup.submit(password).exitCode).toBe(0);
    expect(setup.submit(password).exitCode).toBe(0);
    const runtime = new ComputerRuntime({
      requireLinuxLogin: true,
      schedulerLimits: {
        cpuCyclesPerComputer: 128,
        cpuCyclesPerTick: 512,
        eventCapacity: 32,
        instructionsPerComputer: 64,
        instructionsPerTick: 256,
        timerCapacity: 16,
      },
    });
    expect(runtime.register(record).outcome).toBe("accepted");
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => terminalText(record).includes("login:"));
    queueLine(runtime, record, "cs");
    runUntil(runtime, () => terminalText(record).includes("Password:"));
    queueLine(runtime, record, password);
    runUntil(runtime, () => state.loginSessions().length === 1);

    runUntil(runtime, () => shellAcceptsInput(runtime, record));
    expect(terminalText(record)).toContain("Login successful.");
    expect(state.loginSessions()).toHaveLength(1);
    submitLine(runtime, record, "sleep 30 &");
    const job = state.jobs(1_000)[0]!;
    expect(job.uid).toBe(1_000);
    expect(state.process(job.pid)).toMatchObject({
      state: "sleeping",
      uid: 1_000,
    });

    submitLine(runtime, record, "logout");
    runTicks(runtime, 2);

    expect(state.loginSessions()).toEqual([]);
    expect(state.lastLogin("cs")).toMatchObject({ logoutReason: "logout" });
    expect(state.job(job.jobId)).toBeUndefined();
    expect(state.process(job.pid)).toBeUndefined();
    expect(terminalText(record)).toContain("login:");
  });

  it("hangs up an elevated job by login-shell ownership instead of effective UID", (): void => {
    const password = "elevated-background-password";
    const record = new ComputerRecord("c-000838", "standard");
    const setup = new ShellSession(record.filesystem, {
      osProfile: "linux",
      requireLogin: true,
    });
    expect(setup.submit(password).exitCode).toBe(0);
    expect(setup.submit(password).exitCode).toBe(0);
    const runtime = new ComputerRuntime({
      requireLinuxLogin: true,
      schedulerLimits: {
        cpuCyclesPerComputer: 128,
        cpuCyclesPerTick: 512,
        eventCapacity: 32,
        instructionsPerComputer: 64,
        instructionsPerTick: 256,
        timerCapacity: 16,
      },
    });
    runtime.register(record);
    runtime.powerOn(record.computerId);
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => terminalText(record).includes("login:"));
    submitLine(runtime, record, "cs");
    submitLine(runtime, record, password);
    runUntil(runtime, () => state.loginSessions().length === 1);

    submitLine(runtime, record, "sudo -i");
    expect(runtime.isShellSecretInput(record.computerId)).toBe(true);
    submitLine(runtime, record, password);
    expect(runtime.isShellSecretInput(record.computerId)).toBe(false);
    submitLine(runtime, record, "sleep 30 &");
    const job = state.jobs(0)[0]!;
    expect(job.uid).toBe(0);
    expect(state.process(job.pid)).toMatchObject({ state: "sleeping", uid: 0 });

    submitLine(runtime, record, "exit");
    submitLine(runtime, record, "logout");
    runTicks(runtime, 2);

    expect(state.loginSessions()).toEqual([]);
    expect(state.job(job.jobId)).toBeUndefined();
    expect(state.process(job.pid)).toBeUndefined();
  });

  it("rejects unsupported forms before side effects and hangs up on disconnect", (): void => {
    const record = new ComputerRecord("c-000833", "standard");
    const runtime = poweredRuntime(record);
    const state = liveOsState(runtime, record.computerId);
    runUntil(runtime, () => shellAcceptsInput(runtime, record));

    submitLine(runtime, record, "echo must-not-run > /tmp/leak &");
    expect(record.filesystem.exists("/tmp/leak")).toBe(false);
    expect(state.jobs(1_000)).toEqual([]);
    expect(terminalText(record)).toContain(
      "shell: background redirects are not supported",
    );

    submitLine(runtime, record, "sleep 30 &");
    const job = state.jobs(1_000)[0]!;
    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });
    expect(state.job(job.jobId)).toBeUndefined();
    expect(state.process(job.pid)).toBeUndefined();
  });
});

function poweredRuntime(record: ComputerRecord): ComputerRuntime {
  const runtime = new ComputerRuntime({
    schedulerLimits: {
      cpuCyclesPerComputer: 128,
      cpuCyclesPerTick: 512,
      eventCapacity: 32,
      instructionsPerComputer: 64,
      instructionsPerTick: 256,
      timerCapacity: 16,
    },
  });
  expect(runtime.register(record).outcome).toBe("accepted");
  expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
  return runtime;
}

function liveOsState(
  runtime: ComputerRuntime,
  computerId: string,
): OsRuntimeState {
  const entries = (
    runtime as unknown as {
      readonly entries: ReadonlyMap<
        string,
        { readonly osRuntimeState: OsRuntimeState }
      >;
    }
  ).entries;
  const state = entries.get(computerId)?.osRuntimeState;
  if (state === undefined) throw new Error("missing runtime OS state");
  return state;
}

function submitLine(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  line: string,
): void {
  runUntil(runtime, () => shellAcceptsInput(runtime, record));
  queueLine(runtime, record, line);
  runtime.runTick();
  runUntil(runtime, () => shellAcceptsInput(runtime, record));
}

function queueLine(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  line: string,
): void {
  expect(
    runtime.queueEvent(record.computerId, "terminal_line", line),
  ).toMatchObject({ outcome: "accepted" });
}

function shellAcceptsInput(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): boolean {
  const state = runtime.vmState(record.computerId);
  return state?.kind === "waiting_event" && state.filter === undefined;
}

function terminalText(record: ComputerRecord): string {
  return record.terminal.snapshot().rows.join("\n");
}

function runTicks(runtime: ComputerRuntime, count: number): void {
  for (let tick = 0; tick < count; tick += 1) runtime.runTick();
}

function runUntil(runtime: ComputerRuntime, predicate: () => boolean): void {
  for (let tick = 0; tick < 1_000; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("runtime did not reach the expected state");
}
