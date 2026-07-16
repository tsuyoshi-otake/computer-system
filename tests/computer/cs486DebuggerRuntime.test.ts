import { describe, expect, it } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("ComputerRuntime CS486 debugger scheduling", (): void => {
  it("slices MCP debugger operations and retains the paused debuggee", (): void => {
    const record = computer("c-000041");
    const runtime = runtimeWith(record, 8);
    runtime.powerOn(record.computerId);
    runTicks(runtime, 2);
    record.filesystem.writeFile(
      "/tmp/loop.asm",
      "global main\nmain:\nadd eax, 1\njmp main\n",
    );

    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "as /tmp/loop.asm -o /tmp/loop",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });
    expect(
      runtime.executeDebugShellCommand(record.computerId, "csdb /tmp/loop"),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });

    const continueCompletions: DebugShellCommandCompletion[] = [];
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "csdb continue 25",
      (result) => {
        continueCompletions.push(result);
      },
    );
    expect(continueCompletions).toHaveLength(0);
    runUntil(runtime, () => continueCompletions.length > 0);
    const continued = continueCompletions[0];
    expect(continued).toMatchObject({
      outcome: "completed",
      exitCode: 124,
      stderr: "",
    });
    if (continued?.outcome === "completed") {
      expect(continued.stdout).toMatch(/continue limit reached/u);
      expect(continued.cpuCycles).toBeGreaterThan(0);
    }

    const stepCompletions: DebugShellCommandCompletion[] = [];
    runtime.enqueueDebugShellCommand(
      record.computerId,
      "csdb step",
      (result) => {
        stepCompletions.push(result);
      },
    );
    runUntil(runtime, () => stepCompletions.length > 0);
    const stepped = stepCompletions[0];
    expect(stepped).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      stderr: "",
    });
    if (stepped?.outcome === "completed")
      expect(stepped.stdout).toMatch(/\(step;/u);
  });

  it("finalizes Ctrl+C at an instruction boundary and can resume", (): void => {
    const record = computer("c-000042");
    const runtime = runtimeWith(record, 4);
    runtime.powerOn(record.computerId);
    runUntil(
      runtime,
      () => runtime.vmState(record.computerId)?.kind === "waiting_event",
    );
    record.filesystem.writeFile(
      "/tmp/loop.asm",
      "global main\nmain:\nmul eax, 7\nadd eax, 1\njmp main\n",
    );
    expect(
      runtime.executeDebugShellCommand(
        record.computerId,
        "as /tmp/loop.asm -o /tmp/loop",
      ),
    ).toMatchObject({ outcome: "completed", exitCode: 0 });

    runtime.queueEvent(record.computerId, "terminal_line", "csdb /tmp/loop");
    runUntil(
      runtime,
      () =>
        runtime.vmState(record.computerId)?.kind === "waiting_event" &&
        record.terminal.snapshot().rows.join("\n").includes("loaded /tmp/loop"),
    );
    runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "csdb continue 100000",
    );
    runUntil(runtime, () =>
      record.terminal
        .snapshot()
        .rows.join("\n")
        .includes("csdb continue 100000"),
    );
    runTicks(runtime, 10);
    const interruptedResult = runtime.interrupt(record.computerId);
    expect(interruptedResult.outcome).toBe("accepted");
    if (interruptedResult.outcome === "accepted")
      expect(
        interruptedResult.state,
        record.terminal.snapshot().rows.join("\n"),
      ).toBe("foreground_interrupted");
    runUntil(
      runtime,
      () => runtime.vmState(record.computerId)?.kind === "waiting_event",
    );
    const interrupted = record.terminal.snapshot().rows.join("\n");
    expect(interrupted).toContain("^C");
    expect(interrupted).toContain("interrupted");

    runtime.queueEvent(record.computerId, "terminal_line", "csdb step");
    runUntil(runtime, () =>
      record.terminal.snapshot().rows.join("\n").includes("(step;"),
    );
  });
});

function computer(id: string): ComputerRecord {
  return new ComputerRecord(id, "standard");
}

function runtimeWith(
  record: ComputerRecord,
  cpuCyclesPerTick: number,
): ComputerRuntime {
  const runtime = new ComputerRuntime({
    schedulerLimits: {
      cpuCyclesPerComputer: cpuCyclesPerTick,
      cpuCyclesPerTick,
      eventCapacity: 8,
      instructionsPerComputer: 32,
      instructionsPerTick: 32,
      timerCapacity: 8,
    },
  });
  runtime.register(record);
  return runtime;
}

function runTicks(runtime: ComputerRuntime, count: number): void {
  for (let tick = 0; tick < count; tick += 1) runtime.runTick();
}

function runUntil(runtime: ComputerRuntime, predicate: () => boolean): void {
  for (let tick = 0; tick < 1_000; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("runtime did not reach the expected terminal state");
}
