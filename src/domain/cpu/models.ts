export const cpuModelIds = ["cs386sx", "cs486dx"] as const;

export type CpuModel = (typeof cpuModelIds)[number];

export interface CpuModelSpecification {
  readonly addressBits: number;
  readonly dataBusBits: number;
  readonly displayName: string;
  readonly id: CpuModel;
  readonly maximumMemoryBytes: number;
  readonly nominalClockHz: number;
  readonly runtimeName: string;
}

const specifications: Readonly<Record<CpuModel, CpuModelSpecification>> = {
  cs386sx: {
    addressBits: 24,
    dataBusBits: 16,
    displayName: "Computer System 386SX",
    id: "cs386sx",
    maximumMemoryBytes: 16 * 1_048_576,
    nominalClockHz: 16_000_000,
    runtimeName: "CS386SX",
  },
  cs486dx: {
    addressBits: 32,
    dataBusBits: 32,
    displayName: "Computer System 486DX",
    id: "cs486dx",
    maximumMemoryBytes: 64 * 1_048_576,
    nominalClockHz: 33_000_000,
    runtimeName: "CS486DX",
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
