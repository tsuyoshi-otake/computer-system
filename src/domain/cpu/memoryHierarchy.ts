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

type MemoryAccessKind = "read" | "write";

const cacheWays = 4;
const bytesPerDword = 4;
const instructionCodeBase = 0x1000_0000;

/** Fixed-capacity, deterministic memory hierarchy with O(1) access cost. */
export class CpuMemoryHierarchy {
  readonly specification: CpuMicroarchitectureSpecification;
  private readonly l1: SetAssociativeCache | undefined;
  private readonly l2: SetAssociativeCache | undefined;
  private instructionFetchesValue = 0;
  private l1HitsValue = 0;
  private l1MissesValue = 0;
  private l2HitsValue = 0;
  private l2MissesValue = 0;
  private busTransfersValue = 0;
  private unalignedAccessesValue = 0;
  private pipelineFlushesValue = 0;
  private prefetched386Line = -1;

  constructor(readonly cpuModel: CpuModel) {
    this.specification = cpuModelSpecification(cpuModel).microarchitecture;
    this.l1 = createCache(
      this.specification.l1CacheBytes,
      this.specification.cacheLineBytes,
    );
    this.l2 = createCache(
      this.specification.externalCacheBytes,
      this.specification.cacheLineBytes,
    );
  }

  get stats(): CpuMicroarchitectureStats {
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
    this.instructionFetchesValue += 1;
    const address = instructionCodeBase + instructionIndex * bytesPerDword;
    if (this.l1 === undefined) {
      const line = Math.floor(address / this.specification.cacheLineBytes);
      if (line !== this.prefetched386Line) {
        this.prefetched386Line = line;
        this.busTransfersValue +=
          this.specification.cacheLineBytes /
          (this.cpuModel === "cs386sx" ? 2 : bytesPerDword);
      }
      return 0;
    }
    return this.accessCachedLine(address);
  }

  accessData(address: number, kind: MemoryAccessKind): number {
    if (this.cpuModel === "cs386sx") {
      const transfers = address % 2 === 0 ? 2 : 3;
      this.busTransfersValue += transfers;
      if (transfers === 3) this.unalignedAccessesValue += 1;
      return (transfers - 2) * this.specification.mainMemoryTransferCycles;
    }

    const unaligned = address % bytesPerDword !== 0;
    if (unaligned) this.unalignedAccessesValue += 1;
    let cycles = unaligned ? 1 : 0;
    const firstLine = Math.floor(address / this.specification.cacheLineBytes);
    const lastLine = Math.floor(
      (address + bytesPerDword - 1) / this.specification.cacheLineBytes,
    );
    cycles += this.accessCachedLine(address);
    if (lastLine !== firstLine) {
      cycles += this.accessCachedLine(address + bytesPerDword - 1);
    }
    if (kind === "write") {
      const transfers = unaligned ? 2 : 1;
      this.busTransfersValue += transfers;
      cycles += transfers * this.specification.mainMemoryTransferCycles;
    }
    return cycles;
  }

  recordControlTransfer(taken: boolean): void {
    if (!taken) return;
    this.pipelineFlushesValue += 1;
    if (this.cpuModel === "cs386sx") this.prefetched386Line = -1;
  }

  private accessCachedLine(address: number): number {
    const l1 = this.l1;
    if (l1 === undefined) return 0;
    if (l1.access(address)) {
      this.l1HitsValue += 1;
      return 0;
    }
    this.l1MissesValue += 1;

    const lineTransfers = this.specification.cacheLineBytes / bytesPerDword;
    if (this.l2 !== undefined) {
      if (this.l2.access(address)) {
        this.l2HitsValue += 1;
        this.busTransfersValue += lineTransfers;
        return lineTransfers * 2;
      }
      this.l2MissesValue += 1;
    }
    this.busTransfersValue += lineTransfers;
    return lineTransfers * this.specification.mainMemoryTransferCycles;
  }
}

class SetAssociativeCache {
  private readonly tags: Int32Array;
  private readonly recency: Uint32Array;
  private clock = 0;

  constructor(
    private readonly setCount: number,
    private readonly lineBytes: number,
  ) {
    this.tags = new Int32Array(setCount * cacheWays);
    this.tags.fill(-1);
    this.recency = new Uint32Array(this.tags.length);
  }

  access(address: number): boolean {
    const line = Math.floor(address / this.lineBytes);
    const set = line % this.setCount;
    const tag = Math.floor(line / this.setCount);
    const base = set * cacheWays;
    this.clock += 1;
    let replacement = base;
    let oldest = Number.MAX_SAFE_INTEGER;
    for (let way = 0; way < cacheWays; way += 1) {
      const index = base + way;
      if (this.tags[index] === tag) {
        this.recency[index] = this.clock;
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
    return false;
  }
}

function createCache(
  cacheBytes: number,
  lineBytes: number,
): SetAssociativeCache | undefined {
  if (cacheBytes === 0) return undefined;
  return new SetAssociativeCache(cacheBytes / lineBytes / cacheWays, lineBytes);
}
