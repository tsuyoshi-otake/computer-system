import { createHash } from "node:crypto";

import { createCsAbiBatchSyscallHandler } from "../src/application/runtime/csAbi.js";
import { Cs486Process } from "../src/domain/cpu/cs486.js";
import type { Cs486SyscallHandler } from "../src/domain/cpu/cs486.js";
import type { CpuModel } from "../src/domain/cpu/models.js";
import type {
  Cs486BenchmarkExecutionMode,
  Cs486BenchmarkInstrumentationMode,
} from "./cs486-interpreter-benchmark-entry.js";
import type {
  Cs486WasmBatchExecutorExports,
  Cs486WasmSessionSnapshot,
} from "./wasm-engines/wasm-engine-core.js";
import { createCs486WasmExecutableSession } from "./wasm-engines/wasm-engine-core.js";
import type { Cs486WasmHostMemory } from "./wasm-engines/wasm-host-runtime.js";
import type { Cs486FuzzProgram } from "./wasm-corpora/cs486-fuzz-generator.js";
import {
  cs486FuzzForcedCases,
  cs486FuzzRandom,
  generateCs486FuzzProgram,
} from "./wasm-corpora/cs486-fuzz-generator.js";
import { cs486BatchCsAbiForcedCases } from "./wasm-corpora/batch-cs-abi-corpus.js";

export { cs486WasmRequiredExports } from "./cs486-wasm-batch-executor-abi.js";

/**
 * Differential-equivalence suite for the Issue #106 wasm batch executor.
 * Every program (deterministic forced cases plus seed-derived fuzz programs)
 * runs on the production TypeScript interpreter and on one wasm variant
 * under an identical seed-derived slice plan; after every slice the full
 * observable state (slice accounting, all registers, pc, pending debt,
 * output, microarchitecture counters, and the guest RAM SHA-256) must match
 * bit for bit. Any mismatch is a divergence; zero divergences across both
 * variants is the Issue #106 adoption-gate equivalence evidence.
 */
export interface Cs486WasmEquivalenceOptions {
  readonly cpuModels?: readonly CpuModel[];
  readonly executionModes?: readonly Cs486BenchmarkExecutionMode[];
  readonly instrumentationModes?: readonly Cs486BenchmarkInstrumentationMode[];
  readonly seedCount?: number;
}

export interface Cs486WasmEquivalenceReport {
  /** Individual field comparisons that were actually evaluated. */
  readonly comparisons: number;
  /** program x cpu x mode x instrumentation configurations executed. */
  readonly configurations: number;
  readonly divergences: readonly string[];
  readonly engine: string;
  readonly programs: readonly string[];
}

export const cs486WasmEquivalenceCpuModels: readonly CpuModel[] = [
  "cs386sx",
  "cs486dx",
  "cs486dx2",
];
const allExecutionModes: readonly Cs486BenchmarkExecutionMode[] = [
  "cpu-slice",
  "instruction-slice",
];
const allInstrumentationModes: readonly Cs486BenchmarkInstrumentationMode[] = [
  "enabled",
  "disabled",
];
const defaultSeedCount = 32;
const plannedSliceCount = 12;
const maximumSliceCount = 40;
const maximumRecordedDivergencesPerConfiguration = 8;
const guestMemoryInspectionChunkBytes = 4_096;

interface GuestSnapshot {
  readonly completedValue: number | null;
  readonly errorMessage: string | null;
  readonly errorName: string | null;
  readonly guestRamSha256: string;
  readonly hasPendingCpuCycles: boolean;
  readonly instructionPointer: number;
  readonly microarchitecture: Readonly<Record<string, number>> | null;
  readonly output: string;
  readonly processStateKind: string;
  readonly registers: Readonly<Record<string, number>>;
}

export function runCs486WasmEquivalenceSuite(
  wasm: {
    readonly exports: Cs486WasmBatchExecutorExports;
    readonly memory: Cs486WasmHostMemory;
  },
  engineName: string,
  options: Cs486WasmEquivalenceOptions = {},
): Cs486WasmEquivalenceReport {
  const cpuModels = options.cpuModels ?? cs486WasmEquivalenceCpuModels;
  const executionModes = options.executionModes ?? allExecutionModes;
  const instrumentationModes =
    options.instrumentationModes ?? allInstrumentationModes;
  const seedCount = options.seedCount ?? defaultSeedCount;
  if (!Number.isSafeInteger(seedCount) || seedCount < 0 || seedCount > 512)
    throw new RangeError("seedCount must be an integer between 0 and 512");
  const programs: Cs486FuzzProgram[] = [
    ...cs486FuzzForcedCases(),
    // The one production path where a worker services a CS ABI operation, and
    // therefore the only corpus that compares syscall-context memory access,
    // startup images, and rejection faults across the two engines.
    ...cs486BatchCsAbiForcedCases(),
    ...Array.from({ length: seedCount }, (_, index) =>
      generateCs486FuzzProgram(index + 1),
    ),
  ];
  // Region bases are captured once from the untouched module so every
  // session in the sweep reuses the same layout start.
  const startOffset = wasm.memory.buffer.byteLength;
  const divergences: string[] = [];
  let comparisons = 0;
  let configurations = 0;
  const count = (): void => {
    comparisons += 1;
  };
  for (const program of programs)
    for (const cpuModel of cpuModels)
      for (const executionMode of executionModes)
        for (const instrumentation of instrumentationModes) {
          configurations += 1;
          compareConfiguration(
            wasm,
            engineName,
            program,
            cpuModel,
            executionMode,
            instrumentation,
            startOffset,
            divergences,
            count,
          );
        }
  return Object.freeze({
    comparisons,
    configurations,
    divergences: Object.freeze(divergences),
    engine: engineName,
    programs: Object.freeze(programs.map((program) => program.name)),
  });
}

function compareConfiguration(
  wasm: {
    readonly exports: Cs486WasmBatchExecutorExports;
    readonly memory: Cs486WasmHostMemory;
  },
  engineName: string,
  program: Cs486FuzzProgram,
  cpuModel: CpuModel,
  executionMode: Cs486BenchmarkExecutionMode,
  instrumentation: Cs486BenchmarkInstrumentationMode,
  startOffset: number,
  divergences: string[],
  count: () => void,
): void {
  const label = `program=${program.name} engine=${engineName} cpu=${cpuModel} mode=${executionMode} instrumentation=${instrumentation}`;
  // Each side gets its own handler instance because the handler owns the
  // process-scoped output budget; sharing one would let the first side's writes
  // change the second side's ENOSPC boundary.
  const guestSyscalls = batchSyscalls(program);
  const guest = new Cs486Process(program.executable, {
    collectMicroarchitectureStats: instrumentation === "enabled",
    cpuModel,
    memoryBytes: program.memoryBytes,
    ...(guestSyscalls === undefined
      ? {}
      : { syscallHandler: guestSyscalls.handler }),
  });
  guestSyscalls?.attach((text) => {
    guest.appendOutput(text);
  });
  if (program.processImage !== undefined)
    guest.initializeProcessImage(program.processImage);
  const wasmSyscalls = batchSyscalls(program);
  const session = createCs486WasmExecutableSession(
    wasm.exports,
    wasm.memory,
    program.executable,
    {
      cpuModel,
      instrumentation,
      memoryBytes: program.memoryBytes,
      ...(program.processImage === undefined
        ? {}
        : { processImage: program.processImage }),
      startOffset,
      ...(wasmSyscalls === undefined
        ? {}
        : { syscallPolicy: wasmSyscalls.handler }),
    },
  );
  wasmSyscalls?.attach((text) => {
    session.appendOutput(text);
  });
  const planRandom = cs486FuzzRandom(
    planSeed(program.name, cpuModel, executionMode, instrumentation),
  );
  const localDivergences: string[] = [];
  const report = (
    slice: number,
    field: string,
    ts: unknown,
    other: unknown,
  ) => {
    if (localDivergences.length >= maximumRecordedDivergencesPerConfiguration)
      return;
    localDivergences.push(
      `${label} slice=${String(slice)} field=${field} ts=${String(ts)} wasm=${String(other)}`,
    );
  };
  const compare = (
    slice: number,
    field: string,
    ts: unknown,
    other: unknown,
  ): void => {
    count();
    if (!Object.is(ts, other)) report(slice, field, ts, other);
  };

  for (let slice = 0; slice < maximumSliceCount; slice += 1) {
    const planned = slice < plannedSliceCount;
    const instructionBudget = planned
      ? boundedPlanInteger(
          planRandom,
          16,
          Math.max(16, program.recommendedSliceInstructions),
        )
      : program.recommendedSliceInstructions;
    const cycleBudget =
      planned && executionMode === "cpu-slice" && planRandom() < 0.4
        ? boundedPlanInteger(planRandom, 32, 3_000)
        : Number.MAX_SAFE_INTEGER;
    const tsResult =
      executionMode === "cpu-slice"
        ? guest.runCpuSlice(cycleBudget, instructionBudget)
        : guest.runInstructionSlice(instructionBudget);
    const wasmResult = session.runSlice(
      executionMode,
      cycleBudget,
      instructionBudget,
    );
    compare(slice, "cpuCycles", tsResult.cpuCycles, wasmResult.cpuCycles);
    compare(
      slice,
      "executedInstructions",
      tsResult.executedInstructions,
      wasmResult.executedInstructions,
    );
    compare(slice, "stateKind", tsResult.state.kind, wasmResult.state.kind);
    compareSnapshots(
      slice,
      snapshotGuest(guest),
      session.snapshot(),
      instrumentation,
      compare,
    );
    if (localDivergences.length > 0) break;
    const tsTerminal =
      tsResult.state.kind !== "ready" && !guest.hasPendingCpuCycles;
    const wasmSnapshot = session.snapshot();
    const wasmTerminal =
      wasmResult.state.kind !== "ready" && !wasmSnapshot.hasPendingCpuCycles;
    if (tsTerminal && wasmTerminal) break;
  }
  divergences.push(...localDivergences);
}

/**
 * Isolated CS ABI policy for one side of a batch comparison, or `undefined` for
 * an ordinary program that must keep refusing every syscall. The output sink is
 * late-bound because the handler has to exist before the process or session
 * that owns the output buffer; a syscall can only run inside a slice, which is
 * strictly later, so an unattached sink is a harness defect.
 */
function batchSyscalls(program: Cs486FuzzProgram):
  | {
      readonly attach: (sink: (text: string) => void) => void;
      readonly handler: Cs486SyscallHandler;
    }
  | undefined {
  const layout = program.csAbi;
  if (layout === undefined) return undefined;
  let sink: ((text: string) => void) | undefined;
  return {
    attach: (next: (text: string) => void): void => {
      sink = next;
    },
    handler: createCsAbiBatchSyscallHandler(layout, (text: string): void => {
      if (sink === undefined)
        throw new Error("batch output sink is not attached yet");
      sink(text);
    }),
  };
}

function compareSnapshots(
  slice: number,
  ts: GuestSnapshot,
  wasmSnapshot: Cs486WasmSessionSnapshot,
  instrumentation: Cs486BenchmarkInstrumentationMode,
  compare: (slice: number, field: string, ts: unknown, other: unknown) => void,
): void {
  for (const [name, value] of Object.entries(ts.registers))
    compare(
      slice,
      `register.${name}`,
      value,
      (wasmSnapshot.registers as Readonly<Record<string, number>>)[name],
    );
  compare(
    slice,
    "instructionPointer",
    ts.instructionPointer,
    wasmSnapshot.instructionPointer,
  );
  compare(
    slice,
    "hasPendingCpuCycles",
    ts.hasPendingCpuCycles,
    wasmSnapshot.hasPendingCpuCycles,
  );
  compare(slice, "output", ts.output, wasmSnapshot.output);
  compare(
    slice,
    "processStateKind",
    ts.processStateKind,
    wasmSnapshot.processStateKind,
  );
  compare(
    slice,
    "completedValue",
    ts.completedValue,
    wasmSnapshot.completedValue,
  );
  compare(slice, "errorName", ts.errorName, wasmSnapshot.errorName);
  compare(slice, "errorMessage", ts.errorMessage, wasmSnapshot.errorMessage);
  compare(
    slice,
    "guestRamSha256",
    ts.guestRamSha256,
    wasmSnapshot.guestRamSha256,
  );
  if (instrumentation === "enabled") {
    const tsStats = ts.microarchitecture ?? {};
    const wasmStats =
      (wasmSnapshot.microarchitecture as Readonly<
        Record<string, number>
      > | null) ?? {};
    for (const key of [
      "busTransfers",
      "instructionFetches",
      "l1Hits",
      "l1Misses",
      "l2Hits",
      "l2Misses",
      "pipelineFlushes",
      "unalignedAccesses",
    ])
      compare(slice, `stats.${key}`, tsStats[key], wasmStats[key]);
  }
}

function snapshotGuest(guest: Cs486Process): GuestSnapshot {
  const state = guest.state as Readonly<Record<string, unknown>>;
  const error =
    state.kind === "crashed" ? (state.error as Error | undefined) : undefined;
  return {
    completedValue: state.kind === "completed" ? (state.value as number) : null,
    errorMessage: error === undefined ? null : error.message,
    errorName: error === undefined ? null : error.name,
    guestRamSha256: digestGuestRam(guest),
    hasPendingCpuCycles: guest.hasPendingCpuCycles,
    instructionPointer: guest.instructionAddress,
    microarchitecture: guest.microarchitectureStatsEnabled
      ? (guest.microarchitectureStats as unknown as Readonly<
          Record<string, number>
        >)
      : null,
    output: guest.output,
    processStateKind: state.kind as string,
    registers: guest.registers,
  };
}

/**
 * Mirrors the benchmark entry's non-exported guest RAM digest: bounded
 * 4 KiB inspection chunks over the admitted linear memory limit.
 */
function digestGuestRam(guest: Cs486Process): string {
  const digest = createHash("sha256");
  for (
    let address = 0;
    address < guest.memoryLimitBytes;
    address += guestMemoryInspectionChunkBytes
  )
    digest.update(
      guest.inspectMemory(
        address,
        Math.min(
          guestMemoryInspectionChunkBytes,
          guest.memoryLimitBytes - address,
        ),
      ),
    );
  return digest.digest("hex");
}

function boundedPlanInteger(
  random: () => number,
  minimum: number,
  maximum: number,
): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

/** Deterministic plan seed from the configuration identity (djb2 mix). */
function planSeed(
  programName: string,
  cpuModel: CpuModel,
  executionMode: Cs486BenchmarkExecutionMode,
  instrumentation: Cs486BenchmarkInstrumentationMode,
): number {
  const text = `${programName}|${cpuModel}|${executionMode}|${instrumentation}`;
  let hash = 5_381;
  for (let index = 0; index < text.length; index += 1)
    hash = (Math.imul(hash, 33) ^ text.charCodeAt(index)) >>> 0;
  return hash;
}
