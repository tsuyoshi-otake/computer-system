# Issue #82: Python context managers

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/82

Status: host implementation, focused acceptance, aggregate Python, and manual
browser acceptance complete. The repository gate and final Python 3.14 profile
gate remain open.

Depends on: Epic #49 and Issues #52, #74, and #77-#81.

## Boundary

- A synchronous `with` statement accepts one or more items, optional assignment
  targets, and the parenthesized multi-line/trailing-comma form.
- Manager expressions and successful entries run left to right. Successfully
  entered managers finalize exactly once from right to left, as nested `with`
  statements.
- Implicit lookup resolves `__enter__` and `__exit__` through the manager's
  class path, not its instance namespace. The bound exit is retained before
  enter runs.
- Target assignment belongs to the protected region. Normal completion,
  `return`, `break`, and `continue` call exit with three `None` values and
  ignore its result.
- A fault supplies its stable exception type, exact managed exception value, and
  CS Profile traceback `None`. A truthy exit suppresses it; a false exit
  reraises the exact value. A replacement exit fault is routed through every
  already-entered outer manager.
- Bound exits, receivers, exception handlers, and pending finalizer control
  survive generator suspension and `close()` through the existing `Cs486Process`
  and reachable heap. This phase adds no Python VM, scheduler, instruction
  pointer, continuation queue, or RAM lease.

## Explicit deferrals

`async with`, asynchronous context managers, `contextlib`, generator-decorator
context managers, descriptor/metaclass customization of special-method lookup,
runtime traceback objects, packaging, and the excluded `pip`/`venv`/CPython ABI
surfaces remain later work.

## Acceptance

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/language/contextManagers.test.ts tests/runtime/pythonContextManagers.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonHeapAccounting.test.ts`.

Expect: grammar, scope and exact/capacity-plus-one limits; class-backed special
lookup; entry/body/exit order; protected assignment; normal/control/fault
arguments; suppression and exact reraising; later-enter and inner-exit faults;
generator close; admission rollback; and reachable bound-exit ownership pass.

Verify: `rtk npm run test:python314` and `rtk npm run validate`.

Expect: every prior Python 3.14 CS Profile regression, all host tests, the
production Bedrock pack, and the 16-chapter Pages build pass.

Verify: open the built `manual/#chapter-micropython` in Chrome at 1440x900 and
390x844, inspect the console, and confirm the synchronous-context-manager
section without changing the stable chapter link.

Expect: both viewports have no horizontal overflow, chapter 05 remains active,
and no page-script warning or exception is reported.

Official references:

- https://docs.python.org/3.14/reference/compound_stmts.html#the-with-statement
- https://docs.python.org/3.14/reference/datamodel.html#with-statement-context-managers

## Local verification result

- Focused language/runtime/generator/heap acceptance passed 4 files and 69 tests
  on 2026-07-21.
- `rtk npm run test:python314` passed 41 files and 395 tests.
- `rtk npm run test:web` passed 7 files and 101 tests.
- `rtk npm run test:pages` passed 3 files and 26 tests, and
  `rtk npm run build:pages` built all 16 chapters.
- Chrome opened the built manual at `#chapter-micropython` through the
  configured Chrome control path. At 1440x900 and 390x844 it retained the exact
  title/hash and active Python chapter, displayed the entry/exit order,
  exact-fault, generator-close, four-value admission, and async-deferral text,
  and had no horizontal overflow. The console contained no warning or error. The
  device override, tab, and exact loopback-server process were finalized.
- The latest `rtk npm run validate` passed formatting, ESLint, TypeScript, and
  235/239 test files with 1,736/1,743 tests. Its seven remaining failures are
  outside Issue #82 in concurrent C frontend/linker work: hosted `printf`,
  legacy diagnostic wording/notes, and a relocation-kind expectation. No Python
  or context-manager test failed, so the Issue stays open pending one
  aggregate-green readback.
