import { createHash } from "node:crypto";

import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";
import { Cs486Fault } from "../../src/domain/cpu/cs486.js";
import type { Cs486Register } from "../../src/domain/cpu/instructionSet.js";
import { cs486RegisterNames } from "../../src/domain/cpu/instructionSet.js";
import type { CpuMicroarchitectureStats } from "../../src/domain/cpu/memoryHierarchy.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";
import { VmRuntimeError } from "../../src/domain/runtime/errors.js";
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
import type {
  Cs486WasmPreparedInstructions,
  Cs486WasmProcessLayout,
} from "../cs486-wasm-batch-executor-prep.js";
import {
  deriveCs486WasmProcessLayout,
  prepareCs486WasmInstructions,
} from "../cs486-wasm-batch-executor-prep.js";
import type {
  Cs486WasmColdOpMachine,
  Cs486WasmSyscallPolicy,
} from "../cs486-wasm-cold-op-bridge.js";
import {
  cs486WasmFaultToError,
  executeCs486WasmColdInstruction,
  rejectCs486WasmSyscall,
} from "../cs486-wasm-cold-op-bridge.js";
import type { Cs486WasmHostMemory } from "./wasm-host-runtime.js";

/**
 * Variant-independent host side of the CS486 wasm batch-executor ABI: region
 * layout, per-run state reset, the slice loop mirroring the production
 * `runCpuSlice`/`runInstructionSlice` debt accounting, and the cold-op bridge
 * dispatch. Both wasm variants run through this exact code, so any observable
 * difference comes from the module itself.
 *
 * This module deliberately depends on nothing from the benchmark harness or
 * its corpora: the managed compute worker bundles it directly, and pulling the
 * corpus registry in would drag the hosted-C toolchain into every worker.
 * `wasm-engines/wasm-engine-core.ts` re-exports this surface for the harness.
 */
export interface Cs486WasmBatchExecutorExports {
  access_data(address: number, kind: number): number;
  configure(paramsBase: number): number;
  fetch_instruction(index: number): number;
  record_control_transfer(taken: number): void;
  run_cpu_slice(cpuCycleBudget: bigint, instructionBudget: bigint): number;
  run_instruction_slice(instructionBudget: bigint): number;
}

/**
 * Slice modes of the production process. Declared locally rather than imported
 * from the benchmark entry so this module stays corpus-free; the string unions
 * are identical, so harness values remain assignable.
 */
export type Cs486WasmSliceMode = "cpu-slice" | "instruction-slice";
export type Cs486WasmInstrumentationMode = "disabled" | "enabled";

export interface Cs486WasmPreparedModelContext {
  readonly geometry: ReturnType<typeof cs486WasmCacheGeometry>;
  readonly instructions: Cs486Executable["instructions"];
  readonly memoryLayout: Cs486WasmMemoryLayout;
  readonly prepared: Cs486WasmPreparedInstructions;
  readonly processLayout: Cs486WasmProcessLayout;
}

export const cs486WasmPageBytes = 65_536;
export const cs486WasmEaxRegisterIndex = 0;

const espRegisterIndex = cs486RegisterNames.indexOf("esp");

/**
 * Session states the wasm executor can reach. Guest sleeping and event waits
 * are impossible here because every syscall is a cold exit owned by the host
 * policy, so the union is exactly the production union minus those two.
 */
export type Cs486WasmSessionState =
  | { readonly kind: "completed"; readonly value: number }
  | { readonly kind: "crashed"; readonly error: VmRuntimeError }
  | { readonly kind: "ready" }
  | { readonly kind: "terminated"; readonly reason: string };

export type Cs486WasmSessionStateKind = Cs486WasmSessionState["kind"];

export interface Cs486WasmSliceResult {
  readonly cpuCycles: number;
  readonly executedInstructions: number;
  readonly state: Cs486WasmSessionState;
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
  readonly hasPendingCpuCycles: boolean;
  /** Admitted guest RAM, mirroring `Cs486Process.memoryLimitBytes`. */
  readonly memoryBytes: number;
  readonly microarchitectureStats: CpuMicroarchitectureStats;
  readonly microarchitectureStatsEnabled: boolean;
  readonly output: string;
  readonly state: Cs486WasmSessionState;
  fail(error: VmRuntimeError): Cs486WasmSessionState;
  registerValue(register: Cs486Register): number;
  runSlice(
    mode: Cs486WasmSliceMode,
    cycleBudget: number,
    instructionBudget: number,
  ): Cs486WasmSliceResult;
  /** Hashes all guest RAM; never call this on a per-slice path. */
  snapshot(): Cs486WasmSessionSnapshot;
  terminate(reason: string): Cs486WasmSessionState;
}

export interface Cs486WasmSessionOptions {
  readonly cpuModel: CpuModel;
  readonly instrumentation: Cs486WasmInstrumentationMode;
  readonly memoryBytes: number;
  readonly startOffset: number;
  /**
   * Host policy for every syscall except the inline `cs.print.character`
   * primitive. Defaults to the harness policy, which rejects float syscalls as
   * a host error and every other syscall as the production `UnsupportedError`.
   */
  readonly syscallPolicy?: Cs486WasmSyscallPolicy;
}

/**
 * Creates a per-executable slice session. Budgets here are real per-slice
 * bounds, so this mirrors the production `runCpuSlice`/`runInstructionSlice`
 * return contract slice by slice: a terminal state with no debt returns a
 * zero-progress result, cpu-slice mode pays banked cycle debt from the slice
 * budget first, and instruction-slice mode never owns debt. Sessions share one
 * `startOffset` region and creating a session rewrites every region, so at
 * most one session per module instance may be live at a time.
 */
export function createCs486WasmExecutableSession(
  exports: Cs486WasmBatchExecutorExports,
  memory: Cs486WasmHostMemory,
  executable: Cs486Executable,
  options: Cs486WasmSessionOptions,
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
      Math.ceil(
        (layout.totalBytes - memory.buffer.byteLength) / cs486WasmPageBytes,
      ),
    );
  const view = new DataView(memory.buffer);
  const bytes = new Uint8Array(memory.buffer);
  const collectStats = options.instrumentation === "enabled";
  const setupContext: Cs486WasmPreparedModelContext = {
    geometry,
    instructions: executable.instructions,
    memoryLayout: layout,
    prepared,
    processLayout,
  };
  writeCs486WasmParams(
    view,
    layout,
    setupContext,
    options.cpuModel,
    collectStats,
  );
  resetCs486WasmRunState(view, bytes, layout, setupContext);
  const configureCode = exports.configure(layout.paramsBase);
  if (configureCode !== 0)
    throw new Error(
      `cs486 wasm configure rejected the params block with code ${String(configureCode)}`,
    );

  // The RAM image has been copied into linear memory, so nothing below may
  // reference `processLayout` or `setupContext`: keeping them reachable would
  // retain a second full copy of every guest RAM, and one compute worker hosts
  // up to 128 sessions at once.
  const guestMemoryBytes = processLayout.memoryBytes;
  const runtimeContext: Cs486WasmPreparedModelContext = {
    ...setupContext,
    processLayout: { ...processLayout, initialRam: new Uint8Array(0) },
  };
  const instructionCount = executable.instructions.length;
  let output = "";
  let state: Cs486WasmSessionState = { kind: "ready" };
  const machine = createCs486WasmColdOpMachine(
    exports,
    view,
    layout,
    runtimeContext,
    (text) => {
      output += text;
      return output.length;
    },
    options.syscallPolicy ?? rejectCs486WasmSyscall,
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
    state = {
      kind: "completed",
      value: view.getInt32(
        layout.registersBase + cs486WasmEaxRegisterIndex * 4,
        true,
      ),
    };
  };
  const isTerminal = (): boolean => state.kind !== "ready";

  const runSlice = (
    mode: Cs486WasmSliceMode,
    cycleBudget: number,
    instructionBudget: number,
  ): Cs486WasmSliceResult => {
    const isCpuSlice = mode === "cpu-slice";
    if (isTerminal()) {
      // Terminal semantics of the production slices: runCpuSlice still pays
      // banked debt from the budget, runInstructionSlice returns unchanged.
      if (isCpuSlice) {
        const debt = readDebt();
        if (debt > 0) {
          const paid = Math.min(debt, cycleBudget);
          writeDebt(debt - paid);
          return { cpuCycles: paid, executedInstructions: 0, state };
        }
      }
      return { cpuCycles: 0, executedInstructions: 0, state };
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
          state = {
            error: new VmRuntimeError(fault.typeName, fault.message),
            kind: "crashed",
          };
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
              state = {
                error: new VmRuntimeError(error.typeName, error.message),
                kind: "crashed",
              };
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
      state,
    };
  };

  const snapshot = (): Cs486WasmSessionSnapshot => ({
    completedValue: state.kind === "completed" ? state.value : null,
    errorMessage: state.kind === "crashed" ? state.error.message : null,
    errorName: state.kind === "crashed" ? state.error.name : null,
    guestRamSha256: createHash("sha256")
      .update(new Uint8Array(memory.buffer, layout.ramBase, guestMemoryBytes))
      .digest("hex"),
    hasPendingCpuCycles: readDebt() > 0,
    instructionPointer: view.getInt32(
      layout.stateBase + cs486WasmStateField.instructionPointer,
      true,
    ),
    microarchitecture: collectStats ? readCs486WasmStats(view, layout) : null,
    output,
    processStateKind: state.kind,
    registers: readCs486WasmRegisters(view, layout),
  });

  return {
    fail(error) {
      // Production `fail`/`terminate` are no-ops once terminal, so the first
      // recorded outcome stays the one observable terminal state.
      if (!isTerminal()) state = { error, kind: "crashed" };
      return state;
    },
    get hasPendingCpuCycles() {
      return readDebt() > 0;
    },
    memoryBytes: guestMemoryBytes,
    get microarchitectureStats() {
      return readCs486WasmStats(view, layout);
    },
    microarchitectureStatsEnabled: collectStats,
    get output() {
      return output;
    },
    registerValue(register) {
      return view.getInt32(
        layout.registersBase + cs486RegisterIndex(register) * 4,
        true,
      );
    },
    runSlice,
    snapshot,
    get state() {
      return state;
    },
    terminate(reason) {
      if (!isTerminal()) state = { kind: "terminated", reason };
      return state;
    },
  };
}

/** Guest stack pointer, read without materializing the register record. */
export function cs486WasmStackPointer(
  session: Cs486WasmExecutableSession,
): number {
  return session.registerValue(cs486RegisterNames[espRegisterIndex]!);
}

export function writeCs486WasmParams(
  view: DataView,
  layout: Cs486WasmMemoryLayout,
  context: Cs486WasmPreparedModelContext,
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
export function resetCs486WasmRunState(
  view: DataView,
  bytes: Uint8Array,
  layout: Cs486WasmMemoryLayout,
  context: Cs486WasmPreparedModelContext,
): void {
  const prepared = context.prepared;
  bytes.set(prepared.opcodes, layout.opcodesBase);
  bytes.set(prepared.executionFlags, layout.flagsBase);
  bytes.set(prepared.branchCycleDeltas, layout.branchDeltaBase);
  bytes.set(
    cs486WasmTypedArrayBytes(prepared.baseCycles),
    layout.baseCyclesBase,
  );
  bytes.set(cs486WasmTypedArrayBytes(prepared.operandA), layout.operandABase);
  bytes.set(cs486WasmTypedArrayBytes(prepared.operandB), layout.operandBBase);
  bytes.set(
    cs486WasmTypedArrayBytes(context.processLayout.initialRegisters),
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

export function cs486WasmTypedArrayBytes(
  array: Int32Array | Uint32Array,
): Uint8Array {
  // Host is little-endian on every supported Node platform, matching the
  // wasm linear-memory byte order; the loader asserts nothing further.
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}

export function createCs486WasmColdOpMachine(
  exports: Cs486WasmBatchExecutorExports,
  view: DataView,
  layout: Cs486WasmMemoryLayout,
  context: Cs486WasmPreparedModelContext,
  appendOutput: (text: string) => number,
  syscallPolicy: Cs486WasmSyscallPolicy,
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
    syscall: syscallPolicy,
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

export function readCs486WasmRegisters(
  view: DataView,
  layout: Cs486WasmMemoryLayout,
): Record<Cs486Register, number> {
  const registers = {} as Record<Cs486Register, number>;
  cs486RegisterNames.forEach((name, index) => {
    registers[name] = view.getInt32(layout.registersBase + index * 4, true);
  });
  return registers;
}

export function readCs486WasmStats(
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

function cs486RegisterIndex(register: Cs486Register): number {
  const index = cs486RegisterNames.indexOf(register);
  if (index < 0)
    throw new RangeError(`unknown CS486 register ${String(register)}`);
  return index;
}
