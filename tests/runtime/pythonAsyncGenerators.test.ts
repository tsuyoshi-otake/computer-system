import { describe, expect, it } from "vitest";

import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type {
  RuntimeAsyncGenerator,
  RuntimeList,
  RuntimeSet,
} from "../../src/domain/runtime/value.js";
import {
  PythonCs486CoreHarness,
  runPythonCs486Core,
} from "./pythonCs486CoreHarness.js";

describe("Computer System Python 3.14 asynchronous generators", (): void => {
  it("creates an unstarted asynchronous generator without running its body", (): void => {
    const machine = runPythonCs486Core(`
events = ""
async def stream():
    global events
    events = events + "started"
    yield 1
generator = stream()
before = events
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("before")).toBe("");
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).kind,
    ).toBe("async_generator");
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).state,
    ).toBe("created");
  });

  it("consumes yielded values through async for on the existing process", (): void => {
    const machine = runPythonCs486Core(`
async def stream():
    yield 1
    yield 2
    yield 3
async def consume():
    total = 0
    async for value in stream():
        total = total + value
    return total
coroutine = consume()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(6);
  });

  it("returns awaitable operations from __anext__ and asend", (): void => {
    const machine = runPythonCs486Core(`
async def echo():
    received = yield 1
    yield received
generator = echo()
async def drive():
    first = await generator.__anext__()
    second = await generator.asend(42)
    exhausted = False
    try:
        await generator.__anext__()
    except StopAsyncIteration:
        exhausted = True
    return first * 100 + second + exhausted
coroutine = drive()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(143);
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).state,
    ).toBe("closed");
  });

  it("injects athrow at the suspended yield and returns the next item", (): void => {
    const machine = runPythonCs486Core(`
async def recover():
    try:
        yield 1
    except ValueError:
        yield 9
generator = recover()
async def drive():
    first = await generator.__anext__()
    recovered = await generator.athrow(ValueError("bad"))
    await generator.aclose()
    return first * 10 + recovered
coroutine = drive()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(19);
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).state,
    ).toBe("closed");
  });

  it("runs finally exactly once when aclose closes a suspended generator", (): void => {
    const machine = runPythonCs486Core(`
events = ""
async def stream():
    global events
    try:
        yield 1
    finally:
        events = events + "closed"
generator = stream()
async def drive():
    first = await generator.__anext__()
    await generator.aclose()
    return first
coroutine = drive()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(1);
    expect(machine.globals.get("events")).toBe("closed");
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).state,
    ).toBe("closed");
  });

  it("evaluates eager asynchronous comprehensions in their coroutine scope", (): void => {
    const machine = runPythonCs486Core(`
async def source():
    yield 1
    yield 2
    yield 3
async def build():
    values = [value * 10 async for value in source() if value > 1]
    mapping = {value: value + 1 async for value in source()}
    unique = {value async for value in source() if value != 2}
    return [values, mapping[3], unique]
coroutine = build()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    const result = (machine.globals.get("result") as RuntimeList).values;
    expect((result[0] as RuntimeList).values).toEqual([20, 30]);
    expect(result[1]).toBe(4);
    expect([...(result[2] as RuntimeSet).entries.values()]).toEqual([1, 3]);
  });

  it("runs an asynchronous generator expression lazily from module scope", (): void => {
    const machine = runPythonCs486Core(`
calls = 0
async def source():
    global calls
    calls = calls + 1
    yield 3
    yield 4
cursor = (value * 2 async for value in source())
before = calls
async def consume():
    total = 0
    async for value in cursor:
        total = total + value
    return total
coroutine = consume()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("before")).toBe(0);
    expect(machine.globals.get("calls")).toBe(1);
    expect(machine.globals.get("result")).toBe(14);
  });

  it("closes an unstarted generator without entering its body", (): void => {
    const machine = runPythonCs486Core(`
ran = False
async def stream():
    global ran
    ran = True
    yield 1
generator = stream()
async def shut_down():
    return await generator.aclose()
coroutine = shut_down()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("ran")).toBe(false);
    expect(machine.globals.get("result")).toBeNull();
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).state,
    ).toBe("closed");
  });

  it("rejects a yield while closing and leaves the generator closed", (): void => {
    const machine = runPythonCs486Core(`
async def ignores_close():
    try:
        yield 1
    except GeneratorExit:
        yield 2
generator = ignores_close()
async def drive():
    first = await generator.__anext__()
    failed = False
    try:
        await generator.aclose()
    except RuntimeError:
        failed = True
    return [first, failed]
coroutine = drive()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect((machine.globals.get("result") as RuntimeList).values).toEqual([
      1,
      true,
    ]);
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).state,
    ).toBe("closed");
  });

  it("keeps created frames and operation arguments reachable", (): void => {
    const baseline = runPythonCs486Core(`
async def stream(value):
    yield value
`);
    const retained = runPythonCs486Core(`
async def stream(value):
    yield value
generator = stream([1, 2, 3])
operation = generator.asend([4, 5, 6])
`);

    expect(baseline.state.kind).toBe("completed");
    expect(retained.state.kind).toBe("completed");
    expect(retained.program.runtime.memoryUsageBytes).toBeGreaterThan(
      baseline.program.runtime.memoryUsageBytes,
    );
  });

  it("rolls back call-depth rejection without consuming the operation", (): void => {
    const machine = runPythonCs486Core(
      `
async def stream():
    yield 9
generator = stream()
operation = generator.__anext__()
async def attempt():
    return await operation
async def outer():
    try:
        await attempt()
    except ResourceLimitError:
        return "limited"
coroutine = outer()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
async def retry():
    return await operation
retry_coroutine = retry()
try:
    retry_coroutine.send(None)
except StopIteration as stopped:
    retry_result = stopped.value
`,
      {
        limits: { ...defaultPythonRuntimeLimits, maxCallDepth: 2 },
      },
    );

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe("limited");
    expect(machine.globals.get("retry_result")).toBe(9);
  });

  it("awaits coroutines inside asynchronous generator bodies", (): void => {
    const machine = runPythonCs486Core(`
async def increment(value):
    return value + 1
async def stream():
    yield await increment(40)
generator = stream()
async def drive():
    return await generator.__anext__()
coroutine = drive()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("result")).toBe(41);
  });

  it("rejects generator and operation re-entry without corrupting state", (): void => {
    const machine = runPythonCs486Core(`
generator = None
operation = None
async def stream():
    generator_reentry = False
    operation_reentry = False
    try:
        await generator.__anext__()
    except ValueError:
        generator_reentry = True
    try:
        await operation
    except RuntimeError:
        operation_reentry = True
    yield [generator_reentry, operation_reentry]
generator = stream()
operation = generator.__anext__()
async def drive():
    return await operation
coroutine = drive()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect((machine.globals.get("result") as RuntimeList).values).toEqual([
      true,
      true,
    ]);
    expect(
      (machine.globals.get("generator") as RuntimeAsyncGenerator).state,
    ).toBe("suspended");
  });

  it("supports await-driven comprehensions and generator expressions over sync clauses", (): void => {
    const machine = runPythonCs486Core(`
async def increment(value):
    return value + 1
async def build():
    eager = [await increment(value) for value in [1, 2]]
    lazy = (await increment(value) for value in [3, 4])
    total = 0
    async for value in lazy:
        total = total + value
    return [eager, total]
coroutine = build()
try:
    coroutine.send(None)
except StopIteration as stopped:
    result = stopped.value
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    const result = (machine.globals.get("result") as RuntimeList).values;
    expect((result[0] as RuntimeList).values).toEqual([2, 3]);
    expect(result[1]).toBe(9);
  });

  it("remains resumable under eight-instruction CS486 slices", (): void => {
    const machine = new PythonCs486CoreHarness(`
async def source():
    yield 1
    yield 2
async def build():
    return [value * 10 async for value in source()]
coroutine = build()
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
    expect((machine.globals.get("result") as RuntimeList).values).toEqual([
      10, 20,
    ]);
  });
});
