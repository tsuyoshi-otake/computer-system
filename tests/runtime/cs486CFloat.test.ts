import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";
import {
  cs486Byte8DataModel,
  cs486Word32DataModel,
} from "../../src/domain/cpu/cs486Compatibility.js";

describe("CS C deterministic float and double", () => {
  it.each([
    [cs486Word32DataModel, 22],
    [cs486Byte8DataModel, 31],
  ] as const)(
    "runs arithmetic, calls, casts, and sizeof in %s",
    (dataModel, expected) => {
      const source = [
        "double add(double left, double right) { return left + right; }",
        "float twice(float value) { return value * 2.0f; }",
        "int main(void) {",
        "  double sum = add(1.5, 2.25);",
        "  float scaled = twice(1.25f);",
        "  long double alias = 0.5L;",
        "  unsigned long long exact = 4294967295ULL;",
        "  if(sizeof(long double) != sizeof(double) || alias != 0.5) return 90;",
        "  if((unsigned long long)(double)exact != exact || (long long)-3.75 != -3LL) return 91;",
        "  int comparison = sum == 3.75 && scaled == 2.5f;",
        "  return (int)(sum * 4.0) + (int)scaled + comparison * 2 + sizeof(float) + sizeof(double);",
        "}",
      ].join("\n");
      const object = compileCs486Object("c", source, { dataModel });
      expect(runObject(object).registers.eax).toBe(expected);
      expect(compileCs486Object("c", source, { dataModel })).toEqual(object);
      expect(
        object.symbols.find(({ name }) => name === "add")?.functionSignature,
      ).toBe("(f64,f64)->f64");
    },
  );

  it("folds constants bit-identically and preserves globals, aggregates, and callbacks", () => {
    const source = [
      '_Static_assert((0.1 + 0.2) == 0.30000000000000004, "same software fold");',
      "double global_value = 0x1.8p+2;",
      "struct point { double x; float y; };",
      "struct point point_value = { 1.25, 2.5f };",
      "double apply(double (*callback)(double), double value) { return callback(value); }",
      "double square(double value) { return value * value; }",
      "int main(void) {",
      "  double result = apply(square, point_value.x + point_value.y);",
      "  return (int)result + (int)global_value;",
      "}",
    ].join("\n");
    const first = compileCs486Object("c", source, {
      dataModel: cs486Byte8DataModel,
    });
    const second = compileCs486Object("c", source, {
      dataModel: cs486Byte8DataModel,
    });
    expect(second).toEqual(first);
    expect(runObject(first).registers.eax).toBe(20);
  });

  it("spills high-pressure double expressions and restores the declared stack", () => {
    const names = [
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
      "i",
      "j",
      "k",
      "l",
    ] as const;
    const expression = names.reduceRight(
      (tail, name) => (tail.length === 0 ? name : `${name} + (${tail})`),
      "",
    );
    const source = [
      "int main(void){",
      ...names.map(
        (name, index) => `  double ${name} = ${String(index + 1)}.0;`,
      ),
      `  double total = ${expression};`,
      "  return (int)total;",
      "}",
    ].join("\n");
    const object = compileCs486Object("c", source, {
      dataModel: cs486Byte8DataModel,
    });
    const executable = linkCs486Objects([object]);
    const requirements = cs486ExecutableMemoryRequirements(executable);
    if (requirements.kind !== "declared")
      throw new Error("C linker produced a legacy executable");
    const result = runCs486(executable, {
      memoryBytes: requirements.linearAddressSpaceBytes,
    });
    const frameOffsets = [
      ...object.assembly.matchAll(/^sub ecx, (\d+)$/gmu),
    ].map((match) => Number(match[1]));

    expect(result.registers.eax).toBe(78);
    expect(result.registers.esp).toBe(requirements.linearAddressSpaceBytes);
    expect(Math.max(...frameOffsets)).toBeGreaterThan(names.length * 8);
    expect(
      compileCs486Object("c", source, { dataModel: cs486Byte8DataModel }),
    ).toEqual(object);
  });

  it("bounds literals and rejects malformed floating tokens", () => {
    expect(() =>
      compileCs486Object(
        "c",
        `double value = 1e4097; int main(void){return 0;}`,
      ),
    ).toThrow(/exponent limit/u);
    expect(() =>
      compileCs486Object("c", `float value = 1.0ff; int main(void){return 0;}`),
    ).toThrow(/floating literal/u);
  });
});

function runObject(
  object: ReturnType<typeof compileCs486Object>,
): ReturnType<typeof runCs486> {
  const executable = linkCs486Objects([object]);
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("C linker produced a legacy executable");
  return runCs486(executable, {
    memoryBytes: requirements.linearAddressSpaceBytes,
  });
}
