import { describe, expect, it, vi } from "vitest";

import { scheduleOwnedFinalization } from "../../src/application/computer/deferredFinalization.js";

describe("scheduleOwnedFinalization", (): void => {
  it("keeps ownership until every deferred step reaches a terminal result", (): void => {
    const active = new Set<string>();
    const callbacks: (() => void)[] = [];
    const completed: string[] = [];
    const failures: string[] = [];

    const result = scheduleOwnedFinalization(active, "block-1", {
      prepare: [
        (): never => {
          throw new Error("shutdown failed");
        },
        (): void => {
          completed.push("flush");
        },
      ],
      schedule: (callback): void => {
        callbacks.push(callback);
      },
      finalize: [
        (): never => {
          throw new Error("cleanup failed");
        },
        (): void => {
          completed.push("give-item");
        },
      ],
      onFailure: (phase): void => {
        failures.push(phase);
      },
    });

    expect(result).toEqual({ outcome: "scheduled" });
    expect(active.has("block-1")).toBe(true);
    expect(completed).toEqual(["flush"]);
    callbacks[0]?.();
    expect(completed).toEqual(["flush", "give-item"]);
    expect(failures).toEqual(["prepare", "finalize"]);
    expect(active.has("block-1")).toBe(false);
  });

  it("releases ownership when scheduling itself fails", (): void => {
    const active = new Set<string>();
    const onFailure = vi.fn();

    const result = scheduleOwnedFinalization(active, "block-2", {
      prepare: [],
      schedule: (): never => {
        throw new Error("world closed");
      },
      finalize: [],
      onFailure,
    });

    expect(result.outcome).toBe("schedule_failed");
    expect(active.has("block-2")).toBe(false);
    expect(onFailure).toHaveBeenCalledWith("schedule", expect.any(Error));
  });

  it("continues finalization when failure reporting also throws", (): void => {
    const active = new Set<string>();
    let callback: (() => void) | undefined;
    const completed: string[] = [];

    expect(
      scheduleOwnedFinalization(active, "block-3", {
        prepare: [
          (): never => {
            throw new Error("prepare failed");
          },
          (): void => {
            completed.push("prepare");
          },
        ],
        schedule: (scheduled): void => {
          callback = scheduled;
        },
        finalize: [
          (): never => {
            throw new Error("finalize failed");
          },
          (): void => {
            completed.push("finalize");
          },
        ],
        onFailure: (): never => {
          throw new Error("report failed");
        },
      }).outcome,
    ).toBe("scheduled");
    expect(completed).toEqual(["prepare"]);
    callback?.();
    expect(completed).toEqual(["prepare", "finalize"]);
    expect(active.has("block-3")).toBe(false);
  });

  it("rejects an empty ownership key before mutating state", (): void => {
    const active = new Set<string>();
    expect(() =>
      scheduleOwnedFinalization(active, "", {
        prepare: [],
        schedule: vi.fn(),
        finalize: [],
        onFailure: vi.fn(),
      }),
    ).toThrow(/key is empty/u);
    expect(active.size).toBe(0);
  });
});
