import { describe, expect, it } from "vitest";

import { ComputerWorkMonitor } from "../../src/application/runtime/computerWorkMonitor.js";
import {
  RoundRobinScheduler,
  type SchedulerWorkObserver,
} from "../../src/application/runtime/scheduler.js";
import type {
  CpuProcess,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../src/domain/runtime/cpuProcess.js";

describe("WorkMonitor scale gate", (): void => {
  it("keeps preparation, execution, and result views fixed for 10,000 Computers", (): void => {
    const scheduler = new RoundRobinScheduler({
      eventCapacity: 2,
      timerCapacity: 2,
      cpuCyclesPerComputer: 1,
      cpuCyclesPerTick: 64,
      instructionsPerComputer: 1,
      instructionsPerTick: 64,
      computersPerTick: 64,
    });
    for (let id = 0; id < 10_000; id += 1) {
      scheduler.add(id, new CountingProcess());
    }
    let clock = 0;
    const monitor = new ComputerWorkMonitor({
      nowMicroseconds: (): number => clock++,
    });
    const visited = new Set<number>();

    for (let tickNumber = 1; tickNumber <= 157; tickNumber += 1) {
      const scope = monitor.beginTick(tickNumber);
      const observer: SchedulerWorkObserver = {
        prepare: (_id, operation) =>
          scope.tryRun(
            { lane: "event_delivery", deterministicUnits: 1 },
            operation,
          ).outcome === "ran",
        runCpuSlice: (_id, operation) => {
          const attempt = scope.tryRun(
            { lane: "guest_cpu", deterministicUnits: 1 },
            operation,
          );
          return attempt.outcome === "ran" ? attempt.value : undefined;
        },
      };
      const result = scheduler.runTick(observer);
      expect(result.computers).toHaveLength(64);
      for (const computer of result.computers) visited.add(computer.id);
      scope.finish();
    }

    expect(visited.size).toBe(10_000);
    expect(monitor.snapshot()).toMatchObject({
      completedTicks: 157,
      emergencyLimitDeferrals: 0,
      softLimitDeferrals: 0,
      lanes: {
        event_delivery: { admitted: 157 * 64 },
        guest_cpu: { admitted: 157 * 64 },
      },
    });
    expect(monitor.snapshot().tickHostMicroseconds.p99).toBeGreaterThan(0);
  });
});

class CountingProcess implements CpuProcess {
  readonly hasPendingCpuCycles = false;
  readonly memoryLimitBytes = 1;
  readonly memoryUsageBytes = 0;
  readonly state: CpuProcessState = { kind: "ready" };

  advanceTick(): CpuProcessState {
    return this.state;
  }

  deliverEvent(): boolean {
    return false;
  }

  fail(): CpuProcessState {
    return this.state;
  }

  runCpuSlice(): CpuProcessSliceResult {
    return { cpuCycles: 1, executedInstructions: 1, state: this.state };
  }

  terminate(): CpuProcessState {
    return this.state;
  }
}
