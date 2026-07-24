# Wasm prototype guidance

## Scope

This directory holds the gated Issue #106 Phase 4 CS486 batch-executor
prototypes (Rust and AssemblyScript). Nothing here ships in the Bedrock pack,
the Web Terminal, or any release artifact. The prototypes exist to produce
adoption-gate evidence (median >=2x host CPU improvement, bit-identical
differential equivalence across all three CPU profiles, no p95 regression);
production integration is a separate decision recorded on Issue #106.

## Hard rules

- The single source of ABI truth is `tools/cs486-wasm-batch-executor-abi.ts`
  (opcode numbering, params/state/exit layouts, cache geometry, fault and exit
  codes, required export surface). Both language variants implement that
  contract byte-for-byte; never fork or locally redefine ABI constants beyond
  mirroring them with a comment pointing back to the ABI module.
- Never import from `src/` here. The AssemblyScript variant is TypeScript-like
  but compiles for the wasm target; it must stay self-contained. Semantics are
  ported from `src/domain/cpu/cs486.ts` and `src/domain/cpu/memoryHierarchy.ts`
  by hand and verified by the differential equivalence harness, not by sharing
  code.
- Both variants must instantiate with an empty import object and export their
  own linear memory. No wasm-bindgen, no managed runtime, no allocator, no
  imports of any kind.
- Fault semantics must not leak wasm traps: pre-check division by zero,
  `INT_MIN / -1`, memory bounds/alignment, stack bounds, and return targets, and
  report them through the exit record instead. A wasm trap reaching the host is
  always a bug.
- Cold opcodes (`call_indirect`, `syscall`, `print`, `halt`) exit before any
  state change; the TS bridge `tools/cs486-wasm-cold-op-bridge.ts` owns their
  execution.
- Deterministic floating point stays in TS (BigInt rationals). Never add f32/f64
  arithmetic to these modules.
- Build artifacts (`wasm/dist/`, `cs486-batch-executor-rs/target/`,
  `cs486-batch-executor-as/build/`) are never committed. Only sources,
  manifests, and lockfiles are.
- `npm run validate` must stay green without cargo, asc output, or any built
  `.wasm` artifact present.

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
