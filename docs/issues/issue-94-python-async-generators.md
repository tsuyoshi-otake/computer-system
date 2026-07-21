# Issue #94: bounded Python async generators and comprehensions

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/94>

- Status: implemented; focused, aggregate, full-host, and real-browser verified;
  real-BDS evidence pending
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #68, #77-#83, #93

## Delivered contract

- An `async def` with a directly owned `yield` creates an unstarted, accounted
  async generator. It does not execute the body and it does not create another
  interpreter, event loop, or scheduler.
- `__aiter__()` returns the generator. `__anext__()`, `asend(value)`,
  `athrow(...)`, and `aclose()` return single-use awaitables. Awaiting them
  resumes the same suspended CS486 frame and outer `Cs486Process`.
- A yield completes the current operation with the exact value. `asend` supplies
  its exact argument as the suspended yield-expression result. Natural return
  raises `StopAsyncIteration`; `async for` consumes it.
- `athrow` injects through the existing exception path. `aclose` injects
  `GeneratorExit`, preserves `try`/`finally`, returns `None` on a handled close,
  and raises `RuntimeError` if the generator yields while closing.
- Eager list, set, and dictionary async comprehensions execute as implicit
  coroutines. Async generator expressions are lazy. Both synchronous and
  asynchronous clauses retain left-to-right evaluation, a private target scope,
  and one enclosing-scope evaluation of the leftmost source.
- Created/suspended frames, operation arguments, closure cells, handlers, active
  faults, pending control, and protocol owners remain reachable through
  `PythonHeapAccounting`. Call-depth rejection leaves an unconsumed operation
  retryable, and execution remains resumable at eight CS486 instructions per
  host slice.

## Deliberate exclusions

- automatic garbage-collection finalization hooks;
- `asyncio` event loops, tasks, futures, and host-I/O integration;
- any second Python VM, bytecode interpreter, or scheduler.

## Acceptance evidence

- Verify:
  `rtk npm exec vitest -- run tests/language/asyncSyntax.test.ts tests/runtime/pythonAsyncGenerators.test.ts tests/runtime/pythonCoroutines.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonGeneratorExpressions.test.ts`
  Expect: async grammar, ordinary generators/coroutines, async-generator
  lifecycle, operation protocols, comprehensions, limits, and low-slice cases
  all pass.
- Verify: `rtk npm run test:python314` Expect: the aggregate Python 3.14 CS
  Profile contract includes the async generator suite and exits successfully.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: canonical manual assertions, static-page
  tests, and all 16 chapters pass after the support matrix is synchronized.
- Verify: `rtk npm run validate` Expect: the repository-wide host gate exits
  successfully, or any residual is recorded with exact unrelated file/diagnostic
  evidence.

## Verification result

- The frontend/runtime/contract/manual/guidance selection passes 6 files and 71
  tests. The dedicated frontend/runtime pair passes 2 files and 26 tests.
- `npm run test:python314` includes the async-generator suite and passes all 57
  files and 564 tests.
- `npm run validate` passes formatting, ESLint, TypeScript, all 270 files and
  2,010 tests, the production pack build, and the 16-chapter Pages build.
- The preferred Chrome and Computer Use control runtimes were unavailable
  because their configured Node executable was missing. The required fallback
  used headed Playwright against the generated local Pages site. At a 1,263 px
  viewport, document client/scroll widths were both 1,248 px. At a 390 px
  viewport, they were both 375 px and the Python chapter was 373 px wide.
  Async-generator creation, operations, lazy expressions, and exclusions were
  visible at both widths, with zero browser warnings or errors. The browser,
  exact local server PID, and generated snapshot were finalized.
- Real BDS/GDK execution remains pending, so Issue #94 stays open.
