/**
 * Minimal typed view of the host WebAssembly runtime.
 *
 * The repository compiles with `lib: ["ES2023"]` and no DOM lib because the
 * Bedrock script engine is not a browser, yet TypeScript still ships the global
 * `WebAssembly` declarations only inside `lib.dom.d.ts`. Adding DOM to satisfy
 * host tooling would hand the shipped pack `document` and `window`, so the wasm
 * engines instead reach the runtime through `globalThis` and narrow it to the
 * few members they use - the same technique `src/bedrock/probes/wasmProbe.ts`
 * already applies on the Bedrock side.
 *
 * `WebAssembly.Module` stays the public handle type: esbuild's bundled ambient
 * declaration provides it as an opaque interface, which is exactly what a
 * compiled module is to every caller here.
 */

/** Exported linear memory of an instantiated batch executor. */
export interface Cs486WasmHostMemory {
  readonly buffer: ArrayBuffer;
  grow(pages: number): number;
}

/** Instantiated module. Export identity is validated against the shared ABI. */
export interface Cs486WasmHostInstance {
  readonly exports: Readonly<Record<string, unknown>>;
}

interface Cs486WasmHostRuntime {
  readonly Instance: new (
    module: WebAssembly.Module,
    imports: Record<string, never>,
  ) => Cs486WasmHostInstance;
  readonly Memory: new (descriptor: {
    readonly initial: number;
  }) => Cs486WasmHostMemory;
  readonly Module: new (bytes: Uint8Array) => WebAssembly.Module;
}

/**
 * Resolves the host runtime, failing explicitly where a host lacks it rather
 * than letting a `TypeError` surface from an unrelated call site.
 */
export function cs486WasmHostRuntime(): Cs486WasmHostRuntime {
  const runtime = (globalThis as { WebAssembly?: unknown }).WebAssembly;
  if (typeof runtime !== "object" || runtime === null)
    throw new Error(
      "host provides no WebAssembly runtime for the CS486 batch executor",
    );
  return runtime as Cs486WasmHostRuntime;
}
