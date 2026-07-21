# Issue #55: Python conditional expressions and lambda closures

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/55

Status: Phase 5 implementation and complete local aggregate verification are
complete.

Depends on: Epic #49 and Issues #50 through #54.

## Boundary

- Parse right-associative `x if condition else y`, evaluate the condition first,
  and execute exactly one result expression.
- Parse expression-only `lambda` functions with positional-only,
  positional-or-keyword, keyword-only, variadic positional, and variadic keyword
  parameters.
- Evaluate lambda defaults once and left to right when the lambda object is
  created.
- Give every lambda a bounded implicit function scope and reuse the same
  global/local/cell/free binding analysis, shared closure cells, argument
  binder, call-depth ceiling, CS486 call/return path, and reachable heap
  accounting as `def`.

## Explicit exclusions

Assignment expressions, comprehensions, annotations, decorators, classes,
generators, async protocols, `pip`, `venv`, and the final compatibility claim
remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: conditional associativity and one-branch evaluation, lambda syntax,
five-kind parameter binding, definition-time defaults, retained/passthrough
closures, reachable captured heap, exact scope limits, capacity plus one, and
all prior profile regressions pass.

Verify: repository-source Prettier and ESLint, `npm run typecheck`, all product
tests outside any unrelated snapshot-sensitive scanner, `npm run build`, and
`npm run build:pages`.

Expect: every product gate passes. The literal `npm run validate` is recorded
separately if unrelated repository-root artifacts remain in discovery.

Official reference:
<https://docs.python.org/3.14/reference/expressions.html#conditional-expressions>
and <https://docs.python.org/3.14/reference/expressions.html#lambdas>.

## Local verification result

- `npm run test:python314`: 17 files and 136 tests passed.
- Focused source ESLint and TypeScript passed.
- Product-source Prettier and repository-wide ESLint passed.
- All 191 product test files outside the formerly snapshot-sensitive guidance
  scanner passed with 1,344 tests.
- `npm run build` and `npm run build:pages` passed.
- The literal `npm run validate` then passed: formatting, lint, TypeScript, all
  192 test files and 1,349 tests, the production Bedrock pack, and the
  16-chapter Pages build completed. The prior `make-snapshot/` discovery
  residual was absent without this phase modifying or deleting that user-owned
  artifact.
