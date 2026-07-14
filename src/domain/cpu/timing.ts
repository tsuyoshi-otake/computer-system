export const computerNominalClockHz = 33_000_000;

export function cpuCyclesPerTick(
  clockHz: number,
  ticksPerSecond: number,
): number {
  if (!Number.isSafeInteger(clockHz) || clockHz < 1)
    throw new RangeError("CPU clock must be a positive integer");
  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond < 1)
    throw new RangeError("Tick rate must be a positive integer");
  return Math.max(1, Math.floor(clockHz / ticksPerSecond));
}

export function cpuCyclesToMicroseconds(
  cpuCycles: number,
  clockHz = computerNominalClockHz,
): number {
  if (!Number.isSafeInteger(cpuCycles) || cpuCycles < 0)
    throw new RangeError("CPU cycles must be a non-negative safe integer");
  if (!Number.isSafeInteger(clockHz) || clockHz < 1)
    throw new RangeError("CPU clock must be a positive integer");
  return (cpuCycles * 1_000_000) / clockHz;
}
