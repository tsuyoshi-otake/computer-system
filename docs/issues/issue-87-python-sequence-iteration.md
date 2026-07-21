# Issue #87: bounded Python `__getitem__` sequence iteration

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/87

Status: implementation, focused/related host acceptance, manifest/manual,
Web/Pages, real-browser, TypeScript/lint, and production-build verification are
complete. The aggregate gate remains red on concurrent formatting and C/C++
frontend, linker, relocation, and hosted-libc changes outside this slice.

## Boundary

When inherited class lookup finds no `__iter__`, an inherited `__getitem__`
creates an independent retained cursor starting at Python integer index zero. A
successful result advances once. `IndexError` or an escaping `StopIteration`
makes exhaustion stable; every other fault propagates without advancing. A
class-level `__iter__` value, including explicit `None`, always takes
precedence. Instance-only special methods are ignored.

`iter`, `next`, `for`, synchronous comprehensions, generator expressions,
`yield from`, starred displays, call expansion, unpacking, slice replacement,
and `set(iterable)` share the cursor. Each item request is an ordinary bounded
managed CS486 call. The cursor and source remain in the existing reachable heap;
there is no host callback loop, second Python VM, scheduler, instruction
pointer, or RAM lease.

## Explicit deferrals

The two-argument callable/sentinel form of `iter`, async iteration, and the
excluded packaging/CPython ABI surfaces remain separate phases.

## Acceptance evidence

Verify:
`rtk vitest run tests/runtime/pythonSequenceIteration.test.ts --reporter verbose`

Expect: independent/inherited cursors, selection precedence, all consumers,
fault/exhaustion behavior, generator-function items, heap ownership, and exact
capacity/capacity-plus-one cases pass.

Result: 1 file and 6 tests pass.

Verify:
`rtk vitest run tests/runtime/pythonSequenceIteration.test.ts tests/runtime/pythonIterators.test.ts tests/runtime/pythonIterableMaterialization.test.ts tests/runtime/pythonYieldFrom.test.ts tests/runtime/pythonGeneratorExpressions.test.ts tests/runtime/pythonGenerators.test.ts tests/runtime/pythonHeapAccounting.test.ts --reporter verbose`

Expect: the new fallback and every directly related iterator, materialization,
delegation, generator-expression, generator, and heap regression pass together.

Result: 7 files and 97 tests pass.

Verify: `rtk npm run test:python314`

Expect: the complete current Computer System Python profile passes, including
the new sequence fallback.

Result: 45 of 46 files and 441 of 444 tests pass. The three residual tests are
the current CS486 C-extension data-layout/relocation expectations in
`pythonCs486ObjectV2.test.ts`; no sequence-iteration test fails.

Verify: `rtk tsc --noEmit`, full `rtk npm run lint`, and targeted
`rtk prettier --check` over every Issue #87 source/test/contract file.

Expect: TypeScript, ESLint, and owned-file formatting pass.

Result: all passed.

Verify: `rtk npm run test:web`, `rtk npm run test:pages`, and
`rtk npm run build:pages`.

Expect: the canonical manual, generated Pages inputs, and all 16 chapters agree
with the implementation.

Result: Web passed 7 files and 101 tests; Pages passed 3 files and 26 tests; all
16 chapters built.

Verify: open `manual/#chapter-micropython` in a headed browser at 1440x900 and
390x844; inspect the fallback/index/precedence/ownership claims, stale deferral,
chapter counter, horizontal overflow, and console diagnostics.

Expect: the exact chapter and new contract are visible, the stale `__getitem__`
deferral is absent, `05 / 16` is present, neither viewport overflows, and the
console has no warning or error.

Result: passed in headed Chromium at both viewports with zero warnings/errors.
Preferred Chrome and Computer Use control failed before browser connection
because their configured Node runtime path was absent, so the permitted
Playwright fallback was used. Its session, server, and temporary artifacts were
finalized.

Verify: `rtk npm run build`

Expect: the production Bedrock packs build successfully.

Result: passed.

Verify: `rtk npm run validate` and, after its first failure, full lint,
TypeScript, and `rtk npm test` separately.

Expect: the complete repository gate passes.

Result: aggregate validation stops at six concurrently edited files outside this
slice that are not Prettier-formatted. Full lint and TypeScript pass. Full
Vitest passes 243 of 248 files and 1,806 of 1,818 tests; all 12 residual
failures are C/C++ frontend, linker, relocation, or hosted-libc expectations.
Issue #87 remains open until the aggregate repository gate is green.
