import { describe, expect, it } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import { Cs486Process } from "../../src/domain/cpu/cs486.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";

const cpuModels = [
  "cs386sx",
  "cs486dx",
  "cs486dx2",
] as const satisfies readonly CpuModel[];

const hotLoopExecutable = assembleCs486(`
  mov eax, 0
  mov ebx, 97
loop:
  add eax, 3
  xor ebx, eax
  shl ebx, 1
  cmp eax, 3000
  jmp loop
`);

describe.each(cpuModels)("CS486 hot CPU burst on %s", (cpuModel): void => {
  it.each([false, true])(
    "matches the per-instruction reference with statistics=%s",
    (collectMicroarchitectureStats): void => {
      const instructionBudget = 4_096;
      const reference = createProcess(
        hotLoopExecutable,
        cpuModel,
        collectMicroarchitectureStats,
      );
      const expectedSlice = reference.runInstructionSlice(instructionBudget);
      const optimized = createProcess(
        hotLoopExecutable,
        cpuModel,
        collectMicroarchitectureStats,
      );

      expect(
        optimized.runCpuSlice(Number.MAX_SAFE_INTEGER, instructionBudget),
      ).toEqual(expectedSlice);
      expect(snapshot(optimized)).toEqual(snapshot(reference));
    },
  );

  it("preserves cycle debt before admitting another hot instruction", (): void => {
    const executable = assembleCs486("mov eax, 1\nadd eax, 2\nhalt");
    const firstInstruction = createProcess(executable, cpuModel, true);
    const firstInstructionCycles =
      firstInstruction.runInstructionSlice(1).cpuCycles;
    expect(firstInstructionCycles).toBeGreaterThan(1);

    const optimized = createProcess(executable, cpuModel, true);
    expect(optimized.runCpuSlice(1, 3)).toEqual({
      cpuCycles: 1,
      executedInstructions: 1,
      state: { kind: "ready" },
    });
    expect(optimized.hasPendingCpuCycles).toBe(true);
    expect(optimized.instructionAddress).toBe(1);

    expect(optimized.runCpuSlice(firstInstructionCycles - 1, 3)).toEqual({
      cpuCycles: firstInstructionCycles - 1,
      executedInstructions: 0,
      state: { kind: "ready" },
    });
    expect(optimized.hasPendingCpuCycles).toBe(false);
    expect(optimized.instructionAddress).toBe(1);

    expect(optimized.runCpuSlice(Number.MAX_SAFE_INTEGER, 2)).toMatchObject({
      executedInstructions: 2,
      state: { kind: "completed" },
    });
  });

  it("finalizes after a hot burst reaches the executable boundary", (): void => {
    const executable = assembleCs486(`
      mov eax, 1
      add eax, 1
      xor eax, 7
      shl eax, 1
      sub eax, 3
      or eax, 16
      and eax, 31
      mov edx, eax
    `);
    const reference = createProcess(executable, cpuModel, true);
    const expectedSlice = reference.runInstructionSlice(9);
    const optimized = createProcess(executable, cpuModel, true);
    expect(hotBurstMetadata(optimized).enabled).toBe(true);

    expect(optimized.runCpuSlice(Number.MAX_SAFE_INTEGER, 9)).toEqual(
      expectedSlice,
    );
    expect(snapshot(optimized)).toEqual(snapshot(reference));
    expect(optimized.state).toEqual({ kind: "completed", value: 23 });
  });

  it("keeps short hot runs on the existing per-instruction path", (): void => {
    const optimized = createProcess(
      assembleCs486(`
        mov eax, 1
        add eax, 1
        xor eax, 7
        shl eax, 1
        sub eax, 3
        or eax, 16
        and eax, 31
      `),
      cpuModel,
      false,
    );

    expect(hotBurstMetadata(optimized)).toMatchObject({ enabled: false });
    expect(optimized.runCpuSlice(Number.MAX_SAFE_INTEGER, 8)).toMatchObject({
      executedInstructions: 7,
      state: { kind: "completed" },
    });
  });

  it("hands a faulting cold instruction to the existing crash owner", (): void => {
    const executable = assembleCs486(`
      mov eax, 12
      add eax, 30
      div eax, 0
      mov edx, 1
      halt
    `);
    const reference = createProcess(executable, cpuModel, true);
    const expectedSlice = reference.runInstructionSlice(5);
    const optimized = createProcess(executable, cpuModel, true);

    expect(optimized.runCpuSlice(Number.MAX_SAFE_INTEGER, 5)).toEqual(
      expectedSlice,
    );
    expect(snapshot(optimized)).toEqual(snapshot(reference));
    expect(optimized.state).toMatchObject({
      error: { typeName: "DivisionByZeroError" },
      kind: "crashed",
    });
    expect(optimized.instructionAddress).toBe(3);
  });
});

function createProcess(
  executable: ReturnType<typeof assembleCs486>,
  cpuModel: CpuModel,
  collectMicroarchitectureStats: boolean,
): Cs486Process {
  return new Cs486Process(executable, {
    collectMicroarchitectureStats,
    cpuModel,
    memoryBytes: 131_072,
  });
}

function snapshot(process: Cs486Process): Readonly<Record<string, unknown>> {
  return {
    hasPendingCpuCycles: process.hasPendingCpuCycles,
    instructionAddress: process.instructionAddress,
    microarchitecture: process.microarchitectureStatsEnabled
      ? process.microarchitectureStats
      : null,
    output: process.output,
    registers: process.registers,
    state: process.state,
  };
}

function hotBurstMetadata(process: Cs486Process): {
  readonly enabled: boolean;
  readonly entries: Uint8Array;
} {
  const internal = process as unknown as {
    readonly hasHotBurstEntries: boolean;
    readonly instructionHotBurstEntries: Uint8Array;
  };
  return {
    enabled: internal.hasHotBurstEntries,
    entries: internal.instructionHotBurstEntries,
  };
}
