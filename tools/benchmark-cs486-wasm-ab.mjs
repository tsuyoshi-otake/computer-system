import os from "node:os";
import { isDeepStrictEqual } from "node:util";
import { pathToFileURL } from "node:url";

import {
  assertDeterministicSamples,
  benchmarkCorpora,
  benchmarkEngines,
  loadCs486BenchmarkEngine,
  summarize,
} from "./benchmark-cs486-interpreter.mjs";

/**
 * Full A/B benchmark matrix for the Issue #106 wasm batch-executor
 * prototype: engines x corpora x CPU models x instrumentation. Every sample
 * cycle rotates the engine order (`sampleIndex % engines`) so warm-up and
 * scheduler drift cannot systematically favor one engine, and every cell
 * cross-checks the deterministic guest results between the TS reference and
 * each wasm engine before any timing is reported. Missing wasm artifacts
 * fail loudly through the shared loader; build them with
 * `npm run build:cs486-wasm` first.
 */
const cpuModels = Object.freeze(["cs386sx", "cs486dx", "cs486dx2"]);
const executionModes = Object.freeze(["cpu-slice", "instruction-slice"]);
const instrumentationModes = Object.freeze(["enabled", "disabled"]);
const defaultInstructionCount = 2_000_000;
const defaultSamples = 21;
const minimumInstructionCount = 10_000;
const maximumInstructionCount = 50_000_000;
const minimumSamples = 3;
const maximumSamples = 63;
const warmupInstructionCap = 100_000;

export function parseAbArguments(arguments_) {
  const options = {
    corpora: [...benchmarkCorpora],
    cpuModels: [...cpuModels],
    engines: [...benchmarkEngines],
    executionMode: "instruction-slice",
    instructionCount: defaultInstructionCount,
    instrumentationModes: [...instrumentationModes],
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
      options.executionMode = enumValue(
        arguments_[index + 1],
        executionModes,
        "mode",
      );
      index += 1;
    } else if (argument === "--corpus") {
      options.corpora = enumList(
        arguments_[index + 1],
        benchmarkCorpora,
        "corpus",
      );
      index += 1;
    } else if (argument === "--cpu") {
      options.cpuModels = enumList(arguments_[index + 1], cpuModels, "cpu");
      index += 1;
    } else if (argument === "--engines") {
      options.engines = enumList(
        arguments_[index + 1],
        benchmarkEngines,
        "engines",
      );
      index += 1;
    } else if (argument === "--instrumentation") {
      options.instrumentationModes = enumList(
        arguments_[index + 1],
        instrumentationModes,
        "instrumentation",
      );
      index += 1;
    } else {
      throw new Error(`Unknown A/B benchmark argument ${String(argument)}`);
    }
  }
  return Object.freeze(options);
}

export async function runCs486WasmAbBenchmark(options) {
  const cells = [];
  for (const corpus of options.corpora) {
    const measures = new Map();
    for (const engine of options.engines)
      measures.set(engine, await loadCs486BenchmarkEngine(engine, corpus));
    for (const cpuModel of options.cpuModels) {
      for (const instrumentation of options.instrumentationModes) {
        cells.push(
          measureCell({ corpus, cpuModel, instrumentation }, measures, options),
        );
      }
    }
  }
  return Object.freeze({
    arch: process.arch,
    boundary:
      "Host implementation throughput only; guestCycles are modeled guest cost and host timers do not define guest speed.",
    cells: Object.freeze(cells),
    executionMode: options.executionMode,
    hostCpuModel: os.cpus()[0]?.model ?? "unknown",
    instructionCount: options.instructionCount,
    markdownTable: renderMarkdownTable(cells, options),
    node: process.version,
    platform: process.platform,
    samplesPerEngine: options.samples,
    tool: "benchmark-cs486-wasm-ab-v1",
  });
}

/**
 * Runs one matrix cell: warm every engine, then interleave samples in a
 * rotating engine order so no engine always runs first or last. The guest
 * results must be deterministic within each engine and bit-identical across
 * engines before medians are reported.
 */
function measureCell(cell, measures, options) {
  const warmupInstructions = Math.min(
    warmupInstructionCap,
    options.instructionCount,
  );
  for (const measure of measures.values()) {
    measure(
      cell.cpuModel,
      warmupInstructions,
      options.executionMode,
      cell.instrumentation,
    );
    measure(
      cell.cpuModel,
      warmupInstructions,
      options.executionMode,
      cell.instrumentation,
    );
  }
  const samplesByEngine = new Map(
    options.engines.map((engine) => [engine, []]),
  );
  for (let sampleIndex = 0; sampleIndex < options.samples; sampleIndex += 1) {
    for (const engine of rotate(options.engines, sampleIndex)) {
      samplesByEngine
        .get(engine)
        .push(
          measures.get(engine)(
            cell.cpuModel,
            options.instructionCount,
            options.executionMode,
            cell.instrumentation,
          ),
        );
    }
  }
  const engineResults = [];
  let tsMedianNanoseconds;
  let referenceGuestResult;
  for (const engine of options.engines) {
    const samples = samplesByEngine.get(engine);
    assertDeterministicSamples(samples);
    const guestResult = deterministicGuestResult(samples[0]);
    if (referenceGuestResult === undefined) {
      referenceGuestResult = guestResult;
    } else if (!isDeepStrictEqual(guestResult, referenceGuestResult)) {
      throw new Error(
        `engine ${engine} diverged from ${options.engines[0]} guest results in cell ${cell.corpus}/${cell.cpuModel}/${cell.instrumentation}`,
      );
    }
    const elapsed = samples.map((sample) => sample.elapsedNanoseconds);
    const medianNanoseconds = summarize(elapsed).median;
    if (engine === "ts") tsMedianNanoseconds = medianNanoseconds;
    engineResults.push({
      engine,
      hostCpuMicroseconds: summarize(
        samples.map((sample) => sample.cpuMicroseconds),
      ),
      hostElapsedNanoseconds: summarize(elapsed),
      hostInstructionsPerSecond:
        (samples[0].executedInstructions * 1_000_000_000) / medianNanoseconds,
    });
  }
  for (const result of engineResults)
    result.speedupVsTs =
      tsMedianNanoseconds === undefined
        ? null
        : tsMedianNanoseconds / result.hostElapsedNanoseconds.median;
  return Object.freeze({
    ...cell,
    engines: Object.freeze(
      engineResults.map((result) => Object.freeze(result)),
    ),
    executedInstructions: referenceGuestResult.executedInstructions,
    guestCycles: referenceGuestResult.guestCycles,
    guestRamSha256: referenceGuestResult.guestRamSha256,
    registerChecksum: referenceGuestResult.registerChecksum,
  });
}

function deterministicGuestResult(sample) {
  return {
    executedInstructions: sample.executedInstructions,
    guestCycles: sample.guestCycles,
    guestRamSha256: sample.guestRamSha256,
    hasPendingCpuCycles: sample.hasPendingCpuCycles,
    instructionPointer: sample.instructionPointer,
    microarchitecture: sample.microarchitecture,
    output: sample.output,
    processState: sample.processState,
    registerChecksum: sample.registerChecksum,
    registers: sample.registers,
  };
}

function rotate(values, offset) {
  const shift = offset % values.length;
  return [...values.slice(shift), ...values.slice(0, shift)];
}

function renderMarkdownTable(cells, options) {
  const header = ["| Corpus | CPU | Stats |", "| --- | --- | --- |"];
  const engineColumns = options.engines
    .map((engine) => ` ${engine} median ms (p95) | ${engine} vs ts |`)
    .join("");
  header[0] = `| Corpus | CPU | Stats |${engineColumns}`;
  header[1] = `| --- | --- | --- |${options.engines.map(() => " --- | --- |").join("")}`;
  const rows = cells.map((cell) => {
    const engineFields = cell.engines
      .map((result) => {
        const medianMs = result.hostElapsedNanoseconds.median / 1_000_000;
        const p95Ms = result.hostElapsedNanoseconds.p95 / 1_000_000;
        const speedup =
          result.speedupVsTs === null
            ? "n/a"
            : `${result.speedupVsTs.toFixed(2)}x`;
        return ` ${medianMs.toFixed(2)} (${p95Ms.toFixed(2)}) | ${speedup} |`;
      })
      .join("");
    return `| ${cell.corpus} | ${cell.cpuModel} | ${cell.instrumentation} |${engineFields}`;
  });
  return [...header, ...rows].join("\n");
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

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  const options = parseAbArguments(process.argv.slice(2));
  const report = await runCs486WasmAbBenchmark(options);
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
}
