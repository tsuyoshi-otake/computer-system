import { describe, expect, it } from "vitest";
import type {
  Cs486FunctionSignature,
  Cs486Instruction,
} from "../../src/domain/cpu/cs486.js";
import { Cs486Fault } from "../../src/domain/cpu/cs486.js";
import {
  cs486WasmFaultCode,
  cs486WasmInstructionFlag,
  cs486WasmOpcode,
} from "../../tools/cs486-wasm-batch-executor-abi.js";
import type { Cs486WasmColdOpMachine } from "../../tools/cs486-wasm-cold-op-bridge.js";
import {
  cs486WasmFaultToError,
  cs486WasmMaximumOutputBytes,
  executeCs486WasmColdInstruction,
} from "../../tools/cs486-wasm-cold-op-bridge.js";

interface FakeMachineOptions {
  readonly baseCycles?: number;
  readonly executionFlags?: number;
  readonly functionEntries?: ReadonlyMap<number, Cs486FunctionSignature>;
  readonly initialOutputLength?: number;
  readonly instruction: Cs486Instruction;
  readonly instructionCount?: number;
  readonly instructionIndex?: number;
  readonly memoryBytes?: number;
  readonly opcode: number;
  readonly operandA?: number;
  readonly registers?: readonly (readonly [number, number])[];
  readonly stackFloorBytes?: number;
}

interface FakeMachineState {
  readonly events: string[];
  readonly ramWrites: { readonly address: number; readonly value: number }[];
  readonly registers: Int32Array;
  instructionPointer: number;
  output: string;
}

function createFakeMachine(options: FakeMachineOptions): {
  machine: Cs486WasmColdOpMachine;
  state: FakeMachineState;
} {
  const state: FakeMachineState = {
    events: [],
    instructionPointer: -1,
    output: "",
    ramWrites: [],
    registers: new Int32Array(8),
  };
  for (const [index, value] of options.registers ?? [])
    state.registers[index] = value;
  const initialOutputLength = options.initialOutputLength ?? 0;
  const machine: Cs486WasmColdOpMachine = {
    accessData(address, kind) {
      state.events.push(`access:${kind}:${String(address)}`);
      return 5;
    },
    appendOutput(text) {
      state.output += text;
      return initialOutputLength + state.output.length;
    },
    baseCycles: options.baseCycles ?? 1,
    executionFlags: options.executionFlags ?? 0,
    fetchInstruction(index) {
      state.events.push(`fetch:${String(index)}`);
      return 7;
    },
    functionEntries: options.functionEntries ?? new Map(),
    getRegister(index) {
      return state.registers[index]!;
    },
    instruction: options.instruction,
    instructionCount: options.instructionCount ?? 18,
    instructionIndex: options.instructionIndex ?? 4,
    memoryBytes: options.memoryBytes ?? 65_536,
    opcode: options.opcode,
    operandA: options.operandA ?? 0,
    recordControlTransfer(taken) {
      state.events.push(`transfer:${String(taken)}`);
    },
    setInstructionPointer(value) {
      state.instructionPointer = value;
    },
    setRegister(index, value) {
      state.registers[index] = value;
    },
    stackFloorBytes: options.stackFloorBytes ?? 0,
    writeRamInt32(address, value) {
      state.ramWrites.push({ address, value });
    },
  };
  return { machine, state };
}

function captureFault(run: () => void): Cs486Fault {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(Cs486Fault);
  return caught as Cs486Fault;
}

describe("cs486 wasm cold-op bridge", () => {
  it("completes on halt with base plus fetch cycles", () => {
    const { machine, state } = createFakeMachine({
      baseCycles: 5,
      executionFlags: cs486WasmInstructionFlag.coldExit,
      instruction: { op: "halt" },
      instructionIndex: 17,
      opcode: cs486WasmOpcode.halt,
    });
    const result = executeCs486WasmColdInstruction(machine);
    expect(result).toEqual({ cycles: 12, kind: "completed" });
    expect(state.instructionPointer).toBe(18);
    expect(state.events).toEqual(["fetch:17", "transfer:false"]);
  });

  it("prints literal strings, immediates, and register values", () => {
    const literal = createFakeMachine({
      baseCycles: 9,
      executionFlags: cs486WasmInstructionFlag.coldExit,
      instruction: { op: "print", source: "hi" },
      opcode: cs486WasmOpcode.printString,
    });
    expect(executeCs486WasmColdInstruction(literal.machine)).toEqual({
      cycles: 16,
      kind: "executed",
    });
    expect(literal.state.output).toBe("hi");

    const immediate = createFakeMachine({
      executionFlags: cs486WasmInstructionFlag.coldExit,
      instruction: {
        op: "print",
        source: { kind: "immediate", value: -12 },
      },
      opcode: cs486WasmOpcode.printImmediate,
      operandA: -12,
    });
    executeCs486WasmColdInstruction(immediate.machine);
    expect(immediate.state.output).toBe("-12");

    const register = createFakeMachine({
      executionFlags: cs486WasmInstructionFlag.coldExit,
      instruction: {
        op: "print",
        source: { kind: "register", register: "edi" },
      },
      opcode: cs486WasmOpcode.printRegister,
      operandA: 5,
      registers: [[5, 99]],
    });
    executeCs486WasmColdInstruction(register.machine);
    expect(register.state.output).toBe("99");
  });

  it("enforces the 64,000 code-unit output ceiling exactly", () => {
    const atLimit = createFakeMachine({
      initialOutputLength: cs486WasmMaximumOutputBytes - 2,
      instruction: { op: "print", source: "hi" },
      opcode: cs486WasmOpcode.printString,
    });
    expect(() => executeCs486WasmColdInstruction(atLimit.machine)).not.toThrow(
      Cs486Fault,
    );

    const overLimit = createFakeMachine({
      initialOutputLength: cs486WasmMaximumOutputBytes - 1,
      instruction: { op: "print", source: "hi" },
      opcode: cs486WasmOpcode.printString,
    });
    const fault = captureFault(() =>
      executeCs486WasmColdInstruction(overLimit.machine),
    );
    expect(fault.typeName).toBe("OutputLimitError");
    expect(fault.message).toBe("output limit exceeded");
  });

  it("executes cs.print.character with scalar-value validation", () => {
    const printable = createFakeMachine({
      instruction: { name: "cs.print.character", op: "syscall" },
      opcode: cs486WasmOpcode.syscall,
      registers: [[0, 0x41]],
    });
    expect(executeCs486WasmColdInstruction(printable.machine)).toEqual({
      cycles: 8,
      kind: "executed",
    });
    expect(printable.state.output).toBe("A");

    for (const codePoint of [-1, 0xd8_00, 0xdf_ff, 0x11_00_00]) {
      const invalid = createFakeMachine({
        instruction: { name: "cs.print.character", op: "syscall" },
        opcode: cs486WasmOpcode.syscall,
        registers: [[0, codePoint]],
      });
      const fault = captureFault(() =>
        executeCs486WasmColdInstruction(invalid.machine),
      );
      expect(fault.typeName).toBe("OutputLimitError");
      expect(fault.message).toBe("invalid Unicode code point");
      expect(invalid.state.output).toBe("");
    }

    const maximum = createFakeMachine({
      instruction: { name: "cs.print.character", op: "syscall" },
      opcode: cs486WasmOpcode.syscall,
      registers: [[0, 0x10_ff_ff]],
    });
    executeCs486WasmColdInstruction(maximum.machine);
    expect(maximum.state.output).toBe(String.fromCodePoint(0x10_ff_ff));
  });

  it("reports unavailable syscalls with the production wording", () => {
    const { machine } = createFakeMachine({
      instruction: { name: "cs.time.read", op: "syscall" },
      opcode: cs486WasmOpcode.syscall,
    });
    const fault = captureFault(() => executeCs486WasmColdInstruction(machine));
    expect(fault.typeName).toBe("UnsupportedError");
    expect(fault.message).toBe("syscall cs.time.read is unavailable");
  });

  it("refuses deterministic-float syscalls with a host error", () => {
    const { machine } = createFakeMachine({
      instruction: { name: "cs.fp.f64.add", op: "syscall" },
      opcode: cs486WasmOpcode.syscall,
    });
    let caught: unknown;
    try {
      executeCs486WasmColdInstruction(machine);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(Cs486Fault);
    expect((caught as Error).message).toContain("deterministic float");
  });

  it("executes immediate and register indirect calls", () => {
    const entries = new Map<number, Cs486FunctionSignature>([
      [13, "(i32)->i32"],
    ]);
    const immediate = createFakeMachine({
      baseCycles: 3,
      executionFlags:
        cs486WasmInstructionFlag.unconditionalControlTransfer |
        cs486WasmInstructionFlag.coldExit,
      functionEntries: entries,
      instruction: {
        functionSignature: "(i32)->i32",
        op: "call_indirect",
        source: { kind: "immediate", value: 13 },
      },
      instructionIndex: 12,
      opcode: cs486WasmOpcode.callIndirectImmediate,
      operandA: 13,
      registers: [[6, 65_536]],
    });
    const result = executeCs486WasmColdInstruction(immediate.machine);
    expect(result).toEqual({ cycles: 15, kind: "executed" });
    expect(immediate.state.instructionPointer).toBe(13);
    expect(immediate.state.registers[6]).toBe(65_532);
    expect(immediate.state.ramWrites).toEqual([{ address: 65_532, value: 13 }]);
    expect(immediate.state.events).toEqual([
      "fetch:12",
      "transfer:true",
      "access:write:65532",
    ]);

    const register = createFakeMachine({
      baseCycles: 3,
      executionFlags:
        cs486WasmInstructionFlag.unconditionalControlTransfer |
        cs486WasmInstructionFlag.coldExit,
      functionEntries: entries,
      instruction: {
        functionSignature: "(i32)->i32",
        op: "call_indirect",
        source: { kind: "register", register: "ecx" },
      },
      instructionIndex: 12,
      opcode: cs486WasmOpcode.callIndirectRegister,
      operandA: 2,
      registers: [
        [2, 13],
        [6, 65_536],
      ],
    });
    executeCs486WasmColdInstruction(register.machine);
    expect(register.state.instructionPointer).toBe(13);
  });

  it("faults indirect calls to unadmitted or mismatched entries", () => {
    const unadmitted = createFakeMachine({
      executionFlags:
        cs486WasmInstructionFlag.unconditionalControlTransfer |
        cs486WasmInstructionFlag.coldExit,
      instruction: {
        functionSignature: "(i32)->i32",
        op: "call_indirect",
        source: { kind: "immediate", value: 13 },
      },
      opcode: cs486WasmOpcode.callIndirectImmediate,
      operandA: 13,
      registers: [[6, 65_536]],
    });
    const missing = captureFault(() =>
      executeCs486WasmColdInstruction(unadmitted.machine),
    );
    expect(missing.typeName).toBe("InvalidFunctionPointerError");
    expect(missing.message).toBe(
      "indirect call target 13 is not an admitted function entry",
    );
    expect(unadmitted.state.registers[6]).toBe(65_536);
    expect(unadmitted.state.ramWrites).toEqual([]);

    const mismatched = createFakeMachine({
      executionFlags:
        cs486WasmInstructionFlag.unconditionalControlTransfer |
        cs486WasmInstructionFlag.coldExit,
      functionEntries: new Map<number, Cs486FunctionSignature>([
        [13, "(i32,i32)->i32"],
      ]),
      instruction: {
        functionSignature: "(i32)->i32",
        op: "call_indirect",
        source: { kind: "immediate", value: 13 },
      },
      opcode: cs486WasmOpcode.callIndirectImmediate,
      operandA: 13,
      registers: [[6, 65_536]],
    });
    const conflicting = captureFault(() =>
      executeCs486WasmColdInstruction(mismatched.machine),
    );
    expect(conflicting.typeName).toBe("FunctionSignatureMismatchError");
    expect(conflicting.message).toBe(
      "indirect call target 13 has signature (i32,i32)->i32, expected (i32)->i32",
    );
  });

  it("faults indirect calls that overflow the guest stack", () => {
    const { machine, state } = createFakeMachine({
      functionEntries: new Map<number, Cs486FunctionSignature>([
        [13, "(i32)->i32"],
      ]),
      instruction: {
        functionSignature: "(i32)->i32",
        op: "call_indirect",
        source: { kind: "immediate", value: 13 },
      },
      opcode: cs486WasmOpcode.callIndirectImmediate,
      operandA: 13,
      registers: [[6, 10]],
      stackFloorBytes: 8,
    });
    const fault = captureFault(() => executeCs486WasmColdInstruction(machine));
    expect(fault.typeName).toBe("StackOverflowError");
    expect(fault.message).toBe("stack overflow");
    expect(state.registers[6]).toBe(10);
    expect(state.ramWrites).toEqual([]);
  });

  it("rejects opcodes the wasm loop should have executed", () => {
    const { machine } = createFakeMachine({
      instruction: { op: "halt" },
      opcode: cs486WasmOpcode.addImmediate,
    });
    const fault = captureFault(() => executeCs486WasmColdInstruction(machine));
    expect(fault.typeName).toBe("ExecutableFormatError");
    expect(fault.message).toBe("invalid prepared instruction opcode");
  });

  it("reconstructs every production fault identity from exit records", () => {
    const cases: readonly (readonly [number, number, string, string])[] = [
      [
        cs486WasmFaultCode.memoryAccess,
        70_000,
        "MemoryAccessError",
        "address 70000 is outside RAM",
      ],
      [
        cs486WasmFaultCode.memoryAlignment,
        3,
        "MemoryAlignmentError",
        "address 3 is not aligned to 2 bytes",
      ],
      [
        cs486WasmFaultCode.stackOverflow,
        0,
        "StackOverflowError",
        "stack overflow",
      ],
      [
        cs486WasmFaultCode.stackUnderflow,
        0,
        "StackUnderflowError",
        "stack underflow",
      ],
      [
        cs486WasmFaultCode.divisionByZero,
        0,
        "DivisionByZeroError",
        "division by zero",
      ],
      [
        cs486WasmFaultCode.instructionRange,
        19,
        "ExecutableFormatError",
        "instruction pointer 19 is outside executable range 0..18",
      ],
      [
        cs486WasmFaultCode.returnTargetRange,
        99,
        "ExecutableFormatError",
        "instruction pointer 99 is outside executable instruction range 0..17",
      ],
    ];
    for (const [code, operand, typeName, message] of cases) {
      const fault = cs486WasmFaultToError(code, operand, 18);
      expect(fault).toBeInstanceOf(Cs486Fault);
      expect(fault.typeName).toBe(typeName);
      expect(fault.message).toBe(message);
    }
    const empty = cs486WasmFaultToError(
      cs486WasmFaultCode.returnTargetRange,
      5,
      0,
    );
    expect(empty.message).toBe(
      "instruction pointer 5 cannot target empty executable text",
    );
    expect(() => cs486WasmFaultToError(99, 0, 18)).toThrow(
      /unknown cs486 wasm fault code 99/u,
    );
  });
});
