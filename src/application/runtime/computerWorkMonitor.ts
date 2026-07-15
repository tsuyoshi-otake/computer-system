export const computerWorkLanes = [
  "control",
  "event_delivery",
  "guest_cpu",
  "guest_compile",
  "mcp_debug",
  "rs232",
  "i2c",
  "spi",
  "redstone_input",
  "redstone_output",
  "topology",
  "terminal",
  "persistence",
] as const;

export type ComputerWorkLane = (typeof computerWorkLanes)[number];

export interface MonotonicMicrosecondClock {
  nowMicroseconds(): number;
}

export interface ComputerWorkClaim {
  readonly lane: ComputerWorkLane;
  readonly deterministicUnits: number;
  readonly computerId?: string;
}

export type ComputerWorkDeferralReason =
  "lane_limit" | "tick_soft_limit" | "tick_emergency_limit";

export type ComputerWorkAttempt<T> =
  | {
      readonly outcome: "ran";
      readonly value: T;
      readonly hostMicroseconds: number;
      readonly overrun: boolean;
    }
  | {
      readonly outcome: "deferred";
      readonly reason: ComputerWorkDeferralReason;
      readonly retryTick: number;
    };

export interface ComputerWorkMonitorLimits {
  readonly softHostMicrosecondsPerTick: number;
  readonly emergencyHostMicrosecondsPerTick: number;
  readonly maximumAtomicHostMicroseconds: number;
  readonly laneUnitsPerTick: Readonly<Record<ComputerWorkLane, number>>;
  readonly histogramUpperBoundsMicroseconds: readonly number[];
}

export const defaultComputerWorkMonitorLimits: ComputerWorkMonitorLimits = {
  softHostMicrosecondsPerTick: 8_000,
  emergencyHostMicrosecondsPerTick: 12_000,
  maximumAtomicHostMicroseconds: 2_000,
  laneUnitsPerTick: {
    control: 64,
    event_delivery: 128,
    guest_cpu: 1_000,
    guest_compile: 256,
    mcp_debug: 128,
    rs232: 1_536,
    i2c: 2_048,
    spi: 4_096,
    redstone_input: 24,
    redstone_output: 4,
    topology: 24,
    terminal: 4,
    persistence: 4,
  },
  histogramUpperBoundsMicroseconds: [
    125, 250, 500, 1_000, 2_000, 4_000, 8_000, 12_000, 24_000,
  ],
};

export interface ComputerWorkLaneSnapshot {
  readonly admitted: number;
  readonly deferred: number;
  readonly failed: number;
  readonly hostMicroseconds: number;
  readonly maximumAtomicHostMicroseconds: number;
  readonly overruns: number;
  readonly units: number;
}

export interface ComputerWorkMonitorSnapshot {
  readonly completedTicks: number;
  readonly emergencyLimitDeferrals: number;
  readonly histogram: readonly number[];
  readonly histogramUpperBoundsMicroseconds: readonly number[];
  readonly lanes: Readonly<Record<ComputerWorkLane, ComputerWorkLaneSnapshot>>;
  readonly softLimitDeferrals: number;
}

export interface TickWorkSummary {
  readonly hostMicroseconds: number;
  readonly maximumAtomicHostMicroseconds: number;
  readonly overrun: boolean;
  readonly tick: number;
}

interface MutableLaneMetrics {
  admitted: number;
  deferred: number;
  failed: number;
  hostMicroseconds: number;
  maximumAtomicHostMicroseconds: number;
  overruns: number;
  units: number;
}

/**
 * Accounts bounded Computer System work on the BDS thread.
 *
 * This monitor never translates host time into guest CPU cycles or device-wire
 * clocks, and it does not own job finalization. Callers must submit an already
 * bounded atomic operation and retain ownership when the operation is deferred.
 */
export class ComputerWorkMonitor {
  private readonly cumulative = laneRecord(mutableLaneMetrics);
  private readonly histogram: number[];
  private activeScope: TickWorkScope | undefined;
  private completedTicksValue = 0;
  private emergencyLimitDeferralsValue = 0;
  private lastTick = -1;
  private softLimitDeferralsValue = 0;

  constructor(
    private readonly clock: MonotonicMicrosecondClock,
    private readonly limits: ComputerWorkMonitorLimits = defaultComputerWorkMonitorLimits,
  ) {
    requirePositiveInteger(
      limits.softHostMicrosecondsPerTick,
      "softHostMicrosecondsPerTick",
    );
    requirePositiveInteger(
      limits.emergencyHostMicrosecondsPerTick,
      "emergencyHostMicrosecondsPerTick",
    );
    requirePositiveInteger(
      limits.maximumAtomicHostMicroseconds,
      "maximumAtomicHostMicroseconds",
    );
    if (
      limits.softHostMicrosecondsPerTick >=
      limits.emergencyHostMicrosecondsPerTick
    ) {
      throw new RangeError(
        "Computer work soft host limit must be below the emergency limit",
      );
    }
    for (const lane of computerWorkLanes) {
      requirePositiveInteger(
        limits.laneUnitsPerTick[lane],
        `${lane} lane limit`,
      );
    }
    validateHistogramBounds(limits.histogramUpperBoundsMicroseconds);
    this.histogram = Array.from(
      { length: limits.histogramUpperBoundsMicroseconds.length + 1 },
      () => 0,
    );
  }

  beginTick(tick: number): TickWorkScope {
    if (!Number.isSafeInteger(tick) || tick < 0)
      throw new RangeError("Computer work tick must be non-negative");
    if (tick <= this.lastTick)
      throw new RangeError("Computer work ticks must increase monotonically");
    if (this.activeScope !== undefined)
      throw new Error("The previous Computer work tick is still active");
    this.lastTick = tick;
    const scope = new TickWorkScope(this, tick, this.readClock());
    this.activeScope = scope;
    return scope;
  }

  snapshot(): ComputerWorkMonitorSnapshot {
    return {
      completedTicks: this.completedTicksValue,
      emergencyLimitDeferrals: this.emergencyLimitDeferralsValue,
      histogram: [...this.histogram],
      histogramUpperBoundsMicroseconds: [
        ...this.limits.histogramUpperBoundsMicroseconds,
      ],
      lanes: laneRecord((lane) => ({ ...this.cumulative[lane] })),
      softLimitDeferrals: this.softLimitDeferralsValue,
    };
  }

  laneLimit(lane: ComputerWorkLane): number {
    return this.limits.laneUnitsPerTick[lane];
  }

  softLimit(): number {
    return this.limits.softHostMicrosecondsPerTick;
  }

  emergencyLimit(): number {
    return this.limits.emergencyHostMicrosecondsPerTick;
  }

  maximumAtomicLimit(): number {
    return this.limits.maximumAtomicHostMicroseconds;
  }

  nowMicroseconds(): number {
    return this.readClock();
  }

  noteDeferral(
    lane: ComputerWorkLane,
    reason: ComputerWorkDeferralReason,
  ): void {
    this.cumulative[lane].deferred += 1;
    if (reason === "tick_soft_limit") this.softLimitDeferralsValue += 1;
    if (reason === "tick_emergency_limit")
      this.emergencyLimitDeferralsValue += 1;
  }

  noteRun(
    lane: ComputerWorkLane,
    deterministicUnits: number,
    hostMicroseconds: number,
    failed: boolean,
    overrun: boolean,
  ): void {
    const metrics = this.cumulative[lane];
    metrics.admitted += 1;
    metrics.units += deterministicUnits;
    metrics.hostMicroseconds += hostMicroseconds;
    metrics.maximumAtomicHostMicroseconds = Math.max(
      metrics.maximumAtomicHostMicroseconds,
      hostMicroseconds,
    );
    if (failed) metrics.failed += 1;
    if (overrun) metrics.overruns += 1;
  }

  finishScope(scope: TickWorkScope, hostMicroseconds: number): void {
    if (this.activeScope !== scope)
      throw new Error("Computer work tick scope is not active");
    this.activeScope = undefined;
    this.completedTicksValue += 1;
    const bucket = this.limits.histogramUpperBoundsMicroseconds.findIndex(
      (bound) => hostMicroseconds <= bound,
    );
    const bucketIndex = bucket < 0 ? this.histogram.length - 1 : bucket;
    this.histogram[bucketIndex] = (this.histogram[bucketIndex] ?? 0) + 1;
  }

  private readClock(): number {
    const value = this.clock.nowMicroseconds();
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError("Monotonic clock must return a non-negative value");
    return value;
  }
}

export class TickWorkScope {
  private readonly laneUnits = laneRecord(() => 0);
  private finished = false;
  private maximumAtomicHostMicrosecondsValue = 0;
  private overrunValue = false;

  constructor(
    private readonly monitor: ComputerWorkMonitor,
    readonly tick: number,
    private readonly startedAtMicroseconds: number,
  ) {}

  tryRun<T>(
    claim: ComputerWorkClaim,
    operation: () => T,
  ): ComputerWorkAttempt<T> {
    this.requireActive();
    requirePositiveInteger(claim.deterministicUnits, "deterministicUnits");
    if (
      this.laneUnits[claim.lane] + claim.deterministicUnits >
      this.monitor.laneLimit(claim.lane)
    ) {
      return this.deferred(claim.lane, "lane_limit");
    }
    const elapsed = this.elapsedMicroseconds();
    if (elapsed >= this.monitor.emergencyLimit())
      return this.deferred(claim.lane, "tick_emergency_limit");
    if (elapsed >= this.monitor.softLimit())
      return this.deferred(claim.lane, "tick_soft_limit");

    this.laneUnits[claim.lane] += claim.deterministicUnits;
    const started = this.monitor.nowMicroseconds();
    let failed = true;
    let value!: T;
    let hostMicroseconds = 0;
    let overrun = false;
    try {
      value = operation();
      failed = false;
    } finally {
      hostMicroseconds = Math.max(0, this.monitor.nowMicroseconds() - started);
      this.maximumAtomicHostMicrosecondsValue = Math.max(
        this.maximumAtomicHostMicrosecondsValue,
        hostMicroseconds,
      );
      overrun =
        hostMicroseconds > this.monitor.maximumAtomicLimit() ||
        this.elapsedMicroseconds() > this.monitor.emergencyLimit();
      this.overrunValue = this.overrunValue || overrun;
      this.monitor.noteRun(
        claim.lane,
        claim.deterministicUnits,
        hostMicroseconds,
        failed,
        overrun,
      );
    }
    return { outcome: "ran", value, hostMicroseconds, overrun };
  }

  finish(): TickWorkSummary {
    this.requireActive();
    this.finished = true;
    const hostMicroseconds = this.elapsedMicroseconds();
    this.monitor.finishScope(this, hostMicroseconds);
    return {
      hostMicroseconds,
      maximumAtomicHostMicroseconds: this.maximumAtomicHostMicrosecondsValue,
      overrun: this.overrunValue,
      tick: this.tick,
    };
  }

  private deferred(
    lane: ComputerWorkLane,
    reason: ComputerWorkDeferralReason,
  ): ComputerWorkAttempt<never> {
    this.monitor.noteDeferral(lane, reason);
    return { outcome: "deferred", reason, retryTick: this.tick + 1 };
  }

  private elapsedMicroseconds(): number {
    return Math.max(
      0,
      this.monitor.nowMicroseconds() - this.startedAtMicroseconds,
    );
  }

  private requireActive(): void {
    if (this.finished)
      throw new Error("Computer work tick is already finished");
  }
}

function mutableLaneMetrics(): MutableLaneMetrics {
  return {
    admitted: 0,
    deferred: 0,
    failed: 0,
    hostMicroseconds: 0,
    maximumAtomicHostMicroseconds: 0,
    overruns: 0,
    units: 0,
  };
}

function laneRecord<T>(
  factory: (lane: ComputerWorkLane) => T,
): Record<ComputerWorkLane, T> {
  return Object.fromEntries(
    computerWorkLanes.map((lane) => [lane, factory(lane)]),
  ) as Record<ComputerWorkLane, T>;
}

function requirePositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${label} must be a positive safe integer`);
}

function validateHistogramBounds(bounds: readonly number[]): void {
  let previous = 0;
  for (const bound of bounds) {
    requirePositiveInteger(bound, "histogram bound");
    if (bound <= previous)
      throw new RangeError("Histogram bounds must increase strictly");
    previous = bound;
  }
}
