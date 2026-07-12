import { describe, expect, it } from "vitest";

import { compileSource } from "../../src/application/runtime/compiler.js";
import {
  RoundRobinScheduler,
  type SchedulerLimits,
} from "../../src/application/runtime/scheduler.js";
import { StackVm } from "../../src/application/runtime/vm.js";
import { nativeFunction } from "../../src/domain/runtime/value.js";

const limits: SchedulerLimits = {
  eventCapacity: 8,
  timerCapacity: 8,
  instructionsPerComputer: 5,
  instructionsPerTick: 100,
};

describe("round-robin scheduler", (): void => {
  it("gives 20 CPU-bound computers equal deterministic slices", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    for (let id = 0; id < 20; id += 1)
      scheduler.add(id, vm("while True:\n    pass\n"));

    let result = scheduler.runTick();
    for (let tick = 1; tick < 1_200; tick += 1) result = scheduler.runTick();

    expect(result.tick).toBe(1_200);
    expect(result.computers).toHaveLength(20);
    expect(
      new Set(
        result.computers.map(
          ({ executedInstructions }) => executedInstructions,
        ),
      ),
    ).toEqual(new Set([6_000]));
    expect(result.computers.every(({ state }) => state.kind === "ready")).toBe(
      true,
    );
  });

  it("rotates the first slice when the global budget is smaller than runnable demand", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      instructionsPerTick: 5,
    });
    for (let id = 0; id < 4; id += 1)
      scheduler.add(id, vm("while True:\n    pass\n"));

    let result = scheduler.runTick();
    for (let tick = 1; tick < 8; tick += 1) result = scheduler.runTick();

    expect(
      result.computers.map(({ executedInstructions }) => executedInstructions),
    ).toEqual([10, 10, 10, 10]);
  });

  it("resumes sleep and filtered event waits exactly once", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    const machine = vm("slept = sleep()\nevent = wait_key()\n", {
      sleep: nativeFunction("sleep", () => ({ kind: "sleep", ticks: 2 })),
      wait_key: nativeFunction("wait_key", () => ({
        kind: "wait_event",
        filter: "key",
      })),
    });
    scheduler.add(7, machine);

    scheduler.runTick();
    expect(scheduler.state(7)).toEqual({ kind: "sleeping", wakeTick: 3 });
    scheduler.queueEvent(7, "mouse", 1);
    scheduler.queueEvent(7, "key", 42);
    scheduler.runTick();
    expect(scheduler.state(7).kind).toBe("sleeping");
    scheduler.runTick();
    expect(scheduler.state(7)).toEqual({
      kind: "waiting_event",
      filter: "key",
    });
    scheduler.runTick();
    expect(scheduler.state(7)).toEqual({ kind: "completed", value: null });
    expect(machine.globals.get("slept")).toBe(null);
    expect(machine.globals.get("event")).toEqual({
      kind: "tuple",
      values: ["key", 42],
    });
    expect(() => scheduler.queueEvent(7, "after", 1)).not.toThrow();
  });

  it("delivers timers as bounded events", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    const machine = vm("event = wait_timer()\n", {
      wait_timer: nativeFunction("wait_timer", () => ({
        kind: "wait_event",
        filter: "timer",
      })),
    });
    scheduler.add(3, machine);
    const timerId = scheduler.startTimer(3, 2);

    scheduler.runTick();
    scheduler.runTick();

    expect(machine.globals.get("event")).toEqual({
      kind: "tuple",
      values: ["timer", timerId],
    });
    expect(scheduler.state(3)).toEqual({ kind: "completed", value: null });
  });

  it("isolates crashes and keeps other computers progressing", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    scheduler.add(1, vm("missing_name\n"));
    scheduler.add(2, vm("while True:\n    pass\n"));

    const result = scheduler.runTick();

    expect(result.computers[0]!.state.kind).toBe("crashed");
    expect(result.computers[1]).toMatchObject({
      state: { kind: "ready" },
      executedInstructions: 5,
    });
  });
});

function vm(
  source: string,
  globals: Readonly<Record<string, ReturnType<typeof nativeFunction>>> = {},
): StackVm {
  return new StackVm({
    code: compileSource(source),
    globals: new Map(Object.entries(globals)),
  });
}
