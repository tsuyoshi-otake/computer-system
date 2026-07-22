import {
  BoundedEventQueue,
  BoundedTimerQueue,
} from "../../domain/runtime/events.js";
import { VmRuntimeError } from "../../domain/runtime/errors.js";
import type {
  CpuProcess,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../domain/runtime/cpuProcess.js";
import type { RuntimeValue } from "../../domain/runtime/value.js";
import { computerNominalClockHz } from "../../domain/cpu/timing.js";

export interface SchedulerLimits {
  readonly eventCapacity: number;
  readonly timerCapacity: number;
  readonly cpuCyclesPerComputer: number;
  readonly cpuCyclesPerTick: number;
  readonly instructionsPerComputer?: number;
  readonly instructionsPerTick?: number;
  /** Maximum number of Computer records inspected by one host tick. */
  readonly computersPerTick?: number;
}

export const defaultSchedulerLimits: SchedulerLimits = {
  eventCapacity: 256,
  timerCapacity: 128,
  cpuCyclesPerComputer: Math.floor(computerNominalClockHz / 20),
  cpuCyclesPerTick: Math.floor(computerNominalClockHz / 20),
  instructionsPerComputer: 40_000,
  instructionsPerTick: 200_000,
  computersPerTick: 64,
};

export interface SchedulerWorkObserver {
  prepare(computerId: number, operation: () => void): boolean;
  runCpuSlice(
    computerId: number,
    operation: () => CpuProcessSliceResult,
  ): CpuProcessSliceResult | undefined;
}

export interface ScheduledComputerView {
  readonly cpuCycles: number;
  readonly id: number;
  readonly state: CpuProcessState;
  readonly executedInstructions: number;
}

export interface SchedulerTickResult {
  readonly cpuCycles: number;
  readonly tick: number;
  readonly executedInstructions: number;
  readonly computers: readonly ScheduledComputerView[];
}

export class RoundRobinScheduler {
  private readonly computers = new Map<number, ScheduledComputer>();
  private order: number[] = [];
  private readonly orderIndices = new Map<number, number>();
  private cursor = 0;
  private tickValue = 0;
  private readonly instructionsPerComputer: number;
  private readonly instructionsPerTick: number;
  private readonly computersPerTick: number;

  constructor(
    private readonly limits: SchedulerLimits = defaultSchedulerLimits,
  ) {
    requirePositiveInteger(limits.eventCapacity, "eventCapacity");
    requirePositiveInteger(limits.timerCapacity, "timerCapacity");
    requirePositiveInteger(limits.cpuCyclesPerComputer, "cpuCyclesPerComputer");
    requirePositiveInteger(limits.cpuCyclesPerTick, "cpuCyclesPerTick");
    this.instructionsPerComputer =
      limits.instructionsPerComputer ?? Number.MAX_SAFE_INTEGER;
    this.instructionsPerTick =
      limits.instructionsPerTick ?? Number.MAX_SAFE_INTEGER;
    this.computersPerTick =
      limits.computersPerTick ?? defaultSchedulerLimits.computersPerTick!;
    requirePositiveInteger(
      this.instructionsPerComputer,
      "instructionsPerComputer",
    );
    requirePositiveInteger(this.instructionsPerTick, "instructionsPerTick");
    requirePositiveInteger(this.computersPerTick, "computersPerTick");
  }

  get tickNumber(): number {
    return this.tickValue;
  }

  add(
    id: number,
    process: CpuProcess,
    cpuCyclesPerTick = this.limits.cpuCyclesPerComputer,
  ): void {
    if (!Number.isInteger(id) || id < 0)
      throw new RangeError("Computer ID must be non-negative");
    if (this.computers.has(id))
      throw new Error(`Computer ${id} is already scheduled`);
    requirePositiveInteger(cpuCyclesPerTick, "cpuCyclesPerTick");
    this.computers.set(id, {
      id,
      process,
      events: new BoundedEventQueue(this.limits.eventCapacity),
      timers: new BoundedTimerQueue(this.limits.timerCapacity),
      cpuCycles: 0,
      executedInstructions: 0,
      cpuCyclesPerTick,
      paused: false,
    });
    this.orderIndices.set(id, this.order.length);
    this.order.push(id);
  }

  remove(id: number): boolean {
    const removed = this.computers.delete(id);
    if (!removed) return false;
    const index = this.orderIndices.get(id);
    if (index === undefined)
      throw new Error(`Computer ${id} has no order index`);
    const lastIndex = this.order.length - 1;
    const lastId = this.order[lastIndex]!;
    this.order.pop();
    this.orderIndices.delete(id);
    if (index < lastIndex) {
      this.order[index] = lastId;
      this.orderIndices.set(lastId, index);
    }
    if (index < this.cursor) this.cursor -= 1;
    if (this.order.length === 0) this.cursor = 0;
    else this.cursor %= this.order.length;
    return true;
  }

  /**
   * Pauses only CPU dispatch. Tick advancement, due timers, and event delivery
   * remain prepared through the normal bounded round-robin pass.
   */
  setPaused(id: number, paused: boolean): boolean {
    if (typeof paused !== "boolean")
      throw new TypeError("Scheduler paused state must be boolean");
    const computer = this.requireComputer(id);
    if (computer.paused === paused) return false;
    computer.paused = paused;
    return true;
  }

  isPaused(id: number): boolean {
    return this.requireComputer(id).paused;
  }

  queueEvent(
    id: number,
    name: string,
    ...arguments_: readonly RuntimeValue[]
  ): void {
    this.requireComputer(id).events.enqueue(name, ...arguments_);
  }

  startTimer(id: number, delayTicks: number): number {
    return this.requireComputer(id).timers.start(this.tickValue, delayTicks);
  }

  cancelTimer(id: number, timerId: number): boolean {
    return this.requireComputer(id).timers.cancel(timerId);
  }

  terminate(id: number, reason = "terminated"): CpuProcessState {
    return this.requireComputer(id).process.terminate(reason);
  }

  state(id: number): CpuProcessState {
    return this.requireComputer(id).process.state;
  }

  runTick(observer?: SchedulerWorkObserver): SchedulerTickResult {
    this.tickValue += 1;
    let remaining = this.limits.cpuCyclesPerTick;
    let remainingInstructions = this.instructionsPerTick;
    let executedInstructions = 0;
    let cpuCursorAdvance = 0;
    const scheduledCount = this.order.length;
    const count = Math.min(scheduledCount, this.computersPerTick);
    const visited: ScheduledComputer[] = [];

    for (let offset = 0; offset < count; offset += 1) {
      const index = (this.cursor + offset) % scheduledCount;
      const computer = this.computers.get(this.order[index]!);
      if (computer === undefined) continue;
      const prepared =
        observer === undefined
          ? (this.prepare(computer), true)
          : observer.prepare(computer.id, () => this.prepare(computer));
      if (!prepared) break;
      visited.push(computer);
    }

    for (
      let offset = 0;
      offset < count && remaining > 0 && remainingInstructions > 0;
      offset += 1
    ) {
      const computer = visited[offset];
      if (computer === undefined) continue;
      if (computer.paused) continue;
      if (
        computer.process.state.kind !== "ready" &&
        !computer.process.hasPendingCpuCycles
      )
        continue;
      const budget = Math.min(computer.cpuCyclesPerTick, remaining);
      const instructionBudget = Math.min(
        this.instructionsPerComputer,
        remainingInstructions,
      );
      const operation = (): CpuProcessSliceResult =>
        computer.process.runCpuSlice(budget, instructionBudget);
      const result =
        observer === undefined
          ? operation()
          : observer.runCpuSlice(computer.id, operation);
      if (result === undefined) break;
      computer.cpuCycles += result.cpuCycles;
      computer.executedInstructions += result.executedInstructions;
      cpuCursorAdvance = offset + 1;
      executedInstructions += result.executedInstructions;
      remaining -= result.cpuCycles;
      remainingInstructions -= result.executedInstructions;
    }
    if (scheduledCount > 0 && visited.length > 0) {
      const advance =
        scheduledCount <= this.computersPerTick
          ? 1
          : cpuCursorAdvance > 0
            ? cpuCursorAdvance
            : visited.length;
      this.cursor = (this.cursor + advance) % scheduledCount;
    }

    const outputComputers =
      scheduledCount <= this.computersPerTick
        ? this.order.flatMap((id) => {
            const computer = this.computers.get(id);
            return computer === undefined ? [] : [computer];
          })
        : visited;
    const computers = outputComputers.map((computer) => ({
      id: computer.id,
      state: computer.process.state,
      cpuCycles: computer.cpuCycles,
      executedInstructions: computer.executedInstructions,
    }));
    return {
      cpuCycles: this.limits.cpuCyclesPerTick - remaining,
      tick: this.tickValue,
      executedInstructions,
      computers,
    };
  }

  private prepare(computer: ScheduledComputer): void {
    computer.process.advanceTick(this.tickValue);
    try {
      for (const timer of computer.timers.takeDue(this.tickValue)) {
        computer.events.enqueue("timer", timer.id);
      }
      if (computer.process.state.kind === "waiting_event") {
        const event = computer.events.take(computer.process.state.filter);
        if (event !== undefined) {
          computer.process.deliverEvent(event.name, ...event.arguments);
        }
      }
    } catch (error: unknown) {
      computer.process.fail(
        error instanceof VmRuntimeError
          ? error
          : new VmRuntimeError(
              "RuntimeError",
              error instanceof Error ? error.message : String(error),
            ),
      );
    }
  }

  private requireComputer(id: number): ScheduledComputer {
    const computer = this.computers.get(id);
    if (computer === undefined)
      throw new Error(`Computer ${id} is not scheduled`);
    return computer;
  }
}

interface ScheduledComputer {
  cpuCycles: number;
  readonly id: number;
  readonly process: CpuProcess;
  readonly events: BoundedEventQueue;
  readonly timers: BoundedTimerQueue;
  executedInstructions: number;
  readonly cpuCyclesPerTick: number;
  paused: boolean;
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new RangeError(`${name} must be positive`);
}
