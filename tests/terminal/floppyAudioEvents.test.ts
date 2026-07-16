import { describe, expect, it } from "vitest";

import {
  FloppyAudioEventBroker,
  floppyAudioEventCapacity,
  maximumFloppyAudioEventsPerSecond,
} from "../../src/application/terminal/floppyAudioEvents.js";

describe("FloppyAudioEventBroker", () => {
  it("assigns monotonic per-Computer sequences and returns only unseen events", () => {
    const broker = new FloppyAudioEventBroker();
    expect(broker.record("c-000001", "insert", 1)?.sequence).toBe(1);
    expect(broker.record("c-000002", "insert", 1)?.sequence).toBe(1);
    expect(broker.record("c-000001", "motor_start", 2)?.sequence).toBe(2);

    expect(broker.eventsAfter("c-000001", 1)).toEqual({
      events: [{ kind: "motor_start", sequence: 2, tick: 2 }],
      latestSequence: 2,
    });
  });

  it("bounds the ring at 32 and suppresses more than eight events per second", () => {
    const broker = new FloppyAudioEventBroker();
    for (let second = 0; second < 5; second += 1) {
      const tick = second * 20;
      for (let index = 0; index < maximumFloppyAudioEventsPerSecond; index += 1)
        expect(broker.record("c-000001", "seek", tick)).toBeDefined();
      expect(broker.record("c-000001", "read", tick)).toBeUndefined();
    }
    const batch = broker.eventsAfter("c-000001", 0);
    expect(batch.events).toHaveLength(floppyAudioEventCapacity);
    expect(batch.latestSequence).toBe(40);
    expect(batch.events[0]?.sequence).toBe(9);
  });

  it("rejects regressing ticks and bounds Computer allocation", () => {
    const broker = new FloppyAudioEventBroker(1);
    expect(broker.record("c-000001", "insert", 10)).toBeDefined();
    expect(broker.record("c-000001", "seek", 9)).toBeUndefined();
    expect(broker.record("c-000002", "insert", 10)).toBeUndefined();
    expect(broker.latestSequence("c-000001")).toBe(1);
  });
});
