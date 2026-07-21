import { describe, expect, it } from "vitest";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python iterable and mapping unpacking", (): void => {
  it("evaluates and expands display items from left to right", (): void => {
    const machine = runPythonCs486(`
trace = 0
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
result = [*mark(1, [10, 20]), mark(2, 30), *mark(3, [40, 50])]
tuple_result = (0, *[1, 2], 3)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(123);
    expect(machine.globals.get("result")).toEqual({
      kind: "list",
      values: [10, 20, 30, 40, 50],
    });
    expect(machine.globals.get("tuple_result")).toEqual({
      kind: "tuple",
      values: [0, 1, 2, 3],
    });
  });

  it("merges dictionary unpacking left to right with later overwrite", (): void => {
    const machine = runPythonCs486(`
trace = 0
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
result = {**mark(1, {"key": 1}), "key": mark(2, 2), **mark(3, {"other": 3})}
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(123);
    expect(machine.globals.get("result")).toEqual({
      kind: "dictionary",
      entries: new Map([
        ["key", 2],
        ["other", 3],
      ]),
    });
  });

  it("destructures nested and starred targets into left-to-right bindings", (): void => {
    const machine = runPythonCs486(`
first, *middle, [last, *tail] = [1, 2, 3, [4, 5, 6]]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("middle")).toEqual({
      kind: "list",
      values: [2, 3],
    });
    expect(machine.globals.get("last")).toBe(4);
    expect(machine.globals.get("tail")).toEqual({
      kind: "list",
      values: [5, 6],
    });
  });

  it("evaluates one destructuring RHS then target expressions left to right", (): void => {
    const machine = runPythonCs486(`
trace = 0
left = [0]
right = [0]
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
mark(2, left)[0], mark(3, right)[0] = mark(1, [40, 2])
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(123);
    expect(machine.globals.get("left")).toEqual({
      kind: "list",
      values: [40],
    });
    expect(machine.globals.get("right")).toEqual({
      kind: "list",
      values: [2],
    });
  });

  it.each([
    ["too few", "first, second = [1]\n", "ValueError"],
    ["too many", "first, second = [1, 2, 3]\n", "ValueError"],
    ["non-iterable", "first, second = 1\n", "TypeError"],
    ["non-mapping", "value = {**[1, 2]}\n", "TypeError"],
  ])("reports %s unpacking", (_name, source, typeName): void => {
    const machine = runPythonCs486(source);

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe(typeName);
    }
  });

  it("accepts expanded collection capacity and rejects capacity plus one", (): void => {
    const exact = runPythonCs486("value = [*range(4096)]\n");
    const excessive = runPythonCs486("value = [*range(4096), 1]\n");

    expect(exact.state.kind).toBe("completed");
    expect(excessive.state.kind).toBe("crashed");
    if (excessive.state.kind === "crashed") {
      expect(excessive.state.error.typeName).toBe("ResourceLimitError");
    }
  });
});
