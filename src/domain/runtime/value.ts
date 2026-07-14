export type RuntimeValue =
  | boolean
  | null
  | number
  | string
  | RuntimeDictionary
  | RuntimeIterator
  | RuntimeList
  | RuntimeNamespace
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
