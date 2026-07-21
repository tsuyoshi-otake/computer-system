import { describe, expect, it } from "vitest";

import {
  assembleCs486,
  assembleCs486Object,
} from "../../src/application/toolchain/cs486Assembler.js";
import { Cs486Debugger } from "../../src/application/toolchain/cs486Debugger.js";
import { linkCs486Objects } from "../../src/application/toolchain/cs486Linker.js";
import {
  Cs486Process,
  cs486ExecutableMemoryRequirements,
  validateCs486Executable,
  type Cs486StructuredExecutable,
} from "../../src/domain/cpu/cs486.js";

describe("validated CS486 indirect calls", (): void => {
  it("assembles, admits, executes, and disassembles a typed function entry", (): void => {
    const executable = assembleCs486(
      [
        "type answer, function",
        "signature answer, i32",
        "mov eax, answer",
        'calli eax, "()->i32"',
        "halt",
        "answer:",
        "mov eax, 42",
        "ret",
      ].join("\n"),
    );

    expect(executable.functionEntries).toEqual([
      { address: 3, functionSignature: "()->i32" },
    ]);
    expect(run(executable).state).toEqual({ kind: "completed", value: 42 });
    expect(
      Cs486Debugger.load(executable, {
        memoryBytes: memoryBytes(executable),
      }).disassemble(0, 3)[1]?.text,
    ).toBe('calli eax, "()->i32"');
  });

  it("keeps local function entries callable without publishing their symbols", (): void => {
    const object = assembleCs486Object(
      [
        "global main",
        "type main, function",
        "signature main, i32",
        "type hidden, function",
        "signature hidden, i32",
        "main:",
        "mov eax, hidden",
        'calli eax, "()->i32"',
        "ret",
        "hidden:",
        "mov eax, 77",
        "ret",
      ].join("\n"),
    );
    expect(object.relocations).toContainEqual(
      expect.objectContaining({ symbol: "hidden", type: "function-address" }),
    );

    const executable = linkCs486Objects([object]);
    expect(executable.symbols?.map(({ name }) => name)).toEqual(["main"]);
    expect(executable.functionEntries).toHaveLength(2);
    expect(run(executable).state).toEqual({ kind: "completed", value: 77 });
  });

  it.each([
    ["null/data value", 0, "InvalidFunctionPointerError"],
    ["middle of function", 4, "InvalidFunctionPointerError"],
    ["out of range", 2_147_483_647, "InvalidFunctionPointerError"],
  ])(
    "faults before pushing a return address for %s",
    (_name, target, typeName): void => {
      const executable = assembleCs486(
        [
          "type answer, function",
          "signature answer, i32",
          `mov eax, ${String(target)}`,
          'calli eax, "()->i32"',
          "halt",
          "answer:",
          "mov eax, 42",
          "ret",
        ].join("\n"),
      );
      const process = run(executable);

      expect(process.state).toMatchObject({
        error: { typeName },
        kind: "crashed",
      });
      expect(process.registers.esp).toBe(memoryBytes(executable));
    },
  );

  it("faults on an exact-entry signature mismatch without changing the stack", (): void => {
    const executable = assembleCs486(
      [
        "type answer, function",
        "signature answer, i32",
        "mov eax, answer",
        'calli eax, "(i32)->i32"',
        "halt",
        "answer:",
        "mov eax, 42",
        "ret",
      ].join("\n"),
    );
    const process = run(executable);

    expect(process.state).toMatchObject({
      error: { typeName: "FunctionSignatureMismatchError" },
      kind: "crashed",
    });
    expect(process.registers.esp).toBe(memoryBytes(executable));
  });

  it("rejects malformed entry metadata, legacy calli, and invalid signatures", (): void => {
    const valid = assembleCs486(
      "halt\ntype answer, function\nsignature answer, i32\nanswer:\nret",
    );
    const malformed: readonly unknown[] = [
      {
        ...valid,
        functionEntries: [{ address: -1, functionSignature: "()->i32" }],
      },
      {
        ...valid,
        functionEntries: [
          { address: 1, functionSignature: "()->i32" },
          { address: 1, functionSignature: "()->i32" },
        ],
      },
      {
        ...valid,
        functionEntries: [
          { address: 1, functionSignature: "()->i128" as never },
        ],
      },
      { ...valid, dataModel: undefined, version: 3 },
      {
        ...valid,
        dataModel: undefined,
        functionEntries: undefined,
        instructions: [
          {
            functionSignature: "()->i32",
            op: "call_indirect",
            source: { kind: "immediate", value: 0 },
          },
        ],
        version: 3,
      },
    ];
    for (const candidate of malformed)
      expect(() => validateCs486Executable(candidate)).toThrow(
        /function entry|invalid call_indirect/u,
      );

    expect(() => assembleCs486('calli eax, "(i128)->i32"')).toThrow(
      /canonical quoted function signature/u,
    );
  });
});

function memoryBytes(executable: Cs486StructuredExecutable): number {
  const requirements = cs486ExecutableMemoryRequirements(executable);
  if (requirements.kind !== "declared")
    throw new Error("expected flat32 image");
  return requirements.linearAddressSpaceBytes;
}

function run(executable: Cs486StructuredExecutable): Cs486Process {
  const process = new Cs486Process(executable, {
    memoryBytes: memoryBytes(executable),
  });
  process.runCpuSlice(1_000_000, 100_000);
  return process;
}
