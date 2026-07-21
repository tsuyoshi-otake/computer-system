import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type { RuntimeValue } from "../../src/domain/runtime/value.js";
import { runPythonCs486 } from "./pythonCs486Harness.js";

function setValues(value: RuntimeValue | undefined): readonly RuntimeValue[] {
  if (typeof value === "object" && value !== null && value.kind === "set") {
    return [...value.entries.values()];
  }
  throw new Error("Expected a runtime set");
}

describe("Computer System Python sets and comprehensions", (): void => {
  it("constructs deterministic bounded sets with unpacking, membership, equality, and set()", (): void => {
    const machine = runPythonCs486(`
values = {3, 1, 3, *[2, 1]}
empty = set()
copied = set([1, 2, 1])
numeric = {True, 1, 1.0}
tuples = {(1, 2), (1, 2)}
size = len(values)
present = 2 in values
same = values == {1, 2, 3}
tuple_present = (1, 2) in tuples
`);

    expect(machine.state.kind).toBe("completed");
    expect(setValues(machine.globals.get("values"))).toEqual([3, 1, 2]);
    expect(setValues(machine.globals.get("empty"))).toEqual([]);
    expect(setValues(machine.globals.get("copied"))).toEqual([1, 2]);
    expect(setValues(machine.globals.get("numeric"))).toEqual([true]);
    expect(setValues(machine.globals.get("tuples"))).toHaveLength(1);
    expect(machine.globals.get("size")).toBe(3);
    expect(machine.globals.get("present")).toBe(true);
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("tuple_present")).toBe(true);
  });

  it.each([
    ["two positional arguments", "result = set([], [])\n"],
    ["a keyword argument", "result = set(value=[1])\n"],
    ["a non-iterable argument", "result = set(1)\n"],
  ])("rejects set() with %s", (_name, source): void => {
    const machine = runPythonCs486(source);

    expect(machine.state.kind).toBe("crashed");
    expect(machine.globals.has("result")).toBe(false);
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("TypeError");
    }
  });

  it("evaluates the leftmost iterable once and later clauses left to right", (): void => {
    const machine = runPythonCs486(`
order = 0
def outer():
    global order
    order = order * 10 + 1
    return [1, 2]
def later(value):
    global order
    order = order * 10 + value + 1
    return [3]
def allowed(value):
    global order
    order = order * 10 + 4
    return True
def emit(left, right):
    global order
    order = order * 10 + 5
    return left * 10 + right
result = [emit(x, y) for x in outer() for y in later(x) if allowed(y)]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toEqual({
      kind: "list",
      values: [13, 23],
    });
    expect(machine.globals.get("order")).toBe(1_245_345);
  });

  it("keeps targets local, supports unpacking, and binds walrus results outside", (): void => {
    const machine = runPythonCs486(`
x = 99
pairs = [(1, 2), (3, 4)]
combined = [left * 10 + right for left, right in pairs]
doubled = [x * 2 for x in [1, 2]]
after = x
total = 0
partials = [total := total + value for value in [2, 3, 4]]
selected = [value for value in [0, 2] if (seen := value)]
def local_total():
    total = 0
    values = [total := total + value for value in [1, 2, 3]]
    return total * 10 + values[2]
function_result = local_total()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("combined")).toEqual({
      kind: "list",
      values: [12, 34],
    });
    expect(machine.globals.get("doubled")).toEqual({
      kind: "list",
      values: [2, 4],
    });
    expect(machine.globals.get("after")).toBe(99);
    expect(machine.globals.has("left")).toBe(false);
    expect(machine.globals.has("right")).toBe(false);
    expect(machine.globals.get("partials")).toEqual({
      kind: "list",
      values: [2, 5, 9],
    });
    expect(machine.globals.get("total")).toBe(9);
    expect(machine.globals.get("selected")).toEqual({
      kind: "list",
      values: [2],
    });
    expect(machine.globals.get("seen")).toBe(2);
    expect(machine.globals.get("function_result")).toBe(66);
  });

  it("evaluates leftmost iterables outside and composes nested implicit scopes", (): void => {
    const machine = runPythonCs486(`
x = 10
leftmost = [x for x in [x]]
after = x
dependent = [x * 10 + y for x in [1, 2] for y in [x + 3]]
nested = [[x * y for y in [1, 2]] for x in [3, 4]]
captured = 0
walrus_nested = [[captured := x + y for y in [1]] for x in [1, 2]]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("leftmost")).toEqual({
      kind: "list",
      values: [10],
    });
    expect(machine.globals.get("after")).toBe(10);
    expect(machine.globals.get("dependent")).toEqual({
      kind: "list",
      values: [14, 25],
    });
    expect(machine.globals.get("nested")).toEqual({
      kind: "list",
      values: [
        { kind: "list", values: [3, 6] },
        { kind: "list", values: [4, 8] },
      ],
    });
    expect(machine.globals.get("captured")).toBe(3);
  });

  it("evaluates dictionary keys before values and applies duplicate-key/set semantics", (): void => {
    const machine = runPythonCs486(`
order = 0
def key(value):
    global order
    order = order * 10 + 1
    return value % 2
def item(value):
    global order
    order = order * 10 + 2
    return value * 10
mapping = {key(value): item(value) for value in [3, 4, 5]}
unique = {value % 2 for value in [1, 2, 3, 4]}
zero = mapping[0]
one = mapping[1]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("order")).toBe(121_212);
    expect(machine.globals.get("zero")).toBe(40);
    expect(machine.globals.get("one")).toBe(50);
    expect(setValues(machine.globals.get("unique"))).toEqual([1, 0]);
  });

  it("preflights collection growth at the exact limit", (): void => {
    const exact = runPythonCs486('result = [value for value in "ab"]\n', {
      limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 2 },
    });
    const exceeded = runPythonCs486('result = [value for value in "ab"]\n', {
      limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
    });
    const duplicateSet = runPythonCs486(
      'result = {value for value in "aaa"}\n',
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );
    const exactSet = runPythonCs486('result = set("ab")\n', {
      limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 2 },
    });
    const exceededSet = runPythonCs486('result = set("ab")\n', {
      limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
    });

    expect(exact.state.kind).toBe("completed");
    expect(exact.globals.get("result")).toEqual({
      kind: "list",
      values: ["a", "b"],
    });
    expect(exceeded.state.kind).toBe("crashed");
    expect(exceeded.globals.has("result")).toBe(false);
    expect(duplicateSet.state.kind).toBe("completed");
    expect(setValues(duplicateSet.globals.get("result"))).toEqual(["a"]);
    expect(exactSet.state.kind).toBe("completed");
    expect(setValues(exactSet.globals.get("result"))).toEqual(["a", "b"]);
    expect(exceededSet.state.kind).toBe("crashed");
    expect(exceededSet.globals.has("result")).toBe(false);
    if (exceededSet.state.kind === "crashed") {
      expect(exceededSet.state.error.typeName).toBe("ResourceLimitError");
    }
  });

  it.each([
    ["list", "result = {1, [2]}\n"],
    ["dictionary", "result = {1, {2: 3}}\n"],
    ["set", "result = {1, {2}}\n"],
    ["nested list", "result = {(1, [2])}\n"],
  ])(
    "rejects a mutable %s element without publishing a partial set",
    (_name, source): void => {
      const machine = runPythonCs486(source);

      expect(machine.state.kind).toBe("crashed");
      expect(machine.globals.has("result")).toBe(false);
      if (machine.state.kind === "crashed") {
        expect(machine.state.error.typeName).toBe("TypeError");
      }
    },
  );

  it("does not leak a comprehension target or partial set after failure", (): void => {
    const machine = runPythonCs486("result = {value for value in [1, [2]]}\n");

    expect(machine.state.kind).toBe("crashed");
    expect(machine.globals.has("result")).toBe(false);
    expect(machine.globals.has("value")).toBe(false);
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("TypeError");
    }
  });

  it("bounds canonical set hashes before publishing the set", (): void => {
    const machine = runPythonCs486('result = {("a",)}\n', {
      limits: { ...defaultPythonRuntimeLimits, maxStringLength: 5 },
    });

    expect(machine.state.kind).toBe("crashed");
    expect(machine.globals.has("result")).toBe(false);
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("ResourceLimitError");
    }
  });
});
