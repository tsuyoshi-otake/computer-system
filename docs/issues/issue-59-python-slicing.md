# Issue #59: Bounded Python slicing and list slice assignment

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/59

Status: Phase 8 implementation, complete local aggregate verification, and local
real-Chrome manual verification are complete.

Depends on: Epic #49 and Issues #50 through #57.

## Boundary

- Parse a one-dimensional `start:stop[:step]` slice with any component omitted.
- Read built-in strings, lists, and tuples with Python-style negative and
  clipped bounds plus positive or negative steps. Strings use Unicode code
  points.
- Assign iterable replacements to ordinary list slices, which may resize, and to
  extended list slices, which require equal selected and replacement lengths.
- Evaluate one assignment RHS before the target object and components. Validate
  step, replacement shape, and final collection capacity before target mutation.
- Retain the default 4,096-item collection ceiling, arbitrary-precision bound
  clipping, shared reachable heap accounting, and direct CS486 operation path.

## Explicit exclusions

Multidimensional and tuple subscripts, custom `__getitem__`/`__setitem__` and
`__index__` protocols, starred subscripts, slice deletion, augmented slice
assignment, sets, comprehensions, classes, `pip`, `venv`, and the final Python
3.14 compatibility claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: syntax/AST shape, omitted/negative/oversized bounds, positive and
negative steps, Unicode text, built-in sequence result types, RHS/target
evaluation order, ordinary and extended list replacement, zero-step/type/arity
failures, exact capacity, capacity plus one, no partial mutation, and all
earlier profile regressions pass.

Verify: `npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official reference:
<https://docs.python.org/3.14/reference/expressions.html#slicings> and
<https://docs.python.org/3.14/reference/simple_stmts.html#assignment-statements>.

## Local verification result

- Focused syntax/runtime, contract, assignment, and unpacking regressions: 5
  files and 39 tests passed.
- `npm run test:python314`: 23 files and 195 tests passed.
- Focused ESLint and TypeScript passed.
- `npm run validate` passed on the final current worktree: repository-wide
  formatting, ESLint, TypeScript, all 201 test files and 1,439 tests, the
  production Bedrock pack, and the 16-chapter Pages build completed.
- Local Chrome opened the generated `manual/#chapter-micropython` page. Both the
  default desktop viewport and a temporary 390x844 narrow viewport exposed all
  16 chapters, the slicing text, no horizontal overflow, and zero console
  warnings/errors. This is local render evidence, not a claim that the updated
  Pages build has been published.
