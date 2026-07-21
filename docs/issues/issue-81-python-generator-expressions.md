# Issue #81: Python generator expressions

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/81

Status: host implementation, focused/Python-profile acceptance, and Chrome
verification complete. The aggregate repository gate currently stops in
concurrent Phase 20 context-manager and C-toolchain work recorded below. Context
managers and the final Python 3.14 profile gate remain open.

Depends on: Epic #49 and Issues #53, #68, and #76-#80.

## Boundary

- `(expression for target in iterable ...)` and the sole-call-argument form
  create a generator without evaluating any element or filter.
- The leftmost iterable expression is evaluated once and its iterator is
  acquired immediately in the enclosing frame. A non-iterable fails before a
  generator is published.
- Elements, filters, and later iterables run lazily in nested left-to-right
  order.
- The existing implicit comprehension scope owns iteration targets; targets do
  not leak and a contained assignment expression binds in the nearest containing
  non-comprehension scope.
- The expression reuses the existing generator `next`/`send`/`throw`/`close`,
  call-depth admission, suspension/finalization, and reachable heap paths. It
  adds no Python VM, scheduler, continuation queue, instruction pointer, or RAM
  lease.

## Explicit deferrals

Asynchronous generator expressions/comprehensions, user-authored iterator
protocols, automatic garbage-collection close, context managers, async
generators, and the excluded packaging/CPython ABI surfaces remain later work.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/language/generatorExpressions.test.ts tests/runtime/pythonGeneratorExpressions.test.ts tests/runtime/pythonComprehensions.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonYieldFrom.test.ts tests/runtime/pythonHeapAccounting.test.ts`.

Expect: syntax and sole-call-argument grammar, immediate leftmost evaluation and
iterator acquisition, lazy nested work, target isolation, containing-scope `:=`,
independent cursors, shared generator methods, capacity rejection without
consumption, and reachable suspended state pass.

Verify: `rtk npm run test:python314` and `rtk npm run validate`.

Expect: every prior Python 3.14 CS Profile regression, all host tests, the
production Bedrock pack, and the 16-chapter Pages build pass.

Verify: open the built `manual/#chapter-micropython` in Chrome at 1440x900 and
390x844, inspect the console, and confirm the generator-expression section
without changing the stable chapter link.

Expect: both viewports have no horizontal overflow, the chapter remains active,
and no page-script warning or exception is reported.

Official references:

- https://docs.python.org/3.14/reference/expressions.html#generator-expressions
- https://docs.python.org/3.14/reference/expressions.html#displays-for-lists-sets-and-dictionaries

## Local verification result

- Focused syntax/runtime/heap acceptance passed 6 files and 96 tests on
  2026-07-21. This includes existing-iterator position retention and PEP 479
  conversion/closure when an element expression leaks `StopIteration`.
- `rtk npm run test:python314` passed 39 files and 374 tests;
  `rtk npm run test:web` passed 7 files and 101 tests; and
  `rtk npm run test:pages` passed 3 files and 26 tests.
- Chrome opened the built manual at `#chapter-micropython`. At 1440x900 and
  390x844 it retained the exact title/hash and displayed the example,
  immediate-leftmost, lazy-clause, non-leaking-scope, sole-call-argument, and
  async-deferral text without horizontal overflow. The console contained no
  warning or error. The temporary viewport, tab, and exact loopback-server
  process were finalized.
- A later headed Chromium fallback check found and removed a stale sentence that
  still classified generator expressions as deferred. A regression assertion now
  rejects that contradiction. The rebuilt manual again passed at 1440x900 and
  390x844 with chapter 05 active, no overflow, and no console diagnostics.
- `rtk npm run validate` now passes formatting, ESLint, and TypeScript, then
  reaches 229/235 test files and 1,711/1,725 tests. The 14 failures are outside
  Issue #81: six are the in-progress Phase 20 context-manager suite, and eight
  are concurrent C frontend/linker expectations including unresolved hosted
  `printf`. No generator-expression test failed. `rtk npm run build:pages`
  separately passed all 16 chapters.
