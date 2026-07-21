import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type {
  RuntimeGenerator,
  RuntimeList,
  RuntimeSet,
  RuntimeTuple,
} from "../../src/domain/runtime/value.js";
import { runPythonCs486Core as runPythonCs486 } from "./pythonCs486CoreHarness.js";

describe("Computer System Python legacy sequence iteration", (): void => {
  it("creates independent inherited __getitem__ cursors with stable exhaustion", (): void => {
    const machine = runPythonCs486(`
class SequenceBase:
    def __getitem__(self, index):
        if index == len(self.values):
            raise IndexError("done")
        return self.values[index]

class Values(SequenceBase):
    def __init__(self, values):
        self.values = values

source = Values([10, 20, 30])
left = iter(source)
right = iter(source)
identity = iter(left) is left
left_first = next(left)
right_first = next(right)
left_second = next(left)
left_third = next(left)
left_default = next(left, 99)
left_default_again = next(left, 100)
right_second = next(right)
right_third = next(right)
right_stopped = False
try:
    next(right)
except StopIteration:
    right_stopped = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("identity")).toBe(true);
    expect(machine.globals.get("left_first")).toBe(10);
    expect(machine.globals.get("right_first")).toBe(10);
    expect(machine.globals.get("left_second")).toBe(20);
    expect(machine.globals.get("left_third")).toBe(30);
    expect(machine.globals.get("left_default")).toBe(99);
    expect(machine.globals.get("left_default_again")).toBe(100);
    expect(machine.globals.get("right_second")).toBe(20);
    expect(machine.globals.get("right_third")).toBe(30);
    expect(machine.globals.get("right_stopped")).toBe(true);
  });

  it("prefers __iter__, honors explicit None, and ignores instance-only methods", (): void => {
    const machine = runPythonCs486(`
class Both:
    def __iter__(self):
        return iter([9])
    def __getitem__(self, index):
        return index

preferred = [*Both()]

class Disabled:
    __iter__ = None
    def __getitem__(self, index):
        return index

disabled = False
try:
    iter(Disabled())
except TypeError:
    disabled = True

class InstanceOnly:
    pass

instance_only = InstanceOnly()
instance_only.__getitem__ = lambda index: index
instance_only_rejected = False
try:
    iter(instance_only)
except TypeError:
    instance_only_rejected = True

class NonCallableItem:
    __getitem__ = 1

non_callable_cursor = iter(NonCallableItem())
non_callable_rejected = False
try:
    next(non_callable_cursor)
except TypeError:
    non_callable_rejected = True

class NonCallableIter:
    __iter__ = 1
    def __getitem__(self, index):
        return index

iter_precedence_rejected = False
try:
    iter(NonCallableIter())
except TypeError:
    iter_precedence_rejected = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect((machine.globals.get("preferred") as RuntimeList).values).toEqual([
      9,
    ]);
    expect(machine.globals.get("disabled")).toBe(true);
    expect(machine.globals.get("instance_only_rejected")).toBe(true);
    expect(machine.globals.get("non_callable_rejected")).toBe(true);
    expect(machine.globals.get("iter_precedence_rejected")).toBe(true);
  });

  it("shares the fallback across lazy and materializing consumers", (): void => {
    const machine = runPythonCs486(`
class Values:
    def __getitem__(self, index):
        if index == 3:
            raise IndexError
        return index + 1

loop_values = []
for value in Values():
    loop_values = [*loop_values, value]
comprehension = [value * 2 for value in Values()]
expression = (value + 10 for value in Values())
expression_first = next(expression)
expression_rest = [*expression]

def relay():
    result = yield from Values()
    yield result

relay_values = [*relay()]
display = [0, *Values(), 4]
tuple_display = (0, *Values())
set_display = {0, *Values()}

def collect(*values):
    return values

called = collect(*Values())
left, *middle, right = Values()
slice_target = [8, 9]
slice_target[1:2] = Values()
constructed_set = set(Values())
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect((machine.globals.get("loop_values") as RuntimeList).values).toEqual([
      1, 2, 3,
    ]);
    expect(
      (machine.globals.get("comprehension") as RuntimeList).values,
    ).toEqual([2, 4, 6]);
    expect(machine.globals.get("expression_first")).toBe(11);
    expect(
      (machine.globals.get("expression_rest") as RuntimeList).values,
    ).toEqual([12, 13]);
    expect((machine.globals.get("relay_values") as RuntimeList).values).toEqual(
      [1, 2, 3, null],
    );
    expect((machine.globals.get("display") as RuntimeList).values).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(
      (machine.globals.get("tuple_display") as RuntimeTuple).values,
    ).toEqual([0, 1, 2, 3]);
    expect([
      ...(machine.globals.get("set_display") as RuntimeSet).entries.values(),
    ]).toEqual([0, 1, 2, 3]);
    expect((machine.globals.get("called") as RuntimeTuple).values).toEqual([
      1, 2, 3,
    ]);
    expect(machine.globals.get("left")).toBe(1);
    expect((machine.globals.get("middle") as RuntimeList).values).toEqual([2]);
    expect(machine.globals.get("right")).toBe(3);
    expect((machine.globals.get("slice_target") as RuntimeList).values).toEqual(
      [8, 1, 2, 3],
    );
    expect([
      ...(
        machine.globals.get("constructed_set") as RuntimeSet
      ).entries.values(),
    ]).toEqual([1, 2, 3]);
  });

  it("keeps the index on non-stop faults and makes exhaustion sticky", (): void => {
    const machine = runPythonCs486(`
class Recovering:
    def __init__(self):
        self.failed = False
        self.calls = 0
    def __getitem__(self, index):
        self.calls = self.calls + 1
        if index == 1 and not self.failed:
            self.failed = True
            raise ValueError("retry")
        if index == 2:
            raise IndexError("done")
        return index + 10

source = Recovering()
cursor = iter(source)
first = next(cursor)
caught = False
try:
    next(cursor)
except ValueError:
    caught = True
retry = next(cursor)
default_value = next(cursor, 90)
default_again = next(cursor, 91)
calls_after = source.calls

class StopEnding:
    def __getitem__(self, index):
        raise StopIteration(44)

stop_cursor = iter(StopEnding())
stop_default = next(stop_cursor, 92)
stop_default_again = next(stop_cursor, 93)
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBe(10);
    expect(machine.globals.get("caught")).toBe(true);
    expect(machine.globals.get("retry")).toBe(11);
    expect(machine.globals.get("default_value")).toBe(90);
    expect(machine.globals.get("default_again")).toBe(91);
    expect(machine.globals.get("calls_after")).toBe(4);
    expect(machine.globals.get("stop_default")).toBe(92);
    expect(machine.globals.get("stop_default_again")).toBe(93);
  });

  it("returns generator objects from a generator-function __getitem__", (): void => {
    const machine = runPythonCs486(`
class GeneratedItems:
    def __getitem__(self, index):
        yield index

cursor = iter(GeneratedItems())
first_generator = next(cursor)
second_generator = next(cursor)
first_value = next(first_generator)
second_value = next(second_generator)
distinct = first_generator is not second_generator
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(
      (machine.globals.get("first_generator") as RuntimeGenerator).kind,
    ).toBe("generator");
    expect(machine.globals.get("first_value")).toBe(0n);
    expect(machine.globals.get("second_value")).toBe(1n);
    expect(machine.globals.get("distinct")).toBe(true);
  });

  it("retains heap ownership and enforces call-depth and collection limits", (): void => {
    const exact = runPythonCs486(
      `
class Values:
    def __init__(self, count):
        self.count = count
    def __getitem__(self, index):
        if index == self.count:
            raise IndexError
        return index

def make_cursor():
    source = Values(4)
    return iter(source)

cursor = make_cursor()
exact_values = [*cursor]
published = [99]
limited = False
try:
    published = [*Values(5)]
except ResourceLimitError:
    limited = True
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 4 },
      },
    );

    expect(exact.state.kind, JSON.stringify(exact.state)).toBe("completed");
    expect((exact.globals.get("exact_values") as RuntimeList).values).toEqual([
      0n,
      1n,
      2n,
      3n,
    ]);
    expect(exact.globals.get("limited")).toBe(true);
    expect((exact.globals.get("published") as RuntimeList).values).toEqual([
      99,
    ]);

    const depthLimited = runPythonCs486(
      `
def nested():
    return 1

class Values:
    def __getitem__(self, index):
        return nested()

cursor = iter(Values())
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

    expect(depthLimited.state.kind, JSON.stringify(depthLimited.state)).toBe(
      "completed",
    );
    expect(depthLimited.globals.get("limited")).toBe(true);
    expect(depthLimited.globals.get("continued")).toBe(7);
  });
});
