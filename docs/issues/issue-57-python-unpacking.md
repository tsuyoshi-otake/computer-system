# Issue #57: Python starred displays and destructuring assignment

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/57

Status: Phase 7 implementation and complete local aggregate verification are
complete.

Depends on: Epic #49 and Issues #50 through #56.

## Boundary

- Expand starred list/tuple display items from left to right.
- Expand dictionary mappings from left to right with later-key overwrite.
- Destructure one RHS into nested list/tuple targets with one starred target per
  nesting level; the starred target receives a new list of remaining values.
- Preserve RHS-once and left-to-right target-side evaluation, lexical cell
  binding, source construct ceilings, the default 4,096-item expanded runtime
  collection limit, and reachable heap accounting.
- Report arity mismatch as `ValueError`, invalid iterables/mappings as
  `TypeError`, and capacity excess as `ResourceLimitError`.

## Explicit exclusions

Sets, comprehensions/generator expressions, assignment expressions, slicing,
deletion, annotations, classes/operator protocols, `pip`, `venv`, and the final
compatibility claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: syntax/AST shape, left-to-right display and target evaluation, mapping
overwrite, nested/starred destructuring, arity/type failures, exact collection
capacity, capacity plus one, and all prior profile regressions pass.

Verify: `npm run validate`.

Expect: formatting, ESLint, TypeScript, all host tests, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official reference:
<https://docs.python.org/3.14/reference/expressions.html#expression-lists> and
<https://docs.python.org/3.14/reference/simple_stmts.html#assignment-statements>.

## Local verification result

- Focused syntax/runtime plus assignment regressions: 4 files and 30 tests
  passed.
- `npm run test:python314`: 21 files and 176 tests passed.
- Focused ESLint and TypeScript passed.
- `npm run validate` passed: repository-wide formatting, ESLint, TypeScript, all
  196 test files and 1,389 tests, the production Bedrock pack, and the
  16-chapter Pages build completed.
