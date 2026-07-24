import { describe, expect, it } from "vitest";
import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";
import {
  Cs486Fault,
  createCs486Flat32MemoryMetadata,
  cs486ExecutableMemoryRequirements,
} from "../../src/domain/cpu/cs486.js";
import { cs486WasmInstructionFlag } from "../../tools/cs486-wasm-batch-executor-abi.js";
import {
  deriveCs486WasmProcessLayout,
  prepareCs486WasmInstructions,
} from "../../tools/cs486-wasm-batch-executor-prep.js";

// call_indirect and function entries need executable v4+ and sub-word
// loads/stores need v5+, so the full-ISA fixture is a declared v5 executable.
const sampleExecutable: Cs486Executable = {
  dataBytes: 6,
  dataModel: "cs-byte8-v1",
  format: "cs486-executable",
  functionEntries: [{ address: 13, functionSignature: "(i32)->i32" }],
  initialData: [{ bytes: [1, 2, 3, 4], offset: 0 }],
  instructions: [
    /* 0 */ {
      destination: "eax",
      op: "mov",
      source: { kind: "immediate", value: -5 },
    },
    /* 1 */ {
      destination: "ebx",
      op: "mov",
      source: { kind: "register", register: "eax" },
    },
    /* 2 */ {
      address: { kind: "immediate", value: 0 },
      destination: "ecx",
      op: "load",
    },
    /* 3 */ {
      address: { kind: "register", register: "ecx" },
      op: "store16",
      source: "edx",
    },
    /* 4 */ {
      destination: "eax",
      op: "add",
      source: { kind: "register", register: "ebx" },
    },
    /* 5 */ {
      destination: "eax",
      op: "mul",
      source: { kind: "immediate", value: 3 },
    },
    /* 6 */ { left: "eax", op: "cmp", right: { kind: "immediate", value: 7 } },
    /* 7 */ { op: "je", target: 0 },
    /* 8 */ { op: "jmp", target: 9 },
    /* 9 */ { op: "push", source: { kind: "immediate", value: 42 } },
    /* 10 */ { destination: "esi", op: "pop" },
    /* 11 */ { op: "call", target: 13 },
    /* 12 */ {
      functionSignature: "(i32)->i32",
      op: "call_indirect",
      source: { kind: "immediate", value: 13 },
    },
    /* 13 */ { op: "ret" },
    /* 14 */ { name: "cs.print.character", op: "syscall" },
    /* 15 */ { op: "print", source: "hi" },
    /* 16 */ {
      op: "print",
      source: { kind: "register", register: "edi" },
    },
    /* 17 */ { op: "halt" },
  ],
  memory: createCs486Flat32MemoryMetadata({
    heapBytes: 4_096,
    stackBytes: 65_536,
  }),
  version: 5,
};

const legacyExecutable: Cs486Executable = {
  dataBytes: 6,
  format: "cs486-executable",
  initialData: [{ bytes: [1, 2, 3, 4], offset: 0 }],
  instructions: [
    {
      destination: "eax",
      op: "mov",
      source: { kind: "immediate", value: -5 },
    },
    { op: "halt" },
  ],
  version: 2,
};

describe("cs486 wasm batch-executor prep", () => {
  it("re-derives the SoA instruction tables for CS486DX", () => {
    const prepared = prepareCs486WasmInstructions(sampleExecutable, "cs486dx");
    expect(Array.from(prepared.opcodes)).toEqual([
      1, 2, 3, 18, 20, 23, 45, 47, 53, 54, 56, 57, 58, 60, 61, 62, 64, 65,
    ]);
    expect(Array.from(prepared.executionFlags)).toEqual([
      0,
      0,
      0,
      0,
      0,
      cs486WasmInstructionFlag.dynamicMultiply,
      0,
      cs486WasmInstructionFlag.conditionalBranch,
      cs486WasmInstructionFlag.unconditionalControlTransfer,
      0,
      0,
      cs486WasmInstructionFlag.unconditionalControlTransfer,
      cs486WasmInstructionFlag.unconditionalControlTransfer |
        cs486WasmInstructionFlag.coldExit,
      cs486WasmInstructionFlag.unconditionalControlTransfer,
      cs486WasmInstructionFlag.coldExit,
      cs486WasmInstructionFlag.coldExit,
      cs486WasmInstructionFlag.coldExit,
      cs486WasmInstructionFlag.coldExit,
    ]);
    expect(Array.from(prepared.operandA)).toEqual([
      0, 1, 2, 2, 0, 0, 0, 0, 9, 42, 4, 13, 13, 0, 0, 0, 5, 0,
    ]);
    expect(Array.from(prepared.operandB)).toEqual([
      -5, 0, 0, 3, 1, 3, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(Array.from(prepared.baseCycles)).toEqual([
      1, 1, 2, 2, 1, 9, 1, 1, 3, 2, 2, 3, 3, 3, 8, 9, 9, 1,
    ]);
    expect(Array.from(prepared.branchCycleDeltas)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("re-derives CS386SX cycle costs including branch deltas", () => {
    const prepared = prepareCs486WasmInstructions(sampleExecutable, "cs386sx");
    expect(Array.from(prepared.baseCycles)).toEqual([
      2, 2, 6, 3, 2, 9, 2, 3, 7, 4, 6, 9, 9, 12, 12, 13, 13, 5,
    ]);
    expect(Array.from(prepared.branchCycleDeltas)).toEqual([
      0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
  });

  it("derives the legacy process memory layout exactly", () => {
    const layout = deriveCs486WasmProcessLayout(legacyExecutable, {
      memoryBytes: 65_536,
    });
    expect(layout.cpuModel).toBe("cs486dx");
    expect(layout.memoryBytes).toBe(65_536);
    expect(layout.stackFloorBytes).toBe(8);
    expect(layout.heapBaseBytes).toBe(8);
    expect(layout.initialRam).toHaveLength(65_536);
    expect(Array.from(layout.initialRam.slice(0, 6))).toEqual([
      1, 2, 3, 4, 0, 0,
    ]);
    expect(Array.from(layout.initialRegisters)).toEqual([
      0, 0, 0, 0, 0, 0, 65_536, 65_536,
    ]);
    expect(layout.functionEntries.size).toBe(0);
  });

  it("clamps available RAM to the selected CPU model", () => {
    const layout = deriveCs486WasmProcessLayout(legacyExecutable, {
      cpuModel: "cs386sx",
      memoryBytes: 64 * 1_048_576,
    });
    expect(layout.cpuModel).toBe("cs386sx");
    expect(layout.memoryBytes).toBe(16 * 1_048_576);
    expect(layout.initialRegisters[6]).toBe(16 * 1_048_576);
  });

  it("derives declared flat32 layouts from the production requirements", () => {
    const requirements = cs486ExecutableMemoryRequirements(sampleExecutable);
    if (requirements.kind !== "declared")
      throw new Error("expected declared memory requirements");
    const layout = deriveCs486WasmProcessLayout(sampleExecutable, {
      memoryBytes: 16 * 1_048_576,
    });
    expect(layout.memoryBytes).toBe(requirements.linearAddressSpaceBytes);
    expect(layout.stackFloorBytes).toBe(
      requirements.alignedDataBytes + requirements.heapBytes,
    );
    expect(layout.heapBaseBytes).toBe(requirements.alignedDataBytes);
    expect(layout.initialRegisters[6]).toBe(layout.memoryBytes);
    expect(Array.from(layout.initialRam.slice(0, 6))).toEqual([
      1, 2, 3, 4, 0, 0,
    ]);
    expect(layout.functionEntries.size).toBe(1);
    expect(layout.functionEntries.get(13)).toBe("(i32)->i32");
  });

  it("rejects sub-64KiB RAM like the production process", () => {
    expect(() =>
      deriveCs486WasmProcessLayout(legacyExecutable, { memoryBytes: 65_535 }),
    ).toThrow(/at least 64 KiB RAM/u);
  });

  it("rejects executables whose data exceeds available RAM", () => {
    const oversized: Cs486Executable = {
      dataBytes: 70_000,
      format: "cs486-executable",
      instructions: [{ op: "halt" }],
      version: 2,
    };
    let caught: unknown;
    try {
      deriveCs486WasmProcessLayout(oversized, { memoryBytes: 65_536 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Cs486Fault);
    expect((caught as Cs486Fault).typeName).toBe("MemoryAccessError");
    expect((caught as Cs486Fault).message).toBe(
      "executable data exceeds available RAM",
    );
  });
});
