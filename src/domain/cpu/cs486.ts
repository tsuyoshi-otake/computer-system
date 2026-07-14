import { computerNominalClockHz } from "./timing.js";
import {
  isTerminalCpuProcessState,
  type CpuProcess,
  type CpuProcessSliceResult,
  type CpuProcessState,
} from "../runtime/cpuProcess.js";
import { VmRuntimeError } from "../runtime/errors.js";
import type { RuntimeValue } from "../runtime/value.js";

export const cs486NominalClockHz = computerNominalClockHz;

export const cs486RegisterNames = [
  "eax",
  "ebx",
  "ecx",
  "edx",
  "esi",
  "edi",
  "esp",
  "ebp",
] as const;

export type Cs486Register = (typeof cs486RegisterNames)[number];
export type Cs486Operand =
  | { readonly kind: "immediate"; readonly value: number }
  | { readonly kind: "register"; readonly register: Cs486Register };

export type Cs486Instruction =
  | {
      readonly op: "mov";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "load";
      readonly destination: Cs486Register;
      readonly address: Cs486Operand;
    }
  | {
      readonly op: "store";
      readonly address: Cs486Operand;
      readonly source: Cs486Register;
    }
  | {
      readonly op: "add" | "sub" | "mul" | "div" | "mod" | "and" | "or" | "xor";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "shl" | "shr";
      readonly destination: Cs486Register;
      readonly source: Cs486Operand;
    }
  | {
      readonly op: "cmp";
      readonly left: Cs486Register;
      readonly right: Cs486Operand;
    }
  | {
      readonly op: "jmp" | "je" | "jne" | "jl" | "jle" | "jg" | "jge";
      readonly target: number;
    }
  | { readonly op: "push"; readonly source: Cs486Operand }
  | { readonly op: "pop"; readonly destination: Cs486Register }
  | { readonly op: "call"; readonly target: number }
  | { readonly op: "ret" | "halt" }
  | { readonly op: "syscall"; readonly name: string }
  | { readonly op: "print"; readonly source: Cs486Operand | string };

export interface Cs486Executable {
  readonly dataBytes?: number;
  readonly format: "cs486-executable";
  readonly version: 1;
  readonly instructions: readonly Cs486Instruction[];
  readonly symbols?: readonly {
    readonly address: number;
    readonly name: string;
  }[];
}

export interface Cs486RunResult {
  readonly cycles: number;
  readonly executedInstructions: number;
  readonly output: string;
  readonly registers: Readonly<Record<Cs486Register, number>>;
  readonly state: "halted" | "yielded";
}

export interface Cs486SyscallContext {
  readonly memoryLimitBytes: number;
  readInt32(address: number): number;
  readRegister(register: Cs486Register): number;
  writeInt32(address: number, value: number): void;
  writeRegister(register: Cs486Register, value: number): void;
}

export type Cs486SyscallResult =
  | { readonly kind: "continue"; readonly cycles?: number }
  | { readonly kind: "jump"; readonly target: number; readonly cycles?: number }
  | { readonly kind: "call"; readonly target: number; readonly cycles?: number }
  | { readonly kind: "return"; readonly cycles?: number }
  | {
      readonly kind: "sleep";
      readonly ticks: number;
      readonly cycles?: number;
      readonly resume?: (value: RuntimeValue) => void;
    }
  | {
      readonly kind: "wait_event";
      readonly filter?: string;
      readonly cycles?: number;
      readonly resume?: (value: RuntimeValue) => void;
    }
  | {
      readonly kind: "complete";
      readonly value: RuntimeValue;
      readonly cycles?: number;
    };

export type Cs486SyscallHandler = (
  name: string,
  context: Cs486SyscallContext,
) => Cs486SyscallResult;

export class Cs486Fault extends Error {
  constructor(
    readonly typeName: string,
    message: string,
  ) {
    super(message);
    this.name = typeName;
  }
}

const maximumProgramInstructions = 4_096;
const maximumOutputBytes = 64_000;

export function runCs486(
  executable: Cs486Executable,
  options: { readonly memoryBytes: number; readonly instructionLimit?: number },
): Cs486RunResult {
  const instructionLimit = options.instructionLimit ?? 100_000;
  if (!Number.isSafeInteger(instructionLimit) || instructionLimit <= 0)
    throw new RangeError("CS486 instruction limit must be positive");
  const process = new Cs486Process(executable, options);
  const slice = process.runInstructionSlice(instructionLimit);
  if (process.state.kind === "crashed") {
    throw new Cs486Fault(
      process.state.error.typeName,
      process.state.error.message,
    );
  }
  return {
    cycles: slice.cpuCycles,
    executedInstructions: slice.executedInstructions,
    output: process.output,
    registers: process.registers,
    state: process.state.kind === "completed" ? "halted" : "yielded",
  };
}

/**
 * Resumable CS486 execution state. The scheduler charges instruction cycles in
 * bounded slices; an instruction may incur debt beyond the current slice and
 * that debt is paid before another instruction is allowed to execute.
 */
export class Cs486Process implements CpuProcess {
  private readonly memory: DataView;
  private readonly registerValues = new Int32Array(cs486RegisterNames.length);
  private readonly memoryBytes: number;
  private stateValue: CpuProcessState = { kind: "ready" };
  private instructionPointer = 0;
  private compared = 0;
  private cycleDebt = 0;
  private tick = 0;
  private outputValue = "";
  private pendingResume: ((value: RuntimeValue) => void) | undefined;

  constructor(
    private readonly executable: Cs486Executable,
    private readonly options: {
      readonly externalMemoryUsageBytes?: () => number;
      readonly memoryBytes: number;
      readonly syscallHandler?: Cs486SyscallHandler;
    },
  ) {
    validateCs486Executable(executable);
    this.memoryBytes = Math.min(options.memoryBytes, 16 * 1_024 * 1_024);
    if (
      !Number.isSafeInteger(this.memoryBytes) ||
      this.memoryBytes < 64 * 1_024
    )
      throw new RangeError("CS486 requires at least 64 KiB RAM");
    if ((executable.dataBytes ?? 0) > this.memoryBytes)
      throw new Cs486Fault(
        "MemoryAccessError",
        "executable data exceeds available RAM",
      );
    this.memory = new DataView(new ArrayBuffer(this.memoryBytes));
    this.write("esp", this.memoryBytes);
    this.write("ebp", this.memoryBytes);
  }

  get state(): CpuProcessState {
    return this.stateValue;
  }

  get output(): string {
    return this.outputValue;
  }

  get registers(): Readonly<Record<Cs486Register, number>> {
    return Object.fromEntries(
      cs486RegisterNames.map((name, index) => [
        name,
        this.registerValues[index]!,
      ]),
    ) as Record<Cs486Register, number>;
  }

  get memoryLimitBytes(): number {
    return this.memoryBytes;
  }

  get memoryUsageBytes(): number {
    const stackBytes = this.memoryBytes - this.readRegister("esp");
    return Math.max(
      0,
      (this.executable.dataBytes ?? 0) +
        stackBytes +
        32 +
        (this.options.externalMemoryUsageBytes?.() ?? 0),
    );
  }

  get hasPendingCpuCycles(): boolean {
    return this.cycleDebt > 0;
  }

  runCpuSlice(cpuCycleBudget: number): CpuProcessSliceResult {
    if (!Number.isSafeInteger(cpuCycleBudget) || cpuCycleBudget <= 0)
      throw new RangeError("CPU cycle budget must be a positive safe integer");
    if (this.stateValue.kind !== "ready" && this.cycleDebt === 0)
      return { cpuCycles: 0, executedInstructions: 0, state: this.stateValue };

    let cpuCycles = 0;
    let executedInstructions = 0;
    while (
      cpuCycles < cpuCycleBudget &&
      (this.stateValue.kind === "ready" || this.cycleDebt > 0)
    ) {
      if (this.cycleDebt > 0) {
        const paid = Math.min(this.cycleDebt, cpuCycleBudget - cpuCycles);
        this.cycleDebt -= paid;
        cpuCycles += paid;
        continue;
      }
      if (this.stateValue.kind !== "ready") break;
      try {
        const cycles = this.executeNext();
        if (cycles === undefined) break;
        executedInstructions += 1;
        this.cycleDebt += cycles;
      } catch (error: unknown) {
        this.crash(error);
      }
    }
    return { cpuCycles, executedInstructions, state: this.stateValue };
  }

  runInstructionSlice(instructionBudget: number): CpuProcessSliceResult {
    if (!Number.isSafeInteger(instructionBudget) || instructionBudget <= 0)
      throw new RangeError("instructionBudget must be a positive safe integer");
    if (this.stateValue.kind !== "ready")
      return { cpuCycles: 0, executedInstructions: 0, state: this.stateValue };
    let cpuCycles = 0;
    let executedInstructions = 0;
    while (
      executedInstructions < instructionBudget &&
      this.stateValue.kind === "ready"
    ) {
      try {
        const cycles = this.executeNext();
        if (cycles === undefined) break;
        cpuCycles += cycles;
        executedInstructions += 1;
      } catch (error: unknown) {
        this.crash(error);
      }
    }
    return { cpuCycles, executedInstructions, state: this.stateValue };
  }

  advanceTick(tick: number): CpuProcessState {
    if (!Number.isInteger(tick) || tick < this.tick)
      throw new RangeError("CPU process tick must advance monotonically");
    this.tick = tick;
    if (this.stateValue.kind === "sleeping" && tick >= this.stateValue.wakeTick)
      this.resume(null);
    return this.stateValue;
  }

  deliverEvent(name: string, ...arguments_: readonly RuntimeValue[]): boolean {
    if (
      this.stateValue.kind !== "waiting_event" ||
      (this.stateValue.filter !== undefined && this.stateValue.filter !== name)
    )
      return false;
    this.resume({ kind: "tuple", values: [name, ...arguments_] });
    return this.state.kind !== "crashed";
  }

  terminate(reason = "terminated"): CpuProcessState {
    if (!isTerminalCpuProcessState(this.stateValue)) {
      this.pendingResume = undefined;
      this.stateValue = { kind: "terminated", reason };
    }
    return this.stateValue;
  }

  fail(error: VmRuntimeError): CpuProcessState {
    if (!isTerminalCpuProcessState(this.stateValue))
      this.stateValue = { kind: "crashed", error };
    return this.stateValue;
  }

  private executeNext(): number | undefined {
    const instruction = this.executable.instructions[this.instructionPointer];
    if (instruction === undefined) {
      this.complete();
      return undefined;
    }
    this.instructionPointer += 1;
    const cycles = cycleCost(instruction);
    switch (instruction.op) {
      case "mov":
        this.write(instruction.destination, this.read(instruction.source));
        break;
      case "load":
        this.write(
          instruction.destination,
          this.memory.getInt32(this.address(instruction.address), true),
        );
        break;
      case "store":
        this.memory.setInt32(
          this.address(instruction.address),
          this.readRegister(instruction.source),
          true,
        );
        break;
      case "add":
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) +
            this.read(instruction.source),
        );
        break;
      case "sub":
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) -
            this.read(instruction.source),
        );
        break;
      case "mul":
        this.write(
          instruction.destination,
          Math.imul(
            this.readRegister(instruction.destination),
            this.read(instruction.source),
          ),
        );
        break;
      case "div": {
        const divisor = this.read(instruction.source);
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.write(
          instruction.destination,
          Math.trunc(this.readRegister(instruction.destination) / divisor),
        );
        break;
      }
      case "mod": {
        const divisor = this.read(instruction.source);
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) % divisor,
        );
        break;
      }
      case "and":
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) &
            this.read(instruction.source),
        );
        break;
      case "or":
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) |
            this.read(instruction.source),
        );
        break;
      case "xor":
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) ^
            this.read(instruction.source),
        );
        break;
      case "shl":
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) <<
            (this.read(instruction.source) & 31),
        );
        break;
      case "shr":
        this.write(
          instruction.destination,
          this.readRegister(instruction.destination) >>
            (this.read(instruction.source) & 31),
        );
        break;
      case "cmp":
        this.compared =
          this.readRegister(instruction.left) - this.read(instruction.right);
        break;
      case "jmp":
        this.instructionPointer = instruction.target;
        break;
      case "je":
        if (this.compared === 0) this.instructionPointer = instruction.target;
        break;
      case "jne":
        if (this.compared !== 0) this.instructionPointer = instruction.target;
        break;
      case "jl":
        if (this.compared < 0) this.instructionPointer = instruction.target;
        break;
      case "jle":
        if (this.compared <= 0) this.instructionPointer = instruction.target;
        break;
      case "jg":
        if (this.compared > 0) this.instructionPointer = instruction.target;
        break;
      case "jge":
        if (this.compared >= 0) this.instructionPointer = instruction.target;
        break;
      case "push":
        this.push(this.read(instruction.source));
        break;
      case "pop":
        this.write(instruction.destination, this.pop());
        break;
      case "call":
        this.push(this.instructionPointer);
        this.instructionPointer = instruction.target;
        break;
      case "ret":
        this.instructionPointer = this.pop();
        break;
      case "syscall": {
        const handler = this.options.syscallHandler;
        if (handler === undefined)
          throw new Cs486Fault(
            "UnsupportedError",
            `syscall ${instruction.name} is unavailable`,
          );
        const result = handler(instruction.name, {
          memoryLimitBytes: this.memoryBytes,
          readInt32: (address) =>
            this.memory.getInt32(this.checkedAddress(address), true),
          readRegister: (register) => this.readRegister(register),
          writeInt32: (address, value) =>
            this.memory.setInt32(this.checkedAddress(address), value | 0, true),
          writeRegister: (register, value) => this.write(register, value),
        });
        const extraCycles = result.cycles ?? 0;
        if (
          !Number.isSafeInteger(extraCycles) ||
          extraCycles < 0 ||
          extraCycles > 100_000_000
        )
          throw new Cs486Fault(
            "ResourceLimitError",
            "invalid syscall cycle charge",
          );
        this.applySyscallResult(result);
        return cycles + extraCycles;
      }
      case "print": {
        const value =
          typeof instruction.source === "string"
            ? instruction.source
            : String(this.read(instruction.source));
        this.outputValue += value;
        if (this.outputValue.length > maximumOutputBytes)
          throw new Cs486Fault("OutputLimitError", "output limit exceeded");
        break;
      }
      case "halt":
        this.complete();
        break;
    }
    return cycles;
  }

  private read(operand: Cs486Operand): number {
    return operand.kind === "immediate"
      ? operand.value | 0
      : this.readRegister(operand.register);
  }

  private readRegister(register: Cs486Register): number {
    return this.registerValues[indexOf(register)]!;
  }

  private write(register: Cs486Register, value: number): void {
    this.registerValues[indexOf(register)] = value | 0;
  }

  private address(operand: Cs486Operand): number {
    return this.checkedAddress(this.read(operand));
  }

  private checkedAddress(value: number): number {
    if (!Number.isInteger(value) || value < 0 || value + 4 > this.memoryBytes)
      throw new Cs486Fault(
        "MemoryAccessError",
        `address ${value} is outside RAM`,
      );
    return value;
  }

  private applySyscallResult(result: Cs486SyscallResult): void {
    switch (result.kind) {
      case "continue":
        return;
      case "jump":
        if (
          !Number.isSafeInteger(result.target) ||
          result.target < 0 ||
          result.target >= this.executable.instructions.length
        )
          throw new Cs486Fault(
            "ExecutableFormatError",
            "invalid syscall jump target",
          );
        this.instructionPointer = result.target;
        return;
      case "call":
        if (
          !Number.isSafeInteger(result.target) ||
          result.target < 0 ||
          result.target >= this.executable.instructions.length
        )
          throw new Cs486Fault(
            "ExecutableFormatError",
            "invalid syscall call target",
          );
        this.push(this.instructionPointer);
        this.instructionPointer = result.target;
        return;
      case "return":
        this.instructionPointer = this.pop();
        return;
      case "sleep":
        if (!Number.isSafeInteger(result.ticks) || result.ticks < 0)
          throw new Cs486Fault(
            "ValueError",
            "sleep ticks must be non-negative",
          );
        this.pendingResume = result.resume;
        this.stateValue = {
          kind: "sleeping",
          wakeTick: this.tick + result.ticks,
        };
        return;
      case "wait_event":
        this.pendingResume = result.resume;
        this.stateValue = { kind: "waiting_event", filter: result.filter };
        return;
      case "complete":
        this.pendingResume = undefined;
        this.stateValue = { kind: "completed", value: result.value };
    }
  }

  private push(value: number): void {
    const next = this.readRegister("esp") - 4;
    if (next < 0) throw new Cs486Fault("StackOverflowError", "stack overflow");
    this.memory.setInt32(next, value, true);
    this.write("esp", next);
  }

  private pop(): number {
    const current = this.readRegister("esp");
    if (current < 0 || current + 4 > this.memoryBytes)
      throw new Cs486Fault("StackUnderflowError", "stack underflow");
    const value = this.memory.getInt32(current, true);
    this.write("esp", current + 4);
    return value;
  }

  private complete(): void {
    if (!isTerminalCpuProcessState(this.stateValue))
      this.stateValue = { kind: "completed", value: this.readRegister("eax") };
  }

  private resume(value: RuntimeValue): void {
    const resume = this.pendingResume;
    this.pendingResume = undefined;
    if (resume === undefined) {
      this.crash(new VmRuntimeError("RuntimeError", "no syscall owns resume"));
      return;
    }
    try {
      resume(value);
      this.stateValue = { kind: "ready" };
    } catch (error: unknown) {
      this.crash(error);
    }
  }

  private crash(error: unknown): void {
    if (isTerminalCpuProcessState(this.stateValue)) return;
    this.pendingResume = undefined;
    const fault =
      error instanceof Cs486Fault
        ? new VmRuntimeError(error.typeName, error.message)
        : error instanceof VmRuntimeError
          ? error
          : new VmRuntimeError(
              "RuntimeError",
              error instanceof Error ? error.message : String(error),
            );
    this.stateValue = { kind: "crashed", error: fault };
  }
}

export function validateCs486Executable(
  value: unknown,
): asserts value is Cs486Executable {
  if (typeof value !== "object" || value === null)
    throw new Cs486Fault("ExecutableFormatError", "invalid executable");
  const candidate = value as Partial<Cs486Executable>;
  if (
    candidate.format !== "cs486-executable" ||
    candidate.version !== 1 ||
    !Array.isArray(candidate.instructions)
  )
    throw new Cs486Fault(
      "ExecutableFormatError",
      "unsupported executable format",
    );
  if (candidate.instructions.length > maximumProgramInstructions)
    throw new Cs486Fault(
      "ExecutableFormatError",
      "program instruction limit exceeded",
    );
  if (
    candidate.dataBytes !== undefined &&
    (!Number.isSafeInteger(candidate.dataBytes) ||
      candidate.dataBytes < 0 ||
      candidate.dataBytes > 16 * 1_048_576)
  )
    throw new Cs486Fault("ExecutableFormatError", "invalid data size");
  if (
    candidate.symbols !== undefined &&
    (!Array.isArray(candidate.symbols) ||
      candidate.symbols.length > 2_048 ||
      (candidate.symbols as readonly unknown[]).some((value) => {
        if (typeof value !== "object" || value === null) return true;
        const symbol = value as {
          readonly address?: unknown;
          readonly name?: unknown;
        };
        return (
          typeof symbol.name !== "string" ||
          !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(symbol.name) ||
          !Number.isSafeInteger(symbol.address) ||
          (symbol.address as number) < 0 ||
          (symbol.address as number) >= candidate.instructions!.length
        );
      }))
  )
    throw new Cs486Fault("ExecutableFormatError", "invalid symbol table");
  for (const instruction of candidate.instructions) {
    if (typeof instruction !== "object" || instruction === null)
      throw new Cs486Fault("ExecutableFormatError", "invalid instruction");
    const candidateInstruction = instruction as Record<string, unknown>;
    const op = candidateInstruction.op;
    const register = (name: string): boolean =>
      isCs486Register(candidateInstruction[name]);
    const operand = (name: string): boolean =>
      isCs486Operand(candidateInstruction[name]);
    let valid = false;
    if (op === "halt" || op === "ret") valid = true;
    else if (op === "syscall")
      valid =
        typeof candidateInstruction.name === "string" &&
        /^[a-z][a-z0-9_.]{0,63}$/u.test(candidateInstruction.name);
    else if (
      op === "jmp" ||
      op === "je" ||
      op === "jne" ||
      op === "jl" ||
      op === "jle" ||
      op === "jg" ||
      op === "jge" ||
      op === "call"
    ) {
      valid =
        Number.isSafeInteger(candidateInstruction.target) &&
        (candidateInstruction.target as number) >= 0 &&
        (candidateInstruction.target as number) < candidate.instructions.length;
    } else if (op === "push") valid = operand("source");
    else if (op === "pop") valid = register("destination");
    else if (op === "print")
      valid =
        typeof candidateInstruction.source === "string" || operand("source");
    else if (op === "load")
      valid = register("destination") && operand("address");
    else if (op === "store") valid = operand("address") && register("source");
    else if (op === "cmp") valid = register("left") && operand("right");
    else if (
      op === "mov" ||
      op === "add" ||
      op === "sub" ||
      op === "mul" ||
      op === "div" ||
      op === "mod" ||
      op === "and" ||
      op === "or" ||
      op === "xor" ||
      op === "shl" ||
      op === "shr"
    ) {
      valid = register("destination") && operand("source");
    }
    if (!valid)
      throw new Cs486Fault(
        "ExecutableFormatError",
        `invalid ${String(op)} instruction`,
      );
  }
}

function isCs486Register(value: unknown): value is Cs486Register {
  return (
    typeof value === "string" &&
    cs486RegisterNames.includes(value as Cs486Register)
  );
}

function isCs486Operand(value: unknown): value is Cs486Operand {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Cs486Operand>;
  return candidate.kind === "register"
    ? isCs486Register(candidate.register)
    : candidate.kind === "immediate" &&
        Number.isSafeInteger(candidate.value) &&
        (candidate.value ?? 0) >= -2_147_483_648 &&
        (candidate.value ?? 0) <= 2_147_483_647;
}

function indexOf(register: Cs486Register): number {
  return cs486RegisterNames.indexOf(register);
}

function cycleCost(instruction: Cs486Instruction): number {
  switch (instruction.op) {
    case "load":
    case "store":
    case "push":
    case "pop":
      return 2;
    case "mul":
      return 9;
    case "div":
    case "mod":
      return 40;
    case "call":
    case "ret":
      return 3;
    case "syscall":
      return 8;
    case "print":
      return (
        8 +
        (typeof instruction.source === "string"
          ? Math.ceil(instruction.source.length / 4)
          : 1)
      );
    default:
      return 1;
  }
}
