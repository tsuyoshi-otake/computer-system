# Issue #116 — CS486 interpreter dispatch structure without a second implementation

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/116

Status: implemented, host-verified, and real-BDS verified.

Depends on #115, which removed the Rust wasm batch executor and left
`Cs486Process` as the single production CS486 implementation. This Issue changes
only how that one implementation dispatches; it does not add a second one, and
it does not generate host code at runtime.

## Implemented boundary

`runHotCpuBurst` previously covered 21 register, ALU, and control-transfer
opcodes. Every load, store, push, pop, call, and return left the burst and paid
a full outer-loop round trip through `executeNext`, which is why memory-shaped
guest code ran at roughly half the throughput of ALU-shaped guest code.

The burst now also executes all 16 loads and stores, `push`, `pop`, `call`, and
`ret`. Three properties make that safe:

- **Side-effect order matches `executeNext` exactly**: instruction fetch, then
  `recordControlTransfer`, then the operation. The order is observable now that
  memory instructions are in the burst, because the instruction and data streams
  share one unified L1 on CS486DX/DX2 — their interleaving decides hit/miss
  classification, replacement, and every derived counter.
- **Refusal precedes the first side effect**: an instruction that could fault is
  refused to the cold path before its fetch, so `executeNext` re-executes it
  from an untouched modeled machine. `checkedAddress`, `push`, `pop`, and
  `checkedInstructionTarget` therefore remain the only places that raise a fault
  and word its message. Reading a return target out of guest RAM during
  admission is a plain host load: no modeled cycle, no cache effect.
- **Preparation stays CPU-model-independent**: `prepareCs486HotBurstEntries` is
  cached per executable, not per CPU model, so multiply, divide, and modulo stay
  cold — CS386SX prices multiply from the runtime multiplier and divide-by-zero
  is value-dependent. Indirect calls stay cold because they need signature
  admission; `syscall`, `print`, and `halt` stay cold because they reach
  process-level state.

Dispatch is two levels, lane then opcode. A register or ALU instruction cannot
fault, cannot transfer control, and has no address to admit, so it must not be
charged for testing any of that. The first flat-switch attempt did charge it,
and measured 0.89x–0.92x on `alu-branch cpu-slice`; the lane split removed that
cost while keeping the memory and stack gains.

`prepareCs486HotBurstEntries` also truncates guaranteed-depth propagation at
`ret`. A return's successor is a dynamic stack value and its `operandA` is left
at zero by preparation, which the dataflow would otherwise read as "transfers to
instruction 0". The burst still executes a return it reaches; it never starts at
one.

`push` and `pop` address ESP by its constant register index instead of going
through `readRegister`/`write`, whose `Cs486Register` string switch ran on every
stack operation. The register file is `Int32Array`-backed, so the stored value
is unchanged.

## Verification evidence

Verify on 2026-07-26: alternating A/B measurement,
`sh ab-cs486.sh "src/domain/cpu/cs486.ts" 3 4000000 9` followed by
`node ab-report.mjs "$TEMP/cs486-bench" 3`, comparing baseline against candidate
over three interleaved rounds of `tools/benchmark-cs486-interpreter.mjs` across
the `alu-branch`, `mem-stack`, and `hosted-c-mid` corpora, both `cpu-slice` and
`instruction-slice` modes, and all three CPU profiles. Best-of-round aggregation
is used deliberately: host interference can only slow a run down, so the maximum
is the closest estimate of the interference-free cost.

Expect: `guestCycles`, `guestRamSha256`, `registerChecksum`, every architectural
register, `instructionPointer`, `hasPendingCpuCycles`, guest output, and every
microarchitecture counter (`instructionFetches`, `l1Hits`, `l1Misses`, `l2Hits`,
`l2Misses`, `busTransfers`, `unalignedAccesses`, `pipelineFlushes`) are
identical between baseline and candidate on **cs386sx, cs486dx, and cs486dx2**.

Result: PASS. `EQUIVALENT across 3 rounds` — no field differed in any of the 18
configurations. Host throughput, `hostInstructionsPerSecond` in M/s, best of
three rounds:

| corpus / mode            | cs386sx     | cs486dx   | cs486dx2  |
| ------------------------ | ----------- | --------- | --------- |
| alu-branch cpu-slice     | 105.7→144.3 | 98.1→94.5 | 95.3→94.2 |
| mem-stack cpu-slice      | 71.0→97.7   | 46.9→61.5 | 44.7→58.0 |
| hosted-c-mid cpu-slice   | 79.0→126.9  | 59.2→83.5 | 60.7→82.9 |
| alu-branch instr-slice   | 85.6→86.1   | 73.8→74.0 | 71.8→71.2 |
| mem-stack instr-slice    | 77.8→78.7   | 50.2→49.6 | 48.4→48.7 |
| hosted-c-mid instr-slice | 87.5→88.1   | 64.7→64.3 | 65.1→63.9 |

Geometric mean 1.132x. The gain lands on `runCpuSlice`, which is the path the
scheduler uses; `runInstructionSlice` is flat because it does not enter the
burst. `hosted-c-mid`, the corpus closest to real guest C, gains 1.37x–1.61x.

`alu-branch cpu-slice` on CS486DX and CS486DX2 is the one configuration that is
not a gain: 0.95x–0.99x across repeated runs, flat to marginally slower. That is
the residual lane-lookup cost on the one instruction shape that needs nothing
else. It is recorded rather than averaged away.

Verify on 2026-07-26: repeat the same A/B against the Prettier-formatted source
that is actually committed, so the evidence matches the shipped bytes rather
than a pre-format draft.

Expect: the same complete equivalence across all three profiles.

Result: PASS. `EQUIVALENT across 3 rounds` again, with `hosted-c-mid cpu-slice`
at 1.37x–1.60x and `alu-branch cpu-slice` on CS486DX/DX2 at 0.95x–0.99x, which
reproduces the run above.

Verify on 2026-07-26:
`npx vitest run tests/runtime/cs486.test.ts tests/runtime/cpuTiming.test.ts tests/runtime/memoryHierarchy.test.ts`.

Expect: every instruction, timing, cache, branch-flush, stack-bound, and
cycle-debt assertion passes unchanged.

Result: PASS, 41 files.

Verify on 2026-07-26: `npm run validate`.

Expect: formatting, ESLint, TypeScript, all Vitest tests, the production Bedrock
pack build, and the 16-chapter Pages build pass.

Result: PASS.

Verify on 2026-07-26: hoist the per-instruction `try`/`catch` out of all three
slice loops in `cs486.ts` — `runCpuSliceWithHotBurst`,
`runCpuSliceWithoutHotBurst`, and `runInstructionSlice` — into one
`for (;;) { try { while (...) { ... } break } catch { this.crash(error) } }` per
slice, then measure it with the same alternating A/B command as above.

Expect: complete equivalence across all three profiles, and a throughput ratio
large enough to justify the structure.

Result: REVERTED. Equivalence held (`EQUIVALENT across 3 rounds`), but the
geometric mean over all 18 configurations was 1.002x, with every individual
configuration inside ±2% on cs386sx, cs486dx, and cs486dx2 alike. V8 already
costs a `try` region around a loop body at effectively nothing, so there was
nothing to recover. The hoist was not free either: the baseline `try` wraps only
`executeNext` and leaves the `runHotCpuBurst` call outside it, so hoisting would
have converted a throw escaping the burst into a crashed process instead of
letting it propagate. That path is unreachable by construction — the burst
refuses every faulting instruction before its first side effect — but it weakens
the invariant that `executeNext` owns every fault, and a measured 1.002x buys
nothing to pay for it.

Verify on 2026-07-26: real-BDS `run --stats` before/after comparison on a
guest-built program. Two detached worktrees hold the adjacent pair — `1113724`
(v0.1.0-alpha.10, the commit before this change) and `472d059` (this change) —
because `main` also carries #111, #112, and #113, one of which altered
cumulative CPU accounting. A driver speaks stdio JSON-RPC to
`tools/bds-mcp-server.mjs` with `BDS_MCP_WORKDIR` under `%USERPROFILE%\tmp` and
`BDS_MCP_WORLD=ComputerSystemAcceptance`, starts each build with
`bds_start({resetWorld:true, acceptanceFixture:true})`, waits for
`CS_STORAGE_MIGRATION {"state":"complete"`, provisions the fixture Computer,
polls `whoami` until CSBIOS hands the shell over, writes a compute-shaped C
program with `echo` one line at a time, builds it with `cc`, and runs
`run --stats /tmp/b` five times. The program fills a 64-element `int` array and
then loops a leaf call over it, so loads, stores, `push`, `pop`, `call`, and
`ret` all run inside the burst rather than only ALU instructions.

Expect: identical modeled `cpuCycles` and microarchitecture statistics with only
host wall time reduced. Guest timing must stay independent of host elapsed time,
so a change in wall clock alone is not evidence of correctness — the modeled
fields carry that.

Result: PASS on the fixture Computer's CS486DX2 at 66 MHz. Every modeled field
is identical between the two builds, in all ten runs:

```text
CS486DX2: 116987 instructions, 240885 CPU cycles, 3649.773 us at 66 MHz, halted
memory: L1 147205 hit/134 miss, L2 0 hit/134 miss, 14114 bus transfers,
        0 unaligned, 4176 pipeline flushes
```

Only the `host:` line moved. Host wall elapsed per run, five runs each:

| build            | wall elapsed (ms)       | median | guest CPU cycles/s |
| ---------------- | ----------------------- | ------ | ------------------ |
| `1113724` before | 212, 229, 245, 226, 229 | 229    | 1,051,900          |
| `472d059` after  | 158, 161, 164, 163, 164 | 163    | 1,477,822          |

That is 1.40x on the median and 1.34x on the best run, which reproduces the host
A/B harness's 1.37x for `hosted-c-mid cpu-slice` on CS486DX2 from an independent
instrument. The in-world path is the scheduler's `runCpuSlice`: the guest
process is admitted in bounded sub-slices whose throttle is a host-microsecond
budget, so a faster interpreter finishes in fewer ticks and the guest OS reports
less wall time. The modeled 3649.773 us of guest time is unchanged, which is the
point — host elapsed time never rewrote guest timing.

The fixture provisions one Computer, so this is CS486DX2 evidence. CS386SX and
CS486DX rest on the host A/B harness, which measured equivalence and throughput
on all three profiles.

## Measured headroom and exhausted directions

Verify on 2026-07-28: profile the interpreter on `hosted-c-mid`, CS486DX2,
`cpu-slice`, 4,000,000 instructions, then size each candidate by replacing one
modeled component with a stub and re-measuring, and finally A/B each real
candidate against the shipped bundle with alternating best-of rounds.

Expect: a self-time breakdown that identifies the dominant serial cost, and a
measured ceiling for each direction before any of them is implemented.

Result: the remaining cost is concentrated in the memory-hierarchy model, and
every structural attempt to reduce it measured neutral or worse.

Self time: `runHotCpuBurst` 36.2%, `SetAssociativeCache.access` 18.0%,
`fetchInstruction` 9.9%, garbage collection 4.5%, `accessCachedLine` 4.3%,
`accessData` 2.0%. The hierarchy is roughly 34% of the process and roughly 46%
of interpreter-only time.

Stub ceilings, host `M/s`, best of five, against 85.0 baseline: stubbing both
`fetchInstruction` and `accessData` reaches 189.9 (2.23x), `fetchInstruction`
alone 137.7 (1.62x), `accessData` alone 94.5 (1.11x). Instruction fetch is
therefore the dominant serial bottleneck. Narrowing it further, a
`fetchInstruction` reduced to only its two statistics counters reaches 121.4, so
the counters cost about a third of that ceiling and the cache lookup the rest.
The realistic ceiling for a perfect fetch fast path is about 1.4x, not 1.62x.

Five candidates were built and measured against that ceiling. None shipped:

| candidate                                                            | measured                    |
| -------------------------------------------------------------------- | --------------------------- |
| Per-stream line hints in `fetchInstruction`/`accessData`             | 0.94x                       |
| The same hints with the existing global line memo restored alongside | 0.89x                       |
| Removing the global line memo alone                                  | 0.95x                       |
| Inlining the global memo's hit path into `fetchInstruction`          | 0.86x                       |
| Splitting the miss paths out of `accessCachedLine` and `access`      | 0.98x                       |
| Inlining `push`/`pop` into the burst's stack lane                    | 0.98x-1.06x, geomean ~1.01x |

The stream hints were verified equivalent by the full 18-configuration harness
before being rejected on throughput; the rest were rejected before equivalence
work began. Their hint hit rate on the instruction stream is 72.9%, so the
design worked and still lost: every hint needs a `lastAccess` record written on
every access, and that bookkeeping costs more than the two saved calls save.

The single largest signal is that growing `fetchInstruction`'s body is expensive
out of proportion to the work added — inlining a five-operation hit path into it
cost 14%. The hot chain is at a local optimum that resists both inlining and
splitting, which reproduces the 0.997x result already recorded above from a
different direction. Inlining `push`/`pop` does remove a heap allocation per
`pop` and `ret`, but its measured effect stays inside this host's ±5% run-to-run
spread on `mem-stack`, so it is not evidence of a gain.

A typed-array replacement for the `DataView` guest-memory accesses measured
1.045x on `mem-stack` as an unguarded stub. Dword and byte accesses are admitted
unaligned by design, so a shipped version needs an alignment branch and a host
endianness guard that the stub did not pay, and 16-bit accesses would keep their
current path. What remains after those guards is smaller than the measurement
spread.

Further throughput work on this interpreter should target something other than
the L1 model's hot path. The next untested directions are the per-instruction
budget arithmetic in `runHotCpuBurst` and the burst's own dispatch, not the
cache.

## Explicit exclusions

This work does not add a second CS486 interpreter, transpiler, or native
executor, does not generate host code at runtime, and does not change any
modeled cycle cost, cache geometry, fault message, or syscall policy. It also
does not change where a process runs; engine selection stays operator
configuration.

Two separately measured attempts were reverted rather than shipped, and are
recorded above so neither is retried blind: splitting `SetAssociativeCache`'s
replacement hint and inlining its hit path (0.997x), and hoisting the
per-instruction `try`/`catch` out of the three slice loops (1.002x). Both
measured equivalent; neither measured faster.
