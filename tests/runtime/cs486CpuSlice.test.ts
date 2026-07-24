import { describe, expect, it } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import { Cs486Process } from "../../src/domain/cpu/cs486.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";

const cpuModels = [
  "cs386sx",
  "cs486dx",
  "cs486dx2",
] as const satisfies readonly CpuModel[];
const executable = assembleCs486(`
  section .data
  source: dd 41
  result: dd 0
  section .text
  load eax, [source]
  add eax, 1
  store [result], eax
  halt
`);

describe.each(cpuModels)("CS486 CPU slicing on %s", (cpuModel): void => {
  it("preserves exact debt and final-state semantics across slice boundaries", (): void => {
    const firstInstruction = createProcess(cpuModel);
    const firstInstructionCycles =
      firstInstruction.runInstructionSlice(1).cpuCycles;
    expect(firstInstructionCycles).toBeGreaterThan(2);

    const reference = createProcess(cpuModel);
    const expected = reference.runInstructionSlice(4);

    const sliced = createProcess(cpuModel);
    expect(sliced.runCpuSlice(1, 1)).toEqual({
      cpuCycles: 1,
      executedInstructions: 1,
      state: { kind: "ready" },
    });
    expect(sliced.hasPendingCpuCycles).toBe(true);
    expect(sliced.instructionAddress).toBe(1);

    expect(sliced.runCpuSlice(firstInstructionCycles - 2, 1)).toEqual({
      cpuCycles: firstInstructionCycles - 2,
      executedInstructions: 0,
      state: { kind: "ready" },
    });
    expect(sliced.hasPendingCpuCycles).toBe(true);

    expect(sliced.runCpuSlice(1, 1)).toEqual({
      cpuCycles: 1,
      executedInstructions: 0,
      state: { kind: "ready" },
    });
    expect(sliced.hasPendingCpuCycles).toBe(false);

    const remainder = sliced.runCpuSlice(Number.MAX_SAFE_INTEGER, 3);
    expect(remainder).toMatchObject({
      executedInstructions: 3,
      state: { kind: "completed" },
    });
    expect(firstInstructionCycles + remainder.cpuCycles).toBe(
      expected.cpuCycles,
    );
    expect(sliced.hasPendingCpuCycles).toBe(false);
    expect(sliced.registers).toEqual(reference.registers);
    expect(sliced.inspectMemory(0, 8)).toEqual(reference.inspectMemory(0, 8));
    expect(sliced.output).toBe(reference.output);
    expect(sliced.microarchitectureStats).toEqual(
      reference.microarchitectureStats,
    );
  });
});

function createProcess(cpuModel: CpuModel): Cs486Process {
  return new Cs486Process(executable, { cpuModel, memoryBytes: 131_072 });
}
