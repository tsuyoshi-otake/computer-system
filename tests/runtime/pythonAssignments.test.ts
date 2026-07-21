import { describe, expect, it } from "vitest";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python assignment evaluation", (): void => {
  it("evaluates one chained RHS then assigns targets from left to right", (): void => {
    const machine = runPythonCs486(`
trace = 0
left = [0]
right = [0]
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
mark(2, left)[mark(3, 0)] = mark(4, right)[mark(5, 0)] = mark(1, 42)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(12345);
    expect(machine.globals.get("left")).toEqual({
      kind: "list",
      values: [42],
    });
    expect(machine.globals.get("right")).toEqual({
      kind: "list",
      values: [42],
    });
  });

  it("evaluates an augmented subscription target once before its RHS", (): void => {
    const machine = runPythonCs486(`
trace = 0
values = [40]
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
mark(1, values)[mark(2, 0)] += mark(3, 2)
answer = values[0]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(123);
    expect(machine.globals.get("answer")).toBe(42);
  });

  it("evaluates an ordinary RHS before an attribute target", (): void => {
    const machine = runPythonCs486(`
import os
trace = 0
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
mark(2, os).answer = mark(1, 42)
result = os.answer
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(12);
    expect(machine.globals.get("result")).toBe(42);
  });

  it("evaluates an augmented attribute target once before its RHS", (): void => {
    const machine = runPythonCs486(`
import os
os.value = 40
trace = 0
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
mark(1, os).value += mark(2, 2)
answer = os.value
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("trace")).toBe(12);
    expect(machine.globals.get("answer")).toBe(42);
  });

  it("updates an explicitly shared nonlocal cell", (): void => {
    const machine = runPythonCs486(`
def outer():
    value = 40
    def increment():
        nonlocal value
        value += 1
        return value
    increment()
    return increment()
answer = outer()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("answer")).toBe(42);
  });

  it("retains integer growth preflight for augmented power", (): void => {
    const machine = runPythonCs486("value = 2\nvalue **= 1000000\n");

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("ResourceLimitError");
    }
  });
});
