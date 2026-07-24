import type {
  Cs486Executable,
  Cs486FunctionSignature,
  Cs486Register,
} from "../src/domain/cpu/cs486.js";
import {
  Cs486Fault,
  cs486ExecutableMemoryRequirements,
  defaultCs486StackBytes,
  maximumCs486LinearAddressSpaceBytes,
} from "../src/domain/cpu/cs486.js";
import { cs486RegisterNames } from "../src/domain/cpu/instructionSet.js";
import { instructionCycleCost } from "../src/domain/cpu/instructionTiming.js";
import type { CpuModel } from "../src/domain/cpu/models.js";
import {
  cpuModelSpecification,
  defaultCpuModel,
} from "../src/domain/cpu/models.js";
import {
  cs486WasmInstructionFlag,
  cs486WasmOpcode,
} from "./cs486-wasm-batch-executor-abi.js";

/**
 * Host-side preparation for the gated Issue #106 wasm batch-executor
 * prototype. It derives the SoA instruction tables and the process memory
 * image exclusively from the public `Cs486Executable` surface plus
 * `instructionCycleCost`, so the production interpreter in
 * `src/domain/cpu/cs486.ts` stays untouched.
 */
export interface Cs486WasmPreparedInstructions {
  readonly baseCycles: Uint32Array;
  readonly branchCycleDeltas: Uint8Array;
  readonly executionFlags: Uint8Array;
  readonly opcodes: Uint8Array;
  readonly operandA: Int32Array;
  readonly operandB: Int32Array;
}

const registerIndexByName = new Map<Cs486Register, number>(
  cs486RegisterNames.map((name, index) => [name, index]),
);

function registerIndex(register: Cs486Register): number {
  const index = registerIndexByName.get(register);
  if (index === undefined)
    throw new Cs486Fault(
      "ExecutableFormatError",
      `unknown CS486 register ${String(register)}`,
    );
  return index;
}

const loadOpcodeByOp = {
  load: [cs486WasmOpcode.loadImmediate, cs486WasmOpcode.loadRegister],
  load16s: [
    cs486WasmOpcode.load16SignedImmediate,
    cs486WasmOpcode.load16SignedRegister,
  ],
  load16u: [
    cs486WasmOpcode.load16UnsignedImmediate,
    cs486WasmOpcode.load16UnsignedRegister,
  ],
  load8s: [
    cs486WasmOpcode.load8SignedImmediate,
    cs486WasmOpcode.load8SignedRegister,
  ],
  load8u: [
    cs486WasmOpcode.load8UnsignedImmediate,
    cs486WasmOpcode.load8UnsignedRegister,
  ],
} as const;

const storeOpcodeByOp = {
  store: [cs486WasmOpcode.storeImmediate, cs486WasmOpcode.storeRegister],
  store16: [cs486WasmOpcode.store16Immediate, cs486WasmOpcode.store16Register],
  store8: [cs486WasmOpcode.store8Immediate, cs486WasmOpcode.store8Register],
} as const;

const binaryOpcodeByOp = {
  add: [cs486WasmOpcode.addImmediate, cs486WasmOpcode.addRegister],
  and: [cs486WasmOpcode.andImmediate, cs486WasmOpcode.andRegister],
  div: [cs486WasmOpcode.divideImmediate, cs486WasmOpcode.divideRegister],
  mod: [cs486WasmOpcode.moduloImmediate, cs486WasmOpcode.moduloRegister],
  mul: [cs486WasmOpcode.multiplyImmediate, cs486WasmOpcode.multiplyRegister],
  or: [cs486WasmOpcode.orImmediate, cs486WasmOpcode.orRegister],
  shl: [cs486WasmOpcode.shiftLeftImmediate, cs486WasmOpcode.shiftLeftRegister],
  shr: [
    cs486WasmOpcode.shiftRightImmediate,
    cs486WasmOpcode.shiftRightRegister,
  ],
  sub: [cs486WasmOpcode.subtractImmediate, cs486WasmOpcode.subtractRegister],
  udiv: [
    cs486WasmOpcode.unsignedDivideImmediate,
    cs486WasmOpcode.unsignedDivideRegister,
  ],
  umod: [
    cs486WasmOpcode.unsignedModuloImmediate,
    cs486WasmOpcode.unsignedModuloRegister,
  ],
  ushr: [
    cs486WasmOpcode.unsignedShiftRightImmediate,
    cs486WasmOpcode.unsignedShiftRightRegister,
  ],
  xor: [cs486WasmOpcode.xorImmediate, cs486WasmOpcode.xorRegister],
} as const;

const conditionalBranchOpcodeByOp = {
  je: cs486WasmOpcode.branchEqual,
  jg: cs486WasmOpcode.branchGreater,
  jge: cs486WasmOpcode.branchGreaterOrEqual,
  jl: cs486WasmOpcode.branchLess,
  jle: cs486WasmOpcode.branchLessOrEqual,
  jne: cs486WasmOpcode.branchNotEqual,
} as const;

/**
 * Re-derives the prepared SoA tables from the validated executable. Flag
 * semantics mirror the production interpreter: the conditional-branch and
 * unconditional-control-transfer bits drive branch deltas and pipeline-flush
 * recording, and the dynamic-multiply bit is set model-independently while
 * only the CS386SX executor consumes it at run time. The cold-exit bit is
 * prototype-specific and marks instructions the wasm loop must return to the
 * host bridge instead of executing.
 */
export function prepareCs486WasmInstructions(
  executable: Cs486Executable,
  cpuModel: CpuModel,
): Cs486WasmPreparedInstructions {
  const instructions = executable.instructions;
  const count = instructions.length;
  const opcodes = new Uint8Array(count);
  const executionFlags = new Uint8Array(count);
  const operandA = new Int32Array(count);
  const operandB = new Int32Array(count);
  const baseCycles = new Uint32Array(count);
  const branchCycleDeltas = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    const instruction = instructions[index]!;
    switch (instruction.op) {
      case "mov":
        opcodes[index] =
          instruction.source.kind === "immediate"
            ? cs486WasmOpcode.movImmediate
            : cs486WasmOpcode.movRegister;
        operandA[index] = registerIndex(instruction.destination);
        operandB[index] =
          instruction.source.kind === "immediate"
            ? instruction.source.value
            : registerIndex(instruction.source.register);
        break;
      case "load":
      case "load8s":
      case "load8u":
      case "load16s":
      case "load16u": {
        const [immediateOpcode, registerOpcode] =
          loadOpcodeByOp[instruction.op];
        opcodes[index] =
          instruction.address.kind === "immediate"
            ? immediateOpcode
            : registerOpcode;
        operandA[index] = registerIndex(instruction.destination);
        operandB[index] =
          instruction.address.kind === "immediate"
            ? instruction.address.value
            : registerIndex(instruction.address.register);
        break;
      }
      case "store":
      case "store8":
      case "store16": {
        const [immediateOpcode, registerOpcode] =
          storeOpcodeByOp[instruction.op];
        opcodes[index] =
          instruction.address.kind === "immediate"
            ? immediateOpcode
            : registerOpcode;
        operandA[index] =
          instruction.address.kind === "immediate"
            ? instruction.address.value
            : registerIndex(instruction.address.register);
        operandB[index] = registerIndex(instruction.source);
        break;
      }
      case "add":
      case "sub":
      case "mul":
      case "div":
      case "udiv":
      case "mod":
      case "umod":
      case "and":
      case "or":
      case "xor":
      case "shl":
      case "shr":
      case "ushr": {
        const [immediateOpcode, registerOpcode] =
          binaryOpcodeByOp[instruction.op];
        opcodes[index] =
          instruction.source.kind === "immediate"
            ? immediateOpcode
            : registerOpcode;
        operandA[index] = registerIndex(instruction.destination);
        operandB[index] =
          instruction.source.kind === "immediate"
            ? instruction.source.value
            : registerIndex(instruction.source.register);
        if (instruction.op === "mul")
          executionFlags[index] = cs486WasmInstructionFlag.dynamicMultiply;
        break;
      }
      case "cmp":
        opcodes[index] =
          instruction.right.kind === "immediate"
            ? cs486WasmOpcode.compareImmediate
            : cs486WasmOpcode.compareRegister;
        operandA[index] = registerIndex(instruction.left);
        operandB[index] =
          instruction.right.kind === "immediate"
            ? instruction.right.value
            : registerIndex(instruction.right.register);
        break;
      case "je":
      case "jne":
      case "jl":
      case "jle":
      case "jg":
      case "jge":
        opcodes[index] = conditionalBranchOpcodeByOp[instruction.op];
        operandA[index] = instruction.target;
        executionFlags[index] = cs486WasmInstructionFlag.conditionalBranch;
        break;
      case "jmp":
        opcodes[index] = cs486WasmOpcode.jump;
        operandA[index] = instruction.target;
        executionFlags[index] =
          cs486WasmInstructionFlag.unconditionalControlTransfer;
        break;
      case "push":
        opcodes[index] =
          instruction.source.kind === "immediate"
            ? cs486WasmOpcode.pushImmediate
            : cs486WasmOpcode.pushRegister;
        operandA[index] =
          instruction.source.kind === "immediate"
            ? instruction.source.value
            : registerIndex(instruction.source.register);
        break;
      case "pop":
        opcodes[index] = cs486WasmOpcode.pop;
        operandA[index] = registerIndex(instruction.destination);
        break;
      case "call":
        opcodes[index] = cs486WasmOpcode.call;
        operandA[index] = instruction.target;
        executionFlags[index] =
          cs486WasmInstructionFlag.unconditionalControlTransfer;
        break;
      case "call_indirect":
        opcodes[index] =
          instruction.source.kind === "immediate"
            ? cs486WasmOpcode.callIndirectImmediate
            : cs486WasmOpcode.callIndirectRegister;
        operandA[index] =
          instruction.source.kind === "immediate"
            ? instruction.source.value
            : registerIndex(instruction.source.register);
        executionFlags[index] =
          cs486WasmInstructionFlag.unconditionalControlTransfer |
          cs486WasmInstructionFlag.coldExit;
        break;
      case "ret":
        opcodes[index] = cs486WasmOpcode.return;
        executionFlags[index] =
          cs486WasmInstructionFlag.unconditionalControlTransfer;
        break;
      case "syscall":
        opcodes[index] = cs486WasmOpcode.syscall;
        executionFlags[index] = cs486WasmInstructionFlag.coldExit;
        break;
      case "print":
        opcodes[index] =
          typeof instruction.source === "string"
            ? cs486WasmOpcode.printString
            : instruction.source.kind === "immediate"
              ? cs486WasmOpcode.printImmediate
              : cs486WasmOpcode.printRegister;
        if (typeof instruction.source !== "string")
          operandA[index] =
            instruction.source.kind === "immediate"
              ? instruction.source.value
              : registerIndex(instruction.source.register);
        executionFlags[index] = cs486WasmInstructionFlag.coldExit;
        break;
      case "halt":
        opcodes[index] = cs486WasmOpcode.halt;
        executionFlags[index] = cs486WasmInstructionFlag.coldExit;
        break;
      default: {
        const exhaustive: never = instruction;
        throw new Cs486Fault(
          "ExecutableFormatError",
          `unsupported CS486 instruction ${JSON.stringify(exhaustive)}`,
        );
      }
    }
    const conditional =
      (executionFlags[index]! & cs486WasmInstructionFlag.conditionalBranch) !==
      0;
    if (conditional) {
      const notTaken = instructionCycleCost(cpuModel, instruction, {
        branchTaken: false,
      });
      const taken = instructionCycleCost(cpuModel, instruction, {
        branchTaken: true,
      });
      baseCycles[index] = notTaken;
      branchCycleDeltas[index] = taken - notTaken;
    } else {
      baseCycles[index] = instructionCycleCost(cpuModel, instruction, {});
    }
  }
  return {
    baseCycles,
    branchCycleDeltas,
    executionFlags,
    opcodes,
    operandA,
    operandB,
  };
}

export interface Cs486WasmProcessLayout {
  readonly cpuModel: CpuModel;
  readonly functionEntries: ReadonlyMap<number, Cs486FunctionSignature>;
  readonly heapBaseBytes: number;
  /** Zero-filled RAM image with `initialData` segments already applied. */
  readonly initialRam: Uint8Array;
  /** All zero except `esp`/`ebp`, which start at `memoryBytes`. */
  readonly initialRegisters: Int32Array;
  readonly memoryBytes: number;
  readonly stackFloorBytes: number;
}

/**
 * Mirrors the `Cs486Process` constructor's memory admission exactly: model
 * clamping, declared flat32 reservations, the 64 KiB floor, legacy stack
 * floor alignment, initial data segments, and the `esp`/`ebp` start values.
 */
export function deriveCs486WasmProcessLayout(
  executable: Cs486Executable,
  options: { readonly cpuModel?: CpuModel; readonly memoryBytes: number },
): Cs486WasmProcessLayout {
  const requirements = cs486ExecutableMemoryRequirements(executable);
  const cpuModel = options.cpuModel ?? defaultCpuModel;
  const availableMemoryBytes = Math.min(
    options.memoryBytes,
    maximumCs486LinearAddressSpaceBytes,
    cpuModelSpecification(cpuModel).maximumMemoryBytes,
  );
  if (
    requirements.kind === "declared" &&
    availableMemoryBytes < requirements.linearAddressSpaceBytes
  )
    throw new Cs486Fault(
      "MemoryAccessError",
      "executable linear memory requirement exceeds available RAM",
    );
  if (
    !Number.isSafeInteger(availableMemoryBytes) ||
    availableMemoryBytes < defaultCs486StackBytes
  )
    throw new RangeError("CS486 requires at least 64 KiB RAM");
  const memoryBytes =
    requirements.kind === "declared"
      ? requirements.linearAddressSpaceBytes
      : availableMemoryBytes;
  if ((executable.dataBytes ?? 0) > memoryBytes)
    throw new Cs486Fault(
      "MemoryAccessError",
      "executable data exceeds available RAM",
    );
  const stackFloorBytes =
    requirements.kind === "declared"
      ? requirements.alignedDataBytes + requirements.heapBytes
      : alignCs486Flat32(executable.dataBytes ?? 0);
  const heapBaseBytes =
    requirements.kind === "declared"
      ? requirements.alignedDataBytes
      : stackFloorBytes;
  const initialRam = new Uint8Array(memoryBytes);
  for (const segment of executable.initialData ?? [])
    initialRam.set(segment.bytes, segment.offset);
  const functionEntries = new Map<number, Cs486FunctionSignature>();
  for (const entry of executable.functionEntries ?? [])
    functionEntries.set(entry.address, entry.functionSignature);
  const initialRegisters = new Int32Array(cs486RegisterNames.length);
  const espIndex = registerIndex("esp");
  const ebpIndex = registerIndex("ebp");
  initialRegisters[espIndex] = memoryBytes;
  initialRegisters[ebpIndex] = memoryBytes;
  return {
    cpuModel,
    functionEntries,
    heapBaseBytes,
    initialRam,
    initialRegisters,
    memoryBytes,
    stackFloorBytes,
  };
}

function alignCs486Flat32(value: number): number {
  const remainder = value % 4;
  return remainder === 0 ? value : value + 4 - remainder;
}
