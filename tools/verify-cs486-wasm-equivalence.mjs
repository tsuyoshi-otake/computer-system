import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  cs486WasmVariantNames,
  instantiateCs486WasmBatchExecutor,
  readCs486WasmArtifactBytes,
} from "./cs486-wasm-batch-executor-loader.mjs";

/**
 * Differential-equivalence CLI for the Issue #106 wasm batch executor. It
 * drives the shared suite (deterministic forced cases + seeded fuzz
 * programs) against each requested wasm variant and exits non-zero on the
 * first recorded divergence, so a green run is executable adoption-gate
 * evidence. Missing artifacts fail loudly; build them with
 * `npm run build:cs486-wasm` first.
 */
const cpuModels = Object.freeze(["cs386sx", "cs486dx", "cs486dx2"]);
const executionModes = Object.freeze(["cpu-slice", "instruction-slice"]);
const instrumentationModes = Object.freeze(["enabled", "disabled"]);
const defaultSeedCount = 32;
const maximumSeedCount = 512;
const maximumPrintedDivergences = 50;

export function parseEquivalenceArguments(arguments_) {
  const options = {
    cpuModels: [...cpuModels],
    engines: [...cs486WasmVariantNames],
    executionModes: [...executionModes],
    instrumentationModes: [...instrumentationModes],
    seedCount: defaultSeedCount,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--seeds") {
      const raw = arguments_[index + 1];
      if (raw === undefined || !/^[0-9]+$/u.test(raw))
        throw new Error("seeds must be an integer");
      const value = Number(raw);
      if (!Number.isSafeInteger(value) || value > maximumSeedCount)
        throw new RangeError(
          `seeds must be between 0 and ${String(maximumSeedCount)}`,
        );
      options.seedCount = value;
      index += 1;
    } else if (argument === "--cpu") {
      options.cpuModels = enumList(arguments_[index + 1], cpuModels, "cpu");
      index += 1;
    } else if (argument === "--mode") {
      options.executionModes = enumList(
        arguments_[index + 1],
        executionModes,
        "mode",
      );
      index += 1;
    } else if (argument === "--instrumentation") {
      options.instrumentationModes = enumList(
        arguments_[index + 1],
        instrumentationModes,
        "instrumentation",
      );
      index += 1;
    } else if (argument === "--engines") {
      options.engines = enumList(
        arguments_[index + 1],
        cs486WasmVariantNames,
        "engines",
      );
      index += 1;
    } else {
      throw new Error(`Unknown equivalence argument ${String(argument)}`);
    }
  }
  return Object.freeze(options);
}

function enumList(raw, allowed, label) {
  if (raw === undefined)
    throw new Error(`${label} must list values from ${allowed.join(", ")}`);
  const values = raw.split(",").map((value) => value.trim());
  if (values.length === 0)
    throw new Error(`${label} must list values from ${allowed.join(", ")}`);
  for (const value of values)
    if (!allowed.includes(value))
      throw new Error(`${label} must list values from ${allowed.join(", ")}`);
  return values;
}

/**
 * Runs the suite for every requested engine and returns per-engine reports.
 * Exported so the vitest wrapper reuses the exact CLI code path.
 */
export async function runCs486WasmEquivalence(options) {
  const module = await bundleEquivalenceEntry();
  const reports = [];
  for (const engine of options.engines) {
    const artifactBytes = await readCs486WasmArtifactBytes(engine);
    const { exports, memory } = await instantiateCs486WasmBatchExecutor(
      artifactBytes,
      module.cs486WasmRequiredExports,
    );
    reports.push(
      module.runCs486WasmEquivalenceSuite({ exports, memory }, engine, {
        cpuModels: options.cpuModels,
        executionModes: options.executionModes,
        instrumentationModes: options.instrumentationModes,
        seedCount: options.seedCount,
      }),
    );
  }
  return Object.freeze({
    divergenceCount: reports.reduce(
      (total, report) => total + report.divergences.length,
      0,
    ),
    reports: Object.freeze(reports),
  });
}

async function bundleEquivalenceEntry() {
  const result = await build({
    bundle: true,
    entryPoints: [
      fileURLToPath(
        new URL("verify-cs486-wasm-equivalence-entry.ts", import.meta.url),
      ),
    ],
    format: "esm",
    platform: "node",
    sourcemap: false,
    target: "node24",
    write: false,
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  const options = parseEquivalenceArguments(process.argv.slice(2));
  const { divergenceCount, reports } = await runCs486WasmEquivalence(options);
  const summary = reports.map((report) => ({
    comparisons: report.comparisons,
    configurations: report.configurations,
    divergences: report.divergences.length,
    engine: report.engine,
    programs: report.programs.length,
  }));
  process.stdout.write(
    `${JSON.stringify(
      {
        divergenceCount,
        engines: summary,
        node: process.version,
        seedCount: options.seedCount,
        tool: "verify-cs486-wasm-equivalence-v1",
      },
      undefined,
      2,
    )}\n`,
  );
  if (divergenceCount > 0) {
    const printed = reports
      .flatMap((report) => report.divergences)
      .slice(0, maximumPrintedDivergences);
    for (const divergence of printed)
      process.stderr.write(`DIVERGENCE ${divergence}\n`);
    if (divergenceCount > printed.length)
      process.stderr.write(
        `...and ${String(divergenceCount - printed.length)} more divergences\n`,
      );
    process.exitCode = 1;
  }
}
