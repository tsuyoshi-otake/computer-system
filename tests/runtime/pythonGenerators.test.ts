import { describe, expect, it } from "vitest";

import type { RuntimeGenerator } from "../../src/domain/runtime/value.js";
import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import { runPythonCs486Core as runPythonCs486 } from "./pythonCs486CoreHarness.js";

describe("Computer System Python generator functions", (): void => {
  it("starts lazily and resumes a loop at each authored yield", (): void => {
    const machine = runPythonCs486(`
events = 0
def generate(limit):
    global events
    events = events + 1
    for value in range(limit):
        events = events + 10
        yield value
    events = events + 100
    return 77
cursor = generate(3)
before = events
identity = iter(cursor) is cursor
first = next(cursor)
after_first = events
second = next(cursor)
after_second = events
third = next(cursor)
after_third = events
fallback = next(cursor, 99)
after_return = events
fallback_again = next(cursor, 100)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("identity")).toBe(true);
    expect(machine.globals.get("first")).toBe(0);
    expect(machine.globals.get("after_first")).toBe(11);
    expect(machine.globals.get("second")).toBe(1);
    expect(machine.globals.get("after_second")).toBe(21);
    expect(machine.globals.get("third")).toBe(2);
    expect(machine.globals.get("after_third")).toBe(31);
    expect(machine.globals.get("fallback")).toBe(99);
    expect(machine.globals.get("after_return")).toBe(131);
    expect(machine.globals.get("fallback_again")).toBe(100);
    expect((machine.globals.get("cursor") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("keeps generator instances and closure cells independent", (): void => {
    const machine = runPythonCs486(`
def factory(seed):
    current = seed
    def generate():
        nonlocal current
        yield current
        current = current + 1
        yield current
    return generate
left_factory = factory(10)
right_factory = factory(20)
left = left_factory()
right = right_factory()
left_first = next(left)
right_first = next(right)
left_total = 0
for value in left:
    left_total = left_total + value
right_total = 0
for value in right:
    right_total = right_total + value
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("left_first")).toBe(10);
    expect(machine.globals.get("right_first")).toBe(20);
    expect(machine.globals.get("left_total")).toBe(11);
    expect(machine.globals.get("right_total")).toBe(21);
    expect((machine.globals.get("left") as RuntimeGenerator).state).toBe(
      "closed",
    );
    expect((machine.globals.get("right") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("turns return into StopIteration and keeps closed exhaustion stable", (): void => {
    const machine = runPythonCs486(`
def empty():
    return 42
    yield 1
cursor = empty()
stopped = False
message = ""
try:
    next(cursor)
except StopIteration as error:
    stopped = True
    message = error.message
fallback = next(cursor, 7)
stopped_again = False
try:
    next(cursor)
except StopIteration:
    stopped_again = True
def bare():
    yield
bare_value = next(bare())
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("stopped")).toBe(true);
    expect(machine.globals.get("message")).toBe("42");
    expect(machine.globals.get("fallback")).toBe(7);
    expect(machine.globals.get("stopped_again")).toBe(true);
    expect(machine.globals.get("bare_value")).toBeNull();
  });

  it("closes a generator after an unhandled body fault reaches its caller", (): void => {
    const machine = runPythonCs486(`
def broken():
    yield 1
    raise ValueError("boom")
cursor = broken()
first = next(cursor)
caught = False
try:
    next(cursor)
except ValueError as error:
    caught = error.message == "boom"
fallback = next(cursor, 9)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("caught")).toBe(true);
    expect(machine.globals.get("fallback")).toBe(9);
    expect((machine.globals.get("cursor") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("does not classify a nested generator as its ordinary outer function", (): void => {
    const machine = runPythonCs486(`
def outer():
    def inner():
        yield 1
    return 7
outer_value = outer()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("outer_value")).toBe(7);
  });

  it("binds generator arguments before publishing the lazy object", (): void => {
    const machine = runPythonCs486(`
def generate(required):
    yield required
missing = False
try:
    generate()
except TypeError:
    missing = True
class Invalid:
    def __init__(self):
        yield 1
invalid_init = False
try:
    Invalid()
except TypeError:
    invalid_init = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("missing")).toBe(true);
    expect(machine.globals.get("invalid_init")).toBe(true);
  });

  it("keeps suspended locals reachable through the managed heap", (): void => {
    const payload = "x".repeat(1_024);
    const suspended = runPythonCs486(`
def generate():
    payload = "${payload}"
    yield 1
cursor = generate()
first = next(cursor)
`);
    const baseline = runPythonCs486("value = 1\n");

    expect(suspended.state.kind).toBe("completed");
    expect(suspended.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length,
    );
  });

  it("keeps suspended exception and finally-continuation values reachable", (): void => {
    const payload = "retained".repeat(128);
    const exception = runPythonCs486(`
def generate():
    try:
        raise ValueError("${payload}")
    except:
        yield 1
cursor = generate()
first = next(cursor)
`);
    const pendingReturn = runPythonCs486(`
def generate():
    try:
        return "${payload}"
    finally:
        yield 1
cursor = generate()
first = next(cursor)
`);
    const baseline = runPythonCs486(`
def generate():
    try:
        return "x"
    finally:
        yield 1
cursor = generate()
first = next(cursor)
`);

    expect(exception.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length / 2,
    );
    expect(pendingReturn.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length / 2,
    );
  });

  it("feeds send values back into the suspended yield expression", (): void => {
    const machine = runPythonCs486(`
def relay():
    first_received = yield 10
    second_received = yield first_received
    return second_received
cursor = relay()
started = cursor.send(None)
middle = cursor.send(42)
finished = False
finish_message = ""
try:
    cursor.send(99)
except StopIteration as error:
    finished = True
    finish_message = error.message
closed_again = False
try:
    cursor.send(None)
except StopIteration:
    closed_again = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("started")).toBe(10);
    expect(machine.globals.get("middle")).toBe(42);
    expect(machine.globals.get("finished")).toBe(true);
    expect(machine.globals.get("finish_message")).toBe("99");
    expect(machine.globals.get("closed_again")).toBe(true);
    expect((machine.globals.get("cursor") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("makes next resume a yield expression with None", (): void => {
    const machine = runPythonCs486(`
def receive():
    value = yield 1
    yield value
cursor = receive()
first = next(cursor)
second = next(cursor)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("second")).toBeNull();
  });

  it("rejects a non-None first send without consuming the generator", (): void => {
    const machine = runPythonCs486(`
def receive():
    value = yield "ready"
    yield value
cursor = receive()
rejected = False
try:
    cursor.send(1)
except TypeError:
    rejected = True
state_after_rejection = cursor.send(None)
payload = [1, 2, 3]
same_payload = cursor.send(payload) is payload
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("rejected")).toBe(true);
    expect(machine.globals.get("state_after_rejection")).toBe("ready");
    expect(machine.globals.get("same_payload")).toBe(true);
  });

  it("keeps the generator reachable through a stored send method", (): void => {
    const machine = runPythonCs486(`
def receive():
    value = yield "ready"
    yield value
cursor = receive()
sender = cursor.send
cursor = None
first = sender(None)
second = sender("retained")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("second")).toBe("retained");
  });

  it("closes a generator when send detects running reentry", (): void => {
    const machine = runPythonCs486(`
cursor = None
def reentrant():
    yield 1
    cursor.send(2)
cursor = reentrant()
first = next(cursor)
rejected = False
try:
    cursor.send(None)
except ValueError:
    rejected = True
fallback = next(cursor, 7)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("rejected")).toBe(true);
    expect(machine.globals.get("fallback")).toBe(7);
    expect((machine.globals.get("cursor") as RuntimeGenerator).state).toBe(
      "closed",
    );
  });

  it("rejects invalid send argument shapes without resuming", (): void => {
    const machine = runPythonCs486(`
def receive():
    yield 1
cursor = receive()
missing = False
extra = False
keyword = False
try:
    cursor.send()
except TypeError:
    missing = True
try:
    cursor.send(None, None)
except TypeError:
    extra = True
try:
    cursor.send(value=None)
except TypeError:
    keyword = True
first = next(cursor)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("missing")).toBe(true);
    expect(machine.globals.get("extra")).toBe(true);
    expect(machine.globals.get("keyword")).toBe(true);
    expect(machine.globals.get("first")).toBe(1);
  });

  it("keeps a generator created when send admission reaches capacity", (): void => {
    const machine = runPythonCs486(
      `
def receive():
    yield "ready"
cursor = receive()
limited = False
try:
    cursor.send(None)
except ResourceLimitError:
    limited = True
first = next(cursor)
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("limited")).toBe(true);
    expect(machine.globals.get("first")).toBe("ready");
  });

  it("supports yield expressions in a directly containing lambda scope", (): void => {
    const machine = runPythonCs486(`
factory = lambda value: (yield value)
cursor = factory(8)
first = cursor.send(None)
fallback = next(cursor, 9)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(8);
    expect(machine.globals.get("fallback")).toBe(9);
  });

  it("preserves closure mutation and evaluation order across send", (): void => {
    const machine = runPythonCs486(`
events = 0
def factory(seed):
    total = seed
    def receive():
        nonlocal total
        global events
        events = events + 1
        delta = yield total
        events = events + 10
        total = total + delta
        yield total
    return receive
cursor = factory(5)()
before = events
first = cursor.send(None)
after_first = events
second = cursor.send(7)
after_second = events
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("first")).toBe(5);
    expect(machine.globals.get("after_first")).toBe(1);
    expect(machine.globals.get("second")).toBe(12);
    expect(machine.globals.get("after_second")).toBe(11);
  });

  it("injects throw exceptions at the suspended yield and preserves identity", (): void => {
    const machine = runPythonCs486(`
caught = None
def relay():
    global caught
    try:
        yield "ready"
    except ValueError as error:
        caught = error
        yield error.message
cursor = relay()
first = next(cursor)
injected = ValueError("boom")
second = cursor.throw(injected)
same_error = caught is injected
fallback = next(cursor, "done")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("second")).toBe("boom");
    expect(machine.globals.get("same_error")).toBe(true);
    expect(machine.globals.get("fallback")).toBe("done");
  });

  it("propagates uncaught and replacement exceptions and closes each generator", (): void => {
    const machine = runPythonCs486(`
def uncaught():
    yield 1
left = uncaught()
left_first = next(left)
injected = ValueError("uncaught")
same_uncaught = False
try:
    left.throw(injected)
except ValueError as error:
    same_uncaught = error is injected
left_fallback = next(left, 8)

def replaced():
    try:
        yield 2
    except ValueError:
        raise TypeError("replacement")
right = replaced()
right_first = next(right)
replacement = ""
try:
    right.throw(ValueError("original"))
except TypeError as error:
    replacement = error.message
right_fallback = next(right, 9)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("same_uncaught")).toBe(true);
    expect(machine.globals.get("left_fallback")).toBe(8);
    expect(machine.globals.get("replacement")).toBe("replacement");
    expect(machine.globals.get("right_fallback")).toBe(9);
  });

  it("does not start a generator for initial throw and raises through a closed generator", (): void => {
    const machine = runPythonCs486(`
runs = 0
def lazy():
    global runs
    runs = runs + 1
    yield 1
cursor = lazy()
initial = ValueError("initial")
same_initial = False
try:
    cursor.throw(initial)
except ValueError as error:
    same_initial = error is initial
fallback = next(cursor, 6)
closed_error = TypeError("closed")
same_closed = False
try:
    cursor.throw(closed_error)
except TypeError as error:
    same_closed = error is closed_error
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("runs")).toBe(0);
    expect(machine.globals.get("same_initial")).toBe(true);
    expect(machine.globals.get("fallback")).toBe(6);
    expect(machine.globals.get("same_closed")).toBe(true);
  });

  it("converts an escaping StopIteration raised by a generator body", (): void => {
    const machine = runPythonCs486(`
def invalid():
    yield 1
    raise StopIteration("body")
cursor = invalid()
first = next(cursor)
converted = ""
try:
    next(cursor)
except RuntimeError as error:
    converted = error.message
fallback = next(cursor, 7)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("converted")).toBe(
      "generator raised StopIteration",
    );
    expect(machine.globals.get("fallback")).toBe(7);
  });

  it("retains the handled exception across a yield for bare reraise", (): void => {
    const machine = runPythonCs486(`
def remember():
    try:
        raise ValueError("retained")
    except ValueError as error:
        yield error.message
        raise
cursor = remember()
first = next(cursor)
reraised = ""
try:
    next(cursor)
except ValueError as error:
    reraised = error.message
fallback = next(cursor, 4)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("retained");
    expect(machine.globals.get("reraised")).toBe("retained");
    expect(machine.globals.get("fallback")).toBe(4);
  });

  it("retains return and fault continuations across yields in finally", (): void => {
    const machine = runPythonCs486(`
events = ""
def returning():
    global events
    try:
        yield "body"
        return 7
    finally:
        events = events + "a"
        yield "cleanup"
        events = events + "b"
left = returning()
left_first = next(left)
left_second = next(left)
returned = None
try:
    next(left)
except StopIteration as error:
    returned = error.value

def failing():
    global events
    try:
        yield 1
        raise KeyError("fault")
    finally:
        events = events + "c"
        yield 2
        events = events + "d"
right = failing()
right_first = next(right)
right_second = next(right)
fault = ""
try:
    next(right)
except KeyError as error:
    fault = error.message
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("left_first")).toBe("body");
    expect(machine.globals.get("left_second")).toBe("cleanup");
    expect(machine.globals.get("returned")).toBe(7);
    expect(machine.globals.get("right_second")).toBe(2);
    expect(machine.globals.get("fault")).toBe("fault");
    expect(machine.globals.get("events")).toBe("abcd");
  });

  it("implements created, suspended, returning, ignored, and faulting close paths", (): void => {
    const machine = runPythonCs486(`
events = ""
runs = 0
def lazy():
    global runs
    runs = runs + 1
    yield 1
created = lazy()
created_result = created.close()
created_fallback = next(created, 3)

def normal():
    global events
    try:
        yield 2
    finally:
        events = events + "n"
normal_cursor = normal()
normal_first = next(normal_cursor)
normal_result = normal_cursor.close()
normal_again = normal_cursor.close()

def returning():
    try:
        yield 4
    except GeneratorExit:
        return 9
returning_cursor = returning()
returning_first = next(returning_cursor)
returning_result = returning_cursor.close()

def ignored():
    try:
        yield 5
    except GeneratorExit:
        yield 6
ignored_cursor = ignored()
ignored_first = next(ignored_cursor)
ignored_message = ""
try:
    ignored_cursor.close()
except RuntimeError as error:
    ignored_message = error.message
ignored_fallback = next(ignored_cursor, 10)

def faulting():
    try:
        yield 7
    except GeneratorExit:
        raise ValueError("close fault")
faulting_cursor = faulting()
faulting_first = next(faulting_cursor)
close_fault = ""
try:
    faulting_cursor.close()
except ValueError as error:
    close_fault = error.message
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("runs")).toBe(0);
    expect(machine.globals.get("created_result")).toBeNull();
    expect(machine.globals.get("created_fallback")).toBe(3);
    expect(machine.globals.get("events")).toBe("n");
    expect(machine.globals.get("normal_result")).toBeNull();
    expect(machine.globals.get("normal_again")).toBeNull();
    expect(machine.globals.get("returning_result")).toBe(9);
    expect(machine.globals.get("ignored_message")).toBe(
      "generator ignored GeneratorExit",
    );
    expect(machine.globals.get("ignored_fallback")).toBe(10);
    expect(machine.globals.get("close_fault")).toBe("close fault");
  });

  it("keeps GeneratorExit outside Exception while bare and explicit handlers can observe it", (): void => {
    const machine = runPythonCs486(`
exception_caught = False
bare_caught = False
explicit_caught = False
def exception_only():
    global exception_caught
    try:
        yield 1
    except Exception:
        exception_caught = True
left = exception_only()
left_first = next(left)
left.close()

def bare_handler():
    global bare_caught
    try:
        yield 2
    except:
        bare_caught = True
middle = bare_handler()
middle_first = next(middle)
middle.close()

def explicit_handler():
    global explicit_caught
    try:
        yield 3
    except GeneratorExit:
        explicit_caught = True
right = explicit_handler()
right_first = next(right)
right.close()

root_caught_by_exception = False
root_caught_by_base = False
try:
    try:
        raise BaseException("root")
    except Exception:
        root_caught_by_exception = True
except BaseException:
    root_caught_by_base = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("exception_caught")).toBe(false);
    expect(machine.globals.get("bare_caught")).toBe(true);
    expect(machine.globals.get("explicit_caught")).toBe(true);
    expect(machine.globals.get("root_caught_by_exception")).toBe(false);
    expect(machine.globals.get("root_caught_by_base")).toBe(true);
  });

  it("supports the bounded legacy throw form and rejects invalid signatures without resuming", (): void => {
    const machine = runPythonCs486(`
def receive():
    try:
        yield "ready"
    except ValueError as error:
        yield error.message
left = receive()
left_first = next(left)
bad_traceback = False
try:
    left.throw(ValueError, "bad", 1)
except TypeError:
    bad_traceback = True
left_second = left.throw(ValueError, "legacy", None)

right = receive()
right_first = next(right)
bad_instance = False
instance = ValueError("instance")
try:
    right.throw(instance, "extra")
except TypeError:
    bad_instance = True
right_second = right.throw(ValueError("valid"))

def closable():
    yield 1
close_cursor = closable()
close_extra = False
close_keyword = False
try:
    close_cursor.close(1)
except TypeError:
    close_extra = True
try:
    close_cursor.close(value=1)
except TypeError:
    close_keyword = True
close_first = next(close_cursor)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("bad_traceback")).toBe(true);
    expect(machine.globals.get("left_second")).toBe("legacy");
    expect(machine.globals.get("bad_instance")).toBe(true);
    expect(machine.globals.get("right_second")).toBe("valid");
    expect(machine.globals.get("close_extra")).toBe(true);
    expect(machine.globals.get("close_keyword")).toBe(true);
    expect(machine.globals.get("close_first")).toBe(1);
  });

  it("rejects throw and close reentry inside a running generator without corrupting it", (): void => {
    const machine = runPythonCs486(`
cursor = None
def reentrant():
    yield 1
    try:
        cursor.throw(ValueError("nested"))
    except ValueError as error:
        yield error.message
    try:
        cursor.close()
    except ValueError as error:
        yield error.message
cursor = reentrant()
first = next(cursor)
second = next(cursor)
third = next(cursor)
closed = cursor.close()
fallback = next(cursor, 8)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("second")).toBe("generator already executing");
    expect(machine.globals.get("third")).toBe("generator already executing");
    expect(machine.globals.get("closed")).toBeNull();
    expect(machine.globals.get("fallback")).toBe(8);
  });

  it("keeps generators reachable through stored throw and close methods", (): void => {
    const machine = runPythonCs486(`
def retained():
    try:
        yield "ready"
    except ValueError as error:
        yield error.message
cursor = retained()
first = next(cursor)
thrower = cursor.throw
closer = cursor.close
cursor = None
second = thrower(ValueError("retained"))
closed = closer()
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("second")).toBe("retained");
    expect(machine.globals.get("closed")).toBeNull();
  });

  it("keeps a generator suspended when throw admission reaches capacity", (): void => {
    const machine = runPythonCs486(
      `
def receive():
    yield "ready"
cursor = receive()
limited = False
try:
    cursor.throw(ValueError("blocked"))
except ResourceLimitError:
    limited = True
first = next(cursor)
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 1 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("limited")).toBe(true);
    expect(machine.globals.get("first")).toBe("ready");
  });

  it("keeps a nameless handled exception reachable while its generator is suspended", (): void => {
    const payload = "active-fault-".repeat(96);
    const suspended = runPythonCs486(`
def retain_fault():
    try:
        raise ValueError("${payload}")
    except ValueError:
        yield 1
        raise
cursor = retain_fault()
first = next(cursor)
`);
    const baseline = runPythonCs486(`
def retain_none():
    yield 1
cursor = retain_none()
first = next(cursor)
`);

    expect(suspended.state.kind).toBe("completed");
    expect(suspended.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length,
    );
  });

  it("preserves a generator finalizer continuation across a nested function finalizer", (): void => {
    const machine = runPythonCs486(`
events = ""
def helper():
    global events
    try:
        return 2
    finally:
        events = events + "h"
def generate():
    global events
    try:
        return 7
    finally:
        events = events + "a"
        yield "cleanup"
        nested = helper()
        yield nested
        events = events + "b"
cursor = generate()
first = next(cursor)
second = next(cursor)
returned = None
try:
    next(cursor)
except StopIteration as error:
    returned = error.value
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("cleanup");
    expect(machine.globals.get("second")).toBe(2);
    expect(machine.globals.get("events")).toBe("ahb");
    expect(machine.globals.get("returned")).toBe(7);
  });

  it("preserves a generator finalizer continuation across a nested class finalizer", (): void => {
    const machine = runPythonCs486(`
def generate():
    try:
        return 11
    finally:
        yield "cleanup"
        class Local:
            while True:
                try:
                    break
                finally:
                    marker = 3
        yield Local.marker
cursor = generate()
first = next(cursor)
second = next(cursor)
returned = None
try:
    next(cursor)
except StopIteration as error:
    returned = error.value
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("cleanup");
    expect(machine.globals.get("second")).toBe(3);
    expect(machine.globals.get("returned")).toBe(11);
  });

  it("preserves a generator finalizer continuation across an imported module finalizer", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/app");
    filesystem.writeFile(
      "/app/helper.py",
      `value = 0
while True:
    try:
        break
    finally:
        value = 5
`,
    );
    const machine = runPythonCs486(
      `
def generate():
    try:
        return 13
    finally:
        yield "cleanup"
        import helper
        yield helper.value
cursor = generate()
first = next(cursor)
second = next(cursor)
returned = None
try:
    next(cursor)
except StopIteration as error:
    returned = error.value
`,
      { filesystem, path: "/app/main.py" },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("cleanup");
    expect(machine.globals.get("second")).toBe(5);
    expect(machine.globals.get("returned")).toBe(13);
  });

  it("delegates built-in iterables lazily and uses None as their result", (): void => {
    const machine = runPythonCs486(`
evaluations = 0
def values():
    global evaluations
    evaluations = evaluations + 1
    return [1, 2]
def relay():
    result = yield from values()
    yield result
cursor = relay()
before = evaluations
first = next(cursor)
after_first = evaluations
second = next(cursor)
result = next(cursor)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("after_first")).toBe(1);
    expect(machine.globals.get("second")).toBe(2);
    expect(machine.globals.get("result")).toBeNull();
  });

  it("captures a subgenerator return and forwards sent value identity", (): void => {
    const machine = runPythonCs486(`
payload = [4, 5]
def child():
    received = yield "ready"
    yield received
    return payload
def relay():
    result = yield from child()
    yield result
cursor = relay()
first = next(cursor)
same_sent = cursor.send(payload) is payload
same_returned = next(cursor) is payload
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("same_sent")).toBe(true);
    expect(machine.globals.get("same_returned")).toBe(true);
  });

  it("forwards throw to a subgenerator and resumes with its return value", (): void => {
    const machine = runPythonCs486(`
def child():
    try:
        yield "ready"
    except ValueError as error:
        yield error.message
    return 9
def relay():
    result = yield from child()
    yield result
cursor = relay()
first = next(cursor)
caught = cursor.throw(ValueError("delegated"))
returned = next(cursor)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("caught")).toBe("delegated");
    expect(machine.globals.get("returned")).toBe(9);
  });

  it("forwards close through nested finalizers and rejects a yielded close", (): void => {
    const machine = runPythonCs486(`
events = ""
def child():
    global events
    try:
        yield "ready"
    finally:
        events = events + "c"
def relay():
    global events
    try:
        yield from child()
    finally:
        events = events + "p"
cursor = relay()
first = next(cursor)
closed = cursor.close()
fallback = next(cursor, 7)

def ignored():
    try:
        yield "ignored"
    except GeneratorExit:
        yield "bad"
def ignored_relay():
    yield from ignored()
ignored_cursor = ignored_relay()
ignored_first = next(ignored_cursor)
ignored_message = ""
try:
    ignored_cursor.close()
except RuntimeError as error:
    ignored_message = error.message
ignored_fallback = next(ignored_cursor, 8)
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("closed")).toBeNull();
    expect(machine.globals.get("events")).toBe("cp");
    expect(machine.globals.get("fallback")).toBe(7);
    expect(machine.globals.get("ignored_first")).toBe("ignored");
    expect(machine.globals.get("ignored_message")).toBe(
      "generator ignored GeneratorExit",
    );
    expect(machine.globals.get("ignored_fallback")).toBe(8);
  });

  it("routes missing built-in delegate methods at the yield-from point", (): void => {
    const machine = runPythonCs486(`
def send_relay():
    try:
        yield from [1, 2]
    except AttributeError as error:
        yield error.message
send_cursor = send_relay()
send_first = next(send_cursor)
send_missing = send_cursor.send(5)

def throw_relay():
    try:
        yield from [3, 4]
    except ValueError as error:
        yield error.message
throw_cursor = throw_relay()
throw_first = next(throw_cursor)
throw_missing = throw_cursor.throw(ValueError("raised here"))
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("send_first")).toBe(1);
    expect(machine.globals.get("send_missing")).toBe(
      "iterator has no attribute send",
    );
    expect(machine.globals.get("throw_first")).toBe(3);
    expect(machine.globals.get("throw_missing")).toBe("raised here");
  });

  it("raises a throw into the delegating generator when its subgenerator was closed externally", (): void => {
    const machine = runPythonCs486(`
def child():
    yield "ready"
child_cursor = child()
def relay():
    try:
        yield from child_cursor
    except ValueError as error:
        yield error.message
cursor = relay()
first = next(cursor)
child_closed = child_cursor.close()
caught = cursor.throw(ValueError("after close"))
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("ready");
    expect(machine.globals.get("child_closed")).toBeNull();
    expect(machine.globals.get("caught")).toBe("after close");
  });

  it("rejects recursive delegation and call-depth admission without consuming delegates", (): void => {
    const reentrant = runPythonCs486(`
cursor = None
def relay():
    try:
        yield from cursor
    except ValueError as error:
        yield error.message
cursor = relay()
message = next(cursor)
`);
    const limited = runPythonCs486(
      `
child_cursor = None
def child():
    yield "child"
def relay():
    global child_cursor
    child_cursor = child()
    try:
        yield from child_cursor
    except ResourceLimitError:
        yield "limited"
cursor = relay()
outer = next(cursor)
child_value = next(child_cursor)
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(reentrant.state.kind).toBe("completed");
    expect(reentrant.globals.get("message")).toBe(
      "generator already executing",
    );
    expect(limited.state.kind).toBe("completed");
    expect(limited.globals.get("outer")).toBe("limited");
    expect(limited.globals.get("child_value")).toBe("child");
  });

  it("keeps a delegated generator's suspended children reachable", (): void => {
    const payload = "delegated-payload-".repeat(96);
    const delegated = runPythonCs486(`
def child():
    payload = "${payload}"
    yield 1
def relay():
    yield from child()
cursor = relay()
first = next(cursor)
`);
    const baseline = runPythonCs486(`
def child():
    yield 1
def relay():
    yield from child()
cursor = relay()
first = next(cursor)
`);

    expect(delegated.state.kind).toBe("completed");
    expect(delegated.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length,
    );
  });
});
