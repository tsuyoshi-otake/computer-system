import { describe, expect, it } from "vitest";

import {
  RoundRobinScheduler,
  type SchedulerLimits,
} from "../../src/application/runtime/scheduler.js";
import type { VmRuntimeError } from "../../src/domain/runtime/errors.js";
import type {
  CpuProcess,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../src/domain/runtime/cpuProcess.js";
import type { RuntimeValue } from "../../src/domain/runtime/value.js";

const limits: SchedulerLimits = {
  eventCapacity: 4,
  timerCapacity: 4,
  cpuCyclesPerComputer: 1,
  cpuCyclesPerTick: 1,
  instructionsPerComputer: 1,
  instructionsPerTick: 1,
  computersPerTick: 4,
};

describe("RoundRobinScheduler pause ownership", (): void => {
  it("prepares paused records but skips their CPU slices until resume", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    const process = new TestProcess("ready");
    scheduler.add(1, process);

    expect(scheduler.setPaused(1, true)).toBe(true);
    expect(scheduler.setPaused(1, true)).toBe(false);
    expect(scheduler.isPaused(1)).toBe(true);
    const first = scheduler.runTick();
    const second = scheduler.runTick();

    expect(process.advancedTicks).toEqual([1, 2]);
    expect(process.cpuSlices).toBe(0);
    expect(first).toMatchObject({ cpuCycles: 0, executedInstructions: 0 });
    expect(second).toMatchObject({ cpuCycles: 0, executedInstructions: 0 });

    expect(scheduler.setPaused(1, false)).toBe(true);
    expect(scheduler.isPaused(1)).toBe(false);
    expect(scheduler.runTick()).toMatchObject({
      cpuCycles: 1,
      executedInstructions: 1,
    });
    expect(process.cpuSlices).toBe(1);
  });

  it("keeps queued events and due timers prepared across pause and resume", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    const process = new TestProcess("waiting_event", true);
    scheduler.add(7, process);
    scheduler.setPaused(7, true);
    scheduler.queueEvent(7, "manual", 41);
    const timerId = scheduler.startTimer(7, 2);

    scheduler.runTick();
    scheduler.runTick();

    expect(process.deliveredEvents).toEqual([
      { arguments: [41], name: "manual" },
    ]);
    expect(process.cpuSlices).toBe(0);
    expect(process.advancedTicks).toEqual([1, 2]);

    scheduler.setPaused(7, false);
    scheduler.runTick();
    scheduler.runTick();

    expect(process.deliveredEvents).toEqual([
      { arguments: [41], name: "manual" },
      { arguments: [timerId], name: "timer" },
    ]);
    expect(process.cpuSlices).toBe(2);
  });

  it("rejects pause queries for missing IDs and non-boolean state", (): void => {
    const scheduler = new RoundRobinScheduler(limits);
    scheduler.add(3, new TestProcess("ready"));

    expect(() => scheduler.setPaused(99, true)).toThrow(
      "Computer 99 is not scheduled",
    );
    expect(() => scheduler.isPaused(99)).toThrow(
      "Computer 99 is not scheduled",
    );
    expect(() => scheduler.setPaused(3, "yes" as unknown as boolean)).toThrow(
      "Scheduler paused state must be boolean",
    );
  });

  it("remains bounded and fair when a paused record leads active records", (): void => {
    const scheduler = new RoundRobinScheduler({
      ...limits,
      computersPerTick: 2,
    });
    const paused = new TestProcess("ready");
    const first = new TestProcess("ready");
    const second = new TestProcess("ready");
    scheduler.add(0, paused);
    scheduler.add(1, first);
    scheduler.add(2, second);
    scheduler.setPaused(0, true);

    const pausedTicks = Array.from({ length: 12 }, () => scheduler.runTick());

    expect(paused.cpuSlices).toBe(0);
    expect(first.cpuSlices).toBe(6);
    expect(second.cpuSlices).toBe(6);
    expect(
      paused.advancedTicks.length +
        first.advancedTicks.length +
        second.advancedTicks.length,
    ).toBe(24);
    for (const tick of pausedTicks) {
      expect(tick.computers.length).toBeLessThanOrEqual(2);
      expect(tick.cpuCycles).toBeLessThanOrEqual(1);
      expect(tick.executedInstructions).toBeLessThanOrEqual(1);
    }

    scheduler.setPaused(0, false);
    const beforeResume = [paused.cpuSlices, first.cpuSlices, second.cpuSlices];
    const resumedTicks = Array.from({ length: 9 }, () => scheduler.runTick());
    expect([
      paused.cpuSlices - beforeResume[0]!,
      first.cpuSlices - beforeResume[1]!,
      second.cpuSlices - beforeResume[2]!,
    ]).toEqual([3, 3, 3]);
    for (const tick of resumedTicks) {
      expect(tick.computers.length).toBeLessThanOrEqual(2);
      expect(tick.cpuCycles).toBeLessThanOrEqual(1);
      expect(tick.executedInstructions).toBeLessThanOrEqual(1);
    }
  });
});

class TestProcess implements CpuProcess {
  readonly advancedTicks: number[] = [];
  readonly deliveredEvents: {
    readonly arguments: readonly RuntimeValue[];
    readonly name: string;
  }[] = [];
  readonly hasPendingCpuCycles = false;
  readonly memoryLimitBytes = 1;
  readonly memoryUsageBytes = 0;
  cpuSlices = 0;
  private stateValue: CpuProcessState;

  constructor(
    initialState: "ready" | "waiting_event",
    private readonly waitAfterSlice = false,
  ) {
    this.stateValue = { kind: initialState };
  }

  get state(): CpuProcessState {
    return this.stateValue;
  }

  advanceTick(tick: number): CpuProcessState {
    this.advancedTicks.push(tick);
    return this.stateValue;
  }

  deliverEvent(name: string, ...arguments_: readonly RuntimeValue[]): boolean {
    if (this.stateValue.kind !== "waiting_event") return false;
    this.deliveredEvents.push({ arguments: arguments_, name });
    this.stateValue = { kind: "ready" };
    return true;
  }

  fail(error: VmRuntimeError): CpuProcessState {
    this.stateValue = { error, kind: "crashed" };
    return this.stateValue;
  }

  runCpuSlice(
    cpuCycleBudget: number,
    instructionBudget = 1,
  ): CpuProcessSliceResult {
    this.cpuSlices += 1;
    if (this.waitAfterSlice) this.stateValue = { kind: "waiting_event" };
    return {
      cpuCycles: Math.min(1, cpuCycleBudget),
      executedInstructions: Math.min(1, instructionBudget),
      state: this.stateValue,
    };
  }

  terminate(reason = "terminated"): CpuProcessState {
    this.stateValue = { kind: "terminated", reason };
    return this.stateValue;
  }
}
