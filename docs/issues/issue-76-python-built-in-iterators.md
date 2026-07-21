# Issue #76: Python built-in iterator protocol

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/76

Status: host implementation and browser verification complete; final real-BDS
profile verification remains pending.

Depends on: Epic #49 and Issues #53, #57, #59, #68, and #75.

## Boundary

- `iter(value)` accepts strings, lists, tuples, dictionaries, sets, and existing
  iterators. Calling it on an iterator returns that same object at the same
  position.
- `next(iterator)` advances once or raises catchable `StopIteration` at stable
  exhaustion. `next(iterator, default)` returns the supplied default instead.
- `for`, unpacking, starred displays, iterable call expansion, slice
  replacement, and `set()` all consume through the same cursor primitive and
  never restart an existing iterator.
- Built-in advancement is O(1); consuming the remaining values is O(N), where N
  is bounded by the source collection/string and managed-memory ceilings.
- Iterator value graphs stay inside the existing `PythonHeapAccounting` quota;
  no second VM, scheduler, or `GuestRamLedger` lease is introduced.

## Explicit deferrals

The callable/sentinel form of `iter`, user-defined `__iter__`/`__next__`,
generators, generator expressions, `yield from`, `send`/`throw`/`close`, context
managers, async iteration, `pip`, `ensurepip`, `venv`, PyPI, wheels, and the
CPython native ABI remain outside this issue.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests\runtime\pythonIterators.test.ts tests\runtime\pythonHeapAccounting.test.ts tests\runtime\pythonUnpacking.test.ts tests\runtime\pythonSlicing.test.ts tests\runtime\pythonCalls.test.ts tests\runtime\pythonComprehensions.test.ts tests\tools\python314Compatibility.test.mjs`.

Expect: built-in iterator identity, independent cursors, Unicode string values,
deterministic dictionary/set traversal, stable exhaustion/default behavior,
shared partial consumption, heap reachability, and the compatibility contract
pass.

Verify: `rtk npm run test:python314`.

Expect: every prior Python 3.14 CS Profile regression and the iterator cases
pass.

Verify: `rtk npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Official references:

- <https://docs.python.org/3.14/library/functions.html#iter>
- <https://docs.python.org/3.14/library/functions.html#next>
- <https://docs.python.org/3.14/library/stdtypes.html#iterator-types>
- <https://docs.python.org/3.14/reference/compound_stmts.html#the-for-statement>

## Local verification result

- The seven-file iterator/runtime/accounting/contract acceptance run passed all
  61 tests; adding the canonical manual check passed 8 files and 73 tests.
- `rtk npm run test:python314` passed 34 files and 292 tests.
- `rtk npm run validate` passed formatting, ESLint, TypeScript, all 221 test
  files and 1,573 tests, the production Bedrock pack, and the 16-chapter Pages
  build.
- A headed browser opened the built Python chapter and exposed the built-in
  iterator heading, iterator-identity text, `next()`, and catchable
  `StopIteration`. Page behavior produced no script warning or exception; the
  loopback static server reported only its unrelated missing `/favicon.ico` 404.
- Final real-BDS/profile verification remains assigned to the complete Python
  3.14 CS Profile gate. This partial feature group is not a full compatibility
  claim.
