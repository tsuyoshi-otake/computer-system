import { describe, expect, it } from "vitest";

import {
  isInitialWebTerminalAccessAllowed,
  nextWebTerminalRangeAccess,
  type WebTerminalRangeAccess,
} from "../../src/application/terminal/webTerminalRange.js";

describe("Web terminal range policy", (): void => {
  it("admits an initial session through the exact three-block boundary", (): void => {
    expect(initial(9)).toBe(true);
    expect(initial(9.000_001)).toBe(false);
    expect(initial(8, false)).toBe(false);
  });

  it("pauses outside three blocks and resumes at 2.75 blocks", (): void => {
    expect(next("in_range", 9)).toBe("in_range");
    expect(next("in_range", 9.000_001)).toBe("out_of_range");
    expect(next("out_of_range", 2.75 ** 2 + 0.000_001)).toBe("out_of_range");
    expect(next("out_of_range", 2.75 ** 2)).toBe("in_range");
  });

  it("keeps the current state inside the dead band", (): void => {
    const deadBandDistance = 2.9 ** 2;
    expect(next("in_range", deadBandDistance)).toBe("in_range");
    expect(next("out_of_range", deadBandDistance)).toBe("out_of_range");
  });

  it("fails closed across dimensions and permits explicit managed debug", (): void => {
    expect(next("in_range", 0, false)).toBe("out_of_range");
    expect(
      nextWebTerminalRangeAccess({
        currentAccess: "out_of_range",
        rangeCheckDisabledForDebug: true,
        sameDimension: false,
        squaredDistance: Number.NaN,
      }),
    ).toBe("in_range");
  });
});

function initial(squaredDistance: number, sameDimension = true): boolean {
  return isInitialWebTerminalAccessAllowed({ sameDimension, squaredDistance });
}

function next(
  currentAccess: "in_range" | "out_of_range",
  squaredDistance: number,
  sameDimension = true,
): WebTerminalRangeAccess {
  return nextWebTerminalRangeAccess({
    currentAccess,
    sameDimension,
    squaredDistance,
  });
}
