# Issue #89: bounded Python callable/sentinel iteration

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/89

Status: implementation, focused and related host acceptance, manifest/manual,
Web/Pages, real-browser, and production-build verification are complete. The
aggregate gate remains red on concurrent formatting, lint, type, C/C++ frontend,
linker, relocation, hosted-libc, and compile-job changes outside this slice.

## Boundary

`iter(callable, sentinel)` evaluates the callable and sentinel exactly once in
left-to-right argument order. Each advance invokes the retained callable with no
arguments through the existing bounded CS486 call path. A result equal under the
current CS Profile `==` semantics is consumed instead of yielded and makes the
iterator stably exhausted. A callable-raised `StopIteration` does the same;
another fault propagates without exhausting the iterator.

The supported callable surface is the profile's existing managed functions and
lambdas, bound methods, classes, native functions including scheduler waits, and
filesystem-loaded CS486 extension exports. The callable, sentinel, and sticky
exhaustion flag live in one unexposed internal class-backed instance. Existing
`iter`, `next`, `for`, comprehensions, generator expressions, `yield from`,
starred displays, call expansion, unpacking, slice replacement, and `set`
therefore use one iterator protocol, call-depth owner, physical return path, and
reachable heap graph. There is no host callback loop, second Python VM,
scheduler, instruction pointer, or RAM lease.

## Explicit deferrals

General custom `__call__`, custom `__eq__`, other generator consumers, and async
iteration remain separate phases. Packaging remains source modules/packages and
validated `CS486OBJ`; `pip`, `ensurepip`, `venv`, PyPI/wheels, and CPython ABI
extensions remain excluded from this retro CS486 profile.

## Acceptance evidence

Verify:
`rtk vitest run tests/runtime/pythonCallableSentinelIteration.test.ts --reporter verbose`

Expect: evaluate-once operands, functions/lambdas, bound methods, classes, all
lazy/materializing consumers, sticky sentinel and callable-`StopIteration`
exhaustion, non-stop fault recovery, call-depth rollback, heap retention, native
wait resumption, and CS486 extension dispatch pass.

Result: 1 file and 8 tests pass.

Verify:
`rtk vitest run tests/runtime/pythonCallableSentinelIteration.test.ts tests/runtime/pythonSequenceIteration.test.ts tests/runtime/pythonIterators.test.ts tests/runtime/pythonIterableMaterialization.test.ts tests/runtime/pythonYieldFrom.test.ts tests/runtime/pythonGeneratorExpressions.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonHeapAccounting.test.ts --reporter dot`

Expect: the new iterator and all directly related iterator, materialization,
delegation, generator-expression, generator, and heap regressions pass together.

Result: 8 files and 105 tests pass.

Verify: `rtk npm run test:python314`

Expect: the complete current Computer System Python profile passes, including
callable/sentinel iteration.

Result: 48 of 49 files and 463 of 466 tests pass. The three residual tests are
the concurrent CS486 extension data-layout/alignment/relocation expectations in
`pythonCs486ObjectV2.test.ts`; no callable/sentinel test fails.

Verify: targeted Prettier and ESLint over every Issue #89 owned file plus
`rtk tsc --noEmit` before the concurrent host-runtime change landed.

Expect: owned formatting/lint and TypeScript pass.

Result: all passed. The later aggregate TypeScript run reports one unrelated
`computerRuntime.ts` hosted-startup narrowing error.

Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and, after terminating
three stale `dist/pages` HTTP servers, `rtk npm run build` followed by
`rtk npm run build:pages`.

Expect: the canonical manual, generated Pages inputs, production Bedrock packs,
and all 16 chapters agree with the implementation.

Result: Web passed 7 files and 101 tests; Pages passed 3 files and 26 tests; the
production packs built; all 16 chapters built.

Verify: open `manual/#chapter-micropython` in a headed browser at 1440x900 and
390x844; inspect the exact callable/sentinel, callable surface, equality,
exhaustion, stale-deferral, chapter-counter, overflow, and console claims.

Expect: the exact title/hash and contract are visible, the old deferral is
absent, `05 / 16` is present, neither viewport overflows, and the console has no
warning or error.

Result: passed at both viewports with equal client/scroll widths and zero
warnings/errors. Preferred Chrome and Computer Use failed before browser
connection because their configured Node runtime path was absent, so the
permitted headed Playwright Chrome fallback was used. Its session, exact local
server, and generated snapshot directory were finalized.

Verify: `rtk npm run validate`; after its first failure, run full lint,
TypeScript, and `rtk npm test` separately.

Expect: the complete repository gate passes.

Result: aggregate validation stops on three concurrently edited files outside
this slice that are not Prettier-formatted. Full lint reports two unrelated
missing return types; TypeScript reports one unrelated host-runtime narrowing;
full Vitest passes 247 of 252 files and 1,834 of 1,846 tests. All 12 residuals
are concurrent compile-job, C/C++ frontend, execution, linker, relocation, or
CS486OBJ expectations. Issue #89 remains open until the aggregate gate is green.
