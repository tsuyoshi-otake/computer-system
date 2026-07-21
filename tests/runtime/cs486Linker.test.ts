import { describe, expect, it } from "vitest";

import { assembleCs486Object } from "../../src/application/toolchain/cs486Assembler.js";
import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import {
  Cs486LinkError,
  linkCs486Objects,
} from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
  validateCs486Executable,
} from "../../src/domain/cpu/cs486.js";
import { validateCs486Object } from "../../src/domain/cpu/cs486Object.js";
import type { Cs486Object } from "../../src/domain/cpu/cs486Object.js";

describe("CS486 static linker", (): void => {
  it("links typed C functions with independent stack-framed locals", (): void => {
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
    const decodedExecutable: unknown = JSON.parse(JSON.stringify(executable));
    validateCs486Executable(decodedExecutable);
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });

    expect(result.output).toBe("42\n");
    expect(result.registers.esp).toBe(declaredLinearMemoryBytes(executable));
    expect(executable.dataBytes).toBe(4);
    expect(executable.symbols?.map(({ name }) => name)).toEqual([
      "main",
      "helper",
    ]);
    expect(decodedExecutable.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionSignature: "()->i32",
          name: "main",
        }),
        expect.objectContaining({
          functionSignature: "()->i32",
          name: "helper",
        }),
      ]),
    );
    expect(() =>
      validateCs486Executable({
        ...executable,
        symbols: executable.symbols?.map((symbol) => ({
          ...symbol,
          functionSignature: "()->i128" as never,
        })),
      }),
    ).toThrow(/symbol table/u);
    expect(main.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          binding: "global",
          functionSignature: "()->i32",
          name: "main",
          section: "text",
          type: "function",
        }),
        expect.objectContaining({
          binding: "undefined",
          functionSignature: "()->i32",
          name: "helper",
          section: "text",
          type: "function",
        }),
      ]),
    );
    expect(
      main.sections?.find((section) => section.name === "bss"),
    ).toMatchObject({ alignment: 4, size: 0 });
    const stores = executable.instructions.filter(
      (instruction) => instruction.op === "store",
    );
    expect(stores.length).toBeGreaterThanOrEqual(2);
    expect(stores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          address: { kind: "register", register: "ecx" },
        }),
      ]),
    );
  });

  it("reserves address zero so the first data symbol is never a null pointer", (): void => {
    const object = compileCs486Object(
      "c",
      'int main(void) { char *value = "ok"; return value != (char *)0 && value[0] == 111 ? 42 : 0; }',
    );
    const executable = linkCs486Objects([object]);

    expect(executable.dataBytes).toBeGreaterThanOrEqual(12);
    expect(
      (executable.initialData ?? []).every(({ offset }) => offset >= 4),
    ).toBe(true);
    expect(
      runCs486(executable, {
        memoryBytes: declaredLinearMemoryBytes(executable),
      }).registers.eax,
    ).toBe(42);
  });

  it("runs recursive and cross-object multi-argument calls with exact stack cleanup", (): void => {
    const main = compileCs486Object(
      "c",
      [
        "extern int combine(int, int, int);",
        "int main(void) {",
        "  int result = combine(6, 2, 3);",
        '  printf("%d\\n", result);',
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const helper = compileCs486Object(
      "c",
      [
        "int fib(int n) {",
        "  if (n <= 1) { return n; }",
        "  return fib(n - 1) + fib(n - 2);",
        "}",
        "int combine(int a, int b, int c) {",
        "  return fib(a) + b + c;",
        "}",
      ].join("\n"),
    );

    const executable = linkCs486Objects([main, helper]);
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });

    expect(result.output).toBe("13\n");
    expect(result.registers.esp).toBe(declaredLinearMemoryBytes(executable));
    expect(main).toMatchObject({ dataModel: "cs-word32-v1", version: 4 });
    expect(main.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionSignature: "(i32,i32,i32)->i32",
          name: "combine",
        }),
      ]),
    );
    expect(helper.symbols).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          functionSignature: "(i32)->i32",
          name: "fib",
        }),
      ]),
    );
  });

  it("rejects source and cross-object argument arity mismatches", (): void => {
    expect(() =>
      compileCs486Object(
        "c",
        "int add(int a, int b); int main(void) { return add(1); }",
      ),
    ).toThrow(/expects 2 arguments, received 1/u);

    const caller = assembleCs486Object(
      "global main\ntype main, function\nsignature main, i32\nextern add\ntype add, function\nsignature add, i32, i32\nmain:\nmov eax, 1\npush eax\ncall add\nadd esp, 4\nret",
    );
    const provider = assembleCs486Object(
      "global add\ntype add, function\nsignature add, i32, i32, i32\nadd:\nmov eax, 0\nret",
    );
    expect(() => linkCs486Objects([caller, provider])).toThrow(
      /function signature mismatch add/u,
    );
    expect(() =>
      compileCs486Object(
        "c",
        "int duplicate(int value) { int value = 1; return value; }",
      ),
    ).toThrow(/duplicate declaration of variable value/u);
  });

  it("preserves ESI, EDI, and EBP across a C callee", (): void => {
    const caller = assembleCs486Object(
      [
        "global main",
        "type main, function",
        "signature main, i32",
        "extern add",
        "type add, function",
        "signature add, i32, i32, i32",
        "main:",
        "mov esi, 111",
        "mov edi, 222",
        "mov eax, 22",
        "push eax",
        "mov eax, 20",
        "push eax",
        "call add",
        "add esp, 8",
        "cmp esi, 111",
        "jne failed",
        "cmp edi, 222",
        "jne failed",
        "print eax",
        "ret",
        "failed:",
        "print 0",
        "ret",
      ].join("\n"),
    );
    const callee = compileCs486Object(
      "c",
      "int add(int left, int right) { return left + right; }",
    );
    const executable = linkCs486Objects([caller, callee]);
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });

    expect(result.output).toBe("42");
    expect(result.registers.esp).toBe(declaredLinearMemoryBytes(executable));
  });

  it("rejects conflicting known C function signatures deterministically", (): void => {
    const caller = compileCs486Object(
      "c",
      "extern int helper(); int main() { return helper(); }",
    );
    const provider = compileCs486Object("c", "void helper() { return; }");

    expect(() => linkCs486Objects([caller, provider])).toThrow(
      "function signature mismatch helper: expected ()->i32, found ()->void",
    );

    const voidCaller = compileCs486Object(
      "c",
      "extern void helper(); int main() { helper(); return 0; }",
    );
    const integerProvider = compileCs486Object(
      "c",
      "int helper() { return 42; }",
    );
    expect(() => linkCs486Objects([voidCaller, integerProvider])).toThrow(
      "function signature mismatch helper: expected ()->void, found ()->i32",
    );
  });

  it("accepts an untyped ASM definition for backward-compatible C linkage", (): void => {
    const caller = compileCs486Object(
      "c",
      "extern int helper(); int main() { return helper(); }",
    );
    const provider = assembleCs486Object(
      "global helper\nhelper:\nmov eax, 42\nret",
    );

    const executable = linkCs486Objects([caller, provider]);
    expect(
      runCs486(executable, {
        memoryBytes: declaredLinearMemoryBytes(executable),
      }).registers.eax,
    ).toBe(42);
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

    const executable = linkCs486Objects([entry, worker]);
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });
    expect(result.output).toBe("42");
  });

  it("continues to read and execute legacy v1 objects", (): void => {
    const legacy: Cs486Object = {
      assembly: "main:\nmov eax, 42\nprint eax\nret",
      dataBytes: 0,
      format: "cs486-object",
      language: "asm",
      relocations: [],
      symbols: [
        { binding: "global", name: "main", offset: 0, section: "text" },
      ],
      version: 1,
    };

    validateCs486Object(legacy);
    const executable = linkCs486Objects([legacy]);
    expect(
      runCs486(executable, {
        memoryBytes: declaredLinearMemoryBytes(executable),
      }).output,
    ).toBe("42");
    expect(() =>
      validateCs486Object({
        ...legacy,
        symbols: legacy.symbols.map((symbol) => ({
          ...symbol,
          functionSignature: "()->i32",
        })),
      }),
    ).toThrow(/symbol/u);
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
    const typed = compileCs486Object("c", "int main() { return 0; }");
    expect(() =>
      validateCs486Object({
        ...typed,
        symbols: typed.symbols.map((symbol) => ({
          ...symbol,
          functionSignature: "()->i128" as never,
        })),
      }),
    ).toThrow(/object symbol/u);
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

    const relocatable = assembleCs486Object(
      "global main\nextern helper\nmain:\ncall helper\nhalt",
    );
    expect(() =>
      validateCs486Object({
        ...relocatable,
        relocations: relocatable.relocations.map((relocation) => ({
          ...relocation,
          offset: 999,
        })),
      }),
    ).toThrow(/relocation offset/u);
    expect(() =>
      validateCs486Object({
        ...relocatable,
        sections: [...relocatable.sections!].reverse(),
      }),
    ).toThrow(/section/u);
  });
});

function declaredLinearMemoryBytes(
  executable: Parameters<typeof cs486ExecutableMemoryRequirements>[0],
): number {
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared") {
    throw new Error("expected declared CS486 memory metadata");
  }
  return requirements.linearAddressSpaceBytes;
}
