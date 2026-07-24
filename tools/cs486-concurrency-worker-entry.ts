import { createHash } from "node:crypto";
import { parentPort } from "node:worker_threads";

import { Cs486Process, type Cs486Executable } from "../src/domain/cpu/cs486.js";
import type { Cs486Register } from "../src/domain/cpu/instructionSet.js";
import type { CpuMicroarchitectureStats } from "../src/domain/cpu/memoryHierarchy.js";
import type { CpuModel } from "../src/domain/cpu/models.js";

const guestMemoryInspectionChunkBytes = 4_096;
const maximumComputersPerShard = 64;
const maximumInstructionsPerRuntimeTick = 1_650_000;
const maximumTicksPerBatch = 100;

const benchmarkExecutable: Cs486Executable = Object.freeze({
  dataBytes: 0,
  format: "cs486-executable",
  instructions: Object.freeze([
    {
      destination: "eax",
      op: "mov",
      source: { kind: "immediate", value: 1 },
    },
    {
      destination: "ebx",
      op: "add",
      source: { kind: "register", register: "eax" },
    },
    {
      destination: "ecx",
      op: "xor",
      source: { kind: "register", register: "ebx" },
    },
    {
      left: "ecx",
      op: "cmp",
      right: { kind: "immediate", value: 0 },
    },
    { op: "jne", target: 6 },
    { op: "jmp", target: 1 },
    {
      destination: "edx",
      op: "add",
      source: { kind: "immediate", value: 1 },
    },
    { op: "jmp", target: 1 },
  ]),
  version: 2,
});

type InstrumentationMode = "disabled" | "enabled";

interface RunShardRequest {
  readonly computerIds: readonly string[];
  readonly cpuModel: CpuModel;
  readonly instructionBudget: number;
  readonly instrumentation: InstrumentationMode;
  readonly requestId: number;
  readonly ticks: number;
  readonly type: "run-shard";
}

interface ComputerEvidence {
  readonly computerId: string;
  readonly executedInstructions: number;
  readonly guestCycles: number;
  readonly guestRamSha256: string;
  readonly hasPendingCpuCycles: boolean;
  readonly instructionPointer: number;
  readonly microarchitecture: CpuMicroarchitectureStats | null;
  readonly output: string;
  readonly processState: Readonly<Record<string, unknown>>;
  readonly registers: Readonly<Record<Cs486Register, number>>;
}

interface ComputerRunResult {
  readonly evidence: ComputerEvidence;
  readonly executionElapsedNanoseconds: number;
}

const port = parentPort;
if (port === null)
  throw new Error("CS486 concurrency worker requires a parent port");

port.on("message", (message: unknown) => {
  if (!isRunShardRequest(message)) {
    port.postMessage({
      error: "invalid CS486 concurrency worker request",
      requestId: requestIdFrom(message),
      type: "error",
    });
    return;
  }

  try {
    const threadCpuStart = process.threadCpuUsage();
    const wallStart = process.hrtime.bigint();
    const computerRuns = message.computerIds.map((computerId) =>
      runComputer(computerId, message),
    );
    const elapsedNanoseconds = Number(process.hrtime.bigint() - wallStart);
    const threadCpuUsage = process.threadCpuUsage(threadCpuStart);
    const memoryUsage = process.memoryUsage();
    port.postMessage({
      elapsedNanoseconds,
      executionElapsedNanoseconds: computerRuns.reduce(
        (total, result) => total + result.executionElapsedNanoseconds,
        0,
      ),
      memory: {
        arrayBuffers: memoryUsage.arrayBuffers,
        external: memoryUsage.external,
        heapUsed: memoryUsage.heapUsed,
      },
      requestId: message.requestId,
      results: computerRuns.map((result) => result.evidence),
      threadCpuMicroseconds: threadCpuUsage.user + threadCpuUsage.system,
      type: "result",
    });
  } catch (error) {
    port.postMessage({
      error: boundedErrorMessage(error),
      requestId: message.requestId,
      type: "error",
    });
  }
});

port.postMessage({ type: "ready" });

function runComputer(
  computerId: string,
  request: RunShardRequest,
): ComputerRunResult {
  const guest = new Cs486Process(benchmarkExecutable, {
    collectMicroarchitectureStats: request.instrumentation === "enabled",
    cpuModel: request.cpuModel,
    memoryBytes: 65_536,
  });
  let executedInstructions = 0;
  let guestCycles = 0;
  const executionStart = process.hrtime.bigint();
  for (let tick = 0; tick < request.ticks; tick += 1) {
    guest.advanceTick(tick + 1);
    const result = guest.runCpuSlice(
      Number.MAX_SAFE_INTEGER,
      request.instructionBudget,
    );
    executedInstructions += result.executedInstructions;
    guestCycles += result.cpuCycles;
  }
  const executionElapsedNanoseconds = Number(
    process.hrtime.bigint() - executionStart,
  );

  return {
    evidence: {
      computerId,
      executedInstructions,
      guestCycles,
      guestRamSha256: digestGuestRam(guest),
      hasPendingCpuCycles: guest.hasPendingCpuCycles,
      instructionPointer: guest.instructionAddress,
      microarchitecture: guest.microarchitectureStatsEnabled
        ? { ...guest.microarchitectureStats }
        : null,
      output: guest.output,
      processState: { ...guest.state },
      registers: { ...guest.registers },
    },
    executionElapsedNanoseconds,
  };
}

function isRunShardRequest(value: unknown): value is RunShardRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<RunShardRequest>;
  return (
    candidate.type === "run-shard" &&
    Number.isSafeInteger(candidate.requestId) &&
    Array.isArray(candidate.computerIds) &&
    candidate.computerIds.length > 0 &&
    candidate.computerIds.length <= maximumComputersPerShard &&
    candidate.computerIds.every(
      (computerId) =>
        typeof computerId === "string" && /^[a-z0-9-]{1,32}$/u.test(computerId),
    ) &&
    (candidate.cpuModel === "cs386sx" ||
      candidate.cpuModel === "cs486dx" ||
      candidate.cpuModel === "cs486dx2") &&
    Number.isSafeInteger(candidate.instructionBudget) &&
    (candidate.instructionBudget ?? 0) >= 10_000 &&
    (candidate.instructionBudget ?? 0) <= maximumInstructionsPerRuntimeTick &&
    (candidate.instrumentation === "disabled" ||
      candidate.instrumentation === "enabled") &&
    Number.isSafeInteger(candidate.ticks) &&
    (candidate.ticks ?? 0) >= 1 &&
    (candidate.ticks ?? 0) <= maximumTicksPerBatch
  );
}

function requestIdFrom(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const requestId = (value as { readonly requestId?: unknown }).requestId;
  return Number.isSafeInteger(requestId) ? Number(requestId) : null;
}

function digestGuestRam(guest: Cs486Process): string {
  const digest = createHash("sha256");
  for (
    let address = 0;
    address < guest.memoryLimitBytes;
    address += guestMemoryInspectionChunkBytes
  ) {
    digest.update(
      guest.inspectMemory(
        address,
        Math.min(
          guestMemoryInspectionChunkBytes,
          guest.memoryLimitBytes - address,
        ),
      ),
    );
  }
  return digest.digest("hex");
}

function boundedErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 2_000);
}
