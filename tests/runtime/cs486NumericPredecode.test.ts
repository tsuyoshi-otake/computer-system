import { describe, expect, it } from "vitest";

import {
  Cs486Fault,
  Cs486Process,
  createCs486Flat32MemoryMetadata,
  type Cs486ExecutableV5,
  type Cs486SyscallHandler,
} from "../../src/domain/cpu/cs486.js";
import type {
  Cs486Instruction,
  Cs486Operand,
} from "../../src/domain/cpu/instructionSet.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";

const cpuModels = [
  "cs386sx",
  "cs486dx",
  "cs486dx2",
] as const satisfies readonly CpuModel[];
const memoryBytes = 131_072;
const instructionBudget = 512;

interface ExecutionSnapshot {
  readonly cpuCycles: number;
  readonly executedInstructions: number;
  readonly instructionAddress: number;
  readonly memory: Uint8Array;
  readonly microarchitecture: Cs486Process["microarchitectureStats"];
  readonly output: string;
  readonly registers: Cs486Process["registers"];
  readonly state: unknown;
}

interface OperandVariantCase {
  readonly create: (source: Cs486Operand) => Cs486ExecutableV5;
  readonly expectedEax?: number;
  readonly expectedMemory?: readonly [offset: number, ...bytes: number[]];
  readonly expectedOutput?: string;
  readonly name: string;
  readonly sourceValue: number;
}

type BinaryOpcode =
  | "add"
  | "and"
  | "div"
  | "mod"
  | "mov"
  | "mul"
  | "or"
  | "shl"
  | "shr"
  | "sub"
  | "udiv"
  | "umod"
  | "ushr"
  | "xor";

type LoadOpcode = "load" | "load8s" | "load8u" | "load16s" | "load16u";
type StoreOpcode = "store" | "store8" | "store16";
type BranchOpcode = "je" | "jne" | "jl" | "jle" | "jg" | "jge";

const binaryVariantCases = [
  binaryVariant("mov", 99, -17, -17),
  binaryVariant("add", 100, -7, 93),
  binaryVariant("sub", 100, -7, 107),
  binaryVariant("mul", -9, 7, -63),
  binaryVariant("div", -105, 7, -15),
  binaryVariant("udiv", -1, 2, 2_147_483_647),
  binaryVariant("mod", -107, 10, -7),
  binaryVariant("umod", -1, 16, 15),
  binaryVariant("and", 0x5a, 0x3c, 0x18),
  binaryVariant("or", 0x5a, 0x3c, 0x7e),
  binaryVariant("xor", 0x5a, 0x3c, 0x66),
  binaryVariant("shl", 3, 4, 48),
  binaryVariant("shr", -64, 3, -8),
  binaryVariant("ushr", -64, 3, 536_870_904),
] as const satisfies readonly OperandVariantCase[];

const initializedBytes = [
  0x78, 0x56, 0x34, 0x12, 0x80, 0, 0, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
] as const;
const loadVariantCases = [
  loadVariant("load", 0, 0x1234_5678),
  loadVariant("load8s", 4, -128),
  loadVariant("load8u", 4, 128),
  loadVariant("load16s", 6, -32_768),
  loadVariant("load16u", 6, 32_768),
] as const satisfies readonly OperandVariantCase[];
const storeVariantCases = [
  storeVariant("store", 16, [0x78, 0x56, 0x34, 0x12]),
  storeVariant("store8", 20, [0x78]),
  storeVariant("store16", 22, [0x78, 0x56]),
] as const satisfies readonly OperandVariantCase[];
const otherOperandVariantCases = [
  {
    create: (source: Cs486Operand): Cs486ExecutableV5 =>
      executable([
        move("esi", -99),
        { op: "push", source },
        { destination: "eax", op: "pop" },
        { op: "halt" },
      ]),
    expectedEax: -99,
    name: "push",
    sourceValue: -99,
  },
  {
    create: (source: Cs486Operand): Cs486ExecutableV5 =>
      executable(
        [
          move("esi", 3),
          {
            functionSignature: "()->i32",
            op: "call_indirect",
            source,
          },
          { op: "halt" },
          move("eax", 42),
          { op: "ret" },
        ],
        {
          functionEntries: [{ address: 3, functionSignature: "()->i32" }],
        },
      ),
    expectedEax: 42,
    name: "call_indirect",
    sourceValue: 3,
  },
  {
    create: (source: Cs486Operand): Cs486ExecutableV5 =>
      executable([move("esi", -123), { op: "print", source }, { op: "halt" }]),
    expectedOutput: "-123",
    name: "print",
    sourceValue: -123,
  },
] as const satisfies readonly OperandVariantCase[];
const operandVariantCases: readonly OperandVariantCase[] = [
  ...binaryVariantCases,
  ...loadVariantCases,
  ...storeVariantCases,
  ...otherOperandVariantCases,
];

const branchCases = [
  { expected: true, left: -2_147_483_648, op: "je", right: -2_147_483_648 },
  { expected: false, left: -2_147_483_648, op: "je", right: 2_147_483_647 },
  { expected: true, left: -2_147_483_648, op: "jne", right: 2_147_483_647 },
  { expected: false, left: 7, op: "jne", right: 7 },
  { expected: true, left: -2_147_483_648, op: "jl", right: 1 },
  { expected: false, left: 2_147_483_647, op: "jl", right: -1 },
  { expected: true, left: -2_147_483_648, op: "jle", right: 1 },
  { expected: false, left: 2_147_483_647, op: "jle", right: -1 },
  { expected: true, left: 2_147_483_647, op: "jg", right: -1 },
  { expected: false, left: -2_147_483_648, op: "jg", right: 1 },
  { expected: true, left: 2_147_483_647, op: "jge", right: -1 },
  { expected: false, left: -2_147_483_648, op: "jge", right: 1 },
] as const satisfies readonly {
  readonly expected: boolean;
  readonly left: number;
  readonly op: BranchOpcode;
  readonly right: number;
}[];

const directControlExecutable = executable([
  { op: "jmp", target: 2 },
  { op: "halt" },
  move("eax", 65),
  { op: "call", target: 7 },
  { name: "cs.print.character", op: "syscall" },
  { op: "print", source: "!" },
  { op: "halt" },
  { destination: "eax", op: "add", source: immediate(1) },
  { op: "ret" },
]);

describe("CS486 numeric semantic predecode storage", (): void => {
  it("shares the same typed semantic arrays across every CPU model", (): void => {
    const processes = cpuModels.map((cpuModel) =>
      createProcess(directControlExecutable, cpuModel),
    );
    const [first, ...others] = processes.map(preparedSemantics);

    expect(first?.instructionOpcodes).toBeInstanceOf(Uint8Array);
    expect(first?.instructionExecutionFlags).toBeInstanceOf(Uint8Array);
    expect(first?.instructionOperandA).toBeInstanceOf(Int32Array);
    expect(first?.instructionOperandB).toBeInstanceOf(Int32Array);
    for (const other of others) {
      expect(other.instructionOpcodes).toBe(first?.instructionOpcodes);
      expect(other.instructionExecutionFlags).toBe(
        first?.instructionExecutionFlags,
      );
      expect(other.instructionOperandA).toBe(first?.instructionOperandA);
      expect(other.instructionOperandB).toBe(first?.instructionOperandB);
    }
  });

  it("keeps every semantic lane exactly bounded at the v4/v5 maximum", (): void => {
    const halt = { op: "halt" } as const;
    const maximumExecutable = executable(
      Array.from({ length: 65_536 }, () => halt),
    );
    const prepared = preparedSemantics(
      createProcess(maximumExecutable, "cs486dx"),
    );

    expect(prepared.instructionOpcodes).toHaveLength(65_536);
    expect(prepared.instructionExecutionFlags).toHaveLength(65_536);
    expect(prepared.instructionOperandA).toHaveLength(65_536);
    expect(prepared.instructionOperandB).toHaveLength(65_536);
  });
});

describe.each(cpuModels)(
  "CS486 numeric semantic predecode on %s",
  (cpuModel): void => {
    it.each(operandVariantCases)(
      "keeps $name immediate/register variants fully equivalent",
      (testCase): void => {
        const immediateResult = execute(
          testCase.create(immediate(testCase.sourceValue)),
          cpuModel,
        );
        const registerResult = execute(
          testCase.create(register("esi")),
          cpuModel,
        );

        expect(registerResult).toEqual(immediateResult);
        if (testCase.expectedEax !== undefined)
          expect(registerResult.registers).toMatchObject({
            eax: testCase.expectedEax,
          });
        if (testCase.expectedOutput !== undefined)
          expect(registerResult.output).toBe(testCase.expectedOutput);
        if (testCase.expectedMemory !== undefined) {
          const [offset, ...bytes] = testCase.expectedMemory;
          expect([
            ...registerResult.memory.slice(offset, offset + bytes.length),
          ]).toEqual(bytes);
        }
      },
    );

    it.each(branchCases)(
      "executes overflow-safe $op with expected=$expected for both cmp operand modes",
      ({ expected, left, op, right }): void => {
        const immediateResult = execute(
          branchExecutable(op, left, immediate(right)),
          cpuModel,
        );
        const registerResult = execute(
          branchExecutable(op, left, register("esi"), right),
          cpuModel,
        );

        expect(registerResult).toEqual(immediateResult);
        expect(registerResult.registers).toMatchObject({
          edx: expected ? 1 : 0,
        });
        expect(registerResult.microarchitecture.pipelineFlushes).toBe(
          expected ? 1 : 0,
        );
      },
    );

    it("preserves cold strings, direct targets, fetches, transfers, and shared-cache determinism", (): void => {
      const first = execute(directControlExecutable, cpuModel);
      const second = execute(directControlExecutable, cpuModel);

      expect(second).toEqual(first);
      expect(first).toMatchObject({
        executedInstructions: 8,
        instructionAddress: 7,
        output: "B!",
        registers: { eax: 66 },
        state: { kind: "completed", value: 66 },
      });
      expect(first.microarchitecture).toMatchObject({
        instructionFetches: 8,
        pipelineFlushes: 3,
      });
    });

    it("matches whole-program state under one-instruction and one-cycle slices", (): void => {
      const referenceProcess = createProcess(directControlExecutable, cpuModel);
      const referenceSlice =
        referenceProcess.runInstructionSlice(instructionBudget);
      const reference = capture(
        referenceProcess,
        referenceSlice.cpuCycles,
        referenceSlice.executedInstructions,
      );

      const instructionSliced = createProcess(
        directControlExecutable,
        cpuModel,
      );
      let instructionCycles = 0;
      let instructionCount = 0;
      while (instructionSliced.state.kind === "ready") {
        const slice = instructionSliced.runInstructionSlice(1);
        instructionCycles += slice.cpuCycles;
        instructionCount += slice.executedInstructions;
      }
      expect(
        capture(instructionSliced, instructionCycles, instructionCount),
      ).toEqual(reference);

      const cycleSliced = createProcess(directControlExecutable, cpuModel);
      let cycleCount = 0;
      let cycleInstructions = 0;
      let slices = 0;
      while (
        (cycleSliced.state.kind === "ready" ||
          cycleSliced.hasPendingCpuCycles) &&
        slices < 10_000
      ) {
        const slice = cycleSliced.runCpuSlice(1, 1);
        cycleCount += slice.cpuCycles;
        cycleInstructions += slice.executedInstructions;
        slices += 1;
      }
      expect(slices).toBeLessThan(10_000);
      expect(capture(cycleSliced, cycleCount, cycleInstructions)).toEqual(
        reference,
      );
    });

    it("retains dynamic CS386SX multiply timing for both operand modes", (): void => {
      const fastImmediate = execute(
        binaryVariant("mul", 9, 0, 0).create(immediate(0)),
        cpuModel,
      );
      const fastRegister = execute(
        binaryVariant("mul", 9, 0, 0).create(register("esi")),
        cpuModel,
      );
      const slowImmediate = execute(
        binaryVariant("mul", 9, 0x4000_0000, 0).create(immediate(0x4000_0000)),
        cpuModel,
      );
      const slowRegister = execute(
        binaryVariant("mul", 9, 0x4000_0000, 0).create(register("esi")),
        cpuModel,
      );

      expect(fastRegister).toEqual(fastImmediate);
      expect(slowRegister).toEqual(slowImmediate);
      if (cpuModel === "cs386sx")
        expect(slowImmediate.cpuCycles).toBeGreaterThan(
          fastImmediate.cpuCycles,
        );
      else expect(slowImmediate.cpuCycles).toBe(fastImmediate.cpuCycles);
    });

    it("keeps runtime faults equivalent across prepared operand modes", (): void => {
      const faultCases = [
        {
          immediate: executable([
            move("esi", 0),
            move("eax", 1),
            { destination: "eax", op: "div", source: immediate(0) },
            { op: "halt" },
          ]),
          register: executable([
            move("esi", 0),
            move("eax", 1),
            { destination: "eax", op: "div", source: register("esi") },
            { op: "halt" },
          ]),
          typeName: "DivisionByZeroError",
        },
        {
          immediate: executable([
            move("esi", -1),
            { address: immediate(-1), destination: "eax", op: "load" },
            { op: "halt" },
          ]),
          register: executable([
            move("esi", -1),
            { address: register("esi"), destination: "eax", op: "load" },
            { op: "halt" },
          ]),
          typeName: "MemoryAccessError",
        },
        {
          immediate: indirectCallFaultExecutable(immediate(99)),
          register: indirectCallFaultExecutable(register("esi")),
          typeName: "InvalidFunctionPointerError",
        },
      ] as const;

      for (const faultCase of faultCases) {
        const immediateResult = execute(faultCase.immediate, cpuModel);
        const registerResult = execute(faultCase.register, cpuModel);
        expect(registerResult).toEqual(immediateResult);
        expect(registerResult.state).toMatchObject({
          error: { typeName: faultCase.typeName },
          kind: "crashed",
        });
      }
    });

    it("preserves syscall jump/call/return target ordering", (): void => {
      const transitions = [
        {
          executable: executable([
            { name: "test.jump", op: "syscall" },
            move("eax", -1),
            move("eax", 42),
            { op: "halt" },
          ]),
          handler: (): { readonly kind: "jump"; readonly target: number } => ({
            kind: "jump",
            target: 2,
          }),
          pipelineFlushes: 1,
        },
        {
          executable: executable([
            { name: "test.call", op: "syscall" },
            { op: "halt" },
            move("eax", 42),
            { op: "ret" },
          ]),
          handler: (): { readonly kind: "call"; readonly target: number } => ({
            kind: "call",
            target: 2,
          }),
          pipelineFlushes: 2,
        },
        {
          executable: executable([
            { op: "push", source: immediate(3) },
            { name: "test.return", op: "syscall" },
            move("eax", -1),
            move("eax", 42),
            { op: "halt" },
          ]),
          handler: (): { readonly kind: "return" } => ({ kind: "return" }),
          pipelineFlushes: 1,
        },
      ] as const;

      for (const transition of transitions) {
        const first = execute(
          transition.executable,
          cpuModel,
          transition.handler,
        );
        const second = execute(
          transition.executable,
          cpuModel,
          transition.handler,
        );
        expect(second).toEqual(first);
        expect(first).toMatchObject({
          registers: { eax: 42 },
          state: { kind: "completed", value: 42 },
        });
        expect(first.microarchitecture.pipelineFlushes).toBe(
          transition.pipelineFlushes,
        );
      }
    });

    it("rejects prepared and syscall targets with the original fault boundary", (): void => {
      for (const op of ["jmp", "je", "call"] as const) {
        expect(
          () =>
            new Cs486Process(
              executable([
                op === "call" ? { op, target: 2 } : { op, target: 2 },
                { op: "halt" },
              ]),
              { cpuModel, memoryBytes },
            ),
        ).toThrowError(Cs486Fault);
      }

      for (const kind of ["jump", "call"] as const) {
        const targetFault = execute(
          executable([{ name: `test.${kind}`, op: "syscall" }, { op: "halt" }]),
          cpuModel,
          () => ({ kind, target: 2 }),
        );
        expect(targetFault.state).toMatchObject({
          error: { typeName: "ExecutableFormatError" },
          kind: "crashed",
        });
        expect(targetFault.microarchitecture.pipelineFlushes).toBe(0);
      }

      const returnFault = execute(
        executable([
          { op: "push", source: immediate(3) },
          { op: "ret" },
          { op: "halt" },
        ]),
        cpuModel,
      );
      expect(returnFault.state).toMatchObject({
        error: { typeName: "ExecutableFormatError" },
        kind: "crashed",
      });
      expect(returnFault.microarchitecture.pipelineFlushes).toBe(1);
    });

    it("retains continue, complete, sleep, wait, and fault terminal ownership", (): void => {
      const continueExecutable = executable(
        [{ name: "test.continue", op: "syscall" }, { op: "halt" }],
        { dataBytes: 4 },
      );
      const continued = execute(
        continueExecutable,
        cpuModel,
        (name, context) => {
          expect(name).toBe("test.continue");
          context.writeRegister("eax", 41);
          context.writeInt32(0, 0x1234_5678);
          return { cycles: 7, kind: "continue" };
        },
      );
      expect(continued).toMatchObject({
        registers: { eax: 41 },
        state: { kind: "completed", value: 41 },
      });
      expect([...continued.memory.slice(0, 4)]).toEqual([
        0x78, 0x56, 0x34, 0x12,
      ]);

      const completed = createProcess(
        executable([{ name: "test.complete", op: "syscall" }, { op: "halt" }]),
        cpuModel,
        () => ({ kind: "complete", value: 99 }),
      );
      expect(completed.runInstructionSlice(8)).toMatchObject({
        executedInstructions: 1,
        state: { kind: "completed", value: 99 },
      });
      expect(completed.instructionAddress).toBe(1);

      let sleepResume: unknown = "unset";
      const sleeping = createProcess(
        executable([{ name: "test.sleep", op: "syscall" }, { op: "halt" }]),
        cpuModel,
        () => ({
          kind: "sleep",
          resume: (value): void => {
            sleepResume = value;
          },
          ticks: 2,
        }),
      );
      expect(sleeping.runInstructionSlice(8).state).toEqual({
        kind: "sleeping",
        wakeTick: 2,
      });
      expect(sleeping.advanceTick(1)).toEqual({
        kind: "sleeping",
        wakeTick: 2,
      });
      expect(sleeping.advanceTick(2)).toEqual({ kind: "ready" });
      expect(sleepResume).toBeNull();
      expect(sleeping.runInstructionSlice(8).state).toMatchObject({
        kind: "completed",
      });

      let eventResume: unknown = "unset";
      const waiting = createProcess(
        executable([{ name: "test.wait", op: "syscall" }, { op: "halt" }]),
        cpuModel,
        () => ({
          filter: "go",
          kind: "wait_event",
          resume: (value): void => {
            eventResume = value;
          },
        }),
      );
      expect(waiting.runInstructionSlice(8).state).toEqual({
        filter: "go",
        kind: "waiting_event",
      });
      expect(waiting.deliverEvent("other")).toBe(false);
      expect(waiting.deliverEvent("go", 7)).toBe(true);
      expect(eventResume).toEqual({ kind: "tuple", values: ["go", 7] });
      expect(waiting.runInstructionSlice(8).state).toMatchObject({
        kind: "completed",
      });

      const unsupported = execute(
        executable([
          { name: "test.unavailable", op: "syscall" },
          { op: "halt" },
        ]),
        cpuModel,
      );
      expect(unsupported.state).toMatchObject({
        error: { typeName: "UnsupportedError" },
        kind: "crashed",
      });
    });
  },
);

function binaryVariant(
  op: BinaryOpcode,
  initialValue: number,
  sourceValue: number,
  expectedEax: number,
): OperandVariantCase {
  return {
    create: (source: Cs486Operand): Cs486ExecutableV5 =>
      executable([
        move("esi", sourceValue),
        move("eax", initialValue),
        { destination: "eax", op, source } as Cs486Instruction,
        { op: "halt" },
      ]),
    expectedEax,
    name: op,
    sourceValue,
  };
}

function loadVariant(
  op: LoadOpcode,
  sourceValue: number,
  expectedEax: number,
): OperandVariantCase {
  return {
    create: (address: Cs486Operand): Cs486ExecutableV5 =>
      executable(
        [
          move("esi", sourceValue),
          { address, destination: "eax", op },
          { op: "halt" },
        ],
        { initialData: initializedBytes },
      ),
    expectedEax,
    name: op,
    sourceValue,
  };
}

function storeVariant(
  op: StoreOpcode,
  sourceValue: number,
  expectedBytes: readonly number[],
): OperandVariantCase {
  return {
    create: (address: Cs486Operand): Cs486ExecutableV5 =>
      executable(
        [
          move("esi", sourceValue),
          move("eax", 0x1234_5678),
          { address, op, source: "eax" },
          { op: "halt" },
        ],
        { initialData: initializedBytes },
      ),
    expectedMemory: [sourceValue, ...expectedBytes],
    name: op,
    sourceValue,
  };
}

function branchExecutable(
  op: BranchOpcode,
  left: number,
  right: Cs486Operand,
  rightRegisterValue = right.kind === "immediate" ? right.value : 0,
): Cs486ExecutableV5 {
  return executable([
    move("esi", rightRegisterValue),
    move("eax", left),
    { left: "eax", op: "cmp", right },
    { op, target: 6 },
    move("edx", 0),
    { op: "halt" },
    move("edx", 1),
    { op: "halt" },
  ]);
}

function indirectCallFaultExecutable(source: Cs486Operand): Cs486ExecutableV5 {
  return executable([
    move("esi", 99),
    {
      functionSignature: "()->i32",
      op: "call_indirect",
      source,
    },
    { op: "halt" },
  ]);
}

function execute(
  value: Cs486ExecutableV5,
  cpuModel: CpuModel,
  syscallHandler?: Cs486SyscallHandler,
): ExecutionSnapshot {
  const process = createProcess(value, cpuModel, syscallHandler);
  const slice = process.runInstructionSlice(instructionBudget);
  return capture(process, slice.cpuCycles, slice.executedInstructions);
}

function createProcess(
  value: Cs486ExecutableV5,
  cpuModel: CpuModel,
  syscallHandler?: Cs486SyscallHandler,
): Cs486Process {
  return new Cs486Process(value, { cpuModel, memoryBytes, syscallHandler });
}

function capture(
  process: Cs486Process,
  cpuCycles: number,
  executedInstructions: number,
): ExecutionSnapshot {
  return {
    cpuCycles,
    executedInstructions,
    instructionAddress: process.instructionAddress,
    memory: inspectAllMemory(process),
    microarchitecture: process.microarchitectureStats,
    output: process.output,
    registers: process.registers,
    state:
      process.state.kind === "crashed"
        ? {
            error: {
              message: process.state.error.message,
              typeName: process.state.error.typeName,
            },
            kind: "crashed",
          }
        : process.state,
  };
}

function inspectAllMemory(process: Cs486Process): Uint8Array {
  const result = new Uint8Array(process.memoryLimitBytes);
  for (let offset = 0; offset < result.length; offset += 4_096) {
    const length = Math.min(4_096, result.length - offset);
    result.set(process.inspectMemory(offset, length), offset);
  }
  return result;
}

function executable(
  instructions: readonly Cs486Instruction[],
  options: {
    readonly dataBytes?: number;
    readonly functionEntries?: Cs486ExecutableV5["functionEntries"];
    readonly initialData?: readonly number[];
  } = {},
): Cs486ExecutableV5 {
  const initialData = options.initialData ?? [];
  return {
    dataBytes: Math.max(options.dataBytes ?? 0, initialData.length),
    dataModel: "cs-word32-v1",
    format: "cs486-executable",
    ...(options.functionEntries === undefined
      ? {}
      : { functionEntries: options.functionEntries }),
    initialData:
      initialData.length === 0 ? [] : [{ bytes: initialData, offset: 0 }],
    instructions,
    memory: createCs486Flat32MemoryMetadata(),
    version: 5,
  };
}

function move(
  destination: "eax" | "ebx" | "ecx" | "edx" | "esi" | "edi" | "esp" | "ebp",
  value: number,
): Cs486Instruction {
  return { destination, op: "mov", source: immediate(value) };
}

function immediate(value: number): Cs486Operand {
  return { kind: "immediate", value };
}

function register(
  value: "eax" | "ebx" | "ecx" | "edx" | "esi" | "edi" | "esp" | "ebp",
): Cs486Operand {
  return { kind: "register", register: value };
}

function preparedSemantics(process: Cs486Process): {
  readonly instructionExecutionFlags: Uint8Array;
  readonly instructionOpcodes: Uint8Array;
  readonly instructionOperandA: Int32Array;
  readonly instructionOperandB: Int32Array;
} {
  return process as unknown as {
    readonly instructionExecutionFlags: Uint8Array;
    readonly instructionOpcodes: Uint8Array;
    readonly instructionOperandA: Int32Array;
    readonly instructionOperandB: Int32Array;
  };
}
