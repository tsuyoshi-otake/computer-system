# Issue #61 — CS C 2.0 data model and calling ABI evidence

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/61

Status: complete and host/real-BDS/Web-Terminal-verified. The required browser
guest build/run uses Issue #99's isolated safe authentication fixture.

## Implemented boundary

- The `cs486-cc2` caller-cleanup ABI passes up to 32 physical words right to
  left, loads parameters from checked frame slots, preserves callee-owned
  registers, and returns one-word values in EAX or two-word values in EDX:EAX.
- Versioned object, executable, archive, debugger, Python-extension, and linker
  boundaries carry validated function signatures and retain legacy readers.
- The frontend implements scaled pointers, fixed multidimensional arrays,
  structs, unions, enums, typedefs, qualifiers, integer families, designated
  initializers, compound literals, bit-fields, globals,
  `.data`/`.bss`/`.rodata`, indirect calls, checked `goto`, file/local `static`,
  linkage, and bounded variadic calls.
- The default `cs-word32-v1` model retains 32-bit word characters. The additive
  `cs-byte8-v1` model supplies 8-bit char, 16-bit short, packed strings, natural
  little-endian aggregate layout, and exact byte-stream I/O without implicit
  cross-model conversion.
- Deterministic binary32/binary64 and the bounded guest `libm` surface are
  implemented by Issue #73 without host floating-point or host libc fallback.

## Explicit exclusions

There is no native x86/ELF/OMF compatibility, dynamic linker, unbounded varargs,
aggregate pass/return by value, unrestricted POSIX surface, host compiler/libc,
or implicit conversion between data models. Issue #64 and further game work are
excluded.

## Verification evidence

Verify on 2026-07-21: run the focused command recorded by Issue #58 and this
Issue's pointer, aggregate, global, call, linkage, varargs, data-model, IR,
linker, archive, and OS integration suites.

Expect: positive/boundary/reject cases pass; nested, recursive, cross-object,
indirect, and variadic calls restore the stack; invalid inputs preserve prior
outputs; compilation is deterministic; legacy artifacts remain readable.

Result: PASS, 18 files / 146 tests.

Verify on 2026-07-21: `rtk npm run test:mcp:bds` and `rtk npm run validate`.

Expect: the real BDS path has zero diagnostics and the complete repository gate
passes.

Result: PASS. BDS reached final state `idle` with zero failures/diagnostics; the
complete gate passed 284 files / 2,142 tests, 12 hosted-C payload checks, the
production pack, and all 16 Pages chapters.

## Real Web Terminal acceptance

Verify on 2026-07-21: use a fresh opt-in Issue #99 fixture and its exact MCP
debug-owned Web Terminal writer to create, compile, link, and run a recursive
argument/array/struct fixture through guest paths only.

Expect: output and exit status are correct, the session remains correlated to
the exact Computer, and no password, bearer token, handoff URL, or host fallback
appears.

Result: PASS. The authenticated `cs` fixture compiled the recursive/array/struct
source with `cc -c`, linked it with guest `ld`, and returned exit 0 with
`FIB_STRUCT=32`. The exact connected 80x25 writer displayed the result and
returned prompt. Diagnostics were zero; no password, bearer token, handoff URL,
or host fallback appeared, and the production secret-input rejection remained
unchanged.
