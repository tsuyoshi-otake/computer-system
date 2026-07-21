# Issue #85: bounded generic Python iterable materialization

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/85

Status: implementation, focused host acceptance, Python-profile, Web/Pages,
real-browser, and production-pack verification complete. The aggregate host test
gate remains red on concurrent C/C++ frontend, linker, relocation, and
hosted-libc changes outside this slice.

Depends on: Epic #49 and Issues #53, #57, #59, #68, and #76-#83.

## Boundary

Class-backed user iterators and generators now share the existing materializing
consumer boundary with built-in cursors:

- starred list, tuple, and set displays;
- positional `*args` expansion;
- exact and starred target unpacking;
- simple and extended list-slice replacement;
- `set(iterable)`.

Every `__iter__`, `__next__`, and generator resumption remains an ordinary
bounded CS486 call. A runtime materialization state owns the current iterator,
accumulated values, pending operands/arguments, slice target, result container,
logical Python frame/fault state, and the original physical CS486 return slot.
There is no host callback loop, second Python VM, scheduler, instruction
pointer, or RAM lease.

Evaluation and consumption remain left to right. Existing cursors keep their
current position. `StopIteration` completes materialization; every other fault
propagates unchanged. A call is not invoked, unpack targets are not stored,
slice targets are not mutated, and new display/set results are not published
until iteration and all applicable arity/capacity checks succeed. Work already
performed by an iterator before a later fault remains observable.

Total produced items are bounded even when a set receives duplicates, so an
infinite duplicate source cannot evade the collection ceiling. Exact capacity
succeeds and capacity plus one fails explicitly.

## Explicit deferrals

The two-argument callable/sentinel form of `iter`, async iteration, asynchronous
comprehensions/generator expressions, and excluded packaging/ CPython ABI
surfaces remain separate phases. The `__getitem__` sequence fallback is
implemented by Issue #87.

## Acceptance evidence

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/runtime/pythonIterableMaterialization.test.ts --reporter verbose`

Expect: all seven user-iterator/generator, consumer, ordering, fault,
transactional-publication, exact/capacity-plus-one, duplicate-production, and
call-depth cases pass.

Result: 1 file and 7 tests pass.

Verify:
`rtk proxy node .\node_modules\vitest\vitest.mjs run tests/runtime/pythonIterableMaterialization.test.ts tests/runtime/pythonIterators.test.ts tests/runtime/pythonUnpacking.test.ts tests/runtime/pythonCalls.test.ts tests/runtime/pythonSlicing.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonHeapAccounting.test.ts --reporter verbose`

Expect: generic materialization and every directly related iterator, call,
unpack, slice, generator, and heap regression pass together.

Result: 7 files and 96 tests pass.

Verify: `rtk tsc --noEmit`

Expect: the repository type-checks without errors.

Result: passed.

Verify: `rtk npm run test:python314`

Expect: the complete current Computer System Python profile passes, including
the new generic materialization consumers.

Result: 43 files and 425 tests pass.

Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
`rtk npm run build:pages`

Expect: the canonical manual contract, generated Pages inputs, and all 16
published chapters agree with the implementation.

Result: Web passed 7 files and 101 tests; Pages passed 3 files and 26 tests; the
Pages build emitted all 16 chapters.

Verify: open `manual/#chapter-micropython` in a headed browser at 1440x900 and
390x844, inspect the materialization and atomicity claims, check horizontal
overflow, and read console diagnostics.

Expect: the exact Python chapter and new contract are visible, the superseded
generic-materialization deferral is absent, neither viewport overflows
horizontally, and the console has no warning or error.

Result: passed in headed Chromium at both viewports with zero warnings/errors.
The preferred Chrome and Computer Use control runtimes failed before connection
because their configured Node runtime path was absent, so the
repository-approved Playwright fallback was used and fully finalized.

Verify: `rtk npm run build`

Expect: the production Bedrock behavior/resource packs build successfully.

Result: passed; the behavior-pack script and source map were emitted under
`dist`.

Verify: `rtk npm test`

Expect: all host tests pass.

Result: 240 of 245 files and 1,782 of 1,794 tests pass. The 12 residual failures
are concurrent C/C++ frontend, linker, relocation, and hosted-libc expectation
changes. No Python iterable-materialization test fails. Issue #85 remains open
until the aggregate repository gate is green.
