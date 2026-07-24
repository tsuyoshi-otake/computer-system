import type { CpuModel } from "../src/domain/cpu/models.js";
import { cpuModelSpecification } from "../src/domain/cpu/models.js";

/**
 * Shared ABI for the gated Issue #106 Phase 4 CS486 wasm batch-executor
 * prototype. The Rust and AssemblyScript variants implement this exact
 * contract so the host loader, prep tables, cold-op bridge, and harness stay
 * variant-independent. This module is host tooling only; it never ships in
 * the Bedrock pack and never modifies production CPU sources.
 *
 * Layout ownership: the host computes every region offset (relative to the
 * variant's own exported linear memory) and passes them through one params
 * block, so the two variants cannot disagree about layout. Both variants
 * export their own memory and import nothing.
 */
export const cs486WasmAbiVersion = 1;

/**
 * Prepared numeric opcodes mirroring the production interpreter's private
 * prepared-instruction table (documented in `src/domain/cpu/cs486.ts`). The
 * numbering is part of this prototype ABI; equivalence with production is
 * proven behaviorally by the differential harness, not by sharing tables.
 */
export const cs486WasmOpcode = {
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
  multiplyImmediate: 23,
  multiplyRegister: 24,
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

export type Cs486WasmOpcodeName = keyof typeof cs486WasmOpcode;

/** Per-instruction execution flags stored in the flags SoA byte array. */
export const cs486WasmInstructionFlag = {
  conditionalBranch: 1,
  unconditionalControlTransfer: 2,
  /** CS386SX-only dynamic early-out multiply cost (set at prep per model). */
  dynamicMultiply: 4,
  /** Instruction the wasm executor must exit on instead of executing. */
  coldExit: 8,
} as const;

/** Exit reasons written by `run_cpu_slice` / `run_instruction_slice`. */
export const cs486WasmExitReason = {
  none: 0,
  budgetExhausted: 1,
  coldInstruction: 2,
  fault: 3,
  endOfProgram: 4,
} as const;

/**
 * Numeric fault identities. The wasm side reports code + operand only; the
 * cold-op bridge reconstructs the exact production fault type and message.
 */
export const cs486WasmFaultCode = {
  memoryAccess: 1,
  memoryAlignment: 2,
  stackOverflow: 3,
  stackUnderflow: 4,
  divisionByZero: 5,
  /** `executeNext` prologue bounds fault (pc outside `0..count`). */
  instructionRange: 6,
  /** `ret` runtime target fault (`checkedInstructionTarget`). */
  returnTargetRange: 7,
} as const;

export const cs486WasmCpuModelCode = {
  cs386sx: 0,
  cs486dx: 1,
  cs486dx2: 2,
} as const;

/** Byte offsets of the i32 fields inside the params block. */
export const cs486WasmParamsField = {
  abiVersion: 0,
  cpuModelCode: 4,
  collectStats: 8,
  instructionCount: 12,
  memoryBytes: 16,
  stackFloorBytes: 20,
  ramBase: 24,
  opcodesBase: 28,
  flagsBase: 32,
  branchDeltaBase: 36,
  baseCyclesBase: 40,
  operandABase: 44,
  operandBBase: 48,
  registersBase: 52,
  stateBase: 56,
  exitBase: 60,
  cacheBase: 64,
  cacheBytes: 68,
  l1SetCount: 72,
  l2SetCount: 76,
  cacheLineShift: 80,
  mainMemoryTransferCycles: 84,
} as const;

export const cs486WasmParamsBytes = 96;

/** Byte offsets inside the machine scalar-state block. */
export const cs486WasmStateField = {
  /** i32 */
  instructionPointer: 0,
  /** i64: unwrapped `cmp` difference (never truncated to i32). */
  compared: 8,
  /** i64: guest cycle debt owned by `run_cpu_slice`. */
  cycleDebt: 16,
  /** 8 consecutive u64 counters in `cs486WasmStatsIndex` order. */
  statsBase: 24,
} as const;

export const cs486WasmStateBytes = 96;

/** u64 counter order inside the stats region of the state block. */
export const cs486WasmStatsIndex = {
  busTransfers: 0,
  instructionFetches: 1,
  l1Hits: 2,
  l1Misses: 3,
  l2Hits: 4,
  l2Misses: 5,
  pipelineFlushes: 6,
  unalignedAccesses: 7,
} as const;

/** Byte offsets inside the 32-byte exit record. */
export const cs486WasmExitField = {
  /** i32 `cs486WasmExitReason` */
  reason: 0,
  /** i32 `cs486WasmFaultCode` (0 when reason is not fault) */
  faultCode: 4,
  /** i64 cycles accounted to this run call */
  cyclesConsumed: 8,
  /** i64 instructions executed by this run call */
  instructionsExecuted: 16,
  /** i32 fault detail (address or instruction target) */
  faultOperand: 24,
} as const;

export const cs486WasmExitBytes = 32;

export const cs486WasmRegisterCount = 8;

/** wasm exports both variants must provide. */
export const cs486WasmRequiredExports = [
  "memory",
  "configure",
  "run_cpu_slice",
  "run_instruction_slice",
  "access_data",
  "fetch_instruction",
  "record_control_transfer",
] as const;

export interface Cs486WasmCacheGeometry {
  readonly cacheLineShift: number;
  readonly l1SetCount: number;
  readonly l2SetCount: number;
  readonly mainMemoryTransferCycles: number;
}

const cacheWays = 4;

/** Derives fixed cache geometry from the production CPU model catalog. */
export function cs486WasmCacheGeometry(
  model: CpuModel,
): Cs486WasmCacheGeometry {
  const specification = cpuModelSpecification(model).microarchitecture;
  const lineBytes = specification.cacheLineBytes;
  const cacheLineShift = Math.log2(lineBytes);
  if (!Number.isInteger(cacheLineShift))
    throw new RangeError("cache line bytes must be a power of two");
  return {
    cacheLineShift,
    l1SetCount: specification.l1CacheBytes / (lineBytes * cacheWays),
    l2SetCount: specification.externalCacheBytes / (lineBytes * cacheWays),
    mainMemoryTransferCycles: specification.mainMemoryTransferCycles,
  };
}

/**
 * Bytes both variants need for internal cache/prefetch state. The interior
 * layout is fixed by this ABI so `configure` can validate sufficiency:
 * scalars (32 bytes: prefetched386Line, then per-level clock/mostRecentLine/
 * mostRecentIndex), then per cache level tags i32[sets*4], recency
 * u32[sets*4], and mostRecentIndexBySet i32[sets], each padded to 16 bytes.
 */
export function cs486WasmCacheStateBytes(
  geometry: Cs486WasmCacheGeometry,
): number {
  return (
    32 +
    cacheLevelStateBytes(geometry.l1SetCount) +
    cacheLevelStateBytes(geometry.l2SetCount)
  );
}

function cacheLevelStateBytes(setCount: number): number {
  if (setCount === 0) return 0;
  return (
    alignTo16(setCount * cacheWays * 4) +
    alignTo16(setCount * cacheWays * 4) +
    alignTo16(setCount * 4)
  );
}

export interface Cs486WasmMemoryLayout {
  readonly paramsBase: number;
  readonly stateBase: number;
  readonly exitBase: number;
  readonly registersBase: number;
  readonly opcodesBase: number;
  readonly flagsBase: number;
  readonly branchDeltaBase: number;
  readonly baseCyclesBase: number;
  readonly operandABase: number;
  readonly operandBBase: number;
  readonly cacheBase: number;
  readonly cacheBytes: number;
  readonly ramBase: number;
  readonly totalBytes: number;
}

/**
 * Computes the full region layout starting at `startOffset` (the variant's
 * initial linear-memory size, so host regions never collide with the
 * variant's own stack or static data). All regions are 16-byte aligned.
 */
export function computeCs486WasmMemoryLayout(
  startOffset: number,
  instructionCount: number,
  memoryBytes: number,
  geometry: Cs486WasmCacheGeometry,
): Cs486WasmMemoryLayout {
  if (!Number.isSafeInteger(startOffset) || startOffset < 0)
    throw new RangeError("layout start offset must be a non-negative integer");
  if (!Number.isSafeInteger(instructionCount) || instructionCount < 0)
    throw new RangeError("instruction count must be a non-negative integer");
  if (!Number.isSafeInteger(memoryBytes) || memoryBytes <= 0)
    throw new RangeError("guest RAM bytes must be a positive integer");
  const cacheBytes = cs486WasmCacheStateBytes(geometry);
  let cursor = alignTo16(startOffset);
  const paramsBase = cursor;
  cursor = alignTo16(cursor + cs486WasmParamsBytes);
  const stateBase = cursor;
  cursor = alignTo16(cursor + cs486WasmStateBytes);
  const exitBase = cursor;
  cursor = alignTo16(cursor + cs486WasmExitBytes);
  const registersBase = cursor;
  cursor = alignTo16(cursor + cs486WasmRegisterCount * 4);
  const opcodesBase = cursor;
  cursor = alignTo16(cursor + instructionCount);
  const flagsBase = cursor;
  cursor = alignTo16(cursor + instructionCount);
  const branchDeltaBase = cursor;
  cursor = alignTo16(cursor + instructionCount);
  const baseCyclesBase = cursor;
  cursor = alignTo16(cursor + instructionCount * 4);
  const operandABase = cursor;
  cursor = alignTo16(cursor + instructionCount * 4);
  const operandBBase = cursor;
  cursor = alignTo16(cursor + instructionCount * 4);
  const cacheBase = cursor;
  cursor = alignTo16(cursor + cacheBytes);
  const ramBase = cursor;
  cursor = alignTo16(cursor + memoryBytes);
  return {
    baseCyclesBase,
    branchDeltaBase,
    cacheBase,
    cacheBytes,
    exitBase,
    flagsBase,
    opcodesBase,
    operandABase,
    operandBBase,
    paramsBase,
    ramBase,
    registersBase,
    stateBase,
    totalBytes: cursor,
  };
}

function alignTo16(value: number): number {
  return Math.ceil(value / 16) * 16;
}
