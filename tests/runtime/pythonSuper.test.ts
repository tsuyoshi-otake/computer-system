import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { PythonCs486Harness, runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python super and __class__ cells", (): void => {
  it("continues cooperative methods through the canonical C3 MRO", (): void => {
    const machine = runPythonCs486(`
class Root:
    def chain(self):
        return "R"
class Left(Root):
    def chain(self):
        return "L" + super().chain()
    def owner(self):
        return __class__
class Right(Root):
    def chain(self):
        return "T" + super().chain()
class Diamond(Left, Right):
    def chain(self):
        return "D" + super().chain()
item = Diamond()
result = item.chain()
explicit = super(Left, item).chain()
owner_ok = item.owner() is Left
proxy = super(Left, item)
reflection = proxy.__thisclass__ is Left and proxy.__self__ is item and proxy.__self_class__ is Diamond
unbound = super(Left)
unbound_ok = unbound.__thisclass__ is Left and unbound.__self__ is None and unbound.__self_class__ is None
unbound_missing = getattr(unbound, "chain", "missing")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe("DLTR");
    expect(machine.globals.get("explicit")).toBe("TR");
    expect(machine.globals.get("owner_ok")).toBe(true);
    expect(machine.globals.get("reflection")).toBe(true);
    expect(machine.globals.get("unbound_ok")).toBe(true);
    expect(machine.globals.get("unbound_missing")).toBe("missing");
  });

  it("binds properties, custom descriptors, and class methods after the start class", (): void => {
    const machine = runPythonCs486(`
class Owner:
    def __get__(self, instance, owner):
        return owner
class Root:
    marker = Owner()
    @property
    def amount(self):
        return 40
    @classmethod
    def identity(cls):
        return cls
class Child(Root):
    @property
    def amount(self):
        return super().amount + 2
    @classmethod
    def identity(cls):
        return super().identity()
    def marker_owner(self):
        return super().marker
item = Child()
amount = item.amount
class_identity = Child.identity() is Child
descriptor_owner = item.marker_owner() is Child
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("amount")).toBe(42);
    expect(machine.globals.get("class_identity")).toBe(true);
    expect(machine.globals.get("descriptor_owner")).toBe(true);
  });

  it("supports cooperative initialization through object.__init__", (): void => {
    const machine = runPythonCs486(`
class Root:
    def __init__(self, value):
        self.value = value
class Child(Root):
    def __init__(self, value):
        super().__init__(value + 1)
class Empty:
    def __init__(self):
        super().__init__()
class Generic[T](Root):
    def __init__(self, value):
        super().__init__(value)
child = Child(41)
empty = Empty()
generic = Generic[int](42)
result = child.value + generic.value
empty_ok = empty.__class__ is Empty
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(84);
    expect(machine.globals.get("empty_ok")).toBe(true);
  });

  it("separates the hidden class cell from outer and parameter bindings", (): void => {
    const machine = runPythonCs486(`
def build():
    __class__ = 41
    class Sample:
        copied = __class__
        reader = lambda self: __class__
        def shadowed(__class__):
            return super().__thisclass__ is Sample and __class__.__class__ is Sample
    return Sample
Sample = build()
item = Sample()
outer_copy = Sample.copied
lambda_owner = item.reader() is Sample
shadowed_ok = item.shadowed()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("outer_copy")).toBe(41);
    expect(machine.globals.get("lambda_owner")).toBe(true);
    expect(machine.globals.get("shadowed_ok")).toBe(true);
  });

  it("clears escaped class cells when C3 or set-name completion fails", (): void => {
    const machine = runPythonCs486(`
class X:
    pass
class Y:
    pass
class A(X, Y):
    pass
class B(Y, X):
    pass
leaked_mro = None
try:
    class BrokenMro(A, B):
        global leaked_mro
        def reveal(self):
            return __class__
        leaked_mro = reveal
except TypeError:
    pass
mro_cell_empty = False
try:
    leaked_mro(None)
except NameError:
    mro_cell_empty = True
class Reject:
    def __set_name__(self, owner, name):
        raise ValueError("stop")
leaked_set_name = None
try:
    class BrokenSetName:
        global leaked_set_name
        def reveal(self):
            return __class__
        leaked_set_name = reveal
        rejected = Reject()
except ValueError:
    pass
set_name_cell_empty = False
try:
    leaked_set_name(None)
except NameError:
    set_name_cell_empty = True
after = 42
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("mro_cell_empty")).toBe(true);
    expect(machine.globals.get("set_name_cell_empty")).toBe(true);
    expect(machine.globals.get("after")).toBe(42);
    expect(machine.globals.has("BrokenMro")).toBe(false);
    expect(machine.globals.has("BrokenSetName")).toBe(false);
  });

  it("reports invalid contexts and keeps super reflection read-only", (): void => {
    const machine = runPythonCs486(`
outside = False
try:
    super()
except RuntimeError:
    outside = True
class Sample:
    @staticmethod
    def missing_first():
        return super()
static_error = False
try:
    Sample.missing_first()
except RuntimeError:
    static_error = True
wrong_type = False
try:
    super(1, Sample())
except TypeError:
    wrong_type = True
wrong_receiver = False
try:
    super(Sample, object())
except TypeError:
    wrong_receiver = True
proxy = super(Sample)
write_error = False
delete_error = False
try:
    proxy.__self__ = 1
except AttributeError:
    write_error = True
try:
    del proxy.__thisclass__
except AttributeError:
    delete_error = True
`);

    expect(machine.state.kind).toBe("completed");
    for (const name of [
      "outside",
      "static_error",
      "wrong_type",
      "wrong_receiver",
      "write_error",
      "delete_error",
    ]) {
      expect(machine.globals.get(name)).toBe(true);
    }
  });

  it("supports super lookup at the exact 64-entry MRO ceiling", (): void => {
    const definitions = ["class C0:\n    def value(self):\n        return 41"];
    for (let index = 1; index < 62; index += 1) {
      definitions.push(
        `class C${String(index)}(C${String(index - 1)}):\n    pass`,
      );
    }
    definitions.push(
      "class C62(C61):\n    def value(self):\n        return super().value() + 1",
    );
    const machine = runPythonCs486(`
${definitions.join("\n")}
result = C62().value()
exact_mro = C62.__mro__[63] is object
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(42);
    expect(machine.globals.get("exact_mro")).toBe(true);
  });

  it("accounts a retained super proxy before its global publication", (): void => {
    const prefix = `
class Root:
    def value(self):
        return 41
class Child(Root):
    def proxy(self):
        return super()
item = Child()
`;
    const baseline = runPythonCs486(`${prefix}\nmarker = None\n`);
    const measured = runPythonCs486(`${prefix}\nproxy = item.proxy()\n`);
    const limit = measured.program.runtime.memoryUsageBytes - 1;
    expect(limit).toBeGreaterThanOrEqual(
      baseline.program.runtime.memoryUsageBytes,
    );
    const rejected = runPythonCs486(`${prefix}\nproxy = item.proxy()\n`, {
      limits: {
        ...defaultPythonRuntimeLimits,
        maxMemoryBytes: limit,
      },
    });

    expect(measured.state.kind).toBe("completed");
    expect(rejected.state.kind).toBe("crashed");
    if (rejected.state.kind === "crashed") {
      expect(rejected.state.error.typeName).toBe("MemoryError");
    }
    expect(rejected.globals.has("Child")).toBe(true);
    expect(rejected.globals.has("item")).toBe(true);
    expect(rejected.globals.has("proxy")).toBe(false);
  });

  it("recovers from call-depth rejection and resumes under eight-instruction slices", (): void => {
    const limited = runPythonCs486(
      `
class Root:
    def value(self):
        return 40
class Middle(Root):
    def value(self):
        return super().value() + 1
class Leaf(Middle):
    def value(self):
        return super().value() + 1
caught = False
try:
    Leaf().value()
except ResourceLimitError:
    caught = True
after = 42
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 2 },
      },
    );
    const sliced = new PythonCs486Harness(`
class Root:
    def value(self):
        return 40
class Child(Root):
    def value(self):
        return super().value() + 2
result = Child().value()
`);
    let slices = 0;
    while (
      slices < 4_096 &&
      (sliced.state.kind === "ready" || sliced.hasPendingCpuCycles)
    ) {
      sliced.runCpuSlice(1_000, 8);
      slices += 1;
    }

    expect(limited.state.kind).toBe("completed");
    expect(limited.globals.get("caught")).toBe(true);
    expect(limited.globals.get("after")).toBe(42);
    expect(slices).toBeGreaterThan(1);
    expect(sliced.state.kind).toBe("completed");
    expect(sliced.globals.get("result")).toBe(42);
  });
});
