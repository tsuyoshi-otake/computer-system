export interface PythonRuntimeLimits {
  readonly maxCallDepth: number;
  readonly maxCollectionSize: number;
  readonly maxStackSize: number;
  readonly maxStringLength: number;
  readonly maxMemoryBytes?: number;
}

export const defaultPythonRuntimeLimits: PythonRuntimeLimits = {
  maxCallDepth: 64,
  maxCollectionSize: 4_096,
  maxStackSize: 4_096,
  maxStringLength: 65_536,
  maxMemoryBytes: 1_048_576,
};
