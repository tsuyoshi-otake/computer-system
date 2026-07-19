import { describe, expect, it } from "vitest";

import {
  BoundedIntervalAllocator,
  IntervalAllocationCapacityError,
  IntervalAllocationLimitError,
  MAX_INTERVAL_ALLOCATIONS,
  MAX_INTERVAL_RANGES,
} from "../../src/domain/computer/boundedIntervalAllocator.js";

describe("BoundedIntervalAllocator", (): void => {
  it("uses deterministic ascending first-fit across disjoint input ranges", (): void => {
    const allocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [
        { size: 64, start: 256 },
        { size: 64, start: 0 },
        { size: 64, start: 128 },
      ],
    });

    const first = allocator.allocate(32);
    const second = allocator.allocate(32);
    const third = allocator.allocate(32);

    expect([first.start, second.start, third.start]).toEqual([0, 32, 128]);
    expect(allocator.snapshot().freeExtents).toEqual([
      { endExclusive: 192, size: 32, start: 160 },
      { endExclusive: 320, size: 64, start: 256 },
    ]);
  });

  it("clips ranges and allocation sizes to the configured alignment", (): void => {
    const allocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [{ size: 61, start: 3 }],
    });

    expect(allocator.snapshot()).toMatchObject({
      alignment: 16,
      capacityBytes: 48,
      freeExtents: [{ endExclusive: 64, size: 48, start: 16 }],
    });

    const first = allocator.allocate(1);
    const second = allocator.allocate(17);
    expect(first).toMatchObject({
      endExclusive: 32,
      requestedSize: 1,
      size: 16,
      start: 16,
    });
    expect(second).toMatchObject({
      endExclusive: 64,
      requestedSize: 17,
      size: 32,
      start: 32,
    });
    expect(allocator.snapshot()).toMatchObject({
      allocatedBytes: 48,
      freeBytes: 0,
      largestFreeBlockBytes: 0,
      largestFreeExtent: null,
    });
  });

  it("keeps holes between ranges and selects the first fitting extent", (): void => {
    const allocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [
        { size: 64, start: 0 },
        { size: 64, start: 128 },
      ],
    });
    const first = allocator.allocate(48);
    const second = allocator.allocate(32);

    expect(first.start).toBe(0);
    expect(second.start).toBe(128);
    expect(allocator.snapshot().freeExtents).toEqual([
      { endExclusive: 64, size: 16, start: 48 },
      { endExclusive: 192, size: 32, start: 160 },
    ]);
  });

  it("coalesces adjacent free extents immediately and releases exactly once", (): void => {
    const allocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [{ size: 64, start: 0 }],
    });
    const first = allocator.allocate(16);
    const second = allocator.allocate(16);
    const third = allocator.allocate(16);
    const fourth = allocator.allocate(16);

    second.release();
    fourth.release();
    expect(allocator.snapshot().freeExtents).toEqual([
      { endExclusive: 32, size: 16, start: 16 },
      { endExclusive: 64, size: 16, start: 48 },
    ]);

    third.release();
    expect(allocator.snapshot().freeExtents).toEqual([
      { endExclusive: 64, size: 48, start: 16 },
    ]);

    first.release();
    expect(allocator.snapshot().freeExtents).toEqual([
      { endExclusive: 64, size: 64, start: 0 },
    ]);
    expect(first.released).toBe(true);
    const releasedState = allocator.snapshot();
    expect(() => first.release()).toThrow(/already released/u);
    expect(allocator.snapshot()).toEqual(releasedState);
  });

  it("reports fragmentation and rejects a request larger than every free block without mutation", (): void => {
    const allocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [{ size: 96, start: 0 }],
    });
    const first = allocator.allocate(32);
    allocator.allocate(32);
    const third = allocator.allocate(32);
    first.release();
    third.release();

    const before = allocator.snapshot();
    expect(before).toMatchObject({
      freeBytes: 64,
      largestFreeBlockBytes: 32,
      largestFreeExtent: { endExclusive: 32, size: 32, start: 0 },
    });
    expect(() => allocator.allocate(48)).toThrow(
      IntervalAllocationCapacityError,
    );
    expect(allocator.snapshot()).toEqual(before);
  });

  it("rejects capacity-plus-one and allocation-count-plus-one before mutation", (): void => {
    const capacityAllocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [{ size: 64, start: 0 }],
    });
    const capacityBefore = capacityAllocator.snapshot();
    expect(() => capacityAllocator.allocate(65)).toThrow(
      IntervalAllocationCapacityError,
    );
    expect(capacityAllocator.snapshot()).toEqual(capacityBefore);

    const countAllocator = new BoundedIntervalAllocator({
      maxAllocations: 2,
      ranges: [{ size: 64, start: 0 }],
    });
    const first = countAllocator.allocate(1);
    countAllocator.allocate(1);
    const countBefore = countAllocator.snapshot();
    expect(() => countAllocator.allocate(1)).toThrow(
      IntervalAllocationLimitError,
    );
    expect(countAllocator.snapshot()).toEqual(countBefore);

    first.release();
    expect(countAllocator.allocate(1).start).toBe(0);
  });

  it("returns immutable snapshots with address-ordered allocated and free extents", (): void => {
    const allocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [
        { size: 96, start: 128 },
        { size: 64, start: 0 },
      ],
    });
    allocator.allocate(32);
    const snapshot = allocator.snapshot();

    expect(snapshot.allocatedExtents).toEqual([
      {
        endExclusive: 32,
        requestedSize: 32,
        size: 32,
        start: 0,
      },
    ]);
    expect(snapshot.freeExtents).toEqual([
      { endExclusive: 64, size: 32, start: 32 },
      { endExclusive: 224, size: 96, start: 128 },
    ]);
    expect(snapshot.largestFreeBlockBytes).toBe(96);
    expect(snapshot.largestFreeExtent).toEqual({
      endExclusive: 224,
      size: 96,
      start: 128,
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.allocatedExtents)).toBe(true);
    expect(Object.isFrozen(snapshot.allocatedExtents[0])).toBe(true);
    expect(Object.isFrozen(snapshot.freeExtents)).toBe(true);
    expect(Object.isFrozen(snapshot.freeExtents[0])).toBe(true);
  });

  it("rejects malformed and overflowing allocation sizes without changing state", (): void => {
    const allocator = new BoundedIntervalAllocator({
      alignment: 16,
      ranges: [{ size: 64, start: 0 }],
    });
    const before = allocator.snapshot();
    for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => allocator.allocate(size)).toThrow(RangeError);
      expect(allocator.snapshot()).toEqual(before);
    }
    expect(() => allocator.allocate(Number.MAX_SAFE_INTEGER)).toThrow(
      /aligned value.*safe integer/u,
    );
    expect(allocator.snapshot()).toEqual(before);
  });

  it("rejects malformed ranges, overlapping ranges, and unsafe limits", (): void => {
    expect(() => new BoundedIntervalAllocator({ ranges: [] })).toThrow(
      /at least one range/u,
    );
    expect(
      () =>
        new BoundedIntervalAllocator({
          alignment: 16,
          ranges: [{ size: 15, start: 0 }],
        }),
    ).toThrow(/alignment-sized/u);
    expect(
      () =>
        new BoundedIntervalAllocator({
          ranges: [{ size: 1, start: -1 }],
        }),
    ).toThrow(/non-negative safe integer/u);
    expect(
      () =>
        new BoundedIntervalAllocator({
          ranges: [{ size: 0, start: 0 }],
        }),
    ).toThrow(/positive safe integer/u);
    expect(
      () =>
        new BoundedIntervalAllocator({
          ranges: [{ size: 1, start: Number.MAX_SAFE_INTEGER }],
        }),
    ).toThrow(/safe integer/u);
    expect(
      () =>
        new BoundedIntervalAllocator({
          ranges: [
            { size: 32, start: 0 },
            { size: 32, start: 16 },
          ],
        }),
    ).toThrow(/must not overlap/u);
    expect(
      () =>
        new BoundedIntervalAllocator({
          alignment: 0,
          ranges: [{ size: 32, start: 0 }],
        }),
    ).toThrow(/alignment.*positive safe integer/u);
    expect(
      () =>
        new BoundedIntervalAllocator({
          maxAllocations: MAX_INTERVAL_ALLOCATIONS + 1,
          ranges: [{ size: 32, start: 0 }],
        }),
    ).toThrow(/must not exceed/u);
    expect(
      () =>
        new BoundedIntervalAllocator({
          ranges: Array.from(
            { length: MAX_INTERVAL_RANGES + 1 },
            (_, index) => ({
              size: 1,
              start: index * 2,
            }),
          ),
        }),
    ).toThrow(/must not contain more/u);
  });
});
