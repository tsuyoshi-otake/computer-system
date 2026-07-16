import { describe, expect, it } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import type {
  OsProcessRecord,
  OsRuntimeState,
} from "../../src/application/os/osRuntimeState.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";

describe("ComputerRuntime OS process ownership", (): void => {
  it("assigns and reaps a credentialed PID for a compile job", (): void => {
    const record = new ComputerRecord("c-000821", "standard");
    const runtime = poweredRuntime(record);
    const live = liveOsState(runtime, record.computerId);
    const baselinePids = processIds(live);
    record.filesystem.writeFile(
      "/tmp/one.asm",
      "global main\nmain:\nmov eax, 1\nhalt\n",
    );
    const completions: DebugShellCommandCompletion[] = [];

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "as /tmp/one.asm -o /tmp/one",
      (result) => completions.push(result),
    );

    const compileProcess = processByCommand(live, "as");
    expect(compileProcess).toMatchObject({
      gid: 1_000,
      state: "running",
      uid: 1_000,
    });
    expect(baselinePids).not.toContain(compileProcess.pid);
    expect(record.osRuntimeSnapshot).toMatchObject({
      lifecycle: { phase: "off" },
      processes: [],
      revision: live.revision,
    });

    runUntil(runtime, () => completions.length === 1);
    expect(completions[0]).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(processIds(live)).toEqual(baselinePids);
    expect(record.osRuntimeSnapshot?.revision).toBe(live.revision);
  });

  it("reaps an interactive foreground PID at the interrupt boundary", (): void => {
    const record = new ComputerRecord("c-000822", "standard");
    const runtime = poweredRuntime(record);
    compileLoop(runtime, record);
    const live = liveOsState(runtime, record.computerId);
    const baselinePids = processIds(live);
    runUntil(
      runtime,
      () => runtime.vmState(record.computerId)?.kind === "waiting_event",
    );

    expect(
      runtime.queueEvent(record.computerId, "terminal_line", "run /tmp/loop"),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(runtime, () => hasCommand(live, "run"));
    const foreground = processByCommand(live, "run");
    expect(foreground).toMatchObject({ state: "running", uid: 1_000 });
    expect(baselinePids).not.toContain(foreground.pid);

    expect(runtime.interrupt(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "foreground_interrupted",
    });
    runUntil(runtime, () => live.process(foreground.pid) === undefined);
    expect(processIds(live)).toEqual(baselinePids);
    expect(record.osRuntimeSnapshot?.revision).toBe(live.revision);
  });

  it("reaps a scheduled debug PID synchronously on terminal disconnect", (): void => {
    const record = new ComputerRecord("c-000823", "standard");
    const runtime = poweredRuntime(record);
    compileLoop(runtime, record);
    const completions: DebugShellCommandCompletion[] = [];
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "run /tmp/loop",
      (result) => completions.push(result),
    );
    const live = liveOsState(runtime, record.computerId);
    const debugProcess = processByCommand(live, "run");

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted" });

    expect(completions[0]).toMatchObject({
      outcome: "completed",
      exitCode: 130,
    });
    expect(live.process(debugProcess.pid)).toBeUndefined();
    expect(hasCommand(live, "run")).toBe(false);
    expect(record.osRuntimeSnapshot?.revision).toBe(live.revision);
  });

  it("clears volatile PIDs on shutdown and establishes presence after reboot", (): void => {
    const shutdownRecord = new ComputerRecord("c-000824", "standard");
    const shutdownRuntime = poweredRuntime(shutdownRecord);
    compileLoop(shutdownRuntime, shutdownRecord);
    shutdownRuntime.enqueueDebugShellCommand(
      shutdownRecord.computerId,
      "run /tmp/loop",
      () => {
        // Runtime detach owns finalization even when no caller output is needed.
      },
    );
    const shutdownState = liveOsState(
      shutdownRuntime,
      shutdownRecord.computerId,
    );
    expect(hasCommand(shutdownState, "run")).toBe(true);

    expect(
      shutdownRuntime.shutdown(shutdownRecord.computerId, "test shutdown"),
    ).toMatchObject({ outcome: "accepted" });
    runUntil(
      shutdownRuntime,
      () => shutdownRecord.lifecycle.state.kind === "off",
    );
    expect(shutdownState.lifecycle.phase).toBe("off");
    expect(shutdownState.processes()).toEqual([]);

    const rebootRecord = new ComputerRecord("c-000825", "standard");
    const rebootRuntime = poweredRuntime(rebootRecord);
    const rebootState = liveOsState(rebootRuntime, rebootRecord.computerId);
    expect(rebootRuntime.reboot(rebootRecord.computerId)).toMatchObject({
      outcome: "accepted",
    });
    runUntil(
      rebootRuntime,
      () =>
        rebootRecord.lifecycle.state.kind === "running" &&
        rebootState.lifecycle.phase === "running",
    );
    expect(rebootState.process(1)).toMatchObject({
      command: "/sbin/cs-init",
      state: "running",
    });
    expect(rebootState.processes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ command: "/sbin/cs-getty tty1" }),
        expect.objectContaining({ command: "/bin/bash" }),
      ]),
    );
    expect(rebootRecord.osRuntimeSnapshot).toMatchObject({
      lifecycle: { phase: "off" },
      processes: [],
      revision: rebootState.revision,
    });
  });
});

function poweredRuntime(record: ComputerRecord): ComputerRuntime {
  const runtime = new ComputerRuntime({
    schedulerLimits: {
      cpuCyclesPerComputer: 128,
      cpuCyclesPerTick: 256,
      eventCapacity: 16,
      instructionsPerComputer: 64,
      instructionsPerTick: 128,
      timerCapacity: 8,
    },
  });
  expect(runtime.register(record).outcome).toBe("accepted");
  let generation = 0;
  const snapshots = new Map<string, ComputerSnapshot>();
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: (): number => 0,
    stopDevices: (): void => undefined,
    syncPersistence: (computerId) => {
      if (computerId !== record.computerId) {
        return { outcome: "missing" as const, computerId };
      }
      snapshots.set(computerId, structuredClone(record.snapshot()));
      generation += 1;
      return { outcome: "saved" as const, generation };
    },
  });
  expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
  return runtime;
}

function compileLoop(runtime: ComputerRuntime, record: ComputerRecord): void {
  record.filesystem.writeFile(
    "/tmp/loop.asm",
    "global main\nmain:\nadd eax, 1\njmp main\n",
  );
  expect(
    runtime.executeDebugShellCommand(
      record.computerId,
      "as /tmp/loop.asm -o /tmp/loop",
    ),
  ).toMatchObject({ outcome: "completed", exitCode: 0 });
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

function processByCommand(
  state: OsRuntimeState,
  command: string,
): OsProcessRecord {
  const process = state
    .processes()
    .find((candidate) => candidate.command === command);
  if (process === undefined) throw new Error(`missing OS process: ${command}`);
  return process;
}

function hasCommand(state: OsRuntimeState, command: string): boolean {
  return state.processes().some((process) => process.command === command);
}

function processIds(state: OsRuntimeState): readonly number[] {
  return state.processes().map(({ pid }) => pid);
}

function runUntil(runtime: ComputerRuntime, predicate: () => boolean): void {
  for (let tick = 0; tick < 1_000; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("runtime did not reach the expected terminal state");
}
