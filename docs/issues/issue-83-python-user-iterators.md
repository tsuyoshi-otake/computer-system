# Issue #83: bounded user-defined Python iterators

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/83

## Scope

Computer System Python resolves inherited `__iter__` and `__next__` through an
instance's class path, bypassing instance attributes, and invokes both through
the existing bounded Python-to-CS486 call path. An iterable may return itself, a
separate class-backed iterator, a built-in iterator, or a generator.

The managed protocol is shared by `iter`, `next`, `for`, synchronous
comprehensions, generator expressions, and `yield from`. `StopIteration` ends a
loop, selects the exact optional `next` default, or supplies its `value` to a
yield-from expression. Other faults retain their identity and route through the
ordinary handler/finalizer owner.

The callable/sentinel form of `iter` remains explicit follow-up work. Generic
materialization is implemented by Issue #85 and the `__getitem__` sequence
fallback by Issue #87.

## Runtime ownership

- A Python call marker records the iterator-protocol owner plus frame, handler,
  active-fault, pending-control, and physical return-stack restoration state.
- Iterator receivers and optional defaults remain reachable heap roots while a
  managed special-method call is active.
- Normal return and escaping fault paths both remove the call exactly once.
- A user iterator under `yield from` remains on the suspending generator stack;
  exhaustion removes it once and publishes `StopIteration.value`.
- Call-depth, collection, managed-memory, CS486 stack, and execution budgets
  remain authoritative; there is no second VM, scheduler, instruction pointer,
  or host-side synchronous callback loop.

## Acceptance evidence

- Verify:
  `npm exec vitest -- run tests/runtime/pythonIterators.test.ts --reporter verbose`
  - Expect: class-backed/inherited lookup, separate and self iterators,
    generator-returning `__iter__`, invalid results, exact defaults/faults,
    comprehension/generator-expression/yield-from consumers, injected-fault
    routing, call-depth rollback, and capacity-plus-one cases all pass.
- Verify:
  `npm exec vitest -- run tests/runtime/pythonIterators.test.ts tests/runtime/pythonYieldFrom.test.ts tests/runtime/pythonGenerators.test.ts --reporter verbose`
  - Expect: the new managed protocol and all existing generator/delegation
    behavior pass together.
- Verify: `npm run test:python314`
  - Expect: the Python 3.14 CS Profile contract, language, runtime, limit, and
    heap suites pass.
- Verify:
  `npm exec vitest -- run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs --reporter verbose`
  - Expect: the exact compatibility contract and authored field manual agree.
- Verify: `npm run test:pages && npm run build:pages`
  - Expect: all 16 manual chapters remain valid and the static Pages build
    succeeds.
- Verify: open `/manual/#chapter-micropython` in the configured Chrome session
  at desktop and mobile widths.
  - Expect: the user-iterator contract, `StopIteration.value`, and explicit
    exclusions are visible without horizontal overflow or browser errors.
- Verify: `npm run validate`
  - Expect: formatting, ESLint, TypeScript, every Vitest suite, production
    packs, and the 16-chapter Pages build pass.

## Current result

- The focused iterator suite passes 11/11 cases.
- The iterator/generator/yield-from/generator-expression/context-manager/heap
  regression set passes 6 files and 97 tests.
- `rtk npm run test:python314` passes 41 files and 402 tests.
- `rtk npm run test:web` passes 7 files and 101 tests.
- `rtk npm run test:pages` passes 3 files and 26 tests, and
  `rtk npm run build:pages` builds all 16 chapters.
- The preferred Chrome and Computer Use control runtimes were unavailable before
  connection because their configured Node control-runtime path did not exist.
  The permitted headed Playwright/Chromium fallback verified chapter 05 at
  1440x900 and 390x844. Both viewports retained the stable chapter URL, chapter
  counter, user-iterator contract, exact `StopIteration.value`, and explicit
  generic-materialization deferral with no horizontal overflow. The existing
  machine PNG now supplies an authored favicon, leaving zero browser warnings
  and zero browser errors.
- The latest `rtk npm run validate` passes formatting, then stops in ESLint on
  four errors in concurrent C-frontend work. A direct `rtk tsc --noEmit`
  likewise reports four C-only errors for missing wide-operation emitters and
  scalar narrowing in `src/application/toolchain/cs486CFrontend.ts`. No Python
  iterator failure is present.

Issue #83 remains open until the aggregate gate is green.
