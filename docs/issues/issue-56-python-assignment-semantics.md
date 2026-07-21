# Issue #56: Python chained and augmented assignment semantics

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/56

Status: Phase 6 implementation and complete local aggregate verification are
complete.

Depends on: Epic #49 and Issues #50 through #55.

## Boundary

- Evaluate one ordinary assignment RHS before assigning identifier, attribute,
  or subscription targets from left to right.
- Implement `+=`, `-=`, `*=`, `/=`, `//=`, `%=`, `**=`, `<<=`, `>>=`, `&=`,
  `^=`, and `|=` through existing bounded numeric operations.
- Evaluate an augmented attribute/subscription target once before its RHS,
  retain that exact target reference on the managed value stack, and perform one
  store.
- Treat augmented identifiers as lexical reads and writes, including shared
  nonlocal cells and whole-function unbound-local behavior.

## Explicit exclusions

Matrix multiplication, unpacking/destructuring targets, annotated assignment,
assignment expressions, comprehensions, deletion, classes/operator overloading,
`pip`, `venv`, and the final compatibility claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: syntax for every supported operator, RHS-first and left-to-right chained
evaluation, single-evaluation augmented targets, nonlocal mutation, numeric
growth preflight, negative targets, and all prior profile regressions pass.

Verify: `npm run validate`.

Expect: formatting, ESLint, TypeScript, all host tests, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official reference:
<https://docs.python.org/3.14/reference/simple_stmts.html#assignment-statements>
and
<https://docs.python.org/3.14/reference/simple_stmts.html#augmented-assignment-statements>.

## Local verification result

- Focused assignment syntax/runtime: 3 files and 31 tests passed; the final
  attribute-target addition passed all 6 assignment runtime tests.
- `npm run test:python314`: 19 files and 160 tests passed.
- Focused ESLint and TypeScript passed.
- `npm run validate` passed: repository-wide formatting, ESLint, TypeScript, all
  194 test files and 1,373 tests, the production Bedrock pack, and the
  16-chapter Pages build completed.
