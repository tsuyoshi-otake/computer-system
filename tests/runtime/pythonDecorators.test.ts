import { describe, expect, it } from "vitest";

import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { nativeFunction } from "../../src/domain/runtime/value.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python decorators", (): void => {
  it("evaluates function decorators top to bottom before defaults and applies bottom to top", (): void => {
    const machine = runPythonCs486(`
order = 0
def note(value):
    global order
    order = order * 10 + value
    return value
def make(tag):
    global order
    order = order * 10 + tag
    def apply(value):
        global order
        order = order * 10 + (6 - tag)
        return value
    return apply
@make(1)
@make(2)
def sample(value=note(3)):
    return value
result = sample()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("order")).toBe(12_345);
    expect(machine.globals.get("result")).toBe(3);
  });

  it("evaluates class decorators before the base and body, then permits replacement", (): void => {
    const machine = runPythonCs486(`
order = 0
def note(value):
    global order
    order = order * 10 + value
    return value
def make(tag):
    global order
    order = order * 10 + tag
    def apply(value):
        global order
        order = order * 10 + (7 - tag)
        return value
    return apply
def choose_base():
    note(3)
    return object
@make(1)
@make(2)
class Sample(choose_base()):
    marker = note(4)
def replace(value):
    return 42
@replace
class Replaced:
    pass
class_order = order
marker = Sample.marker
replacement = Replaced
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("class_order")).toBe(123_456);
    expect(machine.globals.get("marker")).toBe(4);
    expect(machine.globals.get("replacement")).toBe(42);
  });

  it("uses the native call path and decorates methods inside class suites", (): void => {
    const filesystem = new InMemoryFilesystem();
    const terminal = new TerminalBuffer();
    const baseEnvironment = createNativeEnvironment({
      computerId: 1,
      filesystem,
      terminal,
    });
    let nativeCalls = 0;
    const globals = new Map(baseEnvironment.globals);
    globals.set(
      "native_decorator",
      nativeFunction("native_decorator", (positional) => {
        nativeCalls += 1;
        return positional[0] ?? null;
      }),
    );
    const machine = runPythonCs486(
      `
@native_decorator
def sample(value):
    return value + 1
class Item:
    @native_decorator
    def method(self, value):
        return value + 2
item = Item()
function_result = sample(40)
method_result = item.method(40)
`,
      {
        environment: { ...baseEnvironment, globals },
        filesystem,
        terminal,
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(nativeCalls).toBe(2);
    expect(machine.globals.get("function_result")).toBe(41);
    expect(machine.globals.get("method_result")).toBe(42);
  });

  it("preserves earlier bindings when decorator evaluation or application fails", (): void => {
    const machine = runPythonCs486(`
function_value = 41
class_value = 42
default_calls = 0
def note_default():
    global default_calls
    default_calls = default_calls + 1
    return 0
def fail_expression():
    raise ValueError("expression")
def fail_application(value):
    raise ValueError("application")
try:
    @fail_expression()
    def function_value(value=note_default()):
        return value
except ValueError:
    pass
try:
    @fail_application
    class class_value:
        marker = 1
except ValueError:
    pass
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("function_value")).toBe(41);
    expect(machine.globals.get("class_value")).toBe(42);
    expect(machine.globals.get("default_calls")).toBe(0);
  });

  it("rejects non-callable decorators and preflights a new definition binding", (): void => {
    const invalid = runPythonCs486(`
@1
def sample():
    pass
`);
    expect(invalid.state.kind).toBe("crashed");
    if (invalid.state.kind === "crashed") {
      expect(invalid.state.error.typeName).toBe("TypeError");
    }
    expect(invalid.globals.has("sample")).toBe(false);

    const source = `
def identity(value):
    return value
@identity
def Retained():
    pass
`;
    const measured = runPythonCs486(source);
    const rejected = runPythonCs486(source, {
      limits: {
        ...defaultPythonRuntimeLimits,
        maxMemoryBytes: measured.program.runtime.memoryUsageBytes - 1,
      },
    });
    expect(measured.state.kind).toBe("completed");
    expect(rejected.state.kind).toBe("crashed");
    if (rejected.state.kind === "crashed") {
      expect(rejected.state.error.typeName).toBe("MemoryError");
    }
    expect(rejected.globals.has("Retained")).toBe(false);
  });
});
