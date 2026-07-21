# Issue #67: Bounded Python assert statements

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/67

Status: Phase 10 implementation and focused local verification are complete;
complete aggregate verification is pending.

Depends on: Epic #49, Issues #50 through #57, Issue #59, and Issue #66.

## Boundary

- Parse `assert expression` with an optional comma-separated message.
- Evaluate the condition exactly once and skip the message on a truthy result.
- On a false result, evaluate the optional message exactly once and raise
  `AssertionError` through the existing exception handler/finalizer path.
- Keep `__debug__` equal to `True`; this phase exposes no `-O` optimization mode
  or writable `__debug__` binding and never compiles assertions out.
- Reuse direct CS486 branches, the allowlisted runtime ABI, frontend budgets,
  managed process accounting, and source spans.

## Explicit exclusions

Optimization-mode removal, custom exception classes/data model, exception
chaining, annotations, deletion, comprehensions, generators, async, packages,
matching, typing, template strings, `pip`, `venv`, and the final Python 3.14
compatibility claim remain outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: syntax/AST shape, true-path message skipping, false-path message
evaluation once, `AssertionError` type/message and catchability, parenthesized
assignment-expression tests, frontend limits, and all earlier profile
regressions pass.

Verify: `npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official reference:
<https://docs.python.org/3.14/reference/simple_stmts.html#the-assert-statement>.

## Local verification result

- Focused contract, syntax, assert runtime, and named-expression regressions: 4
  files and 23 tests passed.
- `npm run test:python314`: 27 files and 228 tests passed.
- Focused ESLint and TypeScript passed.
- The production Bedrock pack and 16-chapter Pages build passed.
- The literal `npm run validate` remains pending on concurrent Linux Git
  integration: seven unrelated files are not yet Prettier-clean, and the updated
  rootfs v12 currently has one stale v11 expectation in
  `tests/os/linuxBoot.test.ts`. The concurrent files are preserved for their
  owner; the Issue #67 scope is formatted, lint-clean, and passing.
