import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type { RuntimeCoroutine } from "../../src/domain/runtime/value.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python 3.14 coroutines", (): void => {
  it("creates an unstarted coroutine without executing its body", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
async def work():
    global calls
    calls = calls + 1
    return 7
coroutine = work()
before = calls
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect((machine.globals.get("coroutine") as RuntimeCoroutine).kind).toBe(
      "coroutine",
    );
    expect((machine.globals.get("coroutine") as RuntimeCoroutine).state).toBe(
      "created",
    );
  });

  it("awaits nested coroutines and returns the exact completion value", (): void => {
    const machine = runPythonCs486Core(`
async def inner(value):
    return value + 1
async def outer(value):
    first = await inner(value)
    second = await inner(first)
    return second * 2
coroutine = outer(20)
completed = False
try:
    coroutine.send(None)
except StopIteration as stopped:
    completed = True
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("completed")).toBe(true);
    expect(machine.globals.get("result")).toBe(44);
    expect((machine.globals.get("coroutine") as RuntimeCoroutine).state).toBe(
      "closed",
    );
  });

  it("routes awaited faults through the awaiting coroutine handlers", (): void => {
    const machine = runPythonCs486Core(`
async def fail():
    raise ValueError("bad")
async def recover():
    try:
        await fail()
    except ValueError:
        return "recovered"
coroutine = recover()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe("recovered");
  });

  it("converts an escaping StopIteration to a coroutine RuntimeError", (): void => {
    const machine = runPythonCs486Core(`
async def fail():
    raise StopIteration("bad")
coroutine = fail()
try:
    coroutine.send(None)
except RuntimeError as error:
    message = error.message
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("message")).toBe(
      "coroutine raised StopIteration",
    );
  });

  it("awaits a class-backed __await__ iterator that completes synchronously", (): void => {
    const machine = runPythonCs486Core(`
class Immediate:
    def __init__(self, value):
        self.value = value
    def __await__(self):
        if False:
            yield None
        return self.value
async def use():
    return await Immediate(42)
coroutine = use()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(42);
  });

  it("awaits an iterator returned by a synchronous __await__ method", (): void => {
    const machine = runPythonCs486Core(`
def immediate(value):
    if False:
        yield None
    return value
class Wrapper:
    def __init__(self, value):
        self.value = value
    def __await__(self):
        return immediate(self.value)
async def use():
    return await Wrapper(33)
coroutine = use()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(33);
  });

  it("fails an externally yielding custom awaitable without a scheduler", (): void => {
    const machine = runPythonCs486Core(`
class Suspends:
    def __await__(self):
        yield "external-token"
async def use():
    failed = False
    try:
        await Suspends()
    except RuntimeError:
        failed = True
    return failed
coroutine = use()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(true);
  });

  it("runs class-backed async iterators and consumes StopAsyncIteration", (): void => {
    const machine = runPythonCs486Core(`
class AsyncCounter:
    def __init__(self, limit):
        self.current = 0
        self.limit = limit
    def __aiter__(self):
        return self
    async def __anext__(self):
        if self.current >= self.limit:
            raise StopAsyncIteration
        value = self.current
        self.current = self.current + 1
        return value
async def consume():
    total = 0
    async for value in AsyncCounter(5):
        if value == 1:
            continue
        total = total + value
    stopped_early = 0
    async for value in AsyncCounter(5):
        if value == 2:
            break
        stopped_early = stopped_early + value
    return total + stopped_early
coroutine = consume()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(10);
  });

  it("awaits a coroutine returned by a synchronous __anext__ method", (): void => {
    const machine = runPythonCs486Core(`
events = ""
class AsyncCounter:
    def __init__(self):
        self.current = 0
    def __aiter__(self):
        return self
    async def step(self):
        global events
        events = events + "s" + str(self.current)
        if self.current >= 3:
            raise StopAsyncIteration
        value = self.current
        self.current = self.current + 1
        return value
    def __anext__(self):
        global events
        events = events + "n" + str(self.current)
        return self.step()
async def consume():
    global events
    total = 0
    async for value in AsyncCounter():
        events = events + "v" + str(value)
        total = total + value
    return total
coroutine = consume()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(
      machine.globals.get("result"),
      JSON.stringify(machine.globals.get("events")),
    ).toBe(3);
  });

  it("awaits async context entry and exact normal finalization", (): void => {
    const machine = runPythonCs486Core(`
entered = 0
exited = 0
class Manager:
    async def __aenter__(self):
        global entered
        entered = entered + 1
        return 21
    async def __aexit__(self, fault_type, fault, traceback):
        global exited
        exited = exited + 1
        return False
async def use():
    async with Manager() as value:
        return value * 2
coroutine = use()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(42);
    expect(machine.globals.get("entered")).toBe(1);
    expect(machine.globals.get("exited")).toBe(1);
  });

  it("awaits async context fault suppression", (): void => {
    const machine = runPythonCs486Core(`
exit_saw_fault = False
class Suppressor:
    async def __aenter__(self):
        return self
    async def __aexit__(self, fault_type, fault, traceback):
        global exit_saw_fault
        exit_saw_fault = fault_type is ValueError
        return True
async def use():
    async with Suppressor():
        raise ValueError("handled")
    return "continued"
coroutine = use()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe("continued");
    expect(machine.globals.get("exit_saw_fault")).toBe(true);
  });

  it("enters multiple async contexts left-to-right and exits right-to-left", (): void => {
    const machine = runPythonCs486Core(`
events = ""
class Manager:
    def __init__(self, name):
        self.name = name
    async def __aenter__(self):
        global events
        events = events + "e" + self.name
        return self.name
    async def __aexit__(self, fault_type, fault, traceback):
        global events
        events = events + "x" + self.name
        return False
async def use():
    async with Manager("a") as first, Manager("b") as second:
        global events
        events = events + first + second
    return events
coroutine = use()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe("eaebabxbxa");
  });

  it("rejects malformed async iteration and context protocols explicitly", (): void => {
    const machine = runPythonCs486Core(`
class MissingAiter:
    pass
class AwaitedAiter:
    async def __aiter__(self):
        return self
    async def __anext__(self):
        raise StopAsyncIteration
class BadAiterResult:
    def __aiter__(self):
        return 1
class BadNextResult:
    def __aiter__(self):
        return self
    def __anext__(self):
        return 1
class MissingContext:
    pass
async def check():
    failures = 0
    try:
        async for value in MissingAiter():
            pass
    except TypeError:
        failures = failures + 1
    try:
        async for value in AwaitedAiter():
            pass
    except TypeError:
        failures = failures + 1
    try:
        async for value in BadAiterResult():
            pass
    except TypeError:
        failures = failures + 1
    try:
        async for value in BadNextResult():
            pass
    except TypeError:
        failures = failures + 1
    try:
        async with MissingContext():
            pass
    except TypeError:
        failures = failures + 1
    return failures
coroutine = check()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(5);
  });

  it("rejects non-awaitables and reuse after completion", (): void => {
    const machine = runPythonCs486Core(`
async def invalid():
    failed = False
    try:
        await 17
    except TypeError:
        failed = True
    return failed
coroutine = invalid()
try:
    coroutine.send(None)
except StopIteration as stopped:
    invalid_failed = stopped.value
reuse_failed = False
try:
    coroutine.send(None)
except RuntimeError:
    reuse_failed = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("invalid_failed")).toBe(true);
    expect(machine.globals.get("reuse_failed")).toBe(true);
  });

  it("supports explicit close and injected throw terminal states", (): void => {
    const machine = runPythonCs486Core(`
ran = False
async def work():
    global ran
    ran = True
    return 1
closed = work()
close_result = closed.close()
closed_without_running = not ran
closed_send_failed = False
try:
    closed.send(None)
except RuntimeError:
    closed_send_failed = True
thrown = work()
throw_failed = False
try:
    thrown.throw(ValueError("injected"))
except ValueError:
    throw_failed = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("close_result")).toBeNull();
    expect(machine.globals.get("closed_without_running")).toBe(true);
    expect(machine.globals.get("closed_send_failed")).toBe(true);
    expect(machine.globals.get("throw_failed")).toBe(true);
    expect((machine.globals.get("thrown") as RuntimeCoroutine).state).toBe(
      "closed",
    );
  });

  it("keeps created coroutine frames in reachable heap accounting", (): void => {
    const baseline = runPythonCs486Core(`
async def work(value):
    return value
`);
    const withCoroutine = runPythonCs486Core(`
async def work(value):
    return value
coroutine = work([1, 2, 3])
`);

    expect(baseline.state.kind).toBe("completed");
    expect(withCoroutine.state.kind).toBe("completed");
    expect(withCoroutine.program.runtime.memoryUsageBytes).toBeGreaterThan(
      baseline.program.runtime.memoryUsageBytes,
    );
  });

  it("rejects capacity-plus-one await depth without consuming the child", (): void => {
    const machine = runPythonCs486Core(
      `
child = None
async def inner():
    return 42
async def outer():
    global child
    child = inner()
    try:
        await child
    except ResourceLimitError:
        return "limited"
coroutine = outer()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
try:
    child.send(None)
except StopIteration as stopped:
    child_result = stopped.value
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 1 },
      },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe("limited");
    expect(machine.globals.get("child_result")).toBe(42);
  });

  it("remains resumable under small CS486 instruction slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
async def inner(value):
    return value + 1
async def outer():
    return await inner(41)
coroutine = outer()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);
    let slices = 0;
    while (
      slices < 2_000 &&
      (machine.state.kind === "ready" || machine.hasPendingCpuCycles)
    ) {
      machine.runSlice(8);
      slices += 1;
    }

    expect(slices).toBeGreaterThan(1);
    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(42);
  });
});
