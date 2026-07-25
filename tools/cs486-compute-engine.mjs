/**
 * CPU engine selection for the managed compute worker pool.
 *
 * `typescript` runs the production `Cs486Process` interpreter and is the
 * default; `wasm-rust` runs the Issue #106 Rust batch executor behind the same
 * engine contract. Selection is opt-in configuration, never inference: a
 * selected wasm engine whose artifact is missing must fail companion startup
 * explicitly rather than fall back to the interpreter.
 *
 * `tools/cs486-compute-worker-cpu-engine.ts` owns the TypeScript-side twin of
 * this list, because tsconfig has no `allowJs` and typed callers cannot import
 * this module. `tests/tools/cs486ComputeWorkerPool.test.mjs` proves the two
 * lists agree; add an engine to both or to neither.
 */
export const cs486ComputeEngineNames = ["typescript", "wasm-rust"];

export const defaultCs486ComputeEngine = "typescript";

export function isCs486ComputeEngine(value) {
  return typeof value === "string" && cs486ComputeEngineNames.includes(value);
}

export function assertCs486ComputeEngine(value) {
  if (!isCs486ComputeEngine(value))
    throw new RangeError(
      `unknown CS486 compute engine ${String(value)}; expected one of: ${cs486ComputeEngineNames.join(", ")}`,
    );
  return value;
}

/**
 * Wasm artifact variant backing an engine, or `null` for the interpreter.
 * Variant names come from `tools/cs486-wasm-batch-executor-loader.mjs`.
 */
export function cs486ComputeEngineWasmVariant(engine) {
  assertCs486ComputeEngine(engine);
  return engine === "wasm-rust" ? "rust" : null;
}
