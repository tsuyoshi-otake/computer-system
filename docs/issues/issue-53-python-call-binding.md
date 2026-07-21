# Issue #53: Python call binding, unpacking, and comparison evaluation order

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/53

Status: Phase 3 implementation and product verification are complete. A later
complete aggregate validation passed after the separately created untracked
`make-snapshot/` tree was no longer present in repository discovery.

Depends on: Epic #49 and Issues #50 through #52.

## Boundary

- Parse positional-only (`/`), positional-or-keyword, keyword-only, variadic
  positional, and variadic keyword parameters with deterministic duplicate,
  ordering, marker, and capacity errors.
- Preserve definition-time, left-to-right default evaluation and bind positional
  and keyword-only defaults on every call.
- Evaluate call items from left to right, then perform bounded iterable/mapping
  unpacking with duplicate-key and string-key checks.
- Bind every call in O(parameters + expanded arguments), including the Python
  positional-only-name exception when a variadic keyword parameter is present.
- Short-circuit comparison chains, evaluate each operand at most once, and
  retain the middle operand for the next comparison without a host callback or
  second interpreter.
- Preserve shared closure cells, the single CS486 process, reachable heap
  accounting, and explicit success/fault finalization.

## Explicit exclusions

Annotations, type parameters, decorators, lambda, comprehensions, classes,
generators, async protocols, `pip`, `venv`, and the final compatibility claim
are outside this phase.

## Acceptance

Verify: `npm run test:python314`.

Expect: call syntax, positive and negative binding, default and call evaluation
order, unpacking, closure parameters, chained comparison short-circuiting, and
exact/capacity-plus-one expansion evidence pass with prior profile regressions.

Verify: `npm run validate`.

Expect: formatting, ESLint, TypeScript, all host tests, the production Bedrock
pack, and the 16-chapter Pages build pass.

## Local verification result

- `npm run test:python314`: 13 files and 102 tests passed.
- TypeScript, repository-source formatting, and repository-source ESLint passed.
- The 187 product test files outside the local snapshot guidance scanner passed
  with 1,310 tests.
- The production Bedrock pack and 16-chapter Pages builds passed.
- A later literal `npm run validate` passed with 192 test files and 1,349 tests,
  the production Bedrock pack, and the 16-chapter Pages build. No call-binding
  gate residual remains.
