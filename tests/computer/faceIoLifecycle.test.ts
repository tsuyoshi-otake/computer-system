import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";

describe("face I/O lifecycle", (): void => {
  it("closes every port at the bounded reboot boundary and starts a new power epoch", (): void => {
    const record = new ComputerRecord("c-000500", "standard");
    const runtime = new ComputerRuntime({
      defaultBootSource: "import os\nos.pull_event()\n",
    });
    configureInMemoryPersistence(runtime, record);
    runtime.register(record);
    runtime.powerOn(record.computerId);
    runUntil(
      runtime,
      () =>
        record.lifecycle.state.kind !== "booting" &&
        record.display.state.kind !== "post",
      128,
    );
    const before = record.faceIo.rs232("front").status.powerEpoch;
    expect(record.faceIo.rs232("front").status.powered).toBe(true);
    record.faceIo.rs232("front").receive(Uint8Array.of(1, 2));

    expect(runtime.reboot(record.computerId)).toMatchObject({
      outcome: "accepted",
    });
    expect(record.faceIo.rs232("front").status).toMatchObject({
      powered: true,
      receiveBytes: 2,
      powerEpoch: before,
    });
    runUntil(runtime, () => !record.faceIo.rs232("front").status.powered);
    expect(record.faceIo.rs232("front").status).toMatchObject({
      powered: false,
      receiveBytes: 0,
      powerEpoch: before + 1,
    });
    runUntil(runtime, () => record.faceIo.rs232("front").status.powered);
    expect(record.faceIo.rs232("front").status).toMatchObject({
      powered: true,
      receiveBytes: 0,
      powerEpoch: before + 2,
    });
  });

  it("keeps transient bus buffers out of the persisted snapshot", (): void => {
    const record = new ComputerRecord("c-000501", "standard");
    record.faceIo.powerOn();
    record.faceIo.rs232("left").receive(Uint8Array.of(7));
    const snapshot = record.snapshot();

    expect(snapshot).not.toHaveProperty("faceIo");
    expect(JSON.stringify(snapshot)).not.toContain("receiveBytes");
  });
});

function runUntil(
  runtime: ComputerRuntime,
  predicate: () => boolean,
  maximumTicks = 128,
): void {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  if (!predicate()) throw new Error("face I/O lifecycle did not settle");
}

function configureInMemoryPersistence(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): void {
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
}
