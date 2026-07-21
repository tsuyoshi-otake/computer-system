import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python 3.14 type parameters and aliases", (): void => {
  it("publishes generic function parameters into annotations and closures", (): void => {
    const machine = runPythonCs486Core(`
def identity[T](value: T) -> T:
    return value
parameters = identity.__type_params__
parameter = parameters[0]
name = parameter.__name__
annotation = identity.__annotations__["value"]
returned = identity.__annotations__["return"]
same_annotation = annotation is parameter and returned is parameter
result = identity(42)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("name")).toBe("T");
    expect(machine.globals.get("same_annotation")).toBe(true);
    expect(machine.globals.get("result")).toBe(42);
  });

  it("keeps function defaults outside the type scope", (): void => {
    const machine = runPythonCs486Core(`
T = 17
def choose[T](value = T):
    return value
default_result = choose()
type_parameter = choose.__type_params__[0]
distinct = type_parameter is not T
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("default_result")).toBe(17);
    expect(machine.globals.get("distinct")).toBe(true);
  });

  it("retains generic class parameters in the class body and method annotations", (): void => {
    const machine = runPythonCs486Core(`
class Box[T]:
    marker = T
    def echo(self, value: T) -> T:
        return value
parameter = Box.__type_params__[0]
class_same = Box.marker is parameter
method_same = Box.echo.__annotations__["value"] is parameter
instance = Box()
result = instance.echo(23)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("class_same")).toBe(true);
    expect(machine.globals.get("method_same")).toBe(true);
    expect(machine.globals.get("result")).toBe(23);
  });

  it("evaluates alias values lazily, caches success, and retries faults", (): void => {
    const machine = runPythonCs486Core(`
type Deferred = Missing
failed = False
try:
    Deferred.__value__
except NameError:
    failed = True
Missing = 31
retried = Deferred.__value__
same = Deferred.__value__ is retried
type Pair[T] = (T, T)
parameter = Pair.__type_params__[0]
value = Pair.__value__
pair_same = value[0] is parameter and value[1] is parameter
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("retried")).toBe(31);
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("pair_same")).toBe(true);
  });

  it("lazily caches bounds, constraints, and defaults in authored order", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
def mark(value):
    global calls
    calls = calls * 10 + value
    return value
def generic[T: mark(1), U: (mark(2), mark(3)) = mark(4)]():
    return T
before = calls
first, second = generic.__type_params__
bound = first.__bound__
after_bound = calls
same_bound = first.__bound__ is bound
after_bound_again = calls
constraints = second.__constraints__
after_constraints = calls
default = second.__default__
after_default = calls
missing_default_same = first.__default__ is first.__default__
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("bound")).toBe(1);
    expect(machine.globals.get("after_bound")).toBe(1);
    expect(machine.globals.get("same_bound")).toBe(true);
    expect(machine.globals.get("after_bound_again")).toBe(1);
    expect(machine.globals.get("after_constraints")).toBe(123);
    expect(machine.globals.get("default")).toBe(4);
    expect(machine.globals.get("after_default")).toBe(1234);
    expect(machine.globals.get("missing_default_same")).toBe(true);
  });

  it("reflects variadic parameters and earlier-parameter defaults", (): void => {
    const machine = runPythonCs486Core(`
def linked[T, U = T]():
    return U
first, second = linked.__type_params__
linked_default = second.__default__ is first
def packed[*Ts = 7, **P = 8]():
    pass
variadic, specification = packed.__type_params__
variadic_name = variadic.__name__
specification_name = specification.__name__
variadic_default = variadic.__default__
specification_default = specification.__default__
no_bound = False
try:
    variadic.__bound__
except AttributeError:
    no_bound = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("linked_default")).toBe(true);
    expect(machine.globals.get("variadic_name")).toBe("Ts");
    expect(machine.globals.get("specification_name")).toBe("P");
    expect(machine.globals.get("variadic_default")).toBe(7);
    expect(machine.globals.get("specification_default")).toBe(8);
    expect(machine.globals.get("no_bound")).toBe(true);
  });

  it("keeps class and alias reflection attributes read-only", (): void => {
    const machine = runPythonCs486Core(`
class Generic[T]:
    pass
type Alias[T] = T
class_read_only = False
alias_read_only = False
parameter_read_only = False
try:
    Generic.__type_params__ = ()
except AttributeError:
    class_read_only = True
try:
    Alias.__value__ = 1
except AttributeError:
    alias_read_only = True
try:
    Alias.__type_params__[0].__name__ = "Changed"
except AttributeError:
    parameter_read_only = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("class_read_only")).toBe(true);
    expect(machine.globals.get("alias_read_only")).toBe(true);
    expect(machine.globals.get("parameter_read_only")).toBe(true);
  });

  it("retries failed bounds and retains the immediately enclosing class namespace", (): void => {
    const machine = runPythonCs486Core(`
def unresolved[T: Missing]():
    return T
parameter = unresolved.__type_params__[0]
failed = False
try:
    parameter.__bound__
except NameError:
    failed = True
Missing = 29
retried = parameter.__bound__
class Outer:
    Bound = 41
    def method[T: Bound](self):
        return T
class_bound = Outer.method.__type_params__[0].__bound__
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("retried")).toBe(29);
    expect(machine.globals.get("class_bound")).toBe(41);
  });

  it("evaluates decorators and defaults outside, then bases inside the type scope", (): void => {
    const machine = runPythonCs486Core(`
events = 0
def make_decorator():
    global events
    events = events * 10 + 1
    def apply(value):
        global events
        events = events * 10 + 3
        return value
    return apply
def make_default():
    global events
    events = events * 10 + 2
    return 17
@make_decorator()
def generic[T](value = make_default()):
    return value
definition_order = events
class Base:
    pass
base_received_parameter = False
def choose_base(parameter):
    global base_received_parameter
    base_received_parameter = parameter.__name__ == "T"
    return Base
class Derived[T](choose_base(T)):
    pass
default_result = generic()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("definition_order")).toBe(123);
    expect(machine.globals.get("base_received_parameter")).toBe(true);
    expect(machine.globals.get("default_result")).toBe(17);
  });

  it("rejects capacity plus one before publishing a generic definition", (): void => {
    const overflow = runPythonCs486Core(
      `
def overflow[T, U]():
    return T
published = True
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );
    expect(overflow.state).toMatchObject({
      error: { typeName: "ResourceLimitError" },
      kind: "crashed",
    });
    expect(overflow.globals.has("overflow")).toBe(false);
    expect(overflow.globals.has("published")).toBe(false);

    const exact = runPythonCs486Core(
      `
def exact[T]():
    return T
size = len(exact.__type_params__)
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );
    expect(exact.state.kind).toBe("completed");
    expect(exact.globals.get("size")).toBe(1);
  });

  it("remains resumable under small CS486 instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
type Alias[T] = (T, T)
parameter = Alias.__type_params__[0]
value = Alias.__value__
same = value[0] is parameter and value[1] is parameter
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
    expect(machine.globals.get("same")).toBe(true);
  });
});
