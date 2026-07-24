import { createHash } from "node:crypto";

import type { Cs486Register } from "../../src/domain/cpu/instructionSet.js";
import { cs486RegisterNames } from "../../src/domain/cpu/instructionSet.js";
import type { CpuMicroarchitectureStats } from "../../src/domain/cpu/memoryHierarchy.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";
import { VmRuntimeError } from "../../src/domain/runtime/errors.js";
import {
  Cs486Fault,
  type Cs486Executable,
} from "../../src/domain/cpu/cs486.js";
import type {
  Cs486BenchmarkExecutionMode,
  Cs486BenchmarkInstrumentationMode,
  Cs486InterpreterSample,
} from "../cs486-interpreter-benchmark-entry.js";
import type { Cs486WasmMemoryLayout } from "../cs486-wasm-batch-executor-abi.js";
import {
  computeCs486WasmMemoryLayout,
  cs486WasmAbiVersion,
  cs486WasmCacheGeometry,
  cs486WasmCpuModelCode,
  cs486WasmExitField,
  cs486WasmExitReason,
  cs486WasmParamsField,
  cs486WasmStateBytes,
  cs486WasmStateField,
  cs486WasmStatsIndex,
} from "../cs486-wasm-batch-executor-abi.js";
import type { Cs486WasmProcessLayout } from "../cs486-wasm-batch-executor-prep.js";
import {
  deriveCs486WasmProcessLayout,
  prepareCs486WasmInstructions,
  type Cs486WasmPreparedInstructions,
} from "../cs486-wasm-batch-executor-prep.js";
import {
  cs486WasmFaultToError,
  executeCs486WasmColdInstruction,
  type Cs486WasmColdOpMachine,
} from "../cs486-wasm-cold-op-bridge.js";
import type { Cs486BenchmarkCorpus } from "../wasm-corpora/corpus-registry.js";
import { resolveCs486BenchmarkCorpus } from "../wasm-corpora/corpus-registry.js";

/**
 * Variant-independent wasm engine adapter for the Issue #106 A/B harness.
 * It owns the host side of the batch-executor ABI: region layout, per-run
 * state reset, the slice loop that mirrors the production
 * `runCpuSlice`/`runInstructionSlice` debt accounting, and the cold-op
 * bridge dispatch. Both wasm variants (Rust and AssemblyScript) run through
 * this exact code, so any A/B difference comes from the module itself.
 *
 * The adapter runs inside the harness's esbuild bundle, so it never touches
 * the filesystem; the harness instantiates the artifact and hands the
 * exports and memory in.
 */
export interface Cs486WasmBatchExecutorExports {
  access_data(address: number, kind: number): number;
  configure(paramsBase: number): number;
  fetch_instruction(index: number): number;
  record_control_transfer(taken: number): void;
  run_cpu_slice(cpuCycleBudget: bigint, instructionBudget: bigint): number;
  run_instruction_slice(instructionBudget: bigint): number;
}

interface PreparedModelContext {
  readonly geometry: ReturnType<typeof cs486WasmCacheGeometry>;
  readonly instructions: Cs486Executable["instructions"];
  readonly memoryLayout: Cs486WasmMemoryLayout;
  readonly prepared: Cs486WasmPreparedInstructions;
  readonly processLayout: Cs486WasmProcessLayout;
}

const wasmPageBytes = 65_536;
const eaxRegisterIndex = 0;

export function createCs486WasmBenchmarkMeasure(
  exports: Cs486WasmBatchExecutorExports,
  memory: WebAssembly.Memory,
  corpusName: string,
): (
  cpuModel: CpuModel,
  instructionBudget: number,
  executionMode?: Cs486BenchmarkExecutionMode,
  instrumentation?: Cs486BenchmarkInstrumentationMode,
) => Cs486InterpreterSample {
  const corpus = resolveCs486BenchmarkCorpus(corpusName);
  const executable = corpus.executable();
  // All per-model layouts start at the variant's untouched initial memory
  // size, captured once so later growth never shifts region bases.
  const startOffset = memory.buffer.byteLength;
  const contexts = new Map<CpuModel, PreparedModelContext>();
  return (
    cpuModel,
    instructionBudget,
    executionMode = "instruction-slice",
    instrumentation = "enabled",
  ) =>
    measureWasmSample(
      exports,
      memory,
      corpus,
      executable,
      prepareModelContext(contexts, corpus, executable, cpuModel, startOffset),
      cpuModel,
      instructionBudget,
      executionMode,
      instrumentation,
    );
}

function prepareModelContext(
  contexts: Map<CpuModel, PreparedModelContext>,
  corpus: Cs486BenchmarkCorpus,
  executable: ReturnType<Cs486BenchmarkCorpus["executable"]>,
  cpuModel: CpuModel,
  startOffset: number,
): PreparedModelContext {
  const existing = contexts.get(cpuModel);
  if (existing !== undefined) return existing;
  const prepared = prepareCs486WasmInstructions(executable, cpuModel);
  const processLayout = deriveCs486WasmProcessLayout(executable, {
    cpuModel,
    memoryBytes: corpus.memoryBytes,
  });
  const geometry = cs486WasmCacheGeometry(cpuModel);
  const memoryLayout = computeCs486WasmMemoryLayout(
    startOffset,
    executable.instructions.length,
    processLayout.memoryBytes,
    geometry,
  );
  const context = {
    geometry,
    instructions: executable.instructions,
    memoryLayout,
    prepared,
    processLayout,
  };
  contexts.set(cpuModel, context);
  return context;
}

function measureWasmSample(
  exports: Cs486WasmBatchExecutorExports,
  memory: WebAssembly.Memory,
  corpus: Cs486BenchmarkCorpus,
  executable: ReturnType<Cs486BenchmarkCorpus["executable"]>,
  context: PreparedModelContext,
  cpuModel: CpuModel,
  instructionBudget: number,
  executionMode: Cs486BenchmarkExecutionMode,
  instrumentation: Cs486BenchmarkInstrumentationMode,
): Cs486InterpreterSample {
  const layout = context.memoryLayout;
  if (layout.totalBytes > memory.buffer.byteLength)
    memory.grow(
      Math.ceil((layout.totalBytes - memory.buffer.byteLength) / wasmPageBytes),
    );
  const buffer = memory.buffer;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const collectStats = instrumentation === "enabled";
  writeParams(view, layout, context, cpuModel, collectStats);
  resetRunState(view, bytes, layout, context);
  const configureCode = exports.configure(layout.paramsBase);
  if (configureCode !== 0)
    throw new Error(
      `cs486 wasm configure rejected the params block with code ${String(configureCode)}`,
    );

  const instructionCount = executable.instructions.length;
  let output = "";
  let processState: Readonly<Record<string, unknown>> = { kind: "ready" };
  const machine = createColdOpMachine(
    exports,
    view,
    layout,
    context,
    (text) => {
      output += text;
      return output.length;
    },
  );

  const isCpuSlice = executionMode === "cpu-slice";
  // Mirrors the production benchmark entry: cpu-slice mode runs with an
  // effectively unbounded cycle budget and the instruction budget as the
  // real bound; instruction-slice mode never owns cycle debt.
  let remainingCycles = Number.MAX_SAFE_INTEGER;
  let remainingInstructions = instructionBudget;
  let totalCycles = 0;
  let totalExecuted = 0;

  const cpuStart = process.cpuUsage();
  const wallStart = process.hrtime.bigint();
  running: while (
    remainingInstructions > 0 &&
    (!isCpuSlice || remainingCycles > 0)
  ) {
    const reason = isCpuSlice
      ? exports.run_cpu_slice(
          BigInt(remainingCycles),
          BigInt(remainingInstructions),
        )
      : exports.run_instruction_slice(BigInt(remainingInstructions));
    const consumed = Number(
      view.getBigInt64(
        layout.exitBase + cs486WasmExitField.cyclesConsumed,
        true,
      ),
    );
    const executedNow = Number(
      view.getBigInt64(
        layout.exitBase + cs486WasmExitField.instructionsExecuted,
        true,
      ),
    );
    totalCycles += consumed;
    totalExecuted += executedNow;
    remainingCycles -= consumed;
    remainingInstructions -= executedNow;
    switch (reason) {
      case cs486WasmExitReason.budgetExhausted:
        if (consumed === 0 && executedNow === 0)
          throw new Error(
            "cs486 wasm run made no progress before reporting budget exhaustion",
          );
        break running;
      case cs486WasmExitReason.endOfProgram:
        processState = {
          kind: "completed",
          value: view.getInt32(
            layout.registersBase + eaxRegisterIndex * 4,
            true,
          ),
        };
        break running;
      case cs486WasmExitReason.fault: {
        const fault = cs486WasmFaultToError(
          view.getInt32(layout.exitBase + cs486WasmExitField.faultCode, true),
          view.getInt32(
            layout.exitBase + cs486WasmExitField.faultOperand,
            true,
          ),
          instructionCount,
        );
        processState = {
          kind: "crashed",
          error: new VmRuntimeError(fault.typeName, fault.message),
        };
        break running;
      }
      case cs486WasmExitReason.coldInstruction: {
        let coldResult;
        try {
          coldResult = executeCs486WasmColdInstruction(
            machine(
              view.getInt32(
                layout.stateBase + cs486WasmStateField.instructionPointer,
                true,
              ),
            ),
          );
        } catch (error) {
          if (error instanceof Cs486Fault) {
            processState = {
              kind: "crashed",
              error: new VmRuntimeError(error.typeName, error.message),
            };
            break running;
          }
          throw error;
        }
        totalExecuted += 1;
        remainingInstructions -= 1;
        if (isCpuSlice) {
          // Production runCpuSlice pays what the budget allows and banks the
          // rest as cycle debt; the debt would be repaid at the next loop
          // top, so settling greedily here is the same arithmetic.
          const paid = Math.min(coldResult.cycles, remainingCycles);
          totalCycles += paid;
          remainingCycles -= paid;
          view.setBigInt64(
            layout.stateBase + cs486WasmStateField.cycleDebt,
            BigInt(coldResult.cycles - paid),
            true,
          );
        } else {
          totalCycles += coldResult.cycles;
        }
        if (coldResult.kind === "completed") {
          processState = {
            kind: "completed",
            value: view.getInt32(
              layout.registersBase + eaxRegisterIndex * 4,
              true,
            ),
          };
          break running;
        }
        break;
      }
      default:
        throw new Error(
          `cs486 wasm run returned unexpected exit reason ${String(reason)}`,
        );
    }
  }
  const elapsedNanoseconds = Number(process.hrtime.bigint() - wallStart);
  const cpuUsage = process.cpuUsage(cpuStart);

  const registers = readRegisters(view, layout);
  const microarchitecture = collectStats ? readStats(view, layout) : null;
  const guestRamSha256 = createHash("sha256")
    .update(
      new Uint8Array(
        memory.buffer,
        layout.ramBase,
        context.processLayout.memoryBytes,
      ),
    )
    .digest("hex");
  return Object.freeze({
    cpuMicroseconds: cpuUsage.user + cpuUsage.system,
    elapsedNanoseconds,
    executedInstructions: totalExecuted,
    guestCycles: totalCycles,
    guestRamSha256,
    hasPendingCpuCycles:
      view.getBigInt64(layout.stateBase + cs486WasmStateField.cycleDebt, true) >
      0n,
    instructionPointer: view.getInt32(
      layout.stateBase + cs486WasmStateField.instructionPointer,
      true,
    ),
    instrumentation,
    microarchitecture,
    output,
    processState: Object.freeze(processState),
    registerChecksum:
      registers.eax ^ registers.ebx ^ registers.ecx ^ registers.edx,
    registers: Object.freeze(registers),
  });
}

export type Cs486WasmSessionStateKind = "completed" | "crashed" | "ready";

export interface Cs486WasmSliceResult {
  readonly cpuCycles: number;
  readonly executedInstructions: number;
  readonly kind: Cs486WasmSessionStateKind;
}

export interface Cs486WasmSessionSnapshot {
  readonly completedValue: number | null;
  readonly errorMessage: string | null;
  readonly errorName: string | null;
  readonly guestRamSha256: string;
  readonly hasPendingCpuCycles: boolean;
  readonly instructionPointer: number;
  readonly microarchitecture: CpuMicroarchitectureStats | null;
  readonly output: string;
  readonly processStateKind: Cs486WasmSessionStateKind;
  readonly registers: Record<Cs486Register, number>;
}

export interface Cs486WasmExecutableSession {
  runSlice(
    mode: Cs486BenchmarkExecutionMode,
    cycleBudget: number,
    instructionBudget: number,
  ): Cs486WasmSliceResult;
  snapshot(): Cs486WasmSessionSnapshot;
}

/**
 * Creates a per-executable slice session for the differential-equivalence
 * harness. Unlike the benchmark measure, budgets here are real per-slice
 * bounds, so this mirrors the production `runCpuSlice`/`runInstructionSlice`
 * return contract slice by slice: terminal state with no debt returns a
 * zero-progress result, cpu-slice mode pays banked cycle debt from the slice
 * budget first, and instruction-slice mode never owns debt. Sessions share
 * one `startOffset` region; creating a session rewrites every region, so at
 * most one session per module instance may be live at a time.
 */
export function createCs486WasmExecutableSession(
  exports: Cs486WasmBatchExecutorExports,
  memory: WebAssembly.Memory,
  executable: Cs486Executable,
  options: {
    readonly cpuModel: CpuModel;
    readonly instrumentation: Cs486BenchmarkInstrumentationMode;
    readonly memoryBytes: number;
    readonly startOffset: number;
  },
): Cs486WasmExecutableSession {
  const prepared = prepareCs486WasmInstructions(executable, options.cpuModel);
  const processLayout = deriveCs486WasmProcessLayout(executable, {
    cpuModel: options.cpuModel,
    memoryBytes: options.memoryBytes,
  });
  const geometry = cs486WasmCacheGeometry(options.cpuModel);
  const layout = computeCs486WasmMemoryLayout(
    options.startOffset,
    executable.instructions.length,
    processLayout.memoryBytes,
    geometry,
  );
  if (layout.totalBytes > memory.buffer.byteLength)
    memory.grow(
      Math.ceil((layout.totalBytes - memory.buffer.byteLength) / wasmPageBytes),
    );
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const collectStats = options.instrumentation === "enabled";
  const context: PreparedModelContext = {
    geometry,
    instructions: executable.instructions,
    memoryLayout: layout,
    prepared,
    processLayout,
  };
  writeParams(view, layout, context, options.cpuModel, collectStats);
  resetRunState(view, bytes, layout, context);
  const configureCode = exports.configure(layout.paramsBase);
  if (configureCode !== 0)
    throw new Error(
      `cs486 wasm configure rejected the params block with code ${String(configureCode)}`,
    );

  const instructionCount = executable.instructions.length;
  let output = "";
  let stateKind: Cs486WasmSessionStateKind = "ready";
  let completedValue: number | null = null;
  let crashError: VmRuntimeError | null = null;
  const machine = createColdOpMachine(
    exports,
    view,
    layout,
    context,
    (text) => {
      output += text;
      return output.length;
    },
  );
  const readDebt = (): number =>
    Number(
      view.getBigInt64(layout.stateBase + cs486WasmStateField.cycleDebt, true),
    );
  const writeDebt = (value: number): void => {
    view.setBigInt64(
      layout.stateBase + cs486WasmStateField.cycleDebt,
      BigInt(value),
      true,
    );
  };
  const markCompleted = (): void => {
    stateKind = "completed";
    completedValue = view.getInt32(
      layout.registersBase + eaxRegisterIndex * 4,
      true,
    );
  };

  const runSlice = (
    mode: Cs486BenchmarkExecutionMode,
    cycleBudget: number,
    instructionBudget: number,
  ): Cs486WasmSliceResult => {
    const isCpuSlice = mode === "cpu-slice";
    if (stateKind !== "ready") {
      // Terminal semantics of the production slices: runCpuSlice still pays
      // banked debt from the budget, runInstructionSlice returns unchanged.
      if (isCpuSlice) {
        const debt = readDebt();
        if (debt > 0) {
          const paid = Math.min(debt, cycleBudget);
          writeDebt(debt - paid);
          return { cpuCycles: paid, executedInstructions: 0, kind: stateKind };
        }
      }
      return { cpuCycles: 0, executedInstructions: 0, kind: stateKind };
    }
    let remainingCycles = isCpuSlice ? cycleBudget : Number.MAX_SAFE_INTEGER;
    let remainingInstructions = instructionBudget;
    let totalCycles = 0;
    let totalExecuted = 0;
    running: while (remainingInstructions > 0 && remainingCycles > 0) {
      const reason = isCpuSlice
        ? exports.run_cpu_slice(
            BigInt(remainingCycles),
            BigInt(remainingInstructions),
          )
        : exports.run_instruction_slice(BigInt(remainingInstructions));
      const consumed = Number(
        view.getBigInt64(
          layout.exitBase + cs486WasmExitField.cyclesConsumed,
          true,
        ),
      );
      const executedNow = Number(
        view.getBigInt64(
          layout.exitBase + cs486WasmExitField.instructionsExecuted,
          true,
        ),
      );
      totalCycles += consumed;
      totalExecuted += executedNow;
      remainingCycles -= consumed;
      remainingInstructions -= executedNow;
      switch (reason) {
        case cs486WasmExitReason.budgetExhausted:
          break running;
        case cs486WasmExitReason.endOfProgram:
          markCompleted();
          break running;
        case cs486WasmExitReason.fault: {
          const fault = cs486WasmFaultToError(
            view.getInt32(layout.exitBase + cs486WasmExitField.faultCode, true),
            view.getInt32(
              layout.exitBase + cs486WasmExitField.faultOperand,
              true,
            ),
            instructionCount,
          );
          stateKind = "crashed";
          crashError = new VmRuntimeError(fault.typeName, fault.message);
          break running;
        }
        case cs486WasmExitReason.coldInstruction: {
          // The production loop re-checks both budgets before executing the
          // next instruction; a cold exit that lands exactly on an exhausted
          // budget must resume in the next slice, not run over budget here.
          if (remainingInstructions <= 0 || remainingCycles <= 0) break running;
          let coldResult;
          try {
            coldResult = executeCs486WasmColdInstruction(
              machine(
                view.getInt32(
                  layout.stateBase + cs486WasmStateField.instructionPointer,
                  true,
                ),
              ),
            );
          } catch (error) {
            if (error instanceof Cs486Fault) {
              stateKind = "crashed";
              crashError = new VmRuntimeError(error.typeName, error.message);
              break running;
            }
            throw error;
          }
          totalExecuted += 1;
          remainingInstructions -= 1;
          if (isCpuSlice) {
            const paid = Math.min(coldResult.cycles, remainingCycles);
            totalCycles += paid;
            remainingCycles -= paid;
            writeDebt(coldResult.cycles - paid);
          } else {
            totalCycles += coldResult.cycles;
          }
          if (coldResult.kind === "completed") {
            markCompleted();
            break running;
          }
          break;
        }
        default:
          throw new Error(
            `cs486 wasm run returned unexpected exit reason ${String(reason)}`,
          );
      }
    }
    return {
      cpuCycles: totalCycles,
      executedInstructions: totalExecuted,
      kind: stateKind,
    };
  };

  const snapshot = (): Cs486WasmSessionSnapshot => ({
    completedValue,
    errorMessage: crashError === null ? null : crashError.message,
    errorName: crashError === null ? null : crashError.name,
    guestRamSha256: createHash("sha256")
      .update(
        new Uint8Array(
          memory.buffer,
          layout.ramBase,
          context.processLayout.memoryBytes,
        ),
      )
      .digest("hex"),
    hasPendingCpuCycles: readDebt() > 0,
    instructionPointer: view.getInt32(
      layout.stateBase + cs486WasmStateField.instructionPointer,
      true,
    ),
    microarchitecture: collectStats ? readStats(view, layout) : null,
    output,
    processStateKind: stateKind,
    registers: readRegisters(view, layout),
  });

  return { runSlice, snapshot };
}

function writeParams(
  view: DataView,
  layout: Cs486WasmMemoryLayout,
  context: PreparedModelContext,
  cpuModel: CpuModel,
  collectStats: boolean,
): void {
  const base = layout.paramsBase;
  const fields = cs486WasmParamsField;
  view.setInt32(base + fields.abiVersion, cs486WasmAbiVersion, true);
  view.setInt32(
    base + fields.cpuModelCode,
    cs486WasmCpuModelCode[cpuModel],
    true,
  );
  view.setInt32(base + fields.collectStats, collectStats ? 1 : 0, true);
  view.setInt32(
    base + fields.instructionCount,
    context.prepared.opcodes.length,
    true,
  );
  view.setInt32(
    base + fields.memoryBytes,
    context.processLayout.memoryBytes,
    true,
  );
  view.setInt32(
    base + fields.stackFloorBytes,
    context.processLayout.stackFloorBytes,
    true,
  );
  view.setInt32(base + fields.ramBase, layout.ramBase, true);
  view.setInt32(base + fields.opcodesBase, layout.opcodesBase, true);
  view.setInt32(base + fields.flagsBase, layout.flagsBase, true);
  view.setInt32(base + fields.branchDeltaBase, layout.branchDeltaBase, true);
  view.setInt32(base + fields.baseCyclesBase, layout.baseCyclesBase, true);
  view.setInt32(base + fields.operandABase, layout.operandABase, true);
  view.setInt32(base + fields.operandBBase, layout.operandBBase, true);
  view.setInt32(base + fields.registersBase, layout.registersBase, true);
  view.setInt32(base + fields.stateBase, layout.stateBase, true);
  view.setInt32(base + fields.exitBase, layout.exitBase, true);
  view.setInt32(base + fields.cacheBase, layout.cacheBase, true);
  view.setInt32(base + fields.cacheBytes, layout.cacheBytes, true);
  view.setInt32(base + fields.l1SetCount, context.geometry.l1SetCount, true);
  view.setInt32(base + fields.l2SetCount, context.geometry.l2SetCount, true);
  view.setInt32(
    base + fields.cacheLineShift,
    context.geometry.cacheLineShift,
    true,
  );
  view.setInt32(
    base + fields.mainMemoryTransferCycles,
    context.geometry.mainMemoryTransferCycles,
    true,
  );
}

/** Rewrites SoA tables, registers, RAM, and scalar state for a fresh run. */
function resetRunState(
  view: DataView,
  bytes: Uint8Array,
  layout: Cs486WasmMemoryLayout,
  context: PreparedModelContext,
): void {
  const prepared = context.prepared;
  bytes.set(prepared.opcodes, layout.opcodesBase);
  bytes.set(prepared.executionFlags, layout.flagsBase);
  bytes.set(prepared.branchCycleDeltas, layout.branchDeltaBase);
  bytes.set(typedArrayBytes(prepared.baseCycles), layout.baseCyclesBase);
  bytes.set(typedArrayBytes(prepared.operandA), layout.operandABase);
  bytes.set(typedArrayBytes(prepared.operandB), layout.operandBBase);
  bytes.set(
    typedArrayBytes(context.processLayout.initialRegisters),
    layout.registersBase,
  );
  bytes.set(context.processLayout.initialRam, layout.ramBase);
  bytes.fill(0, layout.stateBase, layout.stateBase + cs486WasmStateBytes);
  view.setBigInt64(
    layout.exitBase + cs486WasmExitField.cyclesConsumed,
    0n,
    true,
  );
  view.setBigInt64(
    layout.exitBase + cs486WasmExitField.instructionsExecuted,
    0n,
    true,
  );
  view.setInt32(layout.exitBase + cs486WasmExitField.reason, 0, true);
  view.setInt32(layout.exitBase + cs486WasmExitField.faultCode, 0, true);
  view.setInt32(layout.exitBase + cs486WasmExitField.faultOperand, 0, true);
}

function typedArrayBytes(array: Int32Array | Uint32Array): Uint8Array {
  // Host is little-endian on every supported Node platform, matching the
  // wasm linear-memory byte order; the loader asserts nothing further.
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

function createColdOpMachine(
  exports: Cs486WasmBatchExecutorExports,
  view: DataView,
  layout: Cs486WasmMemoryLayout,
  context: PreparedModelContext,
  appendOutput: (text: string) => number,
): (instructionIndex: number) => Cs486WasmColdOpMachine {
  const base: Omit<
    Cs486WasmColdOpMachine,
    | "baseCycles"
    | "executionFlags"
    | "instruction"
    | "instructionIndex"
    | "opcode"
    | "operandA"
  > = {
    accessData: (address, kind) =>
      exports.access_data(address, kind === "write" ? 1 : 0),
    appendOutput,
    fetchInstruction: (index) => exports.fetch_instruction(index),
    functionEntries: context.processLayout.functionEntries,
    getRegister: (index) =>
      view.getInt32(layout.registersBase + index * 4, true),
    instructionCount: context.prepared.opcodes.length,
    memoryBytes: context.processLayout.memoryBytes,
    recordControlTransfer: (taken) =>
      exports.record_control_transfer(taken ? 1 : 0),
    setInstructionPointer: (value) =>
      view.setInt32(
        layout.stateBase + cs486WasmStateField.instructionPointer,
        value,
        true,
      ),
    setRegister: (index, value) =>
      view.setInt32(layout.registersBase + index * 4, value, true),
    stackFloorBytes: context.processLayout.stackFloorBytes,
    writeRamInt32: (address, value) =>
      view.setInt32(layout.ramBase + address, value, true),
  };
  const instructions = context.instructions;
  return (instructionIndex) => ({
    ...base,
    baseCycles: context.prepared.baseCycles[instructionIndex]!,
    executionFlags: context.prepared.executionFlags[instructionIndex]!,
    instruction: instructions[instructionIndex]!,
    instructionIndex,
    opcode: context.prepared.opcodes[instructionIndex]!,
    operandA: context.prepared.operandA[instructionIndex]!,
  });
}

function readRegisters(
  view: DataView,
  layout: Cs486WasmMemoryLayout,
): Record<Cs486Register, number> {
  const registers = {} as Record<Cs486Register, number>;
  cs486RegisterNames.forEach((name, index) => {
    registers[name] = view.getInt32(layout.registersBase + index * 4, true);
  });
  return registers;
}

function readStats(
  view: DataView,
  layout: Cs486WasmMemoryLayout,
): CpuMicroarchitectureStats {
  const statsBase = layout.stateBase + cs486WasmStateField.statsBase;
  const counter = (index: number): number =>
    Number(view.getBigUint64(statsBase + index * 8, true));
  return Object.freeze({
    busTransfers: counter(cs486WasmStatsIndex.busTransfers),
    instructionFetches: counter(cs486WasmStatsIndex.instructionFetches),
    l1Hits: counter(cs486WasmStatsIndex.l1Hits),
    l1Misses: counter(cs486WasmStatsIndex.l1Misses),
    l2Hits: counter(cs486WasmStatsIndex.l2Hits),
    l2Misses: counter(cs486WasmStatsIndex.l2Misses),
    pipelineFlushes: counter(cs486WasmStatsIndex.pipelineFlushes),
    unalignedAccesses: counter(cs486WasmStatsIndex.unalignedAccesses),
  });
}
