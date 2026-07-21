import { describe, expect, it } from "vitest";

import {
  optimizeCs486Ir,
  type Cs486IrProgram,
} from "../../src/application/toolchain/cs486Ir.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C const, volatile, and restrict qualifiers", (): void => {
  it("parses pointer-layer qualifiers and preserves defined execution", (): void => {
    const source = [
      "volatile int observed = 40;",
      "const int adjustment = 2;",
      "int read_value(volatile int * restrict source, const int * limit) {",
      "  return *source + *limit;",
      "}",
      "int main(void) { return read_value(&observed, &adjustment); }",
    ].join("\n");
    const object = compileCs486Object("c", source);
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");

    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(42);
    expect(compileCs486Object("c", source)).toEqual(object);
  });

  it("rejects const writes, qualifier removal, invalid restrict, and duplicates", (): void => {
    for (const [source, message] of [
      [
        "int main(void) { const int value = 1; value = 2; return value; }",
        /const-qualified/u,
      ],
      [
        "int main(void) { const int value = 1; const int * pointer = &value; *pointer = 2; return value; }",
        /const-qualified/u,
      ],
      [
        "int main(void) { const int value = 1; const int * source = &value; int * target = source; return *target; }",
        /incompatible assignment types/u,
      ],
      [
        "int main(void) { int restrict value = 0; return value; }",
        /restrict qualifier requires a pointer/u,
      ],
      [
        "int main(void) { const const int value = 0; return value; }",
        /duplicate const qualifier/u,
      ],
    ] as const)
      expect(() => compileCs486Object("c", source)).toThrow(message);
  });

  it("keeps volatile loads alive through bounded CSIR optimization", (): void => {
    const program = loadProgram(true);
    const optimized = optimizeCs486Ir(program);
    const instructions = optimized.functions[0]!.blocks[0]!.instructions;

    expect(instructions).toContainEqual(
      expect.objectContaining({ kind: "load-memory", volatile: true }),
    );
    expect(
      optimizeCs486Ir(loadProgram(false)).functions[0]!.blocks[0]!.instructions,
    ).not.toContainEqual(expect.objectContaining({ kind: "load-memory" }));
  });
});

function loadProgram(volatile: boolean): Cs486IrProgram {
  return {
    functions: [
      {
        blocks: [
          {
            id: "entry",
            instructions: [
              { kind: "constant", result: 0, type: "i32", value: 0 },
              {
                address: 0,
                kind: "load-memory",
                result: 1,
                type: "i32",
                ...(volatile ? { volatile: true as const } : {}),
              },
              { kind: "constant", result: 2, type: "i32", value: 42 },
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
