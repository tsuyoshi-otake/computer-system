import { computerNominalClockHz, cpuCyclesPerTick } from "../cpu/timing.js";

export interface ComputerHardwareProfile {
  readonly clockHz: number;
  readonly memoryBytes: number;
}

export const defaultComputerHardware: ComputerHardwareProfile = {
  clockHz: computerNominalClockHz,
  memoryBytes: 1_048_576,
};

const maximumClockHz = 100_000_000;
const maximumMemoryBytes = 64 * 1_048_576;
const minimumMemoryBytes = 65_536;

export function requireComputerHardware(
  hardware: ComputerHardwareProfile,
): ComputerHardwareProfile {
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
    hardware.memoryBytes > maximumMemoryBytes
  ) {
    throw new RangeError(
      `Memory must be between ${String(minimumMemoryBytes)} and ${String(maximumMemoryBytes)} bytes`,
    );
  }
  return { ...hardware };
}

export function hardwareCpuCyclesPerTick(
  clockHz: number,
  ticksPerSecond: number,
): number {
  return cpuCyclesPerTick(clockHz, ticksPerSecond);
}
