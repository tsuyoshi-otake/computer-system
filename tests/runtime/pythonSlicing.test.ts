import { describe, expect, it } from "vitest";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python built-in slicing", (): void => {
  it("reads clipped positive and negative slices from built-in sequences", (): void => {
    const machine = runPythonCs486(`
text = "abcdef"
forward = text[1:6:2]
reverse = text[::-1]
unicode = "A😀B"[1:2]
list_value = [0, 1, 2, 3, 4][-100:100:2]
tuple_value = (0, 1, 2, 3, 4)[4:0:-2]
huge_bounds = [0, 1, 2][-999999999999999999999999:999999999999999999999999]
huge_forward_step = [0, 1, 2][::999999999999999999999999]
huge_backward_step = [0, 1, 2][::-999999999999999999999999]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("forward")).toBe("bdf");
    expect(machine.globals.get("reverse")).toBe("fedcba");
    expect(machine.globals.get("unicode")).toBe("😀");
    expect(machine.globals.get("list_value")).toEqual({
      kind: "list",
      values: [0, 2, 4],
    });
    expect(machine.globals.get("tuple_value")).toEqual({
      kind: "tuple",
      values: [4, 2],
    });
    expect(machine.globals.get("huge_bounds")).toEqual({
      kind: "list",
      values: [0, 1, 2],
    });
    expect(machine.globals.get("huge_forward_step")).toEqual({
      kind: "list",
      values: [0],
    });
    expect(machine.globals.get("huge_backward_step")).toEqual({
      kind: "list",
      values: [2],
    });
  });

  it.each([
    ["zero step", "value = [1, 2][::0]\n", "ValueError"],
    ["float bound", "value = [1, 2][1.5:]\n", "TypeError"],
    ["non-sequence", "value = 1[:]\n", "TypeError"],
  ])("reports %s", (_name, source, typeName): void => {
    const machine = runPythonCs486(source);

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe(typeName);
    }
  });

  it("evaluates an assignment RHS before slice target expressions", (): void => {
    const machine = runPythonCs486(`
trace = 0
values = [0, 1, 2, 3]
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
mark(2, values)[mark(3, 1):mark(4, 3)] = mark(1, [8, 9])
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(1234);
    expect(machine.globals.get("values")).toEqual({
      kind: "list",
      values: [0, 8, 9, 3],
    });
  });

  it("assigns extended slices and rejects a length mismatch before mutation", (): void => {
    const completed = runPythonCs486(
      "values = [0, 1, 2, 3]\nvalues[::-2] = [8, 9]\n",
    );
    const rejected = runPythonCs486(
      "values = [0, 1, 2, 3]\nvalues[::2] = [9]\n",
    );

    expect(completed.state.kind).toBe("completed");
    expect(completed.globals.get("values")).toEqual({
      kind: "list",
      values: [0, 9, 2, 8],
    });
    expect(rejected.state.kind).toBe("crashed");
    expect(rejected.globals.get("values")).toEqual({
      kind: "list",
      values: [0, 1, 2, 3],
    });
  });

  it("reports a zero step before inspecting the replacement iterable", (): void => {
    const machine = runPythonCs486("values = [0, 1]\nvalues[::0] = 1\n");

    expect(machine.state.kind).toBe("crashed");
    expect(machine.globals.get("values")).toEqual({
      kind: "list",
      values: [0, 1],
    });
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("ValueError");
    }
  });

  it("rejects a non-iterable replacement without mutating the list", (): void => {
    const machine = runPythonCs486("values = [0, 1]\nvalues[:] = 1\n");

    expect(machine.state.kind).toBe("crashed");
    expect(machine.globals.get("values")).toEqual({
      kind: "list",
      values: [0, 1],
    });
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("TypeError");
    }
  });

  it("keeps an arbitrary-precision non-unit step in extended-assignment mode", (): void => {
    const machine = runPythonCs486(
      "values = []\nvalues[::999999999999999999999999] = [1]\n",
    );

    expect(machine.state.kind).toBe("crashed");
    expect(machine.globals.get("values")).toEqual({ kind: "list", values: [] });
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("ValueError");
    }
  });

  it("accepts final capacity and rejects capacity plus one before mutation", (): void => {
    const exact = runPythonCs486("values = [0]\nvalues[:] = range(4096)\n");
    const excessive = runPythonCs486(
      "values = [0]\nvalues[0:0] = range(4096)\n",
    );

    expect(exact.state.kind).toBe("completed");
    expect(excessive.state.kind).toBe("crashed");
    expect(excessive.globals.get("values")).toEqual({
      kind: "list",
      values: [0],
    });
    if (excessive.state.kind === "crashed") {
      expect(excessive.state.error.typeName).toBe("ResourceLimitError");
    }
  });
});
