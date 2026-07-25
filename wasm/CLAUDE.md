# Wasm batch-executor guidance

## Scope

This directory holds the Issue #106 CS486 Rust batch-executor implementation.
Nothing here ships in the Bedrock pack, the Web Terminal, or any release
artifact; the pack always runs `Cs486Process`.

The Rust variant passed the adoption gate (median >=2x host CPU improvement,
bit-identical differential equivalence across all three CPU profiles) and is now
selectable by the managed Web companion's compute workers through
`cpuEngine: "wasm-rust"`. It is therefore a maintained production path, not a
throwaway prototype. The AssemblyScript comparison variant failed that gate and
its sources were deleted on 2026-07-25; the measurements that decided it stay in
`docs/issues/issue-106-wasm-batch-executor.md` and must not be restated as if
the variant still exists.

**Dual maintenance is mandatory.** Any change to CPU behaviour that the two
implementations share must land here and in `src/domain/cpu/cs486.ts` in the
same change; see [`src/domain/cpu/CLAUDE.md`](../src/domain/cpu/CLAUDE.md) for
the owning rule and the list of affected responsibilities. Where wasm cannot
reproduce a behaviour, the engine boundary refuses it explicitly rather than
approximating it.

## Hard rules

- The single source of ABI truth is `tools/cs486-wasm-batch-executor-abi.ts`
  (opcode numbering, params/state/exit layouts, cache geometry, fault and exit
  codes, required export surface). Every variant implements that contract
  byte-for-byte; never fork or locally redefine ABI constants beyond mirroring
  them with a comment pointing back to the ABI module.
- Never import from `src/` here. Semantics are ported from
  `src/domain/cpu/cs486.ts` and `src/domain/cpu/memoryHierarchy.ts` by hand and
  verified by the differential equivalence harness, not by sharing code.
- A variant must instantiate with an empty import object and export its own
  linear memory. No wasm-bindgen, no managed runtime, no allocator, no imports
  of any kind.
- Fault semantics must not leak wasm traps: pre-check division by zero,
  `INT_MIN / -1`, memory bounds/alignment, stack bounds, and return targets, and
  report them through the exit record instead. A wasm trap reaching the host is
  always a bug.
- Cold opcodes (`call_indirect`, `syscall`, `print`, `halt`) exit before any
  state change; the TS bridge `tools/cs486-wasm-cold-op-bridge.ts` owns their
  execution.
- An ordinary worker process refuses every syscall. A `run --batch` process is
  the one exception: it carries a startup process image and the isolated CS ABI
  subset (`exit`, `heapInfo`, and `fsWrite` on fd 1 and fd 2) that
  `src/application/runtime/csAbi.ts` implements once for every engine. The
  bridge supplies that handler with guest memory and registers, and it must
  charge `accessData` for each read and write in exactly the order
  `Cs486Process` charges it, or the two engines agree on output and diverge on
  `run --stats`. Everything outside the subset stays an explicit
  `UnsupportedOperationError`, never an approximation.
- Deterministic floating point stays in TS (BigInt rationals). Never add f32/f64
  arithmetic to these modules.
- Build artifacts (`wasm/dist/`, `cs486-batch-executor-rs/target/`) are never
  committed. Only sources, manifests, and lockfiles are.
- `npm run validate` must stay green without cargo or any built `.wasm` artifact
  present. Suites that need an artifact skip when it is absent; the standalone
  verify/benchmark CLIs stay the loud full-evidence path.
- Selecting `wasm-rust` in the companion requires `npm run build:cs486-wasm`
  output. A missing or malformed artifact fails managed startup explicitly.
  Never add a fallback to the TypeScript engine.
- Engine selection is operator configuration: `typescript` by default,
  `wasm-rust` opt-in, never a silent substitution. `dev:bds:web` always starts
  the compute plane; the MCP companion starts runtime workers only when
  `BDS_MCP_RUNTIME_WORKERS` is set, and otherwise rejects a non-default engine
  at startup.

## Compute-worker engine selection

The managed companion's compute workers run one of two CS486 implementations.
`tools/cs486-compute-worker-cpu-engine.ts` is the only boundary that knows the
difference; the worker entry, pool, and loopback wire protocol stay
engine-agnostic.

- Engine names are `typescript` (`Cs486Process`) and `wasm-rust`. Precedence is
  `WEB_COMPANION_CPU_ENGINE`, then the persisted `cpuEngine` field
  (`npm run web:config -- set --cpu-engine ENGINE`), then the default. The
  default must remain `typescript` so wasm is a deliberate choice and an instant
  rollback.
- The pool reads the artifact before spawning any worker and each worker builds
  its engine before posting `ready`, so a missing, stale, or malformed build
  fails managed startup rather than the first slice.
- Workers report the engine they actually loaded and the pool treats a mismatch
  as a protocol failure. Status reports observed truth, not the requested value.
- The engine-name list is declared twice (`tools/cs486-compute-engine.mjs` for
  `.mjs` callers, `tools/cs486-compute-worker-cpu-engine.ts` for typed callers)
  because tsconfig has no `allowJs`.
  `tests/tools/cs486ComputeWorkerPool.test.mjs` locks the two together; add a
  name to both or to neither.
- Only a session that started the compute plane can run a selected engine.
  `npm run dev:bds:web` always starts it; the MCP debug companion starts it only
  when `BDS_MCP_RUNTIME_WORKERS` is set, and otherwise rejects a non-default
  engine at startup instead of letting `Cs486Process` produce results filed as
  wasm evidence. Any future entry point inherits that rule.

## Build and verify

```powershell
npm run build:cs486-wasm
npm run verify:cs486-wasm-equivalence
npm run benchmark:cs486:wasm-ab
```

The Rust variant builds with the pinned toolchain in
`cs486-batch-executor-rs/rust-toolchain.toml` and target
`wasm32-unknown-unknown`. Evidence lives in
`docs/issues/issue-106-wasm-batch-executor.md`.
