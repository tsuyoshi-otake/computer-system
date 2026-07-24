import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C word-profile integer conversions", (): void => {
  it("executes unsigned wrap, division, comparison, and logical right shift", (): void => {
    const source = [
      '_Static_assert(0xffffffffu > 1u, "unsigned comparison");',
      '_Static_assert((0x80000000u >> 31) == 1u, "logical right shift");',
      "int main(void) {",
      "  unsigned int maximum = 0xffffffffu;",
      "  unsigned long high = 0x80000000ul;",
      "  unsigned int wrapped = maximum + 1u;",
      "  unsigned int quotient = high / 3u;",
      "  unsigned int remainder = maximum % 10u;",
      "  return (wrapped == 0u ? 10 : 0)",
      "    + (quotient == 0x2aaaaaaau ? 10 : 0)",
      "    + (remainder == 5u ? 10 : 0)",
      "    + (maximum > 1u ? 10 : 0)",
      "    + ((high >> 31) == 1u ? 2 : 0);",
      "}",
    ].join("\n");

    const object = compileCs486Object("c", source);
    expect(runObject(object).registers.eax).toBe(42);
    const text = object.sections?.find(({ name }) => name === "text");
    if (text?.name !== "text") throw new Error("C object has no text section");
    expect(text.instructions.map(({ op }) => op)).toEqual(
      expect.arrayContaining(["udiv", "umod", "ushr"]),
    );
    expect(compileCs486Object("c", source)).toEqual(object);
  });

  it("applies integer promotions and usual signed/unsigned conversions", (): void => {
    const source = [
      "int main(void) {",
      "  signed char negative = -1;",
      "  unsigned short maximum = 0xffffffffu;",
      "  int mixed = -1 < 1u;",
      "  int signed_shift = (-2 >> 1) == -1;",
      "  return (negative < 0 ? 10 : 0)",
      "    + ((maximum >> 31) == 1u ? 10 : 0)",
      "    + (mixed == 0 ? 10 : 0)",
      "    + (signed_shift ? 10 : 0)",
      "    + ((unsigned int)-1 == 0xffffffffu ? 2 : 0);",
      "}",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
  });

  it("keeps every one-word integer spelling and sizeof contract consistent", (): void => {
    const source = [
      '_Static_assert(sizeof(char) == 1, "char word");',
      '_Static_assert(sizeof(signed char) == 1, "signed char word");',
      '_Static_assert(sizeof(unsigned char) == 1, "unsigned char word");',
      '_Static_assert(sizeof(short int) == 1, "short word");',
      '_Static_assert(sizeof(long unsigned int) == 1, "unsigned long word");',
      "int main(void) { unsigned value = 41u; return value + sizeof(short); }",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
  });

  it("selects a bounded signed or unsigned enum representation", (): void => {
    const source = [
      "enum mask { MASK_LOW = 1, MASK_HIGH = 1u << 31, MASK_ALL = 0xffffffffu };",
      '_Static_assert(MASK_HIGH > MASK_LOW, "unsigned enum comparison");',
      "enum mask selected = MASK_HIGH;",
      "int main(void) {",
      "  enum mask local = MASK_ALL;",
      "  return (selected > MASK_LOW ? 20 : 0)",
      "    + (local == 0xffffffffu ? 20 : 0)",
      "    + (sizeof(enum mask) == 1 ? 2 : 0);",
      "}",
    ].join("\n");

    const object = compileCs486Object("c", source);
    expect(runObject(object).registers.eax).toBe(42);
    expect(compileCs486Object("c", source)).toEqual(object);
  });

  it("rejects incomplete and out-of-range enum definitions", (): void => {
    for (const [source, message] of [
      ["enum missing value;", /incomplete enum missing/u],
      [
        "enum too_large { TOO_LARGE = 0x100000000ull };",
        /outside the CS 32-bit enum range/u,
      ],
      [
        "enum too_small { TOO_SMALL = -2147483649ll };",
        /outside the CS 32-bit enum range/u,
      ],
    ] as const)
      expect(() => compileCs486Object("c", source)).toThrow(message);
  });

  it("lowers bounded long long values through the two-word ABI", (): void => {
    expect(
      run(
        "int main(void) { unsigned long long value = 5ull % 3ull; return (int)value; }",
      ).registers.eax,
    ).toBe(2);
    const source = [
      "typedef unsigned long long (*wide_binary)(unsigned long long, unsigned long long);",
      '_Static_assert((1ull << 32) == 0x100000000ull, "wide constant shift");',
      '_Static_assert(0xffffffffffffffffull > 1ull, "wide unsigned comparison");',
      "unsigned long long global_counter = (1ull << 32) + 1ull;",
      "unsigned long long add64(unsigned long long left, unsigned long long right) { return left + right; }",
      "long long divide64(long long left, long long right) { return left / right; }",
      "int main(void) {",
      "  wide_binary callback = add64;",
      "  unsigned long long carried = callback(0xffffffffull, 1ull);",
      "  unsigned long long product = global_counter * 3ull;",
      "  unsigned long long shifted = 0x8000000000000000ull >> 63;",
      "  unsigned long long quotient = 0x100000000ull / 0x10000ull;",
      "  unsigned long long remainder = 0x100000005ull % 3ull;",
      "  long long signed_value = divide64(-84ll, 2ll);",
      "  return (carried == 0x100000000ull ? 1 : 0)",
      "    + (product == 0x300000003ull ? 2 : 0)",
      "    + (shifted == 1ull ? 4 : 0)",
      "    + (quotient == 0x10000ull ? 8 : 0)",
      "    + (remainder == 0ull ? 16 : 0)",
      "    + (signed_value == -42ll ? 32 : 0)",
      "    + (sizeof(unsigned long long) == 2 ? 64 : 0);",
      "}",
    ].join("\n");

    const object = compileCs486Object("c", source);
    expect(runObject(object).registers.eax).toBe(127);
    expect(object.symbols).toContainEqual(
      expect.objectContaining({
        functionSignature: "(i64,i64)->i64",
        name: "add64",
      }),
    );
    expect(compileCs486Object("c", source)).toEqual(object);
  });

  it("rejects conflicting, duplicate, and out-of-range one-word forms", (): void => {
    for (const [source, message] of [
      ["signed unsigned int value;", /conflicting integer signedness/u],
      ["short short value;", /duplicate short/u],
      ["char long value;", /char cannot combine/u],
      ["unsigned int value = 1uu;", /invalid integer literal suffix/u],
      [
        "long long value = 9223372036854775808ll;",
        /outside its long long range/u,
      ],
    ] as const)
      expect(() => compileCs486Object("c", source)).toThrow(message);

    expect(() =>
      compileCs486Object(
        "c",
        `int excessive(${Array.from({ length: 17 }, (_, index) => `long long value${String(index)}`).join(", ")}) { return 0; }`,
      ),
    ).toThrow(/parameter word limit/u);
    expect(() =>
      compileCs486Object("c", "int main(void) { return (int)(1ull << 64); }"),
    ).toThrow(/shift count must be between 0 and 63/u);
    expect(() =>
      run(
        "int main(void) { unsigned long long zero = 0ull; return (int)(1ull / zero); }",
      ),
    ).toThrow(/division by zero/u);
  });
});

function run(source: string): ReturnType<typeof runCs486> {
  return runObject(compileCs486Object("c", source));
}

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
