import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type { RuntimeGenerator } from "../../src/domain/runtime/value.js";
import { runPythonCs486Core as runPythonCs486 } from "./pythonCs486CoreHarness.js";

describe("Computer System Python yield-from delegation", (): void => {
  it("delegates built-in iterator values and produces None at exhaustion", (): void => {
    const machine = runPythonCs486(`
def relay():
    result = yield from [1, 2, 3]
    return result
cursor = relay()
first = next(cursor)
second = cursor.send(None)
third = next(cursor)
returned = 99
try:
    next(cursor)
except StopIteration as error:
    returned = error.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("second")).toBe(2);
    expect(machine.globals.get("third")).toBe(3);
    expect(machine.globals.get("returned")).toBeNull();
    expect((machine.globals.get("cursor") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("forwards send and uses the subgenerator return as the expression value", (): void => {
    const machine = runPythonCs486(`
def child():
    received = yield "ready"
    yield received
    return 73
def parent():
    result = yield from child()
    yield result
cursor = parent()
first = next(cursor)
second = cursor.send("sent")
third = next(cursor)
fallback = next(cursor, "done")
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("second")).toBe("sent");
    expect(machine.globals.get("third")).toBe(73);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("forwards throw to a subgenerator and routes an unhandled throw into the delegator", (): void => {
    const machine = runPythonCs486(`
def child():
    try:
        yield "ready"
    except ValueError as error:
        yield error.message
    return "child-return"
def parent():
    result = yield from child()
    yield result
cursor = parent()
first = next(cursor)
caught = cursor.throw(ValueError("handled"))
returned = next(cursor)

def built_in_parent():
    try:
        yield from [1, 2]
    except KeyError as error:
        yield error.message
built_in = built_in_parent()
built_first = next(built_in)
built_caught = built_in.throw(KeyError("direct"))
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("caught")).toBe("handled");
    expect(machine.globals.get("returned")).toBe("child-return");
    expect(machine.globals.get("built_first")).toBe(1);
    expect(machine.globals.get("built_caught")).toBe("direct");
  });

  it("preserves exception identity and return values through nested delegation", (): void => {
    const machine = runPythonCs486(`
same = False
original = ValueError("identity")
def leaf():
    global same
    try:
        yield "leaf"
    except ValueError as error:
        same = error is original
    return 19
def middle():
    return (yield from leaf())
def top():
    result = yield from middle()
    yield result
cursor = top()
first = next(cursor)
second = cursor.throw(original)
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("leaf");
    expect(machine.globals.get("same")).toBe(true);
    expect(machine.globals.get("second")).toBe(19);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("closes the active subgenerator before finalizing the delegator", (): void => {
    const machine = runPythonCs486(`
events = ""
def child():
    global events
    try:
        yield "ready"
    finally:
        events = events + "c"
def parent():
    global events
    try:
        yield from child()
    finally:
        events = events + "p"
cursor = parent()
first = next(cursor)
closed = cursor.close()
fallback = next(cursor, "done")
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("closed")).toBeNull();
    expect(machine.globals.get("events")).toBe("cp");
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("propagates an ignored delegated GeneratorExit as RuntimeError", (): void => {
    const machine = runPythonCs486(`
events = ""
def child():
    global events
    try:
        yield "ready"
    except GeneratorExit:
        events = events + "i"
        yield "ignored"
def parent():
    global events
    try:
        yield from child()
    finally:
        events = events + "p"
cursor = parent()
first = next(cursor)
failed = False
try:
    cursor.close()
except RuntimeError:
    failed = True
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("failed")).toBe(true);
    expect(machine.globals.get("events")).toBe("ip");
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("ignores a delegated close return and preserves an outer pending return", (): void => {
    const machine = runPythonCs486(`
def close_return():
    try:
        yield "close-ready"
    except GeneratorExit:
        return 41
def close_parent():
    yield from close_return()
close_cursor = close_parent()
close_first = next(close_cursor)
close_result = close_cursor.close()

def finalizer_child():
    yield "child-ready"
    return 43
def returning_parent():
    try:
        return 47
    finally:
        child_result = yield from finalizer_child()
        yield child_result
returning_cursor = returning_parent()
returning_first = next(returning_cursor)
returning_second = next(returning_cursor)
returned = None
try:
    next(returning_cursor)
except StopIteration as error:
    returned = error.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("close_first")).toBe("close-ready");
    expect(machine.globals.get("close_result")).toBeNull();
    expect(machine.globals.get("returning_first")).toBe("child-ready");
    expect(machine.globals.get("returning_second")).toBe(43);
    expect(machine.globals.get("returned")).toBe(47);
  });

  it("closes a delegate with a distinct GeneratorExit and reraises the outer instance", (): void => {
    const machine = runPythonCs486(`
same_in_child = None
same_at_caller = False
outer_exit = GeneratorExit("outer")
def child():
    global same_in_child
    try:
        yield "ready"
    except GeneratorExit as error:
        same_in_child = error is outer_exit
        return
def parent():
    yield from child()
cursor = parent()
first = next(cursor)
try:
    cursor.throw(outer_exit)
except GeneratorExit as error:
    same_at_caller = error is outer_exit
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("same_in_child")).toBe(false);
    expect(machine.globals.get("same_at_caller")).toBe(true);
  });

  it("reports missing send on a built-in iterator and does not consume again", (): void => {
    const machine = runPythonCs486(`
def relay():
    yield from [1, 2]
cursor = relay()
first = next(cursor)
missing = False
try:
    cursor.send(9)
except AttributeError:
    missing = True
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("missing")).toBe(true);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("evaluates the delegate once and rejects recursive running delegation", (): void => {
    const machine = runPythonCs486(`
calls = 0
def values():
    global calls
    calls = calls + 1
    return [4, 5]
def relay():
    yield from values()
cursor = relay()
before = calls
first = next(cursor)
after_first = calls
second = next(cursor)
after_second = calls

self_cursor = None
def recursive():
    yield from self_cursor
self_cursor = recursive()
reentrant = False
try:
    next(self_cursor)
except ValueError:
    reentrant = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("first")).toBe(4);
    expect(machine.globals.get("after_first")).toBe(1);
    expect(machine.globals.get("second")).toBe(5);
    expect(machine.globals.get("after_second")).toBe(1);
    expect(machine.globals.get("reentrant")).toBe(true);
  });

  it("assigns delegation ownership to the directly containing lambda only", (): void => {
    const machine = runPythonCs486(`
def factory():
    return lambda values: (yield from values)
relay = factory()
cursor = relay([6, 7])
first = next(cursor)
second = next(cursor)
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(6);
    expect(machine.globals.get("second")).toBe(7);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("rejects call-depth capacity before consuming the delegated generator", (): void => {
    const machine = runPythonCs486(
      `
def child():
    yield "still-created"
child_cursor = child()
def parent():
    yield from child_cursor
parent_cursor = parent()
limited = False
try:
    next(parent_cursor)
except ResourceLimitError:
    limited = True
child_first = next(child_cursor)
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("limited")).toBe(true);
    expect(machine.globals.get("child_first")).toBe("still-created");
  });

  it("retains a suspended delegate and its frame through the managed heap", (): void => {
    const payload = "delegated-frame-".repeat(96);
    const suspended = runPythonCs486(`
def child():
    payload = "${payload}"
    yield 1
def parent():
    yield from child()
cursor = parent()
first = next(cursor)
`);
    const baseline = runPythonCs486(`
def child():
    payload = "x"
    yield 1
def parent():
    yield from child()
cursor = parent()
first = next(cursor)
`);

    expect(suspended.state.kind).toBe("completed");
    expect(suspended.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length / 2,
    );
  });
});
