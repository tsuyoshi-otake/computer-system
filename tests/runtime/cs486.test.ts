import { describe, expect, it } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import {
  createCs486Flat32MemoryMetadata,
  runCs486,
  Cs486Process,
  Cs486Fault,
  type Cs486ExecutableV3,
} from "../../src/domain/cpu/cs486.js";

describe("CS486DX execution core", (): void => {
  it("appends a validated continuation only from a completed quiescent boundary", (): void => {
    const executable: Cs486ExecutableV3 = {
      format: "cs486-executable",
      instructions: [],
      memory: createCs486Flat32MemoryMetadata(),
      version: 3,
    };
    const process = new Cs486Process(executable, { memoryBytes: 65_536 });
    expect(() =>
      process.appendInstructionsAtCompletion([
        {
          destination: "eax",
          op: "mov",
          source: { kind: "immediate", value: 1 },
        },
      ]),
    ).toThrow(/completed quiescent boundary/u);

    process.runCpuSlice(100_000);
    expect(process.state.kind).toBe("completed");
    const instructionCount = process.instructionCount;
    expect(() =>
      process.appendInstructionsAtCompletion([{ op: "jmp", target: 99 }]),
    ).toThrow(/invalid jmp instruction/u);
    expect(process.instructionCount).toBe(instructionCount);
    expect(process.state.kind).toBe("completed");

    process.appendInstructionsAtCompletion([
      {
        destination: "eax",
        op: "mov",
        source: { kind: "immediate", value: 42 },
      },
    ]);
    expect(process.state.kind).toBe("ready");
    process.runCpuSlice(100_000);
    expect(process.state).toEqual({ kind: "completed", value: 42 });
  });

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
      executedInstructions: 20,
      state: "yielded",
      microarchitecture: { pipelineFlushes: 20 },
    });
    expect(yielded.cycles).toBeGreaterThan(20);
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
    expect(cs486dx.cycles).toBeGreaterThan(26);
    expect(cs486dx2.cycles).toBeGreaterThan(cs486dx.cycles);
    expect(cs386sx.cycles).toBe(60);
    expect(cs386sx.microarchitecture.l1Misses).toBe(0);
    expect(cs486dx.microarchitecture.l1Misses).toBeGreaterThan(0);
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

  it("faults before the downward-growing stack overwrites static data", (): void => {
    const { dataModel, ...legacy } = assembleCs486("push eax\npush eax\nhalt");
    expect(dataModel).toBe("cs-word32-v1");
    const executable = {
      ...legacy,
      dataBytes: 65_532,
      memory: createCs486Flat32MemoryMetadata({ stackBytes: 4 }),
      version: 3 as const,
    };

    expect(() => runCs486(executable, { memoryBytes: 65_536 })).toThrowError(
      expect.objectContaining({
        typeName: "StackOverflowError",
        message: "stack overflow",
      }),
    );
  });

  it("rejects forged stack pointers and return addresses", (): void => {
    expect(() =>
      runCs486(assembleCs486("pop eax\nhalt"), { memoryBytes: 65_536 }),
    ).toThrowError(
      expect.objectContaining({
        typeName: "StackUnderflowError",
        message: "stack underflow",
      }),
    );
    expect(() =>
      runCs486(
        ((): Cs486ExecutableV3 => {
          const { dataModel, ...legacy } = assembleCs486(
            "mov esp, 0\npop eax\nhalt",
          );
          expect(dataModel).toBe("cs-word32-v1");
          return {
            ...legacy,
            dataBytes: 4,
            version: 3 as const,
          };
        })(),
        { memoryBytes: 65_540 },
      ),
    ).toThrowError(
      expect.objectContaining({
        typeName: "StackOverflowError",
        message: "stack overflow",
      }),
    );
    expect(() =>
      runCs486(assembleCs486("push -1\nret"), { memoryBytes: 65_536 }),
    ).toThrowError(/instruction pointer -1 is outside/u);
    expect(() =>
      runCs486(assembleCs486("push 2\nret"), { memoryBytes: 65_536 }),
    ).toThrowError(/instruction pointer 2 is outside/u);
    expect(() =>
      runCs486(assembleCs486("push 200\nret"), { memoryBytes: 65_536 }),
    ).toThrowError(/instruction pointer 200 is outside/u);
  });

  it("keeps valid CALL/RET balanced while reserving one-past-end for fallthrough", (): void => {
    const called = runCs486(
      assembleCs486("call answer\nhalt\nanswer:\nmov eax, 42\nret"),
      { memoryBytes: 65_536 },
    );
    const fellThrough = runCs486(assembleCs486("mov eax, 42"), {
      memoryBytes: 65_536,
    });

    expect(called).toMatchObject({
      executedInstructions: 4,
      registers: { eax: 42, esp: 65_536 },
      state: "halted",
    });
    expect(fellThrough).toMatchObject({
      executedInstructions: 1,
      registers: { eax: 42, esp: 65_536 },
      state: "halted",
    });

    expect(() =>
      runCs486(
        assembleCs486("jmp caller\ncallee:\nret\ncaller:\ncall callee"),
        { memoryBytes: 65_536 },
      ),
    ).toThrowError(
      /instruction pointer 3 is outside executable instruction range 0\.\.2/u,
    );
  });

  it("treats in-range ESP as a raw pointer without tracking PUSH provenance", (): void => {
    const result = runCs486(
      assembleCs486("mov esp, 65532\npop eax\nprint eax\nhalt"),
      { memoryBytes: 65_536 },
    );

    expect(result.output).toBe("0");
    expect(result.registers.esp).toBe(65_536);
  });
});
