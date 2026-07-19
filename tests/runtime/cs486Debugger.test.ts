import { describe, expect, it, vi } from "vitest";

import { assembleCs486 } from "../../src/application/toolchain/cs486Assembler.js";
import {
  Cs486Debugger,
  type Cs486DebuggerExecution,
  cs486DebuggerLimits,
} from "../../src/application/toolchain/cs486Debugger.js";
import { Cs486Process } from "../../src/domain/cpu/cs486.js";

describe("CS486 bounded debugger core", (): void => {
  it("loads a validated executable and returns copied inspection data", (): void => {
    const executable = assembleCs486(
      [
        "section .data",
        "value: dd 305419896",
        "section .text",
        "global start",
        "start:",
        "load eax, [value]",
        "halt",
      ].join("\n"),
    );
    const debugger_ = Cs486Debugger.load(executable, { memoryBytes: 131_072 });

    expect(debugger_.state).toMatchObject({
      address: 0,
      kind: "paused",
      reason: "loaded",
    });
    expect(debugger_.registerSnapshot()).toEqual({
      instructionAddress: 0,
      registers: {
        eax: 0,
        ebp: 65_540,
        ebx: 0,
        ecx: 0,
        edi: 0,
        edx: 0,
        esi: 0,
        esp: 65_540,
      },
    });
    const memory = debugger_.readMemory(0, 4);
    expect([...memory]).toEqual([0x78, 0x56, 0x34, 0x12]);
    memory[0] = 0;
    expect([...debugger_.readMemory(0, 4)]).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(debugger_.disassemble(0, 2)).toEqual([
      {
        address: 0,
        instruction: {
          address: { kind: "immediate", value: 0 },
          destination: "eax",
          op: "load",
        },
        labels: ["start"],
        text: "load eax, [0]",
      },
      {
        address: 1,
        instruction: { op: "halt" },
        labels: [],
        text: "halt",
      },
    ]);
  });

  it("pauses at breakpoints, steps through them, and halts explicitly", (): void => {
    const debugger_ = Cs486Debugger.load(
      assembleCs486("mov eax, 1\nadd eax, 2\nhalt"),
      { memoryBytes: 131_072 },
    );
    expect(debugger_.setBreakpoint(1)).toBe(true);
    expect(debugger_.setBreakpoint(1)).toBe(false);
    expect(debugger_.breakpointAddresses()).toEqual([1]);

    expect(debugger_.continue(10)).toMatchObject({
      address: 1,
      executedInstructions: 1,
      kind: "paused",
      reason: "breakpoint",
    });
    expect(debugger_.registerSnapshot().registers.eax).toBe(1);
    expect(debugger_.continue(10)).toEqual({
      address: 1,
      cpuCycles: 0,
      executedInstructions: 0,
      kind: "paused",
      reason: "breakpoint",
    });

    expect(debugger_.step()).toMatchObject({
      address: 2,
      executedInstructions: 1,
      kind: "paused",
      reason: "step",
    });
    expect(debugger_.registerSnapshot().registers.eax).toBe(3);
    expect(debugger_.continue(10)).toMatchObject({
      address: 3,
      executedInstructions: 1,
      kind: "halted",
    });
    expect(debugger_.step()).toEqual({
      address: 3,
      cpuCycles: 0,
      executedInstructions: 0,
      kind: "halted",
    });
  });

  it("returns a resumable limit outcome for bounded continue", (): void => {
    const debugger_ = Cs486Debugger.load(assembleCs486("again:\njmp again"), {
      memoryBytes: 131_072,
    });

    expect(debugger_.continue(5)).toMatchObject({
      address: 0,
      executedInstructions: 5,
      kind: "limit",
      limit: 5,
    });
    expect(debugger_.continue(3)).toMatchObject({
      address: 0,
      executedInstructions: 3,
      kind: "limit",
      limit: 3,
    });
  });

  it("reports a stable explicit fault outcome", (): void => {
    const debugger_ = Cs486Debugger.load(assembleCs486("div eax, 0\nhalt"), {
      memoryBytes: 131_072,
    });

    expect(debugger_.step()).toMatchObject({
      address: 1,
      executedInstructions: 0,
      fault: {
        message: "division by zero",
        typeName: "DivisionByZeroError",
      },
      kind: "faulted",
    });
    expect(debugger_.continue(10)).toMatchObject({
      address: 1,
      executedInstructions: 0,
      kind: "faulted",
    });
  });

  it("faults a one-past-end RET during the RET step", (): void => {
    const debugger_ = Cs486Debugger.load(assembleCs486("push 2\nret"), {
      memoryBytes: 131_072,
    });

    expect(debugger_.step()).toMatchObject({
      address: 1,
      executedInstructions: 1,
      kind: "paused",
      reason: "step",
    });
    expect(debugger_.registerSnapshot().registers.esp).toBe(65_532);
    expect(debugger_.step()).toMatchObject({
      address: 2,
      executedInstructions: 0,
      fault: {
        message:
          "instruction pointer 2 is outside executable instruction range 0..1",
        typeName: "ExecutableFormatError",
      },
      kind: "faulted",
    });
    expect(debugger_.registerSnapshot().registers.esp).toBe(65_536);
  });

  it("runs continue as resumable CPU slices and prevents overlap", (): void => {
    const debugger_ = Cs486Debugger.load(
      assembleCs486("mov eax, 1\nadd eax, 2\nhalt"),
      { memoryBytes: 131_072 },
    );
    debugger_.setBreakpoint(1);
    const execution = debugger_.startContinueExecution(10);

    expect(() => debugger_.startStepExecution()).toThrow(/already active/u);
    expect(() => debugger_.step()).toThrow(/already active/u);
    const firstSlice = execution.runCpuSlice(1, 1);
    expect(firstSlice).toMatchObject({
      executedInstructions: 1,
      state: { kind: "ready" },
    });
    expect(execution.outcome).toBeUndefined();
    expect(execution.hasPendingCpuCycles).toBe(true);

    runExecution(execution);

    expect(execution.state.kind).toBe("completed");
    expect(execution.hasPendingCpuCycles).toBe(false);
    expect(execution.outcome).toMatchObject({
      address: 1,
      executedInstructions: 1,
      kind: "paused",
      reason: "breakpoint",
    });
    expect(debugger_.state).toEqual(execution.outcome);
    expect(debugger_.registerSnapshot().registers.eax).toBe(1);
    const resumed = debugger_.startStepExecution();
    runExecution(resumed);
    expect(resumed.outcome).toMatchObject({ kind: "paused", reason: "step" });
  });

  it("drains cycle debt before step, limit, halt, and fault outcomes", (): void => {
    const stepping = Cs486Debugger.load(assembleCs486("mov eax, 7\nhalt"), {
      memoryBytes: 131_072,
    });
    const step = stepping.startStepExecution();
    expect(step.runCpuSlice(1, 1).state.kind).toBe("ready");
    expect(step.outcome).toBeUndefined();
    runExecution(step);
    expect(step.outcome).toMatchObject({
      address: 1,
      executedInstructions: 1,
      kind: "paused",
      reason: "step",
    });

    const limited = Cs486Debugger.load(assembleCs486("again:\njmp again"), {
      memoryBytes: 131_072,
    });
    const limit = limited.startContinueExecution(3);
    runExecution(limit);
    expect(limit.outcome).toMatchObject({
      address: 0,
      executedInstructions: 3,
      kind: "limit",
      limit: 3,
    });

    const halting = Cs486Debugger.load(assembleCs486("halt"), {
      memoryBytes: 131_072,
    });
    const halt = halting.startContinueExecution(10);
    runExecution(halt);
    expect(halt.outcome).toMatchObject({
      address: 1,
      executedInstructions: 1,
      kind: "halted",
    });

    const faulting = Cs486Debugger.load(assembleCs486("div eax, 0\nhalt"), {
      memoryBytes: 131_072,
    });
    const fault = faulting.startContinueExecution(10);
    runExecution(fault);
    expect(fault.outcome).toMatchObject({
      address: 1,
      fault: { typeName: "DivisionByZeroError" },
      kind: "faulted",
    });
  });

  it("drains an instruction's cycle debt in one bounded adapter operation", (): void => {
    const drain = vi.spyOn(Cs486Process.prototype, "drainPendingCpuCycles");
    try {
      const debugger_ = Cs486Debugger.load(
        assembleCs486("load eax, [0]\nhalt"),
        { memoryBytes: 131_072 },
      );
      const step = debugger_.startStepExecution();

      expect(step.runCpuSlice(1_000_000, 1)).toMatchObject({
        executedInstructions: 1,
        state: { kind: "completed" },
      });
      expect(step.outcome).toMatchObject({
        address: 1,
        executedInstructions: 1,
        kind: "paused",
        reason: "step",
      });
      expect(drain).toHaveBeenCalledTimes(1);
    } finally {
      drain.mockRestore();
    }
  });

  it("stops at a breakpoint after draining a large single slice", (): void => {
    const debugger_ = Cs486Debugger.load(
      assembleCs486(
        [
          "section .data",
          "value: dd 41",
          "section .text",
          "load eax, [value]",
          "add eax, 1",
          "halt",
        ].join("\n"),
      ),
      { memoryBytes: 131_072 },
    );
    debugger_.setBreakpoint(1);
    const execution = debugger_.startContinueExecution(10);

    expect(execution.runCpuSlice(1_000_000, 10)).toMatchObject({
      executedInstructions: 1,
      state: { kind: "completed" },
    });
    expect(execution.hasPendingCpuCycles).toBe(false);
    expect(execution.outcome).toMatchObject({
      address: 1,
      executedInstructions: 1,
      kind: "paused",
      reason: "breakpoint",
    });
    expect(debugger_.registerSnapshot()).toMatchObject({
      instructionAddress: 1,
      registers: { eax: 41 },
    });
  });

  it("matches synchronous and scheduler-facing step cycles and machine state", (): void => {
    const executable = assembleCs486(
      [
        "section .data",
        "value: dd 305419896",
        "section .text",
        "load eax, [value]",
        "halt",
      ].join("\n"),
    );
    const synchronous = Cs486Debugger.load(executable, {
      memoryBytes: 131_072,
    });
    const scheduled = Cs486Debugger.load(executable, { memoryBytes: 131_072 });

    const synchronousOutcome = synchronous.step();
    const execution = scheduled.startStepExecution();
    const slice = execution.runCpuSlice(1_000_000, 10);

    expect(slice).toMatchObject({
      cpuCycles: synchronousOutcome.cpuCycles,
      executedInstructions: 1,
      state: { kind: "completed" },
    });
    expect(execution.outcome).toEqual(synchronousOutcome);
    expect(scheduled.registerSnapshot()).toEqual(
      synchronous.registerSnapshot(),
    );
    expect([...scheduled.readMemory(0, 4)]).toEqual([
      ...synchronous.readMemory(0, 4),
    ]);
    expect(scheduled.output).toBe(synchronous.output);
  });

  it("interrupts only the adapter after debt drains and preserves the debuggee", (): void => {
    const debugger_ = Cs486Debugger.load(
      assembleCs486("load eax, [0]\nadd eax, 1\nhalt"),
      { memoryBytes: 131_072 },
    );
    const execution = debugger_.startContinueExecution(10);
    expect(execution.runCpuSlice(1, 1)).toMatchObject({
      executedInstructions: 1,
      state: { kind: "ready" },
    });
    expect(execution.hasPendingCpuCycles).toBe(true);

    expect(execution.terminate("Ctrl+C")).toEqual({ kind: "ready" });
    expect(execution.outcome).toBeUndefined();
    runExecution(execution);

    expect(execution.state).toEqual({ kind: "terminated", reason: "Ctrl+C" });
    expect(execution.outcome).toMatchObject({
      address: 1,
      executedInstructions: 1,
      kind: "paused",
      reason: "interrupted",
    });
    expect(debugger_.registerSnapshot()).toMatchObject({
      instructionAddress: 1,
      registers: { eax: 0 },
    });

    const resumed = debugger_.startStepExecution();
    runExecution(resumed);
    expect(resumed.outcome).toMatchObject({
      address: 2,
      kind: "paused",
      reason: "step",
    });
    expect(debugger_.registerSnapshot().registers.eax).toBe(1);
  });

  it("rejects invalid executables, addresses, and operation limits", (): void => {
    expect(() =>
      Cs486Debugger.load(
        {
          format: "cs486-executable",
          instructions: [{ op: "unknown" }],
          version: 2,
        },
        { memoryBytes: 131_072 },
      ),
    ).toThrow(/invalid unknown instruction/u);

    const debugger_ = Cs486Debugger.load(assembleCs486("halt"), {
      memoryBytes: 131_072,
    });
    expect(() => debugger_.readMemory(-1, 1)).toThrow(/address/u);
    expect(() =>
      debugger_.readMemory(0, cs486DebuggerLimits.memoryReadBytes + 1),
    ).toThrow(/memory read limit/u);
    expect(() => debugger_.readMemory(65_535, 2)).toThrow(/outside RAM/u);
    expect(() => debugger_.disassemble(-1, 1)).toThrow(/address/u);
    expect(() =>
      debugger_.disassemble(0, cs486DebuggerLimits.disassemblyInstructions + 1),
    ).toThrow(/disassembly count/u);
    expect(() => debugger_.setBreakpoint(1)).toThrow(/breakpoint address/u);
    expect(() => debugger_.continue(0)).toThrow(/continue limit/u);
    expect(() =>
      debugger_.continue(cs486DebuggerLimits.continueInstructions + 1),
    ).toThrow(/continue limit/u);
  });
});

function runExecution(execution: Cs486DebuggerExecution): void {
  for (
    let slices = 0;
    slices < 10_000 && execution.state.kind === "ready";
    slices += 1
  )
    execution.runCpuSlice(3, 2);
  expect(execution.state.kind).not.toBe("ready");
}
