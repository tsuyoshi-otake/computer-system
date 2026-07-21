# Issue #91: bounded Python generic aliases and runtime subscription

- GitHub Issue: <https://github.com/tsuyoshi-otake/computer-system/issues/91>
- Status: implemented; focused host verification complete; aggregate/full and
  real-browser gates pending
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #50, #51, #74, #88, #90

## Implemented boundary

- Generic class and PEP 695-style type-alias subscription, including stable
  process-local cache identity for the same origin and argument identities.
- Bounded `list[T]`, `dict[K, V]`, `tuple[T, ...]`-shaped multi-argument, and
  `set[T]` runtime aliases plus the corresponding supported constructors.
- Read-only `__origin__`, `__args__`, and `__parameters__` reflection.
- Open-alias resubscription and recursive substitution through nested generic
  aliases, capped at 64 levels and the shared collection ceiling.
- Lazy missing ordinary and `ParamSpec` defaults through managed CS486 calls,
  successful caching, fault retry, and one bounded `TypeVarTuple` argument
  segment. Explicit `ParamSpec` subscriptions normalize list, tuple, empty, and
  sole-parameter expanded argument lists to one tuple-shaped slot.
- Type-erased parameterized class and built-in calls. Parameterized aliases are
  rejected as `isinstance`/`issubclass` class-info values.
- One process-local alias cache capped by `maxCollectionSize`; cache roots,
  origins, argument tuples, open parameters, nested aliases, and in-progress
  defaults remain in `PythonHeapAccounting`.

## Explicit exclusions

- Full `typing` and `annotationlib` modules and static-checker behavior.
- Runtime annotation/type enforcement, variance introspection, and tuple
  class-info support.
- Custom `__class_getitem__`, metaclass subscription, descriptors, and writable
  or deletable generic reflection.
- `pip`, `ensurepip`, `venv`, PyPI, wheels, CPython internals, and host-native
  extensions.

## Acceptance evidence

1. Runtime subscription and reflection

   - Verify: `npm exec vitest run tests/runtime/pythonGenericAliases.test.ts`
   - Expect: class, type-alias, built-in, open/nested, default, variadic,
     reflection, cache, call, class-check, heap, capacity-plus-one, and
     low-slice cases pass.

2. Type-parameter regression

   - Verify:
     `npm exec vitest run tests/runtime/pythonTypeParameters.test.ts tests/runtime/pythonTypeParametersAcceptance.test.ts`
   - Expect: every #90 scope, reflection, laziness, retry, capacity, and slice
     case remains green.

3. Contract and canonical manual

   - Verify:
     `npm exec vitest run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs`
   - Expect: exact generic-alias owners, reflection, type erasure, bounds, and
     remaining typing/install exclusions match the shipped manual.

4. Aggregate gates

   - Verify: `npm run test:python314` and `npm run validate`
   - Expect: every Python-profile and repository gate passes; any unrelated
     concurrent residual remains recorded without weakening this criterion.

5. Canonical manual rendering

   - Verify: build Pages and inspect the Python chapter in Chrome.
   - Expect: examples, reflection attributes, limits, type erasure, and
     exclusions are readable without horizontal overflow or console errors.

## Verification result

On 2026-07-21, the focused generic-alias suite passed 13/13 tests, including
explicit `ParamSpec` normalization. The final runtime/contract/manual selection
passed 5 files and 51 tests before that additional boundary case. TypeScript
reported no diagnostics in the owned runtime or test files, and targeted ESLint
reported no findings.

`npm run test:python314` passed 52/53 files and 501/504 tests. Every generic
alias and type-parameter case passed. The three residuals remain in the
concurrently changing `pythonCs486ObjectV2.test.ts`: executable v4/v5 version
expectation, initialized-data alignment offsets, and extension function-pointer
relocation.

Web passed 7 files and 101 tests, Pages passed 3 files and 26 tests, and all 16
chapters built. The preferred Chrome and Computer Use connections both failed
before browser control because their configured Node runtime path was absent.
The permitted headed Playwright fallback then opened the generated Python
chapter at 1,440 x 900 and 390 x 844. The exact chapter hash, `05 / 16`, generic
examples, all three reflection attributes, and explicit `ParamSpec` contract
were present; client/scroll widths were 1,425/1,425 and 375/375, with zero
console diagnostics. The browser session, exact local-server PID, and five
generated temporary artifacts were finalized.

`npm run validate` stopped at its first stage on formatting differences in 20
concurrently edited CS486/computer/toolchain files; none belongs to the #91
owned selection, which is formatted. Keep Issue #91 open until the shared
aggregate and full gates can pass.
