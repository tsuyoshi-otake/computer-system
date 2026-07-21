import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
} from "../../src/domain/cpu/cs486.js";

describe("CS C aggregates", (): void => {
  it("lays out unions with overlapping fields and the largest member size", (): void => {
    const source = [
      "union word_or_pair { int word; int pair[2]; };",
      '_Static_assert(sizeof(union word_or_pair) == 2, "largest union member");',
      "int main(void) {",
      "  union word_or_pair local = { .word = 40 };",
      "  local.pair[0] = local.pair[0] + 2;",
      "  return local.word;",
      "}",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
    expect(compileCs486Object("c", source)).toEqual(
      compileCs486Object("c", source),
    );
  });

  it("supports nested array, struct, and union designators with zero fill", (): void => {
    const source = [
      "union selected { int answer; int ignored[2]; };",
      "struct configuration { int prefix; int values[3]; union selected choice; };",
      "struct configuration global = {",
      "  .values[2] = 5,",
      "  .prefix = 4,",
      "  .values[0] = 30,",
      "  .choice.answer = 3",
      "};",
      "int main(void) {",
      "  int local[3] = { [2] = 0, [1] = global.values[2] };",
      "  return global.prefix + global.values[0] + global.values[1] + local[1] + global.choice.answer;",
      "}",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
  });

  it("supports a final flexible array member without charging base size", (): void => {
    const source = [
      "struct packet { int length; char payload[]; };",
      '_Static_assert(sizeof(struct packet) == 1, "flexible member excluded");',
      "int main(void) { struct packet header = { .length = 41 }; return header.length + sizeof(struct packet); }",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
  });

  it("materializes bounded compound literals with runtime initializer expressions", (): void => {
    const source = [
      "struct pair { int left; int right; };",
      "int sum(const struct pair *value) { return value->left + value->right; }",
      "int main(void) {",
      "  int base = 19;",
      "  int first = sum(&(struct pair){ .right = 23, .left = base });",
      "  return (int[2]){ [1] = first }[1];",
      "}",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
  });

  it("packs and accesses deterministic word-profile bit-fields", (): void => {
    const source = [
      "struct flags {",
      "  unsigned int low : 3;",
      "  signed int signed_value : 5;",
      "  unsigned int payload : 24;",
      "  unsigned int next : 2;",
      "};",
      "union overlay { unsigned int nibble : 4; unsigned int word; };",
      '_Static_assert(sizeof(struct flags) == 2, "packed words");',
      '_Static_assert(sizeof(union overlay) == 1, "union allocation unit");',
      "struct flags global = { .low = 5, .signed_value = -3, .payload = 0xabcdefu, .next = 2 };",
      "int main(void) {",
      "  int base = 4;",
      "  struct flags local = { .low = base + 1, .signed_value = -3, .payload = 0xabcdefu, .next = 2 };",
      "  union overlay shared = { .word = 15 };",
      "  local.low = local.low + 1;",
      "  local.signed_value = -2;",
      "  return (global.low == 5u ? 1 : 0)",
      "    + (global.signed_value == -3 ? 2 : 0)",
      "    + (global.payload == 0xabcdefu ? 4 : 0)",
      "    + (local.low == 6u ? 8 : 0)",
      "    + (local.signed_value == -2 ? 16 : 0)",
      "    + (shared.nibble == 15u && local.next == 2u ? 11 : 0);",
      "}",
    ].join("\n");

    const object = compileCs486Object("c", source);
    expect(runObject(object).registers.eax).toBe(42);
    expect(compileCs486Object("c", source)).toEqual(object);
  });

  it("honors unnamed zero-width bit-field word boundaries", (): void => {
    const source = [
      "struct separated { unsigned int first : 1; unsigned int : 0; unsigned int second : 1; };",
      '_Static_assert(sizeof(struct separated) == 2, "zero-width boundary");',
      "int main(void) { struct separated value = { .first = 1, .second = 1 }; return value.first + value.second + 40; }",
    ].join("\n");

    expect(run(source).registers.eax).toBe(42);
  });

  it("rejects ambiguous or invalid bounded aggregate forms", (): void => {
    for (const [source, message] of [
      [
        "union choice { int first; int second; }; union choice value = { .first = 1, .second = 2 };",
        /only one active member/u,
      ],
      ["int values[2] = { [2] = 1 };", /in-range integer constant/u],
      ["struct invalid { int values[]; };", /preceding named field/u],
      [
        "struct invalid { int count; int values[]; int tail; };",
        /final struct field/u,
      ],
      ["union invalid { int values[]; int word; };", /fixed length/u],
      ["struct invalid { unsigned int named : 0; };", /must be unnamed/u],
      ["struct invalid { unsigned int field : 33; };", /from 0 through 32/u],
      [
        "struct invalid { unsigned long long field : 3; };",
        /one-word integer/u,
      ],
      ["struct invalid { _Bool field : 2; };", /cannot exceed 1/u],
      [
        "struct invalid { unsigned int field : 3; }; struct invalid value = { .field = 1, .field = 2 };",
        /duplicate designated initializer/u,
      ],
      [
        "struct invalid { unsigned int field : 3; }; int main(void) { struct invalid value; return (int)&value.field; }",
        /do not have an address/u,
      ],
    ] as const)
      expect(() => compileCs486Object("c", source)).toThrow(message);
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
