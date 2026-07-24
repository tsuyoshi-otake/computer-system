import { describe, expect, it } from "vitest";

import {
  inlineLeafFunctionCalls,
  optimizeCs486IrWithReport,
  verifyCs486Ir,
  type Cs486IrFunction,
  type Cs486IrProgram,
} from "../../src/application/toolchain/cs486Ir.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

/** `leaf(p0) { return p0 + 1; }` — a single-block leaf candidate. */
function addOneLeaf(name = "leaf"): Cs486IrFunction {
  return {
    blocks: [
      {
        id: "entry",
        instructions: [
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
    name,
    parameters: [{ id: 0, name: "p0", type: "i32" }],
    returnType: "i32",
  };
}

/** `main() { return leaf(41); }` */
function callerOf(
  callee: string,
  caller: Partial<Cs486IrFunction> = {},
): Cs486IrFunction {
  return {
    blocks: [
      {
        id: "entry",
        instructions: [
          { kind: "constant", result: 0, type: "i32", value: 41 },
          { arguments: [0], callee, kind: "call", result: 1, type: "i32" },
        ],
        phis: [],
        terminator: { kind: "return", value: 1 },
      },
    ],
    entry: "entry",
    locals: [],
    name: "main",
    parameters: [],
    returnType: "i32",
    ...caller,
  };
}

function callCount(function_: Cs486IrFunction): number {
  return function_.blocks
    .flatMap((block) => block.instructions)
    .filter(
      (instruction) =>
        instruction.kind === "call" || instruction.kind === "indirect-call",
    ).length;
}

describe("CSIR bounded leaf-function inlining", (): void => {
  it("splices a single-block leaf callee and stays verifiable", (): void => {
    const program: Cs486IrProgram = {
      functions: [addOneLeaf(), callerOf("leaf")],
    };
    const result = inlineLeafFunctionCalls(program);
    expect(result.inlinedCallSites).toBe(1);
    const main = result.program.functions.find(({ name }) => name === "main")!;
    expect(callCount(main)).toBe(0);
    expect(
      main.blocks.some((block) => block.id.startsWith(".inline0.body.")),
    ).toBe(true);
    expect(verifyCs486Ir(result.program)).toEqual([]);
    const report = optimizeCs486IrWithReport(program);
    expect(report.converged).toBe(true);
    expect(verifyCs486Ir(report.program)).toEqual([]);
  });

  it("merges multi-return callees through a synthetic local", (): void => {
    const clamp: Cs486IrFunction = {
      blocks: [
        {
          id: "entry",
          instructions: [
            { kind: "constant", result: 1, type: "i32", value: 0 },
            {
              kind: "binary",
              left: 0,
              operator: "ne",
              result: 2,
              right: 1,
              type: "i1",
            },
          ],
          phis: [],
          terminator: {
            condition: 2,
            falseTarget: "zero",
            kind: "branch",
            trueTarget: "nonzero",
          },
        },
        {
          id: "nonzero",
          instructions: [
            { kind: "constant", result: 3, type: "i32", value: 7 },
          ],
          phis: [],
          terminator: { kind: "return", value: 3 },
        },
        {
          id: "zero",
          instructions: [
            { kind: "constant", result: 4, type: "i32", value: 9 },
          ],
          phis: [],
          terminator: { kind: "return", value: 4 },
        },
      ],
      entry: "entry",
      locals: [],
      name: "clamp",
      parameters: [{ id: 0, name: "p0", type: "i32" }],
      returnType: "i32",
    };
    const program: Cs486IrProgram = { functions: [clamp, callerOf("clamp")] };
    const result = inlineLeafFunctionCalls(program);
    expect(result.inlinedCallSites).toBe(1);
    const main = result.program.functions.find(({ name }) => name === "main")!;
    expect(callCount(main)).toBe(0);
    expect(main.locals.map(({ name }) => name)).toContain(".inline0.ret");
    expect(
      main.blocks
        .flatMap((block) => block.instructions)
        .filter((instruction) => instruction.kind === "store-local"),
    ).toHaveLength(2);
    expect(verifyCs486Ir(result.program)).toEqual([]);
  });

  it("skips externals, variadics, wide returns, recursion, phis, and non-leaves", (): void => {
    const identityCases: readonly Cs486IrProgram[] = [
      {
        externals: [
          { name: "leaf", parameterTypes: ["i32"], returnType: "i32" },
        ],
        functions: [callerOf("leaf")],
      },
      { functions: [{ ...addOneLeaf(), variadic: true }, callerOf("leaf")] },
      {
        functions: [
          { ...addOneLeaf(".cs.inline.leaf") },
          callerOf(".cs.inline.leaf"),
        ],
      },
      {
        functions: [
          {
            ...addOneLeaf("wide"),
            blocks: [
              {
                id: "entry",
                instructions: [
                  { kind: "constant", result: 1, type: "i32", value: 1 },
                  { kind: "constant", result: 2, type: "i32", value: 0 },
                ],
                phis: [],
                terminator: { kind: "return", value: 1, valueHigh: 2 },
              },
            ],
            wideReturn: true,
          },
          {
            ...callerOf("wide"),
            blocks: [
              {
                id: "entry",
                instructions: [
                  { kind: "constant", result: 0, type: "i32", value: 41 },
                  {
                    arguments: [0],
                    callee: "wide",
                    kind: "call",
                    result: 1,
                    type: "i32",
                    wideResultLocal: "high",
                  },
                ],
                phis: [],
                terminator: { kind: "return", value: 1 },
              },
            ],
            locals: [{ name: "high", type: "i32" }],
          },
        ],
      },
      {
        functions: [
          {
            ...addOneLeaf("recursive"),
            blocks: [
              {
                id: "entry",
                instructions: [
                  {
                    arguments: [0],
                    callee: "recursive",
                    kind: "call",
                    result: 1,
                    type: "i32",
                  },
                ],
                phis: [],
                terminator: { kind: "return", value: 1 },
              },
            ],
          },
          callerOf("recursive"),
        ],
      },
      {
        functions: [
          {
            ...addOneLeaf("phi"),
            blocks: [
              {
                id: "entry",
                instructions: [
                  { kind: "constant", result: 1, type: "i32", value: 0 },
                  {
                    kind: "binary",
                    left: 0,
                    operator: "ne",
                    result: 2,
                    right: 1,
                    type: "i1",
                  },
                ],
                phis: [],
                terminator: {
                  condition: 2,
                  falseTarget: "join",
                  kind: "branch",
                  trueTarget: "join",
                },
              },
              {
                id: "join",
                instructions: [],
                phis: [
                  {
                    incoming: [
                      { block: "entry", value: 0 },
                      { block: "entry", value: 0 },
                    ],
                    kind: "phi",
                    result: 3,
                    type: "i32",
                  },
                ],
                terminator: { kind: "return", value: 3 },
              },
            ],
          },
          callerOf("phi"),
        ],
      },
    ];
    for (const program of identityCases) {
      const result = inlineLeafFunctionCalls(program);
      expect(result.inlinedCallSites).toBe(0);
      const main = result.program.functions.find(({ name }) => name === "main");
      if (main !== undefined) expect(callCount(main)).toBe(1);
    }
  });

  it("applies the callee-size boundary exactly", (): void => {
    const leafWithInstructions = (count: number): Cs486IrFunction => ({
      ...addOneLeaf(),
      blocks: [
        {
          id: "entry",
          instructions: Array.from({ length: count }, (_unused, index) => ({
            kind: "constant" as const,
            result: index + 1,
            type: "i32" as const,
            value: index,
          })),
          phis: [],
          terminator: { kind: "return", value: count },
        },
      ],
    });
    const atLimit = inlineLeafFunctionCalls(
      { functions: [leafWithInstructions(2), callerOf("leaf")] },
      { maxInlineCalleeInstructions: 2 },
    );
    expect(atLimit.inlinedCallSites).toBe(1);
    const overLimit = inlineLeafFunctionCalls(
      { functions: [leafWithInstructions(3), callerOf("leaf")] },
      { maxInlineCalleeInstructions: 2 },
    );
    expect(overLimit.inlinedCallSites).toBe(0);
  });

  it("consumes the per-caller budget deterministically in program order", (): void => {
    const main: Cs486IrFunction = {
      blocks: [
        {
          id: "entry",
          instructions: [
            { kind: "constant", result: 0, type: "i32", value: 41 },
            {
              arguments: [0],
              callee: "leaf",
              kind: "call",
              result: 1,
              type: "i32",
            },
            {
              arguments: [1],
              callee: "leaf",
              kind: "call",
              result: 2,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 2 },
        },
      ],
      entry: "entry",
      locals: [],
      name: "main",
      parameters: [],
      returnType: "i32",
    };
    // addOneLeaf costs 2 cloned instructions + 1 single-return copy = 3.
    const budgeted = inlineLeafFunctionCalls(
      { functions: [addOneLeaf(), main] },
      { maxInlinedInstructionsPerFunction: 3 },
    );
    expect(budgeted.inlinedCallSites).toBe(1);
    const inlinedMain = budgeted.program.functions.find(
      ({ name }) => name === "main",
    )!;
    expect(callCount(inlinedMain)).toBe(1);
    expect(
      inlinedMain.blocks.some((block) => block.id.startsWith(".inline0.body.")),
    ).toBe(true);
    expect(verifyCs486Ir(budgeted.program)).toEqual([]);

    const unbudgeted = inlineLeafFunctionCalls({
      functions: [addOneLeaf(), main],
    });
    expect(unbudgeted.inlinedCallSites).toBe(2);
    expect(
      callCount(
        unbudgeted.program.functions.find(({ name }) => name === "main")!,
      ),
    ).toBe(0);
    expect(verifyCs486Ir(unbudgeted.program)).toEqual([]);
  });

  it("skips callers already using the reserved inline namespace", (): void => {
    const program: Cs486IrProgram = {
      functions: [
        addOneLeaf(),
        callerOf("leaf", { locals: [{ name: ".inline0.ret", type: "i32" }] }),
      ],
    };
    const result = inlineLeafFunctionCalls(program);
    expect(result.inlinedCallSites).toBe(0);
    expect(
      callCount(result.program.functions.find(({ name }) => name === "main")!),
    ).toBe(1);
  });

  it("returns the identical program when there is nothing to inline", (): void => {
    const program: Cs486IrProgram = {
      externals: [{ name: "leaf", parameterTypes: ["i32"], returnType: "i32" }],
      functions: [callerOf("leaf")],
    };
    const result = inlineLeafFunctionCalls(program);
    expect(result.inlinedCallSites).toBe(0);
    expect(result.program).toBe(program);
  });

  it("inlines a compiled C leaf helper end to end", (): void => {
    const source = [
      "static int clamp_add(int a, int b) {",
      "  int sum = a + b;",
      "  if (sum > 100) return 100;",
      "  return sum;",
      "}",
      "int main(void) { return clamp_add(30, 12); }",
    ].join("\n");
    const object = compileCs486Object("c", source);
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    const run = runCs486(executable, {
      instructionLimit: 1_000_000,
      memoryBytes:
        requirements.kind === "declared"
          ? requirements.linearAddressSpaceBytes
          : 1 << 20,
    });
    expect(run.registers.eax).toBe(42);
    const text = object.sections?.find(({ name }) => name === "text");
    if (text?.name !== "text") throw new Error("C object has no text section");
    expect(text.instructions.map(({ op }) => op)).not.toContain("call");
  });
});
