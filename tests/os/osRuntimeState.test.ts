import { describe, expect, it } from "vitest";

import {
  OsRuntimeState,
  OsRuntimeStateCapacityError,
  OsRuntimeStateSnapshotError,
  OsRuntimeStateTransitionError,
  type OsRuntimeStateLimits,
} from "../../src/application/os/osRuntimeState.js";

describe("OS runtime state", (): void => {
  it("owns a bounded process table, jobs, signals, and deterministic PID reuse", (): void => {
    const state = bootingState({ maximumPid: 4, maximumProcesses: 3 });
    state.createInitProcess({
      command: "/sbin/cs-init",
      gid: 0,
      startTick: 1,
      state: "running",
      uid: 0,
    });
    state.transitionLifecycle({ kind: "boot_complete", tick: 2 });

    const shell = state.spawnProcess({
      command: "/bin/bash",
      gid: 1000,
      parentPid: 1,
      startTick: 3,
      state: "running",
      uid: 1000,
    });
    const worker = state.spawnProcess({
      command: "python worker.py",
      gid: 1000,
      parentPid: shell.pid,
      startTick: 4,
      uid: 1000,
    });
    expect([shell.pid, worker.pid]).toEqual([2, 3]);

    const job = state.createJob({
      command: "python worker.py",
      pid: worker.pid,
      tick: 4,
      uid: 1000,
    });
    state.transitionProcess(worker.pid, {
      cycles: 1_250,
      kind: "account_cycles",
      tick: 5,
    });
    expect(state.signalProcess(worker.pid, "SIGSTOP", 6)).toMatchObject({
      cpuCycles: 1_250,
      lastSignal: "SIGSTOP",
      state: "stopped",
      waitReason: "SIGSTOP",
    });
    expect(state.job(job.jobId)?.state).toBe("stopped");
    expect(state.signalProcess(worker.pid, "SIGCONT", 7)).toMatchObject({
      lastSignal: "SIGCONT",
      state: "ready",
    });
    expect(state.job(job.jobId)?.state).toBe("running");
    expect(
      state.transitionJob(job.jobId, {
        kind: "complete",
        status: 7,
        tick: 8,
      }),
    ).toMatchObject({ exitStatus: 7, state: "done" });
    expect(state.process(worker.pid)).toMatchObject({
      exitStatus: 7,
      state: "zombie",
    });

    state.reapProcess(worker.pid);
    const fourth = state.spawnProcess({
      command: "sleep 1",
      gid: 1000,
      parentPid: shell.pid,
      startTick: 9,
      uid: 1000,
    });
    expect(fourth.pid).toBe(4);
    expect(() =>
      state.spawnProcess({
        command: "overflow",
        gid: 1000,
        parentPid: shell.pid,
        startTick: 9,
        uid: 1000,
      }),
    ).toThrow(OsRuntimeStateCapacityError);
    state.signalProcess(fourth.pid, "SIGTERM", 10);
    state.reapProcess(fourth.pid);
    expect(
      state.spawnProcess({
        command: "reused",
        gid: 1000,
        parentPid: shell.pid,
        startTick: 11,
        uid: 1000,
      }).pid,
    ).toBe(3);
  });

  it("keeps sessions, services, mounts, devices, and proc views coherent", (): void => {
    const state = bootingState();
    state.createInitProcess({
      command: "/sbin/cs-init",
      gid: 0,
      startTick: 1,
      state: "running",
      uid: 0,
    });
    const daemon = state.spawnProcess({
      command: "/usr/sbin/cs-getty tty1",
      gid: 0,
      parentPid: 1,
      startTick: 2,
      state: "running",
      uid: 0,
    });
    state.registerService({ enabled: true, name: "getty", tick: 1 });
    state.transitionService("getty", { kind: "start", tick: 2 });
    state.transitionService("getty", {
      kind: "running",
      pid: daemon.pid,
      tick: 2,
    });
    state.mount({
      filesystemType: "csfs",
      mountedTick: 1,
      options: ["nosuid", "nodev"],
      readOnly: false,
      source: "computer-system",
      target: "/",
    });
    state.registerDevice({
      driver: "cs-uart",
      kind: "character",
      major: 4,
      minor: 64,
      path: "/dev/ttyS0",
      state: "available",
      tick: 1,
    });
    state.transitionLifecycle({ kind: "boot_complete", tick: 3 });

    const first = state.openLoginSession({
      gid: 1000,
      sessionId: "web-1",
      terminal: "tty1",
      tick: 4,
      uid: 1000,
      username: "cs",
    });
    expect(first.previous).toBeUndefined();
    state.touchLoginSession("web-1", 5);
    state.closeLoginSession("web-1", 6, "disconnect");
    const second = state.openLoginSession({
      gid: 1000,
      remote: "local-web",
      sessionId: "web-2",
      terminal: "tty1",
      tick: 7,
      uid: 1000,
      username: "cs",
    });
    expect(second.previous).toMatchObject({
      loginTick: 4,
      logoutReason: "disconnect",
      logoutTick: 6,
    });

    expect(state.renderProcMounts()).toBe(
      "computer-system / csfs rw,nosuid,nodev 0 0\n",
    );
    expect(state.renderProcDevices()).toContain("  4 ttyS0");
    expect(state.renderProcStatus(daemon.pid)).toContain(
      `Pid:\t${String(daemon.pid)}\n`,
    );
    expect(state.readProc(`/proc/${String(daemon.pid)}/cmdline`)).toBe(
      "/usr/sbin/cs-getty\0tty1\0",
    );
    expect(state.procDevicePaths()).toContain(
      `/proc/${String(daemon.pid)}/status`,
    );
    expect(state.renderProcLoadAverage()).toBe("0.00 0.00 0.00 2/2 2\n");

    state.transitionProcess(daemon.pid, { kind: "exit", status: 1, tick: 8 });
    expect(state.service("getty")).toMatchObject({
      detail: "process exited with status 1",
      state: "failed",
    });
  });

  it("enforces journal entry and UTF-8 byte limits without partial writes", (): void => {
    const state = new OsRuntimeState("c-journal", {
      maximumJournalBytes: 5,
      maximumJournalEntries: 3,
      maximumJournalEntryBytes: 4,
    });
    state.appendBootJournal(0, "éé");
    state.appendAuthJournal(1, "a", "notice");
    expect(state.journalBytes).toBe(5);
    const before = state.snapshot();

    expect(() => state.appendSystemJournal(2, "b")).toThrowError(
      expect.objectContaining({ resource: "journal_bytes" }),
    );
    expect(state.snapshot()).toEqual(before);
    expect(() => state.appendSystemJournal(2, "abcde")).toThrow(RangeError);
    expect(state.renderJournal()).toBe(
      "[         0] boot.info: éé\n[         1] auth.notice: a\n",
    );
  });

  it("rejects every aggregate capacity plus one without partial mutations", (): void => {
    const processes = runningState({ maximumProcesses: 2 });
    processes.spawnProcess({
      command: "first",
      gid: 1000,
      parentPid: 1,
      startTick: 3,
      uid: 1000,
    });
    const processSnapshot = processes.snapshot();
    expect(() =>
      processes.spawnProcess({
        command: "overflow",
        gid: 1000,
        parentPid: 1,
        startTick: 4,
        uid: 1000,
      }),
    ).toThrowError(
      expect.objectContaining({ maximum: 2, resource: "processes" }),
    );
    expect(processes.snapshot()).toEqual(processSnapshot);

    const jobs = runningState({ maximumJobs: 1 });
    const firstJobProcess = jobs.spawnProcess({
      command: "first",
      gid: 1000,
      parentPid: 1,
      startTick: 3,
      uid: 1000,
    });
    const secondJobProcess = jobs.spawnProcess({
      command: "second",
      gid: 1000,
      parentPid: 1,
      startTick: 3,
      uid: 1000,
    });
    jobs.createJob({
      command: "first",
      pid: firstJobProcess.pid,
      tick: 3,
      uid: 1000,
    });
    const jobSnapshot = jobs.snapshot();
    expect(() =>
      jobs.createJob({
        command: "second",
        pid: secondJobProcess.pid,
        tick: 4,
        uid: 1000,
      }),
    ).toThrowError(expect.objectContaining({ maximum: 1, resource: "jobs" }));
    expect(jobs.snapshot()).toEqual(jobSnapshot);

    const sessions = runningState({ maximumLoginSessions: 1 });
    sessions.openLoginSession({
      gid: 1000,
      sessionId: "first",
      terminal: "tty1",
      tick: 3,
      uid: 1000,
      username: "cs",
    });
    const sessionSnapshot = sessions.snapshot();
    expect(() =>
      sessions.openLoginSession({
        gid: 1001,
        sessionId: "overflow",
        terminal: "tty2",
        tick: 4,
        uid: 1001,
        username: "alice",
      }),
    ).toThrowError(
      expect.objectContaining({ maximum: 1, resource: "login_sessions" }),
    );
    expect(sessions.snapshot()).toEqual(sessionSnapshot);

    const lastLogins = runningState({
      maximumLastLogins: 1,
      maximumLoginSessions: 2,
    });
    lastLogins.openLoginSession({
      gid: 1000,
      sessionId: "first",
      terminal: "tty1",
      tick: 3,
      uid: 1000,
      username: "cs",
    });
    lastLogins.closeLoginSession("first", 4);
    const lastLoginSnapshot = lastLogins.snapshot();
    expect(() =>
      lastLogins.openLoginSession({
        gid: 1001,
        sessionId: "overflow",
        terminal: "tty2",
        tick: 5,
        uid: 1001,
        username: "alice",
      }),
    ).toThrowError(
      expect.objectContaining({ maximum: 1, resource: "last_logins" }),
    );
    expect(lastLogins.snapshot()).toEqual(lastLoginSnapshot);

    const journal = runningState({
      maximumJournalBytes: 16,
      maximumJournalEntries: 1,
      maximumJournalEntryBytes: 16,
    });
    journal.appendSystemJournal(3, "first");
    const journalSnapshot = journal.snapshot();
    expect(() => journal.appendSystemJournal(4, "overflow")).toThrowError(
      expect.objectContaining({ maximum: 1, resource: "journal_entries" }),
    );
    expect(journal.snapshot()).toEqual(journalSnapshot);

    const services = runningState({ maximumServices: 1 });
    services.registerService({ enabled: true, name: "first", tick: 3 });
    const serviceSnapshot = services.snapshot();
    expect(() =>
      services.registerService({ enabled: true, name: "overflow", tick: 4 }),
    ).toThrowError(
      expect.objectContaining({ maximum: 1, resource: "services" }),
    );
    expect(services.snapshot()).toEqual(serviceSnapshot);

    const mounts = runningState({ maximumMounts: 1 });
    mounts.mount({
      filesystemType: "csfs",
      mountedTick: 3,
      options: [],
      readOnly: false,
      source: "computer-system",
      target: "/",
    });
    const mountSnapshot = mounts.snapshot();
    expect(() =>
      mounts.mount({
        filesystemType: "proc",
        mountedTick: 4,
        options: ["nosuid", "nodev", "noexec"],
        readOnly: true,
        source: "proc",
        target: "/proc",
      }),
    ).toThrowError(expect.objectContaining({ maximum: 1, resource: "mounts" }));
    expect(mounts.snapshot()).toEqual(mountSnapshot);

    const devices = runningState({ maximumDevices: 1 });
    devices.registerDevice({
      kind: "virtual",
      path: "/dev/null",
      state: "available",
      tick: 3,
    });
    const deviceSnapshot = devices.snapshot();
    expect(() =>
      devices.registerDevice({
        kind: "virtual",
        path: "/dev/zero",
        state: "available",
        tick: 4,
      }),
    ).toThrowError(
      expect.objectContaining({ maximum: 1, resource: "devices" }),
    );
    expect(devices.snapshot()).toEqual(deviceSnapshot);
  });

  it("round-trips full snapshots and makes the persistent projection cold and idempotent", (): void => {
    const state = runningState();
    const shell = state.spawnProcess({
      command: "/bin/bash",
      gid: 1000,
      parentPid: 1,
      startTick: 3,
      state: "running",
      uid: 1000,
    });
    state.createJob({ command: "bash", pid: shell.pid, tick: 3, uid: 1000 });
    state.openLoginSession({
      gid: 1000,
      sessionId: "writer",
      terminal: "tty1",
      tick: 4,
      uid: 1000,
      username: "cs",
    });
    state.registerService({ enabled: true, name: "shell", tick: 4 });
    state.defineMount({
      filesystemType: "proc",
      options: ["nosuid", "nodev", "noexec"],
      readOnly: true,
      source: "proc",
      target: "/proc",
    });
    state.mount({
      filesystemType: "proc",
      mountedTick: 4,
      options: ["nosuid", "nodev", "noexec"],
      readOnly: true,
      source: "proc",
      target: "/proc",
    });
    state.registerDevice({
      kind: "virtual",
      path: "/dev/null",
      state: "available",
      tick: 4,
    });
    state.appendBootJournal(1, "booted");
    state.appendAuthJournal(4, "cs logged in");

    const full = state.snapshot();
    expect(OsRuntimeState.restore("c-runtime", full).snapshot()).toEqual(full);
    expect(state.revision).toBe(full.revision);

    const persistent = state.persistentSnapshot();
    expect(persistent).toMatchObject({
      jobs: [],
      lifecycle: { changedTick: 0, phase: "off" },
      loginSessions: [],
      mounts: [],
      nextJobId: 1,
      nextPid: 2,
      processes: [],
    });
    expect(persistent.mountDefinitions).toHaveLength(1);
    expect(persistent.services[0]).toMatchObject({
      state: "inactive",
    });
    expect(persistent.devices[0]).toMatchObject({ state: "offline" });
    expect(persistent.journal).toHaveLength(2);
    expect(persistent.lastLogins).toHaveLength(1);

    const cold = OsRuntimeState.restore("c-runtime", persistent);
    expect(cold.persistentSnapshot()).toEqual(persistent);
    expect(cold.transitionLifecycle({ kind: "begin_boot", tick: 10 })).toEqual({
      bootTick: 10,
      changedTick: 10,
      phase: "booting",
    });
  });

  it("supplies backward-compatible defaults and rejects corrupt relations", (): void => {
    const empty = new OsRuntimeState("c-legacy").snapshot();
    expect(OsRuntimeState.restore("c-legacy").snapshot()).toEqual(empty);
    expect(
      OsRuntimeState.restore("c-legacy", {
        computerId: "c-legacy",
        schema: 0,
      }).snapshot(),
    ).toEqual(empty);
    expect(
      OsRuntimeState.restore("c-legacy", {
        computerId: "c-legacy",
        schema: 1,
      }).snapshot(),
    ).toEqual(empty);

    const live = runningState().snapshot();
    expect(() =>
      OsRuntimeState.restore("c-runtime", {
        ...live,
        lifecycle: { changedTick: 5, phase: "off" },
      }),
    ).toThrow(OsRuntimeStateSnapshotError);
    expect(() => OsRuntimeState.restore("wrong-computer", live)).toThrow(
      /Computer ID does not match/u,
    );
    expect(() =>
      runningState({ maximumProcesses: 1 }).spawnProcess({
        command: "overflow",
        gid: 1000,
        parentPid: 1,
        startTick: 3,
        uid: 1000,
      }),
    ).toThrow(OsRuntimeStateCapacityError);
    expect(() =>
      runningState().transitionLifecycle({ kind: "begin_boot", tick: 4 }),
    ).toThrow(OsRuntimeStateTransitionError);
  });
});

function bootingState(
  limits: Partial<OsRuntimeStateLimits> = {},
): OsRuntimeState {
  const state = new OsRuntimeState("c-runtime", limits);
  state.transitionLifecycle({ kind: "begin_boot", tick: 1 });
  return state;
}

function runningState(
  limits: Partial<OsRuntimeStateLimits> = {},
): OsRuntimeState {
  const state = bootingState(limits);
  state.createInitProcess({
    command: "/sbin/cs-init",
    gid: 0,
    startTick: 1,
    state: "running",
    uid: 0,
  });
  state.transitionLifecycle({ kind: "boot_complete", tick: 2 });
  return state;
}
