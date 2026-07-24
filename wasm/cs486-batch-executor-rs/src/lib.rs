//! Gated Issue #106 CS486 wasm batch executor (Rust variant).
//!
//! Semantics are a hand port of the production TypeScript interpreter and are
//! held bit-identical by the differential equivalence harness:
//! - slice loops and cycle-debt accounting: `src/domain/cpu/cs486.ts`
//!   (`runCpuSlice` / `runInstructionSlice` / `executeNext`)
//! - cache, bus, and prefetch timing: `src/domain/cpu/memoryHierarchy.ts`
//! - CS386SX early-out multiply: `src/domain/cpu/instructionTiming.ts`
//!
//! The binary ABI (params/state/exit layouts, opcode numbering, fault and
//! exit codes) is defined by `tools/cs486-wasm-batch-executor-abi.ts`; the
//! constants below mirror that module and must never diverge from it.
//!
//! Contract highlights:
//! - zero imports; the module exports its own linear memory
//! - no heap, no panicking paths; every guest fault is pre-checked and
//!   reported through the exit record (a wasm trap reaching the host is a bug)
//! - cold opcodes (call_indirect/syscall/print/halt) exit BEFORE any state
//!   change; the TS cold-op bridge owns their execution
//! - a faulting instruction contributes no cycles and no instruction count,
//!   but its prologue effects (pc increment, fetch cache/stat mutations,
//!   pipeline-flush bookkeeping) persist, exactly like the production crash
//!   path

#![no_std]

use core::ptr;

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    die()
}

/// Loud explicit failure for host-contract violations (unconfigured calls,
/// corrupted opcode tables). Traps the instance instead of approximating.
#[inline(always)]
fn die() -> ! {
    #[cfg(target_arch = "wasm32")]
    core::arch::wasm32::unreachable();
    #[cfg(not(target_arch = "wasm32"))]
    loop {}
}

// --- ABI constants (mirror of tools/cs486-wasm-batch-executor-abi.ts) ---

const ABI_VERSION: i32 = 1;

const MODEL_CS386SX: i32 = 0;

// params block field offsets (bytes)
const PARAM_ABI_VERSION: u32 = 0;
const PARAM_CPU_MODEL: u32 = 4;
const PARAM_COLLECT_STATS: u32 = 8;
const PARAM_INSTRUCTION_COUNT: u32 = 12;
const PARAM_MEMORY_BYTES: u32 = 16;
const PARAM_STACK_FLOOR: u32 = 20;
const PARAM_RAM_BASE: u32 = 24;
const PARAM_OPCODES_BASE: u32 = 28;
const PARAM_FLAGS_BASE: u32 = 32;
const PARAM_BRANCH_DELTA_BASE: u32 = 36;
const PARAM_BASE_CYCLES_BASE: u32 = 40;
const PARAM_OPERAND_A_BASE: u32 = 44;
const PARAM_OPERAND_B_BASE: u32 = 48;
const PARAM_REGISTERS_BASE: u32 = 52;
const PARAM_STATE_BASE: u32 = 56;
const PARAM_EXIT_BASE: u32 = 60;
const PARAM_CACHE_BASE: u32 = 64;
const PARAM_CACHE_BYTES: u32 = 68;
const PARAM_L1_SET_COUNT: u32 = 72;
const PARAM_L2_SET_COUNT: u32 = 76;
const PARAM_CACHE_LINE_SHIFT: u32 = 80;
const PARAM_MAIN_MEMORY_TRANSFER_CYCLES: u32 = 84;

// state block field offsets (bytes)
const STATE_INSTRUCTION_POINTER: u32 = 0;
const STATE_COMPARED: u32 = 8;
const STATE_CYCLE_DEBT: u32 = 16;
const STATE_STATS: u32 = 24;

// exit record field offsets (bytes)
const EXIT_REASON: u32 = 0;
const EXIT_FAULT_CODE: u32 = 4;
const EXIT_CYCLES_CONSUMED: u32 = 8;
const EXIT_INSTRUCTIONS_EXECUTED: u32 = 16;
const EXIT_FAULT_OPERAND: u32 = 24;

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
const FLAG_CONDITIONAL_BRANCH: u32 = 1;
const FLAG_UNCONDITIONAL_CONTROL_TRANSFER: u32 = 2;
const FLAG_DYNAMIC_MULTIPLY: u32 = 4;
const FLAG_COLD_EXIT: u32 = 8;

// stats slot indices (u64 each, at state + STATE_STATS)
const STAT_BUS_TRANSFERS: u32 = 0;
const STAT_INSTRUCTION_FETCHES: u32 = 1;
const STAT_L1_HITS: u32 = 2;
const STAT_L1_MISSES: u32 = 3;
const STAT_L2_HITS: u32 = 4;
const STAT_L2_MISSES: u32 = 5;
const STAT_PIPELINE_FLUSHES: u32 = 6;
const STAT_UNALIGNED_ACCESSES: u32 = 7;

// opcodes (dense 1..65)
const OP_MOV_IMMEDIATE: u32 = 1;
const OP_MOV_REGISTER: u32 = 2;
const OP_LOAD_IMMEDIATE: u32 = 3;
const OP_LOAD_REGISTER: u32 = 4;
const OP_LOAD8_SIGNED_IMMEDIATE: u32 = 5;
const OP_LOAD8_SIGNED_REGISTER: u32 = 6;
const OP_LOAD8_UNSIGNED_IMMEDIATE: u32 = 7;
const OP_LOAD8_UNSIGNED_REGISTER: u32 = 8;
const OP_LOAD16_SIGNED_IMMEDIATE: u32 = 9;
const OP_LOAD16_SIGNED_REGISTER: u32 = 10;
const OP_LOAD16_UNSIGNED_IMMEDIATE: u32 = 11;
const OP_LOAD16_UNSIGNED_REGISTER: u32 = 12;
const OP_STORE_IMMEDIATE: u32 = 13;
const OP_STORE_REGISTER: u32 = 14;
const OP_STORE8_IMMEDIATE: u32 = 15;
const OP_STORE8_REGISTER: u32 = 16;
const OP_STORE16_IMMEDIATE: u32 = 17;
const OP_STORE16_REGISTER: u32 = 18;
const OP_ADD_IMMEDIATE: u32 = 19;
const OP_ADD_REGISTER: u32 = 20;
const OP_SUB_IMMEDIATE: u32 = 21;
const OP_SUB_REGISTER: u32 = 22;
const OP_MUL_IMMEDIATE: u32 = 23;
const OP_MUL_REGISTER: u32 = 24;
const OP_DIV_IMMEDIATE: u32 = 25;
const OP_DIV_REGISTER: u32 = 26;
const OP_UDIV_IMMEDIATE: u32 = 27;
const OP_UDIV_REGISTER: u32 = 28;
const OP_MOD_IMMEDIATE: u32 = 29;
const OP_MOD_REGISTER: u32 = 30;
const OP_UMOD_IMMEDIATE: u32 = 31;
const OP_UMOD_REGISTER: u32 = 32;
const OP_AND_IMMEDIATE: u32 = 33;
const OP_AND_REGISTER: u32 = 34;
const OP_OR_IMMEDIATE: u32 = 35;
const OP_OR_REGISTER: u32 = 36;
const OP_XOR_IMMEDIATE: u32 = 37;
const OP_XOR_REGISTER: u32 = 38;
const OP_SHL_IMMEDIATE: u32 = 39;
const OP_SHL_REGISTER: u32 = 40;
const OP_SHR_IMMEDIATE: u32 = 41;
const OP_SHR_REGISTER: u32 = 42;
const OP_USHR_IMMEDIATE: u32 = 43;
const OP_USHR_REGISTER: u32 = 44;
const OP_COMPARE_IMMEDIATE: u32 = 45;
const OP_COMPARE_REGISTER: u32 = 46;
const OP_JE: u32 = 47;
const OP_JNE: u32 = 48;
const OP_JL: u32 = 49;
const OP_JLE: u32 = 50;
const OP_JG: u32 = 51;
const OP_JGE: u32 = 52;
const OP_JUMP: u32 = 53;
const OP_PUSH_IMMEDIATE: u32 = 54;
const OP_PUSH_REGISTER: u32 = 55;
const OP_POP: u32 = 56;
const OP_CALL: u32 = 57;

const REG_ESP: i32 = 6;

/// Matches `instructionCodeBase` in memoryHierarchy.ts. The synthetic code
/// address range stays below 2^31 for the 524,288-instruction v6 ceiling.
const INSTRUCTION_CODE_BASE: u32 = 0x1000_0000;

// --- raw linear-memory access helpers ---
// Guest RAM addresses may be byte-aligned for 32-bit accesses (production
// alignment rule: only 16-bit accesses fault on odd addresses), so every RAM
// access uses unaligned reads/writes. Wasm has no alignment penalty semantics.

#[inline(always)]
fn lu8(address: u32) -> u32 {
    unsafe { *(address as *const u8) as u32 }
}

#[inline(always)]
fn su8(address: u32, value: u32) {
    unsafe { *(address as *mut u8) = value as u8 }
}

#[inline(always)]
fn lu16(address: u32) -> u32 {
    unsafe { ptr::read_unaligned(address as *const u16) as u32 }
}

#[inline(always)]
fn su16(address: u32, value: u32) {
    unsafe { ptr::write_unaligned(address as *mut u16, value as u16) }
}

#[inline(always)]
fn li32(address: u32) -> i32 {
    unsafe { ptr::read_unaligned(address as *const i32) }
}

#[inline(always)]
fn si32(address: u32, value: i32) {
    unsafe { ptr::write_unaligned(address as *mut i32, value) }
}

#[inline(always)]
fn lu32(address: u32) -> u32 {
    unsafe { ptr::read_unaligned(address as *const u32) }
}

#[inline(always)]
fn su32(address: u32, value: u32) {
    unsafe { ptr::write_unaligned(address as *mut u32, value) }
}

#[inline(always)]
fn li64(address: u32) -> i64 {
    unsafe { ptr::read_unaligned(address as *const i64) }
}

#[inline(always)]
fn si64(address: u32, value: i64) {
    unsafe { ptr::write_unaligned(address as *mut i64, value) }
}

#[inline(always)]
fn lu64(address: u32) -> u64 {
    unsafe { ptr::read_unaligned(address as *const u64) }
}

#[inline(always)]
fn su64(address: u32, value: u64) {
    unsafe { ptr::write_unaligned(address as *mut u64, value) }
}

// --- configuration ---

/// Per-level cache state addresses. Backing storage lives in the host-sized
/// cache region; scalars (clock/mostRecentLine/mostRecentIndex) live in the
/// 32-byte scalar prefix of that region.
#[derive(Clone, Copy)]
struct Level {
    tags: u32,
    recency: u32,
    most_recent_index_by_set: u32,
    clock_address: u32,
    most_recent_line_address: u32,
    most_recent_index_address: u32,
    set_mask: u32,
    set_shift: u32,
}

const LEVEL_ZERO: Level = Level {
    tags: 0,
    recency: 0,
    most_recent_index_by_set: 0,
    clock_address: 0,
    most_recent_line_address: 0,
    most_recent_index_address: 0,
    set_mask: 0,
    set_shift: 0,
};

#[derive(Clone, Copy)]
struct Config {
    configured: bool,
    model: i32,
    collect_stats: bool,
    count: i32,
    memory_bytes: i32,
    stack_floor: i32,
    ram: u32,
    opcodes: u32,
    flags: u32,
    branch_delta: u32,
    base_cycles: u32,
    operand_a: u32,
    operand_b: u32,
    registers: u32,
    state: u32,
    exit: u32,
    stats: u32,
    main_memory_transfer_cycles: i32,
    line_shift: u32,
    line_mask: u32,
    line_last_dword_start: u32,
    line_dword_transfers: i32,
    instruction_line_transfers: i32,
    l1_sets: i32,
    l2_sets: i32,
    l1: Level,
    l2: Level,
    prefetch_address: u32,
}

const CONFIG_ZERO: Config = Config {
    configured: false,
    model: 0,
    collect_stats: false,
    count: 0,
    memory_bytes: 0,
    stack_floor: 0,
    ram: 0,
    opcodes: 0,
    flags: 0,
    branch_delta: 0,
    base_cycles: 0,
    operand_a: 0,
    operand_b: 0,
    registers: 0,
    state: 0,
    exit: 0,
    stats: 0,
    main_memory_transfer_cycles: 0,
    line_shift: 0,
    line_mask: 0,
    line_last_dword_start: 0,
    line_dword_transfers: 0,
    instruction_line_transfers: 0,
    l1_sets: 0,
    l2_sets: 0,
    l1: LEVEL_ZERO,
    l2: LEVEL_ZERO,
    prefetch_address: 0,
};

static mut CONFIG: Config = CONFIG_ZERO;

#[inline(always)]
fn config() -> Config {
    unsafe { ptr::addr_of!(CONFIG).read() }
}

#[inline(always)]
fn align16(bytes: u32) -> u32 {
    (bytes + 15) & !15
}

#[inline(always)]
fn valid_set_count(sets: i32) -> bool {
    sets == 0 || (sets > 0 && (sets & (sets - 1)) == 0)
}

/// Bytes one cache level occupies past the scalar prefix: 4-way tags and
/// recency words plus a most-recent-index-by-set word per set, each region
/// padded to 16 bytes (mirrors `cs486WasmCacheStateBytes`).
#[inline(always)]
fn level_bytes(sets: i32) -> u32 {
    if sets <= 0 {
        return 0;
    }
    let way_words = sets as u32 * 4 * 4;
    align16(way_words) + align16(way_words) + align16(sets as u32 * 4)
}

fn init_level_arrays(level: &Level, sets: i32) {
    let mut index = 0u32;
    while index < sets as u32 * 4 {
        si32(level.tags + index * 4, -1);
        su32(level.recency + index * 4, 0);
        index += 1;
    }
    let mut set = 0u32;
    while set < sets as u32 {
        si32(level.most_recent_index_by_set + set * 4, -1);
        set += 1;
    }
}

/// Reads the params block, validates it, and initializes the cache region.
/// Registers, RAM, SoA tables, and the state block stay host-owned. Returns 0
/// on success or a nonzero code identifying the rejected field.
#[no_mangle]
pub extern "C" fn configure(params_base: i32) -> i32 {
    if params_base <= 0 {
        return 1;
    }
    let p = params_base as u32;
    if li32(p + PARAM_ABI_VERSION) != ABI_VERSION {
        return 2;
    }
    let model = li32(p + PARAM_CPU_MODEL);
    if !(0..=2).contains(&model) {
        return 3;
    }
    let collect_stats = li32(p + PARAM_COLLECT_STATS) != 0;
    let count = li32(p + PARAM_INSTRUCTION_COUNT);
    if count < 0 {
        return 4;
    }
    let memory_bytes = li32(p + PARAM_MEMORY_BYTES);
    if memory_bytes < 0 {
        return 5;
    }
    let stack_floor = li32(p + PARAM_STACK_FLOOR);
    if stack_floor < 0 || stack_floor > memory_bytes {
        return 6;
    }
    let line_shift = li32(p + PARAM_CACHE_LINE_SHIFT);
    if !(2..=31).contains(&line_shift) {
        return 7;
    }
    let main_memory_transfer_cycles = li32(p + PARAM_MAIN_MEMORY_TRANSFER_CYCLES);
    if main_memory_transfer_cycles < 0 {
        return 8;
    }
    let l1_sets = li32(p + PARAM_L1_SET_COUNT);
    let l2_sets = li32(p + PARAM_L2_SET_COUNT);
    if !valid_set_count(l1_sets) || !valid_set_count(l2_sets) || (l1_sets == 0 && l2_sets != 0) {
        return 9;
    }
    let cache_base = li32(p + PARAM_CACHE_BASE);
    let cache_bytes = li32(p + PARAM_CACHE_BYTES);
    if cache_base <= 0
        || cache_bytes < 0
        || (cache_bytes as u32) < 32 + level_bytes(l1_sets) + level_bytes(l2_sets)
    {
        return 10;
    }
    let ram = li32(p + PARAM_RAM_BASE);
    let opcodes = li32(p + PARAM_OPCODES_BASE);
    let flags = li32(p + PARAM_FLAGS_BASE);
    let branch_delta = li32(p + PARAM_BRANCH_DELTA_BASE);
    let base_cycles = li32(p + PARAM_BASE_CYCLES_BASE);
    let operand_a = li32(p + PARAM_OPERAND_A_BASE);
    let operand_b = li32(p + PARAM_OPERAND_B_BASE);
    let registers = li32(p + PARAM_REGISTERS_BASE);
    let state = li32(p + PARAM_STATE_BASE);
    let exit = li32(p + PARAM_EXIT_BASE);
    if ram <= 0
        || opcodes <= 0
        || flags <= 0
        || branch_delta <= 0
        || base_cycles <= 0
        || operand_a <= 0
        || operand_b <= 0
        || registers <= 0
        || state <= 0
        || exit <= 0
    {
        return 11;
    }

    let cache = cache_base as u32;
    let line_bytes = 1u32 << line_shift;
    let l1_way_bytes = align16(l1_sets as u32 * 16);
    let l1_tags = cache + 32;
    let l1_recency = l1_tags + l1_way_bytes;
    let l1_mris = l1_recency + l1_way_bytes;
    let l2_tags = l1_mris + align16(l1_sets as u32 * 4);
    let l2_way_bytes = align16(l2_sets as u32 * 16);
    let l2_recency = l2_tags + l2_way_bytes;
    let l2_mris = l2_recency + l2_way_bytes;

    let new_config = Config {
        configured: true,
        model,
        collect_stats,
        count,
        memory_bytes,
        stack_floor,
        ram: ram as u32,
        opcodes: opcodes as u32,
        flags: flags as u32,
        branch_delta: branch_delta as u32,
        base_cycles: base_cycles as u32,
        operand_a: operand_a as u32,
        operand_b: operand_b as u32,
        registers: registers as u32,
        state: state as u32,
        exit: exit as u32,
        stats: state as u32 + STATE_STATS,
        main_memory_transfer_cycles,
        line_shift: line_shift as u32,
        line_mask: line_bytes - 1,
        line_last_dword_start: line_bytes - 4,
        line_dword_transfers: (line_bytes >> 2) as i32,
        instruction_line_transfers: (line_bytes >> if model == MODEL_CS386SX { 1 } else { 2 })
            as i32,
        l1_sets,
        l2_sets,
        l1: Level {
            tags: l1_tags,
            recency: l1_recency,
            most_recent_index_by_set: l1_mris,
            clock_address: cache,
            most_recent_line_address: cache + 8,
            most_recent_index_address: cache + 12,
            set_mask: if l1_sets > 0 { l1_sets as u32 - 1 } else { 0 },
            set_shift: (l1_sets as u32).trailing_zeros() & 31,
        },
        l2: Level {
            tags: l2_tags,
            recency: l2_recency,
            most_recent_index_by_set: l2_mris,
            clock_address: cache + 16,
            most_recent_line_address: cache + 24,
            most_recent_index_address: cache + 28,
            set_mask: if l2_sets > 0 { l2_sets as u32 - 1 } else { 0 },
            set_shift: (l2_sets as u32).trailing_zeros() & 31,
        },
        prefetch_address: cache,
    };

    // Cold cache state: zero scalars, then the -1 sentinels the production
    // constructors establish (empty tags, no MRU, no prefetched 386 line).
    let mut scalar = 0u32;
    while scalar < 8 {
        su32(cache + scalar * 4, 0);
        scalar += 1;
    }
    if model == MODEL_CS386SX {
        si32(new_config.prefetch_address, -1);
    } else {
        si32(new_config.l1.most_recent_line_address, -1);
        si32(new_config.l1.most_recent_index_address, -1);
        si32(new_config.l2.most_recent_line_address, -1);
        si32(new_config.l2.most_recent_index_address, -1);
    }
    init_level_arrays(&new_config.l1, l1_sets);
    init_level_arrays(&new_config.l2, l2_sets);

    unsafe { ptr::addr_of_mut!(CONFIG).write(new_config) };
    0
}

// --- statistics ---

#[inline(always)]
fn stat_add(c: &Config, index: u32, delta: u64) {
    let address = c.stats + index * 8;
    su64(address, lu64(address).wrapping_add(delta));
}

// --- memory hierarchy (port of CpuMemoryHierarchy / SetAssociativeCache) ---

/// Port of `SetAssociativeCache.access`. The clock is widened to u64 while
/// recency stores its low 32 bits, matching the production number clock
/// truncated by the Uint32Array recency store.
fn cache_access(c: &Config, level: &Level, address: u32) -> bool {
    let line_u = address >> c.line_shift;
    let line = line_u as i32;
    let clock = lu64(level.clock_address).wrapping_add(1);
    su64(level.clock_address, clock);
    let clock32 = clock as u32;

    let most_recent_index = li32(level.most_recent_index_address);
    if most_recent_index >= 0 && line == li32(level.most_recent_line_address) {
        su32(level.recency + most_recent_index as u32 * 4, clock32);
        return true;
    }

    let set = line_u & level.set_mask;
    let tag = (line_u >> level.set_shift) as i32;
    let base = set * 4;
    let set_most_recent_index = li32(level.most_recent_index_by_set + set * 4);
    if set_most_recent_index >= 0 && li32(level.tags + set_most_recent_index as u32 * 4) == tag {
        su32(level.recency + set_most_recent_index as u32 * 4, clock32);
        si32(level.most_recent_line_address, line);
        si32(level.most_recent_index_address, set_most_recent_index);
        return true;
    }

    let mut replacement = base;
    let mut oldest = u64::MAX;
    let mut way = 0u32;
    while way < 4 {
        let index = base + way;
        let stored_tag = li32(level.tags + index * 4);
        if stored_tag == tag {
            su32(level.recency + index * 4, clock32);
            si32(level.most_recent_index_by_set + set * 4, index as i32);
            si32(level.most_recent_line_address, line);
            si32(level.most_recent_index_address, index as i32);
            return true;
        }
        if stored_tag == -1 {
            replacement = index;
        } else {
            let recency = lu32(level.recency + index * 4) as u64;
            if recency < oldest && li32(level.tags + replacement * 4) != -1 {
                oldest = recency;
                replacement = index;
            }
        }
        way += 1;
    }
    si32(level.tags + replacement * 4, tag);
    su32(level.recency + replacement * 4, clock32);
    si32(level.most_recent_index_by_set + set * 4, replacement as i32);
    si32(level.most_recent_line_address, line);
    si32(level.most_recent_index_address, replacement as i32);
    false
}

/// Port of `CpuMemoryHierarchy.accessCachedLine`.
fn access_cached_line(c: &Config, address: u32) -> i32 {
    if c.l1_sets == 0 {
        return 0;
    }
    if cache_access(c, &c.l1, address) {
        if c.collect_stats {
            stat_add(c, STAT_L1_HITS, 1);
        }
        return 0;
    }
    if c.collect_stats {
        stat_add(c, STAT_L1_MISSES, 1);
    }
    let line_transfers = c.line_dword_transfers;
    if c.l2_sets != 0 {
        if cache_access(c, &c.l2, address) {
            if c.collect_stats {
                stat_add(c, STAT_L2_HITS, 1);
                stat_add(c, STAT_BUS_TRANSFERS, line_transfers as u64);
            }
            return line_transfers * 2;
        }
        if c.collect_stats {
            stat_add(c, STAT_L2_MISSES, 1);
        }
    }
    if c.collect_stats {
        stat_add(c, STAT_BUS_TRANSFERS, line_transfers as u64);
    }
    line_transfers * c.main_memory_transfer_cycles
}

/// Port of `CpuMemoryHierarchy.fetchInstruction`. The 386SX prefetch queue
/// branch keys off the missing L1, exactly like the production check.
#[inline(always)]
fn fetch_cycles(c: &Config, index: i32) -> i32 {
    if c.collect_stats {
        stat_add(c, STAT_INSTRUCTION_FETCHES, 1);
    }
    let address = INSTRUCTION_CODE_BASE + index as u32 * 4;
    if c.l1_sets == 0 {
        let line = (address >> c.line_shift) as i32;
        if line != li32(c.prefetch_address) {
            si32(c.prefetch_address, line);
            if c.collect_stats {
                stat_add(c, STAT_BUS_TRANSFERS, c.instruction_line_transfers as u64);
            }
        }
        return 0;
    }
    access_cached_line(c, address)
}

/// Port of `CpuMemoryHierarchy.accessData`. `write=false` is a read.
fn access_data_cycles(c: &Config, address: i32, write: bool) -> i32 {
    if c.model == MODEL_CS386SX {
        let transfers: i32 = if address & 1 == 0 { 2 } else { 3 };
        if c.collect_stats {
            stat_add(c, STAT_BUS_TRANSFERS, transfers as u64);
            if transfers == 3 {
                stat_add(c, STAT_UNALIGNED_ACCESSES, 1);
            }
        }
        return (transfers - 2) * c.main_memory_transfer_cycles;
    }
    let a = address as u32;
    let unaligned = a & 3 != 0;
    if c.collect_stats && unaligned {
        stat_add(c, STAT_UNALIGNED_ACCESSES, 1);
    }
    let mut cycles: i32 = if unaligned { 1 } else { 0 };
    cycles += access_cached_line(c, a);
    if (a & c.line_mask) > c.line_last_dword_start {
        cycles += access_cached_line(c, a.wrapping_add(3));
    }
    if write {
        let transfers: i32 = if unaligned { 2 } else { 1 };
        if c.collect_stats {
            stat_add(c, STAT_BUS_TRANSFERS, transfers as u64);
        }
        cycles += transfers * c.main_memory_transfer_cycles;
    }
    cycles
}

/// Port of `CpuMemoryHierarchy.recordControlTransfer`.
#[inline(always)]
fn record_transfer(c: &Config, taken: bool) {
    if !taken {
        return;
    }
    if c.collect_stats {
        stat_add(c, STAT_PIPELINE_FLUSHES, 1);
    }
    if c.model == MODEL_CS386SX {
        si32(c.prefetch_address, -1);
    }
}

// --- shared-hierarchy exports for the TS cold-op bridge ---

/// kind: 0 = read, 1 = write. Addresses arrive production-checked.
#[no_mangle]
pub extern "C" fn access_data(address: i32, kind: i32) -> i32 {
    let c = config();
    if !c.configured {
        die();
    }
    access_data_cycles(&c, address, kind != 0)
}

#[no_mangle]
pub extern "C" fn fetch_instruction(index: i32) -> i32 {
    let c = config();
    if !c.configured {
        die();
    }
    fetch_cycles(&c, index)
}

#[no_mangle]
pub extern "C" fn record_control_transfer(taken: i32) {
    let c = config();
    if !c.configured {
        die();
    }
    record_transfer(&c, taken != 0);
}

// --- instruction execution ---

struct Fault {
    code: i32,
    operand: i32,
}

#[inline(always)]
fn register(c: &Config, index: i32) -> i32 {
    li32(c.registers + index as u32 * 4)
}

#[inline(always)]
fn set_register(c: &Config, index: i32, value: i32) {
    si32(c.registers + index as u32 * 4, value)
}

/// Port of `checkedAddress`: bounds first, then the width-specific alignment
/// rule (only 16-bit accesses carry alignment 2; 8/32-bit never fault on it).
#[inline(always)]
fn checked_address(c: &Config, value: i32, width: i32, alignment: i32) -> Result<(), Fault> {
    if value < 0 || value > c.memory_bytes - width {
        return Err(Fault {
            code: FAULT_MEMORY_ACCESS,
            operand: value,
        });
    }
    if alignment == 2 && value & 1 != 0 {
        return Err(Fault {
            code: FAULT_MEMORY_ALIGNMENT,
            operand: value,
        });
    }
    Ok(())
}

/// Port of the private `push`: both bounds violations name StackOverflowError.
/// The next pointer is widened to i64 so an esp near i32::MIN cannot wrap.
#[inline(always)]
fn push_value(c: &Config, value: i32) -> Result<i32, Fault> {
    let esp = register(c, REG_ESP);
    let next = esp as i64 - 4;
    if next < c.stack_floor as i64 || next + 4 > c.memory_bytes as i64 {
        return Err(Fault {
            code: FAULT_STACK_OVERFLOW,
            operand: 0,
        });
    }
    let next = next as i32;
    let cycles = access_data_cycles(c, next, true);
    si32(c.ram + next as u32, value);
    set_register(c, REG_ESP, next);
    Ok(cycles)
}

/// Port of the private `pop`: a floor violation keeps the production
/// StackOverflowError name; only the top violation is StackUnderflowError.
#[inline(always)]
fn pop_value(c: &Config) -> Result<(i32, i32), Fault> {
    let current = register(c, REG_ESP);
    if current < c.stack_floor {
        return Err(Fault {
            code: FAULT_STACK_OVERFLOW,
            operand: 0,
        });
    }
    if current as i64 + 4 > c.memory_bytes as i64 {
        return Err(Fault {
            code: FAULT_STACK_UNDERFLOW,
            operand: 0,
        });
    }
    let cycles = access_data_cycles(c, current, false);
    let value = li32(c.ram + current as u32);
    set_register(c, REG_ESP, current + 4);
    Ok((value, cycles))
}

/// Port of `cs386EarlyOutMultiplyCycles` using the integer identity
/// ceil(log2(magnitude)) == 32 - clz32(magnitude - 1); `unsigned_abs` keeps
/// i32::MIN exact where a signed abs would overflow.
#[inline(always)]
fn early_out_multiply_cycles(multiplier: i32) -> i32 {
    if multiplier == 0 {
        return 9;
    }
    let magnitude = multiplier.unsigned_abs();
    let significant_bits = (32 - (magnitude - 1).leading_zeros()) as i32;
    let clamped = if significant_bits < 3 { 3 } else { significant_bits };
    if clamped + 6 > 38 {
        38
    } else {
        clamped + 6
    }
}

#[inline(always)]
fn div_values(dividend: i32, divisor: i32) -> Result<i32, Fault> {
    if divisor == 0 {
        return Err(Fault {
            code: FAULT_DIVISION_BY_ZERO,
            operand: 0,
        });
    }
    // wrapping_div: i32::MIN / -1 wraps to i32::MIN, matching the production
    // Int32Array store; native wasm i32.div_s would trap on that pair.
    Ok(dividend.wrapping_div(divisor))
}

#[inline(always)]
fn udiv_values(dividend: i32, divisor: i32) -> Result<i32, Fault> {
    if divisor == 0 {
        return Err(Fault {
            code: FAULT_DIVISION_BY_ZERO,
            operand: 0,
        });
    }
    Ok(((dividend as u32) / (divisor as u32)) as i32)
}

#[inline(always)]
fn mod_values(dividend: i32, divisor: i32) -> Result<i32, Fault> {
    if divisor == 0 {
        return Err(Fault {
            code: FAULT_DIVISION_BY_ZERO,
            operand: 0,
        });
    }
    // Truncated remainder with the dividend's sign, i32::MIN % -1 == 0: both
    // JS % into an Int32Array and wrapping_rem agree.
    Ok(dividend.wrapping_rem(divisor))
}

#[inline(always)]
fn umod_values(dividend: i32, divisor: i32) -> Result<i32, Fault> {
    if divisor == 0 {
        return Err(Fault {
            code: FAULT_DIVISION_BY_ZERO,
            operand: 0,
        });
    }
    Ok(((dividend as u32) % (divisor as u32)) as i32)
}

#[inline(always)]
fn load_word(c: &Config, destination: i32, address: i32) -> Result<i32, Fault> {
    checked_address(c, address, 4, 1)?;
    let cycles = access_data_cycles(c, address, false);
    set_register(c, destination, li32(c.ram + address as u32));
    Ok(cycles)
}

#[inline(always)]
fn load_byte(c: &Config, destination: i32, address: i32, signed: bool) -> Result<i32, Fault> {
    checked_address(c, address, 1, 1)?;
    let cycles = access_data_cycles(c, address, false);
    let raw = lu8(c.ram + address as u32);
    let value = if signed { raw as u8 as i8 as i32 } else { raw as i32 };
    set_register(c, destination, value);
    Ok(cycles)
}

#[inline(always)]
fn load_half(c: &Config, destination: i32, address: i32, signed: bool) -> Result<i32, Fault> {
    checked_address(c, address, 2, 2)?;
    let cycles = access_data_cycles(c, address, false);
    let raw = lu16(c.ram + address as u32);
    let value = if signed { raw as u16 as i16 as i32 } else { raw as i32 };
    set_register(c, destination, value);
    Ok(cycles)
}

#[inline(always)]
fn store_word(c: &Config, address: i32, source: i32) -> Result<i32, Fault> {
    checked_address(c, address, 4, 1)?;
    let cycles = access_data_cycles(c, address, true);
    si32(c.ram + address as u32, register(c, source));
    Ok(cycles)
}

#[inline(always)]
fn store_byte(c: &Config, address: i32, source: i32) -> Result<i32, Fault> {
    checked_address(c, address, 1, 1)?;
    let cycles = access_data_cycles(c, address, true);
    su8(c.ram + address as u32, register(c, source) as u32);
    Ok(cycles)
}

#[inline(always)]
fn store_half(c: &Config, address: i32, source: i32) -> Result<i32, Fault> {
    checked_address(c, address, 2, 2)?;
    let cycles = access_data_cycles(c, address, true);
    su16(c.ram + address as u32, register(c, source) as u32);
    Ok(cycles)
}

/// Port of `executeNext` for the hot (non-cold) opcodes. The caller has
/// already handled end-of-program, range faults, and cold exits, so entry
/// implies 0 <= pc < count with a hot opcode at pc.
#[inline(always)]
fn step(c: &Config, pc: &mut i32, compared: &mut i64) -> Result<i32, Fault> {
    let index = *pc;
    *pc = index + 1;
    let iu = index as u32;
    let opcode = lu8(c.opcodes + iu);
    let flags = lu8(c.flags + iu);

    let taken = if flags & FLAG_CONDITIONAL_BRANCH != 0 {
        let value = *compared;
        match opcode {
            OP_JE => value == 0,
            OP_JNE => value != 0,
            OP_JL => value < 0,
            OP_JLE => value <= 0,
            OP_JG => value > 0,
            _ => value >= 0,
        }
    } else {
        false
    };

    let mut base = lu32(c.base_cycles + iu * 4) as i32;
    if flags & FLAG_DYNAMIC_MULTIPLY != 0 && c.model == MODEL_CS386SX {
        let b = li32(c.operand_b + iu * 4);
        let multiplier = if opcode == OP_MUL_IMMEDIATE {
            b
        } else {
            register(c, b)
        };
        base = early_out_multiply_cycles(multiplier);
    }
    let mut cycles = base
        + if taken {
            lu8(c.branch_delta + iu) as i32
        } else {
            0
        }
        + fetch_cycles(c, index);
    record_transfer(c, taken || flags & FLAG_UNCONDITIONAL_CONTROL_TRANSFER != 0);

    let a = li32(c.operand_a + iu * 4);
    let b = li32(c.operand_b + iu * 4);
    match opcode {
        OP_MOV_IMMEDIATE => set_register(c, a, b),
        OP_MOV_REGISTER => set_register(c, a, register(c, b)),
        OP_LOAD_IMMEDIATE => cycles += load_word(c, a, b)?,
        OP_LOAD_REGISTER => cycles += load_word(c, a, register(c, b))?,
        OP_LOAD8_SIGNED_IMMEDIATE => cycles += load_byte(c, a, b, true)?,
        OP_LOAD8_SIGNED_REGISTER => cycles += load_byte(c, a, register(c, b), true)?,
        OP_LOAD8_UNSIGNED_IMMEDIATE => cycles += load_byte(c, a, b, false)?,
        OP_LOAD8_UNSIGNED_REGISTER => cycles += load_byte(c, a, register(c, b), false)?,
        OP_LOAD16_SIGNED_IMMEDIATE => cycles += load_half(c, a, b, true)?,
        OP_LOAD16_SIGNED_REGISTER => cycles += load_half(c, a, register(c, b), true)?,
        OP_LOAD16_UNSIGNED_IMMEDIATE => cycles += load_half(c, a, b, false)?,
        OP_LOAD16_UNSIGNED_REGISTER => cycles += load_half(c, a, register(c, b), false)?,
        OP_STORE_IMMEDIATE => cycles += store_word(c, a, b)?,
        OP_STORE_REGISTER => cycles += store_word(c, register(c, a), b)?,
        OP_STORE8_IMMEDIATE => cycles += store_byte(c, a, b)?,
        OP_STORE8_REGISTER => cycles += store_byte(c, register(c, a), b)?,
        OP_STORE16_IMMEDIATE => cycles += store_half(c, a, b)?,
        OP_STORE16_REGISTER => cycles += store_half(c, register(c, a), b)?,
        OP_ADD_IMMEDIATE => set_register(c, a, register(c, a).wrapping_add(b)),
        OP_ADD_REGISTER => set_register(c, a, register(c, a).wrapping_add(register(c, b))),
        OP_SUB_IMMEDIATE => set_register(c, a, register(c, a).wrapping_sub(b)),
        OP_SUB_REGISTER => set_register(c, a, register(c, a).wrapping_sub(register(c, b))),
        OP_MUL_IMMEDIATE => set_register(c, a, register(c, a).wrapping_mul(b)),
        OP_MUL_REGISTER => set_register(c, a, register(c, a).wrapping_mul(register(c, b))),
        OP_DIV_IMMEDIATE => set_register(c, a, div_values(register(c, a), b)?),
        OP_DIV_REGISTER => set_register(c, a, div_values(register(c, a), register(c, b))?),
        OP_UDIV_IMMEDIATE => set_register(c, a, udiv_values(register(c, a), b)?),
        OP_UDIV_REGISTER => set_register(c, a, udiv_values(register(c, a), register(c, b))?),
        OP_MOD_IMMEDIATE => set_register(c, a, mod_values(register(c, a), b)?),
        OP_MOD_REGISTER => set_register(c, a, mod_values(register(c, a), register(c, b))?),
        OP_UMOD_IMMEDIATE => set_register(c, a, umod_values(register(c, a), b)?),
        OP_UMOD_REGISTER => set_register(c, a, umod_values(register(c, a), register(c, b))?),
        OP_AND_IMMEDIATE => set_register(c, a, register(c, a) & b),
        OP_AND_REGISTER => set_register(c, a, register(c, a) & register(c, b)),
        OP_OR_IMMEDIATE => set_register(c, a, register(c, a) | b),
        OP_OR_REGISTER => set_register(c, a, register(c, a) | register(c, b)),
        OP_XOR_IMMEDIATE => set_register(c, a, register(c, a) ^ b),
        OP_XOR_REGISTER => set_register(c, a, register(c, a) ^ register(c, b)),
        // wrapping_shl/shr mask the amount by 31 exactly like the JS shift
        // operators the production interpreter relies on.
        OP_SHL_IMMEDIATE => set_register(c, a, register(c, a).wrapping_shl(b as u32)),
        OP_SHL_REGISTER => set_register(c, a, register(c, a).wrapping_shl(register(c, b) as u32)),
        OP_SHR_IMMEDIATE => set_register(c, a, register(c, a).wrapping_shr(b as u32)),
        OP_SHR_REGISTER => set_register(c, a, register(c, a).wrapping_shr(register(c, b) as u32)),
        OP_USHR_IMMEDIATE => {
            set_register(c, a, ((register(c, a) as u32).wrapping_shr(b as u32)) as i32)
        }
        OP_USHR_REGISTER => set_register(
            c,
            a,
            ((register(c, a) as u32).wrapping_shr(register(c, b) as u32)) as i32,
        ),
        // compared stays i64-wide: an i32 wrapping subtraction would flip
        // branch polarity near i32::MIN.
        OP_COMPARE_IMMEDIATE => *compared = register(c, a) as i64 - b as i64,
        OP_COMPARE_REGISTER => *compared = register(c, a) as i64 - register(c, b) as i64,
        OP_JE | OP_JNE | OP_JL | OP_JLE | OP_JG | OP_JGE => {
            if taken {
                *pc = a;
            }
        }
        OP_JUMP => *pc = a,
        OP_PUSH_IMMEDIATE => cycles += push_value(c, a)?,
        OP_PUSH_REGISTER => cycles += push_value(c, register(c, a))?,
        OP_POP => {
            let (value, cost) = pop_value(c)?;
            cycles += cost;
            set_register(c, a, value);
        }
        OP_CALL => {
            cycles += push_value(c, *pc)?;
            *pc = a;
        }
        // 60 return: the pop completes (esp moves, cache mutates) before the
        // target check faults, matching production checkedInstructionTarget.
        60 => {
            let (value, cost) = pop_value(c)?;
            cycles += cost;
            if value < 0 || value >= c.count {
                return Err(Fault {
                    code: FAULT_RETURN_TARGET_RANGE,
                    operand: value,
                });
            }
            *pc = value;
        }
        // Cold opcodes (58/59/61..65) exit before step(); reaching here means
        // the host corrupted the opcode or flag tables. Fail loudly.
        _ => die(),
    }
    Ok(cycles)
}

// --- slice loops ---

/// Port of `runCpuSlice`: pays outstanding cycle debt first, then executes
/// hot instructions, banking unpaid cycles back into the debt. Budget
/// validation (positive safe integers) is the host adapter's contract.
#[no_mangle]
pub extern "C" fn run_cpu_slice(cycle_budget: i64, instruction_budget: i64) -> i32 {
    let c = config();
    if !c.configured {
        die();
    }
    let mut pc = li32(c.state + STATE_INSTRUCTION_POINTER);
    let mut compared = li64(c.state + STATE_COMPARED);
    let mut debt = li64(c.state + STATE_CYCLE_DEBT);
    let mut consumed: i64 = 0;
    let mut executed: i64 = 0;
    let mut fault_code: i32 = 0;
    let mut fault_operand: i32 = 0;
    let reason: i32 = loop {
        if consumed >= cycle_budget {
            break EXIT_BUDGET_EXHAUSTED;
        }
        if debt > 0 {
            let remaining = cycle_budget - consumed;
            let paid = if debt < remaining { debt } else { remaining };
            debt -= paid;
            consumed += paid;
            continue;
        }
        if executed >= instruction_budget {
            break EXIT_BUDGET_EXHAUSTED;
        }
        if pc == c.count {
            break EXIT_END_OF_PROGRAM;
        }
        if pc < 0 || pc > c.count {
            // Production faults before advancing pc, so pc stays in place.
            fault_code = FAULT_INSTRUCTION_RANGE;
            fault_operand = pc;
            break EXIT_FAULT;
        }
        if lu8(c.flags + pc as u32) & FLAG_COLD_EXIT != 0 {
            break EXIT_COLD_INSTRUCTION;
        }
        match step(&c, &mut pc, &mut compared) {
            Ok(cycles) => {
                executed += 1;
                let cycles = cycles as i64;
                let remaining = cycle_budget - consumed;
                let paid = if cycles < remaining { cycles } else { remaining };
                consumed += paid;
                debt = cycles - paid;
            }
            Err(fault) => {
                // The faulting instruction's cycles and count are discarded,
                // like the production crash path.
                fault_code = fault.code;
                fault_operand = fault.operand;
                break EXIT_FAULT;
            }
        }
    };
    si32(c.state + STATE_INSTRUCTION_POINTER, pc);
    si64(c.state + STATE_COMPARED, compared);
    si64(c.state + STATE_CYCLE_DEBT, debt);
    si32(c.exit + EXIT_REASON, reason);
    si32(c.exit + EXIT_FAULT_CODE, fault_code);
    si64(c.exit + EXIT_CYCLES_CONSUMED, consumed);
    si64(c.exit + EXIT_INSTRUCTIONS_EXECUTED, executed);
    si32(c.exit + EXIT_FAULT_OPERAND, fault_operand);
    reason
}

/// Port of `runInstructionSlice`: reports full per-instruction cycle cost and
/// never reads or writes the cycle debt.
#[no_mangle]
pub extern "C" fn run_instruction_slice(instruction_budget: i64) -> i32 {
    let c = config();
    if !c.configured {
        die();
    }
    let mut pc = li32(c.state + STATE_INSTRUCTION_POINTER);
    let mut compared = li64(c.state + STATE_COMPARED);
    let mut consumed: i64 = 0;
    let mut executed: i64 = 0;
    let mut fault_code: i32 = 0;
    let mut fault_operand: i32 = 0;
    let reason: i32 = loop {
        if executed >= instruction_budget {
            break EXIT_BUDGET_EXHAUSTED;
        }
        if pc == c.count {
            break EXIT_END_OF_PROGRAM;
        }
        if pc < 0 || pc > c.count {
            fault_code = FAULT_INSTRUCTION_RANGE;
            fault_operand = pc;
            break EXIT_FAULT;
        }
        if lu8(c.flags + pc as u32) & FLAG_COLD_EXIT != 0 {
            break EXIT_COLD_INSTRUCTION;
        }
        match step(&c, &mut pc, &mut compared) {
            Ok(cycles) => {
                consumed += cycles as i64;
                executed += 1;
            }
            Err(fault) => {
                fault_code = fault.code;
                fault_operand = fault.operand;
                break EXIT_FAULT;
            }
        }
    };
    si32(c.state + STATE_INSTRUCTION_POINTER, pc);
    si64(c.state + STATE_COMPARED, compared);
    si32(c.exit + EXIT_REASON, reason);
    si32(c.exit + EXIT_FAULT_CODE, fault_code);
    si64(c.exit + EXIT_CYCLES_CONSUMED, consumed);
    si64(c.exit + EXIT_INSTRUCTIONS_EXECUTED, executed);
    si32(c.exit + EXIT_FAULT_OPERAND, fault_operand);
    reason
}
