import { describe, expect, it } from "vitest";

import {
  ComputerWorkMonitor,
  defaultComputerWorkMonitorLimits,
  type MonotonicMicrosecondClock,
} from "../../src/application/runtime/computerWorkMonitor.js";

class FakeClock implements MonotonicMicrosecondClock {
  value = 0;

  nowMicroseconds(): number {
    return this.value;
  }

  advance(microseconds: number): void {
    this.value += microseconds;
  }
}

describe("ComputerWorkMonitor", (): void => {
  it("separates deterministic lane admission from measured host time", (): void => {
    const clock = new FakeClock();
    const monitor = new ComputerWorkMonitor(clock);
    const tick = monitor.beginTick(1);

    const result = tick.tryRun(
      { lane: "guest_cpu", deterministicUnits: 200 },
      () => {
        clock.advance(250);
        return 42;
      },
    );

    expect(result).toEqual({
      outcome: "ran",
      value: 42,
      hostMicroseconds: 250,
      overrun: false,
    });
    expect(tick.finish()).toEqual({
      hostMicroseconds: 250,
      maximumAtomicHostMicroseconds: 250,
      overrun: false,
      tick: 1,
    });
    expect(monitor.snapshot().lanes.guest_cpu).toMatchObject({
      admitted: 1,
      hostMicroseconds: 250,
      units: 200,
    });
  });

  it("defers lane overflow without running the operation", (): void => {
    const clock = new FakeClock();
    const monitor = new ComputerWorkMonitor(clock);
    const tick = monitor.beginTick(4);
    let called = 0;

    expect(
      tick.tryRun(
        {
          lane: "rs232",
          deterministicUnits:
            defaultComputerWorkMonitorLimits.laneUnitsPerTick.rs232 + 1,
        },
        () => {
          called += 1;
        },
      ),
    ).toEqual({ outcome: "deferred", reason: "lane_limit", retryTick: 5 });
    expect(called).toBe(0);
    tick.finish();
  });

  it("uses host time only as a guard for the next bounded atom", (): void => {
    const clock = new FakeClock();
    const monitor = new ComputerWorkMonitor(clock);
    const tick = monitor.beginTick(8);

    const first = tick.tryRun(
      { lane: "guest_cpu", deterministicUnits: 1 },
      () => clock.advance(8_100),
    );
    expect(first).toMatchObject({ outcome: "ran", overrun: true });
    expect(
      tick.tryRun(
        { lane: "guest_cpu", deterministicUnits: 1 },
        () => undefined,
      ),
    ).toEqual({
      outcome: "deferred",
      reason: "tick_soft_limit",
      retryTick: 9,
    });
    tick.finish();
  });

  it("accounts thrown operations exactly once and rethrows", (): void => {
    const clock = new FakeClock();
    const monitor = new ComputerWorkMonitor(clock);
    const tick = monitor.beginTick(2);

    expect(() =>
      tick.tryRun({ lane: "i2c", deterministicUnits: 9 }, () => {
        clock.advance(75);
        throw new Error("adapter failed");
      }),
    ).toThrow("adapter failed");
    tick.finish();

    expect(monitor.snapshot().lanes.i2c).toMatchObject({
      admitted: 1,
      failed: 1,
      hostMicroseconds: 75,
      units: 9,
    });
  });

  it("rejects overlapping or non-monotonic tick scopes", (): void => {
    const clock = new FakeClock();
    const monitor = new ComputerWorkMonitor(clock);
    const tick = monitor.beginTick(3);

    expect(() => monitor.beginTick(4)).toThrow("still active");
    tick.finish();
    expect(() => monitor.beginTick(3)).toThrow("increase monotonically");
  });

  it("reports bounded p50, p95, and p99 tick latency estimates", (): void => {
    const clock = new FakeClock();
    const monitor = new ComputerWorkMonitor(clock);
    const durations = [
      100, 200, 300, 900, 1_800, 3_500, 7_000, 11_000, 20_000, 30_000,
    ];
    for (const [index, duration] of durations.entries()) {
      const tick = monitor.beginTick(index + 1);
      clock.advance(duration);
      tick.finish();
    }

    expect(monitor.snapshot().tickHostMicroseconds).toEqual({
      p50: 2_000,
      p95: 24_001,
      p99: 24_001,
    });
  });
});
