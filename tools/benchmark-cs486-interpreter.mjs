import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";

const cpuModels = Object.freeze(["cs386sx", "cs486dx", "cs486dx2"]);
const defaultInstructionCount = 2_000_000;
const defaultSamples = 7;
const minimumInstructionCount = 10_000;
const maximumInstructionCount = 50_000_000;
const minimumSamples = 3;
const maximumSamples = 31;

export function parseBenchmarkArguments(arguments_) {
  const options = {
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
    } else {
      throw new Error(`Unknown benchmark argument ${String(argument)}`);
    }
  }
  return Object.freeze(options);
}

export async function benchmarkCs486Interpreter(options) {
  const measure = await loadBenchmarkEntry();
  const results = [];
  for (const cpuModel of cpuModels) {
    measure(cpuModel, Math.min(100_000, options.instructionCount));
    measure(cpuModel, Math.min(100_000, options.instructionCount));
    const samples = [];
    for (let index = 0; index < options.samples; index += 1)
      samples.push(measure(cpuModel, options.instructionCount));
    const elapsed = samples.map((sample) => sample.elapsedNanoseconds);
    const cpu = samples.map((sample) => sample.cpuMicroseconds);
    const representative = samples[0];
    results.push(
      Object.freeze({
        cpuModel,
        guestCycles: representative.guestCycles,
        hostCpuMicroseconds: summarize(cpu),
        hostElapsedNanoseconds: summarize(elapsed),
        hostInstructionsPerSecond:
          (representative.executedInstructions * 1_000_000_000) /
          median(elapsed),
        instructionsPerSample: representative.executedInstructions,
        registerChecksum: representative.registerChecksum,
      }),
    );
  }
  return Object.freeze({
    benchmark: "cs486-interpreter-host-throughput-v1",
    boundary:
      "Host implementation throughput only; guestCycles are modeled guest cost and host timers do not define guest speed.",
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

async function loadBenchmarkEntry() {
  const result = await build({
    bundle: true,
    entryPoints: [
      fileURLToPath(
        new URL("cs486-interpreter-benchmark-entry.ts", import.meta.url),
      ),
    ],
    format: "esm",
    platform: "node",
    sourcemap: false,
    target: "node24",
    write: false,
  });
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
  return module.measureCs486InterpreterSample;
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
