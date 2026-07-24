import type { Cs486Instruction } from "../src/domain/cpu/cs486.js";
import { Cs486Fault } from "../src/domain/cpu/cs486.js";
import {
  cs486WasmFaultCode,
  cs486WasmInstructionFlag,
  cs486WasmOpcode,
} from "./cs486-wasm-batch-executor-abi.js";

/**
 * TypeScript execution of the seven cold opcodes the wasm batch executor
 * exits on (`call_indirect`, `syscall`, three `print` forms, `halt`) plus
 * reconstruction of production fault identities from numeric wasm fault
 * codes. Semantics are a line-for-line mirror of the production
 * `executeNext` paths; the production interpreter itself stays untouched.
 */
const espRegisterIndex = 6;
const eaxRegisterIndex = 0;

/** Mirrors the production process's private output ceiling. */
export const cs486WasmMaximumOutputBytes = 64_000;

const floatSyscallPattern = /^cs\.fp\.(?:f32|f64)\.[a-z0-9.]+$/u;

export interface Cs486WasmColdOpMachine {
  /** Prepared base cycle cost of the cold instruction. */
  readonly baseCycles: number;
  readonly executionFlags: number;
  readonly functionEntries: ReadonlyMap<number, string>;
  /** Original instruction object (for syscall names and print strings). */
  readonly instruction: Cs486Instruction;
  readonly instructionCount: number;
  /** Index of the cold instruction; must equal the current wasm pc. */
  readonly instructionIndex: number;
  readonly memoryBytes: number;
  readonly opcode: number;
  readonly operandA: number;
  readonly stackFloorBytes: number;
  /** Charges modeled data-access cycles through the wasm cache state. */
  accessData(address: number, kind: "read" | "write"): number;
  /** Appends text and returns the total output length after the append. */
  appendOutput(text: string): number;
  fetchInstruction(index: number): number;
  getRegister(index: number): number;
  recordControlTransfer(taken: boolean): void;
  setInstructionPointer(value: number): void;
  setRegister(index: number, value: number): void;
  writeRamInt32(address: number, value: number): void;
}

export type Cs486WasmColdOpResult = {
  readonly cycles: number;
  readonly kind: "completed" | "executed";
};

/**
 * Executes one cold instruction. Guest faults throw `Cs486Fault` exactly as
 * the production interpreter would; the caller owns the crash transition and
 * discards the partially accumulated cycles, matching production accounting.
 * Deterministic-float syscalls throw a host `Error` because delegating them
 * to this prototype would silently bypass the BigInt rational float model.
 */
export function executeCs486WasmColdInstruction(
  machine: Cs486WasmColdOpMachine,
): Cs486WasmColdOpResult {
  const index = machine.instructionIndex;
  machine.setInstructionPointer(index + 1);
  let cycles = machine.baseCycles + machine.fetchInstruction(index);
  machine.recordControlTransfer(
    (machine.executionFlags &
      cs486WasmInstructionFlag.unconditionalControlTransfer) !==
      0,
  );
  switch (machine.opcode) {
    case cs486WasmOpcode.callIndirectImmediate:
    case cs486WasmOpcode.callIndirectRegister: {
      const instruction = machine.instruction as Extract<
        Cs486Instruction,
        { readonly op: "call_indirect" }
      >;
      const value =
        machine.opcode === cs486WasmOpcode.callIndirectImmediate
          ? machine.operandA
          : machine.getRegister(machine.operandA);
      const actualSignature = machine.functionEntries.get(value);
      if (actualSignature === undefined)
        throw new Cs486Fault(
          "InvalidFunctionPointerError",
          `indirect call target ${String(value)} is not an admitted function entry`,
        );
      if (actualSignature !== instruction.functionSignature)
        throw new Cs486Fault(
          "FunctionSignatureMismatchError",
          `indirect call target ${String(value)} has signature ${actualSignature}, expected ${instruction.functionSignature}`,
        );
      cycles += pushValue(machine, index + 1);
      machine.setInstructionPointer(value);
      return { cycles, kind: "executed" };
    }
    case cs486WasmOpcode.syscall: {
      const name = (
        machine.instruction as Extract<
          Cs486Instruction,
          { readonly op: "syscall" }
        >
      ).name;
      if (name === "cs.print.character") {
        const codePoint = machine.getRegister(eaxRegisterIndex);
        if (
          codePoint < 0 ||
          codePoint > 0x10_ff_ff ||
          (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
        )
          throw new Cs486Fault(
            "OutputLimitError",
            "invalid Unicode code point",
          );
        if (
          machine.appendOutput(String.fromCodePoint(codePoint)) >
          cs486WasmMaximumOutputBytes
        )
          throw new Cs486Fault("OutputLimitError", "output limit exceeded");
        return { cycles, kind: "executed" };
      }
      if (floatSyscallPattern.test(name))
        throw new Error(
          `cs486 wasm prototype does not execute float syscall ${name}; deterministic float stays on the TypeScript interpreter`,
        );
      throw new Cs486Fault(
        "UnsupportedError",
        `syscall ${name} is unavailable`,
      );
    }
    case cs486WasmOpcode.printString: {
      const source = (
        machine.instruction as Extract<
          Cs486Instruction,
          { readonly op: "print" }
        >
      ).source as string;
      if (machine.appendOutput(source) > cs486WasmMaximumOutputBytes)
        throw new Cs486Fault("OutputLimitError", "output limit exceeded");
      return { cycles, kind: "executed" };
    }
    case cs486WasmOpcode.printImmediate:
      if (
        machine.appendOutput(String(machine.operandA)) >
        cs486WasmMaximumOutputBytes
      )
        throw new Cs486Fault("OutputLimitError", "output limit exceeded");
      return { cycles, kind: "executed" };
    case cs486WasmOpcode.printRegister:
      if (
        machine.appendOutput(String(machine.getRegister(machine.operandA))) >
        cs486WasmMaximumOutputBytes
      )
        throw new Cs486Fault("OutputLimitError", "output limit exceeded");
      return { cycles, kind: "executed" };
    case cs486WasmOpcode.halt:
      return { cycles, kind: "completed" };
    default:
      throw new Cs486Fault(
        "ExecutableFormatError",
        "invalid prepared instruction opcode",
      );
  }
}

function pushValue(machine: Cs486WasmColdOpMachine, value: number): number {
  const next = machine.getRegister(espRegisterIndex) - 4;
  if (next < machine.stackFloorBytes || next + 4 > machine.memoryBytes)
    throw new Cs486Fault("StackOverflowError", "stack overflow");
  const cycles = machine.accessData(next, "write");
  machine.writeRamInt32(next, value);
  machine.setRegister(espRegisterIndex, next);
  return cycles;
}

/**
 * Rebuilds the exact production fault type and message from a wasm exit
 * record. `faultOperand` carries the faulting address or instruction target
 * and `instructionCount` restores the range wording.
 */
export function cs486WasmFaultToError(
  faultCode: number,
  faultOperand: number,
  instructionCount: number,
): Cs486Fault {
  switch (faultCode) {
    case cs486WasmFaultCode.memoryAccess:
      return new Cs486Fault(
        "MemoryAccessError",
        `address ${String(faultOperand)} is outside RAM`,
      );
    case cs486WasmFaultCode.memoryAlignment:
      return new Cs486Fault(
        "MemoryAlignmentError",
        `address ${String(faultOperand)} is not aligned to 2 bytes`,
      );
    case cs486WasmFaultCode.stackOverflow:
      return new Cs486Fault("StackOverflowError", "stack overflow");
    case cs486WasmFaultCode.stackUnderflow:
      return new Cs486Fault("StackUnderflowError", "stack underflow");
    case cs486WasmFaultCode.divisionByZero:
      return new Cs486Fault("DivisionByZeroError", "division by zero");
    case cs486WasmFaultCode.instructionRange:
      return new Cs486Fault(
        "ExecutableFormatError",
        `instruction pointer ${String(faultOperand)} is outside executable range 0..${String(instructionCount)}`,
      );
    case cs486WasmFaultCode.returnTargetRange:
      return new Cs486Fault(
        "ExecutableFormatError",
        instructionCount === 0
          ? `instruction pointer ${String(faultOperand)} cannot target empty executable text`
          : `instruction pointer ${String(faultOperand)} is outside executable instruction range 0..${String(instructionCount - 1)}`,
      );
    default:
      throw new Error(
        `unknown cs486 wasm fault code ${String(faultCode)} (operand ${String(faultOperand)})`,
      );
  }
}
