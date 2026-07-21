import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python __new__ construction", (): void => {
  it("allocates default and direct object.__new__ instances with strict direct arguments", (): void => {
    const machine = runPythonCs486Core(`
class Plain:
    pass
normal = Plain()
raw = object.__new__(Plain)
normal_ok = normal.__class__ is Plain
raw_ok = raw.__class__ is Plain
bad_class = False
bad_extra = False
try:
    object.__new__(1)
except TypeError:
    bad_class = True
try:
    object.__new__(Plain, 1)
except TypeError:
    bad_extra = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("normal_ok")).toBe(true);
    expect(machine.globals.get("raw_ok")).toBe(true);
    expect(machine.globals.get("bad_class")).toBe(true);
    expect(machine.globals.get("bad_extra")).toBe(true);
  });

  it("treats plain __new__ as static and forwards constructor arguments once", (): void => {
    const machine = runPythonCs486Core(`
order = 0
class Created:
    def __new__(cls, value, *, extra=0):
        global order
        order = order * 10 + 1
        item = super().__new__(cls)
        item.from_new = value + extra
        return item
    def __init__(self, value, *, extra=0):
        global order
        order = order * 10 + 2
        self.from_init = value - extra
item = Created(41, extra=1)
raw_one = Created.__new__(Created, 5, extra=2)
raw_two = raw_one.__new__(Created, 6, extra=3)
result = item.from_new + item.from_init
static_ok = raw_one.__class__ is Created and raw_two.__class__ is Created
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("order")).toBe(1211);
    expect(machine.globals.get("result")).toBe(82);
    expect(machine.globals.get("static_ok")).toBe(true);
  });

  it("initializes a returned subclass and skips init for another return value", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
class Base:
    def __new__(cls, mode):
        if mode == 0:
            return 41
        return object.__new__(Child)
    def __init__(self, mode):
        global calls
        calls = calls + 10
class Child(Base):
    def __init__(self, mode):
        global calls
        calls = calls + 1
        self.value = mode
number = Base(0)
item = Base(42)
number_ok = number == 41
subclass_ok = item.__class__ is Child and item.value == 42
class Root:
    def __new__(cls, value):
        item = object.__new__(cls)
        item.marker = value
        return item
class Left(Root):
    pass
class Right(Root):
    def __new__(cls, value):
        item = object.__new__(cls)
        item.marker = value + 1
        return item
class Diamond(Left, Right):
    pass
diamond = Diamond(41)
c3_ok = diamond.__class__ is Diamond and diamond.marker == 42
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("number_ok")).toBe(true);
    expect(machine.globals.get("subclass_ok")).toBe(true);
    expect(machine.globals.get("c3_ok")).toBe(true);
    expect(machine.globals.get("calls")).toBe(1);
  });

  it("lets custom __new__ consume arguments before inherited object.__init__", (): void => {
    const machine = runPythonCs486Core(`
class Consumes:
    def __new__(cls, value):
        item = object.__new__(cls)
        item.value = value
        return item
item = Consumes(42)
constructed = item.value
direct_strict = False
try:
    object.__init__(item, 1)
except TypeError:
    direct_strict = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("constructed")).toBe(42);
    expect(machine.globals.get("direct_strict")).toBe(true);
  });

  it("owns nested construction and recovers after new or init faults", (): void => {
    const machine = runPythonCs486Core(`
class Inner:
    def __new__(cls, value):
        item = object.__new__(cls)
        item.value = value
        return item
class Outer:
    def __new__(cls, value):
        inner = Inner(value)
        item = object.__new__(cls)
        item.inner = inner
        return item
    def __init__(self, value):
        self.value = value + 1
class BrokenNew:
    def __new__(cls):
        raise ValueError("new")
class BrokenInit:
    def __new__(cls):
        return object.__new__(cls)
    def __init__(self):
        raise ValueError("init")
new_fault = False
init_fault = False
try:
    BrokenNew()
except ValueError:
    new_fault = True
try:
    BrokenInit()
except ValueError:
    init_fault = True
item = Outer(41)
after = item.inner.value + item.value
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("new_fault")).toBe(true);
    expect(machine.globals.get("init_fault")).toBe(true);
    expect(machine.globals.get("after")).toBe(83);
  });

  it("rejects invalid constructor hooks and preserves initializer return errors", (): void => {
    const machine = runPythonCs486Core(`
class Missing:
    __new__ = 1
bad_new = False
try:
    Missing()
except TypeError:
    bad_new = True
class BrokenInit:
    def __new__(cls):
        return object.__new__(cls)
    def __init__(self):
        return 1
bad_init = False
try:
    BrokenInit()
except TypeError:
    bad_init = True
after = 42
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("bad_new")).toBe(true);
    expect(machine.globals.get("bad_init")).toBe(true);
    expect(machine.globals.get("after")).toBe(42);
  });

  it("rejects retained bare-instance heap growth before publication", (): void => {
    const prefix = `
class Item:
    pass
`;
    const baseline = runPythonCs486Core(`${prefix}\nvalue = None\n`);
    const measured = runPythonCs486Core(
      `${prefix}\nvalue = object.__new__(Item)\n`,
    );
    const limit = measured.program.runtime.memoryUsageBytes - 1;
    expect(limit).toBeGreaterThanOrEqual(
      baseline.program.runtime.memoryUsageBytes,
    );
    const rejected = runPythonCs486Core(
      `${prefix}\nvalue = object.__new__(Item)\n`,
      {
        limits: {
          ...defaultPythonRuntimeLimits,
          maxMemoryBytes: limit,
        },
      },
    );

    expect(measured.state.kind).toBe("completed");
    expect(
      rejected.state.kind,
      JSON.stringify({
        baseline: baseline.program.runtime.memoryUsageBytes,
        limit,
        measured: measured.program.runtime.memoryUsageBytes,
        rejected: rejected.program.runtime.memoryUsageBytes,
      }),
    ).toBe("crashed");
    if (rejected.state.kind === "crashed") {
      expect(rejected.state.error.typeName).toBe("MemoryError");
    }
    expect(rejected.globals.has("Item")).toBe(true);
    expect(rejected.globals.has("value")).toBe(false);
  });

  it("recovers from call-depth rejection and resumes under eight-instruction slices", (): void => {
    const limited = runPythonCs486Core(
      `
class Inner:
    def __new__(cls):
        return object.__new__(cls)
class Outer:
    def __new__(cls):
        Inner()
        return object.__new__(cls)
caught = False
try:
    Outer()
except ResourceLimitError:
    caught = True
after = 42
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );
    const sliced = new PythonCs486CoreHarness(`
class Item:
    def __new__(cls, value):
        item = super().__new__(cls)
        item.value = value
        return item
    def __init__(self, value):
        self.value = self.value + 1
result = Item(41).value
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
