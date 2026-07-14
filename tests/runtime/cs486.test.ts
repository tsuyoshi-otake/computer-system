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

  it("applies 386SX execution clocks without changing program semantics", (): void => {
    const executable = assembleCs486(`
      mov eax, 6
      mul eax, 7
      push eax
      pop edx
      cmp edx, 42
      je done
      mov edx, 0
    done:
      print edx
      halt
    `);
    const cs486dx = runCs486(executable, {
      cpuModel: "cs486dx",
      memoryBytes: 65_536,
    });
    const cs386sx = runCs486(executable, {
      cpuModel: "cs386sx",
      memoryBytes: 65_536,
    });
    const cs486dx2 = runCs486(executable, {
      cpuModel: "cs486dx2",
      memoryBytes: 65_536,
    });

    expect(cs386sx.output).toBe(cs486dx.output);
    expect(cs486dx2.output).toBe(cs486dx.output);
    expect(cs386sx.output).toBe("42");
    expect(cs386sx.executedInstructions).toBe(cs486dx.executedInstructions);
    expect(cs486dx.cycles).toBe(26);
    expect(cs486dx2.cycles).toBe(cs486dx.cycles);
    expect(cs386sx.cycles).toBe(48);
  });

  it("models 386 early-out multiplication and taken branch cost", (): void => {
    const fastMultiply = runCs486(
      assembleCs486("mov eax, 2\nmul eax, 0\nhalt"),
      { cpuModel: "cs386sx", memoryBytes: 65_536 },
    );
    const slowMultiply = runCs486(
      assembleCs486("mov eax, 2\nmul eax, 1073741824\nhalt"),
      { cpuModel: "cs386sx", memoryBytes: 65_536 },
    );
    const notTaken = runCs486(
      assembleCs486("mov eax, 0\ncmp eax, 1\nje done\ndone:\nhalt"),
      { cpuModel: "cs386sx", memoryBytes: 65_536 },
    );
    const taken = runCs486(
      assembleCs486("mov eax, 1\ncmp eax, 1\nje done\ndone:\nhalt"),
      { cpuModel: "cs386sx", memoryBytes: 65_536 },
    );

    expect(fastMultiply.cycles).toBe(16);
    expect(slowMultiply.cycles).toBe(43);
    expect(taken.cycles - notTaken.cycles).toBe(4);
  });

  it("faults when executable data exceeds a portable 2 MiB ceiling", (): void => {
    expect(() =>
      runCs486(
        {
          dataBytes: 2_097_156,
          format: "cs486-executable",
          instructions: [{ op: "halt" }],
          version: 1,
        },
        {
          cpuModel: "cs386sx",
          memoryBytes: 2_097_152,
        },
      ),
    ).toThrow(/executable data exceeds available RAM/u);
  });
});
