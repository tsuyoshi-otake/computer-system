const allocationHandleBrand: unique symbol = Symbol(
  "BoundedIntervalAllocation",
);

export const DEFAULT_MAX_INTERVAL_ALLOCATIONS = 128;
export const MAX_INTERVAL_ALLOCATIONS = 1_024;
export const MAX_INTERVAL_RANGES = 128;

export interface IntervalRangeInput {
  readonly size: number;
  readonly start: number;
}

export interface BoundedIntervalAllocatorOptions {
  readonly alignment?: number;
  readonly maxAllocations?: number;
  readonly ranges: readonly IntervalRangeInput[];
}

export interface IntervalExtentSnapshot {
  readonly endExclusive: number;
  readonly size: number;
  readonly start: number;
}

export interface AllocatedIntervalExtentSnapshot extends IntervalExtentSnapshot {
  readonly requestedSize: number;
}

export interface BoundedIntervalAllocatorSnapshot {
  readonly alignment: number;
  readonly allocatedBytes: number;
  readonly allocatedExtents: readonly AllocatedIntervalExtentSnapshot[];
  readonly allocationCount: number;
  readonly capacityBytes: number;
  readonly freeBytes: number;
  readonly freeExtents: readonly IntervalExtentSnapshot[];
  readonly largestFreeBlockBytes: number;
  readonly largestFreeExtent: IntervalExtentSnapshot | null;
  readonly maxAllocations: number;
}

export interface BoundedIntervalAllocation {
  readonly [allocationHandleBrand]: true;
  readonly endExclusive: number;
  readonly released: boolean;
  readonly requestedSize: number;
  readonly size: number;
  readonly start: number;
  release(): void;
}

interface MutableExtent {
  readonly endExclusive: number;
  readonly start: number;
}

interface AllocationRecord extends MutableExtent {
  readonly id: number;
  readonly requestedSize: number;
}

export class IntervalAllocationCapacityError extends Error {
  override readonly name = "IntervalAllocationCapacityError";

  constructor(
    readonly requestedSize: number,
    readonly alignedSize: number,
    readonly largestFreeBlockBytes: number,
  ) {
    super(
      `Unable to allocate ${String(requestedSize)} bytes (${String(alignedSize)} aligned): largest free block is ${String(largestFreeBlockBytes)} bytes`,
    );
  }
}

export class IntervalAllocationLimitError extends Error {
  override readonly name = "IntervalAllocationLimitError";

  constructor(readonly maxAllocations: number) {
    super(
      `Active allocation limit of ${String(maxAllocations)} has been reached`,
    );
  }
}

/**
 * Deterministic address allocation over one or more disjoint byte ranges.
 *
 * Input ranges are clipped inward to alignment boundaries and adjacent usable
 * ranges are coalesced. Allocation, release, and snapshot creation are O(N),
 * where N is bounded by MAX_INTERVAL_RANGES + MAX_INTERVAL_ALLOCATIONS.
 */
export class BoundedIntervalAllocator {
  readonly alignment: number;
  readonly capacityBytes: number;
  readonly maxAllocations: number;

  private readonly allocations = new Map<number, AllocationRecord>();
  private readonly allocatedByAddress: AllocationRecord[] = [];
  private freeExtents: MutableExtent[];
  private allocatedBytesValue = 0;
  private nextAllocationId = 1;

  constructor(options: BoundedIntervalAllocatorOptions) {
    this.alignment = options.alignment ?? 1;
    this.maxAllocations =
      options.maxAllocations ?? DEFAULT_MAX_INTERVAL_ALLOCATIONS;
    requirePositiveSafeInteger(this.alignment, "alignment");
    requirePositiveSafeInteger(this.maxAllocations, "maxAllocations");
    if (this.maxAllocations > MAX_INTERVAL_ALLOCATIONS) {
      throw new RangeError(
        `maxAllocations must not exceed ${String(MAX_INTERVAL_ALLOCATIONS)}`,
      );
    }
    if (options.ranges.length === 0) {
      throw new RangeError("ranges must contain at least one range");
    }
    if (options.ranges.length > MAX_INTERVAL_RANGES) {
      throw new RangeError(
        `ranges must not contain more than ${String(MAX_INTERVAL_RANGES)} entries`,
      );
    }

    const ranges = options.ranges
      .map((range, index) => validateRange(range, index))
      .sort(compareExtentsByStart);
    requireDisjointRanges(ranges);
    this.freeExtents = normalizeRanges(ranges, this.alignment);
    if (this.freeExtents.length === 0) {
      throw new RangeError(
        "ranges must contain at least one alignment-sized usable interval",
      );
    }
    this.capacityBytes = sumExtentBytes(this.freeExtents, "range capacity");
  }

  get allocatedBytes(): number {
    return this.allocatedBytesValue;
  }

  get allocationCount(): number {
    return this.allocations.size;
  }

  get freeBytes(): number {
    return this.capacityBytes - this.allocatedBytesValue;
  }

  allocate(requestedSize: number): BoundedIntervalAllocation {
    requirePositiveSafeInteger(requestedSize, "requestedSize");
    const alignedSize = alignUpChecked(
      requestedSize,
      this.alignment,
      "requestedSize",
    );
    if (this.allocations.size >= this.maxAllocations) {
      throw new IntervalAllocationLimitError(this.maxAllocations);
    }

    const freeIndex = this.freeExtents.findIndex(
      (extent) => extentSize(extent) >= alignedSize,
    );
    if (freeIndex < 0) {
      throw new IntervalAllocationCapacityError(
        requestedSize,
        alignedSize,
        largestExtentBytes(this.freeExtents),
      );
    }

    const freeExtent = this.freeExtents[freeIndex]!;
    const endExclusive = checkedAdd(
      freeExtent.start,
      alignedSize,
      "allocation end",
    );
    const id = this.nextAvailableAllocationId();
    const record: AllocationRecord = {
      endExclusive,
      id,
      requestedSize,
      start: freeExtent.start,
    };

    if (endExclusive === freeExtent.endExclusive) {
      this.freeExtents.splice(freeIndex, 1);
    } else {
      this.freeExtents[freeIndex] = {
        endExclusive: freeExtent.endExclusive,
        start: endExclusive,
      };
    }
    this.allocations.set(id, record);
    insertByAddress(this.allocatedByAddress, record);
    this.allocatedBytesValue += alignedSize;
    this.advanceAllocationId(id);

    return new IntervalAllocationHandle(record, () => this.release(id));
  }

  snapshot(): BoundedIntervalAllocatorSnapshot {
    const freeExtents = Object.freeze(
      this.freeExtents.map((extent) => freezeExtent(extent)),
    );
    const allocatedExtents = Object.freeze(
      this.allocatedByAddress.map((record) =>
        Object.freeze({
          endExclusive: record.endExclusive,
          requestedSize: record.requestedSize,
          size: extentSize(record),
          start: record.start,
        }),
      ),
    );
    let largestFreeExtent: IntervalExtentSnapshot | null = null;
    for (const extent of freeExtents) {
      if (largestFreeExtent === null || extent.size > largestFreeExtent.size) {
        largestFreeExtent = extent;
      }
    }
    return Object.freeze({
      alignment: this.alignment,
      allocatedBytes: this.allocatedBytesValue,
      allocatedExtents,
      allocationCount: this.allocations.size,
      capacityBytes: this.capacityBytes,
      freeBytes: this.freeBytes,
      freeExtents,
      largestFreeBlockBytes: largestFreeExtent?.size ?? 0,
      largestFreeExtent,
      maxAllocations: this.maxAllocations,
    });
  }

  private release(id: number): void {
    const record = this.allocations.get(id);
    if (record === undefined) {
      throw new Error("Interval allocation is already released");
    }

    const allocationIndex = this.allocatedByAddress.findIndex(
      (candidate) => candidate.id === id,
    );
    if (allocationIndex < 0) {
      throw new Error("Interval allocator index is inconsistent");
    }
    const freeInsertIndex = findInsertionIndex(this.freeExtents, record.start);
    const nextFreeExtents = this.freeExtents.slice();
    nextFreeExtents.splice(freeInsertIndex, 0, {
      endExclusive: record.endExclusive,
      start: record.start,
    });
    coalesceAt(nextFreeExtents, freeInsertIndex);

    this.freeExtents = nextFreeExtents;
    this.allocatedByAddress.splice(allocationIndex, 1);
    this.allocations.delete(id);
    this.allocatedBytesValue -= extentSize(record);
  }

  private nextAvailableAllocationId(): number {
    let candidate = this.nextAllocationId;
    for (let attempts = 0; attempts <= this.maxAllocations; attempts += 1) {
      if (!this.allocations.has(candidate)) return candidate;
      candidate = candidate === MAX_INTERVAL_ALLOCATIONS ? 1 : candidate + 1;
    }
    throw new Error("Interval allocation identifier space is exhausted");
  }

  private advanceAllocationId(id: number): void {
    this.nextAllocationId = id === MAX_INTERVAL_ALLOCATIONS ? 1 : id + 1;
  }
}

class IntervalAllocationHandle implements BoundedIntervalAllocation {
  readonly [allocationHandleBrand] = true as const;
  private releasedValue = false;

  constructor(
    private readonly record: AllocationRecord,
    private readonly releaseAllocation: () => void,
  ) {}

  get endExclusive(): number {
    return this.record.endExclusive;
  }

  get released(): boolean {
    return this.releasedValue;
  }

  get requestedSize(): number {
    return this.record.requestedSize;
  }

  get size(): number {
    return extentSize(this.record);
  }

  get start(): number {
    return this.record.start;
  }

  release(): void {
    if (this.releasedValue) {
      throw new Error("Interval allocation is already released");
    }
    this.releaseAllocation();
    this.releasedValue = true;
  }
}

function validateRange(
  range: IntervalRangeInput,
  index: number,
): MutableExtent {
  requireNonNegativeSafeInteger(range.start, `ranges[${String(index)}].start`);
  requirePositiveSafeInteger(range.size, `ranges[${String(index)}].size`);
  return {
    endExclusive: checkedAdd(
      range.start,
      range.size,
      `ranges[${String(index)}] end`,
    ),
    start: range.start,
  };
}

function requireDisjointRanges(ranges: readonly MutableExtent[]): void {
  for (let index = 1; index < ranges.length; index += 1) {
    const previous = ranges[index - 1]!;
    const current = ranges[index]!;
    if (current.start < previous.endExclusive) {
      throw new RangeError("ranges must not overlap");
    }
  }
}

function normalizeRanges(
  ranges: readonly MutableExtent[],
  alignment: number,
): MutableExtent[] {
  const normalized: MutableExtent[] = [];
  for (const range of ranges) {
    const alignedStart = alignStartWithinRange(range, alignment);
    const alignedEnd = range.endExclusive - (range.endExclusive % alignment);
    if (alignedStart === null || alignedStart >= alignedEnd) continue;
    const previous = normalized.at(-1);
    if (previous !== undefined && previous.endExclusive === alignedStart) {
      normalized[normalized.length - 1] = {
        endExclusive: alignedEnd,
        start: previous.start,
      };
    } else {
      normalized.push({ endExclusive: alignedEnd, start: alignedStart });
    }
  }
  return normalized;
}

function alignStartWithinRange(
  range: MutableExtent,
  alignment: number,
): number | null {
  const remainder = range.start % alignment;
  if (remainder === 0) return range.start;
  const delta = alignment - remainder;
  if (delta >= extentSize(range)) return null;
  return range.start + delta;
}

function alignUpChecked(
  value: number,
  alignment: number,
  name: string,
): number {
  const remainder = value % alignment;
  if (remainder === 0) return value;
  return checkedAdd(value, alignment - remainder, `${name} aligned value`);
}

function sumExtentBytes(
  extents: readonly MutableExtent[],
  name: string,
): number {
  let total = 0;
  for (const extent of extents) {
    total = checkedAdd(total, extentSize(extent), name);
  }
  return total;
}

function largestExtentBytes(extents: readonly MutableExtent[]): number {
  let largest = 0;
  for (const extent of extents) largest = Math.max(largest, extentSize(extent));
  return largest;
}

function freezeExtent(extent: MutableExtent): IntervalExtentSnapshot {
  return Object.freeze({
    endExclusive: extent.endExclusive,
    size: extentSize(extent),
    start: extent.start,
  });
}

function extentSize(extent: MutableExtent): number {
  return extent.endExclusive - extent.start;
}

function compareExtentsByStart(
  left: MutableExtent,
  right: MutableExtent,
): number {
  return left.start - right.start;
}

function insertByAddress(
  records: AllocationRecord[],
  record: AllocationRecord,
): void {
  records.splice(findInsertionIndex(records, record.start), 0, record);
}

function findInsertionIndex(
  extents: readonly MutableExtent[],
  start: number,
): number {
  let index = 0;
  while (index < extents.length && extents[index]!.start < start) index += 1;
  return index;
}

function coalesceAt(extents: MutableExtent[], insertedIndex: number): void {
  let index = insertedIndex;
  if (index > 0 && extents[index - 1]!.endExclusive === extents[index]!.start) {
    extents.splice(index - 1, 2, {
      endExclusive: extents[index]!.endExclusive,
      start: extents[index - 1]!.start,
    });
    index -= 1;
  }
  if (
    index + 1 < extents.length &&
    extents[index]!.endExclusive === extents[index + 1]!.start
  ) {
    extents.splice(index, 2, {
      endExclusive: extents[index + 1]!.endExclusive,
      start: extents[index]!.start,
    });
  }
}

function checkedAdd(left: number, right: number, name: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError(`${name} must be a safe integer`);
  }
  return result;
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}
