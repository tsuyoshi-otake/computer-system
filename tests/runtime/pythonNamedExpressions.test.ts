import { describe, expect, it } from "vitest";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python assignment expressions", (): void => {
  it("evaluates one RHS, stores the same value, and returns it", (): void => {
    const machine = runPythonCs486(`
calls = 0
def make():
    global calls
    calls += 1
    return [7]
result = (saved := make())
saved[0] = 9
observed = result[0]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("calls")).toBe(1);
    expect(machine.globals.get("observed")).toBe(9);
  });

  it("supports direct if/while conditions and retains the final false value", (): void => {
    const machine = runPythonCs486(`
branch = 0
if selected := 3:
    branch = selected
remaining = 3
total = 0
while remaining := remaining - 1:
    total += remaining
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("branch")).toBe(3);
    expect(machine.globals.get("total")).toBe(3);
    expect(machine.globals.get("remaining")).toBe(0);
  });

  it("does not evaluate a named expression in skipped boolean branches", (): void => {
    const machine = runPythonCs486(`
calls = 0
def mark():
    global calls
    calls += 1
    return 1
left = False and (left_value := mark())
right = True or (right_value := mark())
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("calls")).toBe(0);
    expect(machine.globals.has("left_value")).toBe(false);
    expect(machine.globals.has("right_value")).toBe(false);
  });

  it("preserves conditional-arm skipping and flexible unparenthesized placements", (): void => {
    const machine = runPythonCs486(`
calls = 0
def mark(value):
    global calls
    calls += 1
    return value
def identity(value):
    return value
result = (chosen := mark(7)) if False else 3
display = [display_value := [4]]
argument_result = identity(argument_value := display_value)
argument_value[0] = 9
observed = argument_result[0]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("calls")).toBe(0);
    expect(machine.globals.has("chosen")).toBe(false);
    expect(machine.globals.get("result")).toBe(3);
    expect(machine.globals.get("observed")).toBe(9);
  });

  it("stores through global and nonlocal closure bindings", (): void => {
    const machine = runPythonCs486(`
global_value = 0
def set_global():
    global global_value
    return (global_value := 5)
def outer():
    value = 1
    def increment():
        nonlocal value
        return (value := value + 1)
    first = increment()
    second = increment()
    return value * 100 + first * 10 + second
global_result = set_global()
closure_result = outer()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("global_value")).toBe(5);
    expect(machine.globals.get("global_result")).toBe(5);
    expect(machine.globals.get("closure_result")).toBe(323);
  });

  it("supports parenthesized restricted expressions and a lambda RHS", (): void => {
    const machine = runPythonCs486(`
function = (identity := lambda value: value)
formatted = f"{(inside := 4)}"
result = function(inside)
same_function = identity(5)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("formatted")).toBe("4");
    expect(machine.globals.get("result")).toBe(4);
    expect(machine.globals.get("same_function")).toBe(5);
  });

  it("makes a named target local across its whole function", (): void => {
    const machine = runPythonCs486(`
value = 10
def read_before_store(flag):
    if flag:
        return value
    if (value := 1):
        pass
    return value
result = read_before_store(True)
`);

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("UnboundLocalError");
    }
  });
});
