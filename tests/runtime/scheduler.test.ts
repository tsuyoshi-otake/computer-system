import { describe, expect, it } from "vitest";

import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import {
  RoundRobinScheduler,
  type SchedulerLimits,
} from "../../src/application/runtime/scheduler.js";
import { nativeFunction } from "../../src/domain/runtime/value.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { PythonCs486Harness } from "./pythonCs486Harness.js";

const limits: SchedulerLimits = {
  eventCapacity: 8,
  timerCapacity: 8,
  cpuCyclesPerComputer: 1_000,
  cpuCyclesPerTick: 20_000,
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
    expect(new Set(result.computers.map(({ cpuCycles }) => cpuCycles))).toEqual(
      new Set([1_200_000]),
    );
    expect(result.computers.every(({ state }) => state.kind === "ready")).toBe(
      true,
    );
  });

  it("rotates the first slice when the global budget is smaller than runnable demand", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      cpuCyclesPerTick: 1_000,
    });
    for (let id = 0; id < 4; id += 1)
      scheduler.add(id, vm("while True:\n    pass\n"));

    let result = scheduler.runTick();
    for (let tick = 1; tick < 8; tick += 1) result = scheduler.runTick();

    expect(result.computers.map(({ cpuCycles }) => cpuCycles)).toEqual([
      2_000, 2_000, 2_000, 2_000,
    ]);
  });

  it("applies mixed per-computer clock credits deterministically", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    scheduler.add(1, vm("while True:\n    pass\n"), 400);
    scheduler.add(2, vm("while True:\n    pass\n"), 1_000);

    let result = scheduler.runTick();
    for (let tick = 1; tick < 10; tick += 1) result = scheduler.runTick();

    expect(result.computers.map(({ cpuCycles }) => cpuCycles)).toEqual([
      4_000, 10_000,
    ]);
    expect(result.cpuCycles).toBe(1_400);
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
      cpuCycles: 1_000,
    });
  });
});

function vm(
  source: string,
  globals: Readonly<Record<string, ReturnType<typeof nativeFunction>>> = {},
): PythonCs486Harness {
  const filesystem = new InMemoryFilesystem();
  const terminal = new TerminalBuffer();
  const base = createNativeEnvironment({
    computerId: 1,
    filesystem,
    terminal,
  });
  return new PythonCs486Harness(source, {
    environment: {
      ...base,
      globals: new Map([...base.globals, ...Object.entries(globals)]),
    },
    filesystem,
    terminal,
  });
}
