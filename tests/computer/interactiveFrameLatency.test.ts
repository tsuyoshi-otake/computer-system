import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { defaultSchedulerLimits } from "../../src/application/runtime/scheduler.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

/**
 * Keys an interactive full-screen CS ABI program answers with a new frame. They
 * make the frame the observable terminal state, so latency is counted in
 * scheduler ticks and never in host wall-clock time.
 */
const frameProducingKeys = ["l", "l", "h", "j", "k", "?", "l", "y", "u", "b"];

describe("interactive frame latency", (): void => {
  it("needs the same ticks per frame whether or not one dispatch is divided", (): void => {
    const divided = measureFrameTicks(undefined, "c-006491");
    const undivided = measureFrameTicks(1_650_000, "c-006492");

    // Dividing a dispatch changes only how much guest work one host operation
    // carries. The Computer still receives the same cycles per tick, so the
    // guest reaches each frame on exactly the same tick.
    expect(divided).toEqual(undivided);
  }, 900_000);

  it("answers an ordinary interactive key within three modeled ticks", (): void => {
    const ticks = measureFrameTicks(undefined, "c-006493");

    // Measured bounds, asserted so a regression in modeled interactive cost
    // fails here. Generating the first level costs more than answering a key.
    expect(ticks.launchToFrame).toBeLessThanOrEqual(4);
    expect(ticks.perKey).toHaveLength(frameProducingKeys.length);
    for (const count of ticks.perKey) {
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(3);
    }
  }, 900_000);
});

interface FrameTicks {
  readonly launchToFrame: number;
  readonly perKey: readonly number[];
}

function measureFrameTicks(
  maximumAtomicCpuCycles: number | undefined,
  computerId: string,
): FrameTicks {
  const runtime = new ComputerRuntime(
    maximumAtomicCpuCycles === undefined
      ? {}
      : {
          schedulerLimits: {
            ...defaultSchedulerLimits,
            maximumAtomicCpuCycles,
          },
        },
  );
  const record = new ComputerRecord(computerId, "standard");
  runtime.register(record);
  runtime.powerOn(record.computerId);
  const text = (): string => record.terminal.snapshot().rows.join("\n");
  const runUntil = (predicate: () => boolean, what: string): number => {
    for (let elapsed = 0; elapsed <= 2_000; elapsed += 1) {
      if (predicate()) return elapsed;
      runtime.runTick();
    }
    throw new Error(`${what} did not happen within 2000 ticks`);
  };

  runUntil(
    () =>
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post",
    "boot",
  );
  runUntil(() => shellAcceptsLines(runtime, record), "shell prompt");

  expect(
    runtime.queueEvent(record.computerId, "terminal_line", "nethack"),
  ).toMatchObject({ outcome: "accepted" });
  // The status row only exists once the program has generated its level and
  // drawn a frame, so it distinguishes a real first frame from the shell
  // merely clearing the screen.
  const launchToFrame = runUntil(
    () => text().includes("Dlvl:"),
    "first game frame",
  );

  const perKey: number[] = [];
  for (const key of frameProducingKeys) {
    const before = text();
    expect(
      runtime.queueEvent(
        record.computerId,
        "terminal_keys",
        JSON.stringify([key]),
      ),
    ).toMatchObject({ outcome: "accepted" });
    perKey.push(runUntil(() => text() !== before, `frame after ${key}`));
  }
  return { launchToFrame, perKey };
}

function shellAcceptsLines(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): boolean {
  const state = runtime.vmState(record.computerId);
  return (
    runtime.terminalInteraction(record.computerId).inputMode === "line" &&
    state?.kind === "waiting_event" &&
    state.filter === undefined
  );
}
