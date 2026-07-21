import { describe, expect, it } from "vitest";

import {
  assembleCs486,
  assembleCs486Object,
} from "../../src/application/toolchain/cs486Assembler.js";
import {
  Cs486Process,
  Cs486Fault,
  createCs486FunctionSignature,
  parseCs486FunctionSignature,
  runCs486,
  validateCs486Executable,
} from "../../src/domain/cpu/cs486.js";
import { cs486Word32DataModel } from "../../src/domain/cpu/cs486Compatibility.js";
import { validateCs486Object } from "../../src/domain/cpu/cs486Object.js";

describe("CS486 deterministic floating ABI runtime", () => {
  it("executes binary32 and binary64 software operations with fixed cycle cost", () => {
    const executable = assembleCs486(`
      mov eax, 1069547520
      mov edx, 1073741824
      syscall cs.fp.f32.mul
      mov esi, eax
      mov eax, 0
      mov edx, 1072693248
      mov ebx, 0
      mov ecx, 1073741824
      syscall cs.fp.f64.add
      halt
    `);
    const first = runCs486(executable, { memoryBytes: 65_536 });
    const second = runCs486(executable, { memoryBytes: 65_536 });
    expect(first).toEqual(second);
    expect(first.registers.esi >>> 0).toBe(0x4040_0000);
    expect(first.registers.eax).toBe(0);
    expect(first.registers.edx >>> 0).toBe(0x4008_0000);
    expect(first.cycles).toBeGreaterThan(256);
  });

  it.each([
    ["cs386sx", 117],
    ["cs486dx", 119],
    ["cs486dx2", 131],
  ] as const)(
    "charges a stable modeled multiply cost on %s",
    (cpuModel, cycles) => {
      const executable = assembleCs486(`
      mov eax, 1069547520
      mov edx, 1073741824
      syscall cs.fp.f32.mul
      halt
    `);

      expect(
        runCs486(executable, { cpuModel, memoryBytes: 65_536 }).cycles,
      ).toBe(cycles);
    },
  );

  it("reports canonical special values and process-local status", () => {
    const result = runCs486(
      assembleCs486(`
        mov eax, 0
        mov edx, 0
        syscall cs.fp.f32.div
        mov esi, eax
        syscall cs.fp.f32.status
        halt
      `),
      { memoryBytes: 65_536 },
    );
    expect(result.registers.esi >>> 0).toBe(0x7fc0_0000);
    expect(result.registers.eax & 1).toBe(1);
  });

  it("admits f32/f64 signatures only in the current model-declared formats", () => {
    expect(parseCs486FunctionSignature("(f32,f64)->f64")).toEqual({
      parameterTypes: ["f32", "f64"],
      returnType: "f64",
      variadic: false,
    });
    expect(createCs486FunctionSignature(["f64", "i32"], "f32")).toBe(
      "(f64,i32)->f32",
    );

    const currentObject = assembleCs486Object(
      "global value\ntype value, function\nsignature value, f64, f64\nvalue:\nhalt",
      { dataModel: cs486Word32DataModel, language: "c" },
    );
    expect(() => validateCs486Object(currentObject)).not.toThrow();
    expect(() =>
      validateCs486Object({
        ...currentObject,
        dataModel: undefined,
        version: 3,
      }),
    ).toThrow(/invalid CS486 object symbol/u);

    const currentExecutable = {
      dataBytes: 0,
      dataModel: cs486Word32DataModel,
      format: "cs486-executable",
      functionEntries: [
        { address: 0, functionSignature: "(f64)->f64" as const },
      ],
      instructions: [{ op: "halt" as const }],
      memory: {
        auxiliaryResidentBytes: 0,
        heapBytes: 0,
        model: "cs-flat32-v1" as const,
        stackBytes: 65_536,
      },
      version: 5 as const,
    };
    expect(() => validateCs486Executable(currentExecutable)).not.toThrow();
    expect(() =>
      validateCs486Executable({
        ...currentExecutable,
        dataModel: undefined,
        version: 4,
      }),
    ).toThrow(Cs486Fault);
  });

  it("faults an out-of-range libm result pointer without partial guest writes", () => {
    const executable = assembleCs486(`
      mov eax, 0
      mov edx, 1073741824
      mov ebx, 65536
      syscall cs.fp.f64.modf
      halt
    `);

    expect(() => runCs486(executable, { memoryBytes: 65_536 })).toThrow(
      /outside RAM/u,
    );
  });

  it("terminates a sliced floating workload at an explicit observable state", () => {
    const process = new Cs486Process(
      assembleCs486(`
        mov eax, 1065353216
        mov edx, 1065353216
        loop:
        syscall cs.fp.f32.mul
        jmp loop
      `),
      { memoryBytes: 65_536 },
    );

    expect(process.runCpuSlice(50, 10).state.kind).toBe("ready");
    expect(process.terminate("test interrupt")).toEqual({
      kind: "terminated",
      reason: "test interrupt",
    });
    expect(process.runCpuSlice(50, 10)).toMatchObject({
      executedInstructions: 0,
      state: { kind: "terminated", reason: "test interrupt" },
    });
    expect(process.hasPendingCpuCycles).toBe(true);
    expect(process.runCpuSlice(1_000, 10)).toMatchObject({
      executedInstructions: 0,
      state: { kind: "terminated", reason: "test interrupt" },
    });
    expect(process.hasPendingCpuCycles).toBe(false);
    expect(process.runCpuSlice(50, 10)).toMatchObject({
      cpuCycles: 0,
      executedInstructions: 0,
      state: { kind: "terminated", reason: "test interrupt" },
    });
  });
});
