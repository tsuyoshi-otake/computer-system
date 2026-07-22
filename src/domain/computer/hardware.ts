import { computerNominalClockHz, cpuCyclesPerTick } from "../cpu/timing.js";
import {
  cpuModelSpecification,
  defaultCpuModel,
  requireCpuModel,
  type CpuModel,
} from "../cpu/models.js";
import type { ComputerFamily } from "./identity.js";

export interface ComputerHardwareProfile {
  readonly clockHz: number;
  readonly cpuModel: CpuModel;
  readonly memoryBytes: number;
}

export interface ComputerHardwareSnapshot {
  readonly clockHz: number;
  readonly cpuModel?: CpuModel;
  readonly memoryBytes: number;
}

export const defaultComputerHardware: ComputerHardwareProfile = {
  clockHz: computerNominalClockHz,
  cpuModel: defaultCpuModel,
  memoryBytes: 2 * 1_048_576,
};

export const advancedComputerHardware: ComputerHardwareProfile = {
  clockHz: cpuModelSpecification("cs486dx2").nominalClockHz,
  cpuModel: "cs486dx2",
  memoryBytes: 8 * 1_048_576,
};

export const portableComputerHardware: ComputerHardwareProfile = {
  clockHz: cpuModelSpecification("cs386sx").nominalClockHz,
  cpuModel: "cs386sx",
  memoryBytes: 2 * 1_048_576,
};

export function defaultComputerHardwareForFamily(
  family: ComputerFamily,
): ComputerHardwareProfile {
  return family === "advanced"
    ? advancedComputerHardware
    : defaultComputerHardware;
}

const maximumClockHz = 100_000_000;
const minimumMemoryBytes = 65_536;

export function requireComputerHardware(
  hardware: ComputerHardwareProfile,
): ComputerHardwareProfile {
  const cpuModel = requireCpuModel(hardware.cpuModel);
  if (
    !Number.isSafeInteger(hardware.clockHz) ||
    hardware.clockHz < 1 ||
    hardware.clockHz > maximumClockHz
  ) {
    throw new RangeError(
      `CPU clock must be between 1 and ${String(maximumClockHz)} Hz`,
    );
  }
  if (
    !Number.isSafeInteger(hardware.memoryBytes) ||
    hardware.memoryBytes < minimumMemoryBytes ||
    hardware.memoryBytes > cpuModelSpecification(cpuModel).maximumMemoryBytes
  ) {
    throw new RangeError(
      `Memory must be between ${String(minimumMemoryBytes)} and ${String(cpuModelSpecification(cpuModel).maximumMemoryBytes)} bytes for ${cpuModel}`,
    );
  }
  return { ...hardware, cpuModel };
}

export function restoreComputerHardware(
  hardware: ComputerHardwareSnapshot | undefined,
): ComputerHardwareProfile {
  return requireComputerHardware({
    ...(hardware ?? defaultComputerHardware),
    cpuModel: hardware?.cpuModel ?? defaultCpuModel,
  });
}

export function hardwareCpuCyclesPerTick(
  clockHz: number,
  ticksPerSecond: number,
  realtimeDivisor = 1,
): number {
  if (!Number.isSafeInteger(realtimeDivisor) || realtimeDivisor < 1) {
    throw new RangeError("realtimeDivisor must be a positive integer");
  }
  return Math.max(
    1,
    Math.floor(cpuCyclesPerTick(clockHz, ticksPerSecond) / realtimeDivisor),
  );
}
