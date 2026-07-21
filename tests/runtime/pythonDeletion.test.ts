import { describe, expect, it } from "vitest";

import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python deletion", (): void => {
  it("deletes names, attributes, list/dictionary items, and list slices", (): void => {
    const machine = runPythonCs486Core(`
name = 41
del name
name_missing = False
try:
    observed = name
except NameError:
    name_missing = True

class Item:
    pass

item = Item()
item.value = 42
del item.value
attribute_missing = False
try:
    observed = item.value
except AttributeError:
    attribute_missing = True

values = [0, 1, 2, 3, 4, 5]
del values[1]
del values[1:4:2]
mapping = {"keep": 1, "drop": 2}
del mapping["drop"]

missing_key = False
try:
    del mapping["drop"]
except KeyError:
    missing_key = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("name_missing")).toBe(true);
    expect(machine.globals.get("attribute_missing")).toBe(true);
    expect(machine.globals.get("values")).toMatchObject({
      kind: "list",
      values: [0, 3, 5],
    });
    expect(machine.globals.get("mapping")).toMatchObject({
      kind: "dictionary",
      entries: new Map([["keep", 1]]),
    });
    expect(machine.globals.get("missing_key")).toBe(true);
  });

  it("invokes descriptor and property deleters without publishing fallback mutation", (): void => {
    const machine = runPythonCs486Core(`
events = ""

class Descriptor:
    def __get__(self, instance, owner):
        return 41

    def __delete__(self, instance):
        global events
        events = events + "descriptor;"
        instance.descriptor_deleted = True

class Item:
    managed = Descriptor()

    def __init__(self):
        self._value = 42

    @property
    def value(self):
        return self._value

    @value.deleter
    def value(self):
        global events
        events = events + "property;"
        del self._value

item = Item()
del item.managed
del item.value
descriptor_deleted = item.descriptor_deleted
value_missing = False
try:
    observed = item._value
except AttributeError:
    value_missing = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("events")).toBe("descriptor;property;");
    expect(machine.globals.get("descriptor_deleted")).toBe(true);
    expect(machine.globals.get("value_missing")).toBe(true);
  });

  it("preserves left-to-right target deletion and explicit failure ownership", (): void => {
    const machine = runPythonCs486Core(`
events = ""

class Item:
    def __init__(self, name):
        self.name = name
        self.value = 1

    def __delattr__(self, name):
        global events
        events = events + self.name
        raise ValueError(self.name)

left = [1]
right = [2]
failed = False
try:
    del (left[0], right[2])
except IndexError:
    failed = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("left")).toMatchObject({
      kind: "list",
      values: [],
    });
    expect(machine.globals.get("right")).toMatchObject({
      kind: "list",
      values: [2],
    });
  });

  it("resumes deletion under low CS486 instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
class Descriptor:
    def __delete__(self, instance):
        instance.done = True

class Item:
    value = Descriptor()

item = Item()
del item.value
done = item.done
`);

    for (
      let slices = 0;
      slices < 2_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles);
      slices += 1
    ) {
      machine.runCpuSlice(100_000, 8);
    }

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("done")).toBe(true);
  });
});
