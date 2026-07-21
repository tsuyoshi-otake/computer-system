import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C word pointers and arrays", (): void => {
  it("runs pointer parameters, dereference, indexing, casts, and sizeof", (): void => {
    const object = compileCs486Object(
      "c",
      [
        "int sum(int values[], int count) {",
        "  int total = 0;",
        "  for (int i = 0; i < count; i++) {",
        "    total = total + values[i];",
        "  }",
        "  return total;",
        "}",
        "int main(void) {",
        "  int values[4];",
        "  int matrix[2][3];",
        "  int *p = &values[0];",
        "  values[0] = 10;",
        "  values[1] = 20;",
        "  *(p + 2) = 30;",
        "  values[3] = 40;",
        "  matrix[1][2] = 42;",
        '  printf("%d\\n", sum(values, 4));',
        '  printf("%d\\n", matrix[1][2]);',
        '  printf("%d\\n", sizeof(values));',
        '  printf("%d\\n", sizeof(matrix));',
        '  printf("%d\\n", sizeof(int *));',
        '  printf("%d\\n", (p + 3) - (int *)p);',
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared") {
      throw new Error("C linker produced a legacy executable");
    }
    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });

    expect(result.output).toBe("100\n42\n4\n6\n1\n3\n");
    expect(result.registers.esp).toBe(requirements.linearAddressSpaceBytes);
  });

  it("rejects incompatible, void, excessive, and non-lvalue pointer forms", (): void => {
    expect(() =>
      compileCs486Object("c", "int main(void) { int values[0]; return 0; }"),
    ).toThrow(/array length must be positive/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int main(void) { int value = 1; &(value + 1); return 0; }",
      ),
    ).toThrow(/address operand is not an lvalue/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int main(void) { void *pointer; return *(pointer); }",
      ),
    ).toThrow(/dereference requires a non-void pointer/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int main(void) { int value; long *pointer = &value; return 0; }",
      ),
    ).toThrow(/incompatible assignment types/u);
    expect(() =>
      compileCs486Object("c", "int main(void) { int values[257]; return 0; }"),
    ).toThrow(/local variable limit exceeded/u);
  });
});
