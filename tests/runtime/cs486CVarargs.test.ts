import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C bounded variadic ABI", (): void => {
  it("passes the hidden count and variadic words without leaking stack", (): void => {
    const source = [
      "struct List { int *next; int remaining; };",
      "void __cs_va_start(void *list);",
      "int sum(int first, ...) {",
      "  struct List list;",
      "  __cs_va_start(&list);",
      "  int total = first;",
      "  while (list.remaining > 0) {",
      "    total = total + *list.next;",
      "    list.next = list.next + 1;",
      "    list.remaining = list.remaining - 1;",
      "  }",
      "  return total;",
      "}",
      "int main(void) { return sum(10, 20, 12); }",
    ].join("\n");

    const first = compileCs486Object("c", source);
    const second = compileCs486Object("c", source);
    const executable = linkCs486Objects([first]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");

    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });

    expect(second).toEqual(first);
    expect(result.registers.eax).toBe(42);
    expect(result.registers.esp).toBe(requirements.linearAddressSpaceBytes);
    expect(first.symbols).toContainEqual(
      expect.objectContaining({
        functionSignature: "(i32,...)->i32",
        name: "sum",
      }),
    );
  });

  it("links matching declarations and rejects fixed/variadic disagreement", (): void => {
    const caller = compileCs486Object(
      "c",
      "int sum(int first, ...); int main(void) { return sum(40, 2); }",
    );
    const provider = compileCs486Object(
      "c",
      [
        "struct List { int *next; int remaining; };",
        "void __cs_va_start(void *list);",
        "int sum(int first, ...) {",
        "  struct List list;",
        "  __cs_va_start(&list);",
        "  return first + *list.next;",
        "}",
      ].join("\n"),
    );
    const executable = linkCs486Objects([caller, provider]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");
    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(42);

    const fixed = compileCs486Object(
      "c",
      "int sum(int first); int main(void) { return sum(42); }",
    );
    expect(() => linkCs486Objects([fixed, provider])).toThrow(
      /function signature mismatch sum/u,
    );
  });

  it("rejects missing fixed arguments and actual argument capacity plus one", (): void => {
    expect(() =>
      compileCs486Object(
        "c",
        "int sum(int first, ...); int main(void) { return sum(); }",
      ),
    ).toThrow(/expects at least 1 arguments, received 0/u);

    const arguments_ = Array.from({ length: 33 }, (_, index) => String(index));
    expect(() =>
      compileCs486Object(
        "c",
        `int sum(int first, ...); int main(void) { return sum(${arguments_.join(", ")}); }`,
      ),
    ).toThrow(/function argument limit exceeded/u);
  });

  it("rejects malformed variadic declarations and signature directives", (): void => {
    expect(() =>
      compileCs486Object(
        "c",
        "int sum(int first, ..., int last); int main(void) { return 0; }",
      ),
    ).toThrow(/expected "\)"/u);
    expect(() =>
      compileCs486Object("c", "int sum(int first, ...); int sum(int first);"),
    ).toThrow(/conflicting variadic contract/u);
    expect(() =>
      compileCs486Object(
        "c",
        "void __cs_va_start(void *list); int main(void) { int list[2]; __cs_va_start(list); return 0; }",
      ),
    ).toThrow(/may only be called from a variadic function/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int __cs_va_start(void *list); int main(void) { return 0; }",
      ),
    ).toThrow(/must be declared as void __cs_va_start\(void \*\)/u);
  });
});
