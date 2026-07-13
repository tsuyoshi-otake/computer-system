import { describe, expect, it } from "vitest";

import { TerminalSnapshotScheduler } from "../../src/application/terminal/terminalSnapshotScheduler.js";

const options = {
  maximumEagerAttempts: 3,
  maximumEagerPerPass: 4,
  maximumPeriodicPerPass: 2,
} as const;

describe("TerminalSnapshotScheduler", (): void => {
  it("keeps periodic hot-path work fixed as active sessions scale", (): void => {
    const scheduler = new TerminalSnapshotScheduler(options);
    for (let index = 0; index < 32; index += 1) {
      scheduler.attach(`session-${String(index)}`);
    }

    expect(scheduler.takePeriodicBatch()).toEqual(["session-0", "session-1"]);
    expect(scheduler.takePeriodicBatch()).toEqual(["session-2", "session-3"]);
    expect(scheduler.activeCount).toBe(32);
  });

  it("deduplicates eager work and caps each pass independently of N", (): void => {
    const scheduler = new TerminalSnapshotScheduler(options);
    for (let index = 0; index < 8; index += 1) {
      const sessionId = `session-${String(index)}`;
      scheduler.attach(sessionId);
      expect(scheduler.requestEager(sessionId)).toBe("queued");
    }

    expect(scheduler.requestEager("session-0")).toBe("deduplicated");
    expect(scheduler.pendingEagerCount).toBe(8);
    expect(scheduler.takeEagerBatch()).toEqual([
      "session-0",
      "session-1",
      "session-2",
      "session-3",
    ]);
    expect(scheduler.takeEagerBatch()).toEqual([
      "session-4",
      "session-5",
      "session-6",
      "session-7",
    ]);
  });

  it("reaches an explicit eager terminal state on emit or exhaustion", (): void => {
    const scheduler = new TerminalSnapshotScheduler(options);
    scheduler.attach("session-1");
    scheduler.requestEager("session-1");

    expect(scheduler.takeEagerBatch()).toEqual(["session-1"]);
    expect(scheduler.completeEager("session-1", false)).toBe("retrying");
    expect(scheduler.takeEagerBatch()).toEqual(["session-1"]);
    expect(scheduler.completeEager("session-1", false)).toBe("retrying");
    expect(scheduler.takeEagerBatch()).toEqual(["session-1"]);
    expect(scheduler.completeEager("session-1", false)).toBe("exhausted");
    expect(scheduler.pendingEagerCount).toBe(0);

    scheduler.requestEager("session-1");
    expect(scheduler.takeEagerBatch()).toEqual(["session-1"]);
    expect(scheduler.completeEager("session-1", true)).toBe("emitted");
    expect(scheduler.pendingEagerCount).toBe(0);
  });

  it("finalizes queued work when a session detaches", (): void => {
    const scheduler = new TerminalSnapshotScheduler(options);
    scheduler.attach("session-1");
    scheduler.attach("session-2");
    scheduler.requestEager("session-1");

    expect(scheduler.detach("session-1")).toBe(true);
    expect(scheduler.pendingEagerCount).toBe(0);
    expect(scheduler.takeEagerBatch()).toEqual([]);
    expect(scheduler.takePeriodicBatch()).toEqual(["session-2"]);
    expect(scheduler.requestEager("session-1")).toBe("missing");
  });
});
