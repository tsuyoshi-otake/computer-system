import { describe, expect, it } from "vitest";

import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import {
  defaultSchedulerLimits,
  RoundRobinScheduler,
  type SchedulerLimits,
} from "../../src/application/runtime/scheduler.js";
import { nativeFunction } from "../../src/domain/runtime/value.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import type {
  CpuProcess,
  CpuProcessState,
} from "../../src/domain/runtime/cpuProcess.js";
import { PythonCs486Harness } from "./pythonCs486Harness.js";

const limits: SchedulerLimits = {
  eventCapacity: 8,
  timerCapacity: 8,
  cpuCyclesPerComputer: 1_000,
  cpuCyclesPerTick: 20_000,
};

describe("round-robin scheduler", (): void => {
  it("keeps the production instruction ceilings explicit and bounded", (): void => {
    expect(defaultSchedulerLimits.instructionsPerComputer).toBe(1_650_000);
    expect(defaultSchedulerLimits.instructionsPerTick).toBe(1_650_000);
  });

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

  it("bounds host instruction work independently from modeled CPU cycles", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      cpuCyclesPerComputer: 1_000_000,
      cpuCyclesPerTick: 1_000_000,
      instructionsPerComputer: 200,
      instructionsPerTick: 1_000,
    });
    for (let id = 0; id < 10; id += 1)
      scheduler.add(id, vm("while True:\n    pass\n"));

    const first = scheduler.runTick();
    const second = scheduler.runTick();

    expect(first.executedInstructions).toBeLessThanOrEqual(1_000);
    expect(second.executedInstructions).toBeLessThanOrEqual(1_000);
    expect(
      first.computers.every(
        ({ executedInstructions }) => executedInstructions <= 200,
      ),
    ).toBe(true);
    expect(
      second.computers.some(
        ({ executedInstructions }) => executedInstructions > 200,
      ),
    ).toBe(true);
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

  it("bounds preparation and result materialization independently of population", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      computersPerTick: 7,
      cpuCyclesPerTick: 7_000,
    });
    for (let id = 0; id < 1_000; id += 1) {
      scheduler.add(id, alwaysReadyProcess());
    }

    const visited = new Set<number>();
    for (let tick = 0; tick < 143; tick += 1) {
      const result = scheduler.runTick();
      expect(result.computers.length).toBeLessThanOrEqual(7);
      for (const computer of result.computers) visited.add(computer.id);
    }

    expect(visited.size).toBe(1_000);
  });

  it("applies one aggregate budget lane per execution resource", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      cpuCyclesPerComputer: 100,
      cpuCyclesPerTick: 100,
      instructionsPerComputer: 10,
      instructionsPerTick: 10,
    });
    scheduler.add(1, accountingProcess("cs486-worker-1", 100, 10));
    scheduler.add(2, accountingProcess("cs486-worker-1", 100, 10));
    scheduler.add(3, accountingProcess("cs486-worker-2", 100, 10));
    scheduler.add(4, accountingProcess("cs486-worker-2", 100, 10));

    const result = scheduler.runTick();

    expect(result).toMatchObject({
      admittedCpuCycles: 200,
      admittedInstructions: 20,
      cpuCycles: 200,
      executedInstructions: 20,
    });
    expect(
      result.computers.map(({ cpuCycles, executedInstructions }) => ({
        cpuCycles,
        executedInstructions,
      })),
    ).toEqual([
      { cpuCycles: 100, executedInstructions: 10 },
      { cpuCycles: 0, executedInstructions: 0 },
      { cpuCycles: 100, executedInstructions: 10 },
      { cpuCycles: 0, executedInstructions: 0 },
    ]);
  });

  it("rotates contention independently within each execution resource", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      cpuCyclesPerComputer: 100,
      cpuCyclesPerTick: 100,
      instructionsPerComputer: 10,
      instructionsPerTick: 10,
    });
    scheduler.add(1, accountingProcess("cs486-worker-1", 100, 10));
    scheduler.add(2, accountingProcess("cs486-worker-1", 100, 10));
    scheduler.add(3, accountingProcess("cs486-worker-1", 100, 10));
    scheduler.add(4, accountingProcess("cs486-worker-2", 100, 10));

    let result = scheduler.runTick();
    for (let tick = 1; tick < 6; tick += 1) result = scheduler.runTick();

    expect(
      result.computers.map(({ cpuCycles, executedInstructions }) => ({
        cpuCycles,
        executedInstructions,
      })),
    ).toEqual([
      { cpuCycles: 200, executedInstructions: 20 },
      { cpuCycles: 200, executedInstructions: 20 },
      { cpuCycles: 200, executedInstructions: 20 },
      { cpuCycles: 600, executedInstructions: 60 },
    ]);
  });

  it("charges asynchronous dispatch admission separately from settled work", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      cpuCyclesPerComputer: 100,
      cpuCyclesPerTick: 100,
      instructionsPerComputer: 10,
      instructionsPerTick: 10,
    });
    scheduler.add(
      1,
      accountingProcess("cs486-worker-1", 40, 4, {
        admittedCpuCycles: 100,
        admittedInstructions: 10,
      }),
    );
    scheduler.add(2, accountingProcess("cs486-worker-1", 100, 10));

    const result = scheduler.runTick();

    expect(result).toMatchObject({
      admittedCpuCycles: 100,
      admittedInstructions: 10,
      cpuCycles: 40,
      executedInstructions: 4,
    });
    expect(result.computers[1]).toMatchObject({
      cpuCycles: 0,
      executedInstructions: 0,
    });
  });

  it("bounds asynchronous instruction reservations by the offered cycle credit", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      cpuCyclesPerComputer: 1_650_000,
      cpuCyclesPerTick: 1_650_000,
      instructionsPerComputer: 1_650_000,
      instructionsPerTick: 1_650_000,
    });
    const offers: {
      readonly cpuCycleBudget: number;
      readonly instructionBudget: number;
    }[] = [];
    for (let id = 1; id <= 4; id += 1) {
      const process = alwaysReadyProcess();
      scheduler.add(
        id,
        {
          ...process,
          schedulerResourceId: "cs486-worker-1",
          runCpuSlice: (cpuCycleBudget, instructionBudget = 1) => {
            offers.push({ cpuCycleBudget, instructionBudget });
            return {
              admittedCpuCycles: cpuCycleBudget,
              admittedInstructions: instructionBudget,
              cpuCycles: 0,
              executedInstructions: 0,
              state: process.state,
            };
          },
        },
        400_000,
      );
    }

    const result = scheduler.runTick();

    expect(offers).toEqual(
      Array.from({ length: 4 }, () => ({
        cpuCycleBudget: 400_000,
        instructionBudget: 400_000,
      })),
    );
    expect(result).toMatchObject({
      admittedCpuCycles: 1_600_000,
      admittedInstructions: 1_600_000,
      cpuCycles: 0,
      executedInstructions: 0,
    });
  });

  it("disposes a removed process exactly once", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    let disposeCalls = 0;
    scheduler.add(91, {
      ...alwaysReadyProcess(),
      dispose: (): void => {
        disposeCalls += 1;
      },
    });

    expect(scheduler.remove(91)).toBe(true);
    expect(scheduler.remove(91)).toBe(false);
    expect(disposeCalls).toBe(1);
  });
});

function alwaysReadyProcess(): CpuProcess {
  let state: CpuProcessState = { kind: "ready" };
  return {
    get state(): CpuProcessState {
      return state;
    },
    hasPendingCpuCycles: false,
    memoryLimitBytes: 1,
    memoryUsageBytes: 0,
    advanceTick: (): CpuProcessState => state,
    deliverEvent: (): boolean => false,
    fail: (error): CpuProcessState => {
      state = { error, kind: "crashed" };
      return state;
    },
    runCpuSlice: (cpuCycleBudget, instructionBudget = 1) => ({
      cpuCycles: Math.min(1_000, cpuCycleBudget),
      executedInstructions: Math.min(1, instructionBudget),
      state,
    }),
    terminate: (reason = "terminated"): CpuProcessState => {
      state = { kind: "terminated", reason };
      return state;
    },
  };
}

function accountingProcess(
  schedulerResourceId: string,
  cpuCycles: number,
  executedInstructions: number,
  admission: {
    readonly admittedCpuCycles: number;
    readonly admittedInstructions: number;
  } = {
    admittedCpuCycles: cpuCycles,
    admittedInstructions: executedInstructions,
  },
): CpuProcess {
  const process = alwaysReadyProcess();
  return {
    ...process,
    schedulerResourceId,
    runCpuSlice: () => ({
      ...admission,
      cpuCycles,
      executedInstructions,
      state: process.state,
    }),
  };
}

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
