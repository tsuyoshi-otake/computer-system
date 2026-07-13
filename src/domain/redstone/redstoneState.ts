export const redstoneSides = [
  "bottom",
  "right",
  "front",
  "back",
  "top",
  "left",
] as const;

export type RedstoneSide = (typeof redstoneSides)[number];

export interface RedstoneInputChange {
  readonly changed: boolean;
  readonly side: RedstoneSide;
  readonly previousPower: number;
  readonly power: number;
}

export class RedstoneState {
  private readonly inputPower = new Map<RedstoneSide, number>();
  private outputMaskValue = 0;
  private revisionValue = 0;

  get outputMask(): number {
    return this.outputMaskValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  getInput(side: RedstoneSide): boolean {
    return this.getAnalogInput(side) > 0;
  }

  getAnalogInput(side: RedstoneSide): number {
    requireSide(side);
    return this.inputPower.get(side) ?? 0;
  }

  setInput(side: RedstoneSide, power: number): RedstoneInputChange {
    requireSide(side);
    requirePower(power);
    const previousPower = this.getAnalogInput(side);
    if (power === 0) this.inputPower.delete(side);
    else this.inputPower.set(side, power);
    return { changed: power !== previousPower, side, previousPower, power };
  }

  getOutput(side: RedstoneSide): boolean {
    return (this.outputMaskValue & sideBit(side)) !== 0;
  }

  setOutput(side: RedstoneSide, enabled: boolean): boolean {
    requireSide(side);
    if (typeof enabled !== "boolean") {
      throw new TypeError("Redstone output must be a boolean");
    }
    const previous = this.outputMaskValue;
    const bit = sideBit(side);
    this.outputMaskValue = enabled
      ? this.outputMaskValue | bit
      : this.outputMaskValue & ~bit;
    if (previous !== this.outputMaskValue) this.revisionValue += 1;
    return previous !== this.outputMaskValue;
  }

  setOutputMask(mask: number): void {
    if (!Number.isInteger(mask) || mask < 0 || mask > 63) {
      throw new RangeError("Redstone output mask must be between 0 and 63");
    }
    if (this.outputMaskValue === mask) return;
    this.outputMaskValue = mask;
    this.revisionValue += 1;
  }
}

export function isRedstoneSide(value: string): value is RedstoneSide {
  return redstoneSides.includes(value as RedstoneSide);
}

function requireSide(side: string): asserts side is RedstoneSide {
  if (!isRedstoneSide(side))
    throw new RangeError(`Unknown redstone side ${side}`);
}

function requirePower(power: number): void {
  if (!Number.isInteger(power) || power < 0 || power > 15) {
    throw new RangeError(
      "Redstone input power must be an integer from 0 to 15",
    );
  }
}

function sideBit(side: RedstoneSide): number {
  return 1 << redstoneSides.indexOf(side);
}
