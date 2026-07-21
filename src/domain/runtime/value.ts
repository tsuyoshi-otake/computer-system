export type RuntimeValue =
  | bigint
  | boolean
  | null
  | number
  | string
  | RuntimeDictionary
  | RuntimeBoundMethod
  | RuntimeClass
  | RuntimeCoroutine
  | RuntimeAsyncGenerator
  | RuntimeAsyncGeneratorOperation
  | RuntimeGenerator
  | RuntimeInstance
  | RuntimeIterator
  | RuntimeSequenceIterator
  | RuntimeList
  | RuntimeNamespace
  | RuntimeSet
  | RuntimeTuple
  | NativeFunction;

export interface RuntimeList {
  readonly kind: "list";
  readonly values: RuntimeValue[];
}

export interface RuntimeTuple {
  readonly kind: "tuple";
  readonly values: readonly RuntimeValue[];
}

export interface RuntimeDictionary {
  readonly kind: "dictionary";
  readonly entries: Map<RuntimeValue, RuntimeValue>;
}

export interface RuntimeSet {
  readonly entries: Map<string, RuntimeValue>;
  readonly kind: "set";
}

export interface RuntimeClass {
  readonly base: RuntimeClass | null;
  readonly bases: readonly RuntimeClass[];
  readonly basesValue: RuntimeTuple;
  readonly kind: "class";
  readonly mro: readonly RuntimeClass[];
  readonly mroValue: RuntimeTuple;
  readonly name: string;
  readonly values: Map<string, RuntimeValue>;
}

export interface RuntimeInstance {
  readonly classObject: RuntimeClass;
  readonly kind: "instance";
  readonly values: Map<string, RuntimeValue>;
}

export interface RuntimeBoundMethod {
  readonly callable: NativeFunction;
  readonly kind: "bound_method";
  readonly receiver: RuntimeValue;
}

export interface RuntimeNamespace {
  readonly kind: "namespace";
  readonly name: string;
  readonly values: Map<string, RuntimeValue>;
}

export interface RuntimeIterator {
  readonly kind: "iterator";
  readonly values: readonly RuntimeValue[];
  index: number;
}

export interface RuntimeSequenceIterator {
  exhausted: boolean;
  index: bigint;
  readonly kind: "sequence_iterator";
  readonly sequence: RuntimeInstance;
}

export interface RuntimeGenerator {
  readonly kind: "generator";
  readonly name: string;
  state: "closed" | "created" | "running" | "suspended";
}

export interface RuntimeAsyncGenerator {
  readonly kind: "async_generator";
  readonly name: string;
  state: "closed" | "created" | "running" | "suspended";
}

export interface RuntimeAsyncGeneratorOperation {
  readonly arguments: readonly RuntimeValue[];
  readonly generator: RuntimeAsyncGenerator;
  readonly kind: "async_generator_operation";
  readonly operation: "close" | "next" | "send" | "throw";
  state: "closed" | "created" | "running";
}

export interface RuntimeCoroutine {
  readonly kind: "coroutine";
  readonly name: string;
  state: "closed" | "created" | "running";
}

export interface NativeFunction {
  readonly kind: "native_function";
  readonly name: string;
  readonly call: NativeCall;
}

export type NativeCall = (
  positional: readonly RuntimeValue[],
  keywords: ReadonlyMap<string, RuntimeValue>,
) => RuntimeValue | VmWaitRequest | VmWorkRequest;

export type VmWaitRequest =
  | { readonly kind: "sleep"; readonly ticks: number }
  | { readonly kind: "wait_event"; readonly filter?: string };

export interface VmWorkRequest {
  readonly cycles: number;
  readonly kind: "work";
  readonly value: RuntimeValue;
}

export function namespace(
  name: string,
  values: Readonly<Record<string, RuntimeValue>>,
): RuntimeNamespace {
  return { kind: "namespace", name, values: new Map(Object.entries(values)) };
}

export function nativeFunction(name: string, call: NativeCall): NativeFunction {
  return { kind: "native_function", name, call };
}
