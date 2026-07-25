# Issue #115: remove the Rust wasm CS486 batch executor

GitHub Issue:
[Remove the Rust wasm CS486 batch executor](https://github.com/tsuyoshi-otake/computer-system/issues/115)

Closes the direction opened by [Issue #106](issue-106-wasm-batch-executor.md)
(the opt-in Rust wasm compute-worker engine) and continued in
[Issue #114](issue-114-run-batch-cs-abi.md) (`run --batch`).

Status on 2026-07-26: removed. `Cs486Process` is the single production CS486
implementation again. `run --batch` and the isolated CS ABI worker subset stay:
they are a guest declaration about OS services, not an engine selection, and
they keep working on the TypeScript engine.

## Why

- **The measured win was not wasm.** The real-BDS A/B recorded in
  `issue-114-run-batch-cs-abi.md` (isolated acceptance fixture `c-ryntpx`,
  2026-07-26) ran with `WEB_COMPANION_CPU_ENGINE=typescript`:
  `run --batch --stats /tmp/b` finished in `498.000 ms` of host wall time
  against `2332.000 ms` for the same executable without `--batch`. That 4.7x
  came from moving the program off the per-tick host admission path and onto a
  compute worker, with the TypeScript interpreter doing the work. Removing the
  wasm engine does not remove that benefit.
- **The remaining wasm-only win does not reach real workloads.** The wasm engine
  could only serve a process whose syscalls complete inside a worker, and a
  worker owns no guest filesystem, terminal, scheduler, or DAC credentials.
  Widening it meant either duplicating authoritative `ComputerRecord` state into
  the worker (a second source of truth, which `src/CLAUDE.md` forbids) or adding
  a per-syscall host round trip.
- **Interactive programs could not benefit at all.** NetHack, `vi`, and the
  Python REPL are paced by the 20 TPS scheduler tick and blocked on key input,
  not by CPU. Verified on 2026-07-26: `run --batch /usr/games/nethack` fails
  with `UnsupportedOperationError: batch process cannot use CS ABI operation 5`
  (`clockTicks`), which is the correct outcome, not a gap to close.
- **The cost was a permanent second implementation.** The removed
  `wasm/CLAUDE.md` required every shared responsibility to land in both
  `Cs486Process` and the Rust executor in the same change, with equivalence
  evidence. That tax applied to all future CS486 work in exchange for a speedup
  only computation-bound, service-free programs could collect.

## What was removed

- `wasm/` in full: `cs486-batch-executor-rs/` (crate, `Cargo.toml`,
  `Cargo.lock`, `rust-toolchain.toml`, `.cargo/config.toml`, `src/lib.rs`) and
  `wasm/CLAUDE.md`, plus its `.gitignore` entry.
- `tools/wasm-engines/`, `tools/build-cs486-wasm.mjs`,
  `tools/benchmark-cs486-wasm-ab.mjs`, `tools/verify-cs486-wasm-equivalence*`,
  `tools/cs486-wasm-batch-executor-*.ts`, `tools/cs486-wasm-cold-op-bridge.ts`,
  and `tools/cs486-fuzz-generator.ts`.
- The `wasm-rust` value in `tools/cs486-compute-engine.mjs` and
  `tools/cs486-compute-worker-cpu-engine.ts`, the artifact-reading path in
  `tools/cs486-compute-worker-pool.mjs`, and the `wasmModuleBytes` field of the
  worker create protocol.
- `package.json` scripts `build:cs486-wasm`, `build:cs486-wasm:check`,
  `benchmark:cs486:wasm-ab`, and `verify:cs486-wasm-equivalence`.
- `src/bedrock/probes/wasmProbe.ts`, its `__CS_WASM_PROBE__` build define, and
  the `cs-wasm-probe-stub` esbuild plugin. This was decided explicitly rather
  than by omission: the 2026-07-24 finding (no `WebAssembly` global in the
  Bedrock script engine) is already recorded in `docs/feasibility-matrix.md` as
  dated evidence, and the probe had no remaining consumer once the host-side
  executor it scoped was gone. That matrix row now says restoring the probe is
  the prerequisite for reopening it.
- `tests/tools/cs486Wasm*.test.*` and the wasm half of
  `tests/tools/cs486ComputeCpuEngine.test.ts`.

## What was kept

- `run --batch` and the isolated CS ABI batch subset (`exit`, `heapInfo`,
  `fsWrite` on fd 1 and fd 2) from #114, including every explicit refusal.
- Compute workers and the remote `CpuProcess` protocol, which is what the
  measured speedup actually uses.
- The engine-selection seam. `cs486ComputeEngineNames` still exists with one
  entry, and the worker still builds its engine from a factory table, so a
  missing factory is a compile error rather than a silent substitution.
- The rule that a non-default engine is rejected when the session runs no
  compute workers. It is about the shape of the session, not about how many
  engines exist.
- `tools/cs486-corpora/batch-cs-abi-corpus.ts` (renamed from
  `tools/wasm-corpora/`) and `tests/tools/cs486BatchCsAbiCorpus.test.ts`, which
  pin what each corpus program reaches on `Cs486Process`.
- The historical evidence in `issue-106-wasm-batch-executor.md` and
  `issue-114-run-batch-cs-abi.md`, unrewritten. Each carries a dated removal
  note pointing here.

## Acceptance

### 1. No wasm engine remains

Verify:
`git grep -in "wasm" -- . ':!docs/issues' ':!docs/releases' ':!package-lock.json'`.

Expect: nothing that builds, loads, or selects the Rust CS486 wasm executor.
Every surviving hit is one of three kinds, and each is deliberate: a dated
removal note, the `WebAssembly`-in-Script-API feasibility row, or a test that
feeds `wasm-rust` in to prove it is now **rejected**. The rejection tests are
the executable form of item 2; deleting the string would delete the evidence
that the removed value cannot be accepted.

### 2. Engine selection has one value

Verify: read `tools/cs486-compute-engine.mjs`; start the companion with
`WEB_COMPANION_CPU_ENGINE=wasm-rust`.

Expect: `cs486ComputeEngineNames` is `["typescript"]`, and the removed value is
rejected explicitly at configuration time rather than silently accepted.

Observed on 2026-07-26: `cs486ComputeEngineNames` is `["typescript"]` and
`defaultCs486ComputeEngine` is `"typescript"`. Starting the companion with
`WEB_COMPANION_CPU_ENGINE=wasm-rust` fails before any listener, pool, or BDS
process exists, with a non-zero exit and

```text
RangeError: CS486 compute engine must be one of: typescript. Received wasm-rust.
```

The message names the rejected value, bounded to 40 characters. That is a change
made by this work: while one engine remained, a message that only listed the
accepted set no longer told an operator which name their file, environment, or
`--cpu-engine` flag had actually supplied. Nothing falls back to the default
engine on rejection.

### 3. The batch path still works and still refuses correctly

Verify:

```powershell
npm test -- tests/os/linuxBatchRun.test.ts tests/runtime/csAbiBatchHandler.test.ts tests/computer/batchForegroundRouting.test.ts
```

Expect: all pass unchanged; `--batch` still fails explicitly on an unsupported
CS ABI operation, on DOS, on a pipeline or redirect, on a system utility, and on
the queued MCP debug path.

Observed on 2026-07-26: 3 files, 27 tests, all passing.

### 4. Host gate

Verify: `npm run validate`.

Expect: pass, with no dangling script, import, or documentation link.

Observed on 2026-07-26 (Node v26.2.0, win32): formatting, ESLint, TypeScript,
`311` test files / `2596` tests, the Bedrock pack build, and the 16-chapter
Pages build all pass.

### 5. Real-BDS non-regression

Verify: start an isolated managed companion on its own ports and its own empty
`BDS_MCP_WORKDIR` (`BDS_MCP_PORT=19140`, `WEB_COMPANION_PORT=8390`,
`BDS_MCP_RUNTIME_WORKERS=2`, `BDS_MCP_WORKDIR=~/tmp/cs-issue115-acceptance`),
`bds_start({ acceptanceFixture: true, resetWorld: true })`, wait for
`CS_STORAGE_MIGRATION {"state":"complete"}`, `bds_provision_acceptance_fixture`,
rebuild the `/tmp/b` program from `issue-114-run-batch-cs-abi.md` with bounded
`echo` redirects and `cc`, then `bds_open_web_terminal` and drive
`run --stats /tmp/b` and `run --batch --stats /tmp/b` with
`bds_send_tui_input({ kind: "line" })`.

Expect: identical guest evidence on both paths and a `--batch` host wall time in
the same range as the 498 ms recorded on 2026-07-26 before the removal.

Observed on 2026-07-26 after the removal, CS486DX2, 2 compute workers, one
`typescript` engine, Web Terminal session in `writer` mode. Two fixtures were
used because the first build of `/tmp/b` lost its `printf` line to the MCP
128-character/no-line-break command limit; that accident turned out to be the
cleaner measurement and both are reported.

Fixture `c-928w2c`, `/tmp/b` computing the loop and printing nothing:

| Command                      | Instructions | Memory evidence | Host wall time        |
| ---------------------------- | ------------ | --------------- | --------------------- |
| `run --stats /tmp/b`         | 1400054      | identical       | 2433 ms, then 2427 ms |
| `run --batch --stats /tmp/b` | 1400054      | identical       | 443 ms                |

Every modeled number agrees exactly - instructions, CPU cycles, L1/L2 hits and
misses, bus transfers, unaligned accesses, and pipeline flushes - so the 5.5x is
host wall time only. This is the non-regression the removal needed: with one
engine left, a compute worker still changes nothing the guest can observe.

Fixture `c-2gqfz7`, the exact `issue-114` `/tmp/b` including `printf("t=%d\n")`:

| Command                      | Terminal result                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `run --batch --stats /tmp/b` | `t=59998`, `1409609 instructions`, `halted`, `513.000 ms`                    |
| `run --stats /tmp/b`         | no output, `1403039 instructions`, `halted`, `2347.000 ms` and `2360.000 ms` |

513 ms against the 498 ms baseline is the same range, so `run --batch` did not
regress when the second engine was deleted. The two rows disagree on stdout and
instruction count by the same amount and for the same reason as the #114
baseline (1408796 against 1402881 there): the pre-existing non-batch terminal
`EAGAIN` truncation diagnosed in `issue-114-run-batch-cs-abi.md` item 8. It is
reproduced here unchanged, which is itself the expected result - this work did
not touch that path - and it is listed under Follow-up below.

### 6. Documentation agrees

Verify: read `README.md`, `docs/development.md`, `docs/mcp-debugging.md`,
`docs/feasibility-matrix.md`, `CLAUDE.md`, `src/domain/cpu/CLAUDE.md`,
`tools/CLAUDE.md`, and `web/manual.js`.

Expect: no dual-implementation rule, no wasm build step, no `wasm-rust` operator
instruction. `src/domain/cpu/CLAUDE.md` states one production CS486
implementation.

Observed on 2026-07-26. `git grep -in "wasm"` over exactly those eight files
returns 12 lines, and every one of them is a removal note or the feasibility
row: `CLAUDE.md` and `README.md` point at this document, `docs/development.md`
states that there is no Rust toolchain requirement, no `build:cs486-wasm`
artifact, and no A/B harness, `docs/feasibility-matrix.md` keeps the dated 2026-
07-24 in-engine `WebAssembly` probe result and now records that the host-side
executor it scoped was removed too, and `src/domain/cpu/CLAUDE.md` opens with
"the single production CS486 implementation". `tools/CLAUDE.md` and
`web/manual.js` contain no occurrence at all: the operator bullet now says an
unknown `WEB_COMPANION_CPU_ENGINE` or `--cpu-engine` value is rejected at
configuration time, and manual chapter 3.1 says `typescript` is the only
accepted value. The root `CLAUDE.md` child-scope table no longer lists
`wasm/CLAUDE.md`, and its CS486 rule now forbids adding a second implementation
instead of requiring both to be kept in step.

## Follow-up

Verifying #114 surfaced a pre-existing defect unrelated to wasm: hosted CS-Linux
stdout is silently truncated inside a tick because
`src/application/runtime/csAbi.ts` answers a deferred `terminal` lane with
`EAGAIN` instead of suspending through `wait_event`, and guest libc does not
retry. It needs its own Issue and survives this removal.
