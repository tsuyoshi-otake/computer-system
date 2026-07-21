import { describe, expect, it } from "vitest";

import { assembleCs486Object } from "../../src/application/toolchain/cs486Assembler.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  createCs486Flat32MemoryMetadata,
  validateCs486Executable,
} from "../../src/domain/cpu/cs486.js";
import {
  validateCs486Object,
  type Cs486Object,
} from "../../src/domain/cpu/cs486Object.js";
import {
  cs486FormatLimits,
  currentCs486ExecutableFormatVersion,
  currentCs486ObjectFormatVersion,
} from "../../src/domain/cpu/cs486FormatLimits.js";

describe("versioned CS486 format capacity", (): void => {
  it("publishes legacy and current limits from one immutable table", (): void => {
    expect(cs486FormatLimits({ format: "object", version: 2 })).toMatchObject({
      initializedDataBytes: 256_000,
      instructions: 4_096,
      relocations: 4_096,
      symbols: 2_048,
    });
    expect(
      cs486FormatLimits({
        format: "object",
        version: currentCs486ObjectFormatVersion,
      }),
    ).toMatchObject({
      assemblyCharacters: 256_000,
      initializedDataBytes: 2 * 1_048_576,
      instructions: 65_536,
      relocations: 65_536,
      symbols: 16_384,
    });
    expect(
      cs486FormatLimits({
        format: "executable",
        version: currentCs486ExecutableFormatVersion,
      }),
    ).toMatchObject({
      initializedDataBytes: 2 * 1_048_576,
      instructions: 65_536,
      symbols: 16_384,
    });
    expect(
      Object.isFrozen(cs486FormatLimits({ format: "executable", version: 4 })),
    ).toBe(true);
  });

  it("keeps executable v3 at 4096 instructions and admits v4 through 65536", (): void => {
    const instruction = Object.freeze({ op: "halt" as const });
    const memory = createCs486Flat32MemoryMetadata();
    expect(() =>
      validateCs486Executable({
        format: "cs486-executable",
        instructions: Array(4_096).fill(instruction),
        memory,
        version: 3,
      }),
    ).not.toThrow();
    expect(() =>
      validateCs486Executable({
        format: "cs486-executable",
        instructions: Array(4_097).fill(instruction),
        memory,
        version: 3,
      }),
    ).toThrow(/program instruction limit exceeded/u);
    expect(() =>
      validateCs486Executable({
        format: "cs486-executable",
        instructions: Array(65_536).fill(instruction),
        memory,
        version: 4,
      }),
    ).not.toThrow();
    expect(() =>
      validateCs486Executable({
        format: "cs486-executable",
        instructions: Array(65_537).fill(instruction),
        memory,
        version: 4,
      }),
    ).toThrow(/program instruction limit exceeded/u);
  });

  it("keeps v2 object data/symbol caps and admits the raised v3 boundaries", (): void => {
    expect(() =>
      validateCs486Object(structuredObject(2, 256_000)),
    ).not.toThrow();
    expect(() => validateCs486Object(structuredObject(2, 256_001))).toThrow(
      /invalid CS486 object sections/u,
    );
    expect(() =>
      validateCs486Object(structuredObject(3, 2 * 1_048_576)),
    ).not.toThrow();
    expect(() =>
      validateCs486Object(structuredObject(3, 2 * 1_048_576 + 1)),
    ).toThrow(/invalid CS486 object sections/u);

    expect(() =>
      validateCs486Object(structuredObject(2, 0, 2_048)),
    ).not.toThrow();
    expect(() => validateCs486Object(structuredObject(2, 0, 2_049))).toThrow(
      /unsupported CS486 object format/u,
    );
    expect(() =>
      validateCs486Object(structuredObject(3, 0, 16_384)),
    ).not.toThrow();
    expect(() => validateCs486Object(structuredObject(3, 0, 16_385))).toThrow(
      /unsupported CS486 object format/u,
    );
  });

  it("flags a truncated assembly transcript while retaining structured data", (): void => {
    const source = [
      "global main",
      "type main, function",
      "signature main, i32",
      "main:",
      ...Array.from({ length: 24_000 }, () => "mov eax, 0"),
      "ret",
    ].join("\n");

    const object = assembleCs486Object(source);
    const linked = linkCs486Objects([object]);

    expect(object.assemblyTruncated).toBe(true);
    expect(object.assembly).toHaveLength(256_000);
    expect(object.sections?.find(({ name }) => name === "text")?.name).toBe(
      "text",
    );
    expect(linked).toMatchObject({ dataModel: "cs-word32-v1", version: 5 });
    expect(linked.instructions).toHaveLength(24_003);
  });
});

function structuredObject(
  version: 2 | 3,
  initializedBytes: number,
  symbols = 0,
): Cs486Object {
  return {
    assembly: "halt",
    dataBytes: initializedBytes,
    format: "cs486-object",
    language: "asm",
    relocations: [],
    sections: [
      { alignment: 1, instructions: [{ op: "halt" }], name: "text" },
      { alignment: 1, bytes: [], name: "rodata" },
      {
        alignment: 1,
        bytes: Array<number>(initializedBytes).fill(0),
        name: "data",
      },
      { alignment: 1, name: "bss", size: 0 },
    ],
    symbols: Array.from({ length: symbols }, (_unused, index) => ({
      binding: "undefined" as const,
      name: `symbol_${String(index)}`,
      section: "text" as const,
    })),
    version,
  };
}
