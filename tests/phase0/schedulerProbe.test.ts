import { describe, expect, it } from "vitest";

import { ProbeScheduler } from "../../src/phase0/schedulerProbe.js";

describe("ProbeScheduler", () => {
  it("shares a constrained global budget fairly across 20 computers", () => {
    const scheduler = new ProbeScheduler(
      Array.from({ length: 20 }, (_, id) => ({ id, instructions: null })),
      {
        globalInstructionsPerTick: 1_000,
        instructionsPerSlice: 200,
      },
    );

    for (let tick = 0; tick < 40; tick += 1) {
      expect(scheduler.runTick()).toBe(1_000);
    }

    const executions = scheduler
      .snapshot()
      .map((computer) => computer.executedInstructions);
    expect(new Set(executions)).toEqual(new Set([2_000]));
  });

  it("terminates finite work and leaves no accidental runnable state", () => {
    const scheduler = new ProbeScheduler(
      [
        { id: 1, instructions: 250 },
        { id: 2, instructions: 1 },
        { id: 3, instructions: 0 },
      ],
      {
        globalInstructionsPerTick: 500,
        instructionsPerSlice: 200,
      },
    );

    for (let tick = 0; tick < 3; tick += 1) {
      scheduler.runTick();
    }

    expect(scheduler.snapshot()).toEqual([
      {
        executedInstructions: 250,
        id: 1,
        remainingInstructions: 0,
        status: "terminated",
      },
      {
        executedInstructions: 1,
        id: 2,
        remainingInstructions: 0,
        status: "terminated",
      },
      {
        executedInstructions: 0,
        id: 3,
        remainingInstructions: 0,
        status: "terminated",
      },
    ]);
  });
});
