export const floppyAudioEventCapacity = 32;
export const maximumFloppyAudioEventsPerSecond = 8;

export type FloppyAudioEventKind =
  "eject" | "insert" | "motor_start" | "read" | "seek" | "write";

export interface FloppyAudioEvent {
  readonly kind: FloppyAudioEventKind;
  readonly sequence: number;
  readonly tick: number;
}

export interface FloppyAudioBatch {
  readonly events: readonly FloppyAudioEvent[];
  readonly latestSequence: number;
}

interface ComputerAudioState {
  readonly events: FloppyAudioEvent[];
  readonly recentTicks: number[];
  latestSequence: number;
  lastTick: number;
}

/**
 * Bounded, transient FDD sound event history. It is deliberately independent
 * from terminal framebuffer state and is never persisted.
 */
export class FloppyAudioEventBroker {
  private readonly computers = new Map<string, ComputerAudioState>();

  constructor(
    private readonly maximumComputers = 256,
    private readonly ticksPerSecond = 20,
  ) {
    requirePositiveInteger(maximumComputers, "Maximum audio computers");
    requirePositiveInteger(ticksPerSecond, "Audio ticks per second");
  }

  record(
    computerId: string,
    kind: FloppyAudioEventKind,
    tick: number,
  ): FloppyAudioEvent | undefined {
    requireComputerId(computerId);
    requireTick(tick);
    let state = this.computers.get(computerId);
    if (state === undefined) {
      if (this.computers.size >= this.maximumComputers) return undefined;
      state = {
        events: [],
        recentTicks: [],
        latestSequence: 0,
        lastTick: tick,
      };
      this.computers.set(computerId, state);
    }
    if (tick < state.lastTick) return undefined;
    state.lastTick = tick;
    while (
      state.recentTicks[0] !== undefined &&
      state.recentTicks[0] <= tick - this.ticksPerSecond
    ) {
      state.recentTicks.shift();
    }
    if (state.recentTicks.length >= maximumFloppyAudioEventsPerSecond)
      return undefined;
    if (state.latestSequence === Number.MAX_SAFE_INTEGER) return undefined;

    const event = Object.freeze({
      kind,
      sequence: state.latestSequence + 1,
      tick,
    });
    state.latestSequence = event.sequence;
    state.recentTicks.push(tick);
    state.events.push(event);
    if (state.events.length > floppyAudioEventCapacity) state.events.shift();
    return event;
  }

  latestSequence(computerId: string): number {
    return this.computers.get(computerId)?.latestSequence ?? 0;
  }

  eventsAfter(computerId: string, sequence: number): FloppyAudioBatch {
    if (!Number.isSafeInteger(sequence) || sequence < 0)
      throw new RangeError(
        "Floppy audio cursor must be a non-negative integer",
      );
    const state = this.computers.get(computerId);
    if (state === undefined)
      return Object.freeze({ events: Object.freeze([]), latestSequence: 0 });
    return Object.freeze({
      events: Object.freeze(
        state.events.filter((event) => event.sequence > sequence),
      ),
      latestSequence: state.latestSequence,
    });
  }
}

function requireComputerId(computerId: string): void {
  if (computerId.length === 0 || computerId.length > 64)
    throw new RangeError(
      "Audio Computer identity must contain 1..64 characters",
    );
}

function requireTick(tick: number): void {
  if (!Number.isSafeInteger(tick) || tick < 0)
    throw new RangeError("Floppy audio tick must be a non-negative integer");
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${label} must be a positive integer`);
}
