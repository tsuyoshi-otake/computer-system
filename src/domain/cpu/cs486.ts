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
import {
  cs486FormatLimits,
  type Cs486FormatLimits,
} from "./cs486FormatLimits.js";
import {
  cs486Word32DataModel,
  isCs486DataModel,
  isSupportedCs486ExecutableVersion,
  type Cs486DataModel,
} from "./cs486Compatibility.js";
import {
  csFloatAbs,
  csFloatAdd,
  csFloatCeil,
  csFloatClassify,
  csFloatCompare,
  csFloatConvert,
  csFloatCopySign,
  csFloatDivide,
  csFloatFloor,
  csFloatFrexp,
  csFloatFromSignedInteger,
  csFloatFromUnsignedInteger,
  csFloatLdexp,
  csFloatModf,
  csFloatMultiply,
  csFloatNegate,
  csFloatRemainder,
  csFloatRound,
  csFloatSignBit,
  csFloatSqrt,
  csFloatSubtract,
  csFloatToFixedDecimal,
  csFloatToSignedInteger,
  csFloatToUnsignedInteger,
  csFloatTrunc,
  type CsFloatComparison,
  type CsFloatFormat,
  type CsFloatResult,
} from "./deterministicFloat.js";

export const cs486NominalClockHz = computerNominalClockHz;

export { cs486RegisterNames };
export type { Cs486Instruction, Cs486Operand, Cs486Register };

export type Cs486FunctionValueType = "f32" | "f64" | "i32" | "i64";
export type Cs486FunctionReturnType = Cs486FunctionValueType | "void";

/**
 * The bounded `cs486-cc2` function ABI carried by symbol metadata. Runtime
 * validation is authoritative because the template type intentionally keeps
 * serialized signatures ergonomic for callers.
 */
export type Cs486FunctionSignature =
  | `(${string})->f32`
  | `(${string})->f64`
  | `(${string})->i32`
  | `(${string})->i64`
  | `(${string})->void`;

export interface Cs486ParsedFunctionSignature {
  readonly parameterTypes: readonly Cs486FunctionValueType[];
  readonly returnType: Cs486FunctionReturnType;
  readonly variadic: boolean;
}

export interface Cs486FunctionEntry {
  readonly address: number;
  readonly functionSignature: Cs486FunctionSignature;
}

export const maximumCs486FunctionParameters = 32;
const maximumCs486FunctionSignatureCharacters = 192;

/** Parses only the canonical bounded ABI spelling, never aliases or whitespace. */
export function parseCs486FunctionSignature(
  value: unknown,
): Cs486ParsedFunctionSignature | undefined {
  if (
    typeof value !== "string" ||
    value.length > maximumCs486FunctionSignatureCharacters ||
    !value.startsWith("(")
  )
    return undefined;
  const separator = value.indexOf(")->");
  if (separator < 1 || value.indexOf(")->", separator + 3) >= 0)
    return undefined;
  const returnType = value.slice(separator + 3);
  if (!isCs486FunctionReturnType(returnType)) return undefined;
  let parameterText = value.slice(1, separator);
  const variadic = parameterText === "..." || parameterText.endsWith(",...");
  if (variadic)
    parameterText = parameterText === "..." ? "" : parameterText.slice(0, -4);
  else if (parameterText.includes("...")) return undefined;
  const parameterTypes =
    parameterText.length === 0 ? [] : parameterText.split(",");
  if (
    parameterTypes.length > maximumCs486FunctionParameters ||
    parameterTypes.some((type) => !isCs486FunctionValueType(type)) ||
    parameterTypes.reduce(
      (words, type) =>
        words + cs486FunctionValueWordCount(type as Cs486FunctionValueType),
      0,
    ) > maximumCs486FunctionParameters
  )
    return undefined;
  return {
    parameterTypes: parameterTypes as Cs486FunctionValueType[],
    returnType,
    variadic,
  };
}

export function isCs486FunctionSignature(
  value: unknown,
  allowParameters = true,
): value is Cs486FunctionSignature {
  const parsed = parseCs486FunctionSignature(value);
  return (
    parsed !== undefined &&
    (allowParameters ||
      (parsed.parameterTypes.length === 0 && !parsed.variadic))
  );
}

export function createCs486FunctionSignature(
  parameterTypes: readonly Cs486FunctionValueType[],
  returnType: Cs486FunctionReturnType,
  variadic = false,
): Cs486FunctionSignature {
  if (
    parameterTypes.length > maximumCs486FunctionParameters ||
    parameterTypes.some((type) => !isCs486FunctionValueType(type)) ||
    parameterTypes.reduce(
      (words, type) => words + cs486FunctionValueWordCount(type),
      0,
    ) > maximumCs486FunctionParameters ||
    !isCs486FunctionReturnType(returnType)
  )
    throw new RangeError("invalid CS486 function signature");
  const parameters = [
    ...parameterTypes,
    ...(variadic ? (["..."] as const) : []),
  ].join(",");
  return `(${parameters})->${returnType}`;
}

export function cs486FunctionValueWordCount(
  type: Cs486FunctionValueType,
): 1 | 2 {
  return type === "f64" || type === "i64" ? 2 : 1;
}

export function cs486FunctionSignatureUsesFloat(
  value: Cs486FunctionSignature,
): boolean {
  const parsed = parseCs486FunctionSignature(value);
  return (
    parsed !== undefined &&
    (parsed.returnType === "f32" ||
      parsed.returnType === "f64" ||
      parsed.parameterTypes.some((type) => type === "f32" || type === "f64"))
  );
}

function isCs486FunctionValueType(
  value: string,
): value is Cs486FunctionValueType {
  return (
    value === "f32" || value === "f64" || value === "i32" || value === "i64"
  );
}

function isCs486FunctionReturnType(
  value: string,
): value is Cs486FunctionReturnType {
  return value === "void" || isCs486FunctionValueType(value);
}

function isFloatComparison(value: string): value is CsFloatComparison {
  return (
    value === "eq" ||
    value === "ge" ||
    value === "gt" ||
    value === "le" ||
    value === "lt" ||
    value === "ne"
  );
}

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
  readonly dataModel?: Cs486DataModel;
  readonly format: "cs486-executable";
  /** Admitted function-entry capabilities used by validated indirect calls. */
  readonly functionEntries?: readonly Cs486FunctionEntry[];
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

export interface Cs486ExecutableV4 extends Cs486ExecutableBase {
  readonly memory: Cs486Flat32MemoryMetadata;
  readonly version: 4;
}

export interface Cs486ExecutableV5 extends Cs486ExecutableBase {
  readonly dataModel: Cs486DataModel;
  readonly memory: Cs486Flat32MemoryMetadata;
  readonly version: 5;
}

export interface Cs486ExecutableV6 extends Cs486ExecutableBase {
  readonly dataModel: Cs486DataModel;
  readonly memory: Cs486Flat32MemoryMetadata;
  readonly version: 6;
}

export type Cs486StructuredExecutable =
  Cs486ExecutableV3 | Cs486ExecutableV4 | Cs486ExecutableV5 | Cs486ExecutableV6;
export type Cs486Executable = Cs486LegacyExecutable | Cs486StructuredExecutable;

export function cs486ExecutableDataModel(
  executable: Cs486Executable,
): Cs486DataModel {
  return executable.version === 5 || executable.version === 6
    ? executable.dataModel
    : cs486Word32DataModel;
}

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
      readonly version: 3 | 4 | 5 | 6;
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

interface Cs486RunResultBase {
  readonly cycles: number;
  readonly executedInstructions: number;
  readonly output: string;
  readonly registers: Readonly<Record<Cs486Register, number>>;
  readonly state: "halted" | "yielded";
}

export interface Cs486RunResult extends Cs486RunResultBase {
  readonly microarchitecture: CpuMicroarchitectureStats;
}

export interface Cs486RunResultWithoutMicroarchitectureStats extends Cs486RunResultBase {
  readonly microarchitecture: null;
}

export type Cs486RunObservation =
  Cs486RunResult | Cs486RunResultWithoutMicroarchitectureStats;

export interface Cs486RunOptions {
  readonly collectMicroarchitectureStats?: boolean;
  readonly cpuModel?: CpuModel;
  readonly memoryBytes: number;
  readonly instructionLimit?: number;
  readonly processImage?: Cs486ProcessImageInitialization;
  readonly syscallHandler?: Cs486SyscallHandler;
}

export interface Cs486SyscallContext {
  readonly dataModel?: Cs486DataModel;
  readonly memoryLimitBytes: number;
  readInt32(address: number): number;
  readUint8?(address: number): number;
  readRegister(register: Cs486Register): number;
  writeInt32(address: number, value: number): void;
  writeUint8?(address: number, value: number): void;
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

export interface Cs486ProcessImageInitialization {
  readonly segments: readonly {
    readonly address: number;
    /** Packed bytes take precedence and require an empty word list. */
    readonly bytes?: readonly number[];
    readonly words: readonly number[];
  }[];
  /** C calling-convention order; the process pushes these right-to-left. */
  readonly stackArguments: readonly number[];
}

export class Cs486Fault extends Error {
  constructor(
    readonly typeName: string,
    message: string,
  ) {
    super(message);
    this.name = typeName;
  }
}

const maximumOutputBytes = 64_000;
const maximumInspectionBytes = 4_096;
const minimumHotBurstInstructions = 8;

interface Cs486HotBurstResult {
  readonly cpuCycles: number;
  readonly executedInstructions: number;
  /**
   * True when the next instruction belongs to the faulting, memory, stack,
   * syscall, output, or lifecycle path still owned by executeNext().
   */
  readonly stoppedOnColdInstruction: boolean;
}

export function runCs486(
  executable: Cs486Executable,
  options: Omit<Cs486RunOptions, "collectMicroarchitectureStats"> & {
    readonly collectMicroarchitectureStats: false;
  },
): Cs486RunResultWithoutMicroarchitectureStats;
export function runCs486(
  executable: Cs486Executable,
  options: Omit<Cs486RunOptions, "collectMicroarchitectureStats"> & {
    readonly collectMicroarchitectureStats: boolean;
  },
): Cs486RunObservation;
export function runCs486(
  executable: Cs486Executable,
  options: Omit<Cs486RunOptions, "collectMicroarchitectureStats"> & {
    readonly collectMicroarchitectureStats?: true;
  },
): Cs486RunResult;
export function runCs486(
  executable: Cs486Executable,
  options: Cs486RunOptions,
): Cs486RunObservation {
  const instructionLimit = options.instructionLimit ?? 100_000;
  if (!Number.isSafeInteger(instructionLimit) || instructionLimit <= 0)
    throw new RangeError("CS486 instruction limit must be positive");
  const process = new Cs486Process(executable, options);
  if (options.processImage !== undefined)
    process.initializeProcessImage(options.processImage);
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
    microarchitecture: process.microarchitectureStatsEnabled
      ? process.microarchitectureStats
      : null,
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
  private readonly instructionBaseCycles: Uint32Array;
  private readonly instructionBranchCycleDeltas: Uint8Array;
  private readonly instructionExecutionFlags: Uint8Array;
  private readonly hasHotBurstEntries: boolean;
  private readonly instructionHotBurstEntries: Uint8Array;
  private readonly instructionOpcodes: Uint8Array;
  private readonly instructionOperandA: Int32Array;
  private readonly instructionOperandB: Int32Array;
  private readonly memoryBytes: number;
  private readonly heapBaseBytes: number;
  private readonly functionEntries = new Map<number, Cs486FunctionSignature>();
  private readonly stackFloorBytes: number;
  private processImageInitialized = false;
  private stateValue: CpuProcessState = { kind: "ready" };
  private instructionPointer = 0;
  private compared = 0;
  private cycleDebt = 0;
  private tick = 0;
  private outputValue = "";
  private pendingResume: ((value: RuntimeValue) => void) | undefined;
  private lastFloatStatus = 0;

  constructor(
    private readonly executable: Cs486Executable,
    private readonly options: {
      readonly collectMicroarchitectureStats?: boolean;
      readonly externalMemoryUsageBytes?: () => number;
      readonly cpuModel?: CpuModel;
      readonly memoryBytes: number;
      readonly syscallHandler?: Cs486SyscallHandler;
    },
  ) {
    const requirements = cs486ExecutableMemoryRequirements(executable);
    this.cpuModel = options.cpuModel ?? defaultCpuModel;
    this.memoryHierarchy = new CpuMemoryHierarchy(this.cpuModel, {
      collectMicroarchitectureStats:
        options.collectMicroarchitectureStats ?? true,
    });
    const preparedSemantics = prepareCs486SemanticInstructions(executable);
    const preparedTiming = prepareCs486InstructionTiming(
      executable,
      this.cpuModel,
    );
    this.instructionBaseCycles = preparedTiming.baseCycles;
    this.instructionBranchCycleDeltas = preparedTiming.branchCycleDeltas;
    this.instructionExecutionFlags = preparedSemantics.executionFlags;
    this.hasHotBurstEntries = preparedSemantics.hasHotBurstEntries;
    this.instructionHotBurstEntries = preparedSemantics.hotBurstEntries;
    this.instructionOpcodes = preparedSemantics.opcodes;
    this.instructionOperandA = preparedSemantics.operandA;
    this.instructionOperandB = preparedSemantics.operandB;
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
    this.heapBaseBytes =
      requirements.kind === "declared"
        ? requirements.alignedDataBytes
        : this.stackFloorBytes;
    this.memory = new DataView(new ArrayBuffer(this.memoryBytes));
    for (const entry of executable.functionEntries ?? [])
      this.functionEntries.set(entry.address, entry.functionSignature);
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
   * Atomically installs an admitted application-owned startup image before the
   * first instruction executes. Segments may occupy only declared heap memory.
   */
  initializeProcessImage(image: Cs486ProcessImageInitialization): void {
    if (
      this.processImageInitialized ||
      this.instructionPointer !== 0 ||
      this.stateValue.kind !== "ready"
    ) {
      throw new Cs486Fault(
        "ProcessStateError",
        "CS486 process image is no longer initializable",
      );
    }
    if (image.segments.length > 32 || image.stackArguments.length > 32) {
      throw new Cs486Fault(
        "ResourceLimitError",
        "CS486 process image entry limit exceeded",
      );
    }
    let initializedBytes = 0;
    const ranges: { readonly end: number; readonly start: number }[] = [];
    for (const segment of image.segments) {
      if (
        !Number.isSafeInteger(segment.address) ||
        segment.address < 0 ||
        (segment.bytes === undefined && segment.address % 4 !== 0)
      ) {
        throw new Cs486Fault(
          "MemoryAccessError",
          "CS486 process image address is invalid or unaligned",
        );
      }
      if (segment.bytes !== undefined && segment.words.length !== 0)
        throw new Cs486Fault(
          "ValueError",
          "CS486 process image segment cannot mix words and bytes",
        );
      const segmentBytes =
        segment.bytes === undefined
          ? segment.words.length * 4
          : segment.bytes.length;
      initializedBytes += segmentBytes;
      if (initializedBytes > 32 * 1_024) {
        throw new Cs486Fault(
          "ResourceLimitError",
          "CS486 process image byte limit exceeded",
        );
      }
      const end = segment.address + segmentBytes;
      if (
        !Number.isSafeInteger(end) ||
        segment.address < this.heapBaseBytes ||
        end > this.stackFloorBytes
      ) {
        throw new Cs486Fault(
          "MemoryAccessError",
          "CS486 process image is outside declared heap memory",
        );
      }
      if (segment.bytes === undefined) {
        for (const word of segment.words) {
          if (
            !Number.isInteger(word) ||
            word < -0x80_00_00_00 ||
            word > 0xff_ff_ff_ff
          )
            throw new Cs486Fault(
              "ValueError",
              "CS486 process image contains an invalid word",
            );
        }
      } else if (
        segment.bytes.some(
          (byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff,
        )
      ) {
        throw new Cs486Fault(
          "ValueError",
          "CS486 process image contains an invalid byte",
        );
      }
      ranges.push({ end, start: segment.address });
    }
    ranges.sort((left, right) => left.start - right.start);
    for (let index = 1; index < ranges.length; index += 1) {
      if (ranges[index]!.start < ranges[index - 1]!.end) {
        throw new Cs486Fault(
          "MemoryAccessError",
          "CS486 process image segments overlap",
        );
      }
    }
    const nextStack = this.memoryBytes - image.stackArguments.length * 4;
    if (nextStack < this.stackFloorBytes) {
      throw new Cs486Fault(
        "StackOverflowError",
        "CS486 startup arguments exceed the declared stack",
      );
    }
    for (const argument of image.stackArguments) {
      if (!Number.isInteger(argument)) {
        throw new Cs486Fault(
          "ValueError",
          "CS486 startup argument is not an integer word",
        );
      }
    }

    for (const segment of image.segments) {
      if (segment.bytes === undefined)
        for (const [index, word] of segment.words.entries())
          this.memory.setInt32(segment.address + index * 4, word | 0, true);
      else
        for (const [index, byte] of segment.bytes.entries())
          this.memory.setUint8(segment.address + index, byte);
    }
    let stack = this.memoryBytes;
    for (let index = image.stackArguments.length - 1; index >= 0; index -= 1) {
      stack -= 4;
      this.memory.setInt32(stack, image.stackArguments[index]! | 0, true);
    }
    this.write("esp", stack);
    this.processImageInitialized = true;
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

  get microarchitectureStatsEnabled(): boolean {
    return this.memoryHierarchy.statsEnabled;
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
    return this.hasHotBurstEntries
      ? this.runCpuSliceWithHotBurst(cpuCycleBudget, instructionBudget)
      : this.runCpuSliceWithoutHotBurst(cpuCycleBudget, instructionBudget);
  }

  private runCpuSliceWithHotBurst(
    cpuCycleBudget: number,
    instructionBudget: number,
  ): CpuProcessSliceResult {
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
      if (this.instructionHotBurstEntries[this.instructionPointer] === 1) {
        const hotBurst = this.runHotCpuBurst(
          cpuCycleBudget - cpuCycles,
          instructionBudget - executedInstructions,
        );
        cpuCycles += hotBurst.cpuCycles;
        executedInstructions += hotBurst.executedInstructions;
        if (!hotBurst.stoppedOnColdInstruction) continue;
      }
      try {
        const cycles = this.executeNext();
        if (cycles === undefined) break;
        executedInstructions += 1;
        const paid = Math.min(cycles, cpuCycleBudget - cpuCycles);
        cpuCycles += paid;
        this.cycleDebt = cycles - paid;
      } catch (error: unknown) {
        this.crash(error);
      }
    }
    return { cpuCycles, executedInstructions, state: this.stateValue };
  }

  private runCpuSliceWithoutHotBurst(
    cpuCycleBudget: number,
    instructionBudget: number,
  ): CpuProcessSliceResult {
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
        const paid = Math.min(cycles, cpuCycleBudget - cpuCycles);
        cpuCycles += paid;
        this.cycleDebt = cycles - paid;
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

  /**
   * Executes the common register/ALU/control-transfer subset in one tight host
   * loop. The caller retains finalization ownership for every cold instruction,
   * while this loop remains bounded by both scheduler budgets. Modeled cache,
   * branch, cycle-debt, and original instruction-count semantics are preserved
   * per guest instruction.
   */
  private runHotCpuBurst(
    cpuCycleBudget: number,
    instructionBudget: number,
  ): Cs486HotBurstResult {
    const instructionOpcodes = this.instructionOpcodes;
    const instructionOperandA = this.instructionOperandA;
    const instructionOperandB = this.instructionOperandB;
    const instructionExecutionFlags = this.instructionExecutionFlags;
    const instructionBaseCycles = this.instructionBaseCycles;
    const instructionBranchCycleDeltas = this.instructionBranchCycleDeltas;
    const registerValues = this.registerValues;
    const memoryHierarchy = this.memoryHierarchy;
    let instructionPointer = this.instructionPointer;
    let compared = this.compared;
    let cpuCycles = 0;
    let executedInstructions = 0;

    while (
      cpuCycles < cpuCycleBudget &&
      executedInstructions < instructionBudget
    ) {
      if (
        instructionPointer < 0 ||
        instructionPointer >= instructionOpcodes.length
      ) {
        this.instructionPointer = instructionPointer;
        this.compared = compared;
        return {
          cpuCycles,
          executedInstructions,
          stoppedOnColdInstruction: true,
        };
      }
      const instructionIndex = instructionPointer;
      const opcode = instructionOpcodes[instructionIndex]!;
      const operandA = instructionOperandA[instructionIndex]!;
      const operandB = instructionOperandB[instructionIndex]!;
      let branchTaken = false;

      switch (opcode) {
        case preparedOpcode.movImmediate:
          registerValues[operandA] = operandB;
          break;
        case preparedOpcode.movRegister:
          registerValues[operandA] = registerValues[operandB]!;
          break;
        case preparedOpcode.addImmediate:
          registerValues[operandA] = registerValues[operandA]! + operandB;
          break;
        case preparedOpcode.addRegister:
          registerValues[operandA] =
            registerValues[operandA]! + registerValues[operandB]!;
          break;
        case preparedOpcode.subtractImmediate:
          registerValues[operandA] = registerValues[operandA]! - operandB;
          break;
        case preparedOpcode.subtractRegister:
          registerValues[operandA] =
            registerValues[operandA]! - registerValues[operandB]!;
          break;
        case preparedOpcode.andImmediate:
          registerValues[operandA] = registerValues[operandA]! & operandB;
          break;
        case preparedOpcode.andRegister:
          registerValues[operandA] =
            registerValues[operandA]! & registerValues[operandB]!;
          break;
        case preparedOpcode.orImmediate:
          registerValues[operandA] = registerValues[operandA]! | operandB;
          break;
        case preparedOpcode.orRegister:
          registerValues[operandA] =
            registerValues[operandA]! | registerValues[operandB]!;
          break;
        case preparedOpcode.xorImmediate:
          registerValues[operandA] = registerValues[operandA]! ^ operandB;
          break;
        case preparedOpcode.xorRegister:
          registerValues[operandA] =
            registerValues[operandA]! ^ registerValues[operandB]!;
          break;
        case preparedOpcode.shiftLeftImmediate:
          registerValues[operandA] =
            registerValues[operandA]! << (operandB & 31);
          break;
        case preparedOpcode.shiftLeftRegister:
          registerValues[operandA] =
            registerValues[operandA]! << (registerValues[operandB]! & 31);
          break;
        case preparedOpcode.shiftRightImmediate:
          registerValues[operandA] =
            registerValues[operandA]! >> (operandB & 31);
          break;
        case preparedOpcode.shiftRightRegister:
          registerValues[operandA] =
            registerValues[operandA]! >> (registerValues[operandB]! & 31);
          break;
        case preparedOpcode.unsignedShiftRightImmediate:
          registerValues[operandA] =
            registerValues[operandA]! >>> (operandB & 31);
          break;
        case preparedOpcode.unsignedShiftRightRegister:
          registerValues[operandA] =
            registerValues[operandA]! >>> (registerValues[operandB]! & 31);
          break;
        case preparedOpcode.compareImmediate:
          compared = registerValues[operandA]! - operandB;
          break;
        case preparedOpcode.compareRegister:
          compared = registerValues[operandA]! - registerValues[operandB]!;
          break;
        case preparedOpcode.branchEqual:
          branchTaken = compared === 0;
          break;
        case preparedOpcode.branchNotEqual:
          branchTaken = compared !== 0;
          break;
        case preparedOpcode.branchLess:
          branchTaken = compared < 0;
          break;
        case preparedOpcode.branchLessOrEqual:
          branchTaken = compared <= 0;
          break;
        case preparedOpcode.branchGreater:
          branchTaken = compared > 0;
          break;
        case preparedOpcode.branchGreaterOrEqual:
          branchTaken = compared >= 0;
          break;
        case preparedOpcode.jump:
          branchTaken = true;
          break;
        default:
          this.instructionPointer = instructionPointer;
          this.compared = compared;
          return {
            cpuCycles,
            executedInstructions,
            stoppedOnColdInstruction: true,
          };
      }

      const executionFlags = instructionExecutionFlags[instructionIndex]!;
      let cycles =
        instructionBaseCycles[instructionIndex]! +
        (branchTaken ? instructionBranchCycleDeltas[instructionIndex]! : 0) +
        memoryHierarchy.fetchInstruction(instructionIndex);
      const controlTransfer =
        branchTaken ||
        (executionFlags & unconditionalControlTransferInstructionFlag) !== 0;
      memoryHierarchy.recordControlTransfer(controlTransfer);
      instructionPointer =
        controlTransfer &&
        ((executionFlags & conditionalBranchInstructionFlag) !== 0 ||
          opcode === preparedOpcode.jump)
          ? operandA
          : instructionIndex + 1;
      executedInstructions += 1;
      const paid = Math.min(cycles, cpuCycleBudget - cpuCycles);
      cpuCycles += paid;
      cycles -= paid;
      if (cycles > 0) {
        this.cycleDebt = cycles;
        break;
      }
    }

    this.instructionPointer = instructionPointer;
    this.compared = compared;
    return {
      cpuCycles,
      executedInstructions,
      stoppedOnColdInstruction: false,
    };
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
    if (
      instructionIndex < 0 ||
      instructionIndex >= this.instructionOpcodes.length
    ) {
      if (instructionIndex === this.instructionOpcodes.length) {
        this.complete();
        return undefined;
      }
      throw new Cs486Fault(
        "ExecutableFormatError",
        `instruction pointer ${String(instructionIndex)} is outside executable range 0..${String(this.instructionOpcodes.length)}`,
      );
    }
    this.instructionPointer += 1;
    const opcode = this.instructionOpcodes[instructionIndex]!;
    const operandA = this.instructionOperandA[instructionIndex]!;
    const operandB = this.instructionOperandB[instructionIndex]!;
    const executionFlags = this.instructionExecutionFlags[instructionIndex]!;
    let branchTaken = false;
    if ((executionFlags & conditionalBranchInstructionFlag) !== 0) {
      switch (opcode) {
        case preparedOpcode.branchEqual:
          branchTaken = this.compared === 0;
          break;
        case preparedOpcode.branchNotEqual:
          branchTaken = this.compared !== 0;
          break;
        case preparedOpcode.branchLess:
          branchTaken = this.compared < 0;
          break;
        case preparedOpcode.branchLessOrEqual:
          branchTaken = this.compared <= 0;
          break;
        case preparedOpcode.branchGreater:
          branchTaken = this.compared > 0;
          break;
        case preparedOpcode.branchGreaterOrEqual:
          branchTaken = this.compared >= 0;
          break;
      }
    }
    const baseCycles =
      (executionFlags & dynamicMultiplyInstructionFlag) === 0 ||
      this.cpuModel !== "cs386sx"
        ? this.instructionBaseCycles[instructionIndex]!
        : instructionCycleCost(
            this.cpuModel,
            this.executable.instructions[instructionIndex]!,
            {
              multiplier:
                opcode === preparedOpcode.mulImmediate
                  ? operandB
                  : this.registerValues[operandB]!,
            },
          );
    let cycles =
      baseCycles +
      (branchTaken ? this.instructionBranchCycleDeltas[instructionIndex]! : 0) +
      this.memoryHierarchy.fetchInstruction(instructionIndex);
    this.memoryHierarchy.recordControlTransfer(
      branchTaken ||
        (executionFlags & unconditionalControlTransferInstructionFlag) !== 0,
    );
    if ((executionFlags & conditionalBranchInstructionFlag) !== 0) {
      if (branchTaken) this.instructionPointer = operandA;
      return cycles;
    }
    if (opcode === preparedOpcode.jump) {
      this.instructionPointer = operandA;
      return cycles;
    }
    switch (opcode) {
      case preparedOpcode.movImmediate:
        this.registerValues[operandA] = operandB;
        break;
      case preparedOpcode.movRegister:
        this.registerValues[operandA] = this.registerValues[operandB]!;
        break;
      case preparedOpcode.loadImmediate: {
        const address = this.checkedAddress(operandB);
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getInt32(address, true);
        break;
      }
      case preparedOpcode.loadRegister: {
        const address = this.checkedAddress(this.registerValues[operandB]!);
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getInt32(address, true);
        break;
      }
      case preparedOpcode.load8SignedImmediate: {
        const address = this.checkedAddress(operandB, 1, 1);
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getInt8(address);
        break;
      }
      case preparedOpcode.load8SignedRegister: {
        const address = this.checkedAddress(
          this.registerValues[operandB]!,
          1,
          1,
        );
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getInt8(address);
        break;
      }
      case preparedOpcode.load8UnsignedImmediate: {
        const address = this.checkedAddress(operandB, 1, 1);
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getUint8(address);
        break;
      }
      case preparedOpcode.load8UnsignedRegister: {
        const address = this.checkedAddress(
          this.registerValues[operandB]!,
          1,
          1,
        );
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getUint8(address);
        break;
      }
      case preparedOpcode.load16SignedImmediate: {
        const address = this.checkedAddress(operandB, 2, 2);
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getInt16(address, true);
        break;
      }
      case preparedOpcode.load16SignedRegister: {
        const address = this.checkedAddress(
          this.registerValues[operandB]!,
          2,
          2,
        );
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getInt16(address, true);
        break;
      }
      case preparedOpcode.load16UnsignedImmediate: {
        const address = this.checkedAddress(operandB, 2, 2);
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getUint16(address, true);
        break;
      }
      case preparedOpcode.load16UnsignedRegister: {
        const address = this.checkedAddress(
          this.registerValues[operandB]!,
          2,
          2,
        );
        cycles += this.memoryHierarchy.accessData(address, "read");
        this.registerValues[operandA] = this.memory.getUint16(address, true);
        break;
      }
      case preparedOpcode.storeImmediate: {
        const address = this.checkedAddress(operandA);
        cycles += this.memoryHierarchy.accessData(address, "write");
        this.memory.setInt32(address, this.registerValues[operandB]!, true);
        break;
      }
      case preparedOpcode.storeRegister: {
        const address = this.checkedAddress(this.registerValues[operandA]!);
        cycles += this.memoryHierarchy.accessData(address, "write");
        this.memory.setInt32(address, this.registerValues[operandB]!, true);
        break;
      }
      case preparedOpcode.store8Immediate: {
        const address = this.checkedAddress(operandA, 1, 1);
        cycles += this.memoryHierarchy.accessData(address, "write");
        this.memory.setUint8(address, this.registerValues[operandB]! & 0xff);
        break;
      }
      case preparedOpcode.store8Register: {
        const address = this.checkedAddress(
          this.registerValues[operandA]!,
          1,
          1,
        );
        cycles += this.memoryHierarchy.accessData(address, "write");
        this.memory.setUint8(address, this.registerValues[operandB]! & 0xff);
        break;
      }
      case preparedOpcode.store16Immediate: {
        const address = this.checkedAddress(operandA, 2, 2);
        cycles += this.memoryHierarchy.accessData(address, "write");
        this.memory.setUint16(
          address,
          this.registerValues[operandB]! & 0xffff,
          true,
        );
        break;
      }
      case preparedOpcode.store16Register: {
        const address = this.checkedAddress(
          this.registerValues[operandA]!,
          2,
          2,
        );
        cycles += this.memoryHierarchy.accessData(address, "write");
        this.memory.setUint16(
          address,
          this.registerValues[operandB]! & 0xffff,
          true,
        );
        break;
      }
      case preparedOpcode.addImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! + operandB;
        break;
      case preparedOpcode.addRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! + this.registerValues[operandB]!;
        break;
      case preparedOpcode.subtractImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! - operandB;
        break;
      case preparedOpcode.subtractRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! - this.registerValues[operandB]!;
        break;
      case preparedOpcode.mulImmediate:
        this.registerValues[operandA] = Math.imul(
          this.registerValues[operandA]!,
          operandB,
        );
        break;
      case preparedOpcode.mulRegister:
        this.registerValues[operandA] = Math.imul(
          this.registerValues[operandA]!,
          this.registerValues[operandB]!,
        );
        break;
      case preparedOpcode.divideImmediate: {
        const divisor = operandB;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] = Math.trunc(
          this.registerValues[operandA]! / divisor,
        );
        break;
      }
      case preparedOpcode.divideRegister: {
        const divisor = this.registerValues[operandB]!;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] = Math.trunc(
          this.registerValues[operandA]! / divisor,
        );
        break;
      }
      case preparedOpcode.unsignedDivideImmediate: {
        const divisor = operandB >>> 0;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] = Math.trunc(
          (this.registerValues[operandA]! >>> 0) / divisor,
        );
        break;
      }
      case preparedOpcode.unsignedDivideRegister: {
        const divisor = this.registerValues[operandB]! >>> 0;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] = Math.trunc(
          (this.registerValues[operandA]! >>> 0) / divisor,
        );
        break;
      }
      case preparedOpcode.moduloImmediate: {
        const divisor = operandB;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] =
          this.registerValues[operandA]! % divisor;
        break;
      }
      case preparedOpcode.moduloRegister: {
        const divisor = this.registerValues[operandB]!;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] =
          this.registerValues[operandA]! % divisor;
        break;
      }
      case preparedOpcode.unsignedModuloImmediate: {
        const divisor = operandB >>> 0;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] =
          (this.registerValues[operandA]! >>> 0) % divisor;
        break;
      }
      case preparedOpcode.unsignedModuloRegister: {
        const divisor = this.registerValues[operandB]! >>> 0;
        if (divisor === 0)
          throw new Cs486Fault("DivisionByZeroError", "division by zero");
        this.registerValues[operandA] =
          (this.registerValues[operandA]! >>> 0) % divisor;
        break;
      }
      case preparedOpcode.andImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! & operandB;
        break;
      case preparedOpcode.andRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! & this.registerValues[operandB]!;
        break;
      case preparedOpcode.orImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! | operandB;
        break;
      case preparedOpcode.orRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! | this.registerValues[operandB]!;
        break;
      case preparedOpcode.xorImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! ^ operandB;
        break;
      case preparedOpcode.xorRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! ^ this.registerValues[operandB]!;
        break;
      case preparedOpcode.shiftLeftImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! << (operandB & 31);
        break;
      case preparedOpcode.shiftLeftRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! <<
          (this.registerValues[operandB]! & 31);
        break;
      case preparedOpcode.shiftRightImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! >> (operandB & 31);
        break;
      case preparedOpcode.shiftRightRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! >>
          (this.registerValues[operandB]! & 31);
        break;
      case preparedOpcode.unsignedShiftRightImmediate:
        this.registerValues[operandA] =
          this.registerValues[operandA]! >>> (operandB & 31);
        break;
      case preparedOpcode.unsignedShiftRightRegister:
        this.registerValues[operandA] =
          this.registerValues[operandA]! >>>
          (this.registerValues[operandB]! & 31);
        break;
      case preparedOpcode.compareImmediate:
        this.compared = this.registerValues[operandA]! - operandB;
        break;
      case preparedOpcode.compareRegister:
        this.compared =
          this.registerValues[operandA]! - this.registerValues[operandB]!;
        break;
      case preparedOpcode.pushImmediate:
        cycles += this.push(operandA);
        break;
      case preparedOpcode.pushRegister:
        cycles += this.push(this.registerValues[operandA]!);
        break;
      case preparedOpcode.pop: {
        const popped = this.pop();
        cycles += popped.cycles;
        this.registerValues[operandA] = popped.value;
        break;
      }
      case preparedOpcode.call: {
        cycles += this.push(this.instructionPointer);
        this.instructionPointer = operandA;
        break;
      }
      case preparedOpcode.callIndirectImmediate:
      case preparedOpcode.callIndirectRegister: {
        const instruction = this.executable.instructions[
          instructionIndex
        ] as Extract<Cs486Instruction, { readonly op: "call_indirect" }>;
        const target = this.checkedIndirectFunctionTarget(
          opcode === preparedOpcode.callIndirectImmediate
            ? operandA
            : this.registerValues[operandA]!,
          instruction.functionSignature as Cs486FunctionSignature,
        );
        cycles += this.push(this.instructionPointer);
        this.instructionPointer = target;
        break;
      }
      case preparedOpcode.return: {
        const popped = this.pop();
        cycles += popped.cycles;
        this.instructionPointer = this.checkedInstructionTarget(popped.value);
        break;
      }
      case preparedOpcode.syscall: {
        const instruction = this.executable.instructions[
          instructionIndex
        ] as Extract<Cs486Instruction, { readonly op: "syscall" }>;
        if (instruction.name === "cs.print.character") {
          const codePoint = this.registerValues[eaxRegisterIndex]!;
          if (
            codePoint < 0 ||
            codePoint > 0x10_ff_ff ||
            (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
          )
            throw new Cs486Fault(
              "OutputLimitError",
              "invalid Unicode code point",
            );
          this.outputValue += String.fromCodePoint(codePoint);
          if (this.outputValue.length > maximumOutputBytes)
            throw new Cs486Fault("OutputLimitError", "output limit exceeded");
          break;
        }
        const floatCycles = this.executeFloatSyscall(instruction.name);
        if (floatCycles !== undefined) return cycles + floatCycles;
        const handler = this.options.syscallHandler;
        if (handler === undefined)
          throw new Cs486Fault(
            "UnsupportedError",
            `syscall ${instruction.name} is unavailable`,
          );
        let syscallMemoryCycles = 0;
        const result = handler(instruction.name, {
          dataModel: cs486ExecutableDataModel(this.executable),
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
          readUint8: (address) => {
            address = this.checkedAddress(address, 1);
            syscallMemoryCycles += this.memoryHierarchy.accessData(
              address,
              "read",
            );
            return this.memory.getUint8(address);
          },
          writeInt32: (address, value) => {
            address = this.checkedAddress(address);
            syscallMemoryCycles += this.memoryHierarchy.accessData(
              address,
              "write",
            );
            this.memory.setInt32(address, value | 0, true);
          },
          writeRegister: (register, value) => this.write(register, value),
          writeUint8: (address, value) => {
            address = this.checkedAddress(address, 1);
            syscallMemoryCycles += this.memoryHierarchy.accessData(
              address,
              "write",
            );
            this.memory.setUint8(address, value & 0xff);
          },
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
      case preparedOpcode.printString: {
        const instruction = this.executable.instructions[
          instructionIndex
        ] as Extract<Cs486Instruction, { readonly op: "print" }>;
        this.outputValue += instruction.source as string;
        if (this.outputValue.length > maximumOutputBytes)
          throw new Cs486Fault("OutputLimitError", "output limit exceeded");
        break;
      }
      case preparedOpcode.printImmediate:
        this.outputValue += String(operandA);
        if (this.outputValue.length > maximumOutputBytes)
          throw new Cs486Fault("OutputLimitError", "output limit exceeded");
        break;
      case preparedOpcode.printRegister:
        this.outputValue += String(this.registerValues[operandA]!);
        if (this.outputValue.length > maximumOutputBytes)
          throw new Cs486Fault("OutputLimitError", "output limit exceeded");
        break;
      case preparedOpcode.halt:
        this.complete();
        break;
      default:
        throw new Cs486Fault(
          "ExecutableFormatError",
          "invalid prepared instruction opcode",
        );
    }
    return cycles;
  }

  private executeFloatSyscall(name: string): number | undefined {
    const match = /^cs\.fp\.(f32|f64)\.([a-z0-9.]+)$/u.exec(name);
    if (match === null) return undefined;
    const format: CsFloatFormat = match[1] === "f32" ? "binary32" : "binary64";
    const operation = match[2]!;
    const left = this.readFloatBits(format, "left");
    const right = (): bigint => this.readFloatBits(format, "right");
    const complete = (result: CsFloatResult, cost: number): number => {
      this.lastFloatStatus = result.status;
      this.writeFloatBits(format, result.bits);
      return cost;
    };
    const unaryCosts = format === "binary32" ? 48 : 72;
    const arithmeticCosts = format === "binary32" ? 96 : 160;
    const divisionCosts = format === "binary32" ? 192 : 320;
    switch (operation) {
      case "status":
        this.write("eax", this.lastFloatStatus);
        return 12;
      case "add":
        return complete(csFloatAdd(format, left, right()), arithmeticCosts);
      case "sub":
        return complete(
          csFloatSubtract(format, left, right()),
          arithmeticCosts,
        );
      case "mul":
        return complete(
          csFloatMultiply(format, left, right()),
          arithmeticCosts,
        );
      case "div":
        return complete(csFloatDivide(format, left, right()), divisionCosts);
      case "fmod":
        return complete(csFloatRemainder(format, left, right()), divisionCosts);
      case "neg":
        return complete(csFloatNegate(format, left), unaryCosts);
      case "abs":
        return complete(csFloatAbs(format, left), unaryCosts);
      case "copysign":
        return complete(csFloatCopySign(format, left, right()), unaryCosts);
      case "floor":
        return complete(csFloatFloor(format, left), unaryCosts);
      case "ceil":
        return complete(csFloatCeil(format, left), unaryCosts);
      case "trunc":
        return complete(csFloatTrunc(format, left), unaryCosts);
      case "round":
        return complete(csFloatRound(format, left), unaryCosts);
      case "sqrt":
        return complete(
          csFloatSqrt(format, left),
          format === "binary32" ? 256 : 448,
        );
      case "ldexp":
        return complete(
          csFloatLdexp(
            format,
            left,
            this.readRegister(format === "binary32" ? "edx" : "ebx"),
          ),
          arithmeticCosts,
        );
      case "frexp": {
        const result = csFloatFrexp(format, left);
        const pointer = this.readRegister(
          format === "binary32" ? "edx" : "ebx",
        );
        const memoryCycles = this.writeFloatInt32(pointer, result.exponent);
        return complete(result, arithmeticCosts + memoryCycles);
      }
      case "modf": {
        const result = csFloatModf(format, left);
        const pointer = this.readRegister(
          format === "binary32" ? "edx" : "ebx",
        );
        const memoryCycles = this.writeFloatMemory(
          format,
          pointer,
          result.integer.bits,
        );
        return complete(
          {
            bits: result.fraction.bits,
            status: result.fraction.status | result.integer.status,
          },
          arithmeticCosts + memoryCycles,
        );
      }
      case "format": {
        let rendered: string;
        try {
          rendered = csFloatToFixedDecimal(
            format,
            left,
            this.readRegister("ecx"),
          );
        } catch {
          this.lastFloatStatus = 1;
          this.write("eax", -1);
          return divisionCosts;
        }
        if (rendered.length > 62) {
          this.lastFloatStatus = 1;
          this.write("eax", -1);
          return divisionCosts;
        }
        const memoryCycles = this.writeFloatString(
          this.readRegister("ebx"),
          rendered,
        );
        this.lastFloatStatus = 0;
        this.write("eax", rendered.length);
        return divisionCosts + memoryCycles;
      }
      case "isnan":
        this.lastFloatStatus = 0;
        this.write("eax", csFloatClassify(format, left) === "nan" ? 1 : 0);
        return unaryCosts;
      case "isinf":
        this.lastFloatStatus = 0;
        this.write("eax", csFloatClassify(format, left) === "infinite" ? 1 : 0);
        return unaryCosts;
      case "isfinite": {
        const classification = csFloatClassify(format, left);
        this.lastFloatStatus = 0;
        this.write(
          "eax",
          classification !== "nan" && classification !== "infinite" ? 1 : 0,
        );
        return unaryCosts;
      }
      case "signbit":
        this.lastFloatStatus = 0;
        this.write("eax", csFloatSignBit(format, left) ? 1 : 0);
        return unaryCosts;
      case "from.i32.s":
        return complete(
          csFloatFromSignedInteger(format, BigInt(this.readRegister("eax"))),
          arithmeticCosts,
        );
      case "from.i32.u":
        return complete(
          csFloatFromUnsignedInteger(
            format,
            BigInt(this.readRegister("eax") >>> 0),
          ),
          arithmeticCosts,
        );
      case "from.i64.s":
      case "from.i64.u": {
        const integerBits =
          BigInt(this.readRegister("eax") >>> 0) |
          (BigInt(this.readRegister("edx") >>> 0) << 32n);
        return complete(
          operation.endsWith(".u")
            ? csFloatFromUnsignedInteger(format, integerBits)
            : csFloatFromSignedInteger(format, BigInt.asIntN(64, integerBits)),
          arithmeticCosts,
        );
      }
      case "to.i32.s":
      case "to.i32.u": {
        const result = operation.endsWith(".u")
          ? csFloatToUnsignedInteger(format, left, 32)
          : csFloatToSignedInteger(format, left, 32);
        this.lastFloatStatus = result.status;
        this.write("eax", Number(result.value & 0xffff_ffffn) | 0);
        return arithmeticCosts;
      }
      case "to.i64.s":
      case "to.i64.u": {
        const result = operation.endsWith(".u")
          ? csFloatToUnsignedInteger(format, left, 64)
          : csFloatToSignedInteger(format, left, 64);
        this.lastFloatStatus = result.status;
        this.write("eax", Number(result.value & 0xffff_ffffn) | 0);
        this.write("edx", Number((result.value >> 32n) & 0xffff_ffffn) | 0);
        return arithmeticCosts;
      }
      case "to.f32":
        if (format !== "binary64")
          throw new Cs486Fault(
            "UnsupportedError",
            "invalid CS floating conversion syscall",
          );
        {
          const result = csFloatConvert("binary64", "binary32", left);
          this.lastFloatStatus = result.status;
          this.write("eax", Number(result.bits & 0xffff_ffffn) | 0);
          return arithmeticCosts;
        }
      case "to.f64":
        if (format !== "binary32")
          throw new Cs486Fault(
            "UnsupportedError",
            "invalid CS floating conversion syscall",
          );
        this.lastFloatStatus = 0;
        this.writeFloatBits(
          "binary64",
          csFloatConvert("binary32", "binary64", left).bits,
        );
        return arithmeticCosts;
      default:
        if (operation.startsWith("compare.")) {
          const comparison = operation.slice("compare.".length);
          if (!isFloatComparison(comparison))
            throw new Cs486Fault(
              "UnsupportedError",
              `unsupported CS floating operation ${operation}`,
            );
          const result = csFloatCompare(format, left, right(), comparison);
          this.lastFloatStatus = result.status;
          this.write("eax", result.value ? 1 : 0);
          return arithmeticCosts;
        }
        throw new Cs486Fault(
          "UnsupportedError",
          `unsupported CS floating operation ${operation}`,
        );
    }
  }

  private readFloatBits(
    format: CsFloatFormat,
    operand: "left" | "right",
  ): bigint {
    if (format === "binary32")
      return BigInt(
        this.readRegister(operand === "left" ? "eax" : "edx") >>> 0,
      );
    const low = this.readRegister(operand === "left" ? "eax" : "ebx") >>> 0;
    const high = this.readRegister(operand === "left" ? "edx" : "ecx") >>> 0;
    return BigInt(low) | (BigInt(high) << 32n);
  }

  private writeFloatBits(format: CsFloatFormat, bits: bigint): void {
    this.write("eax", Number(bits & 0xffff_ffffn) | 0);
    if (format === "binary64")
      this.write("edx", Number((bits >> 32n) & 0xffff_ffffn) | 0);
  }

  private writeFloatInt32(address: number, value: number): number {
    address = this.checkedAddress(address);
    const cycles = this.memoryHierarchy.accessData(address, "write");
    this.memory.setInt32(address, value | 0, true);
    return cycles;
  }

  private writeFloatMemory(
    format: CsFloatFormat,
    address: number,
    bits: bigint,
  ): number {
    let cycles = this.writeFloatInt32(address, Number(bits & 0xffff_ffffn) | 0);
    if (format === "binary64")
      cycles += this.writeFloatInt32(
        address + 4,
        Number((bits >> 32n) & 0xffff_ffffn) | 0,
      );
    return cycles;
  }

  private writeFloatString(address: number, value: string): number {
    const dataModel = cs486ExecutableDataModel(this.executable);
    let cycles = 0;
    for (let index = 0; index <= value.length; index += 1) {
      const code = index === value.length ? 0 : value.charCodeAt(index);
      if (dataModel === "cs-byte8-v1") {
        const target = this.checkedAddress(address + index, 1);
        cycles += this.memoryHierarchy.accessData(target, "write");
        this.memory.setUint8(target, code);
      } else {
        const target = this.checkedAddress(address + index * 4);
        cycles += this.memoryHierarchy.accessData(target, "write");
        this.memory.setInt32(target, code, true);
      }
    }
    return cycles;
  }

  private readRegister(register: Cs486Register): number {
    return this.registerValues[indexOf(register)]!;
  }

  private write(register: Cs486Register, value: number): void {
    this.registerValues[indexOf(register)] = value | 0;
  }

  private checkedAddress(value: number, width = 4, alignment = 1): number {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > this.memoryBytes - width
    )
      throw new Cs486Fault(
        "MemoryAccessError",
        `address ${value} is outside RAM`,
      );
    if (value % alignment !== 0)
      throw new Cs486Fault(
        "MemoryAlignmentError",
        `address ${String(value)} is not aligned to ${String(alignment)} bytes`,
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

  private checkedIndirectFunctionTarget(
    value: number,
    expectedSignature: Cs486FunctionSignature,
  ): number {
    const actualSignature = this.functionEntries.get(value);
    if (actualSignature === undefined)
      throw new Cs486Fault(
        "InvalidFunctionPointerError",
        `indirect call target ${String(value)} is not an admitted function entry`,
      );
    if (actualSignature !== expectedSignature)
      throw new Cs486Fault(
        "FunctionSignatureMismatchError",
        `indirect call target ${String(value)} has signature ${actualSignature}, expected ${expectedSignature}`,
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
    readonly dataModel?: unknown;
    readonly format?: unknown;
    readonly functionEntries?: unknown;
    readonly initialData?: unknown;
    readonly instructions?: unknown;
    readonly memory?: unknown;
    readonly symbols?: unknown;
    readonly version?: unknown;
  };
  if (
    candidate.format !== "cs486-executable" ||
    !isSupportedCs486ExecutableVersion(candidate.version) ||
    !Array.isArray(candidate.instructions)
  )
    throw new Cs486Fault(
      "ExecutableFormatError",
      "unsupported executable format",
    );
  const limits = cs486FormatLimits({
    format: "executable",
    version: candidate.version,
  });
  if (candidate.instructions.length > limits.instructions)
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
  if (
    candidate.version === 3 ||
    candidate.version === 4 ||
    candidate.version === 5 ||
    candidate.version === 6
  ) {
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
    candidate.version === 5 || candidate.version === 6
      ? !isCs486DataModel(candidate.dataModel)
      : candidate.dataModel !== undefined
  ) {
    throw new Cs486Fault(
      "ExecutableFormatError",
      "invalid executable data model",
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
          limits,
        )
  )
    throw new Cs486Fault("ExecutableFormatError", "invalid initial data");
  if (
    candidate.functionEntries !== undefined &&
    ((candidate.version !== 4 &&
      candidate.version !== 5 &&
      candidate.version !== 6) ||
      !Array.isArray(candidate.functionEntries) ||
      candidate.functionEntries.length > limits.symbols)
  )
    throw new Cs486Fault(
      "ExecutableFormatError",
      "invalid function entry table",
    );
  if (Array.isArray(candidate.functionEntries)) {
    const addresses = new Set<number>();
    for (const value of candidate.functionEntries) {
      if (typeof value !== "object" || value === null)
        throw new Cs486Fault(
          "ExecutableFormatError",
          "invalid function entry table",
        );
      const entry = value as {
        readonly address?: unknown;
        readonly functionSignature?: unknown;
      };
      if (
        !Number.isSafeInteger(entry.address) ||
        (entry.address as number) < 0 ||
        (entry.address as number) >= candidate.instructions.length ||
        !isCs486FunctionSignature(entry.functionSignature) ||
        (candidate.version < 5 &&
          cs486FunctionSignatureUsesFloat(entry.functionSignature)) ||
        addresses.has(entry.address as number)
      )
        throw new Cs486Fault(
          "ExecutableFormatError",
          "invalid function entry table",
        );
      addresses.add(entry.address as number);
    }
  }
  if (
    candidate.symbols !== undefined &&
    (!Array.isArray(candidate.symbols) ||
      candidate.symbols.length > limits.symbols ||
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
              !isCs486FunctionSignature(
                symbol.functionSignature,
                candidate.version === 2 ? false : true,
              ) ||
              ((candidate.version as number) < 5 &&
                cs486FunctionSignatureUsesFloat(symbol.functionSignature)))) ||
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
    } else if (op === "call_indirect")
      valid =
        (candidate.version === 4 ||
          candidate.version === 5 ||
          candidate.version === 6) &&
        operand("source") &&
        isCs486FunctionSignature(candidateInstruction.functionSignature);
    else if (op === "push") valid = operand("source");
    else if (op === "pop") valid = register("destination");
    else if (op === "print")
      valid =
        typeof candidateInstruction.source === "string" || operand("source");
    else if (
      op === "load" ||
      op === "load8s" ||
      op === "load8u" ||
      op === "load16s" ||
      op === "load16u"
    )
      valid =
        (op === "load" || candidate.version === 5 || candidate.version === 6) &&
        register("destination") &&
        operand("address");
    else if (op === "store" || op === "store8" || op === "store16")
      valid =
        (op === "store" ||
          candidate.version === 5 ||
          candidate.version === 6) &&
        operand("address") &&
        register("source");
    else if (op === "cmp") valid = register("left") && operand("right");
    else if (
      op === "mov" ||
      op === "add" ||
      op === "sub" ||
      op === "mul" ||
      op === "div" ||
      op === "udiv" ||
      op === "mod" ||
      op === "umod" ||
      op === "and" ||
      op === "or" ||
      op === "xor" ||
      op === "shl" ||
      op === "shr" ||
      op === "ushr"
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
  if (
    value.version !== 3 &&
    value.version !== 4 &&
    value.version !== 5 &&
    value.version !== 6
  )
    return Object.freeze({ kind: "legacy", version: value.version });
  const requirements = flat32MemoryRequirements(
    value.dataBytes ?? 0,
    value.memory,
  );
  return Object.freeze({
    ...requirements,
    kind: "declared",
    model: value.memory.model,
    version: value.version,
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

function isValidInitialData(
  value: unknown,
  dataBytes: number,
  limits: Cs486FormatLimits,
): boolean {
  if (!Array.isArray(value) || value.length > limits.initialDataSegments)
    return false;
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
    if (totalBytes > limits.initializedDataBytes) return false;
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
  switch (register) {
    case "eax":
      return 0;
    case "ebx":
      return 1;
    case "ecx":
      return 2;
    case "edx":
      return 3;
    case "esi":
      return 4;
    case "edi":
      return 5;
    case "esp":
      return 6;
    case "ebp":
      return 7;
    default:
      return -1;
  }
}

const eaxRegisterIndex = 0;

const preparedOpcode = {
  movImmediate: 1,
  movRegister: 2,
  loadImmediate: 3,
  loadRegister: 4,
  load8SignedImmediate: 5,
  load8SignedRegister: 6,
  load8UnsignedImmediate: 7,
  load8UnsignedRegister: 8,
  load16SignedImmediate: 9,
  load16SignedRegister: 10,
  load16UnsignedImmediate: 11,
  load16UnsignedRegister: 12,
  storeImmediate: 13,
  storeRegister: 14,
  store8Immediate: 15,
  store8Register: 16,
  store16Immediate: 17,
  store16Register: 18,
  addImmediate: 19,
  addRegister: 20,
  subtractImmediate: 21,
  subtractRegister: 22,
  mulImmediate: 23,
  mulRegister: 24,
  divideImmediate: 25,
  divideRegister: 26,
  unsignedDivideImmediate: 27,
  unsignedDivideRegister: 28,
  moduloImmediate: 29,
  moduloRegister: 30,
  unsignedModuloImmediate: 31,
  unsignedModuloRegister: 32,
  andImmediate: 33,
  andRegister: 34,
  orImmediate: 35,
  orRegister: 36,
  xorImmediate: 37,
  xorRegister: 38,
  shiftLeftImmediate: 39,
  shiftLeftRegister: 40,
  shiftRightImmediate: 41,
  shiftRightRegister: 42,
  unsignedShiftRightImmediate: 43,
  unsignedShiftRightRegister: 44,
  compareImmediate: 45,
  compareRegister: 46,
  branchEqual: 47,
  branchNotEqual: 48,
  branchLess: 49,
  branchLessOrEqual: 50,
  branchGreater: 51,
  branchGreaterOrEqual: 52,
  jump: 53,
  pushImmediate: 54,
  pushRegister: 55,
  pop: 56,
  call: 57,
  callIndirectImmediate: 58,
  callIndirectRegister: 59,
  return: 60,
  syscall: 61,
  printString: 62,
  printImmediate: 63,
  printRegister: 64,
  halt: 65,
} as const;

function isPreparedHotOpcode(opcode: number | undefined): boolean {
  return (
    opcode !== undefined &&
    ((opcode >= preparedOpcode.movImmediate &&
      opcode <= preparedOpcode.movRegister) ||
      (opcode >= preparedOpcode.addImmediate &&
        opcode <= preparedOpcode.subtractRegister) ||
      (opcode >= preparedOpcode.andImmediate && opcode <= preparedOpcode.jump))
  );
}

const conditionalBranchInstructionFlag = 1 << 0;
const unconditionalControlTransferInstructionFlag = 1 << 1;
const dynamicMultiplyInstructionFlag = 1 << 2;

interface PreparedCs486SemanticInstructions {
  readonly executionFlags: Uint8Array;
  readonly hasHotBurstEntries: boolean;
  readonly hotBurstEntries: Uint8Array;
  readonly opcodes: Uint8Array;
  readonly operandA: Int32Array;
  readonly operandB: Int32Array;
}

interface PreparedCs486InstructionTiming {
  readonly baseCycles: Uint32Array;
  readonly branchCycleDeltas: Uint8Array;
}

const preparedCs486SemanticsByExecutable = new WeakMap<
  Cs486Executable,
  PreparedCs486SemanticInstructions
>();
const preparedCs486TimingByExecutable = new WeakMap<
  Cs486Executable,
  Map<CpuModel, PreparedCs486InstructionTiming>
>();

/**
 * Decodes the immutable executable's semantic shape once. Every process and
 * CPU model that runs the same validated executable shares these bounded typed
 * arrays; model-dependent timing remains in its own cache.
 */
function prepareCs486SemanticInstructions(
  executable: Cs486Executable,
): PreparedCs486SemanticInstructions {
  const cached = preparedCs486SemanticsByExecutable.get(executable);
  if (cached !== undefined) return cached;
  const instructions = executable.instructions;
  const opcodes = new Uint8Array(instructions.length);
  const operandA = new Int32Array(instructions.length);
  const operandB = new Int32Array(instructions.length);
  const executionFlags = new Uint8Array(instructions.length);
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index]!;
    switch (instruction.op) {
      case "mov":
        operandA[index] = indexOf(instruction.destination);
        prepareCs486Operand(
          opcodes,
          operandB,
          index,
          instruction.source,
          preparedOpcode.movImmediate,
          preparedOpcode.movRegister,
        );
        break;
      case "load":
        operandA[index] = indexOf(instruction.destination);
        prepareCs486Operand(
          opcodes,
          operandB,
          index,
          instruction.address,
          preparedOpcode.loadImmediate,
          preparedOpcode.loadRegister,
        );
        break;
      case "load8s":
        operandA[index] = indexOf(instruction.destination);
        prepareCs486Operand(
          opcodes,
          operandB,
          index,
          instruction.address,
          preparedOpcode.load8SignedImmediate,
          preparedOpcode.load8SignedRegister,
        );
        break;
      case "load8u":
        operandA[index] = indexOf(instruction.destination);
        prepareCs486Operand(
          opcodes,
          operandB,
          index,
          instruction.address,
          preparedOpcode.load8UnsignedImmediate,
          preparedOpcode.load8UnsignedRegister,
        );
        break;
      case "load16s":
        operandA[index] = indexOf(instruction.destination);
        prepareCs486Operand(
          opcodes,
          operandB,
          index,
          instruction.address,
          preparedOpcode.load16SignedImmediate,
          preparedOpcode.load16SignedRegister,
        );
        break;
      case "load16u":
        operandA[index] = indexOf(instruction.destination);
        prepareCs486Operand(
          opcodes,
          operandB,
          index,
          instruction.address,
          preparedOpcode.load16UnsignedImmediate,
          preparedOpcode.load16UnsignedRegister,
        );
        break;
      case "store":
        operandB[index] = indexOf(instruction.source);
        prepareCs486Operand(
          opcodes,
          operandA,
          index,
          instruction.address,
          preparedOpcode.storeImmediate,
          preparedOpcode.storeRegister,
        );
        break;
      case "store8":
        operandB[index] = indexOf(instruction.source);
        prepareCs486Operand(
          opcodes,
          operandA,
          index,
          instruction.address,
          preparedOpcode.store8Immediate,
          preparedOpcode.store8Register,
        );
        break;
      case "store16":
        operandB[index] = indexOf(instruction.source);
        prepareCs486Operand(
          opcodes,
          operandA,
          index,
          instruction.address,
          preparedOpcode.store16Immediate,
          preparedOpcode.store16Register,
        );
        break;
      case "add":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.addImmediate,
          preparedOpcode.addRegister,
        );
        break;
      case "sub":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.subtractImmediate,
          preparedOpcode.subtractRegister,
        );
        break;
      case "mul":
        executionFlags[index] = dynamicMultiplyInstructionFlag;
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.mulImmediate,
          preparedOpcode.mulRegister,
        );
        break;
      case "div":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.divideImmediate,
          preparedOpcode.divideRegister,
        );
        break;
      case "udiv":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.unsignedDivideImmediate,
          preparedOpcode.unsignedDivideRegister,
        );
        break;
      case "mod":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.moduloImmediate,
          preparedOpcode.moduloRegister,
        );
        break;
      case "umod":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.unsignedModuloImmediate,
          preparedOpcode.unsignedModuloRegister,
        );
        break;
      case "and":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.andImmediate,
          preparedOpcode.andRegister,
        );
        break;
      case "or":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.orImmediate,
          preparedOpcode.orRegister,
        );
        break;
      case "xor":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.xorImmediate,
          preparedOpcode.xorRegister,
        );
        break;
      case "shl":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.shiftLeftImmediate,
          preparedOpcode.shiftLeftRegister,
        );
        break;
      case "shr":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.shiftRightImmediate,
          preparedOpcode.shiftRightRegister,
        );
        break;
      case "ushr":
        prepareCs486BinaryInstruction(
          opcodes,
          operandA,
          operandB,
          index,
          instruction.destination,
          instruction.source,
          preparedOpcode.unsignedShiftRightImmediate,
          preparedOpcode.unsignedShiftRightRegister,
        );
        break;
      case "cmp":
        operandA[index] = indexOf(instruction.left);
        prepareCs486Operand(
          opcodes,
          operandB,
          index,
          instruction.right,
          preparedOpcode.compareImmediate,
          preparedOpcode.compareRegister,
        );
        break;
      case "je":
        prepareCs486Branch(
          opcodes,
          operandA,
          executionFlags,
          index,
          instruction.target,
          preparedOpcode.branchEqual,
        );
        break;
      case "jne":
        prepareCs486Branch(
          opcodes,
          operandA,
          executionFlags,
          index,
          instruction.target,
          preparedOpcode.branchNotEqual,
        );
        break;
      case "jl":
        prepareCs486Branch(
          opcodes,
          operandA,
          executionFlags,
          index,
          instruction.target,
          preparedOpcode.branchLess,
        );
        break;
      case "jle":
        prepareCs486Branch(
          opcodes,
          operandA,
          executionFlags,
          index,
          instruction.target,
          preparedOpcode.branchLessOrEqual,
        );
        break;
      case "jg":
        prepareCs486Branch(
          opcodes,
          operandA,
          executionFlags,
          index,
          instruction.target,
          preparedOpcode.branchGreater,
        );
        break;
      case "jge":
        prepareCs486Branch(
          opcodes,
          operandA,
          executionFlags,
          index,
          instruction.target,
          preparedOpcode.branchGreaterOrEqual,
        );
        break;
      case "jmp":
        opcodes[index] = preparedOpcode.jump;
        operandA[index] = instruction.target;
        executionFlags[index] = unconditionalControlTransferInstructionFlag;
        break;
      case "push":
        prepareCs486Operand(
          opcodes,
          operandA,
          index,
          instruction.source,
          preparedOpcode.pushImmediate,
          preparedOpcode.pushRegister,
        );
        break;
      case "pop":
        opcodes[index] = preparedOpcode.pop;
        operandA[index] = indexOf(instruction.destination);
        break;
      case "call":
        opcodes[index] = preparedOpcode.call;
        operandA[index] = instruction.target;
        executionFlags[index] = unconditionalControlTransferInstructionFlag;
        break;
      case "call_indirect":
        executionFlags[index] = unconditionalControlTransferInstructionFlag;
        prepareCs486Operand(
          opcodes,
          operandA,
          index,
          instruction.source,
          preparedOpcode.callIndirectImmediate,
          preparedOpcode.callIndirectRegister,
        );
        break;
      case "ret":
        opcodes[index] = preparedOpcode.return;
        executionFlags[index] = unconditionalControlTransferInstructionFlag;
        break;
      case "syscall":
        opcodes[index] = preparedOpcode.syscall;
        break;
      case "print":
        if (typeof instruction.source === "string")
          opcodes[index] = preparedOpcode.printString;
        else
          prepareCs486Operand(
            opcodes,
            operandA,
            index,
            instruction.source,
            preparedOpcode.printImmediate,
            preparedOpcode.printRegister,
          );
        break;
      case "halt":
        opcodes[index] = preparedOpcode.halt;
        break;
    }
  }
  const hotBurstEntries = prepareCs486HotBurstEntries(
    opcodes,
    operandA,
    executionFlags,
  );
  const prepared = {
    executionFlags,
    hasHotBurstEntries: hotBurstEntries.includes(1),
    hotBurstEntries,
    opcodes,
    operandA,
    operandB,
  };
  preparedCs486SemanticsByExecutable.set(executable, prepared);
  return prepared;
}

/**
 * Marks only entries that are guaranteed to execute the minimum number of hot
 * instructions before reaching a cold boundary, regardless of a conditional
 * branch outcome. The fixed pass count keeps preparation O(N) and prevents
 * short mixed hot/cold runs from paying burst setup cost.
 */
function prepareCs486HotBurstEntries(
  opcodes: Uint8Array,
  operandA: Int32Array,
  executionFlags: Uint8Array,
): Uint8Array {
  let previousDepth = new Uint8Array(opcodes.length);
  for (let index = 0; index < opcodes.length; index += 1)
    previousDepth[index] = isPreparedHotOpcode(opcodes[index]) ? 1 : 0;

  for (let depth = 2; depth <= minimumHotBurstInstructions; depth += 1) {
    const currentDepth = new Uint8Array(opcodes.length);
    for (let index = 0; index < opcodes.length; index += 1) {
      if (!isPreparedHotOpcode(opcodes[index])) continue;
      const flags = executionFlags[index]!;
      if ((flags & conditionalBranchInstructionFlag) !== 0) {
        currentDepth[index] =
          previousDepth[index + 1] === 1 &&
          previousDepth[operandA[index]!] === 1
            ? 1
            : 0;
      } else if ((flags & unconditionalControlTransferInstructionFlag) !== 0) {
        currentDepth[index] = previousDepth[operandA[index]!] === 1 ? 1 : 0;
      } else {
        currentDepth[index] = previousDepth[index + 1] === 1 ? 1 : 0;
      }
    }
    previousDepth = currentDepth;
  }
  return previousDepth;
}

function prepareCs486Operand(
  opcodes: Uint8Array,
  operandValues: Int32Array,
  index: number,
  operand: Cs486Operand,
  immediateOpcode: number,
  registerOpcode: number,
): void {
  if (operand.kind === "immediate") {
    opcodes[index] = immediateOpcode;
    operandValues[index] = operand.value;
  } else {
    opcodes[index] = registerOpcode;
    operandValues[index] = indexOf(operand.register);
  }
}

function prepareCs486BinaryInstruction(
  opcodes: Uint8Array,
  operandA: Int32Array,
  operandB: Int32Array,
  index: number,
  destination: Cs486Register,
  source: Cs486Operand,
  immediateOpcode: number,
  registerOpcode: number,
): void {
  operandA[index] = indexOf(destination);
  prepareCs486Operand(
    opcodes,
    operandB,
    index,
    source,
    immediateOpcode,
    registerOpcode,
  );
}

function prepareCs486Branch(
  opcodes: Uint8Array,
  targets: Int32Array,
  executionFlags: Uint8Array,
  index: number,
  target: number,
  branchOpcode: number,
): void {
  opcodes[index] = branchOpcode;
  targets[index] = target;
  executionFlags[index] = conditionalBranchInstructionFlag;
}

/**
 * Precomputes model-specific timing once per executable/model pair. Semantic
 * arrays are deliberately absent so all three CPU models share one decode.
 */
function prepareCs486InstructionTiming(
  executable: Cs486Executable,
  cpuModel: CpuModel,
): PreparedCs486InstructionTiming {
  let byCpuModel = preparedCs486TimingByExecutable.get(executable);
  const cached = byCpuModel?.get(cpuModel);
  if (cached !== undefined) return cached;
  byCpuModel ??= new Map<CpuModel, PreparedCs486InstructionTiming>();
  preparedCs486TimingByExecutable.set(executable, byCpuModel);
  const instructions = executable.instructions;
  const baseCycles = new Uint32Array(instructions.length);
  const branchCycleDeltas = new Uint8Array(instructions.length);
  for (let index = 0; index < instructions.length; index += 1) {
    const instruction = instructions[index]!;
    switch (instruction.op) {
      case "je":
      case "jne":
      case "jl":
      case "jle":
      case "jg":
      case "jge": {
        const notTakenCycles = instructionCycleCost(cpuModel, instruction, {
          branchTaken: false,
        });
        const takenCycles = instructionCycleCost(cpuModel, instruction, {
          branchTaken: true,
        });
        baseCycles[index] = notTakenCycles;
        branchCycleDeltas[index] = takenCycles - notTakenCycles;
        break;
      }
      case "mul":
        if (cpuModel !== "cs386sx")
          baseCycles[index] = instructionCycleCost(cpuModel, instruction);
        break;
      default:
        baseCycles[index] = instructionCycleCost(cpuModel, instruction);
    }
  }
  const prepared = { baseCycles, branchCycleDeltas };
  byCpuModel.set(cpuModel, prepared);
  return prepared;
}
