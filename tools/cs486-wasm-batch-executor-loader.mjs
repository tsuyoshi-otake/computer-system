import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Zero-import loader for the gated Issue #106 CS486 wasm batch-executor
 * prototype artifacts. Both language variants must instantiate against an
 * empty import object and export their own linear memory; the caller passes
 * the required export list from the shared ABI module so this loader never
 * duplicates ABI truth. Host tooling only; nothing here ships in the pack.
 */
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const wasmPageBytes = 65_536;

export const cs486WasmVariantNames = ["rust", "as"];

export function resolveCs486WasmArtifactPath(variant) {
  if (!cs486WasmVariantNames.includes(variant))
    throw new RangeError(
      `unknown cs486 wasm variant ${String(variant)}; expected one of: ${cs486WasmVariantNames.join(", ")}`,
    );
  return path.join(
    repositoryRoot,
    "wasm",
    "dist",
    `cs486-batch-executor.${variant}.wasm`,
  );
}

/** Reads a built artifact; a missing build fails loudly, never silently. */
export async function readCs486WasmArtifactBytes(variant) {
  const artifactPath = resolveCs486WasmArtifactPath(variant);
  try {
    return await readFile(artifactPath);
  } catch (error) {
    throw new Error(
      `missing cs486 wasm artifact ${artifactPath}; run "npm run build:cs486-wasm" first (${describeError(error)})`,
    );
  }
}

/**
 * Instantiates a variant with zero imports and validates the export surface.
 * `requiredExportNames` comes from `cs486WasmRequiredExports` in the ABI
 * module (bundled TS callers) so both variants are held to one contract.
 */
export async function instantiateCs486WasmBatchExecutor(
  wasmBytes,
  requiredExportNames,
) {
  if (!Array.isArray(requiredExportNames) || requiredExportNames.length === 0)
    throw new RangeError("required export names must be a non-empty array");
  let instantiated;
  try {
    instantiated = await WebAssembly.instantiate(wasmBytes, {});
  } catch (error) {
    throw new Error(
      `cs486 wasm batch executor rejected zero-import instantiation: ${describeError(error)}`,
    );
  }
  const exports = instantiated.instance.exports;
  for (const name of requiredExportNames) {
    if (!(name in exports))
      throw new Error(
        `cs486 wasm batch executor is missing required export ${name}`,
      );
    if (name !== "memory" && typeof exports[name] !== "function")
      throw new Error(
        `cs486 wasm batch executor export ${name} must be a function`,
      );
  }
  const memory = exports.memory;
  if (!(memory instanceof WebAssembly.Memory))
    throw new Error(
      "cs486 wasm batch executor must export its own linear memory",
    );
  return { exports, instance: instantiated.instance, memory };
}

/** Grows the exported memory to cover the computed layout, if needed. */
export function ensureCs486WasmMemoryCapacity(memory, requiredBytes) {
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0)
    throw new RangeError(
      "required wasm memory bytes must be a non-negative integer",
    );
  const currentBytes = memory.buffer.byteLength;
  if (requiredBytes > currentBytes)
    memory.grow(Math.ceil((requiredBytes - currentBytes) / wasmPageBytes));
  return memory.buffer;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}
