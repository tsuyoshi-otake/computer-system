import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python 3.14 runtime type parameters", (): void => {
  it("publishes stable type-parameter tuples for generic functions and classes", (): void => {
    const machine = runPythonCs486Core(`
def generic[T, *Ts, **P](value):
    return T
class Container[U]:
    captured = U
function_params = generic.__type_params__
class_params = Container.__type_params__
function_same = generic.__type_params__ is function_params
class_same = Container.__type_params__ is class_params
function_count = len(function_params)
class_count = len(class_params)
t_name = function_params[0].__name__
ts_name = function_params[1].__name__
p_name = function_params[2].__name__
u_name = class_params[0].__name__
function_visible = generic(None) is function_params[0]
class_visible = Container.captured is class_params[0]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("function_same")).toBe(true);
    expect(machine.globals.get("class_same")).toBe(true);
    expect(machine.globals.get("function_count")).toBe(3);
    expect(machine.globals.get("class_count")).toBe(1);
    expect(machine.globals.get("t_name")).toBe("T");
    expect(machine.globals.get("ts_name")).toBe("Ts");
    expect(machine.globals.get("p_name")).toBe("P");
    expect(machine.globals.get("u_name")).toBe("U");
    expect(machine.globals.get("function_visible")).toBe(true);
    expect(machine.globals.get("class_visible")).toBe(true);
  });

  it("keeps type parameters private and evaluates defaults outside their scope", (): void => {
    const machine = runPythonCs486Core(`
T = 11
events = 0
def mark(value):
    global events
    events = events * 10 + value
    return value
def decorator(value):
    mark(3)
    return value
@decorator
def generic[T: mark(4)](value = mark(T)):
    return value
after_definition = events
default_value = generic()
module_binding = T
bound = generic.__type_params__[0].__bound__
after_bound = events
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("after_definition")).toBe(113);
    expect(machine.globals.get("default_value")).toBe(11);
    expect(machine.globals.get("module_binding")).toBe(11);
    expect(machine.globals.get("bound")).toBe(4);
    expect(machine.globals.get("after_bound")).toBe(1134);
  });

  it("lazily evaluates and caches bounds, constraints, and defaults", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
def mark(value):
    global calls
    calls = calls + 1
    return value
def generic[
    T: mark(10),
    U: (mark(20), mark(30)),
    V = mark(40),
    *Ts = mark(50),
    **P = mark(60),
]():
    pass
before = calls
parameters = generic.__type_params__
t_bound = parameters[0].__bound__
t_bound_again = parameters[0].__bound__
after_bound = calls
constraints = parameters[1].__constraints__
constraints_again = parameters[1].__constraints__
after_constraints = calls
v_default = parameters[2].__default__
ts_default = parameters[3].__default__
p_default = parameters[4].__default__
after_defaults = calls
no_default_same = parameters[0].__default__ is parameters[1].__default__
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("t_bound")).toBe(10);
    expect(machine.globals.get("t_bound_again")).toBe(10);
    expect(machine.globals.get("after_bound")).toBe(1);
    expect(machine.globals.get("after_constraints")).toBe(3);
    expect(machine.globals.get("v_default")).toBe(40);
    expect(machine.globals.get("ts_default")).toBe(50);
    expect(machine.globals.get("p_default")).toBe(60);
    expect(machine.globals.get("after_defaults")).toBe(6);
    expect(machine.globals.get("no_default_same")).toBe(true);
  });

  it("retries a faulting lazy bound after the missing name is defined", (): void => {
    const machine = runPythonCs486Core(`
def generic[T: Missing]():
    pass
parameter = generic.__type_params__[0]
failed = False
try:
    parameter.__bound__
except NameError:
    failed = True
Missing = 73
retried = parameter.__bound__
cached = parameter.__bound__
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("retried")).toBe(73);
    expect(machine.globals.get("cached")).toBe(73);
  });

  it("rejects recursive lazy evaluation without poisoning later access", (): void => {
    const machine = runPythonCs486Core(`
def generic[T: T.__bound__]():
    pass
parameter = generic.__type_params__[0]
first_failed = False
second_failed = False
try:
    parameter.__bound__
except RuntimeError:
    first_failed = True
try:
    parameter.__bound__
except RuntimeError:
    second_failed = True
after = 17
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first_failed")).toBe(true);
    expect(machine.globals.get("second_failed")).toBe(true);
    expect(machine.globals.get("after")).toBe(17);
  });

  it("rejects a type-parameter tuple over capacity before publishing the definition", (): void => {
    const machine = runPythonCs486Core(
      `
failed = False
unpublished = False
try:
    def generic[T, U]():
        pass
except ResourceLimitError:
    failed = True
try:
    generic
except NameError:
    unpublished = True
after = 19
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("unpublished")).toBe(true);
    expect(machine.globals.get("after")).toBe(19);
  });

  it("creates lazy generic type aliases with forward references and stable values", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
def mark(value):
    global calls
    calls = calls + 1
    return value
type Pair[T] = (mark(T), Later)
before = calls
parameters = Pair.__type_params__
parameter_visible = parameters[0].__name__
Later = 91
value = Pair.__value__
after = calls
same = Pair.__value__ is value
first_is_parameter = value[0] is parameters[0]
second = value[1]
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("parameter_visible")).toBe("T");
    expect(machine.globals.get("after")).toBe(1);
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("first_is_parameter")).toBe(true);
    expect(machine.globals.get("second")).toBe(91);
  });

  it("retries a faulting type-alias value without publishing a partial cache", (): void => {
    const machine = runPythonCs486Core(`
type Deferred = (Missing, 2)
failed = False
try:
    Deferred.__value__
except NameError:
    failed = True
Missing = 1
value = Deferred.__value__
same = Deferred.__value__ is value
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("same")).toBe(true);
  });

  it("resumes lazy type evaluation across bounded CS486 slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
def generic[T: Later]():
    return T
class Later:
    pass
parameter = generic.__type_params__[0]
result = parameter.__bound__ is Later
`);
    let slices = 0;
    while (
      slices < 2_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runSlice(8);
      slices += 1;
    }

    expect(slices).toBeGreaterThan(1);
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(true);
  });
});
