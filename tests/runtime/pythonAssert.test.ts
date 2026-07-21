import { describe, expect, it } from "vitest";

import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python assert statements", (): void => {
  it("evaluates one true condition and skips its message", (): void => {
    const machine = runPythonCs486(`
condition_calls = 0
message_calls = 0
def condition():
    global condition_calls
    condition_calls += 1
    return True
def message():
    global message_calls
    message_calls += 1
    return "unused"
assert condition(), message()
debug_mode = __debug__
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("condition_calls")).toBe(1);
    expect(machine.globals.get("message_calls")).toBe(0);
    expect(machine.globals.get("debug_mode")).toBe(true);
  });

  it("evaluates one false-path message and raises AssertionError", (): void => {
    const machine = runPythonCs486(`
message_calls = 0
def message():
    global message_calls
    message_calls += 1
    return "failed check"
assert False, message()
`);

    expect(machine.state.kind).toBe("crashed");
    expect(machine.globals.get("message_calls")).toBe(1);
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("AssertionError");
      expect(machine.state.error.message).toBe("failed check");
    }
  });

  it("raises an empty-message AssertionError", (): void => {
    const machine = runPythonCs486("assert False\n");

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("AssertionError");
      expect(machine.state.error.message).toBe("");
    }
  });

  it("can catch AssertionError through the existing exception path", (): void => {
    const machine = runPythonCs486(`
caught = 0
try:
    assert False, "caught"
except AssertionError as error:
    caught = 1
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("caught")).toBe(1);
  });

  it("stores a parenthesized named condition before testing it", (): void => {
    const machine = runPythonCs486(`
assert (saved := 4)
result = saved
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(4);
  });
});
