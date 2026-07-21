import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type {
  RuntimeClass,
  RuntimeInstance,
} from "../../src/domain/runtime/value.js";
import { runPythonCs486 } from "./pythonCs486Harness.js";

describe("Computer System Python classes and instances", (): void => {
  it("executes class bodies, constructs instances, and binds user methods", (): void => {
    const machine = runPythonCs486(`
order = 0
def mark(value):
    global order
    order = order * 10 + value
    return value
class Point:
    first = mark(1)
    second = mark(2)
    def __init__(self, value):
        self.value = value
    def plus(self, amount=1):
        return self.value + amount
point = Point(40)
bound_result = point.plus(2)
unbound_result = Point.plus(point, 3)
same_object = point is point
different_object = point is Point(40)
class_name = Point.__name__
instance_class = point.__class__ is Point
base_class = Point.__base__ is object
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("order")).toBe(12);
    expect(machine.globals.get("bound_result")).toBe(42);
    expect(machine.globals.get("unbound_result")).toBe(43);
    expect(machine.globals.get("same_object")).toBe(true);
    expect(machine.globals.get("different_object")).toBe(false);
    expect(machine.globals.get("class_name")).toBe("Point");
    expect(machine.globals.get("instance_class")).toBe(true);
    expect(machine.globals.get("base_class")).toBe(true);
    const pointClass = machine.globals.get("Point") as RuntimeClass;
    expect([...pointClass.values.keys()]).toEqual([
      "first",
      "second",
      "__init__",
      "plus",
    ]);
  });

  it("evaluates one base expression once in the enclosing scope", (): void => {
    const machine = runPythonCs486(`
calls = 0
def choose_base():
    global calls
    calls = calls + 1
    return object
class Selected(choose_base()):
    marker = calls
result = Selected.marker
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("calls")).toBe(1);
    expect(machine.globals.get("result")).toBe(1);
  });

  it("uses instance attributes before inherited class attributes and does not bind functions stored on instances", (): void => {
    const machine = runPythonCs486(`
def direct(value):
    return value + 1
class Base:
    label = 10
    def __init__(self, value):
        self.value = value
    def total(self):
        return self.value + self.label
class Child(Base):
    label = 20
child = Child(22)
inherited = child.total()
child.label = 1
shadowed = child.total()
Child.label = 30
still_shadowed = child.total()
other = Child(12)
class_updated = other.total()
child.handler = direct
direct_result = child.handler(41)
instance_check = isinstance(child, Child) and isinstance(child, Base)
object_check = isinstance(child, object) and isinstance(1, object)
subclass_check = issubclass(Child, Base) and issubclass(Child, object)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("inherited")).toBe(42);
    expect(machine.globals.get("shadowed")).toBe(23);
    expect(machine.globals.get("still_shadowed")).toBe(23);
    expect(machine.globals.get("class_updated")).toBe(42);
    expect(machine.globals.get("direct_result")).toBe(42);
    expect(machine.globals.get("instance_check")).toBe(true);
    expect(machine.globals.get("object_check")).toBe(true);
    expect(machine.globals.get("subclass_check")).toBe(true);
  });

  it("keeps class namespaces out of method lexical lookup but carries enclosing cells through the class frame", (): void => {
    const machine = runPythonCs486(`
captured = 100
def build():
    captured = 7
    class Sample:
        before = captured
        captured = 9
        def read_outer(self):
            return captured
        def read_global(self):
            return global_only
    return Sample
global_only = 11
Sample = build()
sample = Sample()
before = Sample.before
class_value = Sample.captured
outer_value = sample.read_outer()
global_value = sample.read_global()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(7);
    expect(machine.globals.get("class_value")).toBe(9);
    expect(machine.globals.get("outer_value")).toBe(7);
    expect(machine.globals.get("global_value")).toBe(11);
  });

  it("resolves same-name class locals through an enclosing cell before assignment", (): void => {
    const machine = runPythonCs486(`
def factory(seed):
    class Local:
        seed = seed + 1
        def class_identity(self):
            return Local
    return Local
Local = factory(40)
item = Local()
copied = item.seed
identity_matches = item.class_identity() is Local
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("copied")).toBe(41);
    expect(machine.globals.get("identity_matches")).toBe(true);
  });

  it("routes initializer return errors back to the caller exception owner", (): void => {
    const machine = runPythonCs486(`
class Broken:
    def __init__(self):
        return 1
caught = False
try:
    value = Broken()
except TypeError:
    caught = True
after = 42
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("caught")).toBe(true);
    expect(machine.globals.get("after")).toBe(42);
    expect(machine.globals.has("value")).toBe(false);
  });

  it("publishes a class atomically and preserves the previous binding when its body fails", (): void => {
    const machine = runPythonCs486(`
class Stable:
    marker = 1
original = Stable
caught = False
try:
    class Stable:
        marker = 2
        missing_name
except NameError:
    caught = True
preserved = Stable is original
marker = Stable.marker
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("caught")).toBe(true);
    expect(machine.globals.get("preserved")).toBe(true);
    expect(machine.globals.get("marker")).toBe(1);
  });

  it("evaluates the base before the class body exactly once", (): void => {
    const machine = runPythonCs486(`
order = 0
def mark(value):
    global order
    order = order * 10 + value
    return value
def choose_base():
    mark(1)
    return object
class Ordered(choose_base()):
    value = mark(2)
result = order
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("result")).toBe(12);
  });

  it("reports invalid bases, class calls, and initializer return values", (): void => {
    const invalidBase = runPythonCs486(`
class Invalid(1):
    pass
`);
    const missingInitializer = runPythonCs486(`
class Plain:
    pass
Plain(1)
`);
    const invalidInitializer = runPythonCs486(`
class Invalid:
    __init__ = 1
Invalid()
`);
    const returningInitializer = runPythonCs486(`
class Invalid:
    def __init__(self):
        return 1
Invalid()
`);

    for (const machine of [
      invalidBase,
      missingInitializer,
      invalidInitializer,
      returningInitializer,
    ]) {
      expect(machine.state.kind).toBe("crashed");
      if (machine.state.kind === "crashed") {
        expect(machine.state.error.typeName).toBe("TypeError");
      }
    }
  });

  it("accepts exact class and instance namespace capacity and rejects capacity plus one without the final write", (): void => {
    const classExact = runPythonCs486(
      `
class Exact:
    first = 1
    second = 2
result = Exact.second
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 2 },
      },
    );
    const classOverflow = runPythonCs486(
      `
class Overflow:
    first = 1
    second = 2
    third = 3
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 2 },
      },
    );
    const instance = runPythonCs486(
      `
class Item:
    pass
item = Item()
item.first = 1
item.second = 2
caught = False
try:
    item.third = 3
except ResourceLimitError:
    caught = True
missing = False
try:
    item.third
except AttributeError:
    missing = True
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 2 },
      },
    );

    expect(classExact.state.kind).toBe("completed");
    expect(classExact.globals.get("result")).toBe(2);
    expect(classOverflow.state.kind).toBe("crashed");
    if (classOverflow.state.kind === "crashed") {
      expect(classOverflow.state.error.typeName).toBe("ResourceLimitError");
    }
    expect(classOverflow.globals.has("Overflow")).toBe(false);
    expect(instance.state.kind).toBe("completed");
    expect(instance.globals.get("caught")).toBe(true);
    expect(instance.globals.get("missing")).toBe(true);
    const item = instance.globals.get("item") as RuntimeInstance;
    expect([...item.values]).toEqual([
      ["first", 1],
      ["second", 2],
    ]);
  });

  it("accounts reachable class, instance, and bound-method graphs", (): void => {
    const baseline = runPythonCs486("value = None\n");
    const retained = runPythonCs486(`
class Retained:
    payload = "${"x".repeat(128)}"
    def method(self):
        return self.payload
instance = Retained()
method = instance.method
`);

    expect(baseline.state.kind).toBe("completed");
    expect(retained.state.kind).toBe("completed");
    expect(retained.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + 128,
    );
  });

  it("rejects heap growth before publishing a class or attribute write", (): void => {
    const classSource = `
class Retained:
    first = 1
    second = 2
    third = 3
    fourth = 4
`;
    const measuredClass = runPythonCs486(classSource);
    const classLimit = measuredClass.program.runtime.memoryUsageBytes - 1;
    const rejectedClass = runPythonCs486(classSource, {
      limits: {
        ...defaultPythonRuntimeLimits,
        maxMemoryBytes: classLimit,
      },
    });

    const instanceBase = runPythonCs486(`
class Item:
    pass
item = Item()
`);
    const attributeSource = `
class Item:
    pass
item = Item()
item.payload = 1
`;
    const measuredAttribute = runPythonCs486(attributeSource);
    const attributeLimit =
      measuredAttribute.program.runtime.memoryUsageBytes - 1;
    expect(attributeLimit).toBeGreaterThanOrEqual(
      instanceBase.program.runtime.memoryUsageBytes,
    );
    const rejectedAttribute = runPythonCs486(attributeSource, {
      limits: {
        ...defaultPythonRuntimeLimits,
        maxMemoryBytes: attributeLimit,
      },
    });

    expect(measuredClass.state.kind).toBe("completed");
    expect(rejectedClass.state.kind).toBe("crashed");
    if (rejectedClass.state.kind === "crashed") {
      expect(rejectedClass.state.error.typeName).toBe("MemoryError");
    }
    expect(rejectedClass.globals.has("Retained")).toBe(false);
    expect(measuredAttribute.state.kind).toBe("completed");
    expect(rejectedAttribute.state.kind).toBe("crashed");
    if (rejectedAttribute.state.kind === "crashed") {
      expect(rejectedAttribute.state.error.typeName).toBe("MemoryError");
    }
    const item = rejectedAttribute.globals.get("item") as RuntimeInstance;
    expect(item.values.has("payload")).toBe(false);
  });

  it("accepts MRO length 64 and rejects length 65 before publishing the class", (): void => {
    const source = (count: number): string => {
      const definitions = ["class C0:\n    pass"];
      for (let index = 1; index < count; index += 1) {
        definitions.push(
          `class C${String(index)}(C${String(index - 1)}):\n    pass`,
        );
      }
      definitions.push(`result = C${String(count - 1)}`);
      return `${definitions.join("\n")}\n`;
    };
    const exact = runPythonCs486(source(63));
    const overflow = runPythonCs486(source(64));

    expect(exact.state.kind).toBe("completed");
    expect(overflow.state.kind).toBe("crashed");
    if (overflow.state.kind === "crashed") {
      expect(overflow.state.error.typeName).toBe("ResourceLimitError");
      expect(overflow.state.error.message).toContain(
        "class method resolution order limit",
      );
    }
    expect(overflow.globals.has("C63")).toBe(false);
  });
});
