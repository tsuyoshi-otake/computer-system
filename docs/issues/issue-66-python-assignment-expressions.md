# Issue #66: Python assignment expressions and lexical binding

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/66

Status: Phase 9 implementation and complete local aggregate verification are
complete. The synchronized manual text awaits the final real-browser publication
pass.

Depends on: Epic #49, Issues #50 through #57, and Issue #59.

## Boundary

- Parse identifier-only assignment expressions at Python's lowest expression
  precedence and return the same value stored by the expression.
- Accept unparenthesized forms in `if`/`while` tests, list display items, and
  positional call arguments. Require parentheses in restricted subexpressions.
- Evaluate one RHS before one lexical store and preserve short-circuit and
  conditional branch skipping.
- Classify targets through existing whole-function global/local/cell/free scope
  analysis, including `global`, `nonlocal`, closure cells, and unbound locals.
- Reuse the direct CS486 stack/control-flow path, frontend nesting/symbol
  limits, and existing reachable heap ownership.

## Explicit exclusions

Comprehension-specific outer-scope binding, sets/comprehensions, classes,
annotations, yield/generators, async, packages, dynamic code, pattern matching,
typing, template strings, `pip`, `venv`, and the final Python 3.14 compatibility
claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: AST/precedence, parenthesis-sensitive placement, invalid targets,
RHS-once and same-value behavior, direct `if`/`while` use, short-circuit
skipping, global/nonlocal/closure stores, whole-function unbound-local behavior,
frontend limits, and all earlier profile regressions pass.

Verify: `npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official reference:
<https://docs.python.org/3.14/reference/expressions.html#assignment-expressions>.

## Local verification result

- Focused named-expression syntax/runtime plus closure/expression regressions: 4
  files and 35 tests passed.
- `npm run test:python314`: 25 files and 217 tests passed.
- Focused ESLint, TypeScript, and `git diff --check` passed.
- `npm run validate` passed: repository-wide formatting, ESLint, TypeScript, all
  201 test files and 1,444 tests, the production Bedrock pack, and the
  16-chapter Pages build completed.
- The canonical manual and generated Pages describe assignment expressions, but
  this phase does not claim a post-change real-browser check or publication.
  That evidence remains part of the final profile/manual gate.
