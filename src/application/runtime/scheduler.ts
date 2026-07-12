import {
  BoundedEventQueue,
  BoundedTimerQueue,
} from "../../domain/runtime/events.js";
import { VmRuntimeError } from "../../domain/runtime/errors.js";
import type { RuntimeValue } from "../../domain/runtime/value.js";
import type { StackVm, VmState } from "./vm.js";

export interface SchedulerLimits {
  readonly eventCapacity: number;
  readonly timerCapacity: number;
  readonly instructionsPerComputer: number;
  readonly instructionsPerTick: number;
}

export const defaultSchedulerLimits: SchedulerLimits = {
  eventCapacity: 256,
  timerCapacity: 128,
  instructionsPerComputer: 1_000,
  instructionsPerTick: 20_000,
};

export interface ScheduledComputerView {
  readonly id: number;
  readonly state: VmState;
  readonly executedInstructions: number;
}

export interface SchedulerTickResult {
  readonly tick: number;
  readonly executedInstructions: number;
  readonly computers: readonly ScheduledComputerView[];
}

export class RoundRobinScheduler {
  private readonly computers = new Map<number, ScheduledComputer>();
  private order: number[] = [];
  private cursor = 0;
  private tickValue = 0;

  constructor(
    private readonly limits: SchedulerLimits = defaultSchedulerLimits,
  ) {
    requirePositiveInteger(limits.eventCapacity, "eventCapacity");
    requirePositiveInteger(limits.timerCapacity, "timerCapacity");
    requirePositiveInteger(
      limits.instructionsPerComputer,
      "instructionsPerComputer",
    );
    requirePositiveInteger(limits.instructionsPerTick, "instructionsPerTick");
  }

  get tickNumber(): number {
    return this.tickValue;
  }

  add(id: number, vm: StackVm): void {
    if (!Number.isInteger(id) || id < 0)
      throw new RangeError("Computer ID must be non-negative");
    if (this.computers.has(id))
      throw new Error(`Computer ${id} is already scheduled`);
    this.computers.set(id, {
      id,
      vm,
      events: new BoundedEventQueue(this.limits.eventCapacity),
      timers: new BoundedTimerQueue(this.limits.timerCapacity),
      executedInstructions: 0,
    });
    this.order.push(id);
  }

  remove(id: number): boolean {
    const removed = this.computers.delete(id);
    if (!removed) return false;
    this.order = this.order.filter((candidate) => candidate !== id);
    if (this.order.length === 0) this.cursor = 0;
    else this.cursor %= this.order.length;
    return true;
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

  terminate(id: number, reason = "terminated"): VmState {
    return this.requireComputer(id).vm.terminate(reason);
  }

  state(id: number): VmState {
    return this.requireComputer(id).vm.state;
  }

  runTick(): SchedulerTickResult {
    this.tickValue += 1;
    let remaining = this.limits.instructionsPerTick;
    const count = this.order.length;

    for (const id of this.order) {
      const computer = this.computers.get(id);
      if (computer !== undefined) this.prepare(computer);
    }

    for (let offset = 0; offset < count && remaining > 0; offset += 1) {
      const index = (this.cursor + offset) % count;
      const computer = this.computers.get(this.order[index]!);
      if (computer === undefined) continue;
      if (computer.vm.state.kind !== "ready") continue;
      const budget = Math.min(this.limits.instructionsPerComputer, remaining);
      const result = computer.vm.runSlice(budget);
      computer.executedInstructions += result.executedInstructions;
      remaining -= result.executedInstructions;
    }
    if (count > 0) this.cursor = (this.cursor + 1) % count;

    const computers = this.order.flatMap((id) => {
      const computer = this.computers.get(id);
      return computer === undefined
        ? []
        : [
            {
              id,
              state: computer.vm.state,
              executedInstructions: computer.executedInstructions,
            },
          ];
    });
    return {
      tick: this.tickValue,
      executedInstructions: this.limits.instructionsPerTick - remaining,
      computers,
    };
  }

  private prepare(computer: ScheduledComputer): void {
    computer.vm.advanceTick(this.tickValue);
    try {
      for (const timer of computer.timers.takeDue(this.tickValue)) {
        computer.events.enqueue("timer", timer.id);
      }
      if (computer.vm.state.kind === "waiting_event") {
        const event = computer.events.take(computer.vm.state.filter);
        if (event !== undefined) {
          computer.vm.deliverEvent(event.name, ...event.arguments);
        }
      }
    } catch (error: unknown) {
      computer.vm.fail(
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
  readonly id: number;
  readonly vm: StackVm;
  readonly events: BoundedEventQueue;
  readonly timers: BoundedTimerQueue;
  executedInstructions: number;
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0)
    throw new RangeError(`${name} must be positive`);
}
