import { describe, expect, it } from "vitest";

import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";

describe("ComputerRuntime WorkBench diagnostics", (): void => {
  it("preserves deferred compiler codes, notes, and F3 navigation", (): void => {
    const record = new ComputerRecord("c-000941", "standard", {
      displayProfileId: "portable-vga-256k",
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    expect(runtime.register(record).outcome).toBe("accepted");
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runUntil(runtime, () => accepts(runtime, record.computerId, "line"));
    record.filesystem.writeFile(
      "/drives/c/bad.asm",
      [".CODE", "foo:", "foo:", "ret", ""].join("\r\n"),
    );

    queue(runtime, record.computerId, "terminal_line", "CSASM C:\\BAD.ASM");
    runUntil(
      runtime,
      () => runtime.terminalInteraction(record.computerId).context === "csasm",
    );
    queue(
      runtime,
      record.computerId,
      "terminal_keys",
      JSON.stringify(["Enter"]),
    );
    runUntil(runtime, () => accepts(runtime, record.computerId, "keys"));
    queue(runtime, record.computerId, "terminal_keys", JSON.stringify(["F7"]));
    runUntil(runtime, () => terminalText(record).includes("error CSASM001"));

    expect(terminalText(record)).toContain("duplicate symbol foo");
    expect(terminalText(record)).toContain("note: foo was first defined here");
    queue(runtime, record.computerId, "terminal_keys", JSON.stringify(["F3"]));
    runUntil(runtime, () => record.terminal.snapshot().cursor.y === 5);
    expect(terminalText(record)).not.toContain("error CSASM001");
  });
});

function queue(
  runtime: ComputerRuntime,
  computerId: string,
  event: string,
  value: string,
): void {
  expect(runtime.queueEvent(computerId, event, value)).toMatchObject({
    outcome: "accepted",
  });
  runtime.runTick();
}

function accepts(
  runtime: ComputerRuntime,
  computerId: string,
  inputMode: "keys" | "line",
): boolean {
  return runtime.terminalInteraction(computerId).inputMode === inputMode;
}

function runUntil(
  runtime: ComputerRuntime,
  predicate: () => boolean,
  maximumTicks = 512,
): void {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("Runtime did not reach the expected WorkBench state.");
}

function terminalText(record: ComputerRecord): string {
  return record.terminal.snapshot().rows.join("\n");
}
