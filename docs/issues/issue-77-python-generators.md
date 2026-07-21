# Issue #77: Python generator functions

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/77

Status: host and local-browser acceptance complete; later generator protocols
and the final Python 3.14 profile gate remain open.

Depends on: Epic #49 and Issues #52, #53, #67, and #76.

## Boundary

- An ordinary `def` containing a direct optional-value `yield` statement creates
  a generator function. Yields in nested functions/classes do not classify the
  outer function.
- Calling the function binds arguments but does not execute its body. `next()`
  and `for` resume the compiled CS486 target and preserve locals, closure cells,
  the managed value stack, and the next target between yields.
- `return` closes the generator. `for` observes exhaustion; `next()` raises
  `StopIteration` or returns its supplied default. An unhandled body exception
  closes the generator before normal caller exception routing.
- Created, running, suspended, closed, and faulted paths have one explicit state
  owner. Generator execution still uses the existing instruction slices, cycle
  debt, call-depth, stack, collection, and memory ceilings.
- Suspended state participates in reachable `PythonHeapAccounting`; no second
  Python VM, instruction pointer, scheduler, or physical RAM lease exists.

## Explicit deferrals

Yield expressions receiving a sent value, `send`, `throw`, `close`,
`yield from`, generator expressions, yield with an active
`try`/`except`/`finally` handler, custom `__iter__`/`__next__`, context
managers, async generators, and the excluded packaging/CPython ABI surfaces
remain later work.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests\language\generators.test.ts tests\runtime\pythonGenerators.test.ts tests\runtime\pythonIterators.test.ts tests\runtime\pythonClosures.test.ts tests\runtime\pythonHeapAccounting.test.ts tests\tools\python314Compatibility.test.mjs`.

Expect: syntax/scope classification, invalid-context rejection, lazy start,
ordered resumption, independent instances, closure state, `for`, return and
stable exhaustion, fault closure, suspended heap roots, and the manifest pass.

Verify: `rtk npm run test:python314`.

Expect: every prior Python 3.14 CS Profile regression and all generator cases
pass.

Verify: `rtk npm run validate`.

Expect: formatting, ESLint, TypeScript, every host test, the production Bedrock
pack, and the 16-chapter Pages build pass.

Verify: open the built `manual/#chapter-micropython` in a real browser at
desktop and 390-pixel widths, inspect the console, and confirm the generator
section text and stable chapter deep link.

Expect: the heading, lazy-call statement, and compiled-CS486 resume statement
are present; neither viewport has horizontal overflow; the chapter remains
active; no page-script warning or exception is reported.

Official references:

- <https://docs.python.org/3.14/reference/expressions.html#yield-expressions>
- <https://docs.python.org/3.14/reference/simple_stmts.html#the-yield-statement>
- <https://docs.python.org/3.14/reference/datamodel.html#generator-functions>

## Local verification result

- Focused generator/iterator/closure/heap/contract acceptance passed 6 files and
  38 tests.
- `rtk npm run test:python314` passed 36 files and 304 tests.
- `rtk npm run validate` passed formatting, ESLint, TypeScript, all 225 test
  files and 1,599 tests, the production Bedrock pack, and the 16-chapter Pages
  build.
- Chrome control and Computer Use both failed before connection because their
  configured Node runtime path was unavailable. The required Playwright fallback
  opened a headed browser on `manual/#chapter-micropython`. Desktop 1440x900 and
  narrow 390x844 viewports had no horizontal overflow; the iterator/generator
  heading, lazy-call statement, compiled-CS486 resume statement, title, and
  stable deep link were present. The only console entry was the local static
  server's unrelated `/favicon.ico` 404; there were no script warnings or
  exceptions. The browser session, generated snapshots, and owned loopback
  server were finalized.
