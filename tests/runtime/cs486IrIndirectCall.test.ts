import { describe, expect, it } from "vitest";

import {
  assertValidCs486Ir,
  optimizeCs486Ir,
  verifyCs486Ir,
  type Cs486IrProgram,
} from "../../src/application/toolchain/cs486Ir.js";

describe("CSIR validated indirect calls", (): void => {
  it("verifies and preserves the target, arguments, result, and signature", (): void => {
    const program = indirectProgram();

    expect(() => assertValidCs486Ir(program)).not.toThrow();
    expect(optimizeCs486Ir(program)).toEqual(program);
  });

  it("rejects wrong arity, target types, result contracts, and malformed signatures", (): void => {
    const base = indirectProgram();
    const instruction = base.functions[0]!.blocks[0]!.instructions[2]!;
    if (instruction.kind !== "indirect-call")
      throw new Error("expected indirect call fixture");
    const replace = (replacement: object): Cs486IrProgram => ({
      ...base,
      functions: [
        {
          ...base.functions[0]!,
          blocks: [
            {
              ...base.functions[0]!.blocks[0]!,
              instructions: [
                ...base.functions[0]!.blocks[0]!.instructions.slice(0, 2),
                { ...instruction, ...replacement },
              ],
            },
          ],
        },
      ],
    });

    expect(codes(replace({ arguments: [] }))).toContain("CSIR_CALL_SIGNATURE");
    expect(codes(replace({ target: 3 }))).toContain("CSIR_UNDEFINED_VALUE");
    expect(codes(replace({ result: undefined, type: undefined }))).toContain(
      "CSIR_CALL_SIGNATURE",
    );
    expect(
      codes(
        replace({
          functionSignature: "(i64)->i32",
        }),
      ),
    ).toContain("CSIR_CALL_SIGNATURE");
  });
});

function indirectProgram(): Cs486IrProgram {
  return {
    functions: [
      {
        blocks: [
          {
            id: "entry",
            instructions: [
              { kind: "constant", result: 0, type: "i32", value: 12 },
              { kind: "constant", result: 1, type: "i32", value: 42 },
              {
                arguments: [1],
                functionSignature: "(i32)->i32",
                kind: "indirect-call",
                result: 2,
                target: 0,
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
      },
    ],
  };
}

function codes(program: Cs486IrProgram): readonly string[] {
  return verifyCs486Ir(program).map(({ code }) => code);
}
