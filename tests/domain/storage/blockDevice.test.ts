import { describe, expect, it } from "vitest";

import {
  DeterministicBlockDevice,
  type BlockCompletion,
  type BlockRequest,
} from "../../../src/domain/storage/blockDevice.js";
import {
  desktopDiskProfile,
  floppy1440kProfile,
} from "../../../src/domain/storage/storageProfiles.js";

describe("DeterministicBlockDevice", (): void => {
  it("reports media and active operation for hardware indicators", (): void => {
    const hdd = new DeterministicBlockDevice(desktopDiskProfile.device);
    const fdd = new DeterministicBlockDevice(floppy1440kProfile);
    expect(hdd.activity).toEqual({
      mediaPresent: true,
      pendingRequests: 0,
      state: "idle",
    });
    expect(fdd.activity).toEqual({
      mediaPresent: false,
      pendingRequests: 0,
      state: "absent",
    });
    hdd.submit(request("indicator-read", "read", 0, 1), 0n);
    expect(hdd.activity).toMatchObject({ pendingRequests: 1, state: "read" });
  });

  it("makes far-cylinder fixed-disk I/O slower than a contiguous cold read", (): void => {
    const sequential = complete(
      new DeterministicBlockDevice(desktopDiskProfile.device),
      request("sequential", "read", 0, 8),
    );
    const farLba = desktopDiskProfile.device.sectorCount - 8;
    const random = complete(
      new DeterministicBlockDevice(desktopDiskProfile.device),
      request("random", "read", farLba, 8),
    );

    expect(sequential.outcome).toBe("completed");
    expect(random.outcome).toBe("completed");
    expect(random.timing.seekNanoseconds).toBe(20_000_000n);
    expect(random.timing.totalNanoseconds).toBeGreaterThan(
      sequential.timing.totalNanoseconds,
    );
  });

  it("repeats the same mechanical result without host time or randomness", (): void => {
    const run = (): unknown => {
      const device = new DeterministicBlockDevice(desktopDiskProfile.device);
      const first = complete(device, request("one", "read", 1_024, 16), 7_000n);
      const second = complete(
        device,
        request("two", "write", 1_040, 4),
        first.completedAtNanoseconds,
      );
      return { first, second, stats: device.stats };
    };

    expect(run()).toEqual(run());
  });

  it("keeps one active request plus a bounded queue", (): void => {
    const device = new DeterministicBlockDevice(desktopDiskProfile.device);

    expect(device.submit(request("active", "read", 0, 1), 0n)).toMatchObject({
      outcome: "accepted",
      queued: false,
    });
    expect(device.submit(request("queued", "read", 1, 1), 0n)).toEqual({
      outcome: "accepted",
      queued: true,
    });
    expect(device.submit(request("overflow", "read", 2, 1), 0n)).toMatchObject({
      outcome: "rejected",
      completion: { code: "io_queue_full", outcome: "failed" },
    });
    expect(device.submit(request("active", "read", 3, 1), 0n)).toMatchObject({
      outcome: "rejected",
      completion: { code: "duplicate_request" },
    });
    expect(device.stats).toMatchObject({
      accepted: 2,
      maximumQueueDepth: 1,
      rejected: 2,
      submitted: 4,
    });
  });

  it("models FDD media, spin-up, write protection, and generation-safe eject", (): void => {
    const device = new DeterministicBlockDevice(floppy1440kProfile);
    expect(device.submit(request("empty", "read", 0, 1), 0n)).toMatchObject({
      outcome: "rejected",
      completion: { code: "no_media" },
    });

    const protectedGeneration = device.insertMedia({
      id: "install-disk",
      sectorCount: floppy1440kProfile.sectorCount,
      writeProtected: true,
    });
    expect(
      device.submit(request("protected", "write", 0, 1), 0n),
    ).toMatchObject({
      outcome: "rejected",
      completion: { code: "write_protected" },
    });
    expect(device.ejectMedia(1n)).toEqual([]);

    const writableGeneration = device.insertMedia({
      id: "work-disk",
      sectorCount: floppy1440kProfile.sectorCount,
    });
    expect(writableGeneration).toBeGreaterThan(protectedGeneration);
    const accepted = device.submit(request("in-flight", "read", 0, 18), 2n);
    expect(accepted).toMatchObject({ outcome: "accepted", queued: false });
    const deadline = device.nextDeadlineNanoseconds!;
    expect(deadline - 2n).toBeGreaterThanOrEqual(500_000_000n);

    const cancelled = device.ejectMedia(3n);
    expect(cancelled).toMatchObject([
      {
        code: "media_changed",
        mediaGeneration: writableGeneration,
        outcome: "cancelled",
        request: { id: "in-flight" },
      },
    ]);
    device.insertMedia({
      id: "replacement",
      sectorCount: floppy1440kProfile.sectorCount,
    });
    expect(device.completeOneDue(deadline)).toBeUndefined();
  });
});

function request(
  id: string,
  operation: BlockRequest["operation"],
  lba: number,
  sectorCount: number,
): BlockRequest {
  return { id, operation, lba, sectorCount };
}

function complete(
  device: DeterministicBlockDevice,
  value: BlockRequest,
  submittedAtNanoseconds = 0n,
): BlockCompletion {
  const submitted = device.submit(value, submittedAtNanoseconds);
  if (
    submitted.outcome !== "accepted" ||
    submitted.deadlineNanoseconds === undefined
  ) {
    throw new Error(`Request ${value.id} was not started`);
  }
  const completion = device.completeOneDue(submitted.deadlineNanoseconds);
  if (completion === undefined)
    throw new Error(`Request ${value.id} did not complete`);
  return completion;
}
