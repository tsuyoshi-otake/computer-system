# Issue #90: bounded Python 3.14 type parameters and lazy type aliases

- GitHub Issue: <https://github.com/tsuyoshi-otake/computer-system/issues/90>
- Status: implemented; focused host and desktop Chrome verification complete;
  aggregate/full gate and fixed-width mobile Chrome verification pending
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #50, #51, #52, #74, #88

## Implemented boundary

- Generic function, class, and soft-keyword `type` alias syntax.
- Plain TypeVar-shaped, `*Ts` TypeVarTuple-shaped, and `**P` ParamSpec-shaped
  parameters with authored-order bounds, tuple constraints, and defaults.
- Private annotation-scope overlay cells. Decorators and function defaults stay
  in the containing scope; annotations, generic class bodies/bases, and alias
  values retain the type parameters and immediately enclosing class namespace.
- Stable read-only `__type_params__`; parameter `__name__`, lazy `__bound__`,
  `__constraints__`, and `__default__`; alias `__name__` and lazy `__value__`.
- One shared internal `typing.NoDefault`-shaped sentinel for missing defaults.
- Successful lazy caching after heap admission, fault retry without partial
  cache publication, ordinary managed CS486 calls/faults/slices/cycle debt, and
  reachable evaluator/closure/cache ownership.
- Duplicate/order/later-reference/forbidden-expression/nonlocal rejection plus
  exact and capacity-plus-one construct, scope, and runtime collection tests.

## Explicit exclusions

- Complete `typing` and `annotationlib` APIs and static-checker behavior.
- Generic subscription was deferred from #90 and is implemented separately by
  #91. Implicit `typing.Generic` behavior, variance introspection, and runtime
  generic type checking remain outside this issue.
- Alternate `evaluate_*`/`annotationlib` formats.
- Writable or deletable reflection attributes.
- `pip`, `ensurepip`, `venv`, PyPI, wheels, CPython internals, and host-native
  extensions.

## Acceptance evidence

1. Syntax and scope

   - Verify: `npm exec vitest run tests/language/typeParameters.test.ts`
   - Expect: every supported form, scope split, negative diagnostic, exact
     construct/scope limit, and capacity-plus-one case passes.

2. Runtime reflection and laziness

   - Verify:
     `npm exec vitest run tests/runtime/pythonTypeParameters.test.ts tests/runtime/pythonTypeParametersAcceptance.test.ts`
   - Expect: function/class/alias reflection, scope visibility, lazy values,
     cache identity, retry, evaluation order, read-only attributes, capacity,
     and low-slice execution pass on the production CS486 path.

3. Contract and canonical manual

   - Verify:
     `npm exec vitest run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs`
   - Expect: the exact shipped surface and deferred typing/subscription/install
     boundary remain synchronized.

4. Aggregate gates

   - Verify: `npm run test:python314` and `npm run validate`
   - Expect: every Python-profile and repository gate passes; unrelated
     concurrent residuals remain recorded without weakening this criterion.

5. Canonical manual rendering

   - Verify: build Pages and inspect the Python chapter in Chrome at desktop and
     narrow mobile sizes.
   - Expect: the generic example, lazy contract, limits, and exclusions are
     readable with no horizontal overflow or console diagnostics.

## Verification result

On 2026-07-21, the final language/runtime/contract/manual selection passed 5
files and 43 tests. The broader language, class, decorator, closure, annotation,
heap, and limit selection passed 29 files and 247 tests. The Python 3.14
aggregate passed 51/52 files and 488/491 tests; every type-parameter/type-alias
case passed, while the three residuals were the concurrent CS486OBJ extension
initialized-data layout, alignment, and function-pointer relocation expectations
in `pythonCs486ObjectV2.test.ts`.

Web passed 7 files and 101 tests, Pages passed 3 files and 26 tests, and all 16
manual chapters built. Chrome opened the generated Python chapter at the
deferred-annotation/type-parameter section. All three parameter forms, stable
`__type_params__`, lazy access, cache/retry, NoDefault-shaped sentinel,
subscription/typing/install exclusions, and the heading were present. The live
1,263 px viewport had equal client/scroll widths, the screenshot was readable,
and the console contained no diagnostics. The prior Chrome safety-policy ruling
still prohibits the `data:` fixed-width harness and CDP/alternate-surface
circumvention, so exact 1,440 x 900 and 390 x 844 evidence remains pending. The
tab, server, and exact server PID were finalized.

`npm run validate` stopped first on an unrelated formatting difference in
`.codex/memory/rules.md`. The owned source/evidence selection is formatted and
lint-clean. TypeScript still reports the unrelated optional `hostedStartup`
narrowing error in `computerRuntime.ts`. Issue #90 remains open until the
aggregate and complete repository gates plus fixed-width Chrome evidence pass.
