import { describe, expect, it } from "vitest";

import {
  allocateCs486IrRegisters,
  allocateCs486IrRegistersLinearScan,
  assertValidCs486Ir,
  CS486_IR_ALLOCATABLE_REGISTERS,
  CS486_IR_RESERVED_REGISTERS,
  CS486_IR_SCHEDULER_MODE,
  Cs486IrVerificationError,
  optimizeCs486Ir,
  optimizeCs486IrWithReport,
  scheduleCs486IrBlock,
  verifyCs486Ir,
  type Cs486IrAllocatableRegister,
  type Cs486IrBasicBlock,
  type Cs486IrFunction,
  type Cs486IrProgram,
} from "../../src/application/toolchain/cs486Ir.js";
import type { Cs486SourceSpan } from "../../src/application/toolchain/cs486AsmDiagnostics.js";

function singleReturnProgram(): Cs486IrProgram {
  return {
    functions: [
      {
        blocks: [
          {
            id: "entry",
            instructions: [
              { kind: "constant", result: 0, type: "i32", value: 42 },
            ],
            phis: [],
            terminator: { kind: "return", value: 0 },
          },
        ],
        entry: "entry",
        locals: [],
        name: "main",
        parameters: [],
        returnType: "i32",
      },
    ],
  };
}

function diamondProgram(): Cs486IrProgram {
  return {
    functions: [
      {
        blocks: [
          {
            id: "entry",
            instructions: [
              { kind: "constant", result: 0, type: "i1", value: 1 },
            ],
            phis: [],
            terminator: {
              condition: 0,
              falseTarget: "right",
              kind: "branch",
              trueTarget: "left",
            },
          },
          {
            id: "left",
            instructions: [
              { kind: "constant", result: 1, type: "i32", value: 40 },
              { kind: "constant", result: 2, type: "i32", value: 2 },
              {
                kind: "binary",
                left: 1,
                operator: "add",
                result: 3,
                right: 2,
                type: "i32",
              },
              { kind: "constant", result: 4, type: "i32", value: 99 },
            ],
            phis: [],
            terminator: { kind: "jump", target: "merge" },
          },
          {
            id: "right",
            instructions: [
              { kind: "constant", result: 5, type: "i32", value: 7 },
            ],
            phis: [],
            terminator: { kind: "jump", target: "merge" },
          },
          {
            id: "merge",
            instructions: [{ kind: "copy", result: 7, type: "i32", value: 6 }],
            phis: [
              {
                incoming: [
                  { block: "left", value: 3 },
                  { block: "right", value: 5 },
                ],
                kind: "phi",
                result: 6,
                type: "i32",
              },
            ],
            terminator: { kind: "return", value: 7 },
          },
        ],
        entry: "entry",
        locals: [],
        name: "main",
        parameters: [],
        returnType: "i32",
      },
    ],
  };
}

function diagnosticCodes(program: Cs486IrProgram): readonly string[] {
  return verifyCs486Ir(program).map((diagnostic) => diagnostic.code);
}

describe("CS486 integer IR", (): void => {
  it("accepts a typed diamond and a loop-carried phi", (): void => {
    expect(verifyCs486Ir(diamondProgram())).toEqual([]);

    const loop: Cs486IrProgram = {
      functions: [
        {
          blocks: [
            {
              id: "entry",
              instructions: [
                { kind: "constant", result: 0, type: "i32", value: 0 },
              ],
              phis: [],
              terminator: { kind: "jump", target: "loop" },
            },
            {
              id: "loop",
              instructions: [
                { kind: "constant", result: 2, type: "i32", value: 1 },
                {
                  kind: "binary",
                  left: 1,
                  operator: "add",
                  result: 3,
                  right: 2,
                  type: "i32",
                },
                { kind: "constant", result: 4, type: "i32", value: 10 },
                {
                  kind: "binary",
                  left: 3,
                  operator: "lt",
                  result: 5,
                  right: 4,
                  type: "i1",
                },
              ],
              phis: [
                {
                  incoming: [
                    { block: "entry", value: 0 },
                    { block: "loop", value: 3 },
                  ],
                  kind: "phi",
                  result: 1,
                  type: "i32",
                },
              ],
              terminator: {
                condition: 5,
                falseTarget: "exit",
                kind: "branch",
                trueTarget: "loop",
              },
            },
            {
              id: "exit",
              instructions: [],
              phis: [],
              terminator: { kind: "return", value: 3 },
            },
          ],
          entry: "entry",
          locals: [],
          name: "count",
          parameters: [],
          returnType: "i32",
        },
      ],
    };

    expect(verifyCs486Ir(loop)).toEqual([]);
    expect(() => assertValidCs486Ir(loop)).not.toThrow();
  });

  it("rejects duplicate definitions, undefined uses, and missing terminals", (): void => {
    const duplicate = singleReturnProgram();
    const duplicateFunction = duplicate.functions[0]!;
    const duplicateBlock = duplicateFunction.blocks[0]!;
    const duplicateProgram: Cs486IrProgram = {
      functions: [
        {
          ...duplicateFunction,
          blocks: [
            {
              ...duplicateBlock,
              instructions: [
                ...duplicateBlock.instructions,
                { kind: "constant", result: 0, type: "i32", value: 7 },
              ],
            },
          ],
        },
      ],
    };
    expect(diagnosticCodes(duplicateProgram)).toContain("CSIR_DUPLICATE_VALUE");

    const undefinedUse: Cs486IrProgram = {
      functions: [
        {
          ...singleReturnProgram().functions[0]!,
          blocks: [
            {
              id: "entry",
              instructions: [],
              phis: [],
              terminator: { kind: "return", value: 99 },
            },
          ],
        },
      ],
    };
    expect(diagnosticCodes(undefinedUse)).toContain("CSIR_UNDEFINED_VALUE");

    const noTerminator: Cs486IrProgram = {
      functions: [
        {
          ...singleReturnProgram().functions[0]!,
          blocks: [{ id: "entry", instructions: [], phis: [] }],
          returnType: "void",
        },
      ],
    };
    expect(diagnosticCodes(noTerminator)).toContain("CSIR_TERMINATOR");
    expect(() => assertValidCs486Ir(noTerminator)).toThrow(
      Cs486IrVerificationError,
    );
  });

  it("checks CFG targets, phi predecessor agreement, and dominance", (): void => {
    const badTarget: Cs486IrProgram = {
      functions: [
        {
          blocks: [
            {
              id: "entry",
              instructions: [],
              phis: [],
              terminator: { kind: "jump", target: "missing" },
            },
          ],
          entry: "entry",
          locals: [],
          name: "main",
          parameters: [],
          returnType: "void",
        },
      ],
    };
    expect(diagnosticCodes(badTarget)).toContain("CSIR_CFG_TARGET");

    const missingPhiInput = diamondProgram();
    const diamond = missingPhiInput.functions[0]!;
    const merge = diamond.blocks[3]!;
    const malformedPhi: Cs486IrProgram = {
      functions: [
        {
          ...diamond,
          blocks: [
            ...diamond.blocks.slice(0, 3),
            {
              ...merge,
              phis: [
                {
                  ...merge.phis[0]!,
                  incoming: [{ block: "left", value: 3 }],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(diagnosticCodes(malformedPhi)).toContain("CSIR_PHI_PREDECESSOR");

    const nondominating: Cs486IrProgram = {
      functions: [
        {
          ...diamond,
          blocks: [
            ...diamond.blocks.slice(0, 3),
            {
              ...merge,
              instructions: [
                { kind: "copy", result: 6, type: "i32", value: 3 },
              ],
              phis: [],
              terminator: { kind: "return", value: 6 },
            },
          ],
        },
      ],
    };
    expect(diagnosticCodes(nondominating)).toContain("CSIR_DOMINANCE");

    const useBeforeDefinition: Cs486IrProgram = {
      functions: [
        {
          blocks: [
            {
              id: "entry",
              instructions: [
                { kind: "copy", result: 1, type: "i32", value: 0 },
                { kind: "constant", result: 0, type: "i32", value: 42 },
              ],
              phis: [],
              terminator: { kind: "return", value: 1 },
            },
          ],
          entry: "entry",
          locals: [],
          name: "ordered",
          parameters: [],
          returnType: "i32",
        },
      ],
    };
    expect(diagnosticCodes(useBeforeDefinition)).toContain("CSIR_DOMINANCE");

    const entryPhi: Cs486IrProgram = {
      functions: [
        {
          blocks: [
            {
              id: "entry",
              instructions: [],
              phis: [
                {
                  incoming: [],
                  kind: "phi",
                  result: 0,
                  type: "i32",
                },
              ],
              terminator: { kind: "return", value: 0 },
            },
          ],
          entry: "entry",
          locals: [],
          name: "entry_phi",
          parameters: [],
          returnType: "i32",
        },
      ],
    };
    expect(diagnosticCodes(entryPhi)).toContain("CSIR_PHI_PREDECESSOR");
  });

  it("checks value types, calls, limits, and preserves source spans", (): void => {
    const span: Cs486SourceSpan = {
      end: { column: 15, line: 4, offset: 40, source: "sample.c" },
      start: { column: 8, line: 4, offset: 33, source: "sample.c" },
    };
    const typed: Cs486IrProgram = {
      externals: [
        {
          name: "consume",
          parameterTypes: ["i32"],
          returnType: "void",
        },
      ],
      functions: [
        {
          blocks: [
            {
              id: "entry",
              instructions: [
                { kind: "constant", result: 0, type: "i32", value: 1 },
                {
                  arguments: [],
                  callee: "consume",
                  kind: "call",
                },
              ],
              phis: [],
              terminator: {
                condition: 0,
                falseTarget: "exit",
                kind: "branch",
                span,
                trueTarget: "exit",
              },
            },
            {
              id: "exit",
              instructions: [],
              phis: [],
              terminator: { kind: "return" },
            },
          ],
          entry: "entry",
          locals: [],
          name: "typed",
          parameters: [],
          returnType: "void",
        },
      ],
    };
    const diagnostics = verifyCs486Ir(typed);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["CSIR_TYPE", "CSIR_CALL_SIGNATURE"]),
    );
    expect(
      diagnostics.find((diagnostic) => diagnostic.span === span)?.span,
    ).toBe(span);
    expect(
      verifyCs486Ir(diamondProgram(), { maxBlocksPerFunction: 1 }),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "CSIR_LIMIT" })]),
    );
    expect(() =>
      verifyCs486Ir(singleReturnProgram(), { maxFunctions: 0 }),
    ).toThrow(RangeError);
  });

  it("folds signed constants and removes unreachable, copied, and unused pure values", (): void => {
    const input = diamondProgram();
    const report = optimizeCs486IrWithReport(input);
    const optimized = report.program;
    expect(report.converged).toBe(true);
    expect(verifyCs486Ir(optimized)).toEqual([]);
    expect(optimized.functions[0]!.blocks.map((block) => block.id)).toEqual([
      "entry",
      "left",
      "merge",
    ]);
    expect(
      optimized.functions[0]!.blocks.flatMap((block) => block.phis),
    ).toEqual([]);
    expect(
      optimized.functions[0]!.blocks.flatMap((block) => block.instructions),
    ).toEqual([
      expect.objectContaining({
        kind: "constant",
        result: 6,
        type: "i32",
        value: 42,
      }),
    ]);
    expect(optimized.functions[0]!.blocks[2]!.terminator).toEqual({
      kind: "return",
      value: 6,
    });
    expect(input.functions[0]!.blocks).toHaveLength(4);

    const wrapping: Cs486IrProgram = {
      functions: [
        {
          blocks: [
            {
              id: "entry",
              instructions: [
                {
                  kind: "constant",
                  result: 0,
                  type: "i32",
                  value: 2_147_483_647,
                },
                { kind: "constant", result: 1, type: "i32", value: 1 },
                {
                  kind: "binary",
                  left: 0,
                  operator: "add",
                  result: 2,
                  right: 1,
                  type: "i32",
                },
              ],
              phis: [],
              terminator: { kind: "return", value: 2 },
            },
          ],
          entry: "entry",
          locals: [],
          name: "wrap",
          parameters: [],
          returnType: "i32",
        },
      ],
    };
    expect(
      optimizeCs486Ir(wrapping).functions[0]!.blocks[0]!.instructions,
    ).toEqual([
      expect.objectContaining({
        kind: "constant",
        result: 2,
        value: -2_147_483_648,
      }),
    ]);
  });

  it("propagates copies while preserving calls and potentially trapping division", (): void => {
    const program: Cs486IrProgram = {
      externals: [{ name: "observe", parameterTypes: [], returnType: "void" }],
      functions: [
        {
          blocks: [
            {
              id: "entry",
              instructions: [
                { kind: "load-local", local: "x", result: 0, type: "i32" },
                { kind: "copy", result: 1, type: "i32", value: 0 },
                { kind: "copy", result: 2, type: "i32", value: 1 },
                { kind: "constant", result: 3, type: "i32", value: 0 },
                {
                  kind: "binary",
                  left: 2,
                  operator: "div",
                  result: 4,
                  right: 3,
                  type: "i32",
                },
                { arguments: [], callee: "observe", kind: "call" },
              ],
              phis: [],
              terminator: { kind: "return", value: 2 },
            },
          ],
          entry: "entry",
          locals: [{ name: "x", type: "i32" }],
          name: "effects",
          parameters: [],
          returnType: "i32",
        },
      ],
    };
    const instructions =
      optimizeCs486Ir(program).functions[0]!.blocks[0]!.instructions;
    expect(
      instructions.some((instruction) => instruction.kind === "copy"),
    ).toBe(false);
    expect(instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "binary", operator: "div" }),
        expect.objectContaining({ callee: "observe", kind: "call" }),
      ]),
    );
    expect(
      optimizeCs486Ir(program).functions[0]!.blocks[0]!.terminator,
    ).toEqual({ kind: "return", value: 0 });
  });

  it("allocates deterministically, spills pressure, and reserves ESP/EBP", (): void => {
    const pressure: Cs486IrFunction = {
      blocks: [
        {
          id: "entry",
          instructions: [
            {
              arguments: [0, 1, 2, 3, 4, 5, 6],
              callee: "sink",
              kind: "call",
            },
          ],
          phis: [],
          terminator: { kind: "return" },
        },
      ],
      entry: "entry",
      locals: [],
      name: "pressure",
      parameters: Array.from({ length: 7 }, (_unused, id) => ({
        id,
        name: `p${String(id)}`,
        type: "i32" as const,
      })),
      returnType: "void",
    };
    const first = allocateCs486IrRegisters(pressure);
    const second = allocateCs486IrRegistersLinearScan(pressure);
    expect(first.algorithm).toBe("linear-scan");
    expect([...first.locations.entries()]).toEqual([
      ...second.locations.entries(),
    ]);
    expect(
      Array.from({ length: 6 }, (_unused, id) => first.locations.get(id)),
    ).toEqual(
      CS486_IR_ALLOCATABLE_REGISTERS.map((register) => ({
        kind: "register",
        register,
      })),
    );
    expect(first.locations.get(6)).toEqual({
      byteOffset: -4,
      kind: "spill",
      reason: "pressure",
      slot: 0,
    });
    expect(first.spillSlotCount).toBe(1);
    const afterLocal = allocateCs486IrRegisters(
      { ...pressure, locals: [{ name: "saved", type: "i32" }] },
      { registers: [] },
    );
    expect(afterLocal.locations.get(0)).toEqual({
      byteOffset: -8,
      kind: "spill",
      reason: "pressure",
      slot: 0,
    });
    expect(CS486_IR_RESERVED_REGISTERS).toEqual(["esp", "ebp"]);
    expect(() =>
      allocateCs486IrRegisters(pressure, {
        registers: [
          "eax",
          "esp",
        ] as unknown as readonly Cs486IrAllocatableRegister[],
      }),
    ).toThrow(/reserved|unsupported/u);
    expect(() =>
      allocateCs486IrRegisters(pressure, {
        limits: { maxInstructionsPerFunction: 1 },
      }),
    ).toThrow(/instruction limit/u);
  });

  it("spills values live across calls and exposes a correct identity scheduler", (): void => {
    const function_: Cs486IrFunction = {
      blocks: [
        {
          id: "entry",
          instructions: [
            { kind: "constant", result: 0, type: "i32", value: 40 },
            {
              arguments: [],
              callee: "helper",
              kind: "call",
              result: 1,
              type: "i32",
            },
            {
              kind: "binary",
              left: 0,
              operator: "add",
              result: 2,
              right: 1,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 2 },
        },
      ],
      entry: "entry",
      locals: [],
      name: "call_live",
      parameters: [],
      returnType: "i32",
    };
    const allocation = allocateCs486IrRegisters(function_);
    expect(allocation.locations.get(0)).toEqual({
      byteOffset: -4,
      kind: "spill",
      reason: "call-live",
      slot: 0,
    });
    expect(allocation.locations.get(1)).toEqual({
      kind: "register",
      register: "eax",
    });

    const constrained = allocateCs486IrRegistersLinearScan(function_, {
      callClobbers: [],
      clobbers: [
        {
          block: "entry",
          instructionIndex: 1,
          registers: ["eax"],
        },
      ],
      precolored: new Map([[1, "edx"]]),
    });
    expect(constrained.locations.get(0)).toEqual({
      kind: "register",
      register: "ebx",
    });
    expect(constrained.locations.get(1)).toEqual({
      kind: "register",
      precolored: true,
      register: "edx",
    });
    expect(() =>
      allocateCs486IrRegistersLinearScan(function_, {
        precolored: new Map([[0, "eax"]]),
      }),
    ).toThrow(/crosses a clobber/u);

    const scrambled: Cs486IrFunction = {
      blocks: [
        {
          id: "entry",
          instructions: [
            { kind: "constant", result: 0, type: "i32", value: 40 },
          ],
          phis: [],
          terminator: { kind: "jump", target: "call" },
        },
        {
          id: "merge",
          instructions: [
            {
              kind: "binary",
              left: 0,
              operator: "add",
              result: 2,
              right: 1,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 2 },
        },
        {
          id: "call",
          instructions: [
            {
              arguments: [],
              callee: "helper",
              kind: "call",
              result: 1,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "jump", target: "merge" },
        },
      ],
      entry: "entry",
      locals: [],
      name: "scrambled",
      parameters: [],
      returnType: "i32",
    };
    expect(allocateCs486IrRegisters(scrambled).locations.get(0)).toEqual({
      byteOffset: -4,
      kind: "spill",
      reason: "call-live",
      slot: 0,
    });

    const block: Cs486IrBasicBlock = function_.blocks[0]!;
    const scheduled = scheduleCs486IrBlock(block);
    expect(CS486_IR_SCHEDULER_MODE).toBe("identity");
    expect(scheduled).not.toBe(block);
    expect(scheduled.instructions).toEqual(block.instructions);
    expect(scheduled.phis).toEqual(block.phis);
    expect(scheduled.terminator).toBe(block.terminator);
  });
});
