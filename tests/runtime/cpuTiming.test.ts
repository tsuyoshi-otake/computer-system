import { describe, expect, it } from "vitest";

import {
  computerNominalClockHz,
  cpuCyclesPerTick,
  cpuCyclesToMicroseconds,
  pythonBytecodeCpuCycles,
} from "../../src/domain/cpu/timing.js";

const span = {
  end: { column: 1, line: 1, offset: 0 },
  start: { column: 1, line: 1, offset: 0 },
};

describe("shared CPU timing", (): void => {
  it("derives one 20 Hz tick and virtual time from the 33 MHz clock", (): void => {
    expect(cpuCyclesPerTick(computerNominalClockHz, 20)).toBe(1_650_000);
    expect(cpuCyclesToMicroseconds(33)).toBe(1);
  });

  it("charges Python bytecode by operation and linear input size", (): void => {
    const load = pythonBytecodeCpuCycles({
      op: "LOAD_CONST",
      span,
      value: 42,
    });
    const call0 = pythonBytecodeCpuCycles({
      argumentNames: [],
      op: "CALL",
      span,
    });
    const call3 = pythonBytecodeCpuCycles({
      argumentNames: [undefined, undefined, undefined],
      op: "CALL",
      span,
    });

    expect(load).toBeGreaterThan(20);
    expect(call0).toBeGreaterThan(load);
    expect(call3 - call0).toBe(3 * 192);
  });
});
