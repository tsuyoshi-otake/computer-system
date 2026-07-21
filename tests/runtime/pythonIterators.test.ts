import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type {
  RuntimeDictionary,
  RuntimeList,
  RuntimeSet,
  RuntimeTuple,
} from "../../src/domain/runtime/value.js";
import { runPythonCs486Core as runPythonCs486 } from "./pythonCs486CoreHarness.js";

describe("Computer System Python built-in iterator protocol", (): void => {
  it("supports iter identity, next defaults, stable exhaustion, and catchable StopIteration", (): void => {
    const machine = runPythonCs486(`
items = [10, 20, 30]
cursor = iter(items)
identity = iter(cursor) is cursor
first = next(cursor)
second = next(cursor)
third = next(cursor)
fallback = next(cursor, 99)
fallback_again = next(cursor, 100)
stopped = False
try:
    next(cursor)
except StopIteration:
    stopped = True
invalid_next = False
try:
    next(items)
except TypeError:
    invalid_next = True
invalid_iter = False
try:
    iter(42)
except TypeError:
    invalid_iter = True
unicode_cursor = iter("A😀")
unicode_first = next(unicode_cursor)
unicode_second = next(unicode_cursor)
unicode_done = next(unicode_cursor, "done")
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("identity")).toBe(true);
    expect(machine.globals.get("first")).toBe(10);
    expect(machine.globals.get("second")).toBe(20);
    expect(machine.globals.get("third")).toBe(30);
    expect(machine.globals.get("fallback")).toBe(99);
    expect(machine.globals.get("fallback_again")).toBe(100);
    expect(machine.globals.get("stopped")).toBe(true);
    expect(machine.globals.get("invalid_next")).toBe(true);
    expect(machine.globals.get("invalid_iter")).toBe(true);
    expect(machine.globals.get("unicode_first")).toBe("A");
    expect(machine.globals.get("unicode_second")).toBe("😀");
    expect(machine.globals.get("unicode_done")).toBe("done");
  });

  it("shares current-position consumption across for, unpacking, displays, calls, slices, and set", (): void => {
    const machine = runPythonCs486(`
display_cursor = iter([1, 2, 3, 4])
display_head = next(display_cursor)
display_rest = [0, *display_cursor, 5]
display_done = next(display_cursor, 99)
unpack_cursor = iter([10, 20, 30, 40])
unpack_head = next(unpack_cursor)
unpack_left, *unpack_middle, unpack_right = unpack_cursor
def collect(*items):
    return items
call_cursor = iter([50, 60, 70])
call_head = next(call_cursor)
call_rest = collect(*call_cursor)
set_cursor = iter([1, 2, 2, 3])
set_head = next(set_cursor)
set_rest = set(set_cursor)
loop_cursor = iter([4, 5, 6])
loop_head = next(loop_cursor)
loop_total = 0
for value in loop_cursor:
    loop_total = loop_total + value
loop_done = next(loop_cursor, 99)
slice_cursor = iter([7, 8, 9])
slice_head = next(slice_cursor)
slice_target = [0, 1]
slice_target[1:2] = slice_cursor
slice_done = next(slice_cursor, 99)
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("display_head")).toBe(1);
    expect((machine.globals.get("display_rest") as RuntimeList).values).toEqual(
      [0, 2, 3, 4, 5],
    );
    expect(machine.globals.get("display_done")).toBe(99);
    expect(machine.globals.get("unpack_head")).toBe(10);
    expect(machine.globals.get("unpack_left")).toBe(20);
    expect(
      (machine.globals.get("unpack_middle") as RuntimeList).values,
    ).toEqual([30]);
    expect(machine.globals.get("unpack_right")).toBe(40);
    expect(machine.globals.get("call_head")).toBe(50);
    expect((machine.globals.get("call_rest") as RuntimeTuple).values).toEqual([
      60, 70,
    ]);
    expect(machine.globals.get("set_head")).toBe(1);
    expect([
      ...(machine.globals.get("set_rest") as RuntimeSet).entries.values(),
    ]).toEqual([2, 3]);
    expect(machine.globals.get("loop_head")).toBe(4);
    expect(machine.globals.get("loop_total")).toBe(11);
    expect(machine.globals.get("loop_done")).toBe(99);
    expect(machine.globals.get("slice_head")).toBe(7);
    expect((machine.globals.get("slice_target") as RuntimeList).values).toEqual(
      [0, 8, 9],
    );
    expect(machine.globals.get("slice_done")).toBe(99);
  });

  it("creates independent deterministic cursors for built-in collections", (): void => {
    const machine = runPythonCs486(`
values = [1, 2]
left = iter(values)
right = iter(values)
left_first = next(left)
right_first = next(right)
left_second = next(left)
right_second = next(right)
mapping = {"first": 1, "second": 2}
mapping_cursor = iter(mapping)
mapping_first = next(mapping_cursor)
mapping_second = next(mapping_cursor)
ordered_set = {3, 1, 2}
set_cursor = iter(ordered_set)
set_first = next(set_cursor)
set_second = next(set_cursor)
set_third = next(set_cursor)
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("left_first")).toBe(1);
    expect(machine.globals.get("right_first")).toBe(1);
    expect(machine.globals.get("left_second")).toBe(2);
    expect(machine.globals.get("right_second")).toBe(2);
    expect(machine.globals.get("mapping_first")).toBe("first");
    expect(machine.globals.get("mapping_second")).toBe("second");
    expect(machine.globals.get("set_first")).toBe(3);
    expect(machine.globals.get("set_second")).toBe(1);
    expect(machine.globals.get("set_third")).toBe(2);
    expect(
      (machine.globals.get("mapping") as RuntimeDictionary).entries.size,
    ).toBe(2);
  });

  it("rejects invalid arities and keyword forms explicitly", (): void => {
    const machine = runPythonCs486(`
too_many_next = False
try:
    next(iter([1]), 2, 3)
except TypeError:
    too_many_next = True
keyword_iter = False
try:
    iter(object=[1])
except TypeError:
    keyword_iter = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("too_many_next")).toBe(true);
    expect(machine.globals.get("keyword_iter")).toBe(true);
  });

  it("runs class-backed iterable and iterator methods through the managed call path", (): void => {
    const machine = runPythonCs486(`
class Countdown:
    def __init__(self, value):
        self.value = value
    def __iter__(self):
        return self
    def __next__(self):
        if self.value == 0:
            raise StopIteration
        current = self.value
        self.value = self.value - 1
        return current

cursor = Countdown(3)
identity = iter(cursor) is cursor
first = next(cursor)
rest = []
for value in cursor:
    rest = [*rest, value]
fallback = next(cursor, 99)
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("identity")).toBe(true);
    expect(machine.globals.get("first")).toBe(3);
    expect((machine.globals.get("rest") as RuntimeList).values).toEqual([2, 1]);
    expect(machine.globals.get("fallback")).toBe(99);
  });

  it("supports inherited methods, separate iterators, and generator-returning __iter__", (): void => {
    const machine = runPythonCs486(`
class CursorBase:
    def __iter__(self):
        return self
    def __next__(self):
        if self.index == len(self.values):
            raise StopIteration
        value = self.values[self.index]
        self.index = self.index + 1
        return value

class Cursor(CursorBase):
    def __init__(self, values):
        self.values = values
        self.index = 0

class Container:
    def __iter__(self):
        return Cursor([4, 5, 6])

class Generated:
    def __iter__(self):
        yield 7
        yield 8

container_values = [value for value in Container()]
generated_values = [value for value in Generated()]
expression = (value * 2 for value in Container())
expression_first = next(expression)
expression_rest = [value for value in expression]
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(
      (machine.globals.get("container_values") as RuntimeList).values,
    ).toEqual([4, 5, 6]);
    expect(
      (machine.globals.get("generated_values") as RuntimeList).values,
    ).toEqual([7, 8]);
    expect(machine.globals.get("expression_first")).toBe(8);
    expect(
      (machine.globals.get("expression_rest") as RuntimeList).values,
    ).toEqual([10, 12]);
  });

  it("uses class-only special lookup and rejects invalid iterator results", (): void => {
    const machine = runPythonCs486(`
class Missing:
    pass

instance_only = Missing()
instance_only.__iter__ = lambda: iter([1])
instance_lookup_rejected = False
try:
    iter(instance_only)
except TypeError:
    instance_lookup_rejected = True

class NonCallable:
    __iter__ = 1

non_callable_rejected = False
try:
    iter(NonCallable())
except TypeError:
    non_callable_rejected = True

class BadResult:
    def __iter__(self):
        return [1, 2]

bad_result_rejected = False
try:
    iter(BadResult())
except TypeError:
    bad_result_rejected = True

class BrokenNext:
    def __iter__(self):
        return self
    __next__ = 1

broken_next_rejected = False
try:
    iter(BrokenNext())
except TypeError:
    broken_next_rejected = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("instance_lookup_rejected")).toBe(true);
    expect(machine.globals.get("non_callable_rejected")).toBe(true);
    expect(machine.globals.get("bad_result_rejected")).toBe(true);
    expect(machine.globals.get("broken_next_rejected")).toBe(true);
  });

  it("routes StopIteration defaults while preserving other iterator faults", (): void => {
    const machine = runPythonCs486(`
class Empty:
    def __iter__(self):
        return self
    def __next__(self):
        raise StopIteration

cursor = Empty()
default_value = next(cursor, "done")
stopped = False
try:
    next(cursor)
except StopIteration:
    stopped = True

class Broken:
    def __iter__(self):
        return self
    def __next__(self):
        raise ValueError("broken")

exact_fault = False
try:
    next(Broken())
except ValueError:
    exact_fault = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("default_value")).toBe("done");
    expect(machine.globals.get("stopped")).toBe(true);
    expect(machine.globals.get("exact_fault")).toBe(true);
  });

  it("delegates user iterators through yield from and preserves StopIteration.value", (): void => {
    const machine = runPythonCs486(`
class Cursor:
    def __init__(self):
        self.index = 0
    def __iter__(self):
        return self
    def __next__(self):
        if self.index == 0:
            self.index = 1
            return None
        if self.index == 1:
            self.index = 2
            return 4
        raise StopIteration(73)

class Values:
    def __iter__(self):
        return Cursor()

def relay():
    result = yield from Values()
    yield result

cursor = relay()
first = next(cursor)
second = cursor.send(None)
third = next(cursor)
fallback = next(cursor, "done")
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBeNull();
    expect(machine.globals.get("second")).toBe(4);
    expect(machine.globals.get("third")).toBe(73);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("routes injected yield-from faults without consuming a user iterator again", (): void => {
    const machine = runPythonCs486(`
calls = 0
original = KeyError("direct")
class Cursor:
    def __iter__(self):
        return self
    def __next__(self):
        global calls
        calls = calls + 1
        return calls

def relay():
    try:
        yield from Cursor()
    except KeyError as error:
        yield error

cursor = relay()
first = next(cursor)
caught = cursor.throw(original)
same = caught is original
calls_after = calls
fallback = next(cursor, "done")
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("calls_after")).toBe(1);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("keeps call-depth and comprehension capacity limits authoritative", (): void => {
    const depthLimited = runPythonCs486(
      `
def nested():
    return 1
class Cursor:
    def __iter__(self):
        return self
    def __next__(self):
        return nested()
cursor = Cursor()
limited = False
try:
    next(cursor)
except ResourceLimitError:
    limited = True
continued = 7
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(depthLimited.state.kind).toBe("completed");
    expect(depthLimited.globals.get("limited")).toBe(true);
    expect(depthLimited.globals.get("continued")).toBe(7);

    const collectionLimited = runPythonCs486(
      `
class Cursor:
    def __init__(self):
        self.value = 0
    def __iter__(self):
        return self
    def __next__(self):
        if self.value == 9:
            raise StopIteration
        self.value = self.value + 1
        return self.value
limited = False
try:
    values = [value for value in Cursor()]
except ResourceLimitError:
    limited = True
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 8 },
      },
    );

    expect(collectionLimited.state.kind).toBe("completed");
    expect(collectionLimited.globals.get("limited")).toBe(true);
  });
});
