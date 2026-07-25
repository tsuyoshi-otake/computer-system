/**
 * CPU engine selection for the managed compute worker pool.
 *
 * `typescript` runs the production `Cs486Process` interpreter and is the only
 * engine. Issue #115 removed the Rust wasm batch executor, so the selection
 * stays explicit configuration with exactly one accepted value: an unknown
 * name, including the removed `wasm-rust`, must fail companion startup rather
 * than silently fall back to the interpreter.
 *
 * `tools/cs486-compute-worker-cpu-engine.ts` owns the TypeScript-side twin of
 * this list, because tsconfig has no `allowJs` and typed callers cannot import
 * this module. `tests/tools/cs486ComputeWorkerPool.test.mjs` proves the two
 * lists agree; add an engine to both or to neither.
 */
export const cs486ComputeEngineNames = ["typescript"];

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
