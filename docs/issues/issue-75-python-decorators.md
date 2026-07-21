# Issue #75: Python function and class decorators

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/75

Status: host implementation and browser verification complete; final real-BDS
profile verification remains pending.

Depends on: Epic #49 and Issues #53, #55, #66, and #74.

## Boundary

- Parse one or more `@assignment_expression` lines immediately before `def` or
  `class`, bounded by the existing 4,096-item per-construct ceiling.
- Evaluate decorator expressions in the containing scope from top to bottom,
  before function defaults or class bases/suite execution.
- Apply decorators from bottom to top through the existing managed/native CS486
  call path, passing the current definition value as the sole positional
  argument.
- Bind the definition name only after every decorator call succeeds. A failed
  decorator preserves any earlier binding and never publishes the undecorated
  function or class.
- Keep class-suite isolation, single inheritance, closure cells, call depth,
  collection limits, and reachable managed-heap accounting unchanged.

Decorator expression collection and application are both O(D), where D is the
explicitly bounded decorator count. Each decorator call retains the existing
call-depth and tick-sliced CS486 execution boundaries.

## Explicit exclusions

Descriptors, `property`, `staticmethod`, `classmethod`, `__set_name__`, type
parameter lists, annotations, metaclasses, multiple inheritance/C3, `pip`,
`ensurepip`, `venv`, PyPI, and wheels remain outside this phase.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests\language\decorators.test.ts tests\language\scope.test.ts tests\runtime\pythonDecorators.test.ts tests\runtime\pythonClasses.test.ts tests\runtime\pythonHeapAccounting.test.ts tests\tools\python314Compatibility.test.mjs`.

Expect: decorator parsing and bounds, containing-scope binding, top-to-bottom
expression/default/base/body ordering, bottom-to-top managed/native application,
atomic failure, class invariants, heap accounting, and the manifest contract
pass.

Verify: `rtk npm run test:python314`.

Expect: every prior Python 3.14 CS Profile regression and all decorator cases
pass.

Verify: `rtk npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official references:

- <https://docs.python.org/3.14/reference/compound_stmts.html#function-definitions>
- <https://docs.python.org/3.14/reference/compound_stmts.html#class-definitions>

## Local verification result

- The six-file language/runtime/accounting/contract acceptance run passed all 38
  tests.
- `rtk npm run test:python314` passed 33 files and 287 tests.
- `rtk npm run validate` passed formatting, ESLint, TypeScript, all 218 test
  files and 1,556 tests, the production Bedrock pack build, and the 16-chapter
  Pages build.
- A headed browser opened the built field manual at
  `manual/#chapter-micropython`; the decorator ordering, atomic publication, and
  4,096-decorator ceiling were visible, and the browser console reported zero
  errors and zero warnings. The Chrome control runtime could not start because
  its configured Node path was unavailable, so the required fallback used the
  repository Playwright workflow.
- Final real-BDS/profile verification is intentionally deferred to the complete
  Python 3.14 CS Profile gate. This phase does not claim full-profile
  compatibility.
