export interface ComputerHardwareProfile {
  readonly clockHz: number;
  readonly memoryBytes: number;
}

export const defaultComputerHardware: ComputerHardwareProfile = {
  clockHz: 20_000,
  memoryBytes: 1_048_576,
};

const maximumClockHz = 2_000_000;
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

export function cyclesPerTick(clockHz: number, ticksPerSecond: number): number {
  if (!Number.isSafeInteger(clockHz) || clockHz < 1)
    throw new RangeError("CPU clock must be a positive integer");
  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 1)
    throw new RangeError("Tick rate must be a positive integer");
  return Math.max(1, Math.floor(clockHz / ticksPerSecond));
}
