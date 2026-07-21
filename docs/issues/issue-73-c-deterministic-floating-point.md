# Issue #73: deterministic CS C floating point and libm

GitHub: [#73](https://github.com/tsuyoshi-otake/computer-system/issues/73)

Status: implemented and verified. Focused host, real-BDS, real-Chrome manual,
and complete `npm run validate` gates pass. NetHack Issue #64 is preserved
unchanged and is excluded from this issue's implementation and progress.

## Implemented contract

- `float` is IEEE-754 binary32 and `double` is IEEE-754 binary64. `long double`
  is an explicit alias of `double`; no extended precision is claimed. Both are
  little endian and four-byte aligned. In `cs-word32-v1`, `sizeof(float)==1` and
  `sizeof(double)==2` word units. In `cs-byte8-v1`, their sizes are four and
  eight bytes.
- Current `CS486OBJ` v4 and `CS486` v5 function signatures admit `f32` and
  `f64`. Binary32 occupies one physical word; binary64 occupies two low-word-
  first words and returns in EDX:EAX. CSIR records the source signature beside
  its lowered words. Legacy object/executable readers remain integer-only and
  reject floating signatures.
- Decimal and hexadecimal literals, suffixes, casts, promotions, usual
  arithmetic conversions, parameters/returns, indirect calls, globals,
  aggregates, spills, and constant expressions use one bounded frontend
  contract. Variadic `float` values default-promote to `double` and consume two
  physical words.
- `deterministicFloat.ts` implements integer/rational binary32/binary64 parsing,
  round-to-nearest ties-to-even packing, add/subtract/multiply/divide/remainder,
  comparisons, integer and format conversion, signed zero, subnormal values,
  infinities, canonical quiet NaNs, classification, decomposition, scaling,
  integral helpers, and square root. The authoritative result does not use host
  floating arithmetic, host libm, locale, WebAssembly, or native addons.
- Internal `cs.fp.f32.*` and `cs.fp.f64.*` operations execute synchronously in
  the admitted CS486 process. Representative unary, arithmetic, division,
  formatting, and square-root work has a fixed modeled cost; guest-memory writes
  also pass through the active CPU memory hierarchy. Status is local to the
  process and records invalid, divide-by-zero, overflow, underflow, and inexact
  results.
- Rootfs v19 supplies `<float.h>`, `<math.h>`, guest source under
  `/usr/src/cs-libm`, and model-matched `libm.csa` archives. Rootfs v18 remains
  the immutable pre-floating dual-data-model image. libc `%f` defaults to six
  fractional places, accepts at most 18, uses the deterministic binary64
  formatter, and never calls host formatting.
- Initial libm includes `fabs`, `copysign`, `floor`, `ceil`, `trunc`, `round`,
  `fmod`, `sqrt`, `ldexp`, `frexp`, `modf`, `isnan`, `isinf`, `isfinite`, and
  `signbit`, including appropriate `f` variants. Invalid results set `EDOM`;
  divide-by-zero, overflow, or underflow set `ERANGE`.
- The twelve immutable hosted-C archive payloads are generated ahead of time and
  checked into the pack source. Production BDS startup only validates and mounts
  those serialized payloads; it never recompiles or recompresses the guest
  libraries at module evaluation. `npm run check:hosted-c` rejects stale output.
- Guest filesystem, archive, Git-like, and floppy paths use the deterministic
  UTF-8 domain primitives rather than the Node/browser-only `TextEncoder` or
  `TextDecoder` globals. Shared base-image file facts are computed once and
  cached by immutable file identity, so each Computer attachment does not rescan
  the multi-megabyte rootfs.

## Explicit exclusions

The first profile does not expose trigonometric, inverse-trigonometric,
exponential, logarithmic, `pow`, complex, decimal floating-point, mutable
rounding modes, `<fenv.h>`, x87/native FPU ABI, SIMD, fast-math reassociation,
GPU, dynamic linking, or arbitrary precision. `sin`, `cos`, `tan`, `atan2`,
`exp`, `log`, and `pow` have no declaration and fail explicitly; they must not
appear until a separate bounded approximation and golden-vector contract is
implemented.

## Acceptance evidence

Verify:
`rtk npm run test -- --run tests/runtime/deterministicFloat.test.ts tests/runtime/cs486FloatRuntime.test.ts tests/runtime/cs486CFloat.test.ts tests/runtime/cs486Ir.test.ts`

Expect: representation-level vectors cover normal/subnormal values, signed zero,
infinities, canonical NaNs, ties-to-even, overflow/underflow, casts,
comparisons, arithmetic, ABI metadata, parameters/returns, globals, aggregates,
callbacks, f64 spills, current/legacy validation, all CPU-model cycle charges,
faults, and explicit termination. Compile-twice objects are identical.

Current result (2026-07-20): 30 tests passed in the combined focused gate.

Verify:
`rtk npm run test -- --run tests/runtime/cs486CLibm.test.ts tests/runtime/cs486CHostedLibcPosix.test.ts tests/os/cByteProfile.test.ts tests/os/cFloatPortability.test.ts`

Expect: every installed libm function and special-value/status boundary passes
in both data models; float varargs and bounded `%f` render exactly; `-lm`
selects the matching archive; omitted transcendental APIs fail; and the guest
builds and runs the callback/array/struct geometry archive and mixed numeric CLI
twice with identical objects/archives and observable CPU/memory statistics.

Current result (2026-07-20): 17 tests passed in the combined focused gate.

Verify:
`rtk npm run test -- --run tests/os/osStorageImage.test.ts tests/os/toolchain.test.ts tests/runtime/pythonCs486ObjectV2.test.ts`

Expect: rootfs v18 has no floating headers/library/formatting and migrates its
overlay to v19; v19 exposes the new artifacts; `nm`/`objdump` display floating
signatures; mismatches create no output; and the integer-only Python extension
boundary rejects a floating export.

Current result (2026-07-20): 46 tests passed in the combined focused gate; the
three-page manual suite also passed in the same verification cycle.

Verify: `rtk npm run test:mcp:bds`

Expect: the real BDS guest build/run path uses the same current rootfs and CS486
process with no native or host-libm fallback.

Current result (2026-07-20): PASS in an isolated real BDS workdir on UDP ports
19158/19159 with the companion on 18084. The 39.8-second suite reported
`linux_authentication/PASS`, `linux_make/PASS`, `linux_git/PASS`, zero failures,
zero diagnostics, and final state `idle`. A second preserved-world run on
19162/19163 also passed with zero diagnostics.

Verify: build the 16-chapter Pages artifact, serve it on loopback, and open
`/manual/#chapter-os-toolchains` in real Chrome.

Expect: section `12.3 Deterministic floating point and libm`, its `<math.h>`
example, binary32/binary64 contract, `-lm` requirement, `%f` bound, and explicit
exclusions are visible with no browser warning or error.

Current result (2026-07-20): PASS in real Chrome against the generated Pages
artifact. The section, example, contract, and exclusions were present; browser
warning/error logs were empty. Issue #73 does not require a separate live Web
Terminal numeric-CLI run; the guest executable path is covered by the real-BDS
suite and the two-data-model host portability fixture above.

Verify: `rtk npm run validate`

Expect: formatting, ESLint, TypeScript, all Vitest suites, the production pack,
and all 16 generated Pages chapters pass with zero diagnostics.

Current result (2026-07-20): PASS. Prettier, ESLint, TypeScript, 275 Vitest
files / 2,066 tests, the 12-payload hosted-C archive check, production Bedrock
pack, and all 16 Pages chapters completed successfully.
