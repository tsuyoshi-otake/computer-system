import { describe, expect, it } from "vitest";

import { LanguageSyntaxError } from "../../src/domain/language/errors.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

import { PythonCs486Harness, runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python lexical name binding", (): void => {
  it("mutates module globals through an explicit global declaration", (): void => {
    const machine = runPythonCs486(`
counter = 40
def increment():
    global counter
    counter = counter + 1
increment()
increment()
result = counter
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(42);
  });

  it("reports a whole-function local read before assignment", (): void => {
    const machine = runPythonCs486(`
value = 41
def broken():
    before = value
    value = 42
    return before
broken()
`);

    expect(machine.state.kind).toBe("crashed");
    if (machine.state.kind === "crashed") {
      expect(machine.state.error.typeName).toBe("UnboundLocalError");
    }
  });

  it("retains nested captures after the defining frame returns", (): void => {
    const machine = runPythonCs486(`
def outer(base):
    offset = 2
    def inner(value):
        return base + offset + value
    return inner
answer = outer(39)(1)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("answer")).toBe(42);
  });

  it("shares a nonlocal cell across repeated calls", (): void => {
    const machine = runPythonCs486(`
def counter(start):
    value = start
    def increment():
        nonlocal value
        value = value + 1
        return value
    return increment
next_value = counter(40)
first = next_value()
second = next_value()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(41);
    expect(machine.globals.get("second")).toBe(42);
  });

  it("propagates free cells through an intermediate function", (): void => {
    const machine = runPythonCs486(`
def outer(value):
    def middle():
        def inner():
            return value
        return inner
    return middle()
answer = outer(42)()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("answer")).toBe(42);
  });

  it("executes NFKC-normalized Unicode identifiers consistently", (): void => {
    const machine = runPythonCs486("K = 40\nK = K + 2\nanswer = K\n");

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("answer")).toBe(42);
    expect(machine.globals.get("K")).toBe(42);
    expect(machine.globals.has("K")).toBe(false);
  });

  it("rejects invalid declarations before process construction", (): void => {
    expect(() => new PythonCs486Harness("nonlocal missing\n")).toThrow(
      LanguageSyntaxError,
    );
    expect(
      () =>
        new PythonCs486Harness(`
def invalid():
    value
    global value
`),
    ).toThrow(/used prior to global declaration/u);
  });

  it("keeps captured values in the reachable managed heap", (): void => {
    const payload = "x".repeat(4_096);
    const captured = runPythonCs486(`
def outer():
    hidden = "${payload}"
    def inner():
        return hidden
    return inner
holder = outer()
`);
    const released = runPythonCs486(`
def outer():
    hidden = "${payload}"
    return 1
holder = outer()
`);

    expect(captured.state.kind).toBe("completed");
    expect(released.state.kind).toBe("completed");
    expect(
      captured.memoryUsageBytes - released.memoryUsageBytes,
    ).toBeGreaterThan(3_500);
  });

  it("rolls a failed source import back to an observable retryable state", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.writeFile("/app/broken.py", "missing_name\n");
    const machine = runPythonCs486(
      `
try:
    import broken
except NameError:
    first_failure = True
try:
    import broken
except NameError:
    second_failure = True
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first_failure")).toBe(true);
    expect(machine.globals.get("second_failure")).toBe(true);
    expect(machine.globals.has("broken")).toBe(false);
  });
});
