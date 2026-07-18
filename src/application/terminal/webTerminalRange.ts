export type WebTerminalRangeAccess = "in_range" | "out_of_range";

export const webTerminalExitRangeSquared = 3 * 3;
export const webTerminalResumeRangeSquared = 2.75 * 2.75;

export function isInitialWebTerminalAccessAllowed(options: {
  readonly rangeCheckDisabledForDebug?: boolean;
  readonly sameDimension: boolean;
  readonly squaredDistance: number;
}): boolean {
  if (options.rangeCheckDisabledForDebug === true) return true;
  return (
    options.sameDimension &&
    isSquaredDistance(options.squaredDistance) &&
    options.squaredDistance <= webTerminalExitRangeSquared
  );
}

export function nextWebTerminalRangeAccess(options: {
  readonly currentAccess: WebTerminalRangeAccess;
  readonly rangeCheckDisabledForDebug?: boolean;
  readonly sameDimension: boolean;
  readonly squaredDistance: number;
}): WebTerminalRangeAccess {
  if (options.rangeCheckDisabledForDebug === true) return "in_range";
  if (!options.sameDimension || !isSquaredDistance(options.squaredDistance)) {
    return "out_of_range";
  }
  if (options.currentAccess === "in_range") {
    return options.squaredDistance <= webTerminalExitRangeSquared
      ? "in_range"
      : "out_of_range";
  }
  return options.squaredDistance <= webTerminalResumeRangeSquared
    ? "in_range"
    : "out_of_range";
}

function isSquaredDistance(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}
