# Issue #80: Python yield-from delegation

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/80

Status: host implementation, focused/Python-profile acceptance, and Chrome
verification complete. The aggregate repository gate currently stops in two
concurrent C hosted-libc `printf` tests recorded below. Generator expressions
and the final Python 3.14 profile gate remain open.

Depends on: Epic #49 and Issues #53, #76, #77, #78, and #79.

## Boundary

- `yield from expression` evaluates its iterable once, obtains one bounded
  built-in iterator or generator, and yields values lazily.
- Built-in exhaustion makes the yield-from expression evaluate to `None`. A
  subgenerator return supplies the exact managed return value.
- `send`, `throw`, and `close` forward through generator delegates using nested
  ordinary CS486 calls. A built-in iterator has no `send`, `throw`, or `close`;
  the resulting behavior remains observable at the yield-from point.
- Delegate completion, escaping faults, recursive re-entry, close-yield failure,
  and call-depth admission each have one explicit finalization owner. Rejected
  admission does not consume the delegate.
- The delegate and every suspended child remain in the existing reachable
  `PythonHeapAccounting` graph. The implementation adds no Python VM, scheduler,
  continuation queue, instruction pointer, or physical RAM lease.

## Explicit deferrals

Generator expressions, user-authored `__iter__`/`__next__`, automatic
garbage-collection close, context managers, async generators, and the excluded
packaging/CPython ABI surfaces remain later work.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/language/generators.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonYieldFrom.test.ts tests/runtime/pythonHeapAccounting.test.ts`.

Expect: syntax ownership and diagnostics, built-in and nested-generator
delegation, lazy/evaluate-once order, subgenerator return capture,
`send`/`throw`/`close` forwarding, missing delegate methods, nested finalizers,
re-entry, capacity rejection without consumption, and reachable delegate
ownership pass.

Verify: `rtk npm run test:python314` and `rtk npm run validate`.

Expect: every prior Python 3.14 CS Profile regression, all host tests, the
production Bedrock pack, and the 16-chapter Pages build pass.

Verify: open the built `manual/#chapter-micropython` in a real browser at
1440x900 and 390x844, inspect the console, and confirm the yield-from section
without changing the stable chapter link.

Expect: both viewports have no horizontal overflow, the chapter remains active,
and no page-script warning or exception is reported.

Official references:

- https://docs.python.org/3.14/reference/expressions.html#yield-expressions
- https://docs.python.org/3.14/reference/expressions.html#generator-iterator-methods
- https://peps.python.org/pep-0380/

## Local verification result

- Focused syntax/runtime/heap acceptance passed 4 files and 72 tests on
  2026-07-20.
- The synchronized compatibility/manual run passed 6 files and 90 tests, and
  `rtk npm run test:python314` passed 37 files and 356 tests.
- Chrome opened the built manual at `#chapter-micropython`. At 1440x900 and
  390x844 it retained the exact title/hash and displayed evaluation-once,
  subgenerator-return, delegated-method, and reachable-heap text without
  horizontal overflow. The console contained no warning or error. The temporary
  viewport, tab, and exact loopback-server process were finalized.
- `rtk npm run validate` passed formatting, ESLint, TypeScript, and 1,678 of
  1,680 host tests before two concurrent non-Python tests stopped the gate:
  `tests/os/cFamilyProfiles.test.ts` and `tests/computer/computerHost.test.ts`
  currently fail with unresolved hosted libc symbol `printf`. A focused rerun
  reproduces both failures. Production pack and Pages build stages were not
  reached by that aggregate command; `rtk npm run build:pages` separately passed
  all 16 chapters.
