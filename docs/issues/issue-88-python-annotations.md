# Issue #88: bounded Python 3.14 deferred annotations

- GitHub Issue: <https://github.com/tsuyoshi-otake/computer-system/issues/88>
- Status: implemented; focused host and desktop Chrome verification complete;
  aggregate/full gate and fixed-width mobile Chrome verification pending
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #50, #51, #52, #53, #74, #75, #84

## Implemented boundary

- Annotated assignment syntax for simple and non-simple targets.
- Parameter annotations for positional-only, positional-or-keyword,
  keyword-only, variadic positional, and variadic keyword parameters.
- Return annotations.
- Separate bounded annotation scopes with enclosing-function cells and
  immediately enclosing class namespace access.
- Deferred module, class, and function `__annotations__` dictionaries.
- Executed-only conditional module/class entries, successful mutable-dictionary
  caching, fault retry, and partial-module non-caching.
- Function-local annotation non-evaluation and ordinary global/nonlocal binding.
- Non-simple target/RHS evaluation without annotation evaluation.
- Ordinary managed-CS486 call/return, fault, call-depth, slice, cycle-debt, and
  reachable-heap ownership for annotation evaluators and caches.
- Exact and capacity-plus-one collection/scope tests.

## Explicit exclusions

- `__annotate__` and `annotationlib` alternate formats.
- `from __future__ import annotations` stringization.
- Type parameter lists, type aliases, and `typing` library semantics.
- Writable/deletable function, class, and module annotation descriptors.
- `pip`, `ensurepip`, `venv`, PyPI, and wheel installation.

## Acceptance evidence

1. Syntax and scope ownership

   - Verify: `npm exec vitest run tests/language/annotations.test.ts`
   - Expect: annotated assignments, all function annotation positions,
     annotation restrictions, class namespace lookup, closure classification,
     function-local non-evaluation, and exact scope ceilings pass.

2. Deferred runtime behavior

   - Verify: `npm exec vitest run tests/runtime/pythonAnnotations.test.ts`
   - Expect: forward names, authored order, successful caching/mutation, fault
     retry, class/method scope, closures, conditional entries, partial imports,
     non-simple targets, global/nonlocal, exact/capacity-plus-one results, and
     bounded slices pass on the production CS486 path.

3. Contract and canonical manual

   - Verify:
     `npm exec vitest run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs`
   - Expect: the exact implementation/exclusion contract and canonical manual
     wording pass.

4. Aggregate host gate

   - Verify: `npm run test:python314`
   - Expect: every included Python 3.14 CS Profile suite passes.

5. Complete repository gate

   - Verify: `npm run validate`
   - Expect: formatting, lint, TypeScript, all Vitest suites, Bedrock pack
     build, and all 16 Pages chapters pass; unrelated concurrent failures, if
     any, are recorded without weakening this criterion.

6. Canonical manual rendering

   - Verify: build Pages, open the Python chapter in Chrome at desktop and
     narrow mobile sizes, and inspect console/layout state.
   - Expect: deferred-annotation examples and exclusions are readable, the
     document has no horizontal overflow, and the browser console is clear.

## Verification result

On 2026-07-21, the final annotation language/runtime/contract/manual selection
passed 4 files and 32 tests. The Python 3.14 aggregate passed 48/49 files and
463/466 tests; all annotation cases passed, while the three residuals were the
concurrent CS486OBJ extension initialized-data layout, alignment, and function-
pointer-table relocation expectations in `pythonCs486ObjectV2.test.ts`.

Chrome opened the generated canonical manual at the deferred-annotation anchor.
The heading, forward-reference example, success cache, fault retry, partial-
module, function-local, limits, exclusions, and no-`pip`/`venv` text were
present. The live document reported equal client/scroll width at the 1,263 px
available viewport, the screenshot was readable, and the console contained no
diagnostics. The configured Chrome safety policy rejected a `data:` verification
harness for exact 1,440 x 900 and 390 x 844 iframe viewports and explicitly
prohibited indirect/CDP/alternate-browser circumvention. The tab, local server,
and exact server PID were finalized; fixed-width mobile evidence therefore
remains pending rather than being approximated.

The repository gate stopped first on unrelated formatting in `cs486Archive.ts`.
Individual stages then showed two unrelated lint findings, one unrelated
`computerRuntime.ts` type error, 1,832/1,844 host tests passing, and successful
production Bedrock pack and 16-chapter Pages builds. The twelve host-test
residuals were C/C++ frontend/global/toolchain, C-extension relocation, and
C/C++ execution expectations; no annotation test failed. Issue #88 remains open
until the aggregate and complete repository gates, plus the required fixed-
width Chrome evidence, pass.
