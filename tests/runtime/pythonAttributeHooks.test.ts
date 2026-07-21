import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python attribute customization", (): void => {
  it("routes inherited explicit reads, writes, and deletions through managed hooks", (): void => {
    const machine = runPythonCs486Core(`
events = ""

class Base:
    def __getattribute__(self, name):
        global events
        events = events + "get:" + name + ";"
        if name == "virtual":
            return 41
        return object.__getattribute__(self, name)

    def __getattr__(self, name):
        global events
        events = events + "fallback:" + name + ";"
        return 42

    def __setattr__(self, name, value):
        global events
        events = events + "set:" + name + ";"
        object.__setattr__(self, name, value)

    def __delattr__(self, name):
        global events
        events = events + "del:" + name + ";"
        object.__delattr__(self, name)

class Item(Base):
    pass

item = Item()
item.value = 40
stored = item.value
virtual = item.virtual
missing = item.missing
set_result = setattr(item, "other", 43)
other = getattr(item, "other")
del_result = delattr(item, "other")
deleted = getattr(item, "other")
`);

    if (machine.state.kind === "crashed") {
      throw new Error(
        `${machine.state.error.typeName}: ${machine.state.error.message}`,
      );
    }
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("stored")).toBe(40);
    expect(machine.globals.get("virtual")).toBe(41);
    expect(machine.globals.get("missing")).toBe(42);
    expect(machine.globals.get("other")).toBe(43);
    expect(machine.globals.get("deleted")).toBe(42);
    expect(machine.globals.get("set_result")).toBeNull();
    expect(machine.globals.get("del_result")).toBeNull();
    expect(machine.globals.get("events")).toBe(
      "set:value;get:value;get:virtual;get:missing;fallback:missing;" +
        "set:other;get:other;del:other;get:other;fallback:other;",
    );
  });

  it("uses __getattr__ only after AttributeError and honors getattr defaults", (): void => {
    const machine = runPythonCs486Core(`
events = ""

class MissingDescriptor:
    def __get__(self, instance, owner):
        raise AttributeError("descriptor miss")

class BrokenDescriptor:
    def __get__(self, instance, owner):
        raise ValueError("broken")

class Item:
    missing = MissingDescriptor()
    broken = BrokenDescriptor()

    def __getattr__(self, name):
        global events
        events = events + name + ";"
        return name + "!"

item = Item()
descriptor_fallback = item.missing
ordinary_fallback = item.unknown
value_error_seen = False
try:
    observed = item.broken
except ValueError:
    value_error_seen = True

class Empty:
    pass

empty = Empty()
default_missing = getattr(empty, "missing", 99)

class Rejecting:
    def __getattr__(self, name):
        raise AttributeError(name)

default_rejected = getattr(Rejecting(), "missing", 100)

class Dynamic:
    pass

class_name = getattr(Dynamic, "__name__")
class_set_result = setattr(Dynamic, "flag", 55)
class_flag = getattr(Dynamic, "flag")
class_del_result = delattr(Dynamic, "flag")
class_default = getattr(Dynamic, "flag", 56)
`);

    if (machine.state.kind === "crashed") {
      throw new Error(
        `${machine.state.error.typeName}: ${machine.state.error.message}`,
      );
    }
    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("descriptor_fallback")).toBe("missing!");
    expect(machine.globals.get("ordinary_fallback")).toBe("unknown!");
    expect(machine.globals.get("value_error_seen")).toBe(true);
    expect(machine.globals.get("default_missing")).toBe(99);
    expect(machine.globals.get("default_rejected")).toBe(100);
    expect(machine.globals.get("class_name")).toBe("Dynamic");
    expect(machine.globals.get("class_flag")).toBe(55);
    expect(machine.globals.get("class_default")).toBe(56);
    expect(machine.globals.get("class_set_result")).toBeNull();
    expect(machine.globals.get("class_del_result")).toBeNull();
    expect(machine.globals.get("events")).toBe("missing;unknown;");
  });

  it("propagates invalid hooks and shares the managed call-depth limit", (): void => {
    const machine = runPythonCs486Core(
      `
class InvalidGet:
    __getattribute__ = None

invalid_get = False
try:
    ignored = InvalidGet().value
except TypeError:
    invalid_get = True

class InvalidSet:
    __setattr__ = None

invalid_set = False
try:
    InvalidSet().value = 1
except TypeError:
    invalid_set = True

def nested():
    return 42

class Limited:
    def __getattribute__(self, name):
        return nested()

limited = False
try:
    ignored = Limited().value
except ResourceLimitError:
    limited = True
continued = 43
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("invalid_get")).toBe(true);
    expect(machine.globals.get("invalid_set")).toBe(true);
    expect(machine.globals.get("limited")).toBe(true);
    expect(machine.globals.get("continued")).toBe(43);
  });

  it("keeps implicit special-method lookup outside explicit attribute hooks", (): void => {
    const machine = runPythonCs486Core(`
events = ""

class Iterator:
    def __init__(self):
        object.__setattr__(self, "done", False)

    def __getattribute__(self, name):
        global events
        events = events + name + ";"
        return object.__getattribute__(self, name)

    def __iter__(self):
        return self

    def __next__(self):
        if object.__getattribute__(self, "done"):
            raise StopIteration()
        object.__setattr__(self, "done", True)
        return 41

iterator = Iterator()
first = next(iter(iterator))
events_after = events
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(41);
    expect(machine.globals.get("events_after")).toBe("");
  });

  it("resumes attribute hooks under low CS486 instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
class Item:
    def __getattribute__(self, name):
        if name == "value":
            return 41
        return object.__getattribute__(self, name)

    def __setattr__(self, name, value):
        object.__setattr__(self, name, value + 1)

    def __delattr__(self, name):
        object.__delattr__(self, name)

item = Item()
item.other = 41
stored = item.other
value = item.value
del item.other
missing = getattr(item, "other", 42)
`);

    for (
      let slices = 0;
      slices < 4_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles);
      slices += 1
    ) {
      machine.runCpuSlice(100_000, 8);
    }

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("stored")).toBe(42);
    expect(machine.globals.get("value")).toBe(41);
    expect(machine.globals.get("missing")).toBe(42);
  });
});
