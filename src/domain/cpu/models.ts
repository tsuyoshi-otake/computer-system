export const cpuModelIds = ["cs386sx", "cs486dx", "cs486dx2"] as const;

export type CpuModel = (typeof cpuModelIds)[number];

export interface CpuModelSpecification {
  readonly addressBits: number;
  readonly dataBusBits: number;
  readonly displayName: string;
  readonly id: CpuModel;
  readonly maximumMemoryBytes: number;
  readonly nominalClockHz: number;
  readonly microarchitecture: CpuMicroarchitectureSpecification;
  readonly runtimeName: string;
  readonly supportsMicroPython: boolean;
}

export interface CpuMicroarchitectureSpecification {
  readonly branchPrediction: "none";
  readonly cacheLineBytes: 16;
  readonly externalCacheBytes: 0 | 262_144;
  readonly l1CacheBytes: 0 | 8_192;
  readonly mainMemoryTransferCycles: number;
  readonly memoryModules: string;
  readonly pipeline: "five-stage" | "prefetch-overlap";
}

const specifications: Readonly<Record<CpuModel, CpuModelSpecification>> = {
  cs386sx: {
    addressBits: 24,
    dataBusBits: 16,
    displayName: "Computer System 386SX",
    id: "cs386sx",
    maximumMemoryBytes: 16 * 1_048_576,
    nominalClockHz: 16_000_000,
    microarchitecture: {
      branchPrediction: "none",
      cacheLineBytes: 16,
      externalCacheBytes: 0,
      l1CacheBytes: 0,
      mainMemoryTransferCycles: 2,
      memoryModules: "2 x 1 MiB 30-pin SIMM DRAM",
      pipeline: "prefetch-overlap",
    },
    runtimeName: "CS386SX",
    supportsMicroPython: false,
  },
  cs486dx: {
    addressBits: 32,
    dataBusBits: 32,
    displayName: "Computer System 486DX",
    id: "cs486dx",
    maximumMemoryBytes: 64 * 1_048_576,
    nominalClockHz: 33_000_000,
    microarchitecture: {
      branchPrediction: "none",
      cacheLineBytes: 16,
      externalCacheBytes: 0,
      l1CacheBytes: 8_192,
      mainMemoryTransferCycles: 3,
      memoryModules: "4 x 512 KiB 30-pin SIMM DRAM",
      pipeline: "five-stage",
    },
    runtimeName: "CS486DX",
    supportsMicroPython: true,
  },
  cs486dx2: {
    addressBits: 32,
    dataBusBits: 32,
    displayName: "Computer System 486DX2",
    id: "cs486dx2",
    maximumMemoryBytes: 64 * 1_048_576,
    nominalClockHz: 66_000_000,
    microarchitecture: {
      branchPrediction: "none",
      cacheLineBytes: 16,
      externalCacheBytes: 262_144,
      l1CacheBytes: 8_192,
      mainMemoryTransferCycles: 6,
      memoryModules: "2 x 4 MiB 72-pin SIMM DRAM",
      pipeline: "five-stage",
    },
    runtimeName: "CS486DX2",
    supportsMicroPython: true,
  },
};

export const defaultCpuModel: CpuModel = "cs486dx";

export function cpuModelSpecification(model: CpuModel): CpuModelSpecification {
  return specifications[model];
}

export function isCpuModel(value: unknown): value is CpuModel {
  return typeof value === "string" && cpuModelIds.includes(value as CpuModel);
}

export function requireCpuModel(value: unknown): CpuModel {
  if (!isCpuModel(value)) throw new TypeError("unsupported CPU model");
  return value;
}
