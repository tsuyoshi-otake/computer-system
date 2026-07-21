import { describe, expect, it } from "vitest";

import { ComputerHost } from "../../src/application/computer/computerHost.js";
import {
  ComputerPersistenceService,
  type ComputerSnapshotRepository,
} from "../../src/application/computer/persistence.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";

describe("graceful Computer lifecycle", (): void => {
  it("drains admitted I/O, syncs twice, unmounts, and rejects new work", (): void => {
    const repository = new MemoryRepository();
    const runtime = new ComputerRuntime();
    const host = new ComputerHost(
      runtime,
      new ComputerPersistenceService(repository),
    );
    const record = new ComputerRecord("c-000841", "standard");
    expect(host.register(record).outcome).toBe("registered");
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runHostUntil(host, () => shellAcceptsInput(runtime, record.computerId));
    const state = liveOsState(runtime, record.computerId);
    host.runTick();
    repository.savedIds.length = 0;

    expect(
      host.submitBlockIo(record.computerId, "hdd", {
        id: "shutdown-read",
        lba: 8,
        operation: "read",
        sectorCount: 128,
      }),
    ).toMatchObject({ outcome: "accepted" });
    expect(
      runtime.shutdown(record.computerId, "operator request"),
    ).toMatchObject({ outcome: "accepted", state: "stopping" });
    expect(
      host.submitBlockIo(record.computerId, "hdd", {
        id: "late-write",
        lba: 256,
        operation: "write",
        sectorCount: 1,
      }),
    ).toEqual({ outcome: "rejected", reason: "stopping" });
    expect(
      runtime.queueEvent(record.computerId, "terminal_line", "touch /tmp/late"),
    ).toEqual({ outcome: "ignored", reason: "stopping" });

    host.runTick();
    expect(record.lifecycle.state.kind).toBe("stopping");
    runHostUntil(host, () => record.lifecycle.state.kind === "off", 400);

    expect(repository.savedIds.length).toBeGreaterThanOrEqual(2);
    expect(state.lifecycle.phase).toBe("off");
    expect(state.processes()).toEqual([]);
    expect(state.mounts()).toEqual([]);
    expect(record.filesystem.exists("/tmp/late")).toBe(false);
    const messages = state.renderMessagesLog();
    expectOrdered(messages, [
      "shutdown requested: operator request",
      "signalling owned processes",
      "accepted block I/O drained",
      "data sync ",
      "unmounted /proc",
      "device /dev/hda stopped",
      "final sync requested",
      "shutdown phases prepared for final persistence",
    ]);
  });

  it.each([
    {
      computerId: "c-000845",
      intent: "shutdown" as const,
      terminalMessage: "shutdown phases prepared for final persistence",
    },
    {
      computerId: "c-000846",
      intent: "reboot" as const,
      terminalMessage: "reboot phases prepared for final persistence",
    },
  ])(
    "persists the final $intent journal records exactly once at the final boundary",
    ({ computerId, intent, terminalMessage }): void => {
      const runtime = new ComputerRuntime();
      const record = new ComputerRecord(computerId, "standard");
      const persisted: ComputerSnapshot[] = [];
      let syncCount = 0;
      runtime.configureLifecycleBoundaries({
        pendingFilesystemIo: (): number => 0,
        stopDevices: (): void => undefined,
        syncPersistence: (requestedComputerId) => {
          expect(requestedComputerId).toBe(computerId);
          syncCount += 1;
          persisted.push(structuredClone(record.snapshot()));
          return { outcome: "saved", generation: syncCount };
        },
      });
      expect(runtime.register(record).outcome).toBe("accepted");
      expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
      runRuntimeUntil(runtime, () =>
        shellAcceptsInput(runtime, record.computerId),
      );

      expect(
        intent === "reboot"
          ? runtime.reboot(record.computerId)
          : runtime.shutdown(record.computerId, "durability test"),
      ).toMatchObject({
        outcome: "accepted",
        state: intent === "reboot" ? "rebooting" : "stopping",
      });
      if (intent === "reboot") {
        runRuntimeUntil(
          runtime,
          () =>
            record.lifecycle.state.kind === "booting" &&
            record.display.state.kind === "post",
        );
        runRuntimeUntil(runtime, () =>
          shellAcceptsInput(runtime, record.computerId),
        );
      } else {
        runRuntimeUntil(runtime, () => record.lifecycle.state.kind === "off");
      }

      expect(syncCount).toBe(2);
      expect(persisted).toHaveLength(2);
      const restored = restoreOsState(persisted[1]);
      const messages = restored
        .journalEntries("system")
        .map(({ message }) => message);
      expect(count(messages, "final sync requested")).toBe(1);
      expect(count(messages, terminalMessage)).toBe(1);
      expect(messages).not.toContain("final sync saved generation 2");
      expect(messages).not.toContain(`${intent} phases complete`);
    },
  );

  it("keeps a failed final boundary exact, owner-free, and free of durable completion claims", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000847", "standard");
    const persisted: ComputerSnapshot[] = [];
    const boundaryError = new Error("exact final boundary failure");
    let syncCount = 0;
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: (): number => 0,
      stopDevices: (): void => undefined,
      syncPersistence: () => {
        syncCount += 1;
        if (syncCount === 2) {
          return { outcome: "failed" as const, error: boundaryError };
        }
        persisted.push(structuredClone(record.snapshot()));
        return { outcome: "saved" as const, generation: syncCount };
      },
    });
    runtime.register(record);
    runtime.powerOn(record.computerId);
    runRuntimeUntil(runtime, () =>
      shellAcceptsInput(runtime, record.computerId),
    );

    expect(
      runtime.shutdown(record.computerId, "final failure test"),
    ).toMatchObject({ outcome: "accepted", state: "stopping" });
    runRuntimeUntil(runtime, () => record.lifecycle.state.kind === "crashed");

    expect(syncCount).toBe(2);
    expect(persisted).toHaveLength(1);
    const durableMessages = restoreOsState(persisted[0])
      .journalEntries("system")
      .map(({ message }) => message);
    expect(count(durableMessages, "final sync requested")).toBe(0);
    expect(
      count(durableMessages, "shutdown phases prepared for final persistence"),
    ).toBe(0);
    expect(
      durableMessages.some((message) => message.includes("phases complete")),
    ).toBe(false);

    const state = liveOsState(runtime, record.computerId);
    expect(state.lifecycle.reason).toBe(
      "sync_final failed: exact final boundary failure",
    );
    expect(record.lifecycle.state).toEqual({
      kind: "crashed",
      message: "sync_final failed: exact final boundary failure",
    });
    expect(state.renderMessagesLog()).not.toContain("final sync saved");
    expect(state.renderMessagesLog()).not.toContain("shutdown phases complete");
    expect(runtime.isStopping(record.computerId)).toBe(false);
  });

  it("does not leak failed final-boundary markers through a later host persistence retry", (): void => {
    const repository = new MemoryRepository();
    const runtime = new ComputerRuntime();
    const host = new ComputerHost(
      runtime,
      new ComputerPersistenceService(repository),
    );
    const record = new ComputerRecord("c-000848", "standard");
    host.register(record);
    runtime.powerOn(record.computerId);
    runHostUntil(host, () => shellAcceptsInput(runtime, record.computerId));
    repository.failFinalBoundary = true;

    expect(
      runtime.shutdown(record.computerId, "failed final retry test"),
    ).toMatchObject({ outcome: "accepted", state: "stopping" });
    runHostUntil(host, () => record.lifecycle.state.kind === "crashed");

    repository.failFinalBoundary = false;
    const savedBeforeRetry = repository.savedIds.length;
    runHostUntil(host, () => repository.savedIds.length > savedBeforeRetry);

    const restored = restoreOsState(
      repository.snapshots.get(record.computerId),
    );
    const messages = restored
      .journalEntries("system")
      .map(({ message }) => message);
    expect(count(messages, "final sync requested")).toBe(0);
    expect(
      count(messages, "shutdown phases prepared for final persistence"),
    ).toBe(0);
    expect(
      count(messages, "sync_final failed: injected final persistence failure"),
    ).toBe(1);
  });

  it("rolls back only final-boundary markers when the failing callback records another event", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000871", "standard");
    runtime.register(record);
    const state = liveOsState(runtime, record.computerId);
    let syncCount = 0;
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: (): number => 0,
      stopDevices: (): void => undefined,
      syncPersistence: () => {
        syncCount += 1;
        if (syncCount === 2) {
          state.appendSystemJournal(
            10_000,
            "persistence callback diagnostic survives",
            "warning",
          );
          return {
            outcome: "failed" as const,
            error: new Error("callback failure after diagnostic"),
          };
        }
        return { outcome: "saved" as const, generation: syncCount };
      },
    });
    runtime.powerOn(record.computerId);
    runRuntimeUntil(runtime, () =>
      shellAcceptsInput(runtime, record.computerId),
    );

    runtime.shutdown(record.computerId, "interleaved diagnostic test");
    runRuntimeUntil(runtime, () => record.lifecycle.state.kind === "crashed");

    expect(syncCount).toBe(2);
    expect(state.lifecycle.reason).toBe(
      "sync_final failed: callback failure after diagnostic",
    );
    const messages = restoreOsState(record.snapshot())
      .journalEntries("system")
      .map(({ message }) => message);
    expect(count(messages, "final sync requested")).toBe(0);
    expect(
      count(messages, "shutdown phases prepared for final persistence"),
    ).toBe(0);
    expect(count(messages, "persistence callback diagnostic survives")).toBe(1);
  });

  it("rolls back a partial final marker append when journal capacity rejects the second marker", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000872", "standard");
    let syncCount = 0;
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: (): number => 0,
      stopDevices: (): void => undefined,
      syncPersistence: () => {
        syncCount += 1;
        return { outcome: "saved" as const, generation: syncCount };
      },
    });
    runtime.register(record);
    runtime.powerOn(record.computerId);
    runRuntimeUntil(runtime, () =>
      shellAcceptsInput(runtime, record.computerId),
    );
    const state = liveOsState(runtime, record.computerId);

    runtime.shutdown(record.computerId, "journal capacity test");
    runRuntimeUntil(
      runtime,
      () => currentStopPhase(runtime, record.computerId) === "sync_final",
    );
    while (state.journalEntries().length < 255) {
      state.appendSystemJournal(
        10_000,
        `capacity filler ${String(state.journalEntries().length)}`,
      );
    }
    runtime.runTick();

    expect(syncCount).toBe(1);
    expect(record.lifecycle.state).toEqual({
      kind: "crashed",
      message:
        "sync_final failed: OS runtime journal_entries capacity 256 exceeded",
    });
    const messages = state
      .journalEntries("system")
      .map(({ message }) => message);
    expect(count(messages, "final sync requested")).toBe(0);
    expect(
      count(messages, "shutdown phases prepared for final persistence"),
    ).toBe(0);
    expect(
      count(
        messages,
        "sync_final failed: OS runtime journal_entries capacity 256 exceeded",
      ),
    ).toBe(1);
    expect(runtime.isStopping(record.computerId)).toBe(false);
  });

  it("reports a secondary final-marker rollback failure without hiding the persistence error", (): void => {
    const runtime = new ComputerRuntime();
    const record = new ComputerRecord("c-000873", "standard");
    runtime.register(record);
    const state = liveOsState(runtime, record.computerId);
    let syncCount = 0;
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: (): number => 0,
      stopDevices: (): void => undefined,
      syncPersistence: () => {
        syncCount += 1;
        if (syncCount === 2) {
          state.rollbackJournalEntries(
            state
              .journalEntries("system")
              .filter(
                ({ message }) =>
                  message === "final sync requested" ||
                  message === "shutdown phases prepared for final persistence",
              ),
          );
          return {
            outcome: "failed" as const,
            error: new Error("primary persistence failure"),
          };
        }
        return { outcome: "saved" as const, generation: syncCount };
      },
    });
    runtime.powerOn(record.computerId);
    runRuntimeUntil(runtime, () =>
      shellAcceptsInput(runtime, record.computerId),
    );

    runtime.shutdown(record.computerId, "secondary rollback test");
    runRuntimeUntil(runtime, () => record.lifecycle.state.kind === "crashed");

    expect(record.lifecycle.state.kind).toBe("crashed");
    if (record.lifecycle.state.kind !== "crashed") {
      throw new Error("secondary rollback failure did not crash the Computer");
    }
    expect(record.lifecycle.state.message).toContain(
      "sync_final failed: primary persistence failure",
    );
    expect(record.lifecycle.state.message).toContain(
      "final precommit rollback failed: journal rollback:",
    );
    expect(state.lifecycle.reason).toContain(
      "sync_final failed: primary persistence failure",
    );
    expect(state.renderMessagesLog()).toContain(
      "final precommit rollback failed: journal rollback:",
    );
    expect(state.renderMessagesLog()).not.toContain("final sync requested");
    expect(runtime.isStopping(record.computerId)).toBe(false);
  });

  it("faults at a failed durability boundary and preserves the last generation", (): void => {
    const repository = new MemoryRepository();
    const runtime = new ComputerRuntime();
    const host = new ComputerHost(
      runtime,
      new ComputerPersistenceService(repository),
    );
    const record = new ComputerRecord("c-000842", "standard");
    host.register(record);
    runtime.powerOn(record.computerId);
    runHostUntil(host, () => shellAcceptsInput(runtime, record.computerId));
    host.flush(record.computerId);
    const stable = structuredClone(repository.snapshots.get(record.computerId));
    repository.failSave = true;

    expect(
      runtime.shutdown(record.computerId, "failure injection").outcome,
    ).toBe("accepted");
    runHostUntil(host, () => record.lifecycle.state.kind === "crashed");

    const lifecycle = liveOsState(runtime, record.computerId).lifecycle;
    expect(lifecycle.phase).toBe("faulted");
    expect(lifecycle.reason).toContain("sync_data failed: write failed");
    expect(repository.snapshots.get(record.computerId)).toEqual(stable);
    expect(record.display.state).toMatchObject({ kind: "faulted" });
  });

  it("faults instead of claiming a clean stop without a persistence boundary", (): void => {
    const record = new ComputerRecord("c-000849", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    runtime.powerOn(record.computerId);
    runRuntimeUntil(runtime, () =>
      shellAcceptsInput(runtime, record.computerId),
    );

    expect(
      runtime.shutdown(record.computerId, "missing boundary"),
    ).toMatchObject({
      outcome: "accepted",
      state: "stopping",
    });
    runRuntimeUntil(runtime, () => record.lifecycle.state.kind === "crashed");

    const lifecycle = liveOsState(runtime, record.computerId).lifecycle;
    expect(lifecycle.phase).toBe("faulted");
    expect(lifecycle.reason).toContain(
      "sync_data failed: data persistence sync boundary is unavailable",
    );
    expect(runtime.isStopping(record.computerId)).toBe(false);
  });

  it("makes manual sync use the host boundary", (): void => {
    const repository = new MemoryRepository();
    const runtime = new ComputerRuntime();
    const host = new ComputerHost(
      runtime,
      new ComputerPersistenceService(repository),
    );
    const record = new ComputerRecord("c-000843", "standard");
    host.register(record);
    runtime.powerOn(record.computerId);
    runHostUntil(host, () => shellAcceptsInput(runtime, record.computerId));
    record.filesystem.writeFile("/tmp/manual-sync", "durable");

    expect(
      runtime.executeDebugShellCommand(record.computerId, "sync"),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });

    const snapshot = repository.snapshots.get(record.computerId);
    expect(snapshot).toBeDefined();
    expect(
      ComputerRecord.restore(snapshot!).filesystem.readFile("/tmp/manual-sync"),
    ).toBe("durable");
  });

  it("safe-boots a crashed machine without deleting a broken startup.py", (): void => {
    const record = new ComputerRecord("c-000844", "standard");
    record.filesystem.writeFile("/startup.py", "if broken syntax");
    const runtime = new ComputerRuntime();
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("failed");
    expect(record.lifecycle.state.kind).toBe("crashed");
    expect(runtime.powerOn(record.computerId)).toEqual({
      outcome: "ignored",
      reason: "not_running",
    });
    expect(runtime.safeBoot(record.computerId).outcome).toBe("accepted");
    runRuntimeUntil(runtime, () =>
      shellAcceptsInput(runtime, record.computerId),
    );

    expect(record.filesystem.readFile("/startup.py")).toBe("if broken syntax");
    expect(record.lifecycle.state.kind).toBe("waiting_event");
    expect(liveOsState(runtime, record.computerId).lifecycle.phase).toBe(
      "running",
    );
    expect(
      liveOsState(runtime, record.computerId).renderJournal("boot"),
    ).toContain("safe boot selected; /startup.py preserved and bypassed");
  });

  it.each([
    "signal",
    "drain_work",
    "drain_io",
    "sync_data",
    "unmount",
    "stop_devices",
    "sync_final",
    "terminate",
  ] as const)(
    "faults explicitly and leaves no active stop owner when %s fails",
    (phase): void => {
      const repository = new MemoryRepository();
      const runtime = new ComputerRuntime();
      const host = new ComputerHost(
        runtime,
        new ComputerPersistenceService(repository),
      );
      const record = new ComputerRecord(
        `c-${String(850 + stopPhaseIndex(phase)).padStart(6, "0")}`,
        "standard",
      );
      host.register(record);
      runtime.powerOn(record.computerId);
      runHostUntil(host, () => shellAcceptsInput(runtime, record.computerId));
      const state = liveOsState(runtime, record.computerId);

      if (phase === "drain_work") {
        expect(
          runtime.queueEvent(record.computerId, "terminal_line", "sleep 100 &"),
        ).toMatchObject({ outcome: "accepted" });
        runHostUntil(host, () => state.jobs(1_000).length === 1);
      }

      injectStopPhaseFailure(runtime, record, state, phase);
      expect(
        runtime.shutdown(record.computerId, "phase failure injection"),
      ).toMatchObject({ outcome: "accepted", state: "stopping" });
      runHostUntil(host, () => record.lifecycle.state.kind === "crashed", 260);

      expect(state.lifecycle.phase).toBe("faulted");
      expect(state.lifecycle.reason).toContain(
        `${phase} failed: injected ${phase}`,
      );
      const lifecycle = record.lifecycle.state;
      expect(lifecycle.kind).toBe("crashed");
      if (lifecycle.kind !== "crashed") {
        throw new Error("injected stop failure did not crash the Computer");
      }
      expect(lifecycle.message).toContain(`${phase} failed: injected ${phase}`);
      expect(record.display.state).toMatchObject({ kind: "faulted" });
      expect(runtime.isStopping(record.computerId)).toBe(false);
      expect(() => host.runTick()).not.toThrow();
      expect(record.lifecycle.state.kind).toBe("crashed");
    },
  );
});

type InjectedStopPhase =
  | "signal"
  | "drain_work"
  | "drain_io"
  | "sync_data"
  | "unmount"
  | "stop_devices"
  | "sync_final"
  | "terminate";

function stopPhaseIndex(phase: InjectedStopPhase): number {
  return [
    "signal",
    "drain_work",
    "drain_io",
    "sync_data",
    "unmount",
    "stop_devices",
    "sync_final",
    "terminate",
  ].indexOf(phase);
}

function injectStopPhaseFailure(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  state: OsRuntimeState,
  phase: InjectedStopPhase,
): void {
  let syncCount = 0;
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: (): number => {
      if (phase === "drain_io") throw new Error("injected drain_io");
      return 0;
    },
    stopDevices: (): void => {
      if (phase === "stop_devices") throw new Error("injected stop_devices");
    },
    syncPersistence: () => {
      syncCount += 1;
      if (phase === "sync_data" && syncCount === 1) {
        return {
          outcome: "failed" as const,
          error: new Error("injected sync_data"),
        };
      }
      if (phase === "sync_final" && syncCount === 2) {
        return {
          outcome: "failed" as const,
          error: new Error("injected sync_final"),
        };
      }
      return { outcome: "saved" as const, generation: syncCount };
    },
  });

  const internals = runtime as unknown as {
    finalizeBackgroundProcesses: (...arguments_: unknown[]) => void;
    forceFinalizeGuestWork: (...arguments_: unknown[]) => void;
  };
  if (phase === "signal") {
    internals.finalizeBackgroundProcesses = (): never => {
      throw new Error("injected signal");
    };
  } else if (phase === "drain_work") {
    internals.finalizeBackgroundProcesses = (): void => undefined;
    internals.forceFinalizeGuestWork = (): never => {
      throw new Error("injected drain_work");
    };
  }

  if (phase === "unmount") {
    (state as unknown as { unmount: (target: string) => void }).unmount =
      (): never => {
        throw new Error("injected unmount");
      };
  }

  if (phase === "terminate") {
    const faceIo = record.faceIo as unknown as {
      powerOff: (reason: string) => void;
    };
    const powerOff = faceIo.powerOff.bind(record.faceIo);
    let failed = false;
    faceIo.powerOff = (reason: string): void => {
      if (!failed) {
        failed = true;
        throw new Error("injected terminate");
      }
      powerOff(reason);
    };
  }
}

function liveOsState(
  runtime: ComputerRuntime,
  computerId: string,
): OsRuntimeState {
  const state = (
    runtime as unknown as {
      readonly entries: ReadonlyMap<
        string,
        { readonly osRuntimeState: OsRuntimeState }
      >;
    }
  ).entries.get(computerId)?.osRuntimeState;
  if (state === undefined) throw new Error("missing OS runtime state");
  return state;
}

function shellAcceptsInput(
  runtime: ComputerRuntime,
  computerId: string,
): boolean {
  const state = runtime.vmState(computerId);
  return state?.kind === "waiting_event" && state.filter === undefined;
}

function currentStopPhase(
  runtime: ComputerRuntime,
  computerId: string,
): string | undefined {
  return (
    runtime as unknown as {
      readonly entries: ReadonlyMap<
        string,
        { readonly stopState?: { readonly phase: string } }
      >;
    }
  ).entries.get(computerId)?.stopState?.phase;
}

function runHostUntil(
  host: ComputerHost,
  predicate: () => boolean,
  maximumTicks = 100,
): void {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    if (predicate()) return;
    host.runTick();
  }
  throw new Error("host did not reach the expected state");
}

function runRuntimeUntil(
  runtime: ComputerRuntime,
  predicate: () => boolean,
): void {
  for (let tick = 0; tick < 100; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("runtime did not reach the expected state");
}

function expectOrdered(value: string, parts: readonly string[]): void {
  let cursor = -1;
  for (const part of parts) {
    const next = value.indexOf(part, cursor + 1);
    expect(next, part).toBeGreaterThan(cursor);
    cursor = next;
  }
}

function restoreOsState(
  snapshot: ComputerSnapshot | undefined,
): OsRuntimeState {
  if (snapshot === undefined) throw new Error("missing persisted snapshot");
  const record = ComputerRecord.restore(snapshot);
  return OsRuntimeState.restore(record.computerId, record.osRuntimeSnapshot);
}

function count(values: readonly string[], expected: string): number {
  return values.filter((value) => value === expected).length;
}

class MemoryRepository implements ComputerSnapshotRepository {
  readonly snapshots = new Map<string, ComputerSnapshot>();
  readonly savedIds: string[] = [];
  failSave = false;
  failFinalBoundary = false;

  load(computerId: string): ComputerSnapshot | undefined {
    return this.snapshots.get(computerId);
  }

  save(snapshot: ComputerSnapshot): number {
    if (this.failSave) throw new Error("write failed");
    if (
      this.failFinalBoundary &&
      restoreOsState(snapshot)
        .journalEntries("system")
        .some(({ message }) => message === "final sync requested")
    ) {
      throw new Error("injected final persistence failure");
    }
    this.snapshots.set(snapshot.computerId, structuredClone(snapshot));
    this.savedIds.push(snapshot.computerId);
    return this.savedIds.length;
  }
}
