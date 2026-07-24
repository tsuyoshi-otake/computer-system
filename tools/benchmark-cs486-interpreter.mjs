import { build } from "esbuild";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  instantiateCs486WasmBatchExecutor,
  readCs486WasmArtifactBytes,
} from "./cs486-wasm-batch-executor-loader.mjs";

const cpuModels = Object.freeze(["cs386sx", "cs486dx", "cs486dx2"]);
const defaultInstructionCount = 2_000_000;
const defaultSamples = 7;
const minimumInstructionCount = 10_000;
const maximumInstructionCount = 50_000_000;
const minimumSamples = 3;
const maximumSamples = 31;
const executionModes = Object.freeze(["cpu-slice", "instruction-slice"]);
const instrumentationModes = Object.freeze(["enabled", "disabled"]);
const defaultEngine = "ts";
const defaultCorpus = "alu-branch";
export const benchmarkEngines = Object.freeze(["ts", "wasm-rust", "wasm-as"]);
export const benchmarkCorpora = Object.freeze([
  "alu-branch",
  "mem-stack",
  "hosted-c-mid",
]);

export function parseBenchmarkArguments(arguments_) {
  const options = {
    corpus: defaultCorpus,
    engine: defaultEngine,
    executionMode: "instruction-slice",
    instrumentation: "enabled",
    instructionCount: defaultInstructionCount,
    samples: defaultSamples,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--instructions") {
      options.instructionCount = boundedInteger(
        arguments_[index + 1],
        minimumInstructionCount,
        maximumInstructionCount,
        "instructions",
      );
      index += 1;
    } else if (argument === "--samples") {
      options.samples = boundedInteger(
        arguments_[index + 1],
        minimumSamples,
        maximumSamples,
        "samples",
      );
      index += 1;
    } else if (argument === "--mode") {
      const executionMode = arguments_[index + 1];
      if (!executionModes.includes(executionMode))
        throw new Error(`mode must be one of ${executionModes.join(", ")}`);
      options.executionMode = executionMode;
      index += 1;
    } else if (argument === "--instrumentation") {
      options.instrumentation = enumValue(
        arguments_[index + 1],
        instrumentationModes,
        "instrumentation",
      );
      index += 1;
    } else if (argument === "--engine") {
      options.engine = enumValue(
        arguments_[index + 1],
        benchmarkEngines,
        "engine",
      );
      index += 1;
    } else if (argument === "--corpus") {
      options.corpus = enumValue(
        arguments_[index + 1],
        benchmarkCorpora,
        "corpus",
      );
      index += 1;
    } else {
      throw new Error(`Unknown benchmark argument ${String(argument)}`);
    }
  }
  return Object.freeze(options);
}

export async function benchmarkCs486Interpreter(options) {
  const instrumentation = enumValue(
    options.instrumentation ?? "enabled",
    instrumentationModes,
    "instrumentation",
  );
  const engine = enumValue(
    options.engine ?? defaultEngine,
    benchmarkEngines,
    "engine",
  );
  const corpus = enumValue(
    options.corpus ?? defaultCorpus,
    benchmarkCorpora,
    "corpus",
  );
  const measure = await loadCs486BenchmarkEngine(engine, corpus);
  const results = [];
  for (const cpuModel of cpuModels) {
    measure(
      cpuModel,
      Math.min(100_000, options.instructionCount),
      options.executionMode,
      instrumentation,
    );
    measure(
      cpuModel,
      Math.min(100_000, options.instructionCount),
      options.executionMode,
      instrumentation,
    );
    const samples = [];
    for (let index = 0; index < options.samples; index += 1)
      samples.push(
        measure(
          cpuModel,
          options.instructionCount,
          options.executionMode,
          instrumentation,
        ),
      );
    assertDeterministicSamples(samples);
    const elapsed = samples.map((sample) => sample.elapsedNanoseconds);
    const cpu = samples.map((sample) => sample.cpuMicroseconds);
    const representative = samples[0];
    results.push(
      Object.freeze({
        cpuModel,
        guestCycles: representative.guestCycles,
        guestRamSha256: representative.guestRamSha256,
        hasPendingCpuCycles: representative.hasPendingCpuCycles,
        hostCpuMicroseconds: summarize(cpu),
        hostElapsedNanoseconds: summarize(elapsed),
        hostInstructionsPerSecond:
          (representative.executedInstructions * 1_000_000_000) /
          median(elapsed),
        instructionPointer: representative.instructionPointer,
        instructionsPerSample: representative.executedInstructions,
        microarchitecture: representative.microarchitecture,
        output: representative.output,
        processState: representative.processState,
        registerChecksum: representative.registerChecksum,
        registers: representative.registers,
      }),
    );
  }
  return Object.freeze({
    benchmark:
      options.executionMode === "instruction-slice"
        ? "cs486-interpreter-host-throughput-v1"
        : "cs486-cpu-slice-host-throughput-v1",
    boundary:
      "Host implementation throughput only; guestCycles are modeled guest cost and host timers do not define guest speed.",
    // The historical default run keeps its exact issue-16 report shape;
    // engine/corpus identification appears only for the new A/B selections.
    ...(engine === defaultEngine && corpus === defaultCorpus
      ? {}
      : { corpus, engine }),
    executionMode: options.executionMode,
    instrumentation,
    instructionCount: options.instructionCount,
    node: process.version,
    results: Object.freeze(results),
    samples: options.samples,
  });
}

export function summarize(values) {
  if (!Array.isArray(values) || values.length === 0)
    throw new RangeError("summary requires at least one sample");
  return Object.freeze({
    median: median(values),
    p95: percentile(values, 0.95),
  });
}

export function assertDeterministicSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0)
    throw new RangeError(
      "deterministic comparison requires at least one sample",
    );
  const expectedCommon = deterministicCommonSampleFields(samples[0]);
  const expectedMicroarchitectureByMode = new Map();
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const instrumentation = sampleInstrumentationMode(sample, index);
    const actualCommon = deterministicCommonSampleFields(sample);
    if (!isDeepStrictEqual(actualCommon, expectedCommon))
      throw new Error(
        `benchmark sample ${String(index + 1)} changed deterministic guest results`,
      );
    if (expectedMicroarchitectureByMode.has(instrumentation)) {
      if (
        !isDeepStrictEqual(
          sample.microarchitecture,
          expectedMicroarchitectureByMode.get(instrumentation),
        )
      )
        throw new Error(
          `benchmark sample ${String(index + 1)} changed deterministic guest results`,
        );
    } else {
      expectedMicroarchitectureByMode.set(
        instrumentation,
        sample.microarchitecture,
      );
    }
  }
}

function deterministicCommonSampleFields(sample) {
  return {
    executedInstructions: sample.executedInstructions,
    guestCycles: sample.guestCycles,
    guestRamSha256: sample.guestRamSha256,
    hasPendingCpuCycles: sample.hasPendingCpuCycles,
    instructionPointer: sample.instructionPointer,
    output: sample.output,
    processState: sample.processState,
    registerChecksum: sample.registerChecksum,
    registers: sample.registers,
  };
}

function sampleInstrumentationMode(sample, index) {
  if (sample.instrumentation === undefined) return "legacy";
  const instrumentation = enumValue(
    sample.instrumentation,
    instrumentationModes,
    `benchmark sample ${String(index + 1)} instrumentation`,
  );
  if (
    instrumentation === "enabled" &&
    (sample.microarchitecture === null ||
      sample.microarchitecture === undefined)
  )
    throw new Error(
      `benchmark sample ${String(index + 1)} enabled instrumentation without microarchitecture counters`,
    );
  if (instrumentation === "disabled" && sample.microarchitecture !== null)
    throw new Error(
      `benchmark sample ${String(index + 1)} disabled instrumentation with microarchitecture counters`,
    );
  return instrumentation;
}

function median(values) {
  return percentile(values, 0.5);
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}

function boundedInteger(raw, minimum, maximum, label) {
  if (raw === undefined || !/^[0-9]+$/u.test(raw))
    throw new Error(`${label} must be an integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(
      `${label} must be between ${String(minimum)} and ${String(maximum)}`,
    );
  return value;
}

function enumValue(raw, values, label) {
  if (!values.includes(raw))
    throw new Error(`${label} must be one of ${values.join(", ")}`);
  return raw;
}

/**
 * Resolves the sample-measuring function for an engine/corpus pair. The
 * default pair reproduces the legacy entry byte-for-byte; wasm engines
 * require `npm run build:cs486-wasm` artifacts and fail loudly otherwise.
 */
export async function loadCs486BenchmarkEngine(
  engine = defaultEngine,
  corpus = defaultCorpus,
) {
  enumValue(engine, benchmarkEngines, "engine");
  enumValue(corpus, benchmarkCorpora, "corpus");
  if (engine === "ts") {
    if (corpus === defaultCorpus) {
      const module = await bundleBenchmarkModule(
        "cs486-interpreter-benchmark-entry.ts",
      );
      return module.measureCs486InterpreterSample;
    }
    const module = await bundleBenchmarkModule(
      "wasm-engines/ts-engine-entry.ts",
    );
    return module.createCs486BenchmarkMeasure(corpus);
  }
  const variant = engine === "wasm-rust" ? "rust" : "as";
  const module = await bundleBenchmarkModule(
    `wasm-engines/${variant}-engine-entry.ts`,
  );
  const artifactBytes = await readCs486WasmArtifactBytes(variant);
  const { exports, memory } = await instantiateCs486WasmBatchExecutor(
    artifactBytes,
    module.cs486WasmRequiredExports,
  );
  return module.createCs486WasmBenchmarkMeasure(exports, memory, corpus);
}

async function bundleBenchmarkModule(relativeEntryPath) {
  const result = await build({
    bundle: true,
    entryPoints: [fileURLToPath(new URL(relativeEntryPath, import.meta.url))],
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
  const options = parseBenchmarkArguments(process.argv.slice(2));
  const result = await benchmarkCs486Interpreter(options);
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
}
