import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C bounded goto and labels", (): void => {
  it("lowers forward cleanup and backward loop edges into validated CSIR", (): void => {
    const source = [
      "int cleanup(int failed) {",
      "  int value = 40;",
      "  if (failed) goto done;",
      "  value = 0;",
      "done:",
      "  return value + 2;",
      "}",
      "int repeat(void) {",
      "  int index = 0; int total = 0;",
      "again:",
      "  total = total + index;",
      "  index = index + 1;",
      "  if (index < 3) goto again;",
      "  return total;",
      "}",
      "int main(void) { return cleanup(1) + repeat(); }",
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
    expect(result.registers.eax).toBe(45);
    expect(result.registers.esp).toBe(requirements.linearAddressSpaceBytes);
  });

  it("rejects undefined, duplicate, nested, and excessive labels", (): void => {
    expect(() =>
      compileCs486Object("c", "int main(void) { goto missing; return 0; }"),
    ).toThrow(/undefined label missing/u);
    expect(() =>
      compileCs486Object("c", "int main(void) { same: ; same: return 0; }"),
    ).toThrow(/duplicate label same/u);
    expect(() =>
      compileCs486Object(
        "c",
        "int main(void) { if (1) { nested: return 1; } return 0; }",
      ),
    ).toThrow(/must be in the function's outer block/u);

    const labels = Array.from(
      { length: 257 },
      (_, index) => `label_${String(index)}: ;`,
    );
    expect(() =>
      compileCs486Object(
        "c",
        `int main(void) { ${labels.join(" ")} return 0; }`,
      ),
    ).toThrow(/function label limit exceeded/u);
  });

  it("rejects goto capacity plus one before IR construction", (): void => {
    const gotos = Array.from({ length: 1_025 }, () => "goto done;");
    expect(() =>
      compileCs486Object(
        "c",
        `int main(void) { ${gotos.join(" ")} done: return 0; }`,
      ),
    ).toThrow(/function goto limit exceeded/u);
  });
});
