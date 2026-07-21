import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C common C11 scalar and compile-time features", (): void => {
  it("normalizes _Bool at assignment, parameter, and return boundaries", (): void => {
    const result = run([
      '_Static_assert(sizeof(_Bool) == 1, "bool occupies one CS word");',
      'static_assert(_Alignof(int) == 1, "word alignment");',
      "_Bool truth(int value) { return value; }",
      "int consume(_Bool value) { return value; }",
      "int main(void) {",
      "  _Bool first = 42;",
      "  _Bool second = 0;",
      "  second = 7;",
      "  return consume(first) + truth(99) + (__func__[0] == 109 ? 39 : 0) + alignof(long);",
      "}",
    ]);

    expect(result.registers.eax).toBe(42);
  });

  it("evaluates bounded integer static assertions and reports authored failures", (): void => {
    expect(() =>
      compileCs486Object(
        "c",
        'enum value { answer = 42 }; _Static_assert((answer * 2) == 84, "enum arithmetic"); int main(void) { return 0; }',
      ),
    ).not.toThrow();
    expect(() =>
      compileCs486Object(
        "c",
        '_Static_assert(2 + 2 == 5, "arithmetic contract"); int main(void) { return 0; }',
      ),
    ).toThrow(/static assertion failed: arithmetic contract/u);
    expect(() =>
      compileCs486Object(
        "c",
        'int value; _Static_assert(value, "not constant"); int main(void) { return 0; }',
      ),
    ).toThrow(/bounded integer constant expression/u);
  });

  it("rejects alignof on void, functions, and incomplete aggregates", (): void => {
    for (const source of [
      "int main(void) { return alignof(void); }",
      "int callback(void); int main(void) { return alignof(callback); }",
      "struct pending; int main(void) { return alignof(struct pending); }",
    ])
      expect(() => compileCs486Object("c", source)).toThrow(
        /alignof requires|incomplete struct/u,
      );
  });
});

function run(lines: readonly string[]): ReturnType<typeof runCs486> {
  const executable = linkCs486Objects([
    compileCs486Object("c", lines.join("\n")),
  ]);
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("C linker produced a legacy executable");
  return runCs486(executable, {
    memoryBytes: requirements.linearAddressSpaceBytes,
  });
}
