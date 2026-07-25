# Issue #116 — CS486 interpreter dispatch structure without a second implementation

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/116

Status: implemented and host-verified. Real-BDS `run --stats` comparison remains
open.

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

## Open

Real-BDS `run --stats` before/after comparison on a guest-built program. Expect:
identical modeled `cpuCycles` and microarchitecture statistics with only host
wall time reduced. Guest timing must stay independent of host elapsed time, so a
change in wall clock alone is not evidence of correctness — the modeled fields
carry that.

## Explicit exclusions

This work does not add a second CS486 interpreter, transpiler, or native
executor, does not generate host code at runtime, and does not change any
modeled cycle cost, cache geometry, fault message, or syscall policy. It also
does not change where a process runs; engine selection stays operator
configuration.

A separate measured attempt to split `SetAssociativeCache`'s replacement hint
and inline its hit path was reverted: it measured equivalent but at 0.997x,
which is no measurable benefit for the added structure.
