import { describe, expect, it } from "vitest";

import {
  computerNominalClockHz,
  cpuCyclesPerTick,
  cpuCyclesToMicroseconds,
} from "../../src/domain/cpu/timing.js";
import { PythonCs486Harness } from "./pythonCs486Harness.js";

describe("shared CPU timing", (): void => {
  it("derives one 20 Hz tick and virtual time from the 33 MHz clock", (): void => {
    expect(cpuCyclesPerTick(computerNominalClockHz, 20)).toBe(1_650_000);
    expect(cpuCyclesToMicroseconds(33)).toBe(1);
  });

  it("charges Python as CS486 instructions and linear syscall work", (): void => {
    const noArguments = cycles("def pick():\n    return 1\nvalue = pick()\n");
    const threeArguments = cycles(
      "def pick(a, b, c):\n    return a\nvalue = pick(1, 2, 3)\n",
    );

    expect(noArguments).toBeGreaterThan(20);
    expect(threeArguments).toBeGreaterThan(noArguments);
  });
});

function cycles(source: string): number {
  const machine = new PythonCs486Harness(source);
  let total = 0;
  for (
    let count = 0;
    count < 100 &&
    (machine.state.kind === "ready" || machine.hasPendingCpuCycles);
    count += 1
  )
    total += machine.runCpuSlice(100_000).cpuCycles;
  expect(machine.state.kind).toBe("completed");
  return total;
}
