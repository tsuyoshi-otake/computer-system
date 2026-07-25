# Issue #106 Phase 4: gated Rust/WASM batch-executor prototype

GitHub Issue:
[Optimize CS486 execution throughput and remove module-load compilation](https://github.com/tsuyoshi-otake/computer-system/issues/106)

Status on 2026-07-24: prototype implemented and host-verified in the working
tree. This document records the Phase 4 adoption-gate evidence only. The
prototype is **not integrated** into the production `Cs486Process` path, the
scheduler, the managed runtime-worker pool, or any release pack; production
integration remains a separate decision to be made from this evidence.

Status on 2026-07-25: acting on that evidence, the Rust variant became an
**opt-in** compute-worker engine in the managed Web companion. See
[Phase 5: opt-in compute-worker integration](#phase-5-opt-in-compute-worker-integration)
for what changed, what stayed out of scope, and which gate evidence is still
outstanding. Everything above that section remains the 2026-07-24 record and is
not restated in light of the integration.

Status on 2026-07-25: the MCP debug companion can now start the same compute
plane, so an MCP-driven session can actually execute guest work on the selected
engine. See
[Phase 6: MCP debug sessions reach the compute plane](#phase-6-mcp-debug-sessions-reach-the-compute-plane).

Status on 2026-07-25: the AssemblyScript variant was deleted after it failed the
adoption gate. See
[AssemblyScript variant removal](#assemblyscript-variant-removal). Its
measurements below are the record that decided it and remain as written; the
sources, artifact, and toolchain they describe no longer exist in the tree.

## Implemented boundary

Two WebAssembly batch executors share one host-defined ABI
(`tools/cs486-wasm-batch-executor-abi.ts`, `abiVersion` 1): a Rust `#![no_std]`
variant (`wasm/cs486-batch-executor-rs/`, built with Rust 1.96.0 for
`wasm32-unknown-unknown`) and an AssemblyScript variant
(`wasm/cs486-batch-executor-as/`, `assemblyscript` 0.28.20, `runtime="stub"`,
raw `load<T>`/`store<T>` intrinsics only). Both export the same seven symbols,
import nothing, and are instantiated by one shared loader
(`tools/cs486-wasm-batch-executor-loader.mjs`), which is the proof that the ABI
is variant-independent.

Each executor advances already-validated ordinary CS486 instructions inside one
bounded slice call (`run_cpu_slice` with cycle-debt ownership, or
`run_instruction_slice` without it), crossing the JS/WASM boundary once per
slice as Phase 4 requires. Budgets are i64. Cold instructions (`call_indirect`,
`syscall`, all `print` forms, `halt`) and the end-of-program boundary exit back
to TypeScript, where `tools/cs486-wasm-cold-op-bridge.ts` executes them against
the same modeled timing (`cycles = baseCycles + fetchInstruction(index)`), so
syscalls, guest filesystem, output limits, scheduling, and lifecycle
finalization stay TypeScript-owned. Faults are pre-checked (division by zero,
`INT_MIN / -1`, 16-bit alignment, stack bounds, runtime `ret` targets) so no
wasm trap ever escapes to the host; the wasm side reports numeric fault codes
and TypeScript reconstructs the exact `VmRuntimeError` wording. The comparison
value is widened to i64 to preserve non-wrapping `cmp` semantics, and the
CS386SX early-exit multiply cost uses the integer identity
`32 - clz32(magnitude - 1)` on the unsigned-widened magnitude instead of
floating-point `log2`.

The production sources `src/domain/cpu/cs486.ts`, `scheduler.ts`,
`computerRuntime.ts`, and the managed worker pool are unchanged. Instruction
tables are re-derived from the public `Cs486Executable.instructions` shape by
`tools/cs486-wasm-batch-executor-prep.ts`, and cycle costs come from the
exported `instructionCycleCost()`. `wasm/dist/` artifacts,
`wasm/cs486-batch-executor-rs/target/`, and
`wasm/cs486-batch-executor-as/build/` are untracked; `npm run validate` neither
requires cargo/asc nor the built artifacts.

## Methodology and environment

- Host: Windows 11 (win32), AMD Ryzen 7 9700X 8-Core, Node.js v26.2.0.
- Engines: `ts` (the optimized production TypeScript interpreter after the Phase
  3 work recorded in `issue-16-cs486-hot-burst.md`), `wasm-rust`, `wasm-as`, all
  loaded through the same benchmark engine adapter.
- Corpora: `alu-branch` (the pre-existing register/branch stream), `mem-stack`
  (push/pop, call/ret, strided loads/stores sized to thrash the 128-set L1), and
  `hosted-c-mid` (a hosted-C compiled and linked program: seeded LCG array,
  repeated sort, checksum).
- Matrix: 3 engines x 3 corpora x 3 CPU profiles (CS386SX/CS486DX/CS486DX2) x
  instrumentation enabled/disabled, 2,000,000 instructions per sample, 21 warm
  samples per engine per cell, engine order rotated cyclically per sample index.
  Within every cell all three engines must produce identical guest evidence
  (executed instructions, modeled cycles, full guest-RAM SHA-256, instruction
  pointer, registers, register checksum, output, process state, pending-cycle
  state, and microarchitecture statistics when enabled) before host timing is
  compared; any mismatch aborts the run.
- Host medians and p95 are host implementation cost only, never guest speed. The
  user's interactive managed BDS/Web session was running on the same host during
  the full sweep, which adds background load noise; it is visible in a few p95
  outliers (for example the 61.25 ms ts p95 in one alu-branch cell) but does not
  affect medians materially or guest evidence at all.

## Acceptance evidence

### Harness extension is non-breaking

`Verify:`

```powershell
npm run benchmark:cs486 -- --instructions 2000000 --samples 7 --mode cpu-slice --instrumentation disabled
```

`Expect:` with legacy flags only, the extended harness reports the same
`cs486-cpu-slice-host-throughput-v1` shape and the same authoritative guest
evidence as the Issue #16 evidence document.

Observed on 2026-07-24: identical output shape; all three profiles completed
2,000,000 instructions with the same registers, register checksum 260870, and
guest-RAM SHA-256 `de2f2560…9ca9cc31` as before, at 99.7 to 107.3 M host
instructions/s.

### Reproducible dual-variant build

`Verify:`

```powershell
npm run build:cs486-wasm
npm run build:cs486-wasm:check
```

`Expect:` both `.wasm` artifacts and `SHA256SUMS.txt` are produced; a rebuild
into a temporary path yields byte-identical digests; `--check` exits 0.

Observed on 2026-07-24: `cs486-batch-executor.rust.wasm` (16,555 bytes) and
`cs486-batch-executor.as.wasm` (5,899 bytes) rebuilt to identical SHA-256
digests and the check pass exited 0.

### Differential equivalence with fuzzing

`Verify:`

```powershell
npm run verify:cs486-wasm-equivalence -- --seeds 32 --cpu cs386sx,cs486dx,cs486dx2 --instrumentation enabled,disabled
```

`Expect:` zero divergences for both wasm engines across all seeds, profiles, and
instrumentation modes, comparing per-slice registers, pc, cycle debt, executed
instructions, and exit reason plus final RAM SHA-256, output, and
microarchitecture statistics. The corpus must include the forced edge cases
(`INT_MIN / -1`, negative `mod`/`umod`, shifts > 31, odd-address accesses,
cache-set conflict runs).

Observed on 2026-07-24: both engines reported
`comparisons: 361693, configurations: 516, divergences: 0, programs: 43` (32
seeded fuzz programs plus 11 forced edge-case programs). The comparator's
detection power was proven first by a negative sanity check: corrupting the
`fetch_instruction` bridge by +1 cycle produced 6 reported divergences (for
example `field=cpuCycles ts=188 wasm=189`) before the uncorrupted run reported
zero. `tests/tools/cs486WasmEquivalence.test.mjs` passes with artifacts present
and skips without them.

### A/B host-cost matrix

`Verify:`

```powershell
npm run benchmark:cs486:wasm-ab
```

`Expect:` the full 3 x 3 x 3 x 2 matrix with 21 rotated warm samples per engine
per cell, identical cross-engine guest evidence in every cell, and median/p95
host cost with speedup versus the optimized TypeScript baseline.

Observed on 2026-07-24 (`benchmark-cs486-wasm-ab-v1`, instruction-slice mode,
2,000,000 instructions, host medians in ms with p95 in parentheses):

| Corpus       | CPU      | Stats    | ts median (p95) | wasm-rust median (p95) | rust vs ts | wasm-as median (p95) | as vs ts |
| ------------ | -------- | -------- | --------------- | ---------------------- | ---------- | -------------------- | -------- |
| alu-branch   | cs386sx  | enabled  | 24.89 (29.37)   | 6.20 (7.41)            | 4.02x      | 8.42 (8.99)          | 2.96x    |
| alu-branch   | cs386sx  | disabled | 23.74 (25.10)   | 6.26 (6.63)            | 3.79x      | 8.33 (9.04)          | 2.85x    |
| alu-branch   | cs486dx  | enabled  | 30.17 (33.07)   | 12.90 (15.46)          | 2.34x      | 18.58 (20.50)        | 1.62x    |
| alu-branch   | cs486dx  | disabled | 29.39 (37.05)   | 12.75 (14.84)          | 2.30x      | 15.88 (20.34)        | 1.85x    |
| alu-branch   | cs486dx2 | enabled  | 32.36 (36.39)   | 12.78 (18.74)          | 2.53x      | 19.17 (23.62)        | 1.69x    |
| alu-branch   | cs486dx2 | disabled | 32.72 (61.25)   | 12.59 (29.86)          | 2.60x      | 15.79 (30.90)        | 2.07x    |
| mem-stack    | cs386sx  | enabled  | 29.53 (33.64)   | 7.33 (7.78)            | 4.03x      | 11.32 (12.11)        | 2.61x    |
| mem-stack    | cs386sx  | disabled | 27.07 (29.52)   | 6.56 (7.85)            | 4.13x      | 10.73 (12.06)        | 2.52x    |
| mem-stack    | cs486dx  | enabled  | 42.56 (47.17)   | 19.74 (20.93)          | 2.16x      | 26.27 (27.27)        | 1.62x    |
| mem-stack    | cs486dx  | disabled | 42.28 (44.32)   | 19.26 (20.26)          | 2.20x      | 24.54 (26.37)        | 1.72x    |
| mem-stack    | cs486dx2 | enabled  | 45.94 (62.52)   | 21.71 (41.03)          | 2.12x      | 28.35 (32.94)        | 1.62x    |
| mem-stack    | cs486dx2 | disabled | 45.73 (54.59)   | 20.83 (27.38)          | 2.20x      | 26.66 (30.48)        | 1.72x    |
| hosted-c-mid | cs386sx  | enabled  | 26.88 (31.42)   | 6.62 (7.76)            | 4.06x      | 10.65 (11.79)        | 2.52x    |
| hosted-c-mid | cs386sx  | disabled | 25.55 (26.87)   | 6.27 (6.87)            | 4.08x      | 11.05 (11.53)        | 2.31x    |
| hosted-c-mid | cs486dx  | enabled  | 38.09 (42.38)   | 16.41 (19.72)          | 2.32x      | 23.79 (27.26)        | 1.60x    |
| hosted-c-mid | cs486dx  | disabled | 35.99 (39.27)   | 15.68 (17.56)          | 2.29x      | 22.29 (30.29)        | 1.61x    |
| hosted-c-mid | cs486dx2 | enabled  | 37.13 (39.08)   | 16.29 (17.77)          | 2.28x      | 23.56 (24.74)        | 1.58x    |
| hosted-c-mid | cs486dx2 | disabled | 36.60 (39.61)   | 15.66 (18.41)          | 2.34x      | 22.24 (24.80)        | 1.65x    |

Every cell also matched cross-engine guest evidence exactly; for example the
hosted-c-mid CS486DX2 cells agreed on guest-RAM SHA-256 `9a7e29e6…f85de372` and
register checksum 327931 across all three engines.

### Bedrock in-engine WebAssembly probe

`Verify:`

```powershell
$env:COMPUTER_SYSTEM_WASM_PROBE = "1"; npm run build
# start the managed BDS/Web companion against a dedicated isolated
# BDS_MCP_WORKDIR and BDS_MCP_PORT, then wait for the probe log line
```

`Expect:` exactly one `CS_WASM_PROBE result={…}` warning during Script API
startup; with the flag unset, a rebuild removes the probe entirely from the
bundle.

Observed on 2026-07-24 against an isolated managed workdir (the preserved
interactive world was left untouched):

```text
[2026-07-24 21:31:05:697 WARN] [Scripting] CS_WASM_PROBE result={"available":false,"runtimeType":"undefined"}
```

The Bedrock script engine exposes no `WebAssembly` global, so in-engine wasm
execution is impossible; see the `docs/feasibility-matrix.md` row. The
probe-free rebuild contains zero occurrences of the probe string
(`tools/build.mjs` swaps the probe module for an inert stub), so release bundles
are unaffected. This finding does not block the Phase 4 gate; it scopes any
adoption benefit to the Node-side managed runtime-worker pool.

### Host gates with and without artifacts

`Verify:`

```powershell
# with wasm/dist present
npm run validate
# with wasm/dist temporarily removed
npm run validate
```

`Expect:` both runs pass completely; without artifacts the equivalence vitest
wrapper skips instead of failing, proving the host gate needs neither cargo,
asc, nor built wasm.

Observed on 2026-07-24: with `wasm/dist` present, `npm run validate` passed
completely (307 test files, 2,529 tests passed, including the equivalence vitest
wrapper with zero divergences); with `wasm/dist` removed, the same command
passed completely (307 test files, 2,528 tests passed and 1 skipped — the
equivalence vitest wrapper — out of 2,529). Both runs produced the production
pack and Pages builds successfully, proving the host gate is green whether or
not the wasm artifacts exist.

## Adoption-gate verdict

Issue #106 states: "Rust/WASM is adopted only if it improves representative
median host CPU cost by at least 2x over the optimized TypeScript baseline
without worsening p95 BDS tick time or bundle/startup cost", with differential
tests proving exact equivalence.

- **wasm-rust: PASS.** Median host cost improved between 2.12x and 4.13x versus
  the optimized TypeScript baseline in all 18 matrix cells, so the ≥ 2x
  requirement holds on every representative workload, profile, and
  instrumentation mode, not only in aggregate. Differential equivalence is
  proven (zero divergences over 361,693 comparisons in 516 configurations, with
  the comparator's sensitivity demonstrated by a forced negative check). Bundle
  and startup cost are unchanged because the prototype ships nothing: the
  release bundle contains no wasm or probe code. p95 BDS tick non-regression
  cannot regress from an unintegrated prototype, but it must be re-measured as
  part of any future production integration.
- **wasm-as: FAIL.** 11 of 18 cells fall below 2x (minimum 1.58x); only the
  CS386SX rows and two alu-branch cells clear the gate. The AssemblyScript
  variant is therefore not adopted.

Consequence: the gate evidence supports adopting the **Rust** variant if and
when Phase 4 proceeds to production integration in the managed runtime-worker
pool. No integration is performed in this change; the TypeScript interpreter
remains the only production execution path and the reference oracle. Phase 5
(2026-07-25) acted on this consequence; see the section below.

## Rust versus AssemblyScript selection

- Host cost: wasm-rust is faster than wasm-as in every cell (1.26x to 1.61x
  faster on medians) and is the only variant that clears the 2x gate.
- Artifact size: wasm-as is smaller (5,899 bytes versus 16,555 bytes); both are
  negligible for a Node-side worker and neither ships in the release bundle.
- Fidelity and ergonomics: both variants implement the identical ABI and pass
  the same equivalence suite, so correctness does not differentiate them. The
  Rust variant is `#![no_std]` with no allocator and benefits from LLVM's
  optimizer; the AssemblyScript variant honors the same constraints but its
  optimizer produces measurably slower code on this workload.
- Toolchain friction: AssemblyScript is an npm devDependency; Rust requires an
  external toolchain plus the `wasm32-unknown-unknown` target. Both remain
  optional because artifacts are untracked and `npm run validate` never invokes
  either toolchain.

Recommendation: **Rust** is the sole candidate for any future integration;
AssemblyScript served as an ABI cross-check and a lower-friction fallback but
does not meet the gate.

## Residual evidence

Real-BDS p95 tick behavior under the wasm executor, managed-worker transport
integration, slice-boundary interaction with the scheduler's admission contract,
and multi-Computer load evidence are intentionally out of scope for this
prototype and belong to the separate integration decision (and Issue #16's open
load evidence). The full sweep ran while an interactive managed BDS session was
live on the same host; medians were stable, but a rerun on a quiet host would
tighten the p95 columns.

## Phase 5: opt-in compute-worker integration

Status on 2026-07-25: implemented and host-verified. The Rust executor is now
selectable by the managed Web companion's compute workers. The release Bedrock
pack is untouched and still runs `Cs486Process` exclusively; nothing in this
phase ships to Minecraft.

### Integrated boundary

- `tools/cs486-compute-worker-cpu-engine.ts` is the only place that knows the
  two engines apart. It exposes one `Cs486ComputeCpuEngine` contract
  (`createProcess`, `name`) implemented by `Cs486Process` and by the wasm
  executor, so `tools/cs486-compute-worker-entry.ts`, the pool, and the loopback
  wire protocol stay engine-agnostic.
- Engine names are `typescript` (default) and `wasm-rust`. Precedence is
  `WEB_COMPANION_CPU_ENGINE`, then the persisted `cpuEngine` field, then the
  default. The admin config moved to version 3 with a `keyIntroducedVersion`
  table so an older companion cannot silently ignore a newer key.
  `npm run web:config -- set --cpu-engine wasm-rust` persists it and
  `--clear-cpu-engine` restores `typescript`.
- The pool resolves `wasm/dist/cs486-batch-executor.rust.wasm` **before**
  spawning any worker and structured-clones the bytes to each thread, so a
  worker compiles the module once and every guest process instantiates its own
  linear memory. A missing or malformed artifact rejects pool initialization,
  which rejects `startManagedBdsWithWeb`'s pool creation, which fails managed
  startup. There is no fallback to the TypeScript engine in either direction:
  falling back would attribute guest results to an engine nobody selected.
- Each worker reports the engine it actually loaded in its `ready` message and
  the endpoint treats a mismatch as a protocol failure, so a thread that loaded
  something other than the requested engine never becomes ready. Companion
  status reports the requested pool engine plus each worker's reported engine.
- The wasm engine refuses at create time what it cannot execute faithfully:
  `cs.fp.*` syscalls on a profile that has an FPU (deterministic float stays
  BigInt-rational TypeScript) and process-image initialization. It runs the
  shared executable validator itself because it never constructs a
  `Cs486Process`. On CS386SX it does not refuse the float syscall; it admits the
  executable and reproduces the identical `UnsupportedError` missing-80387 fault
  at dispatch, matching the TypeScript engine on that profile.
- Dual maintenance is now a written rule. `src/domain/cpu/CLAUDE.md` owns the
  list of responsibilities that must change in both implementations and names
  `npm run verify:cs486-wasm-equivalence` as the agreement proof;
  `wasm/CLAUDE.md` and `tools/CLAUDE.md` carry the scoped consequences; the root
  `CLAUDE.md` carries the repository-wide rule.

### Verification

`Verify:`

```powershell
npx vitest run tests/tools/cs486ComputeCpuEngine.test.ts tests/tools/cs486ComputeWorkerPool.test.mjs tests/tools/webCompanionAdminConfig.test.mjs tests/tools/bdsWebCompanionLifecycle.test.mjs
```

`Expect:` all suites pass, including the differential check that a `wasm-rust`
slice equals a TypeScript slice, the CS386SX fault reproduction, the create-time
refusals, the `.mjs`/TypeScript engine-registry agreement, the config version-3
round trip and gating, and the lifecycle assertions that the requested engine
reaches the pool and that a failed wasm load leaves the companion `failed`
without a second pool. Observed on 2026-07-25 with `wasm/dist` present: 32
passed, 0 failed.

`Verify:` `npm run validate` with `wasm/dist` present and again with it removed.

`Expect:` both runs pass completely; without the artifact every wasm-dependent
suite skips rather than fails, keeping the host gate free of cargo and asc.

Observed on 2026-07-25: with `wasm/dist` present, 308 test files and 2,546 tests
passed with none skipped; with `wasm/dist` moved aside, 308 test files passed
with 2,540 passed and 6 skipped. Both runs also completed formatting, ESLint,
TypeScript, the production pack build, and the Pages build.

### Still outstanding

The Issue #106 gate requires p95 BDS tick non-regression. That column was
unmeasurable while the executor was unintegrated and is still unmeasured under
the integrated engine: it needs a real managed-BDS run with
`WEB_COMPANION_CPU_ENGINE=wasm-rust` compared against the same workload on
`typescript`, plus Issue #16's multi-user load evidence. Until that exists,
`wasm-rust` is an opt-in engine backed by host benchmarks and differential
equivalence, not a defaulted one.

## AssemblyScript variant removal

Status on 2026-07-25: the AssemblyScript variant was deleted from the working
tree. Everything recorded above about it — the reproducible dual-variant build,
its differential-equivalence pass, its A/B numbers, the adoption-gate FAIL, and
the Rust-versus-AssemblyScript selection — is the measurement record that
produced this decision and is not restated or revised by the removal.

It was removed because it had no remaining role. It failed the >=2x adoption
gate (11 of 18 cells below 2x, minimum 1.58x), it was never selectable as a
compute engine, and keeping it obliged every future CPU-behaviour change to be
ported into a third implementation whose only output was a comparison already
taken.

Removed or changed:

- Deleted `wasm/cs486-batch-executor-as/`,
  `tools/wasm-engines/as-engine-entry.ts`, and the built
  `wasm/dist/cs486-batch-executor.as.wasm`.
- Dropped the `assemblyscript` devDependency, the `asc` preflight and build step
  in `tools/build-cs486-wasm.mjs`, and the `.prettierignore` entry that existed
  only because AssemblyScript source uses compiler-only syntax.
- Narrowed `cs486WasmVariantNames` to `["rust"]` and `benchmarkEngines` to
  `["ts", "wasm-rust"]`, so the equivalence CLI, the A/B orchestrator, and their
  suites derive the smaller matrix without a second edit. The variant list stays
  plural: a future variant needs no loader change.

`Verify:` `npm run build:cs486-wasm && npm run build:cs486-wasm:check` then
`npm run validate`. `Expect:` `wasm/dist` holds exactly
`cs486-batch-executor.rust.wasm` plus `SHA256SUMS.txt`, the rebuild reproduces
the same digest, and the host gate passes with no AssemblyScript toolchain
installed.

## Phase 6: MCP debug sessions reach the compute plane

Status on 2026-07-25: implemented, host-verified, and real-BDS-verified. Inside
an MCP session the `wasm-rust` compute plane is confirmed live against real BDS,
and a compiled guest program is confirmed executing on a `wasm-rust` compute
worker and returning its result through `bds_execute_computer_command`. See
"Real-BDS observation" below for the exact evidence and for the properties of
the MCP and guest surfaces that observation depends on.

Phase 5 made `wasm-rust` selectable by `npm run dev:bds:web` only. The MCP debug
companion built the ordinary release pack, so `runtimeWorkerFactory()` returned
`undefined` and every guest slice ran the in-engine `Cs486Process` no matter
what `WEB_COMPANION_CPU_ENGINE` said. MCP-driven verification therefore could
not exercise the wasm engine at all, and a `wasm-rust` selection during an MCP
session was silently inert — the exact "results attributed to an engine nobody
ran" failure the rest of this issue is written to prevent.

### Integrated boundary

- `tools/cs486-compute-plane.mjs` now owns pool creation, the 256-bit bearer
  token, the exact `ws://127.0.0.1:PORT/internal/cs486/v1` endpoint, listener
  status validation, and exactly-once shutdown. `tools/bds-web-companion.mjs`
  was refactored onto it with no change to its observable startup order,
  cancellation behaviour, or status shape; `tools/bds-mcp-server.mjs` starts the
  same plane. One owner means the fail-loud artifact rule cannot drift between
  the two entry points.
- `tools/mcp-runtime-workers.mjs` owns the MCP policy. `BDS_MCP_RUNTIME_WORKERS`
  is unset or `0` by default, which keeps the in-engine CPU and starts no
  threads and no listener; `1` through 16 opts in. Anything else is a
  `RangeError` at startup.
- Selecting a non-default engine while the workers stay disabled is rejected
  before the world is touched, with a message naming both the variable and the
  selected engine. Without this the operator's `wasm-rust` request would produce
  TypeScript results labelled `wasm-rust` in an MCP evidence log.
- `bds_status` reports `runtimeWorkers` (count and endpoint), `cpuEngine`, and
  the `compute` listener/pool snapshot. All three are `null` in the ordinary
  in-engine shape, so status never names an engine that did not execute a slice.
  The bearer token stays out of every tool result; only the restricted managed
  `secrets.json` holds it.
- The MCP server stops the plane on the Web-companion startup failure path and
  in `shutdown()`, so an aborted or closed session leaves no listener or worker
  thread behind.

### Verification

`Verify:` `npm run test:mcp`

`Expect:` the debug-session, MCP-server, runtime-worker-policy, compute-plane,
and TUI-verifier suites pass, including: the plane starts the pool before the
listener and closes both exactly once; a pool that cannot load its engine admits
no listener and creates no second pool; a listener that is not the exact
authenticated loopback endpoint is rejected; the token never appears in status;
`bds_status` reports `null` for all three fields without workers and the real
count, endpoint, engine, and ready pool with `BDS_MCP_RUNTIME_WORKERS=1`; and
the server exits non-zero with an actionable message for `wasm-rust` without
workers and for an out-of-range worker count. Observed on 2026-07-25: 5 files,
39 tests passed.

### Real-BDS observation

Status: complete. The plane is confirmed live and so is the guest-side leg.

`Verify:` start `tools/bds-mcp-server.mjs` over stdio with
`BDS_MCP_RUNTIME_WORKERS=2`, `WEB_COMPANION_CPU_ENGINE=wasm-rust`,
`WEB_COMPANION_CONFIG_FILE=""`, an empty disposable `BDS_MCP_WORKDIR` under
`%USERPROFILE%\tmp`, and `BDS_MCP_WORLD=ComputerSystemAcceptance`. Call
`bds_status`, then `bds_start` with `resetWorld: true` and
`acceptanceFixture: true`, then `bds_wait_for_log` for
`CS_RUNTIME_WORKER_READY`.

`Expect:` `bds_status` before start reports `cpuEngine` `wasm-rust`, a `ready`
pool of two workers that each report `wasm-rust`, a listener bound to
`127.0.0.1` on path `/internal/cs486/v1`, and `runtimeWorkers` carrying count
`2` with the matching `ws://127.0.0.1:<port>/internal/cs486/v1` endpoint and no
token; `bds_start` reaches `running`; the BDS log contains
`CS_RUNTIME_WORKER_READY {"workerCount":2}`.

Observed on 2026-07-25 against real BDS on a disposable acceptance world: every
expectation above held, and `bds_provision_acceptance_fixture` then completed
with a provisioned Computer. The session used its own ports and work root, so
the interactive managed companion and its world were untouched.

`Verify:` in that same session, call `bds_execute_computer_command` against the
provisioned Computer to write, compile, and run a guest C program that sums
every integer below 4096:

```text
echo 'int main(void){int s=0;int i;for(i=0;i<4096;i++)s=s+i;printf("%d",s);return 0;}' > /tmp/w.c
cc /tmp/w.c -o /tmp/w
run --stats /tmp/w
```

Take a `bds_status` snapshot while that program is resident, then `bds_get_logs`
with `diagnosticsOnly` and `bds_stop`.

`Expect:` each command completes; `run --stats` prints `8386560`, the closed
form of the sum, on stdout with a positive modeled `cpuCycles`; the `bds_status`
snapshot attributes one owned process to a numbered worker that reports
`cpuEngine` `wasm-rust`; the diagnostics query returns no entries; `bds_stop`
returns `idle`.

Observed on 2026-07-25 on a provisioned CS486DX2 acceptance Computer: stdout
`8386560`, exit code `0`, and 233,531 instructions for 439,093 modeled CPU
cycles reported as `halted` at 66 MHz. The concurrent `bds_status` attributed
`ownedProcessCount` `1` to worker `2`, and that worker reports `cpuEngine`
`wasm-rust`, so the printed result came from a wasm-rust compute worker and not
from the in-engine CPU. Diagnostics were empty and the session stopped to
`idle`. The host wall time on the guest statistics line is MCP responsiveness,
not guest speed, and this single-engine run is not a
`typescript`-versus-`wasm-rust` comparison.

Three properties of the MCP and guest surfaces had to be respected to reach that
observation. All three are pre-existing and none is introduced by this change:

- The first guest command races the deterministic CSBIOS power-on sequence.
  `enqueueDebugShellCommand` answers
  `{"outcome":"ignored","reason":"not_running"}` until that sequence retires, so
  a bounded readiness retry has to precede the first real command. The observed
  run needed five one-second attempts before `whoami` returned `cs`.
- A guest `main` return value is not observable through MCP. A normally halted
  CS486 debug job always completes with `exitCode: 0`, so a distinctive result
  must be asserted on stdout, not on the exit code.
- CS C takes one declarator per declaration and does not accept a compound
  assignment as a statement, so `int s=0,i;` and `s+=i;` are both `CSC001`
  compile errors and the program above uses `int s=0;int i;` and `s=s+i;`
  instead. A candidate guest program is far cheaper to check against
  `ShellSession` on the host than against a live BDS session.

### Effect on the outstanding gate

The p95 BDS tick column recorded under "Still outstanding" above stays
unmeasured. It is no longer structurally unreachable from MCP: a preserved-world
session with `BDS_MCP_RUNTIME_WORKERS` set selects the same engine the Web
companion does, the plane is observed live under real BDS, and MCP-driven guest
work is now observed executing on the selected engine. What is still missing is
the comparison itself — one workload measured on `wasm-rust` and on `typescript`
with BDS tick percentiles recorded for both — together with the multi-user load
evidence of Issue #16. A single-engine PASS is not a non-regression measurement.
The engine therefore remains opt-in and `typescript` remains the default.
