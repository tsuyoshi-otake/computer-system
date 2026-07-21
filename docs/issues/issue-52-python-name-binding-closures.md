# Issue #52: Python name binding, global/nonlocal, and closure cells

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/52

Status: Phase 2 implementation is locally complete and verified. The tracking
Issue remains open until the dirty working tree is intentionally committed and
published.

Depends on: Epic #49, contract Issue #50, and frontend foundation Issue #51.

## Boundary

- Parse and validate `global` and `nonlocal` declarations with whole-function
  binding rules and precise declaration errors.
- Normalize Unicode identifiers and carry their authored spans into
  deterministic symbol analysis.
- Compile every name load/store, import alias, function definition, loop target,
  and exception target with an explicit global/local/cell/free binding.
- Create local closure cells on function entry, capture them when a nested
  function object is created, and propagate shared free cells through
  intermediate scopes.
- Expand defaults and initialized closure cells only from reachable managed
  function objects during heap measurement; do not root WeakMap metadata or
  acquire a second physical RAM lease.
- Preserve the one-`Cs486Process` call/return path, modeled cycles, imports,
  credentials, exceptions, and exactly-once process finalization.

## Explicit exclusions

Classes, generators, async protocols, `pip`, `venv`, the CPython ABI, and a
final Python 3.14 compatibility claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: Unicode/normalized names, declaration errors, whole-function unbound
locals, global mutation, nested capture, nonlocal mutation, passthrough cells,
shared-cell identity, and reachable closure heap accounting pass without a
second VM or RAM lease.

Verify: `npm run validate`.

Expect: formatting, lint, TypeScript, all host tests, the production Bedrock
pack, and the 16-chapter Pages build pass.

## Local verification result

- `npm run test:python314`: 11 files and 82 tests passed.
- `npm run validate`: formatting, ESLint, TypeScript, 186 files and 1,295 tests,
  the production Bedrock pack, and the 16-chapter Pages build passed.
