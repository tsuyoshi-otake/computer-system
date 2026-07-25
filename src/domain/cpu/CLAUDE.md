# CPU domain guidance

## One implementation of one CPU

`Cs486Process` in `cs486.ts` is **the single production CS486 implementation**.
The shipped Bedrock pack runs it in the Script API engine, and the managed Web
companion runs the same class inside its compute workers. Issue #115 removed the
Rust wasm batch executor, so a change to instruction semantics, cycle costs, or
syscall policy now has exactly one place to land.

- Where a process runs is operator configuration; what it computes is not. A
  compute worker changes admission, scheduling, and host wall time. It must
  never change guest output, exit status, modeled cycles, or microarchitecture
  statistics.
- Do not reintroduce a second CS486 interpreter, transpiler, or native executor
  without an accepted Issue that also owns the differential equivalence
  evidence. The removed engine cost a permanent dual-maintenance tax on every
  item above; `docs/issues/issue-115-remove-wasm-executor.md` records why it was
  not worth paying.
- The compute worker still has no guest filesystem, terminal, scheduler, or DAC
  credentials, so it refuses every syscall except the isolated batch CS ABI
  subset. `run --batch` gives a worker process a startup image and lets it reach
  `exit`, `heapInfo`, and `fsWrite` on fd 1 and fd 2; everything else raises
  `Cs486Fault("UnsupportedOperationError", ...)` rather than being approximated.
  `tools/cs486-compute-worker-cpu-engine.ts` owns those refusals.
- The batch handler lives once in `src/application/runtime/csAbi.ts` and is
  shared by the in-session and worker paths, so the subset cannot drift between
  them. Extend `tools/cs486-corpora/batch-cs-abi-corpus.ts` when that subset
  changes, and keep `tests/tools/cs486BatchCsAbiCorpus.test.ts` pinning what
  each corpus program reaches on `Cs486Process`.
- The engine is never selected implicitly, and nothing falls back to a different
  engine on failure. That rule is about the shape of operator configuration, not
  about how many engines happen to exist.

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
- CS386SX has no on-die FPU, matching the real 80386SX's dependency on a
  discrete 80387SX coprocessor. Every `cs.fp.*` syscall faults on CS386SX with
  `Cs486Fault("UnsupportedError", ...)` at dispatch. The fault is a runtime
  dispatch check inside `executeFloatSyscall`, not a static pre-execution
  rejection, so linking `printf`-family float formatting without exercising it
  at runtime stays unaffected. CS486DX/DX2 model an on-die FPU and execute every
  `cs.fp.*` operation at its documented cycle cost.
- Neither CPU has dynamic branch prediction. Taken control transfers incur the
  deterministic pipeline/prefetch flush defined by the model.

## Memory hierarchy

- `CpuMemoryHierarchy` is transient, fixed-size, and O(1) per access. Never
  persist tags, recency, prefetch state, counters, or warm-cache state.
- CS386SX has no cache. An even-addressed 32-bit access uses two 16-bit
  transfers; an odd-addressed access uses three. Every transfer pays the full
  `mainMemoryTransferCycles` cost, matching CS486DX/DX2's per-transfer rate,
  because there is no cache line to absorb repeat traffic.
- CS486DX has a cold 8 KiB four-way unified, 16-byte-line, write-through L1.
  CS486DX2 adds a 256 KiB external L2. A cache hit stays effectively free; only
  an L1/L2 miss pays `mainMemoryTransferCycles` per line transfer, so CS386SX
  (no cache) pays that main-memory cost far more often than CS486DX/DX2 despite
  sharing the same per-transfer rate.
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
