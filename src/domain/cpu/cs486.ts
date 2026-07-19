import { computerNominalClockHz } from "./timing.js";
import { instructionCycleCost } from "./instructionTiming.js";
import {
  cs486RegisterNames,
  type Cs486Instruction,
  type Cs486Operand,
  type Cs486Register,
} from "./instructionSet.js";
import {
  cpuModelSpecification,
  defaultCpuModel,
  type CpuModel,
} from "./models.js";
import {
  CpuMemoryHierarchy,
  type CpuMicroarchitectureStats,
} from "./memoryHierarchy.js";
import {
  isTerminalCpuProcessState,
  type CpuProcess,
  type CpuProcessSliceResult,
  type CpuProcessState,
} from "../runtime/cpuProcess.js";
import { VmRuntimeError } from "../runtime/errors.js";
import type { RuntimeValue } from "../runtime/value.js";

export const cs486NominalClockHz = computerNominalClockHz;

export { cs486RegisterNames };
export type { Cs486Instruction, Cs486Operand, Cs486Register };

/** The bounded function ABI carried by v2 and v3 symbol metadata. */
export type Cs486FunctionSignature = "()->i32" | "()->void";

export const cs486Flat32AlignmentBytes = 4;
export const defaultCs486StackBytes = 64 * 1_024;
export const maximumCs486LinearAddressSpaceBytes = 16 * 1_048_576;
export const maximumCs486AuxiliaryResidentBytes = 16 * 1_048_576;

export interface Cs486Flat32MemoryMetadata {
  readonly auxiliaryResidentBytes: number;
  readonly heapBytes: number;
  readonly model: "cs-flat32-v1";
  readonly stackBytes: number;
}

interface Cs486ExecutableBase {
  readonly dataBytes?: number;
  readonly format: "cs486-executable";
  readonly initialData?: readonly {
    readonly bytes: readonly number[];
    readonly offset: number;
  }[];
  readonly instructions: readonly Cs486Instruction[];
  readonly symbols?: readonly {
    readonly address: number;
    readonly functionSignature?: Cs486FunctionSignature;
    readonly name: string;
    readonly section?: "bss" | "data" | "rodata" | "text";
    readonly type?: "function" | "notype" | "object";
  }[];
}

export interface Cs486LegacyExecutable extends Cs486ExecutableBase {
  readonly memory?: never;
  readonly version: 1 | 2;
}

export interface Cs486ExecutableV3 extends Cs486ExecutableBase {
  readonly memory: Cs486Flat32MemoryMetadata;
  readonly version: 3;
}

export type Cs486Executable = Cs486LegacyExecutable | Cs486ExecutableV3;

export type Cs486ExecutableMemoryRequirements =
  | {
      readonly kind: "legacy";
      readonly version: 1 | 2;
    }
  | {
      readonly alignedDataBytes: number;
      readonly auxiliaryResidentBytes: number;
      readonly heapBytes: number;
      readonly kind: "declared";
      readonly linearAddressSpaceBytes: number;
      readonly model: "cs-flat32-v1";
      readonly physicalReservationBytes: number;
      readonly stackBytes: number;
      readonly version: 3;
    };

export function createCs486Flat32MemoryMetadata(
  options: {
    readonly auxiliaryResidentBytes?: number;
    readonly heapBytes?: number;
    readonly stackBytes?: number;
  } = {},
): Cs486Flat32MemoryMetadata {
  const metadata: Cs486Flat32MemoryMetadata = {
    auxiliaryResidentBytes: options.auxiliaryResidentBytes ?? 0,
    heapBytes: options.heapBytes ?? 0,
    model: "cs-flat32-v1",
    stackBytes: options.stackBytes ?? defaultCs486StackBytes,
  };
  validateCs486Flat32MemoryMetadata(metadata);
  return Object.freeze(metadata);
}

export interface Cs486RunResult {
  readonly cycles: number;
  readonly executedInstructions: number;
  readonly output: string;
  readonly registers: Readonly<Record<Cs486Register, number>>;
  readonly state: "halted" | "yielded";
  readonly microarchitecture: CpuMicroarchitectureStats;
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
const maximumInspectionBytes = 4_096;

export function runCs486(
  executable: Cs486Executable,
  options: {
    readonly cpuModel?: CpuModel;
    readonly memoryBytes: number;
    readonly instructionLimit?: number;
  },
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
    microarchitecture: process.microarchitectureStats,
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
  private readonly cpuModel: CpuModel;
  private readonly memoryHierarchy: CpuMemoryHierarchy;
  private readonly memoryBytes: number;
  private readonly stackFloorBytes: number;
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
      readonly cpuModel?: CpuModel;
      readonly memoryBytes: number;
      readonly syscallHandler?: Cs486SyscallHandler;
    },
  ) {
    const requirements = cs486ExecutableMemoryRequirements(executable);
    this.cpuModel = options.cpuModel ?? defaultCpuModel;
    this.memoryHierarchy = new CpuMemoryHierarchy(this.cpuModel);
    const availableMemoryBytes = Math.min(
      options.memoryBytes,
      maximumCs486LinearAddressSpaceBytes,
      cpuModelSpecification(this.cpuModel).maximumMemoryBytes,
    );
    if (
      requirements.kind === "declared" &&
      availableMemoryBytes < requirements.linearAddressSpaceBytes
    )
      throw new Cs486Fault(
        "MemoryAccessError",
        "executable linear memory requirement exceeds available RAM",
      );
    if (
      !Number.isSafeInteger(availableMemoryBytes) ||
      availableMemoryBytes < defaultCs486StackBytes
    )
      throw new RangeError("CS486 requires at least 64 KiB RAM");
    this.memoryBytes =
      requirements.kind === "declared"
        ? requirements.linearAddressSpaceBytes
        : availableMemoryBytes;
    if ((executable.dataBytes ?? 0) > this.memoryBytes)
      throw new Cs486Fault(
        "MemoryAccessError",
        "executable data exceeds available RAM",
      );
    this.stackFloorBytes =
      requirements.kind === "declared"
        ? requirements.alignedDataBytes + requirements.heapBytes
        : alignCs486Flat32(executable.dataBytes ?? 0);
    this.memory = new DataView(new ArrayBuffer(this.memoryBytes));
    for (const segment of executable.initialData ?? [])
      new Uint8Array(this.memory.buffer).set(segment.bytes, segment.offset);
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

  /** Current zero-based instruction address for read-only debugger inspection. */
  get instructionAddress(): number {
    return this.instructionPointer;
  }

  /**
   * Returns a bounded copy of guest RAM. The copy prevents debugger consumers
   * from mutating process memory outside validated CS486 instructions.
   */
  inspectMemory(address: number, length: number): Uint8Array {
    if (!Number.isSafeInteger(address) || address < 0)
      throw new RangeError("memory inspection address must be non-negative");
    if (
      !Number.isSafeInteger(length) ||
      length <= 0 ||
      length > maximumInspectionBytes
    )
      throw new RangeError(
        `memory inspection length must be between 1 and ${String(maximumInspectionBytes)}`,
      );
    if (address > this.memoryBytes - length)
      throw new RangeError("memory inspection is outside RAM");
    return new Uint8Array(this.memory.buffer, address, length).slice();
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

  get microarchitectureStats(): CpuMicroarchitectureStats {
    return this.memoryHierarchy.stats;
  }

  get hasPendingCpuCycles(): boolean {
    return this.cycleDebt > 0;
  }

  /**
   * Pays only cycle debt already incurred by the current instruction.
   *
   * Scheduler adapters use this boundary when they must observe breakpoints or
   * cancellation before allowing the next instruction to start. The operation
   * is O(1) regardless of the number of cycles paid.
   */
  drainPendingCpuCycles(cpuCycleBudget: number): number {
    if (!Number.isSafeInteger(cpuCycleBudget) || cpuCycleBudget <= 0)
      throw new RangeError("CPU cycle budget must be a positive safe integer");
    const paid = Math.min(this.cycleDebt, cpuCycleBudget);
    this.cycleDebt -= paid;
    return paid;
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
      if (executedInstructions >= instructionBudget) break;
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
    const instructionIndex = this.instructionPointer;
    const instruction = this.executable.instructions[instructionIndex];
    if (instruction === undefined) {
      if (instructionIndex === this.executable.instructions.length) {
        this.complete();
        return undefined;
      }
      throw new Cs486Fault(
        "ExecutableFormatError",
        `instruction pointer ${String(instructionIndex)} is outside executable range 0..${String(this.executable.instructions.length)}`,
      );
    }
    this.instructionPointer += 1;
    const branchTaken = this.branchTaken(instruction);
    let cycles =
      instructionCycleCost(this.cpuModel, instruction, {
        branchTaken,
        multiplier:
          instruction.op === "mul" ? this.read(instruction.source) : undefined,
      }) + this.memoryHierarchy.fetchInstruction(instructionIndex);
    this.memoryHierarchy.recordControlTransfer(
      branchTaken === true ||
        instruction.op === "call" ||
        instruction.op === "ret",
    );
    switch (instruction.op) {
      case "mov":
        this.write(instruction.destination, this.read(instruction.source));
        break;
      case "load": {
        const address = this.address(instruction.address);
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.write(
          instruction.destination,
          this.memory.getInt32(address, true),
        );
        break;
      }
      case "store": {
        const address = this.address(instruction.address);
        cycles += this.memoryHierarchy.accessData(address, "write");
        this.memory.setInt32(
          address,
          this.readRegister(instruction.source),
          true,
        );
        break;
      }
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
        cycles += this.push(this.read(instruction.source));
        break;
      case "pop": {
        const popped = this.pop();
        cycles += popped.cycles;
        this.write(instruction.destination, popped.value);
        break;
      }
      case "call": {
        cycles += this.push(this.instructionPointer);
        this.instructionPointer = instruction.target;
        break;
      }
      case "ret": {
        const popped = this.pop();
        cycles += popped.cycles;
        this.instructionPointer = this.checkedInstructionTarget(popped.value);
        break;
      }
      case "syscall": {
        const handler = this.options.syscallHandler;
        if (handler === undefined)
          throw new Cs486Fault(
            "UnsupportedError",
            `syscall ${instruction.name} is unavailable`,
          );
        let syscallMemoryCycles = 0;
        const result = handler(instruction.name, {
          memoryLimitBytes: this.memoryBytes,
          readInt32: (address) => {
            address = this.checkedAddress(address);
            syscallMemoryCycles += this.memoryHierarchy.accessData(
              address,
              "read",
            );
            return this.memory.getInt32(address, true);
          },
          readRegister: (register) => this.readRegister(register),
          writeInt32: (address, value) => {
            address = this.checkedAddress(address);
            syscallMemoryCycles += this.memoryHierarchy.accessData(
              address,
              "write",
            );
            this.memory.setInt32(address, value | 0, true);
          },
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
        const transitionCycles = this.applySyscallResult(result);
        return cycles + extraCycles + syscallMemoryCycles + transitionCycles;
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

  private branchTaken(instruction: Cs486Instruction): boolean | undefined {
    switch (instruction.op) {
      case "jmp":
        return true;
      case "je":
        return this.compared === 0;
      case "jne":
        return this.compared !== 0;
      case "jl":
        return this.compared < 0;
      case "jle":
        return this.compared <= 0;
      case "jg":
        return this.compared > 0;
      case "jge":
        return this.compared >= 0;
      default:
        return undefined;
    }
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

  private applySyscallResult(result: Cs486SyscallResult): number {
    switch (result.kind) {
      case "continue":
        return 0;
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
        this.memoryHierarchy.recordControlTransfer(true);
        return 0;
      case "call": {
        if (
          !Number.isSafeInteger(result.target) ||
          result.target < 0 ||
          result.target >= this.executable.instructions.length
        )
          throw new Cs486Fault(
            "ExecutableFormatError",
            "invalid syscall call target",
          );
        this.memoryHierarchy.recordControlTransfer(true);
        const callCycles = this.push(this.instructionPointer);
        this.instructionPointer = result.target;
        return callCycles;
      }
      case "return": {
        this.memoryHierarchy.recordControlTransfer(true);
        const popped = this.pop();
        this.instructionPointer = this.checkedInstructionTarget(popped.value);
        return popped.cycles;
      }
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
        return 0;
      case "wait_event":
        this.pendingResume = result.resume;
        this.stateValue = { kind: "waiting_event", filter: result.filter };
        return 0;
      case "complete":
        this.pendingResume = undefined;
        this.stateValue = { kind: "completed", value: result.value };
        return 0;
    }
  }

  private push(value: number): number {
    const next = this.readRegister("esp") - 4;
    if (next < this.stackFloorBytes || next + 4 > this.memoryBytes)
      throw new Cs486Fault("StackOverflowError", "stack overflow");
    const cycles = this.memoryHierarchy.accessData(next, "write");
    this.memory.setInt32(next, value, true);
    this.write("esp", next);
    return cycles;
  }

  private pop(): { readonly cycles: number; readonly value: number } {
    const current = this.readRegister("esp");
    if (current < this.stackFloorBytes)
      throw new Cs486Fault("StackOverflowError", "stack overflow");
    if (current + 4 > this.memoryBytes)
      throw new Cs486Fault("StackUnderflowError", "stack underflow");
    const cycles = this.memoryHierarchy.accessData(current, "read");
    const value = this.memory.getInt32(current, true);
    this.write("esp", current + 4);
    return { cycles, value };
  }

  private checkedInstructionTarget(value: number): number {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value >= this.executable.instructions.length
    )
      throw new Cs486Fault(
        "ExecutableFormatError",
        this.executable.instructions.length === 0
          ? `instruction pointer ${String(value)} cannot target empty executable text`
          : `instruction pointer ${String(value)} is outside executable instruction range 0..${String(this.executable.instructions.length - 1)}`,
      );
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
  const candidate = value as {
    readonly dataBytes?: unknown;
    readonly format?: unknown;
    readonly initialData?: unknown;
    readonly instructions?: unknown;
    readonly memory?: unknown;
    readonly symbols?: unknown;
    readonly version?: unknown;
  };
  if (
    candidate.format !== "cs486-executable" ||
    (candidate.version !== 1 &&
      candidate.version !== 2 &&
      candidate.version !== 3) ||
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
      (candidate.dataBytes as number) < 0 ||
      (candidate.dataBytes as number) > maximumCs486LinearAddressSpaceBytes)
  )
    throw new Cs486Fault("ExecutableFormatError", "invalid data size");
  if (candidate.version === 3) {
    validateCs486Flat32MemoryMetadata(candidate.memory);
    flat32MemoryRequirements(
      candidate.dataBytes === undefined ? 0 : (candidate.dataBytes as number),
      candidate.memory,
    );
  } else if (candidate.memory !== undefined) {
    throw new Cs486Fault(
      "ExecutableFormatError",
      "legacy executable cannot declare memory metadata",
    );
  }
  if (
    candidate.version === 1
      ? candidate.initialData !== undefined
      : candidate.initialData !== undefined &&
        !isValidInitialData(
          candidate.initialData,
          candidate.dataBytes === undefined
            ? 0
            : (candidate.dataBytes as number),
        )
  )
    throw new Cs486Fault("ExecutableFormatError", "invalid initial data");
  if (
    candidate.symbols !== undefined &&
    (!Array.isArray(candidate.symbols) ||
      candidate.symbols.length > 2_048 ||
      (candidate.symbols as readonly unknown[]).some((value) => {
        if (typeof value !== "object" || value === null) return true;
        const symbol = value as {
          readonly address?: unknown;
          readonly functionSignature?: unknown;
          readonly name?: unknown;
          readonly section?: unknown;
          readonly type?: unknown;
        };
        const section = symbol.section ?? "text";
        return (
          typeof symbol.name !== "string" ||
          !/^[A-Za-z_.$@?][A-Za-z0-9_.$@?]*$/u.test(symbol.name) ||
          !Number.isSafeInteger(symbol.address) ||
          (symbol.address as number) < 0 ||
          (section !== "text" &&
            section !== "rodata" &&
            section !== "data" &&
            section !== "bss") ||
          (symbol.type !== undefined &&
            symbol.type !== "function" &&
            symbol.type !== "notype" &&
            symbol.type !== "object") ||
          (symbol.functionSignature !== undefined &&
            (candidate.version === 1 ||
              symbol.type !== "function" ||
              (symbol.functionSignature !== "()->i32" &&
                symbol.functionSignature !== "()->void"))) ||
          (section === "text"
            ? (symbol.address as number) >=
              (candidate.instructions as readonly unknown[]).length
            : (symbol.address as number) >=
              (candidate.dataBytes === undefined
                ? 0
                : (candidate.dataBytes as number))) ||
          (candidate.version === 1 &&
            (symbol.section !== undefined ||
              symbol.type !== undefined ||
              symbol.functionSignature !== undefined))
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

export function cs486ExecutableMemoryRequirements(
  value: unknown,
): Cs486ExecutableMemoryRequirements {
  validateCs486Executable(value);
  if (value.version !== 3)
    return Object.freeze({ kind: "legacy", version: value.version });
  const requirements = flat32MemoryRequirements(
    value.dataBytes ?? 0,
    value.memory,
  );
  return Object.freeze({
    ...requirements,
    kind: "declared",
    model: value.memory.model,
    version: 3,
  });
}

function validateCs486Flat32MemoryMetadata(
  value: unknown,
): asserts value is Cs486Flat32MemoryMetadata {
  if (typeof value !== "object" || value === null)
    throw new Cs486Fault(
      "ExecutableFormatError",
      "missing cs-flat32-v1 memory metadata",
    );
  const candidate = value as {
    readonly auxiliaryResidentBytes?: unknown;
    readonly heapBytes?: unknown;
    readonly model?: unknown;
    readonly stackBytes?: unknown;
  };
  if (candidate.model !== "cs-flat32-v1")
    throw new Cs486Fault(
      "ExecutableFormatError",
      "unsupported executable memory model",
    );
  if (
    !isBoundedMemorySize(
      candidate.stackBytes,
      maximumCs486LinearAddressSpaceBytes,
    ) ||
    candidate.stackBytes <= 0 ||
    candidate.stackBytes % cs486Flat32AlignmentBytes !== 0
  )
    throw new Cs486Fault(
      "ExecutableFormatError",
      "invalid or unaligned cs-flat32 stack size",
    );
  if (
    !isBoundedMemorySize(
      candidate.heapBytes,
      maximumCs486LinearAddressSpaceBytes,
    ) ||
    candidate.heapBytes % cs486Flat32AlignmentBytes !== 0
  )
    throw new Cs486Fault(
      "ExecutableFormatError",
      "invalid or unaligned cs-flat32 heap size",
    );
  if (
    !isBoundedMemorySize(
      candidate.auxiliaryResidentBytes,
      maximumCs486AuxiliaryResidentBytes,
    )
  )
    throw new Cs486Fault(
      "ExecutableFormatError",
      "invalid auxiliary resident size",
    );
}

function flat32MemoryRequirements(
  dataBytes: number,
  memory: Cs486Flat32MemoryMetadata,
): Omit<
  Extract<Cs486ExecutableMemoryRequirements, { readonly kind: "declared" }>,
  "kind" | "model" | "version"
> {
  const alignedDataBytes = alignCs486Flat32(dataBytes);
  const declaredLinearBytes = checkedMemorySum(
    [alignedDataBytes, memory.heapBytes, memory.stackBytes],
    "linear address-space size overflow",
  );
  const linearAddressSpaceBytes = Math.max(
    defaultCs486StackBytes,
    declaredLinearBytes,
  );
  if (linearAddressSpaceBytes > maximumCs486LinearAddressSpaceBytes)
    throw new Cs486Fault(
      "ExecutableFormatError",
      "cs-flat32 linear address-space limit exceeded",
    );
  const physicalReservationBytes = checkedMemorySum(
    [linearAddressSpaceBytes, memory.auxiliaryResidentBytes],
    "physical reservation size overflow",
  );
  return {
    alignedDataBytes,
    auxiliaryResidentBytes: memory.auxiliaryResidentBytes,
    heapBytes: memory.heapBytes,
    linearAddressSpaceBytes,
    physicalReservationBytes,
    stackBytes: memory.stackBytes,
  };
}

function checkedMemorySum(values: readonly number[], message: string): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value))
      throw new Cs486Fault("ExecutableFormatError", message);
    total += value;
  }
  return total;
}

function isBoundedMemorySize(value: unknown, maximum: number): value is number {
  return (
    Number.isSafeInteger(value) &&
    (value as number) >= 0 &&
    (value as number) <= maximum
  );
}

function alignCs486Flat32(value: number): number {
  const remainder = value % cs486Flat32AlignmentBytes;
  return remainder === 0
    ? value
    : value + cs486Flat32AlignmentBytes - remainder;
}

function isValidInitialData(value: unknown, dataBytes: number): boolean {
  if (!Array.isArray(value) || value.length > 256) return false;
  let previousEnd = 0;
  let totalBytes = 0;
  for (const candidate of value as readonly unknown[]) {
    if (typeof candidate !== "object" || candidate === null) return false;
    const segment = candidate as {
      readonly bytes?: unknown;
      readonly offset?: unknown;
    };
    if (
      !Number.isSafeInteger(segment.offset) ||
      (segment.offset as number) < previousEnd ||
      !Array.isArray(segment.bytes) ||
      segment.bytes.some(
        (byte) => !Number.isSafeInteger(byte) || byte < 0 || byte > 255,
      ) ||
      (segment.offset as number) + segment.bytes.length > dataBytes
    )
      return false;
    previousEnd = (segment.offset as number) + segment.bytes.length;
    totalBytes += segment.bytes.length;
    if (totalBytes > 256_000) return false;
  }
  return true;
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
