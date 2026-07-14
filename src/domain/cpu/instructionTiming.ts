import type { Cs486Instruction } from "./instructionSet.js";
import type { CpuModel } from "./models.js";

export interface InstructionTimingContext {
  readonly branchTaken?: boolean;
  readonly multiplier?: number;
}

/**
 * Deterministic O(1) instruction timing for the selected Computer System CPU.
 * CS386SX arithmetic follows Intel 80386 clocks. Four-byte RAM and stack
 * transfers pay an additional bus cycle pair for the 386SX 16-bit data bus.
 * CS486DX2 retains the CS486DX instruction costs at twice the nominal clock.
 * CS-only print/syscall costs remain explicit sandbox-runtime charges.
 */
export function instructionCycleCost(
  model: CpuModel,
  instruction: Cs486Instruction,
  context: InstructionTimingContext = {},
): number {
  return model === "cs386sx"
    ? cs386sxInstructionCycleCost(instruction, context)
    : cs486dxInstructionCycleCost(instruction, context);
}

function cs486dxInstructionCycleCost(
  instruction: Cs486Instruction,
  context: InstructionTimingContext = {},
): number {
  switch (instruction.op) {
    case "load":
    case "store":
    case "push":
    case "pop":
      return 2;
    case "mul":
      return 9;
    case "div":
    case "mod":
      return 40;
    case "call":
    case "ret":
      return 3;
    case "jmp":
      return 3;
    case "je":
    case "jne":
    case "jl":
    case "jle":
    case "jg":
    case "jge":
      return context.branchTaken === true ? 3 : 1;
    case "syscall":
      return 8;
    case "print":
      return 8 + printedTransferUnits(instruction, 4);
    default:
      return 1;
  }
}

function cs386sxInstructionCycleCost(
  instruction: Cs486Instruction,
  context: InstructionTimingContext,
): number {
  switch (instruction.op) {
    case "load":
      return 6;
    case "store":
      return 4;
    case "push":
      return 4;
    case "pop":
      return 6;
    case "mul":
      return cs386EarlyOutMultiplyCycles(context.multiplier ?? 0);
    case "div":
    case "mod":
      return 43;
    case "shl":
    case "shr":
      return 3;
    case "jmp":
      return 7;
    case "je":
    case "jne":
    case "jl":
    case "jle":
    case "jg":
    case "jge":
      return context.branchTaken === true ? 7 : 3;
    case "call":
      return 9;
    case "ret":
      return 12;
    case "halt":
      return 5;
    case "syscall":
      return 12;
    case "print":
      return 12 + printedTransferUnits(instruction, 2);
    default:
      return 2;
  }
}

function cs386EarlyOutMultiplyCycles(multiplier: number): number {
  const normalized = multiplier | 0;
  if (normalized === 0) return 9;
  const significantBits = Math.ceil(Math.log2(Math.abs(normalized)));
  return Math.min(38, Math.max(significantBits, 3) + 6);
}

function printedTransferUnits(
  instruction: Extract<Cs486Instruction, { readonly op: "print" }>,
  bytesPerUnit: number,
): number {
  return typeof instruction.source === "string"
    ? Math.ceil(instruction.source.length / bytesPerUnit)
    : 1;
}
