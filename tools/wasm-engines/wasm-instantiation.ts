import { cs486WasmRequiredExports } from "../cs486-wasm-batch-executor-abi.js";
import {
  cs486WasmHostRuntime,
  type Cs486WasmHostInstance,
  type Cs486WasmHostMemory,
} from "./wasm-host-runtime.js";
import type { Cs486WasmBatchExecutorExports } from "./wasm-session.js";

/**
 * Synchronous compile/instantiate for hosts that cannot await, notably the
 * managed compute worker whose dispatch loop is synchronous. The async
 * `tools/cs486-wasm-batch-executor-loader.mjs` stays the owner of artifact
 * paths and filesystem reads; this module receives bytes that were already
 * read and never touches the filesystem, so it survives the worker's
 * in-memory esbuild bundle where `import.meta.url` is unusable.
 *
 * Compilation is the expensive step, so callers compile once per worker and
 * instantiate once per guest process: every instance owns its own linear
 * memory, which is what lets one worker host many concurrent sessions.
 */
export interface Cs486WasmInstance {
  readonly exports: Cs486WasmBatchExecutorExports;
  readonly instance: Cs486WasmHostInstance;
  readonly memory: Cs486WasmHostMemory;
}

export function compileCs486WasmModule(
  wasmBytes: Uint8Array,
): WebAssembly.Module {
  if (wasmBytes.byteLength === 0)
    throw new Error("cs486 wasm batch executor bytes are empty");
  try {
    // Artifact bytes always arrive from a file read or a structured clone, so
    // the view is never SharedArrayBuffer-backed.
    return new (cs486WasmHostRuntime().Module)(wasmBytes);
  } catch (error) {
    throw new Error(
      `cs486 wasm batch executor failed to compile: ${describeError(error)}`,
    );
  }
}

/**
 * Instantiates a compiled module with zero imports and validates the export
 * surface against the shared ABI, so a stale artifact fails at startup rather
 * than at the first slice.
 */
export function instantiateCs486WasmModule(
  module: WebAssembly.Module,
): Cs486WasmInstance {
  const runtime = cs486WasmHostRuntime();
  let instance: Cs486WasmHostInstance;
  try {
    instance = new runtime.Instance(module, {});
  } catch (error) {
    throw new Error(
      `cs486 wasm batch executor rejected zero-import instantiation: ${describeError(error)}`,
    );
  }
  const exports = instance.exports;
  for (const name of cs486WasmRequiredExports) {
    if (!(name in exports))
      throw new Error(
        `cs486 wasm batch executor is missing required export ${name}`,
      );
    if (name !== "memory" && typeof exports[name] !== "function")
      throw new Error(
        `cs486 wasm batch executor export ${name} must be a function`,
      );
  }
  const memory = exports["memory"];
  if (!(memory instanceof runtime.Memory))
    throw new Error(
      "cs486 wasm batch executor must export its own linear memory",
    );
  return {
    exports: exports as unknown as Cs486WasmBatchExecutorExports,
    instance,
    memory,
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
