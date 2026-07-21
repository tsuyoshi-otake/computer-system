import { VmMemoryError } from "../../../domain/runtime/errors.js";
import type { RuntimeValue } from "../../../domain/runtime/value.js";
import { utf8ByteLength } from "../../../domain/text/utf8.js";
import { pythonIntegerStorageBytes } from "./numeric.js";

export interface PythonHeapFrameRoots {
  readonly globals: Map<string, RuntimeValue>;
  readonly locals: Map<string, RuntimeValue>;
}

export interface PythonHeapRoots {
  readonly additionalValues?: readonly RuntimeValue[];
  readonly frames: readonly PythonHeapFrameRoots[];
  readonly moduleNamespaces: readonly Map<string, RuntimeValue>[];
  readonly stack: readonly RuntimeValue[];
}

export interface PythonHeapAccountingOptions {
  readonly managedChildren?: (value: RuntimeValue) => readonly RuntimeValue[];
  readonly maxBytes: number;
  readonly readRoots: () => PythonHeapRoots;
}

/**
 * Tracks the reachable host-managed Python value graph inside one pre-admitted
 * CS486 process reservation.
 *
 * GuestRamLedger (through GuestProcessMemoryGrant) owns the physical process
 * lease. This class owns only the internal managed-heap quota, so it must never
 * acquire a second RAM lease for the same bytes.
 */
export class PythonHeapAccounting {
  private allocationPressureBytes = 0;
  private usageBytesValue: number;

  constructor(private readonly options: PythonHeapAccountingOptions) {
    if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive safe integer");
    }
    this.usageBytesValue = this.measureReachableBytes();
    this.checkMemory();
  }

  get usageBytes(): number {
    this.usageBytesValue = this.measureReachableBytes();
    this.allocationPressureBytes = 0;
    return this.usageBytesValue;
  }

  noteRuntimeValue(value: RuntimeValue): void {
    if (typeof value === "bigint") {
      this.noteAllocation(pythonIntegerStorageBytes(value));
    } else if (typeof value === "string") {
      this.noteAllocation(16 + utf8ByteLength(value));
    } else if (isSequence(value)) {
      this.noteAllocation(32 + value.values.length * 8);
    } else if (isDictionary(value)) {
      this.noteAllocation(48 + value.entries.size * 24);
    } else if (isSet(value)) {
      this.noteAllocation(
        40 +
          [...value.entries.keys()].reduce(
            (bytes, key) => bytes + utf8ByteLength(key) + 16,
            0,
          ),
      );
    }
  }

  noteAllocation(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      throw new RangeError("bytes must be a nonnegative safe integer");
    }
    this.allocationPressureBytes += bytes;
    if (
      this.usageBytesValue + this.allocationPressureBytes >
      this.options.maxBytes
    ) {
      this.usageBytesValue = this.measureReachableBytes();
      this.allocationPressureBytes = 0;
      this.checkMemory();
    }
  }

  preflightAdditionalValue(value: RuntimeValue, additionalBytes = 0): void {
    this.preflightAdditionalValues([value], additionalBytes);
  }

  preflightAdditionalValues(
    values: readonly RuntimeValue[],
    additionalBytes = 0,
  ): void {
    if (!Number.isSafeInteger(additionalBytes) || additionalBytes < 0) {
      throw new RangeError(
        "additionalBytes must be a nonnegative safe integer",
      );
    }
    const projectedBytes = this.measureReachableBytes(values) + additionalBytes;
    if (projectedBytes > this.options.maxBytes) throw new VmMemoryError();
    this.usageBytesValue = projectedBytes;
    this.allocationPressureBytes = 0;
  }

  private checkMemory(): void {
    if (
      this.usageBytesValue + this.allocationPressureBytes >
      this.options.maxBytes
    ) {
      throw new VmMemoryError();
    }
  }

  private measureReachableBytes(
    transientValues: readonly RuntimeValue[] = [],
  ): number {
    const roots = this.options.readRoots();
    const seenObjects = new Set<object>();
    const seenMaps = new Set<Map<string, RuntimeValue>>();
    let bytes = 32 + roots.stack.length * 8 + roots.frames.length * 32;
    const measureMap = (values: Map<string, RuntimeValue>): void => {
      if (seenMaps.has(values)) return;
      seenMaps.add(values);
      bytes += 32;
      for (const [name, value] of values) {
        bytes += utf8ByteLength(name) + 16;
        bytes += estimateRuntimeValue(
          value,
          seenObjects,
          this.options.managedChildren,
        );
      }
    };
    for (const value of roots.stack) {
      bytes += estimateRuntimeValue(
        value,
        seenObjects,
        this.options.managedChildren,
      );
    }
    for (const value of roots.additionalValues ?? []) {
      bytes += estimateRuntimeValue(
        value,
        seenObjects,
        this.options.managedChildren,
      );
    }
    for (const value of transientValues) {
      bytes += estimateRuntimeValue(
        value,
        seenObjects,
        this.options.managedChildren,
      );
    }
    for (const frame of roots.frames) {
      measureMap(frame.locals);
      measureMap(frame.globals);
    }
    for (const namespace of roots.moduleNamespaces) measureMap(namespace);
    return bytes;
  }
}

function estimateRuntimeValue(
  value: RuntimeValue,
  seen: Set<object>,
  managedChildren:
    ((value: RuntimeValue) => readonly RuntimeValue[]) | undefined,
): number {
  if (typeof value === "bigint") return pythonIntegerStorageBytes(value);
  if (typeof value === "string") return 16 + utf8ByteLength(value);
  if (typeof value !== "object" || value === null) return 8;
  if (seen.has(value)) return 8;
  seen.add(value);
  switch (value.kind) {
    case "list":
    case "tuple":
    case "iterator": {
      let bytes = 32 + value.values.length * 8;
      for (const item of value.values) {
        bytes += estimateRuntimeValue(item, seen, managedChildren);
      }
      return bytes;
    }
    case "dictionary": {
      let bytes = 48 + value.entries.size * 24;
      for (const [key, item] of value.entries) {
        bytes += estimateRuntimeValue(key, seen, managedChildren);
        bytes += estimateRuntimeValue(item, seen, managedChildren);
      }
      return bytes;
    }
    case "set": {
      let bytes = 40;
      for (const [key, item] of value.entries) {
        bytes += utf8ByteLength(key) + 16;
        bytes += estimateRuntimeValue(item, seen, managedChildren);
      }
      return bytes;
    }
    case "class": {
      let bytes = 80 + utf8ByteLength(value.name);
      bytes += estimateRuntimeValue(value.basesValue, seen, managedChildren);
      bytes += estimateRuntimeValue(value.mroValue, seen, managedChildren);
      for (const [name, item] of value.values) {
        bytes += utf8ByteLength(name) + 16;
        bytes += estimateRuntimeValue(item, seen, managedChildren);
      }
      for (const child of managedChildren?.(value) ?? []) {
        bytes += 8 + estimateRuntimeValue(child, seen, managedChildren);
      }
      return bytes;
    }
    case "instance": {
      let bytes =
        48 + estimateRuntimeValue(value.classObject, seen, managedChildren);
      for (const [name, item] of value.values) {
        bytes += utf8ByteLength(name) + 16;
        bytes += estimateRuntimeValue(item, seen, managedChildren);
      }
      return bytes;
    }
    case "bound_method":
      return (
        48 +
        estimateRuntimeValue(value.callable, seen, managedChildren) +
        estimateRuntimeValue(value.receiver, seen, managedChildren)
      );
    case "async_generator":
    case "coroutine":
    case "generator": {
      const children = managedChildren?.(value) ?? [];
      let bytes = 64 + utf8ByteLength(value.name) + children.length * 8;
      for (const child of children) {
        bytes += estimateRuntimeValue(child, seen, managedChildren);
      }
      return bytes;
    }
    case "async_generator_operation": {
      let bytes =
        56 + estimateRuntimeValue(value.generator, seen, managedChildren);
      for (const argument of value.arguments) {
        bytes += estimateRuntimeValue(argument, seen, managedChildren);
      }
      return bytes;
    }
    case "sequence_iterator": {
      const children = managedChildren?.(value) ?? [value.sequence];
      let bytes = 48 + children.length * 8;
      for (const child of children) {
        bytes += estimateRuntimeValue(child, seen, managedChildren);
      }
      return bytes;
    }
    case "namespace": {
      let bytes = 48 + utf8ByteLength(value.name);
      for (const [name, item] of value.values) {
        bytes += utf8ByteLength(name) + 16;
        bytes += estimateRuntimeValue(item, seen, managedChildren);
      }
      for (const child of managedChildren?.(value) ?? []) {
        bytes += 8 + estimateRuntimeValue(child, seen, managedChildren);
      }
      return bytes;
    }
    case "native_function": {
      const children = managedChildren?.(value) ?? [];
      let bytes = 48 + utf8ByteLength(value.name) + children.length * 8;
      for (const child of children) {
        bytes += estimateRuntimeValue(child, seen, managedChildren);
      }
      return bytes;
    }
  }
}

function isSequence(
  value: RuntimeValue,
): value is Extract<
  RuntimeValue,
  { readonly values: readonly RuntimeValue[] }
> {
  return (
    typeof value === "object" &&
    value !== null &&
    ["iterator", "list", "tuple"].includes(value.kind)
  );
}

function isDictionary(
  value: RuntimeValue,
): value is Extract<RuntimeValue, { readonly kind: "dictionary" }> {
  return (
    typeof value === "object" && value !== null && value.kind === "dictionary"
  );
}

function isSet(
  value: RuntimeValue,
): value is Extract<RuntimeValue, { readonly kind: "set" }> {
  return typeof value === "object" && value !== null && value.kind === "set";
}
