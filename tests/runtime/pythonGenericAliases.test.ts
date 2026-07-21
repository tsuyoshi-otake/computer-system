import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python 3.14 generic aliases", (): void => {
  it("subscribes generic classes with stable reflection and type-erased calls", (): void => {
    const machine = runPythonCs486Core(`
class Box[T]:
    def __init__(self, value):
        self.value = value
closed = Box[int]
same = Box[int] is closed
origin_same = closed.__origin__ is Box
argument_same = closed.__args__[0] is int
parameter_count = len(closed.__parameters__)
instance = closed(42)
result = instance.value
instance_class_same = instance.__class__ is Box
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("origin_same")).toBe(true);
    expect(machine.globals.get("argument_same")).toBe(true);
    expect(machine.globals.get("parameter_count")).toBe(0);
    expect(machine.globals.get("result")).toBe(42);
    expect(machine.globals.get("instance_class_same")).toBe(true);
  });

  it("subscribes generic type aliases and retains open parameters", (): void => {
    const machine = runPythonCs486Core(`
type Pair[T] = tuple[T, T]
parameter = Pair.__type_params__[0]
closed = Pair[str]
closed_origin = closed.__origin__ is Pair
closed_argument = closed.__args__[0] is str
closed_parameter_count = len(closed.__parameters__)
open_alias = Pair[parameter]
open_parameter_same = open_alias.__parameters__[0] is parameter
value = Pair.__value__
value_origin = value.__origin__ is tuple
value_parameter_same = value.__parameters__[0] is parameter
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("closed_origin")).toBe(true);
    expect(machine.globals.get("closed_argument")).toBe(true);
    expect(machine.globals.get("closed_parameter_count")).toBe(0);
    expect(machine.globals.get("open_parameter_same")).toBe(true);
    expect(machine.globals.get("value_origin")).toBe(true);
    expect(machine.globals.get("value_parameter_same")).toBe(true);
  });

  it("resubscribes open and nested aliases by substituting retained parameters", (): void => {
    const machine = runPythonCs486Core(`
class Box[T]:
    pass
parameter = Box.__type_params__[0]
open_box = Box[parameter]
closed_box = open_box[int]
same_box = closed_box is Box[int]
box_argument = closed_box.__args__[0] is int
type Mapping[T] = dict[str, T]
mapping_template = Mapping.__value__
closed_mapping = mapping_template[int]
mapping_origin = closed_mapping.__origin__ is dict
mapping_key = closed_mapping.__args__[0] is str
mapping_value = closed_mapping.__args__[1] is int
mapping_parameters = len(closed_mapping.__parameters__)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("same_box")).toBe(true);
    expect(machine.globals.get("box_argument")).toBe(true);
    expect(machine.globals.get("mapping_origin")).toBe(true);
    expect(machine.globals.get("mapping_key")).toBe(true);
    expect(machine.globals.get("mapping_value")).toBe(true);
    expect(machine.globals.get("mapping_parameters")).toBe(0);
  });

  it("provides bounded generic forms for built-in collection types", (): void => {
    const machine = runPythonCs486Core(`
list_alias = list[int]
dict_alias = dict[str, int]
tuple_alias = tuple[int, str]
set_alias = set[int]
list_same = list[int] is list_alias
dict_origin = dict_alias.__origin__ is dict
dict_arg_count = len(dict_alias.__args__)
tuple_arg_count = len(tuple_alias.__args__)
empty_list = list_alias()
empty_dict = dict_alias()
empty_tuple = tuple_alias()
empty_set = set_alias()
empty_sizes = (len(empty_list), len(empty_dict), len(empty_tuple), len(empty_set))
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("list_same")).toBe(true);
    expect(machine.globals.get("dict_origin")).toBe(true);
    expect(machine.globals.get("dict_arg_count")).toBe(2);
    expect(machine.globals.get("tuple_arg_count")).toBe(2);
    expect(machine.globals.get("empty_sizes")).toMatchObject({
      kind: "tuple",
      values: [0, 0, 0, 0],
    });
  });

  it("supports one bounded TypeVarTuple in a generic owner", (): void => {
    const machine = runPythonCs486Core(`
class Variadic[*Ts]:
    pass
parameter = Variadic.__type_params__[0]
empty = Variadic[()]
many = Variadic[int, str, bool]
many_count = len(many.__args__)
closed_parameter_count = len(many.__parameters__)
open_alias = Variadic[parameter]
open_parameter_same = open_alias.__parameters__[0] is parameter
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("many_count")).toBe(3);
    expect(machine.globals.get("closed_parameter_count")).toBe(0);
    expect(machine.globals.get("open_parameter_same")).toBe(true);
    expect(machine.globals.has("empty")).toBe(true);
  });

  it("evaluates missing defaults lazily once and appends them to alias arguments", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
def mark(value):
    global calls
    calls = calls + 1
    return value
class Pair[T, U = mark(int)]:
    pass
before = calls
alias = Pair[str]
after = calls
argument_count = len(alias.__args__)
default_same = alias.__args__[1] is int
cached_alias = Pair[str]
after_cached = calls
same = cached_alias is alias
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("after")).toBe(1);
    expect(machine.globals.get("argument_count")).toBe(2);
    expect(machine.globals.get("default_same")).toBe(true);
    expect(machine.globals.get("after_cached")).toBe(1);
    expect(machine.globals.get("same")).toBe(true);
  });

  it("retries faulting defaults and supports a defaulted ParamSpec slot", (): void => {
    const machine = runPythonCs486Core(`
class Deferred[T, U = Missing]:
    pass
failed = False
try:
    Deferred[int]
except NameError:
    failed = True
Missing = str
retried = Deferred[int]
retried_default = retried.__args__[1] is str
class Callback[T, **P = tuple]:
    pass
callback = Callback[int]
param_spec_default = callback.__args__[1] is tuple
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("retried_default")).toBe(true);
    expect(machine.globals.get("param_spec_default")).toBe(true);
  });

  it("normalizes explicit sole and trailing ParamSpec argument lists", (): void => {
    const machine = runPythonCs486Core(`
class Params[**P]:
    pass
expanded = Params[int, str]
listed = Params[[int, str]]
empty = Params[()]
class Callback[T, **P]:
    pass
callback = Callback[bool, [int, str]]
expanded_outer_count = len(expanded.__args__)
expanded_inner_count = len(expanded.__args__[0])
expanded_first = expanded.__args__[0][0] is int
listed_inner_count = len(listed.__args__[0])
empty_inner_count = len(empty.__args__[0])
callback_parameter_count = len(callback.__args__[1])
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("expanded_outer_count")).toBe(1);
    expect(machine.globals.get("expanded_inner_count")).toBe(2);
    expect(machine.globals.get("expanded_first")).toBe(true);
    expect(machine.globals.get("listed_inner_count")).toBe(2);
    expect(machine.globals.get("empty_inner_count")).toBe(0);
    expect(machine.globals.get("callback_parameter_count")).toBe(2);
  });

  it("rejects wrong arity and keeps reflection attributes read-only", (): void => {
    const machine = runPythonCs486Core(`
class Pair[T, U]:
    pass
too_few = False
too_many = False
read_only = False
try:
    Pair[int]
except TypeError:
    too_few = True
try:
    list[int, str]
except TypeError:
    too_many = True
alias = Pair[int, str]
try:
    alias.__args__ = ()
except AttributeError:
    read_only = True
after = 17
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("too_few")).toBe(true);
    expect(machine.globals.get("too_many")).toBe(true);
    expect(machine.globals.get("read_only")).toBe(true);
    expect(machine.globals.get("after")).toBe(17);
  });

  it("rejects parameterized aliases in runtime class checks", (): void => {
    const machine = runPythonCs486Core(`
class Box[T]:
    pass
instance = Box()
alias = Box[int]
instance_failed = False
subclass_failed = False
try:
    isinstance(instance, alias)
except TypeError:
    instance_failed = True
try:
    issubclass(Box, alias)
except TypeError:
    subclass_failed = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("instance_failed")).toBe(true);
    expect(machine.globals.get("subclass_failed")).toBe(true);
  });

  it("retains cached aliases in reachable managed-heap accounting", (): void => {
    const baseline = runPythonCs486Core(`
class Box[T]:
    pass
`);
    const withAlias = runPythonCs486Core(`
class Box[T]:
    pass
Box[int]
`);

    expect(baseline.state.kind).toBe("completed");
    expect(withAlias.state.kind).toBe("completed");
    expect(withAlias.program.runtime.memoryUsageBytes).toBeGreaterThan(
      baseline.program.runtime.memoryUsageBytes,
    );
  });

  it("rejects cache capacity plus one before publishing another alias", (): void => {
    const machine = runPythonCs486Core(
      `
class Box[T]:
    pass
first = Box[int]
failed = False
try:
    Box[str]
except ResourceLimitError:
    failed = True
same = Box[int] is first
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("same")).toBe(true);
  });

  it("remains resumable under small CS486 instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
class Box[T]:
    pass
alias = Box[int]
same = alias.__origin__ is Box and alias.__args__[0] is int
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
