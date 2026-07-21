# Issue #51: bounded Python 3.14 frontend and runtime foundations

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/51

Status: the frontend-limit, scope-analysis, and heap-accounting foundation
tranche is implemented and verified locally. Explicit `global`/`nonlocal`
declarations, runtime closure cells, and further runtime responsibility splits
remain in progress. The GitHub Issue stays open until the phase is complete and
the workspace changes are intentionally committed and published.

Depends on: Epic #49 and the Phase 0 contract in Issue #50.

## Boundary

- Make lexer and parser limits explicit, instance-scoped, deterministic, and
  observable at the exact limit and capacity plus one.
- Bound source code units, tokens, identifiers, literals, delimiter and
  indentation depth, statements, suites, recursive expressions, parameters,
  arguments, collection items, and formatted-string embedded expressions.
- Add explicit scope and symbol analysis for locals, globals, nonlocals, cells,
  and free variables without creating executable state on failure.
- Introduce one Python heap ownership/accounting abstraction backed by
  `GuestRamLedger`, then split `pythonCs486.ts` by responsibility without adding
  a second process, instruction pointer, VM, or scheduler.
- Preserve current behavior, import ordering, credential propagation, modeled
  timing, and the CS386SX status-127 hardware gate.

## Explicit exclusions

This Phase does not claim the complete Python 3.14 grammar or data model. `pip`,
`ensurepip`, `venv`, CPython bytecode and native ABI, and host escape remain
outside the profile.

## Acceptance

Verify: `npm run test:python314`.

Expect: current lexer/parser/runtime behavior remains green; each new limit has
exact-limit and capacity-plus-one coverage; deep expressions and formatted
strings fail with `LanguageSyntaxError`, not a host stack overflow.

Result on 2026-07-20: 9 files and 64 tests passed, including deterministic
global/local/cell/free scope classification and managed-heap quota/reclaim.

Verify: `npm run validate`.

Expect: formatting, lint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Result on 2026-07-20: 184 test files and 1,277 tests passed; the production
Bedrock pack and 16-chapter Pages builds completed.
