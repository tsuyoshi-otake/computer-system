/**
 * Rust wasm engine entry for the Issue #106 A/B harness. The variant name
 * selects the `wasm/dist/cs486-batch-executor.rust.wasm` artifact; every
 * other behavior lives in the shared variant-independent core, so a wasm
 * engine differs from another only by module bytes.
 */
export { cs486WasmRequiredExports } from "../cs486-wasm-batch-executor-abi.js";
export {
  createCs486WasmBenchmarkMeasure,
  type Cs486WasmBatchExecutorExports,
} from "./wasm-engine-core.js";

export const cs486WasmVariant = "rust";
