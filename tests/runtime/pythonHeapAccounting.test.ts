import { describe, expect, it } from "vitest";

import {
  PythonHeapAccounting,
  type PythonHeapRoots,
} from "../../src/application/runtime/python/heapAccounting.js";
import { VmMemoryError } from "../../src/domain/runtime/errors.js";
import {
  nativeFunction,
  type RuntimeBoundMethod,
  type RuntimeClass,
  type RuntimeInstance,
  type RuntimeIterator,
  type RuntimeValue,
} from "../../src/domain/runtime/value.js";

interface TestHeapRoots {
  readonly globals: Map<string, RuntimeValue>;
  readonly roots: PythonHeapRoots;
  readonly stack: RuntimeValue[];
}

function roots(): TestHeapRoots {
  const globals = new Map<string, RuntimeValue>();
  const stack: RuntimeValue[] = [];
  return {
    globals,
    roots: {
      frames: [{ globals, locals: globals }],
      moduleNamespaces: [] as Map<string, RuntimeValue>[],
      stack,
    },
    stack,
  };
}

describe("PythonHeapAccounting", (): void => {
  it("rejects a reachable graph above the pre-admitted managed quota", (): void => {
    const state = roots();
    const accounting = new PythonHeapAccounting({
      maxBytes: 400,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    const value = "x".repeat(300);
    state.stack.push(value);

    expect(() => accounting.noteRuntimeValue(value)).toThrow(VmMemoryError);
  });

  it("reclaims unreachable values when allocation pressure triggers a rescan", (): void => {
    const state = roots();
    const accounting = new PythonHeapAccounting({
      maxBytes: 500,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    const first = "x".repeat(300);
    state.globals.set("value", first);
    accounting.noteRuntimeValue(first);

    state.globals.set("value", null);
    const second = "y".repeat(300);
    state.globals.set("other", second);
    accounting.noteRuntimeValue(second);

    expect(accounting.usageBytes).toBeLessThanOrEqual(500);
  });

  it("measures shared objects once from deterministic roots", (): void => {
    const state = roots();
    const shared: RuntimeValue = { kind: "list", values: ["payload"] };
    state.globals.set("left", shared);
    state.globals.set("right", shared);
    const sharedAccounting = new PythonHeapAccounting({
      maxBytes: 10_000,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    const sharedBytes = sharedAccounting.usageBytes;

    state.globals.set("right", { kind: "list", values: ["payload"] });
    expect(sharedAccounting.usageBytes).toBeGreaterThan(sharedBytes);
  });

  it("expands managed metadata only from reachable function objects", (): void => {
    const state = roots();
    const hidden = "captured".repeat(20);
    const callable = nativeFunction("closure", (): RuntimeValue => null);
    const accounting = new PythonHeapAccounting({
      managedChildren: (value): readonly RuntimeValue[] =>
        value === callable ? [hidden] : [],
      maxBytes: 10_000,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    const baseline = accounting.usageBytes;

    state.globals.set("callable", callable);
    const reachable = accounting.usageBytes;
    expect(reachable).toBeGreaterThan(baseline + hidden.length);

    state.globals.delete("callable");
    expect(accounting.usageBytes).toBe(baseline);
  });

  it("measures canonical set keys and their reachable values", (): void => {
    const state = roots();
    const accounting = new PythonHeapAccounting({
      maxBytes: 10_000,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    const baseline = accounting.usageBytes;
    state.globals.set("values", {
      entries: new Map<string, RuntimeValue>([
        ["S7:payload", "payload"],
        ["T2[I1;I2;]", { kind: "tuple", values: [1, 2] }],
      ]),
      kind: "set",
    });

    expect(accounting.usageBytes).toBeGreaterThan(baseline);
    state.globals.delete("values");
    expect(accounting.usageBytes).toBe(baseline);
  });

  it("measures class, instance, and bound-method graphs once", (): void => {
    const state = roots();
    const accounting = new PythonHeapAccounting({
      maxBytes: 10_000,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    const baseline = accounting.usageBytes;
    const callable = nativeFunction("read", (): RuntimeValue => null);
    const mro: RuntimeClass[] = [];
    const classObject: RuntimeClass = {
      base: null,
      bases: [],
      basesValue: { kind: "tuple", values: [] },
      kind: "class",
      mro,
      mroValue: { kind: "tuple", values: mro },
      name: "Example",
      values: new Map([["read", callable]]),
    };
    mro.push(classObject);
    const instance: RuntimeInstance = {
      classObject,
      kind: "instance",
      values: new Map([["payload", "value"]]),
    };
    const method: RuntimeBoundMethod = {
      callable,
      kind: "bound_method",
      receiver: instance,
    };
    state.globals.set("class", classObject);
    state.globals.set("instance", instance);
    state.globals.set("method", method);

    expect(accounting.usageBytes).toBeGreaterThan(baseline);
    state.globals.clear();
    expect(accounting.usageBytes).toBe(baseline);
  });

  it("retains iterator cursor values only while the iterator is reachable", (): void => {
    const state = roots();
    const accounting = new PythonHeapAccounting({
      maxBytes: 10_000,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    const baseline = accounting.usageBytes;
    const iterator: RuntimeIterator = {
      index: 1,
      kind: "iterator",
      values: ["consumed", "retained"],
    };
    state.globals.set("cursor", iterator);

    expect(accounting.usageBytes).toBeGreaterThan(baseline);
    state.globals.delete("cursor");
    expect(accounting.usageBytes).toBe(baseline);
  });

  it("rejects an invalid quota before observing roots", (): void => {
    let rootsRead = false;
    expect(
      () =>
        new PythonHeapAccounting({
          maxBytes: 0,
          readRoots: (): PythonHeapRoots => {
            rootsRead = true;
            return roots().roots;
          },
        }),
    ).toThrow(RangeError);
    expect(rootsRead).toBe(false);

    const state = roots();
    const accounting = new PythonHeapAccounting({
      maxBytes: 1_000,
      readRoots: (): PythonHeapRoots => state.roots,
    });
    expect(() => accounting.noteAllocation(-1)).toThrow(RangeError);
    expect(() => accounting.noteAllocation(Number.NaN)).toThrow(RangeError);
  });
});
