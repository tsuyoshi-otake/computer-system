// Gated Issue #106 CS486 wasm batch executor (AssemblyScript variant).
//
// Semantics are a hand port of the production TypeScript interpreter, held
// bit-identical to it (and to the Rust variant) by the differential
// equivalence harness:
// - slice loops and cycle-debt accounting: src/domain/cpu/cs486.ts
// - cache, bus, and prefetch timing: src/domain/cpu/memoryHierarchy.ts
// - CS386SX early-out multiply: src/domain/cpu/instructionTiming.ts
//
// The binary ABI is defined by tools/cs486-wasm-batch-executor-abi.ts; the
// constants below mirror that module and must never diverge from it.
//
// Contract highlights (same as the Rust variant):
// - zero imports; the module exports its own linear memory
// - raw load<T>/store<T> intrinsics only: no managed arrays, no allocator,
//   runtime "stub", so no GC or abort import can leak into the module
// - every guest fault is pre-checked (division by zero, INT_MIN/-1, memory
//   bounds/alignment, stack bounds, return targets) and reported through the
//   exit record; a wasm trap reaching the host is a bug
// - cold opcodes exit BEFORE any state change; the TS bridge owns them
// - a faulting instruction contributes no cycles and no instruction count,
//   but its prologue effects (pc increment, fetch cache mutations, pipeline
//   flush bookkeeping) persist, exactly like the production crash path

// --- ABI constants (mirror of tools/cs486-wasm-batch-executor-abi.ts) ---

const ABI_VERSION: i32 = 1;

const MODEL_CS386SX: i32 = 0;

// params block field offsets (bytes)
const PARAM_ABI_VERSION: usize = 0;
const PARAM_CPU_MODEL: usize = 4;
const PARAM_COLLECT_STATS: usize = 8;
const PARAM_INSTRUCTION_COUNT: usize = 12;
const PARAM_MEMORY_BYTES: usize = 16;
const PARAM_STACK_FLOOR: usize = 20;
const PARAM_RAM_BASE: usize = 24;
const PARAM_OPCODES_BASE: usize = 28;
const PARAM_FLAGS_BASE: usize = 32;
const PARAM_BRANCH_DELTA_BASE: usize = 36;
const PARAM_BASE_CYCLES_BASE: usize = 40;
const PARAM_OPERAND_A_BASE: usize = 44;
const PARAM_OPERAND_B_BASE: usize = 48;
const PARAM_REGISTERS_BASE: usize = 52;
const PARAM_STATE_BASE: usize = 56;
const PARAM_EXIT_BASE: usize = 60;
const PARAM_CACHE_BASE: usize = 64;
const PARAM_CACHE_BYTES: usize = 68;
const PARAM_L1_SET_COUNT: usize = 72;
const PARAM_L2_SET_COUNT: usize = 76;
const PARAM_CACHE_LINE_SHIFT: usize = 80;
const PARAM_MAIN_MEMORY_TRANSFER_CYCLES: usize = 84;

// state block field offsets (bytes)
const STATE_INSTRUCTION_POINTER: usize = 0;
const STATE_COMPARED: usize = 8;
const STATE_CYCLE_DEBT: usize = 16;
const STATE_STATS: usize = 24;

// exit record field offsets (bytes)
const EXIT_REASON: usize = 0;
const EXIT_FAULT_CODE: usize = 4;
const EXIT_CYCLES_CONSUMED: usize = 8;
const EXIT_INSTRUCTIONS_EXECUTED: usize = 16;
const EXIT_FAULT_OPERAND: usize = 24;

// exit reasons
const EXIT_BUDGET_EXHAUSTED: i32 = 1;
const EXIT_COLD_INSTRUCTION: i32 = 2;
const EXIT_FAULT: i32 = 3;
const EXIT_END_OF_PROGRAM: i32 = 4;

// fault codes
const FAULT_MEMORY_ACCESS: i32 = 1;
const FAULT_MEMORY_ALIGNMENT: i32 = 2;
const FAULT_STACK_OVERFLOW: i32 = 3;
const FAULT_STACK_UNDERFLOW: i32 = 4;
const FAULT_DIVISION_BY_ZERO: i32 = 5;
const FAULT_INSTRUCTION_RANGE: i32 = 6;
const FAULT_RETURN_TARGET_RANGE: i32 = 7;

// instruction execution flags
const FLAG_CONDITIONAL_BRANCH: i32 = 1;
const FLAG_UNCONDITIONAL_CONTROL_TRANSFER: i32 = 2;
const FLAG_DYNAMIC_MULTIPLY: i32 = 4;
const FLAG_COLD_EXIT: i32 = 8;

// stats slot indices (u64 each, at state + STATE_STATS)
const STAT_BUS_TRANSFERS: usize = 0;
const STAT_INSTRUCTION_FETCHES: usize = 1;
const STAT_L1_HITS: usize = 2;
const STAT_L1_MISSES: usize = 3;
const STAT_L2_HITS: usize = 4;
const STAT_L2_MISSES: usize = 5;
const STAT_PIPELINE_FLUSHES: usize = 6;
const STAT_UNALIGNED_ACCESSES: usize = 7;

// opcodes (dense 1..65)
const OP_MOV_IMMEDIATE: i32 = 1;
const OP_MOV_REGISTER: i32 = 2;
const OP_LOAD_IMMEDIATE: i32 = 3;
const OP_LOAD_REGISTER: i32 = 4;
const OP_LOAD8_SIGNED_IMMEDIATE: i32 = 5;
const OP_LOAD8_SIGNED_REGISTER: i32 = 6;
const OP_LOAD8_UNSIGNED_IMMEDIATE: i32 = 7;
const OP_LOAD8_UNSIGNED_REGISTER: i32 = 8;
const OP_LOAD16_SIGNED_IMMEDIATE: i32 = 9;
const OP_LOAD16_SIGNED_REGISTER: i32 = 10;
const OP_LOAD16_UNSIGNED_IMMEDIATE: i32 = 11;
const OP_LOAD16_UNSIGNED_REGISTER: i32 = 12;
const OP_STORE_IMMEDIATE: i32 = 13;
const OP_STORE_REGISTER: i32 = 14;
const OP_STORE8_IMMEDIATE: i32 = 15;
const OP_STORE8_REGISTER: i32 = 16;
const OP_STORE16_IMMEDIATE: i32 = 17;
const OP_STORE16_REGISTER: i32 = 18;
const OP_ADD_IMMEDIATE: i32 = 19;
const OP_ADD_REGISTER: i32 = 20;
const OP_SUB_IMMEDIATE: i32 = 21;
const OP_SUB_REGISTER: i32 = 22;
const OP_MUL_IMMEDIATE: i32 = 23;
const OP_MUL_REGISTER: i32 = 24;
const OP_DIV_IMMEDIATE: i32 = 25;
const OP_DIV_REGISTER: i32 = 26;
const OP_UDIV_IMMEDIATE: i32 = 27;
const OP_UDIV_REGISTER: i32 = 28;
const OP_MOD_IMMEDIATE: i32 = 29;
const OP_MOD_REGISTER: i32 = 30;
const OP_UMOD_IMMEDIATE: i32 = 31;
const OP_UMOD_REGISTER: i32 = 32;
const OP_AND_IMMEDIATE: i32 = 33;
const OP_AND_REGISTER: i32 = 34;
const OP_OR_IMMEDIATE: i32 = 35;
const OP_OR_REGISTER: i32 = 36;
const OP_XOR_IMMEDIATE: i32 = 37;
const OP_XOR_REGISTER: i32 = 38;
const OP_SHL_IMMEDIATE: i32 = 39;
const OP_SHL_REGISTER: i32 = 40;
const OP_SHR_IMMEDIATE: i32 = 41;
const OP_SHR_REGISTER: i32 = 42;
const OP_USHR_IMMEDIATE: i32 = 43;
const OP_USHR_REGISTER: i32 = 44;
const OP_COMPARE_IMMEDIATE: i32 = 45;
const OP_COMPARE_REGISTER: i32 = 46;
const OP_JE: i32 = 47;
const OP_JNE: i32 = 48;
const OP_JL: i32 = 49;
const OP_JLE: i32 = 50;
const OP_JG: i32 = 51;
const OP_JUMP: i32 = 53;
const OP_PUSH_IMMEDIATE: i32 = 54;
const OP_PUSH_REGISTER: i32 = 55;
const OP_POP: i32 = 56;
const OP_CALL: i32 = 57;
const OP_RETURN: i32 = 60;

const REG_ESP: i32 = 6;

// Matches instructionCodeBase in memoryHierarchy.ts.
const INSTRUCTION_CODE_BASE: u32 = 0x10000000;

// --- configuration (flat mutable globals; no managed objects) ---

let cfgConfigured: bool = false;
let cfgModel: i32 = 0;
let cfgCollectStats: bool = false;
let cfgCount: i32 = 0;
let cfgMemoryBytes: i32 = 0;
let cfgStackFloor: i32 = 0;
let cfgRam: usize = 0;
let cfgOpcodes: usize = 0;
let cfgFlags: usize = 0;
let cfgBranchDelta: usize = 0;
let cfgBaseCycles: usize = 0;
let cfgOperandA: usize = 0;
let cfgOperandB: usize = 0;
let cfgRegisters: usize = 0;
let cfgState: usize = 0;
let cfgExit: usize = 0;
let cfgStats: usize = 0;
let cfgMainMemoryTransferCycles: i32 = 0;
let cfgLineShift: u32 = 0;
let cfgLineMask: u32 = 0;
let cfgLineLastDwordStart: u32 = 0;
let cfgLineDwordTransfers: i32 = 0;
let cfgInstructionLineTransfers: i32 = 0;
let cfgL1Sets: i32 = 0;
let cfgL2Sets: i32 = 0;
let cfgPrefetchAddress: usize = 0;

// per-level cache state addresses and geometry
let l1Tags: usize = 0;
let l1Recency: usize = 0;
let l1Mris: usize = 0;
let l1ClockAddress: usize = 0;
let l1MostRecentLineAddress: usize = 0;
let l1MostRecentIndexAddress: usize = 0;
let l1SetMask: u32 = 0;
let l1SetShift: u32 = 0;
let l2Tags: usize = 0;
let l2Recency: usize = 0;
let l2Mris: usize = 0;
let l2ClockAddress: usize = 0;
let l2MostRecentLineAddress: usize = 0;
let l2MostRecentIndexAddress: usize = 0;
let l2SetMask: u32 = 0;
let l2SetShift: u32 = 0;

// step() fault channel: no tuples/exceptions in this no-managed-code subset,
// so a helper returning a negative cycle count signals a fault through these.
let gFaultCode: i32 = 0;
let gFaultOperand: i32 = 0;
let gPc: i32 = 0;
let gCompared: i64 = 0;
let gPopValue: i32 = 0;

function align16(bytes: u32): u32 {
  return (bytes + 15) & ~15;
}

function validSetCount(sets: i32): bool {
  return sets == 0 || (sets > 0 && (sets & (sets - 1)) == 0);
}

// Bytes one cache level occupies past the 32-byte scalar prefix (mirrors
// cs486WasmCacheStateBytes): 4-way tags and recency words plus one
// most-recent-index-by-set word per set, each region padded to 16 bytes.
function levelBytes(sets: i32): u32 {
  if (sets <= 0) return 0;
  const wayWords: u32 = <u32>sets * 4 * 4;
  return align16(wayWords) + align16(wayWords) + align16(<u32>sets * 4);
}

function initLevelArrays(tags: usize, recency: usize, mris: usize, sets: i32): void {
  for (let index: u32 = 0; index < <u32>sets * 4; index += 1) {
    store<i32>(tags + <usize>index * 4, -1);
    store<u32>(recency + <usize>index * 4, 0);
  }
  for (let set: u32 = 0; set < <u32>sets; set += 1) {
    store<i32>(mris + <usize>set * 4, -1);
  }
}

// Reads the params block, validates it, and initializes the cache region.
// Registers, RAM, SoA tables, and the state block stay host-owned. Returns 0
// on success or a nonzero code identifying the rejected field (same codes as
// the Rust variant).
export function configure(paramsBase: i32): i32 {
  if (paramsBase <= 0) return 1;
  const p: usize = <usize>paramsBase;
  if (load<i32>(p + PARAM_ABI_VERSION) != ABI_VERSION) return 2;
  const model = load<i32>(p + PARAM_CPU_MODEL);
  if (model < 0 || model > 2) return 3;
  const collectStats = load<i32>(p + PARAM_COLLECT_STATS) != 0;
  const count = load<i32>(p + PARAM_INSTRUCTION_COUNT);
  if (count < 0) return 4;
  const memoryBytes = load<i32>(p + PARAM_MEMORY_BYTES);
  if (memoryBytes < 0) return 5;
  const stackFloor = load<i32>(p + PARAM_STACK_FLOOR);
  if (stackFloor < 0 || stackFloor > memoryBytes) return 6;
  const lineShift = load<i32>(p + PARAM_CACHE_LINE_SHIFT);
  if (lineShift < 2 || lineShift > 31) return 7;
  const mainMemoryTransferCycles = load<i32>(p + PARAM_MAIN_MEMORY_TRANSFER_CYCLES);
  if (mainMemoryTransferCycles < 0) return 8;
  const l1Sets = load<i32>(p + PARAM_L1_SET_COUNT);
  const l2Sets = load<i32>(p + PARAM_L2_SET_COUNT);
  if (!validSetCount(l1Sets) || !validSetCount(l2Sets) || (l1Sets == 0 && l2Sets != 0)) {
    return 9;
  }
  const cacheBase = load<i32>(p + PARAM_CACHE_BASE);
  const cacheBytes = load<i32>(p + PARAM_CACHE_BYTES);
  if (
    cacheBase <= 0 ||
    cacheBytes < 0 ||
    <u32>cacheBytes < 32 + levelBytes(l1Sets) + levelBytes(l2Sets)
  ) {
    return 10;
  }
  const ram = load<i32>(p + PARAM_RAM_BASE);
  const opcodes = load<i32>(p + PARAM_OPCODES_BASE);
  const flags = load<i32>(p + PARAM_FLAGS_BASE);
  const branchDelta = load<i32>(p + PARAM_BRANCH_DELTA_BASE);
  const baseCycles = load<i32>(p + PARAM_BASE_CYCLES_BASE);
  const operandA = load<i32>(p + PARAM_OPERAND_A_BASE);
  const operandB = load<i32>(p + PARAM_OPERAND_B_BASE);
  const registers = load<i32>(p + PARAM_REGISTERS_BASE);
  const state = load<i32>(p + PARAM_STATE_BASE);
  const exit = load<i32>(p + PARAM_EXIT_BASE);
  if (
    ram <= 0 ||
    opcodes <= 0 ||
    flags <= 0 ||
    branchDelta <= 0 ||
    baseCycles <= 0 ||
    operandA <= 0 ||
    operandB <= 0 ||
    registers <= 0 ||
    state <= 0 ||
    exit <= 0
  ) {
    return 11;
  }

  const cache: usize = <usize>cacheBase;
  const lineBytes: u32 = 1 << <u32>lineShift;
  const l1WayBytes = align16(<u32>l1Sets * 16);
  const l2WayBytes = align16(<u32>l2Sets * 16);

  cfgModel = model;
  cfgCollectStats = collectStats;
  cfgCount = count;
  cfgMemoryBytes = memoryBytes;
  cfgStackFloor = stackFloor;
  cfgRam = <usize>ram;
  cfgOpcodes = <usize>opcodes;
  cfgFlags = <usize>flags;
  cfgBranchDelta = <usize>branchDelta;
  cfgBaseCycles = <usize>baseCycles;
  cfgOperandA = <usize>operandA;
  cfgOperandB = <usize>operandB;
  cfgRegisters = <usize>registers;
  cfgState = <usize>state;
  cfgExit = <usize>exit;
  cfgStats = <usize>state + STATE_STATS;
  cfgMainMemoryTransferCycles = mainMemoryTransferCycles;
  cfgLineShift = <u32>lineShift;
  cfgLineMask = lineBytes - 1;
  cfgLineLastDwordStart = lineBytes - 4;
  cfgLineDwordTransfers = <i32>(lineBytes >> 2);
  cfgInstructionLineTransfers = <i32>(
    lineBytes >> (model == MODEL_CS386SX ? 1 : 2)
  );
  cfgL1Sets = l1Sets;
  cfgL2Sets = l2Sets;
  cfgPrefetchAddress = cache;

  // Cache scalars overlay by model inside the 32-byte prefix: CS386SX owns
  // only prefetched386Line at +0; the 486 models own l1 clock/mru at +0..15
  // and l2 clock/mru at +16..31. A model never reads the other family's
  // scalars, so sharing offset 0 is safe.
  l1Tags = cache + 32;
  l1Recency = l1Tags + l1WayBytes;
  l1Mris = l1Recency + l1WayBytes;
  l1ClockAddress = cache;
  l1MostRecentLineAddress = cache + 8;
  l1MostRecentIndexAddress = cache + 12;
  l1SetMask = l1Sets > 0 ? <u32>l1Sets - 1 : 0;
  l1SetShift = <u32>(ctz<u32>(<u32>l1Sets) & 31);
  l2Tags = l1Mris + align16(<u32>l1Sets * 4);
  l2Recency = l2Tags + l2WayBytes;
  l2Mris = l2Recency + l2WayBytes;
  l2ClockAddress = cache + 16;
  l2MostRecentLineAddress = cache + 24;
  l2MostRecentIndexAddress = cache + 28;
  l2SetMask = l2Sets > 0 ? <u32>l2Sets - 1 : 0;
  l2SetShift = <u32>(ctz<u32>(<u32>l2Sets) & 31);

  // Cold cache state: zero scalars, then the -1 sentinels the production
  // constructors establish (empty tags, no MRU, no prefetched 386 line).
  for (let scalar: usize = 0; scalar < 8; scalar += 1) {
    store<u32>(cache + scalar * 4, 0);
  }
  if (model == MODEL_CS386SX) {
    store<i32>(cfgPrefetchAddress, -1);
  } else {
    store<i32>(l1MostRecentLineAddress, -1);
    store<i32>(l1MostRecentIndexAddress, -1);
    store<i32>(l2MostRecentLineAddress, -1);
    store<i32>(l2MostRecentIndexAddress, -1);
  }
  initLevelArrays(l1Tags, l1Recency, l1Mris, l1Sets);
  initLevelArrays(l2Tags, l2Recency, l2Mris, l2Sets);

  cfgConfigured = true;
  return 0;
}

// --- statistics ---

// @ts-expect-error: decorator
@inline
function statAdd(index: usize, delta: u64): void {
  const address = cfgStats + index * 8;
  store<u64>(address, load<u64>(address) + delta);
}

// --- memory hierarchy (port of CpuMemoryHierarchy / SetAssociativeCache) ---

// Port of SetAssociativeCache.access. The clock is widened to u64 while
// recency stores its low 32 bits, matching the production number clock
// truncated by the Uint32Array recency store.
function cacheAccess(
  tags: usize,
  recency: usize,
  mris: usize,
  clockAddress: usize,
  mostRecentLineAddress: usize,
  mostRecentIndexAddress: usize,
  setMask: u32,
  setShift: u32,
  address: u32,
): bool {
  const lineU: u32 = address >> cfgLineShift;
  const line: i32 = <i32>lineU;
  const clock: u64 = load<u64>(clockAddress) + 1;
  store<u64>(clockAddress, clock);
  const clock32: u32 = <u32>clock;

  const mostRecentIndex = load<i32>(mostRecentIndexAddress);
  if (mostRecentIndex >= 0 && line == load<i32>(mostRecentLineAddress)) {
    store<u32>(recency + <usize>mostRecentIndex * 4, clock32);
    return true;
  }

  const set: u32 = lineU & setMask;
  const tag: i32 = <i32>(lineU >> setShift);
  const base: u32 = set * 4;
  const setMostRecentIndex = load<i32>(mris + <usize>set * 4);
  if (
    setMostRecentIndex >= 0 &&
    load<i32>(tags + <usize>setMostRecentIndex * 4) == tag
  ) {
    store<u32>(recency + <usize>setMostRecentIndex * 4, clock32);
    store<i32>(mostRecentLineAddress, line);
    store<i32>(mostRecentIndexAddress, setMostRecentIndex);
    return true;
  }

  let replacement: u32 = base;
  let oldest: u64 = u64.MAX_VALUE;
  for (let way: u32 = 0; way < 4; way += 1) {
    const index = base + way;
    const storedTag = load<i32>(tags + <usize>index * 4);
    if (storedTag == tag) {
      store<u32>(recency + <usize>index * 4, clock32);
      store<i32>(mris + <usize>set * 4, <i32>index);
      store<i32>(mostRecentLineAddress, line);
      store<i32>(mostRecentIndexAddress, <i32>index);
      return true;
    }
    if (storedTag == -1) {
      replacement = index;
    } else {
      const stamp: u64 = <u64>load<u32>(recency + <usize>index * 4);
      if (stamp < oldest && load<i32>(tags + <usize>replacement * 4) != -1) {
        oldest = stamp;
        replacement = index;
      }
    }
  }
  store<i32>(tags + <usize>replacement * 4, tag);
  store<u32>(recency + <usize>replacement * 4, clock32);
  store<i32>(mris + <usize>set * 4, <i32>replacement);
  store<i32>(mostRecentLineAddress, line);
  store<i32>(mostRecentIndexAddress, <i32>replacement);
  return false;
}

// Port of CpuMemoryHierarchy.accessCachedLine.
function accessCachedLine(address: u32): i32 {
  if (cfgL1Sets == 0) return 0;
  if (
    cacheAccess(
      l1Tags,
      l1Recency,
      l1Mris,
      l1ClockAddress,
      l1MostRecentLineAddress,
      l1MostRecentIndexAddress,
      l1SetMask,
      l1SetShift,
      address,
    )
  ) {
    if (cfgCollectStats) statAdd(STAT_L1_HITS, 1);
    return 0;
  }
  if (cfgCollectStats) statAdd(STAT_L1_MISSES, 1);
  const lineTransfers = cfgLineDwordTransfers;
  if (cfgL2Sets != 0) {
    if (
      cacheAccess(
        l2Tags,
        l2Recency,
        l2Mris,
        l2ClockAddress,
        l2MostRecentLineAddress,
        l2MostRecentIndexAddress,
        l2SetMask,
        l2SetShift,
        address,
      )
    ) {
      if (cfgCollectStats) {
        statAdd(STAT_L2_HITS, 1);
        statAdd(STAT_BUS_TRANSFERS, <u64>lineTransfers);
      }
      return lineTransfers * 2;
    }
    if (cfgCollectStats) statAdd(STAT_L2_MISSES, 1);
  }
  if (cfgCollectStats) statAdd(STAT_BUS_TRANSFERS, <u64>lineTransfers);
  return lineTransfers * cfgMainMemoryTransferCycles;
}

// Port of CpuMemoryHierarchy.fetchInstruction. The 386SX prefetch-queue
// branch keys off the missing L1, exactly like the production check.
function fetchCycles(index: i32): i32 {
  if (cfgCollectStats) statAdd(STAT_INSTRUCTION_FETCHES, 1);
  const address: u32 = INSTRUCTION_CODE_BASE + <u32>index * 4;
  if (cfgL1Sets == 0) {
    const line: i32 = <i32>(address >> cfgLineShift);
    if (line != load<i32>(cfgPrefetchAddress)) {
      store<i32>(cfgPrefetchAddress, line);
      if (cfgCollectStats) {
        statAdd(STAT_BUS_TRANSFERS, <u64>cfgInstructionLineTransfers);
      }
    }
    return 0;
  }
  return accessCachedLine(address);
}

// Port of CpuMemoryHierarchy.accessData. write=false is a read.
function accessDataCycles(address: i32, write: bool): i32 {
  if (cfgModel == MODEL_CS386SX) {
    const transfers: i32 = (address & 1) == 0 ? 2 : 3;
    if (cfgCollectStats) {
      statAdd(STAT_BUS_TRANSFERS, <u64>transfers);
      if (transfers == 3) statAdd(STAT_UNALIGNED_ACCESSES, 1);
    }
    return (transfers - 2) * cfgMainMemoryTransferCycles;
  }
  const a: u32 = <u32>address;
  const unaligned = (a & 3) != 0;
  if (cfgCollectStats && unaligned) statAdd(STAT_UNALIGNED_ACCESSES, 1);
  let cycles: i32 = unaligned ? 1 : 0;
  cycles += accessCachedLine(a);
  if ((a & cfgLineMask) > cfgLineLastDwordStart) {
    cycles += accessCachedLine(a + 3);
  }
  if (write) {
    const transfers: i32 = unaligned ? 2 : 1;
    if (cfgCollectStats) statAdd(STAT_BUS_TRANSFERS, <u64>transfers);
    cycles += transfers * cfgMainMemoryTransferCycles;
  }
  return cycles;
}

// Port of CpuMemoryHierarchy.recordControlTransfer.
function recordTransfer(taken: bool): void {
  if (!taken) return;
  if (cfgCollectStats) statAdd(STAT_PIPELINE_FLUSHES, 1);
  if (cfgModel == MODEL_CS386SX) store<i32>(cfgPrefetchAddress, -1);
}

// --- shared-hierarchy exports for the TS cold-op bridge ---

// kind: 0 = read, 1 = write. Addresses arrive production-checked.
export function access_data(address: i32, kind: i32): i32 {
  if (!cfgConfigured) unreachable();
  return accessDataCycles(address, kind != 0);
}

export function fetch_instruction(index: i32): i32 {
  if (!cfgConfigured) unreachable();
  return fetchCycles(index);
}

export function record_control_transfer(taken: i32): void {
  if (!cfgConfigured) unreachable();
  recordTransfer(taken != 0);
}

// --- instruction execution ---

// @ts-expect-error: decorator
@inline
function getRegister(index: i32): i32 {
  return load<i32>(cfgRegisters + <usize>index * 4);
}

// @ts-expect-error: decorator
@inline
function setRegister(index: i32, value: i32): void {
  store<i32>(cfgRegisters + <usize>index * 4, value);
}

// @ts-expect-error: decorator
@inline
function fault(code: i32, operand: i32): i32 {
  gFaultCode = code;
  gFaultOperand = operand;
  return -1;
}

// Port of checkedAddress: bounds first, then the width-specific alignment
// rule (only 16-bit accesses carry alignment 2; 8/32-bit never fault on it).
// Returns 0 when valid, -1 after recording a fault.
function checkedAddress(value: i32, width: i32, alignment: i32): i32 {
  if (value < 0 || value > cfgMemoryBytes - width) {
    return fault(FAULT_MEMORY_ACCESS, value);
  }
  if (alignment == 2 && (value & 1) != 0) {
    return fault(FAULT_MEMORY_ALIGNMENT, value);
  }
  return 0;
}

// Port of the private push: both bounds violations name StackOverflowError.
// The next pointer is widened to i64 so an esp near i32.MIN cannot wrap.
function pushValue(value: i32): i32 {
  const esp = getRegister(REG_ESP);
  const next: i64 = <i64>esp - 4;
  if (next < <i64>cfgStackFloor || next + 4 > <i64>cfgMemoryBytes) {
    return fault(FAULT_STACK_OVERFLOW, 0);
  }
  const nextTop = <i32>next;
  const cycles = accessDataCycles(nextTop, true);
  store<i32>(cfgRam + <usize>nextTop, value);
  setRegister(REG_ESP, nextTop);
  return cycles;
}

// Port of the private pop: a floor violation keeps the production
// StackOverflowError name; only the top violation is StackUnderflowError.
// The popped value is delivered through gPopValue.
function popValue(): i32 {
  const current = getRegister(REG_ESP);
  if (current < cfgStackFloor) return fault(FAULT_STACK_OVERFLOW, 0);
  if (<i64>current + 4 > <i64>cfgMemoryBytes) {
    return fault(FAULT_STACK_UNDERFLOW, 0);
  }
  const cycles = accessDataCycles(current, false);
  gPopValue = load<i32>(cfgRam + <usize>current);
  setRegister(REG_ESP, current + 4);
  return cycles;
}

// Port of cs386EarlyOutMultiplyCycles using the integer identity
// ceil(log2(magnitude)) == 32 - clz(magnitude - 1); the u32 magnitude keeps
// i32.MIN exact where a signed abs would overflow.
// @ts-expect-error: decorator
@inline
function earlyOutMultiplyCycles(multiplier: i32): i32 {
  if (multiplier == 0) return 9;
  const magnitude: u32 = multiplier < 0 ? ~(<u32>multiplier) + 1 : <u32>multiplier;
  const significantBits: i32 = 32 - <i32>clz<u32>(magnitude - 1);
  const clamped = significantBits < 3 ? 3 : significantBits;
  return clamped + 6 > 38 ? 38 : clamped + 6;
}

function loadWord(destination: i32, address: i32): i32 {
  if (checkedAddress(address, 4, 1) < 0) return -1;
  const cycles = accessDataCycles(address, false);
  setRegister(destination, load<i32>(cfgRam + <usize>address));
  return cycles;
}

function loadByte(destination: i32, address: i32, signed: bool): i32 {
  if (checkedAddress(address, 1, 1) < 0) return -1;
  const cycles = accessDataCycles(address, false);
  const value = signed
    ? <i32>load<i8>(cfgRam + <usize>address)
    : <i32>load<u8>(cfgRam + <usize>address);
  setRegister(destination, value);
  return cycles;
}

function loadHalf(destination: i32, address: i32, signed: bool): i32 {
  if (checkedAddress(address, 2, 2) < 0) return -1;
  const cycles = accessDataCycles(address, false);
  const value = signed
    ? <i32>load<i16>(cfgRam + <usize>address)
    : <i32>load<u16>(cfgRam + <usize>address);
  setRegister(destination, value);
  return cycles;
}

function storeWord(address: i32, source: i32): i32 {
  if (checkedAddress(address, 4, 1) < 0) return -1;
  const cycles = accessDataCycles(address, true);
  store<i32>(cfgRam + <usize>address, getRegister(source));
  return cycles;
}

function storeByte(address: i32, source: i32): i32 {
  if (checkedAddress(address, 1, 1) < 0) return -1;
  const cycles = accessDataCycles(address, true);
  store<u8>(cfgRam + <usize>address, <u8>getRegister(source));
  return cycles;
}

function storeHalf(address: i32, source: i32): i32 {
  if (checkedAddress(address, 2, 2) < 0) return -1;
  const cycles = accessDataCycles(address, true);
  store<u16>(cfgRam + <usize>address, <u16>getRegister(source));
  return cycles;
}

// Port of executeNext for the hot (non-cold) opcodes. The caller has already
// handled end-of-program, range faults, and cold exits, so entry implies
// 0 <= gPc < cfgCount with a hot opcode at gPc. Returns the instruction's
// cycle cost, or -1 with gFaultCode/gFaultOperand set.
function step(): i32 {
  const index = gPc;
  gPc = index + 1;
  const iu: usize = <usize>index;
  const opcode: i32 = <i32>load<u8>(cfgOpcodes + iu);
  const flags: i32 = <i32>load<u8>(cfgFlags + iu);

  let taken = false;
  if ((flags & FLAG_CONDITIONAL_BRANCH) != 0) {
    const value = gCompared;
    if (opcode == OP_JE) taken = value == 0;
    else if (opcode == OP_JNE) taken = value != 0;
    else if (opcode == OP_JL) taken = value < 0;
    else if (opcode == OP_JLE) taken = value <= 0;
    else if (opcode == OP_JG) taken = value > 0;
    else taken = value >= 0;
  }

  let base: i32 = <i32>load<u32>(cfgBaseCycles + iu * 4);
  if ((flags & FLAG_DYNAMIC_MULTIPLY) != 0 && cfgModel == MODEL_CS386SX) {
    const operand = load<i32>(cfgOperandB + iu * 4);
    const multiplier =
      opcode == OP_MUL_IMMEDIATE ? operand : getRegister(operand);
    base = earlyOutMultiplyCycles(multiplier);
  }
  let cycles: i32 =
    base +
    (taken ? <i32>load<u8>(cfgBranchDelta + iu) : 0) +
    fetchCycles(index);
  recordTransfer(
    taken || (flags & FLAG_UNCONDITIONAL_CONTROL_TRANSFER) != 0,
  );

  const a = load<i32>(cfgOperandA + iu * 4);
  const b = load<i32>(cfgOperandB + iu * 4);
  let cost: i32 = 0;
  switch (opcode) {
    case OP_MOV_IMMEDIATE: {
      setRegister(a, b);
      break;
    }
    case OP_MOV_REGISTER: {
      setRegister(a, getRegister(b));
      break;
    }
    case OP_LOAD_IMMEDIATE: {
      if ((cost = loadWord(a, b)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD_REGISTER: {
      if ((cost = loadWord(a, getRegister(b))) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD8_SIGNED_IMMEDIATE: {
      if ((cost = loadByte(a, b, true)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD8_SIGNED_REGISTER: {
      if ((cost = loadByte(a, getRegister(b), true)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD8_UNSIGNED_IMMEDIATE: {
      if ((cost = loadByte(a, b, false)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD8_UNSIGNED_REGISTER: {
      if ((cost = loadByte(a, getRegister(b), false)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD16_SIGNED_IMMEDIATE: {
      if ((cost = loadHalf(a, b, true)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD16_SIGNED_REGISTER: {
      if ((cost = loadHalf(a, getRegister(b), true)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD16_UNSIGNED_IMMEDIATE: {
      if ((cost = loadHalf(a, b, false)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_LOAD16_UNSIGNED_REGISTER: {
      if ((cost = loadHalf(a, getRegister(b), false)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_STORE_IMMEDIATE: {
      if ((cost = storeWord(a, b)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_STORE_REGISTER: {
      if ((cost = storeWord(getRegister(a), b)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_STORE8_IMMEDIATE: {
      if ((cost = storeByte(a, b)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_STORE8_REGISTER: {
      if ((cost = storeByte(getRegister(a), b)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_STORE16_IMMEDIATE: {
      if ((cost = storeHalf(a, b)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_STORE16_REGISTER: {
      if ((cost = storeHalf(getRegister(a), b)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_ADD_IMMEDIATE: {
      setRegister(a, getRegister(a) + b);
      break;
    }
    case OP_ADD_REGISTER: {
      setRegister(a, getRegister(a) + getRegister(b));
      break;
    }
    case OP_SUB_IMMEDIATE: {
      setRegister(a, getRegister(a) - b);
      break;
    }
    case OP_SUB_REGISTER: {
      setRegister(a, getRegister(a) - getRegister(b));
      break;
    }
    case OP_MUL_IMMEDIATE: {
      setRegister(a, getRegister(a) * b);
      break;
    }
    case OP_MUL_REGISTER: {
      setRegister(a, getRegister(a) * getRegister(b));
      break;
    }
    case OP_DIV_IMMEDIATE: {
      if ((cost = divInto(a, b)) < 0) return -1;
      break;
    }
    case OP_DIV_REGISTER: {
      if ((cost = divInto(a, getRegister(b))) < 0) return -1;
      break;
    }
    case OP_UDIV_IMMEDIATE: {
      if ((cost = udivInto(a, b)) < 0) return -1;
      break;
    }
    case OP_UDIV_REGISTER: {
      if ((cost = udivInto(a, getRegister(b))) < 0) return -1;
      break;
    }
    case OP_MOD_IMMEDIATE: {
      if ((cost = modInto(a, b)) < 0) return -1;
      break;
    }
    case OP_MOD_REGISTER: {
      if ((cost = modInto(a, getRegister(b))) < 0) return -1;
      break;
    }
    case OP_UMOD_IMMEDIATE: {
      if ((cost = umodInto(a, b)) < 0) return -1;
      break;
    }
    case OP_UMOD_REGISTER: {
      if ((cost = umodInto(a, getRegister(b))) < 0) return -1;
      break;
    }
    case OP_AND_IMMEDIATE: {
      setRegister(a, getRegister(a) & b);
      break;
    }
    case OP_AND_REGISTER: {
      setRegister(a, getRegister(a) & getRegister(b));
      break;
    }
    case OP_OR_IMMEDIATE: {
      setRegister(a, getRegister(a) | b);
      break;
    }
    case OP_OR_REGISTER: {
      setRegister(a, getRegister(a) | getRegister(b));
      break;
    }
    case OP_XOR_IMMEDIATE: {
      setRegister(a, getRegister(a) ^ b);
      break;
    }
    case OP_XOR_REGISTER: {
      setRegister(a, getRegister(a) ^ getRegister(b));
      break;
    }
    case OP_SHL_IMMEDIATE: {
      setRegister(a, getRegister(a) << b);
      break;
    }
    case OP_SHL_REGISTER: {
      setRegister(a, getRegister(a) << getRegister(b));
      break;
    }
    case OP_SHR_IMMEDIATE: {
      setRegister(a, getRegister(a) >> b);
      break;
    }
    case OP_SHR_REGISTER: {
      setRegister(a, getRegister(a) >> getRegister(b));
      break;
    }
    case OP_USHR_IMMEDIATE: {
      setRegister(a, <i32>(<u32>getRegister(a) >>> <u32>b));
      break;
    }
    case OP_USHR_REGISTER: {
      setRegister(a, <i32>(<u32>getRegister(a) >>> <u32>getRegister(b)));
      break;
    }
    case OP_COMPARE_IMMEDIATE: {
      // compared stays i64-wide: an i32 wrapping subtraction would flip
      // branch polarity near i32.MIN.
      gCompared = <i64>getRegister(a) - <i64>b;
      break;
    }
    case OP_COMPARE_REGISTER: {
      gCompared = <i64>getRegister(a) - <i64>getRegister(b);
      break;
    }
    case OP_JE:
    case OP_JNE:
    case OP_JL:
    case OP_JLE:
    case OP_JG:
    case 52: {
      if (taken) gPc = a;
      break;
    }
    case OP_JUMP: {
      gPc = a;
      break;
    }
    case OP_PUSH_IMMEDIATE: {
      if ((cost = pushValue(a)) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_PUSH_REGISTER: {
      if ((cost = pushValue(getRegister(a))) < 0) return -1;
      cycles += cost;
      break;
    }
    case OP_POP: {
      if ((cost = popValue()) < 0) return -1;
      cycles += cost;
      setRegister(a, gPopValue);
      break;
    }
    case OP_CALL: {
      if ((cost = pushValue(gPc)) < 0) return -1;
      cycles += cost;
      gPc = a;
      break;
    }
    case OP_RETURN: {
      // The pop completes (esp moves, cache mutates) before the target check
      // faults, matching production checkedInstructionTarget.
      if ((cost = popValue()) < 0) return -1;
      cycles += cost;
      const target = gPopValue;
      if (target < 0 || target >= cfgCount) {
        return fault(FAULT_RETURN_TARGET_RANGE, target);
      }
      gPc = target;
      break;
    }
    default: {
      // Cold opcodes exit before step(); reaching here means the host
      // corrupted the opcode or flag tables. Fail loudly.
      unreachable();
    }
  }
  return cycles;
}

// Signed division with the production wrap: i32.MIN / -1 returns i32.MIN
// directly because native i32.div_s would trap on that pair.
function divInto(a: i32, divisor: i32): i32 {
  if (divisor == 0) return fault(FAULT_DIVISION_BY_ZERO, 0);
  const dividend = getRegister(a);
  if (dividend == i32.MIN_VALUE && divisor == -1) {
    setRegister(a, i32.MIN_VALUE);
  } else {
    setRegister(a, dividend / divisor);
  }
  return 0;
}

function udivInto(a: i32, divisor: i32): i32 {
  if (divisor == 0) return fault(FAULT_DIVISION_BY_ZERO, 0);
  setRegister(a, <i32>(<u32>getRegister(a) / <u32>divisor));
  return 0;
}

// Truncated remainder with the dividend's sign; i32.MIN % -1 == 0 in both
// wasm i32.rem_s and the production JS %, so no special case is needed.
function modInto(a: i32, divisor: i32): i32 {
  if (divisor == 0) return fault(FAULT_DIVISION_BY_ZERO, 0);
  const dividend = getRegister(a);
  if (dividend == i32.MIN_VALUE && divisor == -1) {
    setRegister(a, 0);
  } else {
    setRegister(a, dividend % divisor);
  }
  return 0;
}

function umodInto(a: i32, divisor: i32): i32 {
  if (divisor == 0) return fault(FAULT_DIVISION_BY_ZERO, 0);
  setRegister(a, <i32>(<u32>getRegister(a) % <u32>divisor));
  return 0;
}

// --- slice loops ---

function writeExit(
  reason: i32,
  faultCode: i32,
  faultOperand: i32,
  cyclesConsumed: i64,
  instructionsExecuted: i64,
): void {
  store<i32>(cfgExit + EXIT_REASON, reason);
  store<i32>(cfgExit + EXIT_FAULT_CODE, faultCode);
  store<i64>(cfgExit + EXIT_CYCLES_CONSUMED, cyclesConsumed);
  store<i64>(cfgExit + EXIT_INSTRUCTIONS_EXECUTED, instructionsExecuted);
  store<i32>(cfgExit + EXIT_FAULT_OPERAND, faultOperand);
}

// Port of runCpuSlice: pays outstanding cycle debt first, then executes hot
// instructions, banking unpaid cycles back into the debt. Budget validation
// (positive safe integers) is the host adapter's contract.
export function run_cpu_slice(cycleBudget: i64, instructionBudget: i64): i32 {
  if (!cfgConfigured) unreachable();
  gPc = load<i32>(cfgState + STATE_INSTRUCTION_POINTER);
  gCompared = load<i64>(cfgState + STATE_COMPARED);
  let debt: i64 = load<i64>(cfgState + STATE_CYCLE_DEBT);
  let consumed: i64 = 0;
  let executed: i64 = 0;
  let faultCode: i32 = 0;
  let faultOperand: i32 = 0;
  let reason: i32 = EXIT_BUDGET_EXHAUSTED;
  while (true) {
    if (consumed >= cycleBudget) {
      reason = EXIT_BUDGET_EXHAUSTED;
      break;
    }
    if (debt > 0) {
      const remaining = cycleBudget - consumed;
      const paid = debt < remaining ? debt : remaining;
      debt -= paid;
      consumed += paid;
      continue;
    }
    if (executed >= instructionBudget) {
      reason = EXIT_BUDGET_EXHAUSTED;
      break;
    }
    if (gPc == cfgCount) {
      reason = EXIT_END_OF_PROGRAM;
      break;
    }
    if (gPc < 0 || gPc > cfgCount) {
      // Production faults before advancing pc, so pc stays in place.
      faultCode = FAULT_INSTRUCTION_RANGE;
      faultOperand = gPc;
      reason = EXIT_FAULT;
      break;
    }
    if ((load<u8>(cfgFlags + <usize>gPc) & FLAG_COLD_EXIT) != 0) {
      reason = EXIT_COLD_INSTRUCTION;
      break;
    }
    const cycles = step();
    if (cycles < 0) {
      // The faulting instruction's cycles and count are discarded, like the
      // production crash path.
      faultCode = gFaultCode;
      faultOperand = gFaultOperand;
      reason = EXIT_FAULT;
      break;
    }
    executed += 1;
    const wide: i64 = <i64>cycles;
    const remaining = cycleBudget - consumed;
    const paid = wide < remaining ? wide : remaining;
    consumed += paid;
    debt = wide - paid;
  }
  store<i32>(cfgState + STATE_INSTRUCTION_POINTER, gPc);
  store<i64>(cfgState + STATE_COMPARED, gCompared);
  store<i64>(cfgState + STATE_CYCLE_DEBT, debt);
  writeExit(reason, faultCode, faultOperand, consumed, executed);
  return reason;
}

// Port of runInstructionSlice: reports full per-instruction cycle cost and
// never reads or writes the cycle debt.
export function run_instruction_slice(instructionBudget: i64): i32 {
  if (!cfgConfigured) unreachable();
  gPc = load<i32>(cfgState + STATE_INSTRUCTION_POINTER);
  gCompared = load<i64>(cfgState + STATE_COMPARED);
  let consumed: i64 = 0;
  let executed: i64 = 0;
  let faultCode: i32 = 0;
  let faultOperand: i32 = 0;
  let reason: i32 = EXIT_BUDGET_EXHAUSTED;
  while (true) {
    if (executed >= instructionBudget) {
      reason = EXIT_BUDGET_EXHAUSTED;
      break;
    }
    if (gPc == cfgCount) {
      reason = EXIT_END_OF_PROGRAM;
      break;
    }
    if (gPc < 0 || gPc > cfgCount) {
      faultCode = FAULT_INSTRUCTION_RANGE;
      faultOperand = gPc;
      reason = EXIT_FAULT;
      break;
    }
    if ((load<u8>(cfgFlags + <usize>gPc) & FLAG_COLD_EXIT) != 0) {
      reason = EXIT_COLD_INSTRUCTION;
      break;
    }
    const cycles = step();
    if (cycles < 0) {
      faultCode = gFaultCode;
      faultOperand = gFaultOperand;
      reason = EXIT_FAULT;
      break;
    }
    consumed += <i64>cycles;
    executed += 1;
  }
  store<i32>(cfgState + STATE_INSTRUCTION_POINTER, gPc);
  store<i64>(cfgState + STATE_COMPARED, gCompared);
  writeExit(reason, faultCode, faultOperand, consumed, executed);
  return reason;
}
