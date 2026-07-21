import { describe, expect, it } from "vitest";

import { createPythonCs486Program } from "../../src/application/runtime/pythonCs486.js";
import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import { defaultPythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { assembleCs486Object } from "../../src/application/toolchain/cs486Assembler.js";
import { RoundRobinScheduler } from "../../src/application/runtime/scheduler.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import {
  nativeFunction,
  type RuntimeList,
  type RuntimeTuple,
} from "../../src/domain/runtime/value.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { runPythonCs486Core as runPythonCs486 } from "./pythonCs486CoreHarness.js";

describe("Computer System Python callable/sentinel iteration", (): void => {
  it("evaluates operands once and keeps sentinel exhaustion stable", (): void => {
    const machine = runPythonCs486(`
callable_evaluations = 0
sentinel_evaluations = 0
calls = 0
def read():
    global calls
    calls = calls + 1
    return calls
def make_callable():
    global callable_evaluations
    callable_evaluations = callable_evaluations + 1
    return read
def make_sentinel():
    global sentinel_evaluations
    sentinel_evaluations = sentinel_evaluations + 1
    return 3
cursor = iter(make_callable(), make_sentinel())
identity = iter(cursor) is cursor
first = next(cursor)
second = next(cursor)
fallback = next(cursor, 99)
fallback_again = next(cursor, 100)
lambda_fallback = next(iter(lambda: 7, 7), 8)
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("callable_evaluations")).toBe(1);
    expect(machine.globals.get("sentinel_evaluations")).toBe(1);
    expect(machine.globals.get("calls")).toBe(3);
    expect(machine.globals.get("identity")).toBe(true);
    expect(machine.globals.get("first")).toBe(1);
    expect(machine.globals.get("second")).toBe(2);
    expect(machine.globals.get("fallback")).toBe(99);
    expect(machine.globals.get("fallback_again")).toBe(100);
    expect(machine.globals.get("lambda_fallback")).toBe(8);
  });

  it("invokes bound methods and classes through the ordinary managed call path", (): void => {
    const machine = runPythonCs486(`
class Reader:
    def __init__(self):
        self.value = 0
    def read(self):
        self.value = self.value + 1
        if self.value == 3:
            return 0
        return self.value

reader = Reader()
method_cursor = iter(reader.read, 0)
method_values = [*method_cursor]

built = 0
class Product:
    def __init__(self):
        global built
        built = built + 1
        if built == 3:
            raise StopIteration

class_cursor = iter(Product, None)
first_product = next(class_cursor)
second_product = next(class_cursor)
class_fallback = next(class_cursor, "done")
class_fallback_again = next(class_cursor, "still done")
products_are_instances = isinstance(first_product, Product) and isinstance(second_product, Product)
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(
      (machine.globals.get("method_values") as RuntimeList).values,
    ).toEqual([1, 2]);
    expect(machine.globals.get("built")).toBe(3);
    expect(machine.globals.get("class_fallback")).toBe("done");
    expect(machine.globals.get("class_fallback_again")).toBe("still done");
    expect(machine.globals.get("products_are_instances")).toBe(true);
  });

  it("shares one protocol across lazy and materializing consumers", (): void => {
    const machine = runPythonCs486(`
class Reader:
    def __init__(self):
        self.value = 0
    def read(self):
        self.value = self.value + 1
        if self.value == 4:
            return 0
        return self.value

def fresh():
    return Reader().read
def collect(*values):
    return values
def relay():
    yield from iter(fresh(), 0)

loop_values = []
for value in iter(fresh(), 0):
    loop_values = [*loop_values, value]
display_values = [9, *iter(fresh(), 0), 10]
unpack_left, *unpack_middle, unpack_right = iter(fresh(), 0)
call_values = collect(*iter(fresh(), 0))
slice_values = [8, 9]
slice_values[1:2] = iter(fresh(), 0)
set_values = set(iter(fresh(), 0))
comprehension_values = [value * 2 for value in iter(fresh(), 0)]
generator_expression_values = [*(value + 10 for value in iter(fresh(), 0))]
yield_from_values = [*relay()]
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect((machine.globals.get("loop_values") as RuntimeList).values).toEqual([
      1, 2, 3,
    ]);
    expect(
      (machine.globals.get("display_values") as RuntimeList).values,
    ).toEqual([9, 1, 2, 3, 10]);
    expect(machine.globals.get("unpack_left")).toBe(1);
    expect(
      (machine.globals.get("unpack_middle") as RuntimeList).values,
    ).toEqual([2]);
    expect(machine.globals.get("unpack_right")).toBe(3);
    expect((machine.globals.get("call_values") as RuntimeTuple).values).toEqual(
      [1, 2, 3],
    );
    expect((machine.globals.get("slice_values") as RuntimeList).values).toEqual(
      [8, 1, 2, 3],
    );
    expect(
      (machine.globals.get("comprehension_values") as RuntimeList).values,
    ).toEqual([2, 4, 6]);
    expect(
      (machine.globals.get("generator_expression_values") as RuntimeList)
        .values,
    ).toEqual([11, 12, 13]);
    expect(
      (machine.globals.get("yield_from_values") as RuntimeList).values,
    ).toEqual([1, 2, 3]);
  });

  it("makes callable StopIteration sticky but preserves recovery from other faults", (): void => {
    const machine = runPythonCs486(`
stop_calls = 0
def stopped():
    global stop_calls
    stop_calls = stop_calls + 1
    raise StopIteration("finished")
stopped_cursor = iter(stopped, 99)
stopped_first = next(stopped_cursor, "done")
stopped_second = next(stopped_cursor, "still done")

recover_calls = 0
def recovering():
    global recover_calls
    recover_calls = recover_calls + 1
    if recover_calls == 1:
        raise ValueError("retry")
    if recover_calls == 3:
        return 0
    return 2
recover_cursor = iter(recovering, 0)
caught = False
try:
    next(recover_cursor)
except ValueError:
    caught = True
recovered = next(recover_cursor)
recover_done = next(recover_cursor, "done")
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("stop_calls")).toBe(1);
    expect(machine.globals.get("stopped_first")).toBe("done");
    expect(machine.globals.get("stopped_second")).toBe("still done");
    expect(machine.globals.get("caught")).toBe(true);
    expect(machine.globals.get("recover_calls")).toBe(3);
    expect(machine.globals.get("recovered")).toBe(2);
    expect(machine.globals.get("recover_done")).toBe("done");
  });

  it("retains the callable receiver and sentinel through the managed heap", (): void => {
    const machine = runPythonCs486(`
class Token:
    pass
class Reader:
    def __init__(self, sentinel):
        self.sentinel = sentinel
        self.calls = 0
    def read(self):
        self.calls = self.calls + 1
        if self.calls == 2:
            return self.sentinel
        return 7

token = Token()
reader = Reader(token)
cursor = iter(reader.read, token)
reader = None
token = None
first = next(cursor)
done = next(cursor, "done")
done_again = next(cursor, "still done")
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("first")).toBe(7);
    expect(machine.globals.get("done")).toBe("done");
    expect(machine.globals.get("done_again")).toBe("still done");
    expect(machine.memoryUsageBytes).toBeLessThanOrEqual(
      machine.memoryLimitBytes,
    );
  });

  it("rejects invalid signatures and retains bounded call-depth ownership", (): void => {
    const machine = runPythonCs486(`
non_callable = False
try:
    iter(42, 0)
except TypeError:
    non_callable = True
too_many = False
try:
    iter(lambda: 1, 1, 2)
except TypeError:
    too_many = True
keyword = False
try:
    iter(lambda: 1, sentinel=1)
except TypeError:
    keyword = True
wrong_callable_arity = False
try:
    next(iter(lambda value: value, 1))
except TypeError:
    wrong_callable_arity = True
`);

    expect(machine.state.kind, JSON.stringify(machine.state)).toBe("completed");
    expect(machine.globals.get("non_callable")).toBe(true);
    expect(machine.globals.get("too_many")).toBe(true);
    expect(machine.globals.get("keyword")).toBe(true);
    expect(machine.globals.get("wrong_callable_arity")).toBe(true);

    const depthLimited = runPythonCs486(
      `
def read():
    return 1
cursor = iter(read, 0)
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

  it("resumes native waits before comparing the sentinel", (): void => {
    const scheduler = new RoundRobinScheduler({
      cpuCyclesPerComputer: 100_000,
      cpuCyclesPerTick: 100_000,
      eventCapacity: 8,
      timerCapacity: 8,
    });
    const filesystem = new InMemoryFilesystem();
    const baseEnvironment = createNativeEnvironment({
      computerId: 7,
      currentTick: () => scheduler.tickNumber,
      filesystem,
      terminal: new TerminalBuffer(),
    });
    let calls = 0;
    const environment = {
      ...baseEnvironment,
      globals: new Map(baseEnvironment.globals).set(
        "wait_read",
        nativeFunction("wait_read", () => {
          calls += 1;
          return calls === 1 ? { filter: "ready", kind: "wait_event" } : 0;
        }),
      ),
    };
    const program = createPythonCs486Program({
      environment,
      filesystem: environment.filesystem,
      memoryBytes: 1_048_576,
      path: "/main.py",
      source:
        'cursor = iter(wait_read, 0)\nvalue = next(cursor)\ndone = next(cursor, "done")\n',
    });
    scheduler.add(7, program.process);

    scheduler.runTick();
    expect(program.process.state).toEqual({
      filter: "ready",
      kind: "waiting_event",
    });
    scheduler.queueEvent(7, "ready", 42);
    scheduler.runTick();

    expect(program.process.state.kind).toBe("completed");
    expect(program.runtime.globals.get("value")).toEqual({
      kind: "tuple",
      values: ["ready", 42],
    });
    expect(program.runtime.globals.get("done")).toBe("done");
    expect(calls).toBe(2);
  });

  it("dispatches CS486 extension callables without bypassing the process", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/lib/python");
    const object = assembleCs486Object(
      [
        "section .text",
        "global read",
        "type read, function",
        "read:",
        "mov eax, 7",
        "ret",
      ].join("\n"),
    );
    filesystem.writeFile(
      "/lib/python/source.o",
      `CS486OBJ\n${JSON.stringify(object)}`,
    );
    const environment = createNativeEnvironment({
      computerId: 1,
      filesystem,
      terminal: new TerminalBuffer(),
    });
    const program = createPythonCs486Program({
      environment,
      filesystem: environment.filesystem,
      memoryBytes: 1_048_576,
      path: "/main.py",
      source:
        "import source\ncursor = iter(source.read, 7)\nresult = next(cursor, 99)\nresult_again = next(cursor, 100)\n",
    });
    for (
      let slices = 0;
      slices < 1_000 &&
      (program.process.state.kind === "ready" ||
        program.process.hasPendingCpuCycles);
      slices += 1
    ) {
      program.process.runCpuSlice(100_000);
    }

    expect(
      program.process.state.kind,
      JSON.stringify(program.process.state),
    ).toBe("completed");
    expect(program.runtime.globals.get("result")).toBe(99);
    expect(program.runtime.globals.get("result_again")).toBe(100);
  });
});
