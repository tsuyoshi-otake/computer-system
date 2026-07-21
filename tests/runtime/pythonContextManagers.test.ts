import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { runPythonCs486Core as runPythonCs486 } from "./pythonCs486CoreHarness.js";

describe("Computer System Python context managers", (): void => {
  it("enters left-to-right, assigns targets, and exits right-to-left", (): void => {
    const machine = runPythonCs486(`
events = ""
normal_type = 1
normal_value = 1
normal_traceback = 1
class Manager:
    def __init__(self, name):
        self.name = name
    def __enter__(self):
        global events
        events = events + "e" + self.name
        return self.name
    def __exit__(self, type_, value, traceback):
        global events, normal_type, normal_value, normal_traceback
        events = events + "x" + self.name
        normal_type = type_
        normal_value = value
        normal_traceback = traceback
        return False
with Manager("a") as first, Manager("b") as second:
    events = events + first + second
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("events")).toBe("eaebabxbxa");
    expect(machine.globals.get("normal_type")).toBeNull();
    expect(machine.globals.get("normal_value")).toBeNull();
    expect(machine.globals.get("normal_traceback")).toBeNull();
  });

  it("passes exact fault information and honors truthy suppression", (): void => {
    const machine = runPythonCs486(`
seen_type = None
seen_value = None
seen_traceback = 1
original = ValueError("handled")
class Suppress:
    def __enter__(self):
        return self
    def __exit__(self, type_, value, traceback):
        global seen_type, seen_value, seen_traceback
        seen_type = type_
        seen_value = value
        seen_traceback = traceback
        return True
continued = False
with Suppress():
    raise original
continued = True
same_type = seen_type is ValueError
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("same_type")).toBe(true);
    expect(machine.globals.get("seen_value")).toBe(
      machine.globals.get("original"),
    );
    expect(machine.globals.get("seen_traceback")).toBeNull();
    expect(machine.globals.get("continued")).toBe(true);
  });

  it("reraises the exact fault when exit is false", (): void => {
    const machine = runPythonCs486(`
original = KeyError("same")
class Reject:
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        return False
same = False
try:
    with Reject():
        raise original
except KeyError as error:
    same = error is original
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("same")).toBe(true);
  });

  it("runs exit for return, break, and continue control paths", (): void => {
    const machine = runPythonCs486(`
exits = 0
class Count:
    def __enter__(self):
        return self
    def __exit__(self, type_, value, traceback):
        global exits
        exits = exits + 1
        return True
def returning():
    with Count():
        return 7
returned = returning()
iterations = 0
for value in [1, 2, 3]:
    with Count():
        if value == 1:
            continue
        iterations = iterations + 1
        break
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("returned")).toBe(7);
    expect(machine.globals.get("iterations")).toBe(1);
    expect(machine.globals.get("exits")).toBe(3);
  });

  it("calls exit for target-assignment failure and allows suppression", (): void => {
    const machine = runPythonCs486(`
exit_type = None
class Target:
    def __enter__(self):
        return [1]
    def __exit__(self, type_, value, traceback):
        global exit_type
        exit_type = type_
        return True
continued = False
with Target() as [left, right]:
    continued = False
continued = True
same_type = exit_type is ValueError
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("continued")).toBe(true);
    expect(machine.globals.get("same_type")).toBe(true);
  });

  it("does not call exit before successful enter and propagates exit faults", (): void => {
    const machine = runPythonCs486(`
entered = 0
exited = 0
class MissingExit:
    def __enter__(self):
        global entered
        entered = entered + 1
missing = False
try:
    with MissingExit():
        pass
except TypeError:
    missing = True

class EnterFault:
    def __enter__(self):
        raise ValueError("enter")
    def __exit__(self, type_, value, traceback):
        global exited
        exited = exited + 1
enter_failed = False
try:
    with EnterFault():
        pass
except ValueError:
    enter_failed = True

class ExitFault:
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        raise KeyError("exit")
exit_failed = False
try:
    with ExitFault():
        pass
except KeyError:
    exit_failed = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("missing")).toBe(true);
    expect(machine.globals.get("entered")).toBe(0);
    expect(machine.globals.get("enter_failed")).toBe(true);
    expect(machine.globals.get("exited")).toBe(0);
    expect(machine.globals.get("exit_failed")).toBe(true);
  });

  it("uses class-backed special-method lookup instead of instance attributes", (): void => {
    const machine = runPythonCs486(`
class InstanceOnly:
    pass
manager = InstanceOnly()
manager.__enter__ = lambda: None
manager.__exit__ = lambda type_, value, traceback: True
rejected = False
try:
    with manager:
        pass
except TypeError:
    rejected = True
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("rejected")).toBe(true);
  });

  it("routes an inner exit fault through the already-entered outer manager", (): void => {
    const machine = runPythonCs486(`
outer_type = None
outer_value = None
replacement = KeyError("replacement")
class Outer:
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        global outer_type, outer_value
        outer_type = type_
        outer_value = value
        return True
class Inner:
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        raise replacement
with Outer(), Inner():
    raise ValueError("original")
same_type = outer_type is KeyError
same_value = outer_value is replacement
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("same_type")).toBe(true);
    expect(machine.globals.get("same_value")).toBe(true);
  });

  it("reports a suppressed inner fault as normal completion to the outer manager", (): void => {
    const machine = runPythonCs486(`
outer_type = 1
outer_value = 1
outer_traceback = 1
class Outer:
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        global outer_type, outer_value, outer_traceback
        outer_type = type_
        outer_value = value
        outer_traceback = traceback
        return False
class Inner:
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        return True
with Outer(), Inner():
    raise ValueError("suppressed")
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("outer_type")).toBeNull();
    expect(machine.globals.get("outer_value")).toBeNull();
    expect(machine.globals.get("outer_traceback")).toBeNull();
  });

  it("unwinds only already-entered managers when a later enter fails", (): void => {
    const machine = runPythonCs486(`
original = ValueError("enter")
outer_value = None
inner_exited = False
class Outer:
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        global outer_value
        outer_value = value
        return True
class Inner:
    def __enter__(self):
        raise original
    def __exit__(self, type_, value, traceback):
        global inner_exited
        inner_exited = True
with Outer(), Inner():
    pass
same_value = outer_value is original
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("same_value")).toBe(true);
    expect(machine.globals.get("inner_exited")).toBe(false);
  });

  it("retains exit across generator suspension and closes exactly once", (): void => {
    const machine = runPythonCs486(`
events = ""
exit_type = None
class Suspended:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return self.payload
    def __exit__(self, type_, value, traceback):
        global events, exit_type
        events = events + "x"
        exit_type = type_
        return False
def generate():
    with Suspended("retained") as value:
        yield value
cursor = generate()
first = next(cursor)
before_close = events
closed = cursor.close()
after_close = events
same_type = exit_type is GeneratorExit
`);

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("first")).toBe("retained");
    expect(machine.globals.get("before_close")).toBe("");
    expect(machine.globals.get("closed")).toBeNull();
    expect(machine.globals.get("after_close")).toBe("x");
    expect(machine.globals.get("same_type")).toBe(true);
  });

  it("preflights the bound receiver and three exit arguments before entering", (): void => {
    const machine = runPythonCs486(
      `
entered = False
class Limited:
    def __enter__(self):
        global entered
        entered = True
        return None
    def __exit__(self, type_, value, traceback):
        return False
limited = False
try:
    with Limited():
        pass
except ResourceLimitError:
    limited = True
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 3 },
      },
    );

    expect(machine.state.kind).toBe("completed");
    expect(machine.globals.get("limited")).toBe(true);
    expect(machine.globals.get("entered")).toBe(false);

    const exact = runPythonCs486(
      `
entered = False
exited = False
class Exact:
    def __enter__(self):
        global entered
        entered = True
        return None
    def __exit__(self, type_, value, traceback):
        global exited
        exited = True
with Exact():
    pass
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCollectionSize: 4 },
      },
    );
    expect(exact.state.kind).toBe("completed");
    expect(exact.globals.get("entered")).toBe(true);
    expect(exact.globals.get("exited")).toBe(true);
  });

  it("retains the bound exit receiver through the managed heap", (): void => {
    const payload = "context-manager-".repeat(96);
    const suspended = runPythonCs486(`
class Retain:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        return False
def generate():
    with Retain("${payload}"):
        yield 1
cursor = generate()
first = next(cursor)
`);
    const baseline = runPythonCs486(`
class Retain:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return None
    def __exit__(self, type_, value, traceback):
        return False
def generate():
    with Retain("x"):
        yield 1
cursor = generate()
first = next(cursor)
`);

    expect(suspended.state.kind).toBe("completed");
    expect(suspended.memoryUsageBytes).toBeGreaterThan(
      baseline.memoryUsageBytes + payload.length / 2,
    );
  });
});
