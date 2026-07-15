import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("face I/O lifecycle", (): void => {
  it("closes every port immediately on reboot and starts a new power epoch", (): void => {
    const record = new ComputerRecord("c-000500", "standard");
    const runtime = new ComputerRuntime({
      defaultBootSource: "import os\nos.pull_event()\n",
    });
    runtime.register(record);
    runtime.powerOn(record.computerId);
    const before = record.faceIo.rs232("front").status.powerEpoch;
    expect(record.faceIo.rs232("front").status.powered).toBe(true);
    record.faceIo.rs232("front").receive(Uint8Array.of(1, 2));

    expect(runtime.reboot(record.computerId)).toMatchObject({
      outcome: "accepted",
    });
    expect(record.faceIo.rs232("front").status).toMatchObject({
      powered: false,
      receiveBytes: 0,
      powerEpoch: before + 1,
    });
    runtime.runTick();
    runtime.runTick();
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
