# Issue #93: bounded Python 3.14 coroutines and async protocols

- GitHub Issue: <https://github.com/tsuyoshi-otake/computer-system/issues/93>
- Status: implemented; focused, aggregate, and real-browser verification
  complete; repository-wide full gate pending
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #50, #77-#83

## Implemented boundary

- `async def` produces an unstarted, accounted coroutine. `await` resumes native
  coroutines and class-backed `__await__` iterators on the existing
  `Cs486Process`; no Python VM or second scheduler is introduced.
- The low-level coroutine surface supports `send(None)`, `throw`, and `close`,
  with exact result/fault propagation, explicit reuse rejection, call-depth
  admission, reachable-frame accounting, and bounded instruction slices.
- `async for` resolves class-backed `__aiter__`/`__anext__`, accepts a coroutine
  returned directly or through a synchronous `__anext__`, consumes
  `StopAsyncIteration`, and preserves `break`/`continue`.
- `async with` awaits class-backed `__aenter__`/`__aexit__`, enters
  left-to-right, exits exactly once right-to-left, preserves return/fault
  finalization, and honors truthy exception suppression.
- Await/protocol hand-offs restore the original physical CS486 return slot, so
  an intermediate synchronous special method cannot publish a stale result or
  duplicate completion.

## Explicit exclusions

- Custom `__await__` iterators that actually yield an external scheduler token.
- Async generators and asynchronous comprehensions.
- `asyncio` event loops, tasks, futures, host I/O integration, and an implicit
  host scheduler.

## Acceptance evidence

1. Frontend and scope

   - Verify: `npm test -- --run tests/language/asyncSyntax.test.ts`
   - Expect: async syntax, await precedence, coroutine-only contexts, nested
     sync/class boundaries, malformed targets, and `yield from` rejection pass.

2. Runtime and ownership

   - Verify: `npm test -- --run tests/runtime/pythonCoroutines.test.ts`
   - Expect: unstarted calls, native/custom await, synchronous protocol
     hand-offs, async iteration/context management, invalid protocols, terminal
     methods, capacity-plus-one depth, heap, and low slices pass.

3. Contract and manual

   - Verify:
     `npm test -- --run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs`
   - Expect: the exact supported surface and exclusions agree.

4. Aggregate gates

   - Verify: `npm run test:python314` and `npm run validate`
   - Expect: every Python-profile and repository gate passes.

5. Canonical manual rendering

   - Verify: build Pages and inspect the Python chapter in Chrome.
   - Expect: coroutine examples, low-level driver, single-scheduler ownership,
     bounds, and exclusions render without horizontal overflow or console
     diagnostics.

## Verification result

The focused coroutine suite passes 18/18 tests. It includes a regression for a
synchronous `__anext__` returning a coroutine: the coroutine completion now
restores the original physical return slot before returning to the loop,
preventing the synchronous method's implicit `None` return from overwriting the
awaited value. The frontend/runtime/contract/manual selection passes 4 files and
47 tests, and the broader language/generator/context selection passes 27 files
and 277 tests. Targeted ESLint reports no findings and the owned selection is
Prettier-clean.

`npm run test:python314` includes the coroutine suite directly and passes all 56
files and 544 tests. Web passes 7 files and 101 tests, Pages passes 3 files and
26 tests, and the Pages builder emits all 16 chapters.

Chrome at 1,263 pixels renders the complete Chapter 05 coroutine section,
including the low-level driver, single-scheduler ownership, async iteration,
reverse async-context finalization, and explicit exclusions. The document has
equal client/scroll widths of 1,263 pixels and no captured warning or error
diagnostics. The exact Chrome tab and local server PID were finalized.

The repository-wide TypeScript check is currently red only on nine concurrent
`cs486CFrontend.ts` scalar/array narrowing and missing-return diagnostics. The
last `npm run validate` attempt stopped at formatting differences in that same
unrelated file after the owned `package.json` entry was formatted. Keep Issue
#93 open until the shared full gate passes.
