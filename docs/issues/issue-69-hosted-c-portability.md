# Issue #69: Hosted C portability completion

## Implemented contract

- File-scope internal linkage, function-local static storage, block/file
  `extern`, and `const`/`volatile`/`restrict` diagnostics are represented in the
  typed frontend and object symbols.
- `_Bool`, `_Static_assert`, `alignof`, `__func__`, bounded `goto`, compound
  literals, designated initialization, unions, final flexible arrays, and
  deterministic word-profile bit-fields lower through validated CSIR.
- All signed/unsigned `char`, `short`, `int`, and `long` spellings use one
  32-bit word. `long long` and `unsigned long long` use two low-word-first
  words. Promotions, conversions, constants, wraparound, logical shift,
  comparison, multiply, divide, and modulo share the same 32/64-bit contract.
- CS486 function signatures admit `i32`, `i64`, `void`, and a canonical variadic
  flag. Two-word arguments consume two of the 32 physical argument words;
  two-word return values use EDX:EAX.
- Validated indirect calls admit only an exact executable function entry with a
  compatible signature. Null, data, middle-of-function, out-of-range, and
  mismatched targets fault before a return address is pushed.
- `<stdarg.h>` uses a hidden checked variable-word count. Guest-compiled
  `printf`, `fprintf`, and `snprintf` never read beyond that frame.
- The linker reserves its first data word so address zero remains a null pointer
  independently of deterministic object order.
- CS-Linux rootfs v16 publishes matching `<limits.h>`, `<stdint.h>`,
  `<stddef.h>`, `<stdbool.h>`, and `<stdarg.h>`. The v14 and v15 payloads remain
  independently registered, immutable historical images.

This is the CS word ABI. It does not claim native x86 structure, bit-field, ELF,
OMF, or byte-pointer compatibility.

## Verification rubric

### Language and aggregate semantics

Verify:

```powershell
npx vitest run tests/runtime/cs486CLinkage.test.ts tests/runtime/cs486CQualifiers.test.ts tests/runtime/cs486CCommonC11.test.ts tests/runtime/cs486CGoto.test.ts tests/runtime/cs486CAggregates.test.ts
```

Expect: internal/external ownership, qualifier diagnostics, every CFG terminal,
union/designator/flexible/compound layout, packed bit-field reads and writes,
and capacity-plus-one rejects pass deterministically.

### Integer and calling-convention semantics

Verify:

```powershell
npx vitest run tests/runtime/cs486CIntegers.test.ts tests/runtime/cs486CFunctionPointers.test.ts tests/runtime/cs486CVarargs.test.ts tests/runtime/cs486IndirectCall.test.ts tests/runtime/cs486IrIndirectCall.test.ts
```

Expect: 32/64-bit boundary vectors, enum selection, EDX:EAX results, exact
function-pointer signatures, hidden variadic counts, and corrupted indirect
targets all reach the expected observable result or fault.

### Multi-file hosted library

Verify:

```powershell
npx vitest run tests/runtime/cs486CHostedPortabilityIntegration.test.ts tests/runtime/cs486CHostedHeaders.test.ts tests/runtime/csAbi.test.ts
```

Expect: a multi-file library combines same-named internal helpers, static local
state, unsigned wrap, bit-fields, a designated aggregate, `goto` cleanup, a
64-bit counter, a callback table, and guest `snprintf`; compile-twice objects
and link-twice executables are byte-for-byte equal and return 42.

### Linker and rootfs compatibility

Verify:

```powershell
npx vitest run tests/runtime/cs486AssemblerV2.test.ts tests/runtime/cs486Linker.test.ts tests/runtime/cs486Debugger.test.ts tests/runtime/cs486Ir.test.ts tests/os/osStorageImage.test.ts tests/os/linuxBoot.test.ts
```

Expect: legacy v1/v2 reads remain valid, i64/variadic v3 metadata validates, the
first real data address is nonzero, rootfs v14/v15 remain immutable, v16
migration preserves overlays, and the current headers match the frontend.

Result on 2026-07-20: the combined focused gate passed 136 tests with 0
failures. The integration-only gate passed 1 test with 0 failures. The Pages
manual gate passed 26 tests and the Web gate passed 101 tests, both with 0
failures.

### Repository gate

Verify:

```powershell
npm run validate
```

Expect: formatting, ESLint, TypeScript, all Vitest suites, the Bedrock pack, and
the 16-chapter Pages build pass.

Result on 2026-07-20: PASS. The complete gate passed Prettier, ESLint,
TypeScript, 275 Vitest files / 2,066 tests, hosted-C archive freshness, the
production Bedrock pack, and all 16 Pages chapters.
