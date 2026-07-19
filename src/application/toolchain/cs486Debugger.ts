import {
  Cs486Process,
  validateCs486Executable,
  type Cs486Executable,
  type Cs486Instruction,
  type Cs486Operand,
  type Cs486Register,
} from "../../domain/cpu/cs486.js";
import type { CpuModel } from "../../domain/cpu/models.js";
import {
  isTerminalCpuProcessState,
  type CpuProcess,
  type CpuProcessSliceResult,
  type CpuProcessState,
} from "../../domain/runtime/cpuProcess.js";
import type { VmRuntimeError } from "../../domain/runtime/errors.js";

export const cs486DebuggerLimits = {
  breakpoints: 256,
  continueInstructions: 100_000,
  disassemblyInstructions: 256,
  memoryReadBytes: 4_096,
} as const;

export interface Cs486DebuggerOptions {
  readonly cpuModel?: CpuModel;
  readonly memoryBytes: number;
}

export interface Cs486DebuggerRegisterSnapshot {
  readonly instructionAddress: number;
  readonly registers: Readonly<Record<Cs486Register, number>>;
}

export interface Cs486DisassembledInstruction {
  readonly address: number;
  readonly instruction: Cs486Instruction;
  readonly labels: readonly string[];
  readonly text: string;
}

interface Cs486DebuggerOutcomeBase {
  readonly address: number;
  readonly cpuCycles: number;
  readonly executedInstructions: number;
}

export type Cs486DebuggerOutcome =
  | (Cs486DebuggerOutcomeBase & {
      readonly kind: "paused";
      readonly reason: "breakpoint" | "interrupted" | "loaded" | "step";
    })
  | (Cs486DebuggerOutcomeBase & { readonly kind: "halted" })
  | (Cs486DebuggerOutcomeBase & {
      readonly fault: { readonly message: string; readonly typeName: string };
      readonly kind: "faulted";
    })
  | (Cs486DebuggerOutcomeBase & {
      readonly kind: "limit";
      readonly limit: number;
    });

/**
 * Bounded, host-testable debugger for validated CS486 executables.
 *
 * The debugger owns one private process and exposes copies for every inspection
 * operation. It deliberately has no syscall handler or guest-shell dependency.
 */
export class Cs486Debugger {
  private activeExecution: Cs486DebuggerExecution | undefined;
  private readonly breakpoints = new Set<number>();
  private readonly labels = new Map<number, readonly string[]>();
  private stateValue: Cs486DebuggerOutcome;

  private constructor(
    private readonly executable: Cs486Executable,
    private readonly process: Cs486Process,
  ) {
    const groupedLabels = new Map<number, string[]>();
    for (const symbol of executable.symbols ?? []) {
      if ((symbol.section ?? "text") !== "text") continue;
      const names = groupedLabels.get(symbol.address) ?? [];
      names.push(symbol.name);
      groupedLabels.set(symbol.address, names);
    }
    for (const [address, names] of groupedLabels)
      this.labels.set(address, [...names].sort());
    this.stateValue = this.outcome(0, 0, {
      kind: "paused",
      reason: "loaded",
    });
  }

  static load(
    executable: unknown,
    options: Cs486DebuggerOptions,
  ): Cs486Debugger {
    validateCs486Executable(executable);
    const ownedExecutable = cloneExecutable(executable);
    const process = new Cs486Process(ownedExecutable, options);
    return new Cs486Debugger(ownedExecutable, process);
  }

  get state(): Cs486DebuggerOutcome {
    return this.stateValue;
  }

  get output(): string {
    return this.process.output;
  }

  registerSnapshot(): Cs486DebuggerRegisterSnapshot {
    return {
      instructionAddress: this.process.instructionAddress,
      registers: this.process.registers,
    };
  }

  readMemory(address: number, length: number): Uint8Array {
    if (length > cs486DebuggerLimits.memoryReadBytes)
      throw new RangeError(
        `debugger memory read limit is ${String(cs486DebuggerLimits.memoryReadBytes)} bytes`,
      );
    return this.process.inspectMemory(address, length);
  }

  disassemble(
    address: number,
    count: number,
  ): readonly Cs486DisassembledInstruction[] {
    if (
      !Number.isSafeInteger(address) ||
      address < 0 ||
      address > this.executable.instructions.length
    )
      throw new RangeError("disassembly address is outside executable text");
    if (
      !Number.isSafeInteger(count) ||
      count <= 0 ||
      count > cs486DebuggerLimits.disassemblyInstructions
    )
      throw new RangeError(
        `disassembly count must be between 1 and ${String(cs486DebuggerLimits.disassemblyInstructions)}`,
      );
    const end = Math.min(this.executable.instructions.length, address + count);
    const result: Cs486DisassembledInstruction[] = [];
    for (let current = address; current < end; current += 1) {
      const instruction = this.executable.instructions[current]!;
      result.push({
        address: current,
        instruction: cloneInstruction(instruction),
        labels: [...(this.labels.get(current) ?? [])],
        text: formatInstruction(instruction),
      });
    }
    return result;
  }

  setBreakpoint(address: number): boolean {
    this.requireInstructionAddress(address);
    if (this.breakpoints.has(address)) return false;
    if (this.breakpoints.size >= cs486DebuggerLimits.breakpoints)
      throw new RangeError("debugger breakpoint limit exceeded");
    this.breakpoints.add(address);
    return true;
  }

  clearBreakpoint(address: number): boolean {
    this.requireInstructionAddress(address);
    return this.breakpoints.delete(address);
  }

  clearBreakpoints(): void {
    this.breakpoints.clear();
  }

  breakpointAddresses(): readonly number[] {
    return [...this.breakpoints].sort((left, right) => left - right);
  }

  step(): Cs486DebuggerOutcome {
    this.requireIdle();
    const terminal = this.terminalOutcome(0, 0);
    if (terminal !== undefined) return this.finish(terminal);
    const slice = this.process.runInstructionSlice(1);
    const completed = this.terminalOutcome(
      slice.executedInstructions,
      slice.cpuCycles,
    );
    if (completed !== undefined) return this.finish(completed);
    if (slice.executedInstructions !== 1)
      return this.finish(
        this.faulted(
          slice.executedInstructions,
          slice.cpuCycles,
          "DebuggerStateError",
          "single-step did not reach an observable terminal state",
        ),
      );
    return this.finish(
      this.outcome(slice.executedInstructions, slice.cpuCycles, {
        kind: "paused",
        reason: "step",
      }),
    );
  }

  continue(instructionLimit: number): Cs486DebuggerOutcome {
    this.requireIdle();
    if (
      !Number.isSafeInteger(instructionLimit) ||
      instructionLimit <= 0 ||
      instructionLimit > cs486DebuggerLimits.continueInstructions
    )
      throw new RangeError(
        `continue limit must be between 1 and ${String(cs486DebuggerLimits.continueInstructions)}`,
      );
    const terminal = this.terminalOutcome(0, 0);
    if (terminal !== undefined) return this.finish(terminal);
    if (this.breakpoints.has(this.process.instructionAddress))
      return this.finish(
        this.outcome(0, 0, { kind: "paused", reason: "breakpoint" }),
      );

    let cpuCycles = 0;
    let executedInstructions = 0;
    while (executedInstructions < instructionLimit) {
      const slice = this.process.runInstructionSlice(1);
      cpuCycles += slice.cpuCycles;
      executedInstructions += slice.executedInstructions;
      const completed = this.terminalOutcome(executedInstructions, cpuCycles);
      if (completed !== undefined) return this.finish(completed);
      if (slice.executedInstructions !== 1)
        return this.finish(
          this.faulted(
            executedInstructions,
            cpuCycles,
            "DebuggerStateError",
            "continue did not reach an observable terminal state",
          ),
        );
      if (this.breakpoints.has(this.process.instructionAddress))
        return this.finish(
          this.outcome(executedInstructions, cpuCycles, {
            kind: "paused",
            reason: "breakpoint",
          }),
        );
    }
    return this.finish(
      this.outcome(executedInstructions, cpuCycles, {
        kind: "limit",
        limit: instructionLimit,
      }),
    );
  }

  startStepExecution(): Cs486DebuggerExecution {
    return this.startExecution({ kind: "step" });
  }

  startContinueExecution(instructionLimit: number): Cs486DebuggerExecution {
    this.requireContinueLimit(instructionLimit);
    return this.startExecution({
      instructionLimit,
      kind: "continue",
    });
  }

  private finish(outcome: Cs486DebuggerOutcome): Cs486DebuggerOutcome {
    this.stateValue = outcome;
    return outcome;
  }

  private outcome(
    executedInstructions: number,
    cpuCycles: number,
    outcome:
      | { readonly kind: "halted" }
      | { readonly kind: "limit"; readonly limit: number }
      | {
          readonly kind: "paused";
          readonly reason: "breakpoint" | "interrupted" | "loaded" | "step";
        },
  ): Cs486DebuggerOutcome {
    return {
      address: this.process.instructionAddress,
      cpuCycles,
      executedInstructions,
      ...outcome,
    };
  }

  private faulted(
    executedInstructions: number,
    cpuCycles: number,
    typeName: string,
    message: string,
  ): Cs486DebuggerOutcome {
    return {
      address: this.process.instructionAddress,
      cpuCycles,
      executedInstructions,
      fault: { message, typeName },
      kind: "faulted",
    };
  }

  private terminalOutcome(
    executedInstructions: number,
    cpuCycles: number,
  ): Cs486DebuggerOutcome | undefined {
    const state = this.process.state;
    if (state.kind === "ready") return undefined;
    if (state.kind === "completed")
      return this.outcome(executedInstructions, cpuCycles, { kind: "halted" });
    if (state.kind === "crashed")
      return this.faulted(
        executedInstructions,
        cpuCycles,
        state.error.typeName,
        state.error.message,
      );
    return this.faulted(
      executedInstructions,
      cpuCycles,
      "DebuggerStateError",
      `debuggee entered unsupported ${state.kind} state`,
    );
  }

  private requireInstructionAddress(address: number): void {
    if (
      !Number.isSafeInteger(address) ||
      address < 0 ||
      address >= this.executable.instructions.length
    )
      throw new RangeError("breakpoint address is outside executable text");
  }

  private requireContinueLimit(instructionLimit: number): void {
    if (
      !Number.isSafeInteger(instructionLimit) ||
      instructionLimit <= 0 ||
      instructionLimit > cs486DebuggerLimits.continueInstructions
    )
      throw new RangeError(
        `continue limit must be between 1 and ${String(cs486DebuggerLimits.continueInstructions)}`,
      );
  }

  private requireIdle(): void {
    if (this.activeExecution !== undefined)
      throw new Error("a debugger execution is already active");
  }

  private startExecution(
    mode:
      | { readonly kind: "step" }
      | { readonly instructionLimit: number; readonly kind: "continue" },
  ): Cs486DebuggerExecution {
    this.requireIdle();
    const execution = new Cs486DebuggerExecutionAdapter(
      this.process,
      mode,
      (address) => this.breakpoints.has(address),
      (outcome) => {
        if (this.activeExecution !== execution)
          throw new Error("debugger execution finalization owner mismatch");
        this.stateValue = outcome;
        this.activeExecution = undefined;
      },
    );
    this.activeExecution = execution;
    return execution;
  }
}

/** Scheduler-facing execution of one bounded debugger operation. */
export interface Cs486DebuggerExecution extends CpuProcess {
  readonly outcome: Cs486DebuggerOutcome | undefined;
}

class Cs486DebuggerExecutionAdapter implements Cs486DebuggerExecution {
  private stateValue: CpuProcessState = { kind: "ready" };
  private outcomeValue: Cs486DebuggerOutcome | undefined;
  private executedInstructions = 0;
  private cpuCycles = 0;
  private failureValue: VmRuntimeError | undefined;
  private interruptReason: string | undefined;
  private tick = 0;

  constructor(
    private readonly process: Cs486Process,
    private readonly mode:
      | { readonly kind: "step" }
      | { readonly instructionLimit: number; readonly kind: "continue" },
    private readonly hasBreakpoint: (address: number) => boolean,
    private readonly finalizeOwner: (outcome: Cs486DebuggerOutcome) => void,
  ) {}

  get state(): CpuProcessState {
    return this.stateValue;
  }

  get outcome(): Cs486DebuggerOutcome | undefined {
    return this.outcomeValue;
  }

  get hasPendingCpuCycles(): boolean {
    return (
      !isTerminalCpuProcessState(this.stateValue) &&
      this.process.hasPendingCpuCycles
    );
  }

  get memoryLimitBytes(): number {
    return this.process.memoryLimitBytes;
  }

  get memoryUsageBytes(): number {
    return this.process.memoryUsageBytes;
  }

  runCpuSlice(
    cpuCycleBudget: number,
    instructionBudget = Number.MAX_SAFE_INTEGER,
  ): CpuProcessSliceResult {
    if (!Number.isSafeInteger(cpuCycleBudget) || cpuCycleBudget <= 0)
      throw new RangeError("CPU cycle budget must be a positive safe integer");
    if (!Number.isSafeInteger(instructionBudget) || instructionBudget <= 0)
      throw new RangeError(
        "instruction budget must be a positive safe integer",
      );
    if (isTerminalCpuProcessState(this.stateValue))
      return { cpuCycles: 0, executedInstructions: 0, state: this.stateValue };

    let sliceCycles = 0;
    let sliceInstructions = 0;
    this.finalizeAtInstructionBoundary();
    while (
      !isTerminalCpuProcessState(this.stateValue) &&
      sliceCycles < cpuCycleBudget
    ) {
      if (this.process.hasPendingCpuCycles) {
        const paid = this.process.drainPendingCpuCycles(
          cpuCycleBudget - sliceCycles,
        );
        sliceCycles += paid;
        this.cpuCycles += paid;
        if (!this.process.hasPendingCpuCycles)
          this.finalizeAtInstructionBoundary();
        continue;
      }
      this.finalizeAtInstructionBoundary();
      if (isTerminalCpuProcessState(this.stateValue)) break;
      if (sliceInstructions >= instructionBudget) break;

      const instruction = this.process.runCpuSlice(1, 1);
      sliceCycles += instruction.cpuCycles;
      sliceInstructions += instruction.executedInstructions;
      this.cpuCycles += instruction.cpuCycles;
      this.executedInstructions += instruction.executedInstructions;
      if (!this.process.hasPendingCpuCycles)
        this.finalizeAtInstructionBoundary();
      if (
        instruction.cpuCycles === 0 &&
        instruction.executedInstructions === 0 &&
        !isTerminalCpuProcessState(this.stateValue)
      )
        this.finish(
          this.faulted(
            "DebuggerStateError",
            "debuggee made no progress during a CPU slice",
          ),
        );
    }
    return {
      cpuCycles: sliceCycles,
      executedInstructions: sliceInstructions,
      state: this.stateValue,
    };
  }

  advanceTick(tick: number): CpuProcessState {
    if (!Number.isSafeInteger(tick) || tick < this.tick)
      throw new RangeError(
        "debugger execution tick must advance monotonically",
      );
    this.tick = tick;
    return this.stateValue;
  }

  deliverEvent(): boolean {
    return false;
  }

  terminate(reason = "interrupted"): CpuProcessState {
    if (isTerminalCpuProcessState(this.stateValue)) return this.stateValue;
    this.interruptReason = reason;
    if (!this.process.hasPendingCpuCycles) this.finalizeAtInstructionBoundary();
    return this.stateValue;
  }

  fail(error: VmRuntimeError): CpuProcessState {
    if (isTerminalCpuProcessState(this.stateValue)) return this.stateValue;
    this.failureValue = error;
    if (!this.process.hasPendingCpuCycles) this.finalizeAtInstructionBoundary();
    return this.stateValue;
  }

  private finalizeAtInstructionBoundary(): void {
    if (
      isTerminalCpuProcessState(this.stateValue) ||
      this.process.hasPendingCpuCycles
    )
      return;
    const processState = this.process.state;
    if (processState.kind === "completed") {
      this.finish(this.baseOutcome({ kind: "halted" }));
      return;
    }
    if (processState.kind === "crashed") {
      this.finish(
        this.faulted(processState.error.typeName, processState.error.message),
      );
      return;
    }
    if (processState.kind !== "ready") {
      this.finish(
        this.faulted(
          "DebuggerStateError",
          `debuggee entered unsupported ${processState.kind} state`,
        ),
      );
      return;
    }
    if (this.failureValue !== undefined) {
      const failure = this.failureValue;
      this.finish(this.faulted(failure.typeName, failure.message), {
        error: failure,
        kind: "crashed",
      });
      return;
    }
    if (this.interruptReason !== undefined) {
      this.finish(this.baseOutcome({ kind: "paused", reason: "interrupted" }), {
        kind: "terminated",
        reason: this.interruptReason,
      });
      return;
    }
    if (this.mode.kind === "step" && this.executedInstructions >= 1) {
      this.finish(this.baseOutcome({ kind: "paused", reason: "step" }));
      return;
    }
    if (
      this.mode.kind === "continue" &&
      this.hasBreakpoint(this.process.instructionAddress)
    ) {
      this.finish(this.baseOutcome({ kind: "paused", reason: "breakpoint" }));
      return;
    }
    if (
      this.mode.kind === "continue" &&
      this.executedInstructions >= this.mode.instructionLimit
    )
      this.finish(
        this.baseOutcome({
          kind: "limit",
          limit: this.mode.instructionLimit,
        }),
      );
  }

  private baseOutcome(
    outcome:
      | { readonly kind: "halted" }
      | { readonly kind: "limit"; readonly limit: number }
      | {
          readonly kind: "paused";
          readonly reason: "breakpoint" | "interrupted" | "step";
        },
  ): Cs486DebuggerOutcome {
    return {
      address: this.process.instructionAddress,
      cpuCycles: this.cpuCycles,
      executedInstructions: this.executedInstructions,
      ...outcome,
    };
  }

  private faulted(typeName: string, message: string): Cs486DebuggerOutcome {
    return {
      address: this.process.instructionAddress,
      cpuCycles: this.cpuCycles,
      executedInstructions: this.executedInstructions,
      fault: { message, typeName },
      kind: "faulted",
    };
  }

  private finish(
    outcome: Cs486DebuggerOutcome,
    state: CpuProcessState = { kind: "completed", value: null },
  ): void {
    if (isTerminalCpuProcessState(this.stateValue)) return;
    this.outcomeValue = outcome;
    this.stateValue = state;
    this.finalizeOwner(outcome);
  }
}

function cloneExecutable(executable: Cs486Executable): Cs486Executable {
  const cloned = {
    ...(executable.dataBytes === undefined
      ? {}
      : { dataBytes: executable.dataBytes }),
    format: "cs486-executable" as const,
    ...(executable.initialData === undefined
      ? {}
      : {
          initialData: executable.initialData.map((segment) => ({
            bytes: [...segment.bytes],
            offset: segment.offset,
          })),
        }),
    instructions: executable.instructions.map(cloneInstruction),
    ...(executable.symbols === undefined
      ? {}
      : {
          symbols: executable.symbols.map((symbol) => ({ ...symbol })),
        }),
  };
  return executable.version === 3
    ? {
        ...cloned,
        memory: Object.freeze({ ...executable.memory }),
        version: 3,
      }
    : { ...cloned, version: executable.version };
}

function cloneInstruction(instruction: Cs486Instruction): Cs486Instruction {
  switch (instruction.op) {
    case "mov":
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod":
    case "and":
    case "or":
    case "xor":
    case "shl":
    case "shr":
      return { ...instruction, source: cloneOperand(instruction.source) };
    case "load":
      return { ...instruction, address: cloneOperand(instruction.address) };
    case "store":
      return { ...instruction, address: cloneOperand(instruction.address) };
    case "cmp":
      return { ...instruction, right: cloneOperand(instruction.right) };
    case "push":
      return { ...instruction, source: cloneOperand(instruction.source) };
    case "print":
      return {
        ...instruction,
        source:
          typeof instruction.source === "string"
            ? instruction.source
            : cloneOperand(instruction.source),
      };
    case "jmp":
    case "je":
    case "jne":
    case "jl":
    case "jle":
    case "jg":
    case "jge":
    case "call":
    case "pop":
    case "ret":
    case "halt":
    case "syscall":
      return { ...instruction };
  }
}

function cloneOperand(operand: Cs486Operand): Cs486Operand {
  return { ...operand };
}

function formatInstruction(instruction: Cs486Instruction): string {
  switch (instruction.op) {
    case "mov":
    case "add":
    case "sub":
    case "mul":
    case "div":
    case "mod":
    case "and":
    case "or":
    case "xor":
    case "shl":
    case "shr":
      return `${instruction.op} ${instruction.destination}, ${formatOperand(instruction.source)}`;
    case "load":
      return `load ${instruction.destination}, [${formatOperand(instruction.address)}]`;
    case "store":
      return `store [${formatOperand(instruction.address)}], ${instruction.source}`;
    case "cmp":
      return `cmp ${instruction.left}, ${formatOperand(instruction.right)}`;
    case "push":
      return `push ${formatOperand(instruction.source)}`;
    case "pop":
      return `pop ${instruction.destination}`;
    case "jmp":
    case "je":
    case "jne":
    case "jl":
    case "jle":
    case "jg":
    case "jge":
    case "call":
      return `${instruction.op} ${String(instruction.target)}`;
    case "syscall":
      return `syscall ${instruction.name}`;
    case "print":
      return `print ${
        typeof instruction.source === "string"
          ? JSON.stringify(instruction.source)
          : formatOperand(instruction.source)
      }`;
    case "ret":
    case "halt":
      return instruction.op;
  }
}

function formatOperand(operand: Cs486Operand): string {
  return operand.kind === "register" ? operand.register : String(operand.value);
}
