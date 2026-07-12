import { describe, expect, it } from "vitest";

import { requireDigitalComputerOutputs } from "../../src/phase0/redstoneOutputConstraints.js";

describe("computer redstone output constraints", (): void => {
  it("accepts independent digital levels on all six sides", (): void => {
    expect(() =>
      requireDigitalComputerOutputs({
        back: 0,
        bottom: 15,
        front: 0,
        left: 15,
        right: 15,
        top: 0,
      }),
    ).not.toThrow();
  });

  it("rejects an independent analog level with the supported fallback", (): void => {
    expect(() =>
      requireDigitalComputerOutputs({
        back: 0,
        bottom: 0,
        front: 0,
        left: 4,
        right: 12,
        top: 0,
      }),
    ).toThrow(/use an oriented Redstone Interface/u);
  });

  it("rejects levels outside the redstone range", (): void => {
    expect(() =>
      requireDigitalComputerOutputs({
        back: 0,
        bottom: 0,
        front: 0,
        left: 0,
        right: 16,
        top: 0,
      }),
    ).toThrow(RangeError);
  });
});
