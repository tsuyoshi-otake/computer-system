import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C file-scope linkage", (): void => {
  it("keeps same-named static functions and objects private to each object", (): void => {
    const firstSource = [
      "static int hidden = 40;",
      "static int helper(int value);",
      "static int helper(int value) { return hidden + value; }",
      "int from_first(void) { return helper(1); }",
    ].join("\n");
    const secondSource = [
      "static int hidden = 0;",
      "static int helper(int value) { return hidden + value; }",
      "int from_second(void) { return helper(1); }",
    ].join("\n");
    const mainSource = [
      "int from_first(void);",
      "int from_second(void);",
      "int main(void) { return from_first() + from_second(); }",
    ].join("\n");

    const first = compileCs486Object("c", firstSource);
    const second = compileCs486Object("c", secondSource);
    const main = compileCs486Object("c", mainSource);
    const executable = linkCs486Objects([main, first, second]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");

    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });

    expect(result.registers.eax).toBe(42);
    expect(result.registers.esp).toBe(requirements.linearAddressSpaceBytes);
    for (const object of [first, second]) {
      expect(object.symbols).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ binding: "local", name: "hidden" }),
          expect.objectContaining({ binding: "local", name: "helper" }),
        ]),
      );
    }
    expect(executable.symbols?.some(({ name }) => name === "hidden")).toBe(
      false,
    );
    expect(compileCs486Object("c", firstSource)).toEqual(first);
  });

  it("does not satisfy an external reference from another object's static definition", (): void => {
    const consumer = compileCs486Object(
      "c",
      "extern int hidden; int main(void) { return hidden; }",
    );
    const provider = compileCs486Object(
      "c",
      "static int hidden = 42; int expose(void) { return hidden; }",
    );

    expect(() => linkCs486Objects([consumer, provider])).toThrow(
      /unresolved symbol hidden/u,
    );
  });

  it("allocates function-local static state once in private object storage", (): void => {
    const source = [
      "int next_value(void) {",
      "  static int value = 40;",
      "  value = value + 1;",
      "  return value;",
      "}",
      "int other_value(void) { static int value = 1; return value; }",
      "int main(void) { return next_value() + next_value() + other_value(); }",
    ].join("\n");
    const object = compileCs486Object("c", source);
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");

    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });

    expect(result.registers.eax).toBe(84);
    expect(
      object.symbols.filter(({ name }) => name.startsWith(".L_static_")),
    ).toEqual([
      expect.objectContaining({ binding: "local", section: "data" }),
      expect.objectContaining({ binding: "local", section: "data" }),
    ]);
  });

  it("resolves a block-scope extern object through the ordinary linker", (): void => {
    const consumer = compileCs486Object(
      "c",
      "int main(void) { extern int shared; return shared; }",
    );
    const provider = compileCs486Object("c", "int shared = 42;");
    const executable = linkCs486Objects([consumer, provider]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");

    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(42);
    expect(consumer.symbols).toContainEqual(
      expect.objectContaining({
        binding: "undefined",
        name: "shared",
        type: "object",
      }),
    );
  });

  it("rejects conflicting, undefined, and invalid internal linkage", (): void => {
    expect(() =>
      compileCs486Object(
        "c",
        "static int value; extern int value; int main(void) { return 0; }",
      ),
    ).toThrow(/conflicting linkage for global value/u);
    expect(() =>
      compileCs486Object(
        "c",
        "static int helper(int value); int main(void) { return helper(1); }",
      ),
    ).toThrow(/static function helper is declared but not defined/u);
    expect(() =>
      compileCs486Object("c", "static int main(void) { return 0; }"),
    ).toThrow(/main cannot have internal linkage/u);
    expect(() =>
      compileCs486Object(
        "c",
        "extern static int value; int main(void) { return 0; }",
      ),
    ).toThrow(/cannot combine extern and static/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int seed(void) { return 1; } int value(void) { static int stored = seed(); return stored; } int main(void) { return value(); }",
      ),
    ).toThrow(/global initializer must be a bounded integer constant/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int main(void) { extern int value = 1; return value; }",
      ),
    ).toThrow(/block-scope extern declarations cannot have an initializer/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int read(void) { extern int value; return value; } static int value; int main(void) { return read(); }",
      ),
    ).toThrow(/conflicting linkage for global value/u);
  });
});
