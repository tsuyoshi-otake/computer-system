import { describe, expect, it } from "vitest";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python conditional and lambda runtime", (): void => {
  it("evaluates each condition first and exactly one result branch", (): void => {
    const machine = runPythonCs486(`
trace = 0
def mark(digit, value):
    global trace
    trace = trace * 10 + digit
    return value
yes = mark(1, 41) if mark(2, True) else missing_true
no = missing_false if mark(3, False) else mark(4, 42)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("yes")).toBe(41);
    expect(machine.globals.get("no")).toBe(42);
    expect(machine.globals.get("trace")).toBe(2134);
  });

  it("binds lambda parameters and evaluates defaults once left to right", (): void => {
    const machine = runPythonCs486(`
order = 0
def mark(value):
    global order
    order = order * 10 + value
    return value
collect = lambda a, b=mark(1), /, c=mark(2), *values, required, optional=mark(3), **named: [a, b, c, len(values), required, optional, len(named)]
definition_order = order
first = collect(4, 5, 6, 7, required=8, bonus=9)
second = collect(4, required=8)
final_order = order
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("definition_order")).toBe(123);
    expect(machine.globals.get("first")).toEqual({
      kind: "list",
      values: [4, 5, 6, 1, 8, 3, 1],
    });
    expect(machine.globals.get("second")).toEqual({
      kind: "list",
      values: [4, 1, 2, 0, 8, 3, 0],
    });
    expect(machine.globals.get("final_order")).toBe(123);
  });

  it("retains and passes shared closure cells through nested lambdas", (): void => {
    const machine = runPythonCs486(`
def outer(base):
    offset = 1
    return lambda value: lambda extra: base + offset + value + extra
answer = outer(39)(1)(1)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("answer")).toBe(42);
  });

  it("keeps lambda captures in the reachable managed heap", (): void => {
    const payload = "x".repeat(4_096);
    const captured = runPythonCs486(`
def outer():
    hidden = "${payload}"
    return lambda: hidden
holder = outer()
`);
    const released = runPythonCs486(`
def outer():
    hidden = "${payload}"
    return lambda: 1
holder = outer()
`);

    expect(captured.state.kind).toBe("completed");
    expect(released.state.kind).toBe("completed");
    expect(
      captured.memoryUsageBytes - released.memoryUsageBytes,
    ).toBeGreaterThan(3_500);
  });
});
