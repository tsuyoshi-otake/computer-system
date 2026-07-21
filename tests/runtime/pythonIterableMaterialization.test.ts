import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type {
  RuntimeList,
  RuntimeSet,
  RuntimeTuple,
} from "../../src/domain/runtime/value.js";
import { runPythonCs486Core } from "./pythonCs486CoreHarness.js";

describe("Computer System Python generic iterable materialization", (): void => {
  it("consumes class-backed iterators across every synchronous materializing consumer", (): void => {
    const machine = runPythonCs486Core(`
class Cursor:
    def __init__(self, values):
        self.values = values
        self.index = 0
    def __iter__(self):
        return self
    def __next__(self):
        if self.index == len(self.values):
            raise StopIteration(91)
        value = self.values[self.index]
        self.index = self.index + 1
        return value

list_result = [0, *Cursor([1, 2]), 3]
tuple_result = (0, *Cursor([1, 2]), 3)
display_set = {0, *Cursor([1, 2, 2])}

def collect(*items):
    return items

call_result = collect(-1, *Cursor([1, 2]), 3)
left, *middle, right = Cursor([4, 5, 6, 7])
simple_slice = [0, 9]
simple_slice[1:2] = Cursor([1, 2])
extended_slice = [0, 0, 0, 0]
extended_slice[::2] = Cursor([8, 9])
constructed_set = set(Cursor([3, 1, 3, 2]))
current = Cursor([10, 11, 12])
head = next(current)
tail = [*current]
done = next(current, "done")
`);

    expect(
      machine.state.kind,
      machine.state.kind === "crashed"
        ? machine.state.error.message
        : JSON.stringify(machine.state),
    ).toBe("completed");
    expect((machine.globals.get("list_result") as RuntimeList).values).toEqual([
      0, 1, 2, 3,
    ]);
    expect(
      (machine.globals.get("tuple_result") as RuntimeTuple).values,
    ).toEqual([0, 1, 2, 3]);
    expect([
      ...(machine.globals.get("display_set") as RuntimeSet).entries.values(),
    ]).toEqual([0, 1, 2]);
    expect((machine.globals.get("call_result") as RuntimeTuple).values).toEqual(
      [-1, 1, 2, 3],
    );
    expect(machine.globals.get("left")).toBe(4);
    expect((machine.globals.get("middle") as RuntimeList).values).toEqual([
      5, 6,
    ]);
    expect(machine.globals.get("right")).toBe(7);
    expect((machine.globals.get("simple_slice") as RuntimeList).values).toEqual(
      [0, 1, 2],
    );
    expect(
      (machine.globals.get("extended_slice") as RuntimeList).values,
    ).toEqual([8, 0, 9, 0]);
    expect([
      ...(
        machine.globals.get("constructed_set") as RuntimeSet
      ).entries.values(),
    ]).toEqual([3, 1, 2]);
    expect(machine.globals.get("head")).toBe(10);
    expect((machine.globals.get("tail") as RuntimeList).values).toEqual([
      11, 12,
    ]);
    expect(machine.globals.get("done")).toBe("done");
  });

  it("resumes generators through the same display, call, unpack, slice, and set paths", (): void => {
    const machine = runPythonCs486Core(`
def values():
    yield 1
    yield 2
    yield 2
    yield 3

def collect(*items):
    return items

list_result = [0, *values(), 4]
tuple_result = (*values(),)
display_set = {*values()}
call_result = collect(*values())
first, *middle, last = values()
slice_result = [9]
slice_result[0:1] = values()
extended = [0, 0, 0, 0]
def pair():
    yield 7
    yield 8
extended[::2] = pair()
constructed_set = set(values())
`);

    expect(
      machine.state.kind,
      machine.state.kind === "crashed"
        ? machine.state.error.message
        : JSON.stringify(machine.state),
    ).toBe("completed");
    expect((machine.globals.get("list_result") as RuntimeList).values).toEqual([
      0, 1, 2, 2, 3, 4,
    ]);
    expect(
      (machine.globals.get("tuple_result") as RuntimeTuple).values,
    ).toEqual([1, 2, 2, 3]);
    expect([
      ...(machine.globals.get("display_set") as RuntimeSet).entries.values(),
    ]).toEqual([1, 2, 3]);
    expect((machine.globals.get("call_result") as RuntimeTuple).values).toEqual(
      [1, 2, 2, 3],
    );
    expect(machine.globals.get("first")).toBe(1);
    expect((machine.globals.get("middle") as RuntimeList).values).toEqual([
      2, 2,
    ]);
    expect(machine.globals.get("last")).toBe(3);
    expect((machine.globals.get("slice_result") as RuntimeList).values).toEqual(
      [1, 2, 2, 3],
    );
    expect((machine.globals.get("extended") as RuntimeList).values).toEqual([
      7, 0, 8, 0,
    ]);
    expect([
      ...(
        machine.globals.get("constructed_set") as RuntimeSet
      ).entries.values(),
    ]).toEqual([1, 2, 3]);
  });

  it("propagates iterator faults without publishing calls, stores, or slice mutations", (): void => {
    const machine = runPythonCs486Core(`
class Broken:
    def __init__(self, label):
        self.label = label
        self.index = 0
    def __iter__(self):
        return self
    def __next__(self):
        global events
        events = [*events, self.label]
        if self.index == 1:
            raise ValueError(self.label)
        self.index = self.index + 1
        return self.index

events = []
display = 70
try:
    display = [*Broken("display")]
except ValueError:
    pass

calls = 0
def collect(*items):
    global calls
    calls = calls + 1
    return items
try:
    collect(*Broken("call"))
except ValueError:
    pass

left = 71
right = 72
try:
    left, right = Broken("unpack")
except ValueError:
    pass

slice_target = [73, 74]
try:
    slice_target[0:1] = Broken("slice")
except ValueError:
    pass

set_result = 75
try:
    set_result = set(Broken("set"))
except ValueError:
    pass
continued = 76
`);

    expect(
      machine.state.kind,
      machine.state.kind === "crashed"
        ? machine.state.error.message
        : JSON.stringify(machine.state),
    ).toBe("completed");
    expect(machine.globals.get("display")).toBe(70);
    expect(machine.globals.get("calls")).toBe(0);
    expect(machine.globals.get("left")).toBe(71);
    expect(machine.globals.get("right")).toBe(72);
    expect((machine.globals.get("slice_target") as RuntimeList).values).toEqual(
      [73, 74],
    );
    expect(machine.globals.get("set_result")).toBe(75);
    expect((machine.globals.get("events") as RuntimeList).values).toEqual([
      "display",
      "display",
      "call",
      "call",
      "unpack",
      "unpack",
      "slice",
      "slice",
      "set",
      "set",
    ]);
    expect(machine.globals.get("continued")).toBe(76);
  });

  it("accepts the exact collection limit and rejects capacity plus one at every consumer", (): void => {
    const machine = runPythonCs486Core(
      `
def exact():
    yield 1
    yield 2
    yield 3

def excessive():
    yield 1
    yield 2
    yield 3
    yield 4

def collect(*items):
    return items

exact_display = [*exact()]
exact_call = collect(*exact())
exact_set = set(exact())
exact_slice = []
exact_slice[0:0] = exact()

display_limited = False
try:
    rejected_display = [*excessive()]
except ResourceLimitError:
    display_limited = True

call_limited = False
try:
    rejected_call = collect(*excessive())
except ResourceLimitError:
    call_limited = True

unpack_limited = False
left = 40
right = 41
try:
    left, *middle, right = excessive()
except ResourceLimitError:
    unpack_limited = True

slice_limited = False
slice_target = [42]
try:
    slice_target[0:1] = excessive()
except ResourceLimitError:
    slice_limited = True

set_limited = False
set_result = 43
try:
    set_result = set(excessive())
except ResourceLimitError:
    set_limited = True
continued = 44
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 3 },
      },
    );

    expect(
      machine.state.kind,
      machine.state.kind === "crashed"
        ? machine.state.error.message
        : JSON.stringify(machine.state),
    ).toBe("completed");
    expect(
      (machine.globals.get("exact_display") as RuntimeList).values,
    ).toEqual([1, 2, 3]);
    expect((machine.globals.get("exact_call") as RuntimeTuple).values).toEqual([
      1, 2, 3,
    ]);
    expect([
      ...(machine.globals.get("exact_set") as RuntimeSet).entries.values(),
    ]).toEqual([1, 2, 3]);
    expect((machine.globals.get("exact_slice") as RuntimeList).values).toEqual([
      1, 2, 3,
    ]);
    expect(machine.globals.get("display_limited")).toBe(true);
    expect(machine.globals.get("call_limited")).toBe(true);
    expect(machine.globals.get("unpack_limited")).toBe(true);
    expect(machine.globals.get("slice_limited")).toBe(true);
    expect(machine.globals.get("set_limited")).toBe(true);
    expect(machine.globals.get("left")).toBe(40);
    expect(machine.globals.get("right")).toBe(41);
    expect((machine.globals.get("slice_target") as RuntimeList).values).toEqual(
      [42],
    );
    expect(machine.globals.get("set_result")).toBe(43);
    expect(machine.globals.get("continued")).toBe(44);
  });

  it("accepts separate iterators and generator-returning __iter__ at materializing boundaries", (): void => {
    const machine = runPythonCs486Core(`
class Cursor:
    def __init__(self, values):
        self.values = values
        self.index = 0
    def __iter__(self):
        return self
    def __next__(self):
        if self.index == len(self.values):
            raise StopIteration
        value = self.values[self.index]
        self.index = self.index + 1
        return value

class Separate:
    def __iter__(self):
        return Cursor([1, 2, 3])

class Generated:
    def __iter__(self):
        yield 4
        yield 5

def collect(*items):
    return items

separate_display = [*Separate()]
generated_display = [*Generated()]
separate_call = collect(*Separate())
generated_call = collect(*Generated())
generated_slice = [0]
generated_slice[0:1] = Generated()
`);

    expect(
      machine.state.kind,
      machine.state.kind === "crashed"
        ? machine.state.error.message
        : JSON.stringify(machine.state),
    ).toBe("completed");
    expect(
      (machine.globals.get("separate_display") as RuntimeList).values,
    ).toEqual([1, 2, 3]);
    expect(
      (machine.globals.get("generated_display") as RuntimeList).values,
    ).toEqual([4, 5]);
    expect(
      (machine.globals.get("separate_call") as RuntimeTuple).values,
    ).toEqual([1, 2, 3]);
    expect(
      (machine.globals.get("generated_call") as RuntimeTuple).values,
    ).toEqual([4, 5]);
    expect(
      (machine.globals.get("generated_slice") as RuntimeList).values,
    ).toEqual([4, 5]);
  });

  it("preserves expression, expansion, and callee order across mixed iterable sources", (): void => {
    const machine = runPythonCs486Core(`
events = []
def record(label, value):
    global events
    events = [*events, label]
    return value

class Cursor:
    def __init__(self, label, values):
        self.label = label
        self.values = values
        self.index = 0
    def __iter__(self):
        global events
        events = [*events, self.label + ":iter"]
        return self
    def __next__(self):
        global events
        events = [*events, self.label + ":next"]
        if self.index == len(self.values):
            raise StopIteration
        value = self.values[self.index]
        self.index = self.index + 1
        return value

def collect(*items, named):
    global events
    events = [*events, "callee"]
    return items

result = collect(
    *record("built-source", iter([1, 2])),
    *record("user-source", Cursor("user", [3, 4])),
    record("direct", 5),
    named=record("keyword", 6),
)
`);

    expect(
      machine.state.kind,
      machine.state.kind === "crashed"
        ? machine.state.error.message
        : JSON.stringify(machine.state),
    ).toBe("completed");
    expect((machine.globals.get("result") as RuntimeTuple).values).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect((machine.globals.get("events") as RuntimeList).values).toEqual([
      "built-source",
      "user-source",
      "direct",
      "keyword",
      "user:iter",
      "user:next",
      "user:next",
      "user:next",
      "callee",
    ]);
  });

  it("bounds duplicate production and rolls back materialization call-depth admission", (): void => {
    const duplicateLimited = runPythonCs486Core(
      `
def duplicates():
    yield 1
    yield 1
    yield 1
    yield 1

limited = False
result = 10
try:
    result = set(duplicates())
except ResourceLimitError:
    limited = True
continued = 11
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 3 },
      },
    );

    expect(
      duplicateLimited.state.kind,
      duplicateLimited.state.kind === "crashed"
        ? duplicateLimited.state.error.message
        : JSON.stringify(duplicateLimited.state),
    ).toBe("completed");
    expect(duplicateLimited.globals.get("limited")).toBe(true);
    expect(duplicateLimited.globals.get("result")).toBe(10);
    expect(duplicateLimited.globals.get("continued")).toBe(11);

    const depthLimited = runPythonCs486Core(
      `
def nested():
    return 1

class Cursor:
    def __iter__(self):
        return self
    def __next__(self):
        return nested()

limited = False
result = 20
try:
    result = [*Cursor()]
except ResourceLimitError:
    limited = True
continued = 21
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(
      depthLimited.state.kind,
      depthLimited.state.kind === "crashed"
        ? depthLimited.state.error.message
        : JSON.stringify(depthLimited.state),
    ).toBe("completed");
    expect(depthLimited.globals.get("limited")).toBe(true);
    expect(depthLimited.globals.get("result")).toBe(20);
    expect(depthLimited.globals.get("continued")).toBe(21);
  });
});
