import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C function pointers", (): void => {
  it("executes callback parameters, function-address initializers, tables, and dereferenced calls", (): void => {
    const source = [
      "typedef int (*binary_fn)(int, int);",
      "int add(int left, int right) { return left + right; }",
      "int subtract(int left, int right) { return left - right; }",
      "int apply(binary_fn callback, int left, int right) {",
      "  return callback(left, right);",
      "}",
      "binary_fn operations[2] = { add, &subtract };",
      "int main(void) {",
      "  binary_fn selected = operations[0];",
      "  int result = apply(selected, 20, 22);",
      "  if (selected != 0) { result = result + (*operations[1])(50, 8); }",
      "  return result;",
      "}",
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
    expect(result.registers.esp).toBe(requirements.linearAddressSpaceBytes);
    expect(object.relocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "data",
          symbol: "add",
          type: "function-address",
        }),
        expect.objectContaining({
          field: "data",
          symbol: "subtract",
          type: "function-address",
        }),
      ]),
    );
    const text = object.sections?.find(({ name }) => name === "text");
    expect(
      text?.name === "text" &&
        text.instructions.some(({ op }) => op === "call_indirect"),
    ).toBe(true);
    expect(compileCs486Object("c", source)).toEqual(object);
  });

  it("supports direct function-pointer declarators and void callbacks", (): void => {
    const source = [
      "int increment(int value) { return value + 1; }",
      "int invoke(int (*callback)(int), int value) { return callback(value); }",
      "int (*selected)(int) = increment;",
      "int main(void) { return invoke(selected, 41); }",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
    expect(() =>
      compileCs486Object(
        "c",
        "void notify(int value); int run(void (*callback)(int)) { callback(1); return 0; }",
      ),
    ).not.toThrow();
  });

  it("relocates an external function address and admits the provider entry", (): void => {
    const consumer = compileCs486Object(
      "c",
      [
        "typedef int (*binary_fn)(int, int);",
        "int add(int left, int right);",
        "int apply(binary_fn callback, int left, int right) { return callback(left, right); }",
        "int main(void) { binary_fn callback = add; return apply(callback, 19, 23); }",
      ].join("\n"),
    );
    const provider = compileCs486Object(
      "c",
      "int add(int left, int right) { return left + right; }",
    );
    const executable = linkCs486Objects([consumer, provider]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");

    expect(
      runCs486(executable, {
        memoryBytes: requirements.linearAddressSpaceBytes,
      }).registers.eax,
    ).toBe(42);
    expect(consumer.relocations).toContainEqual(
      expect.objectContaining({ symbol: "add", type: "function-address" }),
    );
    expect(
      executable.functionEntries?.some(
        ({ address, functionSignature }) =>
          functionSignature === "(i32,i32)->i32" && address >= 2,
      ),
    ).toBe(true);
  });

  it("uses the bounded hidden-count ABI for variadic function pointers", (): void => {
    const source = [
      "typedef int (*variadic_fn)(int, ...);",
      "int first(int value, ...) { return value; }",
      "int main(void) { variadic_fn callback = first; return callback(42, 7, 9); }",
    ].join("\n");
    const executable = linkCs486Objects([compileCs486Object("c", source)]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");
    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });

    expect(result.registers.eax).toBe(42);
    expect(result.registers.esp).toBe(requirements.linearAddressSpaceBytes);
    expect(executable.functionEntries).toContainEqual(
      expect.objectContaining({ functionSignature: "(i32,...)->i32" }),
    );
  });

  it("rejects incompatible pointers and function-pointer arithmetic", (): void => {
    expect(() =>
      compileCs486Object(
        "c",
        [
          "typedef int (*unary_fn)(int);",
          "int add(int left, int right) { return left + right; }",
          "int main(void) { unary_fn callback = add; return callback(1); }",
        ].join("\n"),
      ),
    ).toThrow(/incompatible assignment types/u);
    expect(() =>
      compileCs486Object(
        "c",
        [
          "typedef int (*unary_fn)(int);",
          "int increment(int value) { return value + 1; }",
          "int main(void) { unary_fn callback = increment; return (callback + 1)(1); }",
        ].join("\n"),
      ),
    ).toThrow(/function pointer arithmetic is not supported/u);
    expect(() =>
      compileCs486Object(
        "c",
        "typedef int (*unary_fn)(int); int main(void) { unary_fn callback = 0; return callback(1); }",
      ),
    ).not.toThrow();
  });
});

function run(source: string): ReturnType<typeof runCs486> {
  const executable = linkCs486Objects([compileCs486Object("c", source)]);
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("C linker produced a legacy executable");
  return runCs486(executable, {
    memoryBytes: requirements.linearAddressSpaceBytes,
  });
}
