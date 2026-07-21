import { describe, expect, it } from "vitest";

import { compileCs486Object } from "../../src/application/toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  cs486ExecutableMemoryRequirements,
  runCs486,
  type Cs486Executable,
} from "../../src/domain/cpu/cs486.js";

function declaredLinearMemoryBytes(executable: Cs486Executable): number {
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared") {
    throw new Error("C linker produced a legacy executable");
  }
  return requirements.linearAddressSpaceBytes;
}

describe("CS C globals and word strings", (): void => {
  it("runs initialized, zero-initialized, aggregate, pointer, and string globals", (): void => {
    const source = [
      "struct Pair { int left; int right; };",
      "int values[3] = { 10, 20, 12 };",
      "int zeroes[2];",
      "struct Pair pair = { 40, 2 };",
      'char greeting[3] = "A\\n";',
      'char *message = "B";',
      "int inline_global;",
      "int main(void) {",
      "  zeroes[1] = values[0] + values[1];",
      '  printf("%d\\n", values[0] + values[1] + values[2]);',
      '  printf("%d\\n", zeroes[0]);',
      '  printf("%d\\n", zeroes[1]);',
      '  printf("%d\\n", pair.left + pair.right);',
      '  printf("%d\\n", greeting[0]);',
      '  printf("%d\\n", greeting[1]);',
      '  printf("%d\\n", message[0]);',
      '  printf("mix:%d:%c:%s:%%\\n", pair.left, greeting[0] + 1, message);',
      '  asm("mov eax, 7");',
      '  asm("store [inline_global], eax");',
      '  printf("%d\\n", inline_global);',
      '  printf("literal\\n");',
      "  return 0;",
      "}",
    ].join("\n");

    const first = compileCs486Object("c", source);
    const second = compileCs486Object("c", source);
    const executable = linkCs486Objects([first]);
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });

    expect(second).toEqual(first);
    expect(result.output).toBe(
      "42\n0\n30\n42\n65\n10\n66\nmix:40:B:B:%\n7\nliteral\n",
    );
    const rodata = first.sections?.find(({ name }) => name === "rodata");
    expect(
      rodata !== undefined && "bytes" in rodata ? rodata.bytes : [],
    ).toEqual([66, 0, 0, 0, 0, 0, 0, 0]);
    expect(first.symbols).toContainEqual(
      expect.objectContaining({
        name: "zeroes",
        section: "bss",
        type: "object",
      }),
    );
  });

  it("resolves an extern global across objects", (): void => {
    const consumer = compileCs486Object(
      "c",
      [
        "extern int answer;",
        "int main(void) {",
        '  printf("%d\\n", answer);',
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const provider = compileCs486Object("c", "int answer = 42;");

    const executable = linkCs486Objects([consumer, provider]);
    const result = runCs486(executable, {
      memoryBytes: declaredLinearMemoryBytes(executable),
    });

    expect(result.output).toBe("42\n");
    expect(consumer.relocations).toContainEqual(
      expect.objectContaining({ symbol: "answer", type: "data-address" }),
    );
  });

  it("rejects conflicting, excessive, and non-constant global definitions", (): void => {
    expect(() => compileCs486Object("c", "int value; int value;")).toThrow(
      /duplicate definition of global value/u,
    );
    expect(() => compileCs486Object("c", "extern int value = 1;")).toThrow(
      /extern global declarations cannot have an initializer/u,
    );
    expect(() =>
      compileCs486Object("c", "int values[2] = { 1, 2, 3 };"),
    ).toThrow(/too many aggregate initializer elements/u);
    expect(() =>
      compileCs486Object("c", "int other; long *pointer = &other;"),
    ).toThrow(/incompatible assignment types/u);
    expect(() => compileCs486Object("c", "int value = missing;")).toThrow(
      /undeclared identifier missing/u,
    );
    expect(() =>
      compileCs486Object(
        "c",
        'int main(void) { int value = 1; printf("%s", value); return 0; }',
      ),
    ).toThrow(/%s requires a char pointer argument/u);
    expect(() =>
      compileCs486Object("c", 'int main(void) { printf("%x", 1); return 0; }'),
    ).toThrow(/unsupported printf conversion %x/u);
    expect(() =>
      compileCs486Object(
        "c",
        'int main(void) { printf("%d", 1, 2); return 0; }',
      ),
    ).toThrow(/more arguments than conversions/u);
    expect(() =>
      compileCs486Object(
        "c",
        `int main(void) { printf("${"%s".repeat(8)}", "a", "b", "c", "d", "e", "f", "g", "h"); return 0; }`,
      ),
    ).toThrow(/printf worst-case output limit exceeded/u);
  });
});
