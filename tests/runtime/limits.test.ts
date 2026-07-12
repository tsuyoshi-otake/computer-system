import { describe, expect, it } from "vitest";

import { compileSource } from "../../src/application/runtime/compiler.js";
import { StackVm, type VmLimits } from "../../src/application/runtime/vm.js";
import {
  BoundedEventQueue,
  BoundedTimerQueue,
} from "../../src/domain/runtime/events.js";
import { VmLimitError } from "../../src/domain/runtime/errors.js";
import { nativeFunction } from "../../src/domain/runtime/value.js";

const base: VmLimits = {
  maxCallDepth: 8,
  maxCollectionSize: 8,
  maxStackSize: 8,
  maxStringLength: 8,
};

describe("runtime resource limits", (): void => {
  it("yields at the exact instruction budget", (): void => {
    const vm = machine("while True:\n    pass\n", base);
    expect(vm.runSlice(1)).toMatchObject({
      executedInstructions: 1,
      state: { kind: "ready" },
    });
    expect(vm.runSlice(13)).toMatchObject({
      executedInstructions: 13,
      state: { kind: "ready" },
    });
  });

  it("accepts collection and string boundary values then rejects one beyond", (): void => {
    const collectionBoundary = machine("value = range(8)\n", base);
    run(collectionBoundary);
    expect(collectionBoundary.state.kind).toBe("completed");
    const collectionOverflow = machine("value = range(9)\n", base);
    run(collectionOverflow);
    expectLimit(collectionOverflow, "collection");

    const stringBoundary = machine('value = "1234" + "5678"\n', base);
    run(stringBoundary);
    expect(stringBoundary.state.kind).toBe("completed");
    const stringOverflow = machine('value = "1234" + "56789"\n', base);
    run(stringOverflow);
    expectLimit(stringOverflow, "string");
  });

  it("enforces limits on constants and native return values", (): void => {
    const literal = machine('value = "123456789"\n', base);
    run(literal);
    expectLimit(literal, "string");

    const native = new StackVm(
      {
        code: compileSource("value = oversized()\n"),
        globals: new Map([
          [
            "oversized",
            nativeFunction("oversized", () => ({
              kind: "list",
              values: [1, 2, 3, 4, 5, 6, 7, 8, 9],
            })),
          ],
        ]),
      },
      undefined,
      base,
    );
    run(native);
    expectLimit(native, "collection");
  });

  it("bounds dictionary growth while permitting replacement", (): void => {
    const replacement = machine('value = {"key": 1}\nvalue["key"] = 2\n', {
      ...base,
      maxCollectionSize: 1,
    });
    run(replacement);
    expect(replacement.state.kind).toBe("completed");

    const growth = machine('value = {"key": 1}\nvalue["other"] = 2\n', {
      ...base,
      maxCollectionSize: 1,
    });
    run(growth);
    expectLimit(growth, "collection");
  });

  it("rejects stack and call-depth overflow as terminal crashes", (): void => {
    const stack = machine("value = [1, 2]\n", { ...base, maxStackSize: 1 });
    run(stack);
    expectLimit(stack, "stack");

    const calls = machine("def recurse():\n    return recurse()\nrecurse()\n", {
      ...base,
      maxCallDepth: 2,
    });
    run(calls);
    expectLimit(calls, "call depth");
  });

  it("bounds events without altering the accepted prefix", (): void => {
    const events = new BoundedEventQueue(2);
    events.enqueue("first", 1);
    events.enqueue("second", 2);
    expect(() => events.enqueue("overflow", 3)).toThrow(VmLimitError);
    expect(events.size).toBe(2);
    expect(events.take()).toEqual({ name: "first", arguments: [1] });
    expect(events.take()).toEqual({ name: "second", arguments: [2] });
  });

  it("discards non-matching events while applying a pull filter", (): void => {
    const events = new BoundedEventQueue(3);
    events.enqueue("mouse", 1);
    events.enqueue("key", 2);
    events.enqueue("redstone", 3);

    expect(events.take("key")).toEqual({ name: "key", arguments: [2] });
    expect(events.take()).toEqual({ name: "redstone", arguments: [3] });
    expect(events.take()).toBeUndefined();
  });

  it("bounds timers and emits accepted timers once in deterministic order", (): void => {
    const timers = new BoundedTimerQueue(2);
    const late = timers.start(10, 3);
    const early = timers.start(10, 1);
    expect(() => timers.start(10, 2)).toThrow(VmLimitError);
    expect(timers.takeDue(10)).toEqual([]);
    expect(timers.takeDue(13).map(({ id }) => id)).toEqual([early, late]);
    expect(timers.takeDue(13)).toEqual([]);
    expect(timers.size).toBe(0);
  });
});

function machine(source: string, limits: VmLimits): StackVm {
  return new StackVm({ code: compileSource(source) }, undefined, limits);
}

function run(vm: StackVm): void {
  for (let count = 0; count < 100 && vm.state.kind === "ready"; count += 1)
    vm.runSlice(100);
}

function expectLimit(vm: StackVm, name: string): void {
  expect(vm.state.kind).toBe("crashed");
  if (vm.state.kind !== "crashed") return;
  expect(vm.state.error.typeName).toBe("ResourceLimitError");
  expect(vm.state.error.message).toContain(`${name} limit`);
}
