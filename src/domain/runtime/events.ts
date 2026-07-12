import { VmLimitError, VmRuntimeError } from "./errors.js";
import type { RuntimeValue } from "./value.js";

export interface RuntimeEvent {
  readonly name: string;
  readonly arguments: readonly RuntimeValue[];
}

export class BoundedEventQueue {
  private readonly queued: RuntimeEvent[] = [];

  constructor(readonly capacity: number) {
    requirePositiveInteger(capacity, "event capacity");
  }

  get size(): number {
    return this.queued.length;
  }

  enqueue(name: string, ...arguments_: readonly RuntimeValue[]): void {
    if (name.length === 0)
      throw new VmRuntimeError("ValueError", "Event name cannot be empty");
    if (this.queued.length >= this.capacity) throw new VmLimitError("event");
    this.queued.push({ name, arguments: arguments_ });
  }

  take(filter?: string): RuntimeEvent | undefined {
    if (filter === undefined) return this.queued.shift();
    while (this.queued.length > 0) {
      const event = this.queued.shift()!;
      if (event.name === filter) return event;
    }
    return undefined;
  }
}

export interface RuntimeTimer {
  readonly id: number;
  readonly dueTick: number;
}

export class BoundedTimerQueue {
  private readonly timers = new Map<number, RuntimeTimer>();
  private nextId = 1;

  constructor(readonly capacity: number) {
    requirePositiveInteger(capacity, "timer capacity");
  }

  get size(): number {
    return this.timers.size;
  }

  start(currentTick: number, delayTicks: number): number {
    if (!Number.isInteger(delayTicks) || delayTicks < 0) {
      throw new VmRuntimeError(
        "ValueError",
        "Timer delay must be a non-negative integer",
      );
    }
    if (this.timers.size >= this.capacity) throw new VmLimitError("timer");
    const id = this.nextId++;
    this.timers.set(id, { id, dueTick: currentTick + delayTicks });
    return id;
  }

  cancel(id: number): boolean {
    return this.timers.delete(id);
  }

  takeDue(tick: number): RuntimeTimer[] {
    const due = [...this.timers.values()]
      .filter((timer) => timer.dueTick <= tick)
      .sort(
        (left, right) => left.dueTick - right.dueTick || left.id - right.id,
      );
    for (const timer of due) this.timers.delete(timer.id);
    return due;
  }
}

function requirePositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
