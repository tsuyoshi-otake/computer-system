import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { build } from "esbuild";

import {
  assertCs486ComputeEngine,
  defaultCs486ComputeEngine,
} from "./cs486-compute-engine.mjs";

const protocolVersion = 1;
const minimumWorkerCount = 1;
const maximumWorkerCount = 16;
const maximumProcessesPerWorker = 128;
const maximumPendingRequestsPerWorker = 256;
const workerStartupTimeoutMs = 15_000;
const workerRequestTimeoutMs = 30_000;
const maximumIdentifierCharacters = 64;
const maximumRequestIdCharacters = 128;
const maximumErrorMessageCharacters = 2_000;

const commandNames = Object.freeze([
  "create",
  "slice",
  "dispose",
  "terminate",
  "fail",
]);

export const cs486ComputeWorkerPoolLimits = Object.freeze({
  maximumCpuCyclesPerSlice: 100_000_000,
  maximumInstructionsPerSlice: 1_650_000,
  maximumPendingRequestsPerWorker,
  maximumProcessesPerWorker,
  maximumWorkerCount,
  minimumWorkerCount,
  protocolVersion,
  workerRequestTimeoutMs,
  workerStartupTimeoutMs,
});

export class Cs486ComputeWorkerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "Cs486ComputeWorkerError";
    this.code = code;
    Object.assign(this, details);
  }
}

/**
 * Exact compatibility hash shared with the Bedrock/companion adapter.
 * FNV-1a is applied to JavaScript UTF-16 code units and returns a one-based
 * worker index suitable for stable external diagnostics.
 */
export function stableWorkerIndexForComputer(computerId, workerCount) {
  assertBoundedIdentifier(computerId, "computerId");
  assertWorkerCount(workerCount);
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < computerId.length; index += 1) {
    hash ^= computerId.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return (hash % workerCount) + 1;
}

export const workerIndexForComputer = stableWorkerIndexForComputer;

export async function createCs486ComputeWorkerPool(options = {}) {
  return Cs486ComputeWorkerPool.create(options);
}

export class Cs486ComputeWorkerPool {
  static async create(options = {}) {
    const pool = new Cs486ComputeWorkerPool(options);
    try {
      await pool.initialization;
      return pool;
    } catch (error) {
      await pool.close();
      throw error;
    }
  }

  constructor(options = {}) {
    const workerCount =
      typeof options === "number" ? options : (options.workerCount ?? 1);
    assertWorkerCount(workerCount);
    this.configuredWorkerCount = workerCount;
    this.cpuEngine = assertCs486ComputeEngine(
      typeof options === "number"
        ? defaultCs486ComputeEngine
        : (options.cpuEngine ?? defaultCs486ComputeEngine),
    );
    this.workers = [];
    this.processes = new Map();
    this.nextConvenienceRequestId = 1;
    this.closeRequested = false;
    this.closePromise = undefined;
    this.initializationFailure = undefined;
    this.state = "starting";
    this.initialization = this.initialize();
  }

  get size() {
    return this.configuredWorkerCount;
  }

  get workerCount() {
    return this.configuredWorkerCount;
  }

  async request(command) {
    const normalized = normalizePoolCommand(command);
    if (this.closeRequested)
      throw poolError("POOL_CLOSED", "CS486 compute worker pool is closed");
    await this.initialization;
    if (this.closeRequested)
      throw poolError("POOL_CLOSED", "CS486 compute worker pool is closed");

    switch (normalized.command) {
      case "create":
        return this.requestCreate(normalized);
      case "dispose":
        return this.requestDispose(normalized);
      case "slice":
      case "terminate":
      case "fail":
        return this.requestOwnedProcess(normalized);
      default:
        throw poolError("INVALID_REQUEST", "invalid CS486 compute command");
    }
  }

  createProcess(command) {
    return this.request(this.convenienceCommand("create", command));
  }

  runSlice(command) {
    return this.request(this.convenienceCommand("slice", command));
  }

  disposeProcess(command) {
    return this.request(this.convenienceCommand("dispose", command));
  }

  terminateProcess(command) {
    return this.request(this.convenienceCommand("terminate", command));
  }

  failProcess(command) {
    return this.request(this.convenienceCommand("fail", command));
  }

  slice(command) {
    return this.runSlice(command);
  }

  dispose(command) {
    return this.disposeProcess(command);
  }

  terminate(command) {
    return this.terminateProcess(command);
  }

  fail(command) {
    return this.failProcess(command);
  }

  status() {
    const workerStatuses = this.workers.map((worker) => {
      const ownedProcessCount = this.countProcessesForWorker(
        worker.workerIndex,
      );
      return {
        cpuEngine: worker.reportedCpuEngine ?? null,
        error:
          worker.failure === undefined
            ? null
            : boundedErrorMessage(worker.failure),
        failed: worker.failure !== undefined,
        ownedProcessCount,
        pendingRequestCount: worker.pending.size,
        workerIndex: worker.workerIndex,
      };
    });
    const pendingRequestCount = workerStatuses.reduce(
      (total, worker) => total + worker.pendingRequestCount,
      0,
    );
    const failed =
      this.initializationFailure !== undefined ||
      workerStatuses.some((worker) => worker.failed);
    return {
      cpuEngine: this.cpuEngine,
      failed,
      ownedProcessCount: this.processes.size,
      pendingRequestCount,
      state: this.state === "ready" && failed ? "failed" : this.state,
      workerCount: this.configuredWorkerCount,
      workers: workerStatuses,
    };
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closeRequested = true;
    this.state = "closing";
    this.closePromise = (async () => {
      await Promise.allSettled(this.workers.map((worker) => worker.close()));
      await Promise.allSettled([this.initialization]);
      await Promise.allSettled(this.workers.map((worker) => worker.close()));
      this.processes.clear();
      this.state = "closed";
    })();
    return this.closePromise;
  }

  async initialize() {
    try {
      const source = await buildWorkerSource();
      if (this.closeRequested)
        throw poolError(
          "POOL_CLOSED",
          "CS486 compute worker pool closed during startup",
        );
      this.workers = Array.from(
        { length: this.configuredWorkerCount },
        (_, index) =>
          new ComputeWorkerEndpoint(
            source,
            index + 1,
            this.configuredWorkerCount,
            this.cpuEngine,
          ),
      );
      await Promise.all(this.workers.map((worker) => worker.ready));
      if (this.closeRequested)
        throw poolError(
          "POOL_CLOSED",
          "CS486 compute worker pool closed during startup",
        );
      this.state = "ready";
    } catch (error) {
      if (!this.closeRequested) {
        this.initializationFailure = asError(error);
        this.state = "failed";
      }
      await Promise.allSettled(this.workers.map((worker) => worker.close()));
      throw error;
    }
  }

  async requestCreate(command) {
    if (this.processes.has(command.processId))
      throw poolError(
        "DUPLICATE_PROCESS",
        "CS486 compute process already exists",
      );
    const workerIndex = stableWorkerIndexForComputer(
      command.computerId,
      this.configuredWorkerCount,
    );
    if (this.countProcessesForWorker(workerIndex) >= maximumProcessesPerWorker)
      throw poolError(
        "PROCESS_CAPACITY_EXCEEDED",
        `CS486 compute worker admits at most ${String(maximumProcessesPerWorker)} processes`,
        { workerIndex },
      );

    const record = {
      computerId: command.computerId,
      created: false,
      disposing: false,
      workerIndex,
    };
    this.processes.set(command.processId, record);
    try {
      const response = await this.worker(workerIndex).request(command);
      record.created = true;
      return response;
    } catch (error) {
      if (this.processes.get(command.processId) === record && !record.disposing)
        this.processes.delete(command.processId);
      throw error;
    }
  }

  async requestOwnedProcess(command) {
    const record = this.processes.get(command.processId);
    if (record === undefined)
      throw poolError(
        "PROCESS_NOT_FOUND",
        "CS486 compute process does not exist",
      );
    assertComputerIdentity(record, command.computerId);
    if (record.disposing)
      throw poolError(
        "PROCESS_DISPOSING",
        "CS486 compute process disposal is already pending",
      );
    return this.worker(record.workerIndex).request(command);
  }

  async requestDispose(command) {
    const record = this.processes.get(command.processId);
    if (record !== undefined)
      assertComputerIdentity(record, command.computerId);
    const workerIndex =
      record?.workerIndex ??
      stableWorkerIndexForComputer(
        command.computerId,
        this.configuredWorkerCount,
      );
    if (record !== undefined) record.disposing = true;
    try {
      const response = await this.worker(workerIndex).request(command);
      if (
        record !== undefined &&
        this.processes.get(command.processId) === record
      )
        this.processes.delete(command.processId);
      return response;
    } catch (error) {
      if (
        record !== undefined &&
        this.processes.get(command.processId) === record
      )
        record.disposing = false;
      throw error;
    }
  }

  worker(workerIndex) {
    const worker = this.workers[workerIndex - 1];
    if (worker === undefined)
      throw poolError(
        "WORKER_UNAVAILABLE",
        "CS486 compute worker is unavailable",
        { workerIndex },
      );
    return worker;
  }

  countProcessesForWorker(workerIndex) {
    let count = 0;
    for (const process of this.processes.values())
      if (process.workerIndex === workerIndex) count += 1;
    return count;
  }

  convenienceCommand(commandName, command) {
    if (!isRecord(command))
      throw poolError("INVALID_REQUEST", "invalid CS486 compute command");
    const fields = { ...command };
    const suppliedProtocolVersion = fields.protocolVersion;
    const suppliedRequestId = fields.requestId;
    delete fields.command;
    delete fields.protocolVersion;
    delete fields.requestId;
    const requestId =
      suppliedRequestId ??
      `pool-${String(this.nextConvenienceRequestId++).padStart(6, "0")}`;
    return {
      ...fields,
      command: commandName,
      protocolVersion: suppliedProtocolVersion ?? protocolVersion,
      requestId,
    };
  }
}

class ComputeWorkerEndpoint {
  constructor(source, workerIndex, workerCount, cpuEngine) {
    this.workerIndex = workerIndex;
    this.workerCount = workerCount;
    this.requestedCpuEngine = cpuEngine;
    this.reportedCpuEngine = undefined;
    this.closed = false;
    this.closePromise = undefined;
    this.failure = undefined;
    this.nextCorrelationId = 1;
    this.pending = new Map();
    this.worker = new Worker(source, {
      eval: true,
      execArgv: [],
      name: `cs486-compute-${String(workerIndex)}`,
      workerData: {
        cpuEngine,
        protocolVersion,
        workerCount,
        workerIndex,
      },
    });
    this.ready = this.waitForReady();
    this.worker.on("message", (message) => this.onMessage(message));
    this.worker.on("messageerror", () => {
      this.fail(
        poolError(
          "WORKER_PROTOCOL_ERROR",
          `CS486 compute worker ${String(workerIndex)} emitted an invalid message`,
          { workerIndex },
        ),
      );
      void this.worker.terminate();
    });
    this.worker.on("error", () => {
      this.fail(
        poolError(
          "WORKER_FAILED",
          `CS486 compute worker ${String(workerIndex)} failed`,
          { workerIndex },
        ),
      );
    });
    this.worker.on("exit", (code) => {
      if (!this.closed)
        this.fail(
          poolError(
            "WORKER_EXITED",
            `CS486 compute worker ${String(workerIndex)} exited with code ${String(code)}`,
            { workerIndex },
          ),
        );
    });
  }

  request(command) {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    if (this.closed)
      return Promise.reject(
        poolError("POOL_CLOSED", "CS486 compute worker is closed", {
          workerIndex: this.workerIndex,
        }),
      );
    if (this.pending.size >= maximumPendingRequestsPerWorker)
      return Promise.reject(
        poolError(
          "WORKER_PENDING_CAPACITY_EXCEEDED",
          `CS486 compute worker admits at most ${String(maximumPendingRequestsPerWorker)} pending requests`,
          { workerIndex: this.workerIndex },
        ),
      );
    const correlationId = this.allocateCorrelationId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = poolError(
          "WORKER_REQUEST_TIMEOUT",
          `CS486 compute worker ${String(this.workerIndex)} request timed out`,
          { workerIndex: this.workerIndex },
        );
        this.fail(error);
        void this.worker.terminate();
      }, workerRequestTimeoutMs);
      this.pending.set(correlationId, {
        reject,
        requestId: command.requestId,
        resolve,
        timer,
      });
      try {
        this.worker.postMessage({
          command,
          correlationId,
          protocolVersion,
          type: "request",
        });
      } catch {
        clearTimeout(timer);
        this.pending.delete(correlationId);
        reject(
          poolError(
            "INVALID_REQUEST",
            "CS486 compute command is not structured-clone safe",
            { workerIndex: this.workerIndex },
          ),
        );
      }
    });
  }

  waitForReady() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = poolError(
          "WORKER_STARTUP_TIMEOUT",
          `CS486 compute worker ${String(this.workerIndex)} startup timed out`,
          { workerIndex: this.workerIndex },
        );
        this.fail(error);
        void this.worker.terminate();
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

  onMessage(message) {
    if (message?.type === "ready") {
      // The worker reports the engine it actually built, so a thread that
      // loaded something other than the requested engine never becomes ready.
      if (
        !this.isWorkerMessage(message) ||
        message.cpuEngine !== this.requestedCpuEngine
      ) {
        this.protocolFailure();
        return;
      }
      this.reportedCpuEngine = message.cpuEngine;
      this.readyOwner?.resolve();
      this.readyOwner = undefined;
      return;
    }
    if (
      !this.isWorkerMessage(message) ||
      !Number.isSafeInteger(message.correlationId)
    ) {
      this.protocolFailure();
      return;
    }
    const owner = this.pending.get(message.correlationId);
    if (owner === undefined) {
      if (this.failure === undefined && !this.closed) this.protocolFailure();
      return;
    }
    clearTimeout(owner.timer);
    this.pending.delete(message.correlationId);
    if (message.type === "response") {
      if (!isRecord(message.response)) {
        owner.reject(
          poolError(
            "WORKER_PROTOCOL_ERROR",
            "CS486 compute worker returned an invalid response",
            { workerIndex: this.workerIndex },
          ),
        );
        this.protocolFailure();
        return;
      }
      owner.resolve(message.response);
      return;
    }
    if (message.type === "error") {
      owner.reject(
        poolError(
          typeof message.code === "string"
            ? message.code
            : "PROCESS_OPERATION_FAILED",
          typeof message.error === "string"
            ? message.error.slice(0, maximumErrorMessageCharacters)
            : "CS486 compute worker rejected the request",
          {
            requestId: owner.requestId,
            workerIndex: this.workerIndex,
          },
        ),
      );
      return;
    }
    owner.reject(
      poolError(
        "WORKER_PROTOCOL_ERROR",
        "CS486 compute worker returned an unknown response",
        { workerIndex: this.workerIndex },
      ),
    );
    this.protocolFailure();
  }

  isWorkerMessage(message) {
    return (
      isRecord(message) &&
      message.protocolVersion === protocolVersion &&
      message.workerCount === this.workerCount &&
      message.workerIndex === this.workerIndex
    );
  }

  protocolFailure() {
    this.fail(
      poolError(
        "WORKER_PROTOCOL_ERROR",
        `CS486 compute worker ${String(this.workerIndex)} violated protocol`,
        { workerIndex: this.workerIndex },
      ),
    );
    void this.worker.terminate();
  }

  fail(error) {
    if (this.failure !== undefined || this.closed) return;
    this.failure = asError(error);
    this.readyOwner?.reject(this.failure);
    this.readyOwner = undefined;
    this.rejectAll(this.failure);
  }

  rejectAll(error) {
    for (const owner of this.pending.values()) {
      clearTimeout(owner.timer);
      owner.reject(error);
    }
    this.pending.clear();
  }

  allocateCorrelationId() {
    for (
      let attempts = 0;
      attempts <= maximumPendingRequestsPerWorker;
      attempts += 1
    ) {
      const candidate = this.nextCorrelationId;
      this.nextCorrelationId =
        candidate >= Number.MAX_SAFE_INTEGER ? 1 : candidate + 1;
      if (!this.pending.has(candidate)) return candidate;
    }
    throw poolError(
      "WORKER_PENDING_CAPACITY_EXCEEDED",
      "CS486 compute worker has no correlation ID capacity",
      { workerIndex: this.workerIndex },
    );
  }

  close() {
    if (this.closePromise !== undefined) return this.closePromise;
    this.closed = true;
    const error = poolError(
      "POOL_CLOSED",
      `CS486 compute worker ${String(this.workerIndex)} closed`,
      { workerIndex: this.workerIndex },
    );
    this.readyOwner?.reject(error);
    this.readyOwner = undefined;
    this.rejectAll(error);
    this.closePromise = this.worker.terminate().then(() => undefined);
    return this.closePromise;
  }
}

let workerSourcePromise;

async function buildWorkerSource() {
  workerSourcePromise ??= build({
    bundle: true,
    entryPoints: [
      fileURLToPath(new URL("cs486-compute-worker-entry.ts", import.meta.url)),
    ],
    format: "cjs",
    platform: "node",
    sourcemap: false,
    target: "node24",
    write: false,
  })
    .then((result) => {
      const output = result.outputFiles[0];
      if (output === undefined)
        throw new Error("CS486 compute worker bundle produced no output");
      return output.text;
    })
    .catch((error) => {
      workerSourcePromise = undefined;
      throw error;
    });
  return workerSourcePromise;
}

function normalizePoolCommand(value) {
  if (!isRecord(value))
    throw poolError("INVALID_REQUEST", "invalid CS486 compute command");
  if (
    value.protocolVersion !== protocolVersion ||
    !commandNames.includes(value.command) ||
    !isBoundedIdentifier(value.processId) ||
    !isBoundedIdentifier(value.computerId) ||
    !isBoundedRequestId(value.requestId)
  )
    throw poolError("INVALID_REQUEST", "invalid CS486 compute command");
  return { ...value };
}

function assertComputerIdentity(record, computerId) {
  if (record.computerId !== computerId)
    throw poolError(
      "PROCESS_IDENTITY_MISMATCH",
      "CS486 compute process belongs to a different Computer",
      { workerIndex: record.workerIndex },
    );
}

function assertWorkerCount(value) {
  if (
    !Number.isSafeInteger(value) ||
    value < minimumWorkerCount ||
    value > maximumWorkerCount
  )
    throw new RangeError(
      `workerCount must be between ${String(minimumWorkerCount)} and ${String(maximumWorkerCount)}`,
    );
}

function assertBoundedIdentifier(value, label) {
  if (!isBoundedIdentifier(value))
    throw new TypeError(
      `${label} must be a bounded ASCII identifier with at most ${String(maximumIdentifierCharacters)} characters`,
    );
}

function isBoundedIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumIdentifierCharacters &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u.test(value)
  );
}

function isBoundedRequestId(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumRequestIdCharacters &&
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u.test(value)
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function poolError(code, message, details = {}) {
  return new Cs486ComputeWorkerError(code, message, details);
}

function asError(value) {
  return value instanceof Error
    ? value
    : new Error("CS486 compute worker failed");
}

function boundedErrorMessage(error) {
  return error instanceof Error
    ? error.message.slice(0, maximumErrorMessageCharacters)
    : "CS486 compute worker failed";
}
