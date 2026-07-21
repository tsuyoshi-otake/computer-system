import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type { RuntimeGenerator } from "../../src/domain/runtime/value.js";
import { runPythonCs486Core as runPythonCs486 } from "./pythonCs486CoreHarness.js";

describe("Computer System Python generator expressions", (): void => {
  it("evaluates and iterates the leftmost source immediately but keeps elements lazy", (): void => {
    const machine = runPythonCs486(`
source_calls = 0
element_calls = 0
def source():
    global source_calls
    source_calls = source_calls + 1
    return [1, 2]
def element(value):
    global element_calls
    element_calls = element_calls + 1
    return value * 10
cursor = (element(value) for value in source())
after_construction_source = source_calls
after_construction_element = element_calls
first = next(cursor)
after_first_source = source_calls
after_first_element = element_calls
second = next(cursor)
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("after_construction_source")).toBe(1);
    expect(machine.globals.get("after_construction_element")).toBe(0);
    expect(machine.globals.get("first")).toBe(10);
    expect(machine.globals.get("after_first_source")).toBe(1);
    expect(machine.globals.get("after_first_element")).toBe(1);
    expect(machine.globals.get("second")).toBe(20);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("reports a non-iterable while constructing the expression", (): void => {
    const machine = runPythonCs486(`
constructed = False
failed = False
try:
    cursor = (value for value in 7)
    constructed = True
except TypeError:
    failed = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("constructed")).toBe(false);
    expect(machine.globals.get("failed")).toBe(true);
  });

  it("retains the current position of an iterator acquired at construction", (): void => {
    const machine = runPythonCs486(`
source = iter([1, 2, 3])
cursor = (value for value in source)
outside = next(source)
inside = next(cursor)
remaining = next(source)
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("outside")).toBe(1);
    expect(machine.globals.get("inside")).toBe(2);
    expect(machine.globals.get("remaining")).toBe(3);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("evaluates later iterables and filters lazily in nested left-to-right order", (): void => {
    const machine = runPythonCs486(`
later_calls = 0
filter_calls = 0
def later(value):
    global later_calls
    later_calls = later_calls + 1
    return [value, value + 10]
def keep(value):
    global filter_calls
    filter_calls = filter_calls + 1
    return value > 5
cursor = (inner for outer in [1, 2] for inner in later(outer) if keep(inner))
before_later = later_calls
before_filter = filter_calls
first = next(cursor)
after_first_later = later_calls
after_first_filter = filter_calls
second = next(cursor)
after_second_later = later_calls
after_second_filter = filter_calls
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before_later")).toBe(0);
    expect(machine.globals.get("before_filter")).toBe(0);
    expect(machine.globals.get("first")).toBe(11);
    expect(machine.globals.get("after_first_later")).toBe(1);
    expect(machine.globals.get("after_first_filter")).toBe(2);
    expect(machine.globals.get("second")).toBe(12);
    expect(machine.globals.get("after_second_later")).toBe(2);
    expect(machine.globals.get("after_second_filter")).toBe(4);
  });

  it("keeps targets local and walrus values in the containing scope", (): void => {
    const machine = runPythonCs486(`
item = 99
total = 0
cursor = (total := total + item for item in [1, 2, 3])
before = total
first = next(cursor)
second = next(cursor)
third = next(cursor)
after = total
outer_item = item
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("second")).toBe(3);
    expect(machine.globals.get("third")).toBe(6);
    expect(machine.globals.get("after")).toBe(6);
    expect(machine.globals.get("outer_item")).toBe(99);
  });

  it("supports the sole-call-argument form and independent cursors", (): void => {
    const machine = runPythonCs486(`
def consume(cursor):
    return next(cursor) + next(cursor)
total = consume(value * 2 for value in [2, 3])
left = (value for value in [4, 5])
right = (value for value in [7, 8])
left_first = next(left)
right_first = next(right)
left_second = next(left)
right_second = next(right)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("total")).toBe(10);
    expect(machine.globals.get("left_first")).toBe(4);
    expect(machine.globals.get("right_first")).toBe(7);
    expect(machine.globals.get("left_second")).toBe(5);
    expect(machine.globals.get("right_second")).toBe(8);
  });

  it("reuses send, throw, close, and stable exhaustion", (): void => {
    const machine = runPythonCs486(`
sent_cursor = (value for value in [1, 2, 3])
sent_first = next(sent_cursor)
sent_second = sent_cursor.send(42)

thrown_cursor = (value for value in [4, 5])
thrown_first = next(thrown_cursor)
thrown = False
try:
    thrown_cursor.throw(ValueError("stop"))
except ValueError:
    thrown = True
thrown_fallback = next(thrown_cursor, "done")

closed_cursor = (value for value in [6, 7])
closed_first = next(closed_cursor)
closed_result = closed_cursor.close()
closed_fallback = next(closed_cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("sent_first")).toBe(1);
    expect(machine.globals.get("sent_second")).toBe(2);
    expect(machine.globals.get("thrown_first")).toBe(4);
    expect(machine.globals.get("thrown")).toBe(true);
    expect(machine.globals.get("thrown_fallback")).toBe("done");
    expect(machine.globals.get("closed_first")).toBe(6);
    expect(machine.globals.get("closed_result")).toBeNull();
    expect(machine.globals.get("closed_fallback")).toBe("done");
  });

  it("converts an escaping StopIteration and closes the expression", (): void => {
    const machine = runPythonCs486(`
def stop():
    raise StopIteration("escaped")
cursor = (stop() for value in [1])
converted = False
try:
    next(cursor)
except RuntimeError:
    converted = True
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("converted")).toBe(true);
    expect(machine.globals.get("fallback")).toBe("done");
    expect((machine.globals.get("cursor") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("remains iterable through for on the shared generator cursor", (): void => {
    const machine = runPythonCs486(`
cursor = (value * value for value in [1, 2, 3])
total = 0
for value in cursor:
    total = total + value
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("total")).toBe(14);
    expect(machine.globals.get("fallback")).toBe("done");
    expect((machine.globals.get("cursor") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("rejects nested call-depth admission without consuming the expression", (): void => {
    const machine = runPythonCs486(
      `
expression_cursor = (value for value in [8, 9])
def parent():
    yield from expression_cursor
parent_cursor = parent()
limited = False
try:
    next(parent_cursor)
except ResourceLimitError:
    limited = True
expression_first = next(expression_cursor)
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("limited")).toBe(true);
    expect(machine.globals.get("expression_first")).toBe(8);
  });

  it("retains lazy source values through the existing managed heap", (): void => {
    const payload = "generator-expression-".repeat(96);
    const suspended = runPythonCs486(`
cursor = (value for value in ["${payload}"])
`);
    const baseline = runPythonCs486(`
cursor = (value for value in ["x"])
`);

    expect(suspended.state.kind).toBe("completed");
    expect(suspended.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length / 2,
    );
  });
});
