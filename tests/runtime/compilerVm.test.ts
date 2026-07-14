import { describe, expect, it } from "vitest";

import { createNativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import type { PythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type { CpuProcessState } from "../../src/domain/runtime/cpuProcess.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import {
  namespace,
  nativeFunction,
  type RuntimeValue,
} from "../../src/domain/runtime/value.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";
import { PythonCs486Harness, runPythonCs486 } from "./pythonCs486Harness.js";

const generousLimits: PythonRuntimeLimits = {
  maxCallDepth: 64,
  maxCollectionSize: 4_096,
  maxStackSize: 4_096,
  maxStringLength: 65_536,
};

function run(
  source: string,
  limits: PythonRuntimeLimits = generousLimits,
): PythonCs486Harness {
  return runPythonCs486(source, { limits });
}

function expectCompleted(vm: PythonCs486Harness): void {
  expect(vm.state).toEqual({ kind: "completed", value: null });
}

function expectCrash(
  vm: PythonCs486Harness,
  typeName: string,
  message: RegExp,
): void {
  expect(vm.state.kind).toBe("crashed");
  if (vm.state.kind !== "crashed") return;
  expect(vm.state.error.typeName).toBe(typeName);
  expect(vm.state.error.message).toMatch(message);
}

describe("Computer System Python CS486 compiler and runtime", (): void => {
  it("executes functions, defaults, branches, loops, and collection mutation", (): void => {
    const vm = run(`
def adjust(value, amount=2):
    if value > 3:
        return value + amount
    return value

total = 0
items = [1, 2, 3, 4]
for item in items:
    if item == 2:
        continue
    total = total + item
    if total > 6:
        break
items[0] = total
result = adjust(items[0])
`);

    expectCompleted(vm);
    expect(vm.globals.get("total")).toBe(8);
    expect(vm.globals.get("result")).toBe(10);
    expect(vm.globals.get("items")).toMatchObject({
      kind: "list",
      values: [8, 2, 3, 4],
    });
  });

  it("runs matching handlers, else branches, and finally blocks", (): void => {
    const vm = run(`
try:
    missing_name
except NameError as error:
    caught = error.type
else:
    caught = "not reached"
finally:
    finalized = True
`);

    expectCompleted(vm);
    expect(vm.globals.get("caught")).toBe("NameError");
    expect(vm.globals.get("finalized")).toBe(true);
  });

  it("constructs, raises, and catches allowlisted Python-style exceptions", (): void => {
    const vm = run(`
try:
    raise ValueError("invalid value")
except ValueError as error:
    message = error.message
`);

    expectCompleted(vm);
    expect(vm.globals.get("message")).toBe("invalid value");
  });

  it("preserves the active exception in nested handler blocks", (): void => {
    const reraised = run(`
try:
    missing_name
except NameError:
    try:
        raise
    finally:
        finalized = True
`);

    expectCrash(reraised, "NameError", /not defined/u);
    expect(reraised.globals.get("finalized")).toBe(true);
  });

  it("treats Exception as the common runtime exception base", (): void => {
    const vm = run(`
try:
    missing_name
except Exception as error:
    caught = error.type
`);

    expectCompleted(vm);
    expect(vm.globals.get("caught")).toBe("NameError");
  });

  it("preserves return and exception control flow through finally", (): void => {
    const returned = run(`
def choose():
    try:
        return 1
    finally:
        return 2
result = choose()
`);
    expectCompleted(returned);
    expect(returned.globals.get("result")).toBe(2);

    const reraised = run(`
try:
    missing_name
except NameError as error:
    raise error
`);
    expectCrash(reraised, "NameError", /not defined/u);
  });

  it("carries break and continue through finally to their owning loop", (): void => {
    const vm = run(`
value = 0
finalized = 0
while value < 5:
    value = value + 1
    try:
        if value < 3:
            continue
        break
    finally:
        finalized = finalized + 1
`);

    expectCompleted(vm);
    expect(vm.globals.get("value")).toBe(3);
    expect(vm.globals.get("finalized")).toBe(3);
  });

  it("halts a slice at its instruction budget without losing readiness", (): void => {
    const vm = new PythonCs486Harness("while True:\n    pass\n");
    const slice = vm.runSlice(7);

    expect(slice.executedInstructions).toBe(7);
    expect(slice.state).toEqual({ kind: "ready" });
    expect(vm.terminate("test complete")).toEqual({
      kind: "terminated",
      reason: "test complete",
    });
    expect(vm.runSlice(7).executedInstructions).toBe(0);
  });

  it.each([
    {
      name: "collection",
      source: "value = [1, 2]\n",
      limits: { ...generousLimits, maxCollectionSize: 1 },
      message: /collection limit/u,
    },
    {
      name: "string",
      source: 'value = "ab" + "cd"\n',
      limits: { ...generousLimits, maxStringLength: 3 },
      message: /string limit/u,
    },
    {
      name: "call depth",
      source: "def recurse():\n    return recurse()\nrecurse()\n",
      limits: { ...generousLimits, maxCallDepth: 2 },
      message: /call depth limit/u,
    },
    {
      name: "stack",
      source: "value = [1, 2]\n",
      limits: { ...generousLimits, maxStackSize: 1 },
      message: /stack limit/u,
    },
  ])(
    "crashes explicitly at the $name limit",
    ({ source, limits, message }): void => {
      expectCrash(run(source, limits), "ResourceLimitError", message);
    },
  );

  it("enters and resumes explicit sleep and event states", (): void => {
    const calls: RuntimeValue[] = [];
    const os = namespace("os", {
      sleep: nativeFunction("sleep", () => ({ kind: "sleep", ticks: 2 })),
      wait_event: nativeFunction("wait_event", () => ({
        kind: "wait_event",
        filter: "key",
      })),
      record: nativeFunction("record", ([value]) => {
        calls.push(value ?? null);
        return null;
      }),
    });
    const filesystem = new InMemoryFilesystem();
    const terminal = new TerminalBuffer();
    const base = createNativeEnvironment({
      computerId: 1,
      filesystem,
      terminal,
    });
    const vm = new PythonCs486Harness(
      `
import os
os.record(os.sleep())
os.record(os.wait_event())
`,
      {
        environment: {
          ...base,
          modules: new Map([...base.modules, ["os", os]]),
        },
        filesystem,
        terminal,
      },
    );

    expect(runUntilNotReady(vm)).toEqual({ kind: "sleeping", wakeTick: 2 });
    expect(vm.advanceTick(1).kind).toBe("sleeping");
    expect(vm.advanceTick(2).kind).toBe("ready");
    expect(runUntilNotReady(vm)).toEqual({
      kind: "waiting_event",
      filter: "key",
    });
    expect(vm.deliverEvent("mouse", 1)).toBe(false);
    expect(vm.deliverEvent("key", 42)).toBe(true);
    expect(runUntilNotReady(vm)).toEqual({ kind: "completed", value: null });
    expect(calls).toEqual([null, { kind: "tuple", values: ["key", 42] }]);
  });
});

function runUntilNotReady(vm: PythonCs486Harness): CpuProcessState {
  for (let slices = 0; slices < 100 && vm.state.kind === "ready"; slices += 1) {
    vm.runSlice(100);
  }
  return vm.state;
}
