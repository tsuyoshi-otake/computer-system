export type RedstoneSide =
  "back" | "bottom" | "front" | "left" | "right" | "top";

export type ComputerOutputLevels = Readonly<Record<RedstoneSide, number>>;

export function requireDigitalComputerOutputs(
  levels: ComputerOutputLevels,
): void {
  for (const [side, level] of Object.entries(levels)) {
    if (!Number.isInteger(level) || level < 0 || level > 15) {
      throw new RangeError(
        `Redstone output ${side} must be an integer from 0 to 15.`,
      );
    }
    if (level !== 0 && level !== 15) {
      throw new Error(
        `Computer output ${side} cannot produce independent analog level ${level}; use an oriented Redstone Interface.`,
      );
    }
  }
}
