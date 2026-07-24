import {
  cpuModelSpecification,
  type CpuModel,
  type CpuMicroarchitectureSpecification,
} from "./models.js";

export interface CpuMicroarchitectureStats {
  readonly busTransfers: number;
  readonly instructionFetches: number;
  readonly l1Hits: number;
  readonly l1Misses: number;
  readonly l2Hits: number;
  readonly l2Misses: number;
  readonly pipelineFlushes: number;
  readonly unalignedAccesses: number;
}

export interface CpuMemoryHierarchyOptions {
  /**
   * Host observability only. Cache contents, replacement, and modeled latency
   * remain authoritative when counter collection is disabled.
   */
  readonly collectMicroarchitectureStats?: boolean;
}

type MemoryAccessKind = "read" | "write";

const cacheWays = 4;
const bytesPerDword = 4;
const bytesPerDwordShift = 2;
const dwordAlignmentMask = bytesPerDword - 1;
const word16AlignmentMask = 1;
const instructionCodeBase = 0x1000_0000;

/**
 * Fixed-capacity, deterministic memory hierarchy with O(1) access cost.
 * Process callers validate integral data addresses before admission, and the
 * bounded synthetic instruction range also fits in one unsigned 32-bit word.
 */
export class CpuMemoryHierarchy {
  readonly specification: CpuMicroarchitectureSpecification;
  private readonly l1: SetAssociativeCache | undefined;
  private readonly l2: SetAssociativeCache | undefined;
  private readonly cacheLineShift: number;
  private readonly cacheLineMask: number;
  private readonly cacheLineLastDwordStart: number;
  private readonly cacheLineDwordTransfers: number;
  private readonly instructionLineTransfers: number;
  private readonly collectMicroarchitectureStats: boolean;
  private instructionFetchesValue = 0;
  private l1HitsValue = 0;
  private l1MissesValue = 0;
  private l2HitsValue = 0;
  private l2MissesValue = 0;
  private busTransfersValue = 0;
  private unalignedAccessesValue = 0;
  private pipelineFlushesValue = 0;
  private prefetched386Line = -1;

  constructor(
    readonly cpuModel: CpuModel,
    options: CpuMemoryHierarchyOptions = {},
  ) {
    this.collectMicroarchitectureStats =
      options.collectMicroarchitectureStats ?? true;
    if (typeof this.collectMicroarchitectureStats !== "boolean")
      throw new TypeError(
        "collectMicroarchitectureStats must be a boolean when provided",
      );
    this.specification = cpuModelSpecification(cpuModel).microarchitecture;
    this.cacheLineShift = requireCacheLineShift(
      this.specification.cacheLineBytes,
    );
    this.cacheLineMask = this.specification.cacheLineBytes - 1;
    this.cacheLineLastDwordStart =
      this.specification.cacheLineBytes - bytesPerDword;
    this.cacheLineDwordTransfers =
      this.specification.cacheLineBytes >>> bytesPerDwordShift;
    this.instructionLineTransfers =
      this.specification.cacheLineBytes >>>
      (this.cpuModel === "cs386sx" ? 1 : bytesPerDwordShift);
    this.l1 = createCache(
      this.specification.l1CacheBytes,
      this.specification.cacheLineBytes,
    );
    this.l2 = createCache(
      this.specification.externalCacheBytes,
      this.specification.cacheLineBytes,
    );
  }

  get statsEnabled(): boolean {
    return this.collectMicroarchitectureStats;
  }

  get stats(): CpuMicroarchitectureStats {
    if (!this.collectMicroarchitectureStats)
      throw new Error(
        "CPU microarchitecture statistics collection is disabled",
      );
    return {
      busTransfers: this.busTransfersValue,
      instructionFetches: this.instructionFetchesValue,
      l1Hits: this.l1HitsValue,
      l1Misses: this.l1MissesValue,
      l2Hits: this.l2HitsValue,
      l2Misses: this.l2MissesValue,
      pipelineFlushes: this.pipelineFlushesValue,
      unalignedAccesses: this.unalignedAccessesValue,
    };
  }

  fetchInstruction(instructionIndex: number): number {
    const collectStats = this.collectMicroarchitectureStats;
    if (collectStats) this.instructionFetchesValue += 1;
    const address = instructionCodeBase + instructionIndex * bytesPerDword;
    if (this.l1 === undefined) {
      const line = address >>> this.cacheLineShift;
      if (line !== this.prefetched386Line) {
        this.prefetched386Line = line;
        if (collectStats)
          this.busTransfersValue += this.instructionLineTransfers;
      }
      return 0;
    }
    return this.accessCachedLine(address);
  }

  accessData(address: number, kind: MemoryAccessKind): number {
    const collectStats = this.collectMicroarchitectureStats;
    if (this.cpuModel === "cs386sx") {
      const transfers = (address & word16AlignmentMask) === 0 ? 2 : 3;
      if (collectStats) {
        this.busTransfersValue += transfers;
        if (transfers === 3) this.unalignedAccessesValue += 1;
      }
      return transfers * this.specification.mainMemoryTransferCycles;
    }

    const unaligned = (address & dwordAlignmentMask) !== 0;
    if (collectStats && unaligned) this.unalignedAccessesValue += 1;
    let cycles = unaligned ? 1 : 0;
    cycles += this.accessCachedLine(address);
    if ((address & this.cacheLineMask) > this.cacheLineLastDwordStart) {
      cycles += this.accessCachedLine(address + bytesPerDword - 1);
    }
    if (kind === "write") {
      const transfers = unaligned ? 2 : 1;
      if (collectStats) this.busTransfersValue += transfers;
      cycles += transfers * this.specification.mainMemoryTransferCycles;
    }
    return cycles;
  }

  recordControlTransfer(taken: boolean): void {
    if (!taken) return;
    if (this.collectMicroarchitectureStats) this.pipelineFlushesValue += 1;
    if (this.cpuModel === "cs386sx") this.prefetched386Line = -1;
  }

  private accessCachedLine(address: number): number {
    const l1 = this.l1;
    if (l1 === undefined) return 0;
    const collectStats = this.collectMicroarchitectureStats;
    if (l1.access(address)) {
      if (collectStats) this.l1HitsValue += 1;
      return 0;
    }
    if (collectStats) this.l1MissesValue += 1;

    const lineTransfers = this.cacheLineDwordTransfers;
    if (this.l2 !== undefined) {
      if (this.l2.access(address)) {
        if (collectStats) {
          this.l2HitsValue += 1;
          this.busTransfersValue += lineTransfers;
        }
        return lineTransfers * 2;
      }
      if (collectStats) this.l2MissesValue += 1;
    }
    if (collectStats) this.busTransfersValue += lineTransfers;
    return lineTransfers * this.specification.mainMemoryTransferCycles;
  }
}

class SetAssociativeCache {
  private readonly tags: Int32Array;
  private readonly recency: Uint32Array;
  private readonly mostRecentIndexBySet: Int32Array;
  private readonly setMask: number;
  private readonly setShift: number;
  private clock = 0;
  private mostRecentLine = -1;
  private mostRecentIndex = -1;

  constructor(
    setCount: number,
    private readonly lineShift: number,
  ) {
    this.setShift = requirePowerOfTwoShift(setCount, "cache set count");
    this.setMask = setCount - 1;
    this.tags = new Int32Array(setCount * cacheWays);
    this.tags.fill(-1);
    this.recency = new Uint32Array(this.tags.length);
    this.mostRecentIndexBySet = new Int32Array(setCount);
    this.mostRecentIndexBySet.fill(-1);
  }

  access(address: number): boolean {
    const line = address >>> this.lineShift;
    this.clock += 1;
    const mostRecentIndex = this.mostRecentIndex;
    if (mostRecentIndex >= 0 && line === this.mostRecentLine) {
      this.recency[mostRecentIndex] = this.clock;
      return true;
    }

    const set = line & this.setMask;
    const tag = line >>> this.setShift;
    const base = set * cacheWays;
    const setMostRecentIndex = this.mostRecentIndexBySet[set]!;
    if (setMostRecentIndex >= 0 && this.tags[setMostRecentIndex] === tag) {
      this.recency[setMostRecentIndex] = this.clock;
      this.mostRecentLine = line;
      this.mostRecentIndex = setMostRecentIndex;
      return true;
    }
    let replacement = base;
    let oldest = Number.MAX_SAFE_INTEGER;
    for (let way = 0; way < cacheWays; way += 1) {
      const index = base + way;
      if (this.tags[index] === tag) {
        this.recency[index] = this.clock;
        this.mostRecentIndexBySet[set] = index;
        this.mostRecentLine = line;
        this.mostRecentIndex = index;
        return true;
      }
      if (this.tags[index] === -1) replacement = index;
      else if (this.recency[index]! < oldest && this.tags[replacement] !== -1) {
        oldest = this.recency[index]!;
        replacement = index;
      }
    }
    this.tags[replacement] = tag;
    this.recency[replacement] = this.clock;
    this.mostRecentIndexBySet[set] = replacement;
    this.mostRecentLine = line;
    this.mostRecentIndex = replacement;
    return false;
  }
}

/**
 * Creates one validated cache geometry. Exported as the narrow geometry
 * boundary used by host tests; production ownership remains CpuMemoryHierarchy.
 */
export function createCache(
  cacheBytes: number,
  lineBytes: number,
): SetAssociativeCache | undefined {
  const lineShift = requireCacheLineShift(lineBytes);
  if (!Number.isSafeInteger(cacheBytes) || cacheBytes < 0)
    throw new RangeError("cache byte capacity must be a non-negative integer");
  if (cacheBytes === 0) return undefined;
  const setCount = cacheBytes / (lineBytes * cacheWays);
  if (!Number.isSafeInteger(setCount) || setCount <= 0)
    throw new RangeError(
      "cache byte capacity must contain a whole positive number of four-way sets",
    );
  return new SetAssociativeCache(setCount, lineShift);
}

function requireCacheLineShift(lineBytes: number): number {
  const shift = requirePowerOfTwoShift(lineBytes, "cache line byte count");
  if (shift < bytesPerDwordShift)
    throw new RangeError("cache lines must contain at least one dword");
  return shift;
}

function requirePowerOfTwoShift(value: number, name: string): number {
  const shift = Math.log2(value);
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    !Number.isInteger(shift) ||
    shift > 31
  )
    throw new RangeError(
      `${name} must be a positive power of two no larger than 2^31`,
    );
  return shift;
}
