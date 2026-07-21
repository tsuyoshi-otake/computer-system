import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python numeric semantics", (): void => {
  it("keeps integer arithmetic exact beyond the host safe-integer range", (): void => {
    const machine = runPythonCs486(`
large = 9007199254740993
sum_result = large + 10
product = 12345678901234567890 * 9
power = 2 ** 200
bool_sum = True + 41
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("large")).toBe(9_007_199_254_740_993n);
    expect(machine.globals.get("sum_result")).toBe(9_007_199_254_741_003n);
    expect(machine.globals.get("product")).toBe(111_111_110_111_111_111_010n);
    expect(machine.globals.get("power")).toBe(2n ** 200n);
    expect(machine.globals.get("bool_sum")).toBe(42);
  });

  it("executes base literals, shifts, and infinite-sign bitwise operations", (): void => {
    const machine = runPythonCs486(`
masked = 0x_FF & 0b_10101010
shifted = (1 << 100) | 3
right = shifted >> 96
inverted = ~0
mixed = 0o_17 ^ 0b_101
stable_power = (-1) ** 100000000000000000000
far_right = -3 >> 100000000000000000000
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("masked")).toBe(170);
    expect(machine.globals.get("shifted")).toBe((1n << 100n) | 3n);
    expect(machine.globals.get("right")).toBe(16);
    expect(machine.globals.get("inverted")).toBe(-1);
    expect(machine.globals.get("mixed")).toBe(10);
    expect(machine.globals.get("stable_power")).toBe(1);
    expect(machine.globals.get("far_right")).toBe(-1);
  });

  it("formats arbitrary integers exactly and rejects unsafe native conversion", (): void => {
    const printed = runPythonCs486("print(9007199254740993)\n");
    const rejected = runPythonCs486("result = range(9007199254740993)\n");

    expect(printed.state.kind).toBe("completed");
    expect(printed.terminal.line(1).trim()).toBe("9007199254740993");
    expect(rejected.state.kind).toBe("crashed");
    if (rejected.state.kind === "crashed") {
      expect(rejected.state.error.typeName).toBe("OverflowError");
    }
  });

  it("uses Python floor-division and modulo sign rules", (): void => {
    const machine = runPythonCs486(`
negative_left_floor = -7 // 3
negative_left_mod = -7 % 3
negative_right_floor = 7 // -3
negative_right_mod = 7 % -3
true_division = 5 / 2
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("negative_left_floor")).toBe(-3);
    expect(machine.globals.get("negative_left_mod")).toBe(2);
    expect(machine.globals.get("negative_right_floor")).toBe(-3);
    expect(machine.globals.get("negative_right_mod")).toBe(-2);
    expect(machine.globals.get("true_division")).toBe(2.5);
  });

  it("compares arbitrary integers with floats without host rounding", (): void => {
    const machine = runPythonCs486(`
different = 9007199254740993 == 9007199254740992.0
ordered = 9007199254740993 > 9007199254740992.0
small_equal = 42 == 42.0
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("different")).toBe(false);
    expect(machine.globals.get("ordered")).toBe(true);
    expect(machine.globals.get("small_equal")).toBe(true);
  });

  it.each([
    ["negative shift", "result = 1 << -1\n", "ValueError"],
    ["zero floor division", "result = 1 // 0\n", "ZeroDivisionError"],
    ["zero modulo", "result = 1 % 0\n", "ZeroDivisionError"],
    ["float bitwise", "result = 1.5 & 1\n", "TypeError"],
    ["zero negative power", "result = 0 ** -1\n", "ZeroDivisionError"],
  ])("reports %s explicitly", (_name, source, typeName): void => {
    const machine = runPythonCs486(source);

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe(typeName);
    }
  });

  it("accepts the integer-bit ceiling and rejects capacity plus one", (): void => {
    const limits = { ...defaultPythonRuntimeLimits, maxIntegerBits: 64 };
    const exact = runPythonCs486("result = 1 << 63\n", { limits });
    const excessiveShift = runPythonCs486("result = 1 << 64\n", { limits });
    const excessiveLiteral = runPythonCs486("result = 18446744073709551616\n", {
      limits,
    });

    expect(exact.state.kind).toBe("completed");
    expect(exact.globals.get("result")).toBe(1n << 63n);
    for (const machine of [excessiveShift, excessiveLiteral]) {
      expect(machine.state.kind).toBe("crashed");
      if (machine.state.kind === "crashed") {
        expect(machine.state.error.typeName).toBe("ResourceLimitError");
        expect(machine.state.error.message).toMatch(/integer bits/u);
      }
    }
  });

  it("rejects explosive powers before allocating their result", (): void => {
    const machine = runPythonCs486("result = 2 ** 1000000\n");

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("ResourceLimitError");
      expect(machine.state.error.message).toMatch(/integer bits/u);
    }
  });

  it("accounts reachable arbitrary integers in the managed heap", (): void => {
    const large = runPythonCs486("result = 1 << 200000\n");
    const small = runPythonCs486("result = 1\n");

    expect(large.state.kind).toBe("completed");
    expect(small.state.kind).toBe("completed");
    expect(large.memoryUsageBytes - small.memoryUsageBytes).toBeGreaterThan(
      20_000,
    );
  });
});
