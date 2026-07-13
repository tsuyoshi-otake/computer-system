import { describe, expect, it } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import { runCs486, Cs486Fault } from "../../src/domain/cpu/cs486.js";

describe("CS486DX execution core", (): void => {
  it("executes registers, branches, stack operations, and cycle costs", (): void => {
    const executable = assembleCs486(`
      mov eax, 0
      mov ecx, 5
    loop:
      add eax, ecx
      sub ecx, 1
      cmp ecx, 0
      jg loop
      push eax
      pop edx
      print edx
      halt
    `);

    const result = runCs486(executable, { memoryBytes: 65_536 });

    expect(result.state).toBe("halted");
    expect(result.output).toBe("15");
    expect(result.registers.eax).toBe(15);
    expect(result.registers.edx).toBe(15);
    expect(result.cycles).toBeGreaterThan(result.executedInstructions);
  });

  it("makes an optimized program observably cheaper", (): void => {
    const loop = runCs486(
      assembleCs486(`
        mov eax, 0
        mov ecx, 100
      loop:
        add eax, ecx
        sub ecx, 1
        cmp ecx, 0
        jg loop
        halt
      `),
      { memoryBytes: 65_536 },
    );
    const folded = runCs486(assembleCs486("mov eax, 5050\nhalt"), {
      memoryBytes: 65_536,
    });

    expect(loop.registers.eax).toBe(folded.registers.eax);
    expect(folded.cycles).toBeLessThan(loop.cycles);
  });

  it("fails explicitly on invalid memory and yields bounded infinite loops", (): void => {
    expect(() =>
      runCs486(assembleCs486("load eax, [70000]\nhalt"), {
        memoryBytes: 65_536,
      }),
    ).toThrowError(Cs486Fault);
    const yielded = runCs486(assembleCs486("again:\njmp again"), {
      instructionLimit: 20,
      memoryBytes: 65_536,
    });
    expect(yielded).toMatchObject({
      cycles: 20,
      executedInstructions: 20,
      state: "yielded",
    });
    expect(() =>
      runCs486(
        {
          format: "cs486-executable",
          instructions: [{ op: "unknown" }],
          version: 1,
        } as never,
        { memoryBytes: 65_536 },
      ),
    ).toThrow(/invalid unknown instruction/u);
  });
});
