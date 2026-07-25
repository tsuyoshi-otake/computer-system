import { createHash } from "node:crypto";

import {
  Cs486Fault,
  cs486ExecutableDataModel,
} from "../../src/domain/cpu/cs486.js";
import type { CpuModel } from "../../src/domain/cpu/models.js";
import { VmRuntimeError } from "../../src/domain/runtime/errors.js";
import type {
  Cs486BenchmarkExecutionMode,
  Cs486BenchmarkInstrumentationMode,
  Cs486InterpreterSample,
} from "../cs486-interpreter-benchmark-entry.js";
import {
  computeCs486WasmMemoryLayout,
  cs486WasmCacheGeometry,
  cs486WasmExitField,
  cs486WasmExitReason,
  cs486WasmStateField,
} from "../cs486-wasm-batch-executor-abi.js";
import {
  deriveCs486WasmProcessLayout,
  prepareCs486WasmInstructions,
} from "../cs486-wasm-batch-executor-prep.js";
import {
  cs486WasmFaultToError,
  executeCs486WasmColdInstruction,
  rejectCs486WasmSyscall,
} from "../cs486-wasm-cold-op-bridge.js";
import type { Cs486BenchmarkCorpus } from "../wasm-corpora/corpus-registry.js";
import { resolveCs486BenchmarkCorpus } from "../wasm-corpora/corpus-registry.js";
import type { Cs486WasmHostMemory } from "./wasm-host-runtime.js";
import type {
  Cs486WasmBatchExecutorExports,
  Cs486WasmPreparedModelContext,
} from "./wasm-session.js";
import {
  createCs486WasmColdOpMachine,
  cs486WasmEaxRegisterIndex,
  cs486WasmPageBytes,
  readCs486WasmRegisters,
  readCs486WasmStats,
  resetCs486WasmRunState,
  writeCs486WasmParams,
} from "./wasm-session.js";

/**
 * Corpus-driven wasm engine adapter for the Issue #106 A/B harness. The
 * variant-independent host side of the batch-executor ABI lives in
 * `wasm-session.ts`, which the managed compute worker also bundles; this module
 * adds only the benchmark measurement loop and its corpus wiring.
 *
 * The adapter runs inside the harness's esbuild bundle, so it never touches
 * the filesystem; the harness instantiates the artifact and hands the exports
 * and memory in.
 */
export type {
  Cs486WasmBatchExecutorExports,
  Cs486WasmExecutableSession,
  Cs486WasmSessionSnapshot,
  Cs486WasmSessionState,
  Cs486WasmSessionStateKind,
  Cs486WasmSliceResult,
} from "./wasm-session.js";
export { createCs486WasmExecutableSession } from "./wasm-session.js";

export function createCs486WasmBenchmarkMeasure(
  exports: Cs486WasmBatchExecutorExports,
  memory: Cs486WasmHostMemory,
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
  const contexts = new Map<CpuModel, Cs486WasmPreparedModelContext>();
  return (
    cpuModel,
    instructionBudget,
    executionMode = "instruction-slice",
    instrumentation = "enabled",
  ) =>
    measureWasmSample(
      exports,
      memory,
      executable,
      prepareModelContext(contexts, corpus, executable, cpuModel, startOffset),
      cpuModel,
      instructionBudget,
      executionMode,
      instrumentation,
    );
}

function prepareModelContext(
  contexts: Map<CpuModel, Cs486WasmPreparedModelContext>,
  corpus: Cs486BenchmarkCorpus,
  executable: ReturnType<Cs486BenchmarkCorpus["executable"]>,
  cpuModel: CpuModel,
  startOffset: number,
): Cs486WasmPreparedModelContext {
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
    dataModel: cs486ExecutableDataModel(executable),
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
  memory: Cs486WasmHostMemory,
  executable: ReturnType<Cs486BenchmarkCorpus["executable"]>,
  context: Cs486WasmPreparedModelContext,
  cpuModel: CpuModel,
  instructionBudget: number,
  executionMode: Cs486BenchmarkExecutionMode,
  instrumentation: Cs486BenchmarkInstrumentationMode,
): Cs486InterpreterSample {
  const layout = context.memoryLayout;
  if (layout.totalBytes > memory.buffer.byteLength)
    memory.grow(
      Math.ceil(
        (layout.totalBytes - memory.buffer.byteLength) / cs486WasmPageBytes,
      ),
    );
  const buffer = memory.buffer;
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const collectStats = instrumentation === "enabled";
  writeCs486WasmParams(view, layout, context, cpuModel, collectStats);
  resetCs486WasmRunState(view, bytes, layout, context);
  const configureCode = exports.configure(layout.paramsBase);
  if (configureCode !== 0)
    throw new Error(
      `cs486 wasm configure rejected the params block with code ${String(configureCode)}`,
    );

  const instructionCount = executable.instructions.length;
  let output = "";
  let processState: Readonly<Record<string, unknown>> = { kind: "ready" };
  const machine = createCs486WasmColdOpMachine(
    exports,
    view,
    layout,
    context,
    (text) => {
      output += text;
      return output.length;
    },
    rejectCs486WasmSyscall,
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
            layout.registersBase + cs486WasmEaxRegisterIndex * 4,
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
              layout.registersBase + cs486WasmEaxRegisterIndex * 4,
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

  const registers = readCs486WasmRegisters(view, layout);
  const microarchitecture = collectStats
    ? readCs486WasmStats(view, layout)
    : null;
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
