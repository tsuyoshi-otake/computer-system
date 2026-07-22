import { Cs486Process, type Cs486Executable } from "../src/domain/cpu/cs486.js";
import type { CpuModel } from "../src/domain/cpu/models.js";

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

export interface Cs486InterpreterSample {
  readonly cpuMicroseconds: number;
  readonly elapsedNanoseconds: number;
  readonly executedInstructions: number;
  readonly guestCycles: number;
  readonly registerChecksum: number;
}

/**
 * Measures host implementation cost around the production CS486 interpreter.
 * Guest cycles remain a separate deterministic result and are never inferred
 * from the host timer.
 */
export function measureCs486InterpreterSample(
  cpuModel: CpuModel,
  instructionBudget: number,
): Cs486InterpreterSample {
  const guest = new Cs486Process(benchmarkExecutable, {
    cpuModel,
    memoryBytes: 65_536,
  });
  const cpuStart = process.cpuUsage();
  const wallStart = process.hrtime.bigint();
  const result = guest.runInstructionSlice(instructionBudget);
  const elapsedNanoseconds = Number(process.hrtime.bigint() - wallStart);
  const cpuUsage = process.cpuUsage(cpuStart);
  const registers = guest.registers;
  return Object.freeze({
    cpuMicroseconds: cpuUsage.user + cpuUsage.system,
    elapsedNanoseconds,
    executedInstructions: result.executedInstructions,
    guestCycles: result.cpuCycles,
    registerChecksum:
      registers.eax ^ registers.ebx ^ registers.ecx ^ registers.edx,
  });
}
