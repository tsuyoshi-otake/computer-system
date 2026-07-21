import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { PythonCs486CoreHarness } from "./pythonCs486CoreHarness.js";
import { runPythonCs486Core } from "./pythonCs486CoreHarness.js";

describe("Computer System Python descriptors", (): void => {
  it("applies data and non-data descriptor precedence with inherited set-name state", (): void => {
    const machine = runPythonCs486Core(`
events = ""

class DataDescriptor:
    def __set_name__(self, owner, name):
        global events
        events = events + owner.__name__ + "." + name + ";"
        self.name = name

    def __get__(self, instance, owner):
        if instance is None:
            return owner.__name__ + "." + self.name
        return instance.stored + 1

    def __set__(self, instance, value):
        instance.stored = value

class NonDataDescriptor:
    def __get__(self, instance, owner):
        if instance is None:
            return owner.__name__
        return 90

class Base:
    data = DataDescriptor()
    loose = NonDataDescriptor()

class Child(Base):
    pass

item = Child()
item.data = 40
data_value = item.data
item.loose = 42
shadowed_non_data = item.loose
class_data = Child.data
class_non_data = Child.loose
`);

    if (machine.state.kind === "crashed") {
      throw new Error(
        `${machine.state.error.typeName}: ${machine.state.error.message}`,
      );
    }
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("events")).toBe("Base.data;");
    expect(machine.globals.get("data_value")).toBe(41);
    expect(machine.globals.get("shadowed_non_data")).toBe(42);
    expect(machine.globals.get("class_data")).toBe("Child.data");
    expect(machine.globals.get("class_non_data")).toBe("Child");
  });

  it("supports property, staticmethod, classmethod, and bound-method reflection", (): void => {
    const machine = runPythonCs486Core(`
class Sample:
    def __init__(self, value):
        self._value = value

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, replacement):
        self._value = replacement

    @staticmethod
    def plus(left, right):
        return left + right

    @classmethod
    def class_name(cls):
        return cls.__name__

    def method(self):
        return self._value

class Child(Sample):
    pass

item = Child(40)
item.value = 41
property_value = item.value
property_from_class = Sample.value
static_instance = item.plus(1, 2)
static_class = Sample.plus(3, 4)
class_instance = item.class_name()
class_class = Child.class_name()
bound = item.method
bound_self = bound.__self__ is item
bound_func = bound.__func__ is Sample.method
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("property_value")).toBe(41);
    expect(machine.globals.get("property_from_class")).toMatchObject({
      kind: "namespace",
      name: "property",
    });
    expect(machine.globals.get("static_instance")).toBe(3);
    expect(machine.globals.get("static_class")).toBe(7);
    expect(machine.globals.get("class_instance")).toBe("Child");
    expect(machine.globals.get("class_class")).toBe("Child");
    expect(machine.globals.get("bound_self")).toBe(true);
    expect(machine.globals.get("bound_func")).toBe(true);
  });

  it("keeps a previous definition when set-name fails and reports missing property accessors", (): void => {
    const machine = runPythonCs486Core(`
class FailingDescriptor:
    def __set_name__(self, owner, name):
        raise ValueError(name)

Retained = 41
try:
    class Retained:
        field = FailingDescriptor()
except ValueError:
    pass

class InvalidDescriptor:
    __set_name__ = None

Invalid = 40
try:
    class Invalid:
        field = InvalidDescriptor()
except TypeError:
    pass

class AfterInvalid:
    pass
after_invalid = AfterInvalid.__name__

class ReadOnly:
    @property
    def value(self):
        return 42

class WriteOnly:
    def write(self, value):
        self.saved = value
    value = property(fset=write)

read_only = ReadOnly()
read_only_error = False
try:
    read_only.value = 1
except AttributeError:
    read_only_error = True

write_only = WriteOnly()
write_only.value = 43
write_only_error = False
try:
    ignored = write_only.value
except AttributeError:
    write_only_error = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("Retained")).toBe(41);
    expect(machine.globals.get("Invalid")).toBe(40);
    expect(machine.globals.get("after_invalid")).toBe("AfterInvalid");
    expect(machine.globals.get("read_only_error")).toBe(true);
    expect(machine.globals.get("write_only_error")).toBe(true);
    const writeOnly = machine.globals.get("write_only");
    expect(writeOnly).toMatchObject({ kind: "instance" });
    if (typeof writeOnly === "object" && writeOnly?.kind === "instance") {
      expect(writeOnly.values.get("saved")).toBe(43);
    }
  });

  it("rolls descriptor faults back and permits a later retry", (): void => {
    const machine = runPythonCs486Core(`
class Flaky:
    def __init__(self):
        self.calls = 0

    def __get__(self, instance, owner):
        self.calls = self.calls + 1
        if self.calls == 1:
            raise ValueError("first")
        return 42

descriptor = Flaky()
class Item:
    value = descriptor

item = Item()
first_failed = False
try:
    ignored = item.value
except ValueError:
    first_failed = True
second = item.value
calls = descriptor.calls
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first_failed")).toBe(true);
    expect(machine.globals.get("second")).toBe(42);
    expect(machine.globals.get("calls")).toBe(2);
  });

  it("uses an existing instance value when a set-only descriptor has no get hook", (): void => {
    const machine = runPythonCs486Core(`
class SetOnly:
    def __set__(self, instance, value):
        instance.last_set = value

class Item:
    pass

item = Item()
item.value = 41
Item.value = SetOnly()
read_before_set = item.value
item.value = 42
read_after_set = item.value
last_set = item.last_set
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("read_before_set")).toBe(41);
    expect(machine.globals.get("read_after_set")).toBe(41);
    expect(machine.globals.get("last_set")).toBe(42);
  });

  it("retains the outer notification owner while set-name builds a nested class", (): void => {
    const machine = runPythonCs486Core(`
class Nesting:
    def __set_name__(self, owner, name):
        class Inner:
            marker = owner.__name__ + "." + name
        self.result = Inner.marker
    def __get__(self, instance, owner):
        return self.result

class Outer:
    first = Nesting()
    second = Nesting()

first = Outer.first
second = Outer.second
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("Outer.first");
    expect(machine.globals.get("second")).toBe("Outer.second");
  });

  it("keeps descriptor calls under the shared call-depth limit", (): void => {
    const machine = runPythonCs486Core(
      `
def nested():
    return 42

class Descriptor:
    def __get__(self, instance, owner):
        return nested()

class Item:
    value = Descriptor()

limited = False
try:
    ignored = Item().value
except ResourceLimitError:
    limited = True
continued = 43
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("limited")).toBe(true);
    expect(machine.globals.get("continued")).toBe(43);
  });

  it("remains resumable through set-name, get, and set under low instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
class Descriptor:
    def __set_name__(self, owner, name):
        self.name = name
    def __get__(self, instance, owner):
        return instance.stored
    def __set__(self, instance, value):
        instance.stored = value

class Item:
    value = Descriptor()

item = Item()
item.value = 42
answer = item.value
`);
    let slices = 0;
    while (
      slices < 8_192 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runSlice(8);
      slices += 1;
    }

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("answer")).toBe(42);
    expect(slices).toBeGreaterThan(1);
  });

  it("accounts retained descriptor wrappers and bound methods in the managed heap", (): void => {
    const baseline = runPythonCs486Core("done = True\n");
    const retained = runPythonCs486Core(`
class Item:
    @property
    def value(self):
        return 42
    @classmethod
    def build(cls):
        return cls()
    def method(self):
        return self.value

item = Item()
property_object = Item.value
class_method = Item.build
bound_method = item.method
`);

    expect(retained.state.kind).toBe("completed");
    expect(retained.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes,
    );
  });

  it("notifies exactly the admitted class namespace and rejects capacity-plus-one atomically", (): void => {
    const machine = runPythonCs486Core(
      `
notifications = ""
class Marker:
    def __set_name__(self, owner, name):
        global notifications
        notifications = notifications + name
    def __get__(self, instance, owner):
        return 1

class Exact:
    a = Marker()
    b = Marker()
    c = Marker()
    d = Marker()

Overflow = 42
try:
    class Overflow:
        a = Marker()
        b = Marker()
        c = Marker()
        d = Marker()
        e = Marker()
except ResourceLimitError:
    pass
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 4 },
      },
    );

    if (machine.state.kind === "crashed") {
      throw new Error(
        `${machine.state.error.typeName}: ${machine.state.error.message}`,
      );
    }
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("notifications")).toBe("abcd");
    expect(machine.globals.get("Overflow")).toBe(42);
  });

  it("does not replace an earlier binding when descriptor publication exceeds the heap", (): void => {
    const source = `
Retained = 41
class Retained:
    @property
    def payload(self):
        return "descriptor payload retained in the managed heap"
`;
    const measured = runPythonCs486Core(source);
    expect(measured.state.kind).toBe("completed");

    const rejected = runPythonCs486Core(source, {
      limits: {
        ...defaultPythonRuntimeLimits,
        maxMemoryBytes: measured.program.runtime.memoryUsageBytes - 1,
      },
    });

    expect(rejected.state.kind).toBe("crashed");
    expect(rejected.globals.get("Retained")).toBe(41);
  });
});
