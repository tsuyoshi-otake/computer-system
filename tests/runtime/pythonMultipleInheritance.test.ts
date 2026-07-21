import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type { RuntimeClass } from "../../src/domain/runtime/value.js";
import { PythonCs486Harness, runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python multiple inheritance and C3 MRO", (): void => {
  it("uses one C3 order for lookup and stable class reflection", (): void => {
    const machine = runPythonCs486(`
class Root:
    label = "root"
class Left(Root):
    label = "left"
class Right(Root):
    label = "right"
class Diamond(Left, Right):
    pass
item = Diamond()
chosen = item.label
base_ok = Diamond.__base__ is Left
bases_ok = Diamond.__bases__[0] is Left and Diamond.__bases__[1] is Right
mro_ok = Diamond.__mro__[0] is Diamond and Diamond.__mro__[1] is Left and Diamond.__mro__[2] is Right and Diamond.__mro__[3] is Root and Diamond.__mro__[4] is object
stable_bases = Diamond.__bases__ is Diamond.__bases__
stable_mro = Diamond.__mro__ is Diamond.__mro__
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("chosen")).toBe("left");
    expect(machine.globals.get("base_ok")).toBe(true);
    expect(machine.globals.get("bases_ok")).toBe(true);
    expect(machine.globals.get("mro_ok")).toBe(true);
    expect(machine.globals.get("stable_bases")).toBe(true);
    expect(machine.globals.get("stable_mro")).toBe(true);
    const diamond = machine.globals.get("Diamond") as RuntimeClass;
    expect(diamond.bases.map((base) => base.name)).toEqual(["Left", "Right"]);
    expect(diamond.mro.map((entry) => entry.name)).toEqual([
      "Diamond",
      "Left",
      "Right",
      "Root",
      "object",
    ]);
  });

  it("evaluates bases once left to right before the class body", (): void => {
    const machine = runPythonCs486(`
trace = 0
def mark(value):
    global trace
    trace = trace * 10 + value
def choose(value, base):
    mark(value)
    return base
class Left:
    pass
class Right:
    pass
class Ordered(choose(1, Left), choose(2, Right)):
    body = mark(3)
result = trace
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(123);
  });

  it("rejects duplicate and inconsistent MROs after body effects but before publication", (): void => {
    const machine = runPythonCs486(`
class X:
    pass
class Y:
    pass
class A(X, Y):
    pass
class B(Y, X):
    pass
events = 0
def touch(value):
    global events
    events = events * 10 + value
class Stable:
    marker = 1
original = Stable
inconsistent = False
try:
    class Stable(A, B):
        effect = touch(1)
except TypeError:
    inconsistent = True
preserved = Stable is original
duplicate = False
try:
    class Duplicate(X, X):
        effect = touch(2)
except TypeError:
    duplicate = True
after = 42
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("events")).toBe(12);
    expect(machine.globals.get("inconsistent")).toBe(true);
    expect(machine.globals.get("preserved")).toBe(true);
    expect(machine.globals.get("duplicate")).toBe(true);
    expect(machine.globals.get("after")).toBe(42);
    expect(machine.globals.has("Duplicate")).toBe(false);
  });

  it("shares C3 lookup across descriptors, attribute hooks, and implicit special methods", (): void => {
    const machine = runPythonCs486(`
class Descriptor:
    def __get__(self, instance, owner):
        return owner
class SetNameLeft:
    def __set_name__(self, owner, name):
        owner.named = name
class SetNameRight:
    def __set_name__(self, owner, name):
        owner.named = "wrong"
class NamedDescriptor(SetNameLeft, SetNameRight):
    pass
class Left:
    field = Descriptor()
    def __getattr__(self, name):
        return 41
    def __iter__(self):
        return iter([1, 2])
class Right:
    field = 99
    def __getattr__(self, name):
        return 90
    def __iter__(self):
        return iter([8, 9])
class Combined(Left, Right):
    pass
class Target:
    slot = NamedDescriptor()
item = Combined()
descriptor_owner = item.field is Combined
class_descriptor_owner = Combined.field is Combined
missing = item.absent
total = 0
for value in item:
    total = total + value
set_name = Target.named
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("descriptor_owner")).toBe(true);
    expect(machine.globals.get("class_descriptor_owner")).toBe(true);
    expect(machine.globals.get("missing")).toBe(41);
    expect(machine.globals.get("total")).toBe(3);
    expect(machine.globals.get("set_name")).toBe("slot");
  });

  it("uses C3 subclass and inherited match attributes for class patterns", (): void => {
    const machine = runPythonCs486(`
class Left:
    __match_args__ = ("left",)
class Right:
    __match_args__ = ("right",)
class Combined(Left, Right):
    def __init__(self):
        self.left = 41
        self.right = 90
subject = Combined()
matched = 0
match subject:
    case Combined(value):
        matched = value
right_subclass_match = False
match subject:
    case Right():
        right_subclass_match = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("matched")).toBe(41);
    expect(machine.globals.get("right_subclass_match")).toBe(true);
  });

  it("uses C3 membership for isinstance and issubclass", (): void => {
    const machine = runPythonCs486(`
class Left:
    pass
class Right:
    pass
class Combined(Left, Right):
    pass
item = Combined()
left_instance = isinstance(item, Left)
right_instance = isinstance(item, Right)
object_instance = isinstance(item, object)
left_subclass = issubclass(Combined, Left)
right_subclass = issubclass(Combined, Right)
object_subclass = issubclass(Combined, object)
reverse = issubclass(Left, Right)
`);

    expect(machine.state.kind).toBe("completed");
    for (const name of [
      "left_instance",
      "right_instance",
      "object_instance",
      "left_subclass",
      "right_subclass",
      "object_subclass",
    ]) {
      expect(machine.globals.get(name)).toBe(true);
    }
    expect(machine.globals.get("reverse")).toBe(false);
  });

  it("uses the same C3 path for generic class definitions", (): void => {
    const machine = runPythonCs486(`
class Left:
    marker = 41
class Right:
    marker = 90
class Combined[T](Left, Right):
    pass
alias = Combined[int]
result = alias().marker
mro_ok = Combined.__mro__[1] is Left and Combined.__mro__[2] is Right
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(41);
    expect(machine.globals.get("mro_ok")).toBe(true);
  });

  it("rejects a non-class base before entering the class body", (): void => {
    const machine = runPythonCs486(`
events = 0
def touch():
    global events
    events = events + 1
caught = False
try:
    class Invalid(1):
        effect = touch()
except TypeError:
    caught = True
after = 42
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("events")).toBe(0);
    expect(machine.globals.get("caught")).toBe(true);
    expect(machine.globals.get("after")).toBe(42);
    expect(machine.globals.has("Invalid")).toBe(false);
  });

  it("keeps class MRO reflection read-only", (): void => {
    const machine = runPythonCs486(`
class Left:
    pass
class Right:
    pass
class Combined(Left, Right):
    pass
write_caught = False
delete_caught = False
try:
    Combined.__mro__ = ()
except AttributeError:
    write_caught = True
try:
    del Combined.__bases__
except AttributeError:
    delete_caught = True
unchanged = Combined.__mro__[1] is Left and Combined.__bases__[1] is Right
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("write_caught")).toBe(true);
    expect(machine.globals.get("delete_caught")).toBe(true);
    expect(machine.globals.get("unchanged")).toBe(true);
  });

  it("accepts 64 MRO entries and rejects the next direct base before body execution", (): void => {
    const definitions = Array.from(
      { length: 63 },
      (_, index) => `class B${String(index)}:\n    pass`,
    );
    const exactBases = [
      ...Array.from({ length: 62 }, (_, index) => `B${String(index)}`),
      "object",
    ];
    const overflowBases = [
      ...Array.from({ length: 63 }, (_, index) => `B${String(index)}`),
      "object",
    ];
    const exact = runPythonCs486(`
${definitions.join("\n")}
class Exact(${exactBases.join(", ")}):
    pass
last_is_object = Exact.__mro__[63] is object
`);
    const overflow = runPythonCs486(`
${definitions.join("\n")}
events = 0
def touch():
    global events
    events = events + 1
limited = False
try:
    class Excess(${overflowBases.join(", ")}):
        effect = touch()
except ResourceLimitError:
    limited = True
after = 42
`);

    expect(exact.state.kind).toBe("completed");
    expect(exact.globals.get("last_is_object")).toBe(true);
    expect(overflow.state.kind).toBe("completed");
    expect(overflow.globals.get("limited")).toBe(true);
    expect(overflow.globals.get("events")).toBe(0);
    expect(overflow.globals.get("after")).toBe(42);
    expect(overflow.globals.has("Excess")).toBe(false);
  });

  it("accounts MRO metadata before publishing a multiple-inheritance class", (): void => {
    const source = `
class Left:
    pass
class Right:
    pass
class Combined(Left, Right):
    marker = 1
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
    expect(rejected.globals.has("Combined")).toBe(false);
  });

  it("continues through multiple inheritance under eight-instruction slices", (): void => {
    const machine = new PythonCs486Harness(`
class Root:
    value = 40
class Left(Root):
    value = 41
class Right(Root):
    value = 99
class Combined(Left, Right):
    pass
result = Combined().value + 1
`);
    let slices = 0;
    while (
      slices < 4_096 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runCpuSlice(1_000, 8);
      slices += 1;
    }

    expect(slices).toBeGreaterThan(1);
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(42);
  });
});
