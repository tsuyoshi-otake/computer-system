import { describe, expect, it } from "vitest";

import {
  optimizeCs486IrWithReport,
  verifyCs486Ir,
  type Cs486IrBasicBlock,
  type Cs486IrInstruction,
  type Cs486IrProgram,
  type Cs486IrTerminator,
} from "../../src/application/toolchain/cs486Ir.js";

function singleFunction(
  blocks: readonly Cs486IrBasicBlock[],
  options: {
    readonly externals?: Cs486IrProgram["externals"];
    readonly locals?: readonly { name: string; type: "i1" | "i32" }[];
    readonly parameterCount?: number;
    readonly returnType?: "i1" | "i32" | "void";
  } = {},
): Cs486IrProgram {
  return {
    ...(options.externals === undefined
      ? {}
      : { externals: options.externals }),
    functions: [
      {
        blocks: [...blocks],
        entry: blocks[0]!.id,
        locals: [...(options.locals ?? [])],
        name: "subject",
        parameters: Array.from(
          { length: options.parameterCount ?? 1 },
          (_unused, id) => ({
            id,
            name: `p${String(id)}`,
            type: "i32" as const,
          }),
        ),
        returnType: options.returnType ?? "i32",
      },
    ],
  };
}

function optimize(program: Cs486IrProgram): {
  readonly instructions: readonly Cs486IrInstruction[];
  readonly terminator: Cs486IrTerminator | undefined;
} {
  const report = optimizeCs486IrWithReport(program);
  expect(report.converged).toBe(true);
  expect(verifyCs486Ir(report.program)).toEqual([]);
  const blocks = report.program.functions[0]!.blocks;
  return {
    instructions: blocks.flatMap((block) => block.instructions),
    terminator: blocks.at(-1)!.terminator,
  };
}

/** `subject(p0) { return p0 <op> constant; }` with fresh value ids 1..2. */
function binaryWithConstant(
  operator: string,
  constant: number,
  options: {
    readonly constantLeft?: boolean;
    readonly i1Result?: boolean;
  } = {},
): Cs486IrProgram {
  const type = options.i1Result === true ? ("i1" as const) : ("i32" as const);
  return singleFunction(
    [
      {
        id: "entry",
        instructions: [
          { kind: "constant", result: 1, type: "i32", value: constant },
          {
            kind: "binary",
            left: options.constantLeft === true ? 1 : 0,
            operator,
            result: 2,
            right: options.constantLeft === true ? 0 : 1,
            type,
          } as Cs486IrInstruction,
        ],
        phis: [],
        terminator: { kind: "return", value: 2 },
      },
    ],
    { returnType: type },
  );
}

/** `subject(p0) { return p0 <op> p0; }` over the same SSA value. */
function binarySameOperand(
  operator: string,
  i1Result: boolean,
): Cs486IrProgram {
  const type = i1Result ? ("i1" as const) : ("i32" as const);
  return singleFunction(
    [
      {
        id: "entry",
        instructions: [
          {
            kind: "binary",
            left: 0,
            operator,
            result: 1,
            right: 0,
            type,
          } as Cs486IrInstruction,
        ],
        phis: [],
        terminator: { kind: "return", value: 1 },
      },
    ],
    { returnType: type },
  );
}

function operators(
  instructions: readonly Cs486IrInstruction[],
): readonly string[] {
  return instructions.flatMap((instruction) =>
    instruction.kind === "binary" ? [instruction.operator] : [],
  );
}

describe("CSIR algebraic simplification and strength reduction", (): void => {
  it("reduces multiplication by a power of two to a shift", (): void => {
    const { instructions } = optimize(binaryWithConstant("mul", 8));
    expect(operators(instructions)).toEqual(["shl"]);
    expect(instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "constant", value: 3 }),
      ]),
    );
    const commuted = optimize(
      binaryWithConstant("mul", 8, { constantLeft: true }),
    );
    expect(operators(commuted.instructions)).toEqual(["shl"]);
  });

  it("folds multiplicative and additive identities to the operand", (): void => {
    for (const program of [
      binaryWithConstant("mul", 1),
      binaryWithConstant("mul", 1, { constantLeft: true }),
      binaryWithConstant("add", 0),
      binaryWithConstant("add", 0, { constantLeft: true }),
      binaryWithConstant("sub", 0),
      binaryWithConstant("or", 0),
      binaryWithConstant("xor", 0),
      binaryWithConstant("and", -1),
      binaryWithConstant("shl", 0),
      binaryWithConstant("shr", 0),
      binaryWithConstant("ushr", 0),
    ]) {
      const { instructions, terminator } = optimize(program);
      expect(instructions).toEqual([]);
      expect(terminator).toEqual({ kind: "return", value: 0 });
    }
  });

  it("folds annihilating operands to a constant", (): void => {
    for (const [program, value] of [
      [binaryWithConstant("mul", 0), 0],
      [binaryWithConstant("and", 0), 0],
      [binaryWithConstant("or", -1), -1],
    ] as const) {
      const { instructions, terminator } = optimize(program);
      expect(instructions).toEqual([
        expect.objectContaining({ kind: "constant", value }),
      ]);
      expect(terminator).toEqual({
        kind: "return",
        value: (instructions[0] as { result: number }).result,
      });
    }
  });

  it("does not rewrite non-commutative zero on the left", (): void => {
    const { instructions } = optimize(
      binaryWithConstant("sub", 0, { constantLeft: true }),
    );
    expect(operators(instructions)).toEqual(["sub"]);
  });

  it("reduces unsigned division and modulo by powers of two", (): void => {
    const division = optimize(binaryWithConstant("udiv", 8));
    expect(operators(division.instructions)).toEqual(["ushr"]);
    expect(division.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "constant", value: 3 }),
      ]),
    );
    const modulo = optimize(binaryWithConstant("umod", 8));
    expect(operators(modulo.instructions)).toEqual(["and"]);
    expect(modulo.instructions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "constant", value: 7 }),
      ]),
    );
  });

  it("keeps signed division and modulo by powers of two intact", (): void => {
    expect(
      operators(optimize(binaryWithConstant("div", 8)).instructions),
    ).toEqual(["div"]);
    expect(
      operators(optimize(binaryWithConstant("mod", 8)).instructions),
    ).toEqual(["mod"]);
  });

  it("resolves same-operand arithmetic and comparisons", (): void => {
    for (const operator of ["sub", "xor"]) {
      const { instructions } = optimize(binarySameOperand(operator, false));
      expect(instructions).toEqual([
        expect.objectContaining({ kind: "constant", value: 0 }),
      ]);
    }
    for (const operator of ["and", "or"]) {
      const { instructions, terminator } = optimize(
        binarySameOperand(operator, false),
      );
      expect(instructions).toEqual([]);
      expect(terminator).toEqual({ kind: "return", value: 0 });
    }
    for (const operator of ["eq", "le", "ge", "ule", "uge"]) {
      const { instructions } = optimize(binarySameOperand(operator, true));
      expect(instructions).toEqual([
        expect.objectContaining({ kind: "constant", type: "i1", value: 1 }),
      ]);
    }
    for (const operator of ["ne", "lt", "gt", "ult", "ugt"]) {
      const { instructions } = optimize(binarySameOperand(operator, true));
      expect(instructions).toEqual([
        expect.objectContaining({ kind: "constant", type: "i1", value: 0 }),
      ]);
    }
  });
});

describe("CSIR block-local common subexpression elimination", (): void => {
  it("merges duplicate binaries across commutation and constant identity", (): void => {
    const program = singleFunction([
      {
        id: "entry",
        instructions: [
          { kind: "constant", result: 1, type: "i32", value: 5 },
          {
            kind: "binary",
            left: 0,
            operator: "add",
            result: 2,
            right: 1,
            type: "i32",
          },
          { kind: "constant", result: 3, type: "i32", value: 5 },
          {
            kind: "binary",
            left: 3,
            operator: "add",
            result: 4,
            right: 0,
            type: "i32",
          },
          {
            kind: "binary",
            left: 2,
            operator: "or",
            result: 5,
            right: 4,
            type: "i32",
          },
        ],
        phis: [],
        terminator: { kind: "return", value: 5 },
      },
    ]);
    const { instructions, terminator } = optimize(program);
    expect(operators(instructions)).toEqual(["add"]);
    expect(terminator).toEqual({ kind: "return", value: 2 });
  });

  it("merges duplicate local loads but respects an intervening store", (): void => {
    const local = { name: "x", type: "i32" as const };
    const clean = singleFunction(
      [
        {
          id: "entry",
          instructions: [
            { kind: "load-local", local: "x", result: 1, type: "i32" },
            { kind: "load-local", local: "x", result: 2, type: "i32" },
            {
              kind: "binary",
              left: 1,
              operator: "add",
              result: 3,
              right: 2,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 3 },
        },
      ],
      { locals: [local] },
    );
    expect(
      optimize(clean).instructions.filter(
        (instruction) => instruction.kind === "load-local",
      ),
    ).toHaveLength(1);

    const stored = singleFunction(
      [
        {
          id: "entry",
          instructions: [
            { kind: "load-local", local: "x", result: 1, type: "i32" },
            { kind: "store-local", local: "x", value: 0 },
            { kind: "load-local", local: "x", result: 2, type: "i32" },
            {
              kind: "binary",
              left: 1,
              operator: "add",
              result: 3,
              right: 2,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 3 },
        },
      ],
      { locals: [local] },
    );
    expect(
      optimize(stored).instructions.filter(
        (instruction) => instruction.kind === "load-local",
      ),
    ).toHaveLength(2);
  });

  it("invalidates loads across calls and memory stores", (): void => {
    const acrossCall = singleFunction(
      [
        {
          id: "entry",
          instructions: [
            { kind: "load-local", local: "x", result: 1, type: "i32" },
            { arguments: [], callee: "observe", kind: "call" },
            { kind: "load-local", local: "x", result: 2, type: "i32" },
            {
              kind: "binary",
              left: 1,
              operator: "add",
              result: 3,
              right: 2,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 3 },
        },
      ],
      {
        externals: [
          { name: "observe", parameterTypes: [], returnType: "void" },
        ],
        locals: [{ name: "x", type: "i32" }],
      },
    );
    expect(
      optimize(acrossCall).instructions.filter(
        (instruction) => instruction.kind === "load-local",
      ),
    ).toHaveLength(2);

    const acrossStore = singleFunction([
      {
        id: "entry",
        instructions: [
          { kind: "load-memory", address: 0, result: 1, type: "i32" },
          { kind: "store-memory", address: 0, value: 1 },
          { kind: "load-memory", address: 0, result: 2, type: "i32" },
          {
            kind: "binary",
            left: 1,
            operator: "add",
            result: 3,
            right: 2,
            type: "i32",
          },
        ],
        phis: [],
        terminator: { kind: "return", value: 3 },
      },
    ]);
    expect(
      optimize(acrossStore).instructions.filter(
        (instruction) => instruction.kind === "load-memory",
      ),
    ).toHaveLength(2);
  });

  it("keys memory loads by width and signedness and skips volatile", (): void => {
    const widths = singleFunction([
      {
        id: "entry",
        instructions: [
          {
            kind: "load-memory",
            address: 0,
            result: 1,
            signed: true,
            type: "i32",
            width: 1,
          },
          { kind: "load-memory", address: 0, result: 2, type: "i32", width: 1 },
          {
            kind: "binary",
            left: 1,
            operator: "add",
            result: 3,
            right: 2,
            type: "i32",
          },
        ],
        phis: [],
        terminator: { kind: "return", value: 3 },
      },
    ]);
    expect(
      optimize(widths).instructions.filter(
        (instruction) => instruction.kind === "load-memory",
      ),
    ).toHaveLength(2);

    const volatileLoads = singleFunction(
      [
        {
          id: "entry",
          instructions: [
            {
              kind: "load-local",
              local: "x",
              result: 1,
              type: "i32",
              volatile: true,
            },
            {
              kind: "load-local",
              local: "x",
              result: 2,
              type: "i32",
              volatile: true,
            },
            {
              kind: "binary",
              left: 1,
              operator: "add",
              result: 3,
              right: 2,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 3 },
        },
      ],
      { locals: [{ name: "x", type: "i32" }] },
    );
    expect(
      optimize(volatileLoads).instructions.filter(
        (instruction) => instruction.kind === "load-local",
      ),
    ).toHaveLength(2);
  });
});

describe("CSIR dead-code and determinism guarantees", (): void => {
  it("keeps unused unsigned division and modulo for their trap", (): void => {
    const program = singleFunction(
      [
        {
          id: "entry",
          instructions: [
            {
              kind: "binary",
              left: 0,
              operator: "udiv",
              result: 2,
              right: 1,
              type: "i32",
            },
            {
              kind: "binary",
              left: 0,
              operator: "umod",
              result: 3,
              right: 1,
              type: "i32",
            },
            { kind: "constant", result: 4, type: "i32", value: 42 },
          ],
          phis: [],
          terminator: { kind: "return", value: 4 },
        },
      ],
      { parameterCount: 2 },
    );
    expect(operators(optimize(program).instructions)).toEqual(["udiv", "umod"]);
  });

  it("optimizes deterministically and reports convergence", (): void => {
    const program = (): Cs486IrProgram => binaryWithConstant("mul", 16);
    const first = optimizeCs486IrWithReport(program());
    const second = optimizeCs486IrWithReport(program());
    expect(first.converged).toBe(true);
    expect(second.program).toEqual(first.program);

    const identity = singleFunction(
      [
        {
          id: "entry",
          instructions: [
            {
              kind: "binary",
              left: 0,
              operator: "udiv",
              result: 2,
              right: 1,
              type: "i32",
            },
          ],
          phis: [],
          terminator: { kind: "return", value: 2 },
        },
      ],
      { parameterCount: 2 },
    );
    const report = optimizeCs486IrWithReport(identity);
    expect(report.converged).toBe(true);
    expect(report.program.functions[0]!.blocks).toEqual(
      identity.functions[0]!.blocks,
    );
  });
});
