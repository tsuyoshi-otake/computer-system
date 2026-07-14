import { describe, expect, it } from "vitest";

import { assembleCs486Object } from "../../src/application/toolchain/cs486Assembler.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import {
  Cs486LinkError,
  linkCs486Objects,
} from "../../src/application/toolchain/cs486Linker.js";
import { runCs486 } from "../../src/domain/cpu/cs486.js";
import { validateCs486Object } from "../../src/domain/cpu/cs486Object.js";

describe("CS486 static linker", (): void => {
  it("links C translation units and relocates object-relative data", (): void => {
    const main = compileCs486Object(
      "c",
      [
        "extern int helper();",
        "int main() {",
        "int main_value = helper();",
        'printf("%d\\n", main_value);',
        "return 0;",
        "}",
      ].join("\n"),
    );
    const helper = compileCs486Object(
      "c",
      [
        "int helper() {",
        "int helper_value = 6 * 7;",
        "return helper_value;",
        "}",
      ].join("\n"),
    );

    const executable = linkCs486Objects([main, helper]);
    const result = runCs486(executable, { memoryBytes: 65_536 });

    expect(result.output).toBe("42\n");
    expect(executable.dataBytes).toBe(8);
    expect(executable.symbols?.map(({ name }) => name)).toEqual([
      "main",
      "helper",
    ]);
    const stores = executable.instructions.filter(
      (instruction) => instruction.op === "store",
    );
    expect(stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ address: { kind: "immediate", value: 0 } }),
        expect.objectContaining({ address: { kind: "immediate", value: 4 } }),
      ]),
    );
  });

  it("keeps same-named local labels private to each object", (): void => {
    const entry = assembleCs486Object(
      [
        "global _start",
        "extern worker",
        "_start:",
        "local:",
        "call worker",
        "halt",
      ].join("\n"),
    );
    const worker = assembleCs486Object(
      [
        "global worker",
        "worker:",
        "local:",
        "mov eax, 42",
        "print eax",
        "ret",
      ].join("\n"),
    );

    const result = runCs486(linkCs486Objects([entry, worker]), {
      memoryBytes: 65_536,
    });
    expect(result.output).toBe("42");
  });

  it("bounds and validates objects before linking", (): void => {
    expect(() =>
      validateCs486Object({
        assembly: "halt",
        dataBytes: 0,
        format: "cs486-object",
        language: "asm",
        relocations: [],
        symbols: [
          { binding: "global", name: "bad-name", offset: 0, section: "text" },
        ],
        version: 1,
      }),
    ).toThrow(/symbol/u);
    expect(() =>
      linkCs486Objects([
        assembleCs486Object(
          "global _start\nextern absent\n_start:\ncall absent\nhalt",
        ),
      ]),
    ).toThrowError(Cs486LinkError);
    const valid = assembleCs486Object(
      "global _start\n_start:\nstore [0], eax\nhalt",
    );
    expect(() => linkCs486Objects([{ ...valid, dataBytes: 0 }])).toThrow(
      /invalid object metadata/u,
    );
    expect(() =>
      linkCs486Objects([
        {
          ...valid,
          symbols: valid.symbols.map((symbol) =>
            symbol.name === "_start" ? { ...symbol, offset: 1 } : symbol,
          ),
        },
      ]),
    ).toThrow(/invalid object metadata/u);
  });
});
