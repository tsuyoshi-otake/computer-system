# Issue #92: bounded Python 3.14 typing runtime core

- GitHub Issue: <https://github.com/tsuyoshi-otake/computer-system/issues/92>
- Status: implemented; focused, aggregate, and real-browser verification
  complete; repository-wide full gate pending
- Date: 2026-07-21
- Profiles: Computer System Python 1.0 on CS486DX/CS486DX2
- Depends on: #49, #50, #90, #91

## Implemented boundary

- One runtime-owned intrinsic `typing` module, importable even when the guest
  filesystem and native-module registry are empty. Guest `typing.py` files
  cannot shadow it, and it never invokes host Python.
- Stable `Any`, `Never`, `NoReturn`, `Self`, `LiteralString`, and `NoDefault`
  tokens plus bounded `Union`, `Optional`, `Literal`, `Annotated`, `Callable`,
  qualifier, guard, unpack, and concatenate forms.
- Runtime `TypeVar`, `ParamSpec`, and `TypeVarTuple` constructors with
  constraints, bounds, defaults, variance flags, `ParamSpec.args`/`.kwargs`, and
  read-only reflection.
- `get_origin`, `get_args`, `cast`, `assert_type`, `assert_never`, and
  `reveal_type`. Annotations and typing helpers do not enforce runtime types.
- Stable process-local alias identity, `Optional` canonicalization to `Union`,
  `Annotated.__metadata__`, open type parameters, shared cache/capacity/nesting
  limits, managed heap ownership, and resumable CS486 slices.

## Explicit exclusions

- Full static-checker behavior, `get_type_hints`, and `ForwardRef` evaluation.
- `TypedDict`/`NamedTuple` generation, overload registry, structural `Protocol`
  checks, `runtime_checkable`, and annotationlib alternate formats.
- Arbitrary metaclass or `__class_getitem__` hooks, runtime type enforcement,
  `pip`, `ensurepip`, `venv`, PyPI, and wheels.

## Acceptance evidence

1. Runtime core

   - Verify: `npm test -- --run tests/runtime/pythonTyping.test.ts`
   - Expect: intrinsic import, identities, forms, reflection, constructors,
     invalid calls, read-only attributes, capacity-plus-one, heap ownership, and
     8-instruction slices pass.

2. Contract and manual

   - Verify:
     `npm test -- --run tests/tools/python314Compatibility.test.mjs tests/tools/webManual.test.mjs`
   - Expect: the exact implemented typing boundary and explicit exclusions
     match.

3. Aggregate gates

   - Verify: `npm run test:python314` and `npm run validate`
   - Expect: every Python-profile and repository gate passes.

4. Canonical manual rendering

   - Verify: build Pages and inspect the Python chapter in Chrome.
   - Expect: typing examples, runtime non-enforcement, bounds, and exclusions
     are readable without horizontal overflow or console diagnostics.

## Verification result

Focused runtime verification passes 10/10 tests, including rejection of a guest
`typing.py` shadow. The final typing/contract/manual selection passes 3 files
and 28 tests; the broader typing/generic/type-parameter/contract/manual
selection passes 6 files and 60 tests. Repository-wide TypeScript reports no
diagnostics, the owned selection is Prettier-clean, and targeted ESLint reports
no findings.

`npm run test:python314` passes all 55 files and 525 tests. The former three
CS486OBJ residuals were traced to a duplicated per-extension data base after the
v5 null-pointer guard was introduced. The append path now normalizes each
single-object link back to object-relative data, reserves one executable-wide
guard, and rebases instructions, initialized data, and function-pointer tables
through the same delta. The focused extension suite passes 8/8 and the related
linker/function-pointer selection passes 4 files and 25 tests.

Web passes 7 files and 101 tests, Pages passes 3 files and 26 tests, and the
Pages builder emits all 16 chapters. The permitted headed-browser fallback at
1,440 x 900 and 390 x 844 shows the exact runtime-owned typing, guest-shadow
rejection, runtime non-enforcement, and no-pip/no-venv contract in Chapter 05.
Client and scroll widths are equal at 1,425 and 375 pixels, and console
errors/warnings are both zero. The exact browser session, `127.0.0.1:4173`
server PID, and generated snapshot were finalized.

The last `npm run validate` attempt stopped at its first stage on formatting
differences in 20 concurrently edited computer/OS/toolchain/CPU/test files. None
belonged to the #92 owned selection. Keep Issue #92 open until the current
shared repository-wide full gate is rerun and passes.
