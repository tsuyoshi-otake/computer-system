import { describe, expect, it } from "vitest";

import {
  assembleCs486,
  assembleCs486Object,
} from "../../src/application/toolchain/cs486Assembler.js";
import {
  cs486AsmPreprocessorLimits,
  preprocessCs486Assembly,
} from "../../src/application/toolchain/cs486AsmPreprocessor.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
  type Cs486Executable,
} from "../../src/domain/cpu/cs486.js";
import {
  validateCs486Object,
  type Cs486Object,
} from "../../src/domain/cpu/cs486Object.js";

describe("CS486 structured assembler", (): void => {
  it("tokenizes strings safely and expands bounded includes and macros", (): void => {
    const executable = assembleCs486(
      [
        '%include "emit.inc"',
        "%define ANSWER 40 + 2",
        "EMIT ANSWER",
        'print "A;B" ; this semicolon begins a comment',
        "halt",
      ].join("\r\n"),
      {
        include: (request, fromSource) =>
          request === "emit.inc" && fromSource === "/src/main.asm"
            ? {
                source: "%macro EMIT 1\nmov eax, %1\nprint eax\n%endmacro\n",
                sourceName: "/src/emit.inc",
              }
            : undefined,
        sourceName: "/src/main.asm",
      },
    );

    expect(runCs486(executable, { memoryBytes: 65_536 }).output).toBe("42A;B");
  });

  it("prints validated word characters through the bounded runtime syscall", (): void => {
    const executable = assembleCs486(
      [
        "mov eax, 65",
        "syscall cs.print.character",
        "mov eax, 128512",
        "syscall cs.print.character",
        "halt",
      ].join("\n"),
    );

    expect(runCs486(executable, { memoryBytes: 65_536 }).output).toBe("A😀");
    expect(() =>
      runCs486(assembleCs486("mov eax, -1\nsyscall cs.print.character\nhalt"), {
        memoryBytes: 65_536,
      }),
    ).toThrow(/invalid Unicode code point/u);
  });

  it("lays out initialized data, BSS, alignment, and typed symbols", (): void => {
    const source = [
      "section .data",
      "align 8",
      "answer: dd 42",
      "section .bss",
      "scratch: resd 1",
      "section .text",
      "global main",
      "type main, function",
      "main:",
      "load eax, [answer]",
      "store [scratch], eax",
      "load ebx, [scratch]",
      "print ebx",
      "halt",
    ].join("\n");

    const object = assembleCs486Object(source);
    const executable = linkCs486Objects([object], { entry: "main" });

    expect(object).toMatchObject({ dataModel: "cs-word32-v1", version: 4 });
    expect(object.sections?.map(({ name }) => name)).toEqual([
      "text",
      "rodata",
      "data",
      "bss",
    ]);
    expect(object.symbols).toContainEqual(
      expect.objectContaining({
        binding: "global",
        name: "main",
        section: "text",
        type: "function",
      }),
    );
    expect(executable.initialData).toEqual([
      { bytes: [42, 0, 0, 0], offset: 8 },
    ]);
    expect(executable.dataBytes).toBe(16);
    expect(runDeclared(executable).output).toBe("42");
  });

  it("serializes and validates optional zero-argument function signatures", (): void => {
    const object = assembleCs486Object(
      [
        "global main",
        "type main, function",
        "signature main, i32",
        "extern notify",
        "type notify, function",
        "signature notify, void",
        "main:",
        "call notify",
        "mov eax, 0",
        "ret",
      ].join("\n"),
    );

    expect(object.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionSignature: "()->i32",
          name: "main",
          type: "function",
        }),
        expect.objectContaining({
          binding: "undefined",
          functionSignature: "()->void",
          name: "notify",
          type: "function",
        }),
      ]),
    );
    expect(() =>
      assembleCs486Object(
        "section .data\nglobal bad\ntype bad, object\nsignature bad, i32\nbad: dd 0",
      ),
    ).toThrow(/signature bad requires type function/u);
    expect(() =>
      assembleCs486Object(
        "global bad\ntype bad, function\nsignature bad, pointer\nbad:\nhalt",
      ),
    ).toThrow(/return type must be f32, f64, i32, i64, or void/u);
  });

  it("serializes bounded multi-argument v3 function signatures", (): void => {
    const object = assembleCs486Object(
      [
        "global add",
        "type add, function",
        "signature add, i32, i32, i32",
        "add:",
        "mov eax, 0",
        "ret",
      ].join("\n"),
    );

    expect(object).toMatchObject({ dataModel: "cs-word32-v1", version: 4 });
    expect(object.symbols).toContainEqual(
      expect.objectContaining({
        functionSignature: "(i32,i32)->i32",
        name: "add",
      }),
    );
    expect(() =>
      assembleCs486Object(
        "global bad\ntype bad, function\nsignature bad, i32, pointer\nbad:\nret",
      ),
    ).toThrow(/parameter types must be f32, f64, i32/u);
  });

  it("serializes canonical bounded variadic function signatures", (): void => {
    const object = assembleCs486Object(
      [
        "global format",
        "type format, function",
        "signature format, i32, i32, varargs",
        "format:",
        "mov eax, 0",
        "ret",
      ].join("\n"),
    );

    expect(object.symbols).toContainEqual(
      expect.objectContaining({
        functionSignature: "(i32,...)->i32",
        name: "format",
      }),
    );
    expect(() =>
      assembleCs486Object(
        [
          "global excessive",
          "type excessive, function",
          `signature excessive, i32, ${Array.from({ length: 33 }, () => "i32").join(", ")}, varargs`,
          "excessive:",
          "ret",
        ].join("\n"),
      ),
    ).toThrow(/more than 32 fixed parameters/u);
  });

  it("retains v2 zero-argument reads while rejecting v3-only signatures", (): void => {
    const current = assembleCs486Object(
      "global main\ntype main, function\nsignature main, i32\nmain:\nmov eax, 42\nret",
    );
    const { dataModel, ...legacyFields } = current;
    expect(dataModel).toBe("cs-word32-v1");
    const legacy: Cs486Object = { ...legacyFields, version: 2 };

    expect(() => validateCs486Object(legacy)).not.toThrow();
    expect(runDeclared(linkCs486Objects([legacy])).registers.eax).toBe(42);
    expect(() =>
      validateCs486Object({
        ...legacy,
        symbols: legacy.symbols.map((symbol) => ({
          ...symbol,
          functionSignature: "(i32)->i32",
        })),
      }),
    ).toThrow(/invalid CS486 object symbol/u);
  });

  it("resolves a cross-object typed data symbol through structured relocation", (): void => {
    const consumer = assembleCs486Object(
      [
        "section .text",
        "global _start",
        "extern answer",
        "type answer, object",
        "_start:",
        "load eax, [answer]",
        "print eax",
        "halt",
      ].join("\n"),
    );
    const provider = assembleCs486Object(
      [
        "section .data",
        "global answer",
        "type answer, object",
        "answer: dd 42",
      ].join("\n"),
    );

    const executable = linkCs486Objects([consumer, provider], {
      entry: "_start",
    });

    expect(runCs486(executable, { memoryBytes: 131_072 }).output).toBe("42");
    expect(consumer.relocations).toContainEqual(
      expect.objectContaining({
        field: "address",
        section: "text",
        symbol: "answer",
        type: "data-address",
      }),
    );
  });

  it("applies symbol addends in initialized-data relocations", (): void => {
    const entry = assembleCs486Object("global main\nmain:\nhalt");
    const data = assembleCs486Object(
      [
        "section .data",
        "global values",
        "type values, object",
        "values: dd 40, 42",
        "global selected",
        "type selected, object",
        "selected: dd values + 4",
      ].join("\n"),
    );

    const executable = linkCs486Objects([entry, data]);

    expect(data.relocations).toContainEqual(
      expect.objectContaining({
        addend: 4,
        field: "data",
        section: "data",
        symbol: "values",
        type: "data-address",
      }),
    );
    expect(executable.initialData).toContainEqual({
      bytes: [40, 0, 0, 0, 42, 0, 0, 0, 8, 0, 0, 0],
      offset: 4,
    });
  });

  it("encodes signed data and preserves section alignment across objects", (): void => {
    const entry = assembleCs486Object(
      [
        "section .data",
        "prefix: dd 1",
        "section .text",
        "global _start",
        "_start:",
        "halt",
      ].join("\n"),
    );
    const aligned = assembleCs486Object(
      [
        "section .rodata",
        "align 16",
        "global aligned_value",
        "aligned_value: db -1",
        "dw -1",
        "dd -1",
      ].join("\n"),
    );

    const executable = linkCs486Objects([entry, aligned], { entry: "_start" });

    expect(
      executable.symbols?.find(({ name }) => name === "aligned_value")?.address,
    ).toBe(16);
    expect(executable.initialData).toContainEqual({
      bytes: [255, 255, 255, 255, 255, 255, 255],
      offset: 16,
    });
  });

  it("rejects control-flow/data relocation target mismatches", (): void => {
    expect(() =>
      assembleCs486("fn:\nret\nmain:\nload eax, [fn]\nhalt"),
    ).toThrow(/fn is not a data symbol/u);

    const caller = assembleCs486Object(
      "global main\nextern item\nmain:\ncall item\nhalt",
    );
    const data = assembleCs486Object("section .data\nglobal item\nitem: dd 1");
    expect(() => linkCs486Objects([caller, data])).toThrow(
      /text-target cannot reference data symbol item/u,
    );
  });

  it("rejects cumulative linked data before constructing an oversized image", (): void => {
    const first = assembleCs486Object("global main\nmain:\nhalt", {
      dataBytes: 9 * 1_048_576,
    });
    const second = assembleCs486Object("global helper\nhelper:\nret", {
      dataBytes: 9 * 1_048_576,
    });

    expect(() => linkCs486Objects([first, second])).toThrow(
      /linked data limit exceeded/u,
    );
  });

  it("terminates circular includes and recursive macros with source diagnostics", (): void => {
    expect(() =>
      assembleCs486('%include "loop.inc"', {
        include: () => ({
          source: '%include "loop.inc"',
          sourceName: "/src/loop.inc",
        }),
        sourceName: "/src/main.asm",
      }),
    ).toThrow(/\/src\/loop\.inc:1:10: circular assembly include/u);
    expect(() =>
      assembleCs486("%macro LOOP 0\nLOOP\n%endmacro\nLOOP", {
        sourceName: "/src/macro.asm",
      }),
    ).toThrow(/macro expansion depth exceeded/u);
  });

  it("enforces source, lexical-token, and expanded-token budgets incrementally", (): void => {
    expect(cs486AsmPreprocessorLimits).toMatchObject({
      expandedTokens: 2_000_000,
      lexicalTokens: 2_000_000,
      sourceCharacters: 8 * 1_048_576,
    });
    expect(() =>
      preprocessCs486Assembly('%include "huge.inc"', {
        include: () => ({
          source: `;${"x".repeat(64)}`,
          sourceName: "/src/huge.inc",
        }),
        limits: { sourceCharacters: 64 },
        sourceName: "/src/main.asm",
      }),
    ).toThrow(/assembly source character limit exceeded/u);

    expect(() =>
      preprocessCs486Assembly(Array.from({ length: 9 }, () => "x").join(" "), {
        limits: { lexicalTokens: 8 },
        sourceName: "/src/tokens.asm",
      }),
    ).toThrow(/preprocessor lexical token limit exceeded/u);

    const replacements = Array.from({ length: 4 }, () => "X").join(" ");
    expect(() =>
      preprocessCs486Assembly(
        `%define X eax eax eax eax eax\n${replacements}`,
        {
          limits: { expandedTokens: 16 },
          sourceName: "/src/macro-limit.asm",
        },
      ),
    ).toThrow(/preprocessor token limit exceeded/u);
  });

  it("rejects native DOS/x86 directives instead of implying COM compatibility", (): void => {
    expect(() =>
      assembleCs486("ORG 100h\nINT 21h", {
        dialect: "dos",
        sourceName: "/drives/c/native.asm",
      }),
    ).toThrow(/ORG would imply unsupported native DOS\/x86 behavior/u);
  });
});

function runDeclared(executable: Cs486Executable): ReturnType<typeof runCs486> {
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("expected declared CS486 memory metadata");
  return runCs486(executable, {
    memoryBytes: requirements.linearAddressSpaceBytes,
  });
}
