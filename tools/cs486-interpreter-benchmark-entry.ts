import { createHash } from "node:crypto";

import { Cs486Process, type Cs486Executable } from "../src/domain/cpu/cs486.js";
import type { Cs486Register } from "../src/domain/cpu/instructionSet.js";
import type { CpuMicroarchitectureStats } from "../src/domain/cpu/memoryHierarchy.js";
import type { CpuModel } from "../src/domain/cpu/models.js";
import {
  cs486AluBranchCorpusExecutable,
  cs486AluBranchCorpusMemoryBytes,
} from "./cs486-corpora/alu-branch-corpus.js";

const guestMemoryInspectionChunkBytes = 4_096;

export type Cs486BenchmarkExecutionMode = "cpu-slice" | "instruction-slice";
export type Cs486BenchmarkInstrumentationMode = "disabled" | "enabled";

export interface Cs486InterpreterSample {
  readonly cpuMicroseconds: number;
  readonly elapsedNanoseconds: number;
  readonly executedInstructions: number;
  readonly guestCycles: number;
  readonly guestRamSha256: string;
  readonly hasPendingCpuCycles: boolean;
  readonly instructionPointer: number;
  readonly instrumentation: Cs486BenchmarkInstrumentationMode;
  readonly microarchitecture: CpuMicroarchitectureStats | null;
  readonly output: string;
  readonly processState: Readonly<Record<string, unknown>>;
  readonly registerChecksum: number;
  readonly registers: Readonly<Record<Cs486Register, number>>;
}

/**
 * Measures host implementation cost around the production CS486 interpreter.
 * Guest cycles remain a separate deterministic result and are never inferred
 * from the host timer. The legacy entry keeps its exact historical behavior:
 * the ALU/branch corpus with 64 KiB of guest RAM.
 */
export function measureCs486InterpreterSample(
  cpuModel: CpuModel,
  instructionBudget: number,
  executionMode: Cs486BenchmarkExecutionMode = "instruction-slice",
  instrumentation: Cs486BenchmarkInstrumentationMode = "enabled",
): Cs486InterpreterSample {
  return measureCs486ExecutableSample(
    cs486AluBranchCorpusExecutable,
    cs486AluBranchCorpusMemoryBytes,
    cpuModel,
    instructionBudget,
    executionMode,
    instrumentation,
  );
}

/**
 * Corpus-parameterized variant of `measureCs486InterpreterSample` so every
 * benchmark corpus is measured against an identical executable and RAM
 * admission.
 */
export function measureCs486ExecutableSample(
  executable: Cs486Executable,
  memoryBytes: number,
  cpuModel: CpuModel,
  instructionBudget: number,
  executionMode: Cs486BenchmarkExecutionMode = "instruction-slice",
  instrumentation: Cs486BenchmarkInstrumentationMode = "enabled",
): Cs486InterpreterSample {
  const collectMicroarchitectureStats = instrumentation === "enabled";
  const guest = new Cs486Process(executable, {
    collectMicroarchitectureStats,
    cpuModel,
    memoryBytes,
  });
  const cpuStart = process.cpuUsage();
  const wallStart = process.hrtime.bigint();
  const result =
    executionMode === "cpu-slice"
      ? guest.runCpuSlice(Number.MAX_SAFE_INTEGER, instructionBudget)
      : guest.runInstructionSlice(instructionBudget);
  const elapsedNanoseconds = Number(process.hrtime.bigint() - wallStart);
  const cpuUsage = process.cpuUsage(cpuStart);
  const registers = Object.freeze(guest.registers);
  const processState = Object.freeze({ ...guest.state });
  const microarchitecture = guest.microarchitectureStatsEnabled
    ? Object.freeze(guest.microarchitectureStats)
    : null;
  const output = guest.output;
  const instructionPointer = guest.instructionAddress;
  const hasPendingCpuCycles = guest.hasPendingCpuCycles;
  const guestRamSha256 = digestGuestRam(guest);
  return Object.freeze({
    cpuMicroseconds: cpuUsage.user + cpuUsage.system,
    elapsedNanoseconds,
    executedInstructions: result.executedInstructions,
    guestCycles: result.cpuCycles,
    guestRamSha256,
    hasPendingCpuCycles,
    instructionPointer,
    instrumentation,
    microarchitecture,
    output,
    processState,
    registerChecksum:
      registers.eax ^ registers.ebx ^ registers.ecx ^ registers.edx,
    registers,
  });
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
