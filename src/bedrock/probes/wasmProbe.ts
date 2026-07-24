declare const __CS_WASM_PROBE__: boolean;

/**
 * Compile-time-only diagnostic for Issue #106 Phase 4: does the Bedrock
 * script engine expose a usable WebAssembly runtime? Production builds
 * define the flag as false, so the probe is removed as dead code. The probe
 * never blocks the wasm adoption gate; it only records in-engine feasibility
 * evidence for `docs/feasibility-matrix.md`.
 */
export function startWasmProbe(): void {
  // Branch directly on the define so probe-free builds drop this whole
  // module body as dead code instead of shipping an inert string.
  if (__CS_WASM_PROBE__) {
    console.warn(`CS_WASM_PROBE result=${JSON.stringify(probeWasmRuntime())}`);
  }
}

/**
 * Bounded one-shot check: report the global's type, then validate,
 * compile, and instantiate the 8-byte empty module through the synchronous
 * WebAssembly API. Every failure path returns an explicit record instead of
 * throwing into the script engine.
 */
function probeWasmRuntime(): Record<string, boolean | string> {
  const emptyWasmModuleBytes = Uint8Array.of(
    0x00,
    0x61,
    0x73,
    0x6d,
    0x01,
    0x00,
    0x00,
    0x00,
  );
  const globalScope = globalThis as { WebAssembly?: unknown };
  const runtimeType = typeof globalScope.WebAssembly;
  if (runtimeType === "undefined") return { available: false, runtimeType };
  try {
    const wasm = globalScope.WebAssembly as {
      Instance: new (module: object, imports: object) => object;
      Module: new (bytes: Uint8Array) => object;
      validate?: (bytes: Uint8Array) => boolean;
    };
    const validated =
      typeof wasm.validate === "function"
        ? wasm.validate(emptyWasmModuleBytes)
        : "validate-missing";
    const module = new wasm.Module(emptyWasmModuleBytes);
    new wasm.Instance(module, {});
    return { available: true, instantiated: true, runtimeType, validated };
  } catch (error) {
    return {
      available: true,
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error),
      instantiated: false,
      runtimeType,
    };
  }
}
