import { createHash } from "node:crypto";
import { availableParallelism } from "node:os";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

import { build } from "esbuild";

import { summarize } from "./benchmark-cs486-interpreter.mjs";

const cpuModels = Object.freeze(["cs386sx", "cs486dx", "cs486dx2"]);
const instrumentationModes = Object.freeze(["disabled", "enabled"]);
const defaultComputers = 10;
const defaultInstructionBudget = 330_000;
const defaultSamples = 21;
const defaultTicks = 10;
const defaultWorkers = 2;
const maximumBenchmarkInstructions = 2_000_000_000;
const maximumComputers = 64;
const maximumInstructionBudget = 1_650_000;
const maximumSamples = 31;
const maximumTicks = 100;
const maximumWorkers = 16;
const minimumComputers = 1;
const minimumInstructionBudget = 10_000;
const minimumSamples = 3;
const minimumTicks = 1;
const minimumWorkers = 1;
const perWorkerInstructionCapacity = 1_650_000;
const workerRequestTimeoutMs = 120_000;
const workerStartupTimeoutMs = 15_000;

export function parseConcurrencyBenchmarkArguments(arguments_) {
  const options = {
    computers: defaultComputers,
    cpuModel: "cs486dx2",
    instructionBudget: defaultInstructionBudget,
    instrumentation: "disabled",
    samples: defaultSamples,
    ticks: defaultTicks,
    workers: defaultWorkers,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--computers") {
      options.computers = boundedInteger(
        arguments_[index + 1],
        minimumComputers,
        maximumComputers,
        "computers",
      );
      index += 1;
    } else if (argument === "--cpu-model") {
      options.cpuModel = enumValue(
        arguments_[index + 1],
        cpuModels,
        "cpu-model",
      );
      index += 1;
    } else if (argument === "--instructions-per-runtime") {
      options.instructionBudget = boundedInteger(
        arguments_[index + 1],
        minimumInstructionBudget,
        maximumInstructionBudget,
        "instructions-per-runtime",
      );
      index += 1;
    } else if (argument === "--instrumentation") {
      options.instrumentation = enumValue(
        arguments_[index + 1],
        instrumentationModes,
        "instrumentation",
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
    } else if (argument === "--ticks") {
      options.ticks = boundedInteger(
        arguments_[index + 1],
        minimumTicks,
        maximumTicks,
        "ticks",
      );
      index += 1;
    } else if (argument === "--workers") {
      options.workers = boundedInteger(
        arguments_[index + 1],
        minimumWorkers,
        maximumWorkers,
        "workers",
      );
      index += 1;
    } else {
      throw new Error(
        `Unknown concurrency benchmark argument ${String(argument)}`,
      );
    }
  }
  validateConcurrencyOptions(options);
  return Object.freeze(options);
}

export function assignComputerShards(computerIds, workerCount) {
  if (!Array.isArray(computerIds) || computerIds.length === 0)
    throw new RangeError("computerIds must contain at least one Computer");
  if (
    !Number.isSafeInteger(workerCount) ||
    workerCount < 1 ||
    workerCount > computerIds.length
  )
    throw new RangeError(
      "workerCount must be between 1 and the Computer count",
    );
  const shards = Array.from({ length: workerCount }, () => []);
  for (let index = 0; index < computerIds.length; index += 1)
    shards[index % workerCount].push(computerIds[index]);
  return Object.freeze(shards.map((shard) => Object.freeze([...shard])));
}

export function assertEquivalentComputerEvidence(expected, actual) {
  if (!isDeepStrictEqual(expected, actual))
    throw new Error(
      "worker count changed deterministic multi-Computer guest results",
    );
}

export async function benchmarkCs486Concurrency(options = {}) {
  const normalized = normalizeConcurrencyOptions(options);
  const workerSource = await buildWorkerSource();
  const computerIds = Object.freeze(
    Array.from(
      { length: normalized.computers },
      (_, index) => `computer-${String(index + 1).padStart(2, "0")}`,
    ),
  );
  const rssBeforeWorkers = process.memoryUsage().rss;
  let baselinePool;
  let candidatePool;
  let rssWithWorkers = rssBeforeWorkers;
  const baselineSamples = [];
  const candidateSamples = [];
  let expectedEvidence;

  try {
    baselinePool = await WorkerPool.create(1, workerSource);
    candidatePool = await WorkerPool.create(normalized.workers, workerSource);
    rssWithWorkers = process.memoryUsage().rss;
    await runBatch(baselinePool, computerIds, normalized);
    await runBatch(candidatePool, computerIds, normalized);

    for (
      let sampleIndex = 0;
      sampleIndex < normalized.samples;
      sampleIndex += 1
    ) {
      const pools =
        sampleIndex % 2 === 0
          ? [
              ["baseline", baselinePool],
              ["candidate", candidatePool],
            ]
          : [
              ["candidate", candidatePool],
              ["baseline", baselinePool],
            ];
      for (const [label, pool] of pools) {
        const sample = await runBatch(pool, computerIds, normalized);
        if (expectedEvidence === undefined) expectedEvidence = sample.evidence;
        else
          assertEquivalentComputerEvidence(expectedEvidence, sample.evidence);
        if (label === "baseline") baselineSamples.push(sample);
        else candidateSamples.push(sample);
      }
    }
  } finally {
    await Promise.all([baselinePool?.close(), candidatePool?.close()]);
  }

  const baselineElapsed = baselineSamples.map(
    (sample) => sample.elapsedNanoseconds,
  );
  const candidateElapsed = candidateSamples.map(
    (sample) => sample.elapsedNanoseconds,
  );
  const totalInstructions =
    normalized.computers * normalized.ticks * normalized.instructionBudget;
  const baselineElapsedSummary = summarize(baselineElapsed);
  const candidateElapsedSummary = summarize(candidateElapsed);
  const speedup =
    baselineElapsedSummary.median / candidateElapsedSummary.median;
  const baselineExecutionSummary = summarize(
    baselineSamples.map((sample) => sample.executionCriticalPathNanoseconds),
  );
  const candidateExecutionSummary = summarize(
    candidateSamples.map((sample) => sample.executionCriticalPathNanoseconds),
  );
  const executionSpeedup =
    baselineExecutionSummary.median / candidateExecutionSummary.median;
  const evidenceSha256 = createHash("sha256")
    .update(JSON.stringify(expectedEvidence))
    .digest("hex");

  return Object.freeze({
    benchmark: "cs486-multi-computer-worker-throughput-v1",
    boundary:
      "Host-only worker_threads capacity evidence; this does not prove Behavior Pack transport, BDS tick capacity, or guest speed.",
    configuration: Object.freeze({
      ...normalized,
      aggregateInstructionCapacity:
        normalized.workers * perWorkerInstructionCapacity,
      perWorkerInstructionCapacity,
      totalInstructionsPerSample: totalInstructions,
    }),
    correctness: Object.freeze({
      comparedExecutions: normalized.samples * 2,
      computerEvidenceSha256: evidenceSha256,
      deterministicAcrossWorkerCounts: true,
    }),
    host: Object.freeze({
      architecture: process.arch,
      availableParallelism: availableParallelism(),
      baseline: summarizeHostSamples(
        baselineSamples,
        totalInstructions,
        normalized.ticks,
      ),
      candidate: summarizeHostSamples(
        candidateSamples,
        totalInstructions,
        normalized.ticks,
      ),
      efficiency: speedup / normalized.workers,
      executionEfficiency: executionSpeedup / normalized.workers,
      executionSpeedup,
      platform: process.platform,
      rssIncreaseWithBenchmarkPoolsBytes: Math.max(
        0,
        rssWithWorkers - rssBeforeWorkers,
      ),
      speedup,
      workerStartupNanoseconds: Object.freeze({
        baseline: baselinePool?.startupNanoseconds,
        candidate: candidatePool?.startupNanoseconds,
      }),
    }),
    node: process.version,
    samples: normalized.samples,
    sharding: Object.freeze({
      baseline: assignComputerShards(computerIds, 1),
      candidate: assignComputerShards(computerIds, normalized.workers),
    }),
  });
}

function summarizeHostSamples(samples, totalInstructions, ticks) {
  const elapsed = summarize(samples.map((sample) => sample.elapsedNanoseconds));
  return Object.freeze({
    aggregateInstructionsPerSecond:
      (totalInstructions * 1_000_000_000) / elapsed.median,
    batchAveragePerTickNanoseconds: summarize(
      samples.map((sample) => sample.elapsedNanoseconds / ticks),
    ),
    elapsedNanoseconds: elapsed,
    executionCriticalPathNanoseconds: summarize(
      samples.map((sample) => sample.executionCriticalPathNanoseconds),
    ),
    serializedPayloadBytesEstimate: summarize(
      samples.map((sample) => sample.serializedPayloadBytesEstimate),
    ),
    loadImbalanceRatio: summarize(
      samples.map((sample) => sample.loadImbalanceRatio),
    ),
    threadCpuMicroseconds: summarize(
      samples.map((sample) => sample.threadCpuMicroseconds),
    ),
    workerMemoryBytes: Object.freeze({
      arrayBuffers: summarize(
        samples.map((sample) => sample.workerMemory.arrayBuffers),
      ),
      external: summarize(
        samples.map((sample) => sample.workerMemory.external),
      ),
      heapUsed: summarize(
        samples.map((sample) => sample.workerMemory.heapUsed),
      ),
    }),
  });
}

async function runBatch(pool, computerIds, options) {
  const shards = assignComputerShards(computerIds, pool.size);
  const requests = shards.map((computerIdsForWorker) => ({
    computerIds: computerIdsForWorker,
    cpuModel: options.cpuModel,
    instructionBudget: options.instructionBudget,
    instrumentation: options.instrumentation,
    ticks: options.ticks,
  }));
  const requestBytes = requests.reduce(
    (total, request) => total + Buffer.byteLength(JSON.stringify(request)),
    0,
  );
  const wallStart = process.hrtime.bigint();
  const responses = await pool.runShards(requests);
  const elapsedNanoseconds = Number(process.hrtime.bigint() - wallStart);
  const evidence = Object.freeze(
    responses
      .flatMap((response) => response.results)
      .sort((left, right) => left.computerId.localeCompare(right.computerId))
      .map((result) => Object.freeze({ ...result })),
  );
  const responseBytes = responses.reduce(
    (total, response) => total + Buffer.byteLength(JSON.stringify(response)),
    0,
  );
  const workerElapsed = responses.map(
    (response) => response.elapsedNanoseconds,
  );
  const workerExecutionElapsed = responses.map(
    (response) => response.executionElapsedNanoseconds,
  );
  const averageWorkerElapsed =
    workerElapsed.reduce((total, value) => total + value, 0) /
    workerElapsed.length;
  return Object.freeze({
    elapsedNanoseconds,
    evidence,
    executionCriticalPathNanoseconds: Math.max(...workerExecutionElapsed),
    serializedPayloadBytesEstimate: requestBytes + responseBytes,
    loadImbalanceRatio:
      averageWorkerElapsed === 0
        ? 1
        : Math.max(...workerElapsed) / averageWorkerElapsed,
    threadCpuMicroseconds: responses.reduce(
      (total, response) => total + response.threadCpuMicroseconds,
      0,
    ),
    workerMemory: Object.freeze({
      arrayBuffers: responses.reduce(
        (total, response) => total + response.memory.arrayBuffers,
        0,
      ),
      external: responses.reduce(
        (total, response) => total + response.memory.external,
        0,
      ),
      heapUsed: responses.reduce(
        (total, response) => total + response.memory.heapUsed,
        0,
      ),
    }),
  });
}

class WorkerPool {
  static async create(size, source) {
    const start = process.hrtime.bigint();
    const workers = [];
    try {
      for (let index = 0; index < size; index += 1)
        workers.push(new BenchmarkWorker(source, index));
      await Promise.all(workers.map((worker) => worker.ready));
    } catch (error) {
      await Promise.allSettled(workers.map((worker) => worker.close()));
      throw error;
    }
    return new WorkerPool(workers, Number(process.hrtime.bigint() - start));
  }

  constructor(workers, startupNanoseconds) {
    this.startupNanoseconds = startupNanoseconds;
    this.workers = workers;
  }

  get size() {
    return this.workers.length;
  }

  async runShards(requests) {
    if (requests.length !== this.workers.length)
      throw new RangeError("each worker requires exactly one shard");
    return Promise.all(
      this.workers.map((worker, index) => worker.run(requests[index])),
    );
  }

  async close() {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }
}

class BenchmarkWorker {
  constructor(source, index) {
    this.closed = false;
    this.failure = undefined;
    this.nextRequestId = 1;
    this.pending = undefined;
    this.worker = new Worker(source, {
      eval: true,
      execArgv: [],
      name: `cs486-concurrency-${String(index + 1)}`,
    });
    this.ready = this.waitForReady();
    this.worker.on("message", (message) => this.onMessage(message));
    this.worker.on("error", (error) => this.fail(error));
    this.worker.on("exit", (code) => {
      if (!this.closed)
        this.fail(
          new Error(
            `CS486 concurrency worker exited with code ${String(code)}`,
          ),
        );
    });
  }

  waitForReady() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("CS486 concurrency worker startup timed out"));
      }, workerStartupTimeoutMs);
      this.readyOwner = {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
      };
    });
  }

  run(request) {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.closed)
      return Promise.reject(new Error("CS486 concurrency worker is closed"));
    if (this.pending !== undefined)
      return Promise.reject(
        new Error("CS486 concurrency worker already owns a request"),
      );
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error("CS486 concurrency worker request timed out");
        this.failure = error;
        this.pending = undefined;
        reject(error);
      }, workerRequestTimeoutMs);
      this.pending = { reject, requestId, resolve, timer };
      this.worker.postMessage({
        ...request,
        requestId,
        type: "run-shard",
      });
    });
  }

  onMessage(message) {
    if (message?.type === "ready") {
      this.readyOwner?.resolve();
      this.readyOwner = undefined;
      return;
    }
    const pending = this.pending;
    if (pending === undefined || message?.requestId !== pending.requestId)
      return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    if (message.type === "result") pending.resolve(message);
    else
      pending.reject(
        new Error(
          `CS486 concurrency worker failed: ${String(message?.error ?? "unknown error")}`,
        ),
      );
  }

  fail(error) {
    this.failure ??= error;
    this.readyOwner?.reject(error);
    this.readyOwner = undefined;
    if (this.pending !== undefined) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("CS486 concurrency worker closed");
    this.readyOwner?.reject(error);
    this.readyOwner = undefined;
    if (this.pending !== undefined) {
      clearTimeout(this.pending.timer);
      this.pending.reject(error);
      this.pending = undefined;
    }
    await this.worker.terminate();
  }
}

function normalizeConcurrencyOptions(options) {
  const normalized = {
    computers: options.computers ?? defaultComputers,
    cpuModel: options.cpuModel ?? "cs486dx2",
    instructionBudget: options.instructionBudget ?? defaultInstructionBudget,
    instrumentation: options.instrumentation ?? "disabled",
    samples: options.samples ?? defaultSamples,
    ticks: options.ticks ?? defaultTicks,
    workers: options.workers ?? defaultWorkers,
  };
  validateConcurrencyOptions(normalized);
  return Object.freeze(normalized);
}

function validateConcurrencyOptions(options) {
  boundedNumber(
    options.computers,
    minimumComputers,
    maximumComputers,
    "computers",
  );
  enumValue(options.cpuModel, cpuModels, "cpu-model");
  boundedNumber(
    options.instructionBudget,
    minimumInstructionBudget,
    maximumInstructionBudget,
    "instructions-per-runtime",
  );
  enumValue(options.instrumentation, instrumentationModes, "instrumentation");
  boundedNumber(options.samples, minimumSamples, maximumSamples, "samples");
  boundedNumber(options.ticks, minimumTicks, maximumTicks, "ticks");
  boundedNumber(options.workers, minimumWorkers, maximumWorkers, "workers");
  if (options.workers > options.computers)
    throw new RangeError("workers cannot exceed the Computer count");
  const fullRateComputers =
    options.workers *
    Math.floor(perWorkerInstructionCapacity / options.instructionBudget);
  if (options.computers > fullRateComputers)
    throw new RangeError(
      `configuration admits at most ${String(fullRateComputers)} full-rate Computers`,
    );
  const totalInstructions =
    options.computers *
    options.instructionBudget *
    options.ticks *
    (options.samples * 2 + 2);
  if (
    !Number.isSafeInteger(totalInstructions) ||
    totalInstructions > maximumBenchmarkInstructions
  )
    throw new RangeError(
      `benchmark work must not exceed ${String(maximumBenchmarkInstructions)} total instructions`,
    );
}

function boundedInteger(raw, minimum, maximum, label) {
  if (raw === undefined || !/^[0-9]+$/u.test(raw))
    throw new Error(`${label} must be an integer`);
  const value = Number(raw);
  boundedNumber(value, minimum, maximum, label);
  return value;
}

function boundedNumber(value, minimum, maximum, label) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new RangeError(
      `${label} must be between ${String(minimum)} and ${String(maximum)}`,
    );
}

function enumValue(raw, values, label) {
  if (!values.includes(raw))
    throw new Error(`${label} must be one of ${values.join(", ")}`);
  return raw;
}

async function buildWorkerSource() {
  const result = await build({
    bundle: true,
    entryPoints: [
      fileURLToPath(
        new URL("cs486-concurrency-worker-entry.ts", import.meta.url),
      ),
    ],
    format: "cjs",
    platform: "node",
    sourcemap: false,
    target: "node24",
    write: false,
  });
  return result.outputFiles[0].text;
}

function isMainModule() {
  return (
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href
  );
}

if (isMainModule()) {
  const options = parseConcurrencyBenchmarkArguments(process.argv.slice(2));
  const result = await benchmarkCs486Concurrency(options);
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`);
}
