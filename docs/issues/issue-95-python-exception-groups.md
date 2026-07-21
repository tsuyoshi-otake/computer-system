# Issue #95: bounded Python exception groups and except-star

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/95>

- Status: implemented; focused, aggregate, full-host, real-browser, and real-BDS
  verified
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #67, #77-#83, #93, #94

## Delivered contract

- `BaseExceptionGroup` and `ExceptionGroup` construct one non-empty, bounded
  exception tree. `BaseExceptionGroup` selects `ExceptionGroup` when every leaf
  derives from `Exception`; `ExceptionGroup` rejects `BaseException`-only
  leaves.
- Groups expose read-only `message`, `exceptions`, and `args`. `derive()`,
  `subgroup()`, and `split()` preserve nested shape and the profile-visible
  cause, context, notes, and traceback metadata.
- `except*` recursively splits the original tree for each authored handler. A
  handler accepts an exception type/tuple or a managed Python function, lambda,
  or bound method predicate through the ordinary CS486 call path.
- Ordinary faults are temporarily wrapped for matching and propagate naked when
  unmatched. Bare reraises retain the original subgroup identity and tree. Newly
  raised handler faults and unmatched leaves merge deterministically before the
  existing `finally` or outer-handler owner resumes.
- Active subgroup, unmatched/new faults, predicate calls, handlers, and pending
  continuation remain reachable through `PythonHeapAccounting` across generator
  and coroutine suspension. Execution resumes through the outer CS486
  instruction slices without a second exception VM or scheduler.
- Trees admit at most 64 levels and 4,096 nodes. Mutation and retained-state
  growth preflight managed heap capacity, so rejection leaves retry/finalization
  ownership observable.

## Syntax and deliberate exclusions

- One `try` may not mix `except` with `except*`. Bare `except*`, malformed
  optional-parentheses lists, and `return`/`break`/`continue` in a starred
  handler suite are rejected before code generation. Nested function and class
  definitions form explicit control-transfer boundaries.
- Native functions, class objects, filesystem extension exports, custom
  `__call__` objects, and scheduler-yielding subgroup predicates remain
  unavailable.
- Runtime traceback objects beyond the current profile `None`/metadata
  placeholder, full exception chaining presentation, and the remaining custom
  exception data model remain later work.

## Acceptance evidence

- Verify:
  `rtk npm test -- tests/runtime/pythonExceptionGroups.test.ts tests/language/exceptionGroups.test.ts`
  Expect: grammar/static restrictions, construction, recursive routing,
  predicates, merging, suspension, limits, heap, and low-slice cases all pass.
- Verify: `rtk npm run test:python314` Expect: the aggregate Python 3.14 CS
  Profile includes the exception-group suite and exits successfully.
- Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
  `rtk npm run build:pages` Expect: canonical manual assertions, static-page
  tests, and all 16 chapters pass after the support text is synchronized.
- Verify: `rtk npm run validate` Expect: the complete repository host gate exits
  successfully, or any residual is recorded with exact unrelated file/diagnostic
  evidence.
- Verify: inspect the generated Python chapter in a real browser at desktop and
  mobile widths. Expect: the exception-group section, restrictions, and ceilings
  are visible without horizontal overflow or browser errors.

## Verification result

- The dedicated frontend/runtime pair passes 2 files and 27 tests.
- `rtk tsc --noEmit` passes after the exception-group runtime and tests.
- `rtk npm run test:python314` passes 59 files and 591 tests. Web passes 7 files
  and 101 tests, Pages passes 3 files and 27 tests, and all 16 chapters build.
- Chrome and Computer Use could not start because their configured Node runtime
  path was missing. The required headed-Playwright fallback rendered Chapter 05
  at 1,263 px and 390 px. Document client/scroll widths were equal at both
  sizes, the Python chapter was 941 px and 388 px respectively, the exception
  group section and restrictions were visible, and browser warnings/errors were
  zero. The browser and exact local server PID were finalized.
- `rtk npm run test:mcp:bds` passes in a dedicated empty runtime with temporary
  Web port 4176 and BDS ports 19152/19153: the headless suite reports zero
  failures, zero diagnostics, and final state `idle`. Ports were released and
  the verified `C:\tmp` runtime was removed.
- `rtk npm run validate` passes formatting, ESLint, TypeScript, all 275 files
  and 2,066 tests, hosted-C consistency, the production Bedrock pack, and the
  16-chapter Pages build.
