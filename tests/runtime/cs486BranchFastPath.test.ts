import { describe, expect, it } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import { runCs486 } from "../../src/domain/cpu/cs486.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";

const cpuModels = [
  "cs386sx",
  "cs486dx",
  "cs486dx2",
] as const satisfies readonly CpuModel[];
const branchCases = [
  { expected: false, left: 1, op: "je", right: 2 },
  { expected: true, left: 1, op: "je", right: 1 },
  { expected: false, left: 1, op: "jne", right: 1 },
  { expected: true, left: 1, op: "jne", right: 2 },
  { expected: false, left: 2, op: "jl", right: 1 },
  { expected: true, left: 1, op: "jl", right: 2 },
  { expected: false, left: 2, op: "jle", right: 1 },
  { expected: true, left: 1, op: "jle", right: 1 },
  { expected: false, left: 1, op: "jg", right: 2 },
  { expected: true, left: 2, op: "jg", right: 1 },
  { expected: false, left: 1, op: "jge", right: 2 },
  { expected: true, left: 1, op: "jge", right: 1 },
] as const;

describe.each(cpuModels)("CS486 branch fast path on %s", (cpuModel): void => {
  it.each(branchCases)(
    "executes $op with expected=$expected exactly once",
    ({ expected, left, op, right }): void => {
      const result = runCs486(
        assembleCs486(`
          mov eax, ${String(left)}
          cmp eax, ${String(right)}
          ${op} taken
          mov edx, 0
          halt
        taken:
          mov edx, 1
          halt
        `),
        { cpuModel, memoryBytes: 65_536 },
      );

      expect(result).toMatchObject({
        executedInstructions: 5,
        registers: { edx: expected ? 1 : 0 },
        state: "halted",
      });
      expect(result.microarchitecture.pipelineFlushes).toBe(expected ? 1 : 0);
    },
  );

  it("keeps direct jumps bounded and observable", (): void => {
    const result = runCs486(assembleCs486("again:\njmp again"), {
      cpuModel,
      instructionLimit: 20,
      memoryBytes: 65_536,
    });

    expect(result).toMatchObject({
      executedInstructions: 20,
      microarchitecture: { pipelineFlushes: 20 },
      state: "yielded",
    });
  });
});
