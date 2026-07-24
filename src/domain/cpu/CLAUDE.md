# CPU domain guidance

## Shared process and ABI

- ASM, CS QBASIC, C, C++, and Computer System Python execute through one
  validated CS486 process and executable representation. Never fork a
  language-specific CPU engine or scheduler.
- Version 3 symbol metadata supports up to 32 `i32` word parameters and `i32` or
  `void` returns; v2 remains zero-argument-only. Integer returns use EAX. Keep
  object readers, executable validation, toolchain, Python extensions, debugger,
  tests, and manual synchronized with any versioned change.
- `CS486OBJ`/`CS486` are sandbox formats, not ELF, OMF, native x86, DOS COM, or
  DOS EXE. Validate versions, sections, symbols, relocations, instructions,
  addresses, stack bounds, and RAM layout before execution. Executables begin at
  instruction zero; the current format has no separate entry-point field.
- Legacy executables allow at most 4,096 instructions, 2,048 symbols, 256
  initialized segments, and 256,000 initialized bytes. Executable v4/v5 raises
  those ceilings to 65,536 instructions, 16,384 symbols, and 2 MiB initialized
  bytes while retaining 256 segments and 16 MiB of data. Executable v6 (the
  current writer output) further raises only the instruction ceiling to 524,288
  while keeping every other v4/v5 bound; v4/v5 ceilings themselves stay
  immutable. Output is capped at 64,000 JavaScript UTF-16 code units and
  inspection at 4,096 bytes.
- Objects allow 256,000 assembly-string UTF-16 code units and 16 MiB of data.
  Legacy objects allow 256,000 initialized bytes, 2,048 symbols, and 4,096
  relocations; object v3/v4 raises those ceilings to 2 MiB, 16,384, and 65,536.
  Process RAM is at least 64 KiB and never exceeds 16 MiB.
- `syscall cs.print.character` is the bounded word-character output primitive:
  EAX must contain one Unicode scalar value. Decimal `PRINT` remains unchanged,
  and total output still obeys the 64,000-code-unit process limit.

## Models and timing

- CPU identity, clock, and RAM persist together. Desktop defaults to CS486DX at
  33 MHz / 2 MiB; Advanced Desktop to CS486DX2 at 66 MHz / 8 MiB; Portable to
  CS386SX at 16 MHz / 2 MiB. CPU model/timing helpers do not apply profile
  migration heuristics.
- Instruction timing selection is O(1). CS386SX models Intel 80386 arithmetic,
  branch, early-out multiply, and 16-bit data-bus penalties. CS486DX/DX2 share
  486 instruction costs and differ by persisted clock.
- Neither CPU has dynamic branch prediction. Taken control transfers incur the
  deterministic pipeline/prefetch flush defined by the model.

## Memory hierarchy

- `CpuMemoryHierarchy` is transient, fixed-size, and O(1) per access. Never
  persist tags, recency, prefetch state, counters, or warm-cache state.
- CS386SX has no cache. An even-addressed 32-bit access uses two 16-bit
  transfers; an odd-addressed access uses three.
- CS486DX has a cold 8 KiB four-way unified, 16-byte-line, write-through L1.
  CS486DX2 adds a 256 KiB external L2.
- Keep instruction, L1/L2 hit/miss, bus transfer, unaligned access, pipeline
  flush, and cycle diagnostics synchronized with `run --stats`, CSBIOS, tests,
  and manual content.

## Process safety

- All fetch, decode, memory, stack, branch, syscall, wait, resume, and
  termination paths enforce address/RAM/instruction bounds and publish one
  explicit process outcome.
- Scheduler execution through `runCpuSlice` pays guest cycle debt before the
  next instruction. The public `runInstructionSlice` reports direct instruction
  cost without owning debt. Host wall time, scheduler delay, or MCP latency must
  never rewrite either path's accounting.

## Verification

Use `tests/runtime/cs486.test.ts`, `tests/runtime/cpuTiming.test.ts`, and
`tests/runtime/memoryHierarchy.test.ts` plus object/linker, Python-object,
debugger, and hardware-profile suites. Cover every model, aligned and odd
accesses, cold/warm cache paths, branch flushes, corrupt formats, stack
floor/overflow, cycle-debt drain order, deterministic statistics, and every
capacity-plus-one boundary.
