import { describe, expect, it } from "vitest";

import {
  RedstoneState,
  redstoneSides,
} from "../../src/domain/redstone/redstoneState.js";

describe("RedstoneState", (): void => {
  it("tracks six independent analog inputs and digital outputs", (): void => {
    const state = new RedstoneState();
    redstoneSides.forEach((side, index) => {
      expect(state.setInput(side, (index % 15) + 1).changed).toBe(true);
      state.setOutput(side, true);
    });
    expect(state.outputMask).toBe(63);
    expect(state.getAnalogInput("left")).toBe(6);
    expect(state.setInput("left", 6).changed).toBe(false);
    state.setOutput("right", false);
    expect(state.outputMask).toBe(61);
  });

  it("rejects invalid input power and output masks", (): void => {
    const state = new RedstoneState();
    expect(() => state.setInput("front", 16)).toThrow(/0 to 15/u);
    expect(() => state.setOutputMask(64)).toThrow(/0 and 63/u);
  });
});
