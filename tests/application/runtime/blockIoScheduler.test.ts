import { describe, expect, it } from "vitest";

import {
  BlockIoScheduler,
  type BlockIoSchedulerLimits,
} from "../../../src/application/runtime/blockIoScheduler.js";
import {
  ComputerWorkMonitor,
  defaultComputerWorkMonitorLimits,
  type MonotonicMicrosecondClock,
} from "../../../src/application/runtime/computerWorkMonitor.js";
import { DeterministicBlockDevice } from "../../../src/domain/storage/blockDevice.js";
import { desktopDiskProfile } from "../../../src/domain/storage/storageProfiles.js";

class FakeClock implements MonotonicMicrosecondClock {
  value = 0;

  nowMicroseconds(): number {
    return this.value;
  }
}

describe("BlockIoScheduler", (): void => {
  it("uses the block_io WorkMonitor lane and retains guest deadlines across host deferral", (): void => {
    const device = new DeterministicBlockDevice(desktopDiskProfile.device);
    const scheduler = new BlockIoScheduler();
    scheduler.register("c-000001:hdd", device);
    expect(
      scheduler.submit(
        "c-000001:hdd",
        { id: "read", operation: "read", lba: 0, sectorCount: 1 },
        0n,
      ),
    ).toMatchObject({ outcome: "accepted" });
    const deadline = device.nextDeadlineNanoseconds!;

    const clock = new FakeClock();
    const monitor = new ComputerWorkMonitor(clock, {
      ...defaultComputerWorkMonitorLimits,
      laneUnitsPerTick: {
        ...defaultComputerWorkMonitorLimits.laneUnitsPerTick,
        block_io: 1,
      },
    });
    const firstTick = monitor.beginTick(1);
    firstTick.tryRun(
      { lane: "block_io", deterministicUnits: 1 },
      () => undefined,
    );
    expect(scheduler.runDue(deadline, firstTick)).toMatchObject({
      completions: [],
      hostDeferred: true,
    });
    firstTick.finish();
    expect(device.nextDeadlineNanoseconds).toBe(deadline);

    const secondTick = monitor.beginTick(2);
    const completed = scheduler.runDue(deadline, secondTick);
    secondTick.finish();
    expect(completed).toMatchObject({
      completions: [
        { deviceId: "c-000001:hdd", completion: { code: "completed" } },
      ],
      hostDeferred: false,
      sectors: 1,
    });
    expect(scheduler.stats.hostDeferrals).toBe(1);
    expect(monitor.snapshot().lanes.block_io).toMatchObject({
      admitted: 2,
      deferred: 1,
      units: 2,
    });
  });

  it("bounds completions and bytes while preserving accepted work", (): void => {
    const limits: BlockIoSchedulerLimits = {
      maximumDevices: 4,
      maximumCompletionsPerTick: 1,
      maximumSectorsPerTick: 2,
      maximumBytesPerTick: 1_024,
    };
    const scheduler = new BlockIoScheduler(limits);
    const first = new DeterministicBlockDevice(desktopDiskProfile.device);
    const second = new DeterministicBlockDevice(desktopDiskProfile.device);
    scheduler.register("first", first);
    scheduler.register("second", second);
    scheduler.submit(
      "first",
      { id: "first-read", operation: "read", lba: 0, sectorCount: 1 },
      0n,
    );
    scheduler.submit(
      "second",
      { id: "second-read", operation: "read", lba: 0, sectorCount: 1 },
      0n,
    );
    const due = maximum(
      first.nextDeadlineNanoseconds!,
      second.nextDeadlineNanoseconds!,
    );

    const firstTick = scheduler.runDue(due);
    expect(firstTick).toMatchObject({
      budgetDeferred: true,
      bytes: 512,
      sectors: 1,
    });
    expect(firstTick.completions).toHaveLength(1);
    const secondTick = scheduler.runDue(due);
    expect(secondTick.completions).toHaveLength(1);
    expect(scheduler.stats).toMatchObject({
      accepted: 2,
      budgetDeferrals: 1,
      completed: 2,
      rejected: 0,
    });
  });

  it("does not inspect registered idle devices", (): void => {
    const scheduler = new BlockIoScheduler({
      maximumDevices: 1_001,
      maximumCompletionsPerTick: 2,
      maximumSectorsPerTick: 2,
      maximumBytesPerTick: 1_024,
    });
    for (let index = 0; index < 1_000; index += 1) {
      scheduler.register(
        `idle-${String(index)}`,
        new DeterministicBlockDevice(desktopDiskProfile.device),
      );
    }
    const active = new DeterministicBlockDevice(desktopDiskProfile.device);
    scheduler.register("active", active);
    scheduler.submit(
      "active",
      { id: "only", operation: "read", lba: 0, sectorCount: 1 },
      0n,
    );

    const result = scheduler.runDue(active.nextDeadlineNanoseconds!);
    expect(result.completions).toHaveLength(1);
    expect(scheduler.stats).toMatchObject({
      completed: 1,
      deadlinePops: 1,
      maximumPendingDeadlines: 1,
      registeredDevices: 1_001,
    });
  });

  it("rejects unknown and unschedulable requests explicitly", (): void => {
    const scheduler = new BlockIoScheduler({
      maximumDevices: 1,
      maximumCompletionsPerTick: 1,
      maximumSectorsPerTick: 1,
      maximumBytesPerTick: 512,
    });
    expect(
      scheduler.submit(
        "missing",
        { id: "missing", operation: "read", lba: 0, sectorCount: 1 },
        0n,
      ),
    ).toEqual({ outcome: "rejected", reason: "unknown_device" });
    scheduler.register(
      "fixed",
      new DeterministicBlockDevice(desktopDiskProfile.device),
    );
    expect(
      scheduler.submit(
        "fixed",
        { id: "large", operation: "read", lba: 0, sectorCount: 2 },
        0n,
      ),
    ).toEqual({ outcome: "rejected", reason: "request_limit" });
  });
});

function maximum(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}
