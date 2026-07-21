# Issue #72: CS C byte interoperability

GitHub: [#72](https://github.com/tsuyoshi-otake/computer-system/issues/72)

Status: implemented and verified. Focused host, real-BDS, Web, complete
`npm run validate`, production pack, and 16-chapter Pages gates pass. NetHack
work from #64 is preserved but is not part of this issue's completion or
progress.

## Implemented boundary

- `cs-word32-v1` remains the default and the implied identity for legacy
  `CS486OBJ` v1-v3 and `CS486` v1-v4. `cs-byte8-v1` is additive. Current writers
  emit model-declared `CS486OBJ` v4, `CS486` v5, and `CS486AR` v2.
- Objects, archives, executables, CSIR, compiler built-ins, linker inputs,
  debugger/`nm`/`objdump`, DOS listings/maps, Make fingerprints, Python
  extension admission, and installed libraries carry or report the model. Mixed
  models reject before layout or output replacement.
- The shared CPU supports validated signed/unsigned 8-bit and 16-bit loads plus
  8-bit and 16-bit stores. Range, width, and halfword alignment are checked
  before mutation. CS386SX and CS486DX/DX2 use their existing deterministic
  timing/cache/bus owner; no host time enters guest timing.
- `cc -mbyte8` and `-mdata-model=cs-byte8-v1` select 8-bit char, 16-bit short,
  32-bit int/long/pointers, and 64-bit long long. `-mword32` explicitly selects
  the default. Byte pointer stride, natural aggregate padding, little-endian
  unions, promotion, assignment/call/return truncation, signed extension, packed
  initialized data, and NUL strings derive from that identity.
- Historical rootfs v18 supplies model-aware `<limits.h>`/`<stdint.h>`, explicit
  `<cs/byte.h>` word-profile packing helpers, and separate
  `/usr/lib/{cs-word32-v1,cs-byte8-v1}` libc/libcurses archives. Rootfs v17 is
  retained as an immutable word-only image.
- CS ABI 1.0 startup strings and stream I/O are packed bytes for byte-profile v5
  executables and word characters for the word profile. Byte files use the
  credentialed binary filesystem methods, bounded block-I/O admission, and exact
  byte offsets with no UTF-8 or newline conversion.

## Contract and exclusions

`cs-byte8-v1` is little endian. `sizeof(char)==1`, `sizeof(short)==2`,
`sizeof(int)==sizeof(long)==sizeof(void *)==4`, and `sizeof(long long)==8`.
Signed char and short use two's-complement sign extension; unsigned stores and
assignments truncate modulo 2^8 or 2^16. Halfword CPU accesses require two-byte
alignment. Structs use natural member alignment capped by the member
requirements implemented by the frontend; unions use their largest member size
and alignment.

There is no implicit object, pointer, string, `FILE`, archive, or Python
extension conversion between models. `<cs/byte.h>` deliberately stores four
octets in each word-profile `unsigned int`; it does not make word-profile
`unsigned char *` source-compatible. Native x86/ELF/OMF, JIT, self-modifying
code, host pointers/files, sockets, floating point, and unbounded buffers remain
out of scope. Floating point is tracked separately by #73.

## Acceptance evidence

Verify: `npm run test -- --run tests/runtime/cs486ByteDataModel.test.ts`

Expect: all three CPU profiles round-trip 0..255, narrow signed/unsigned
operations and profile timing execute, rejected unaligned/out-of-range stores
retain prior bytes, current identities survive object/archive/link/debug, mixed
models reject, and paired C layouts including unions/callbacks/truncation pass.

Current result (2026-07-20): 14 tests passed.

Verify:
`npm run test -- --run tests/runtime/csAbiByteProfile.test.ts tests/runtime/cs486CByteFixtures.test.ts tests/runtime/cs486CHostedHeaders.test.ts`

Expect: all 256 filesystem bytes survive write/read and cold snapshot restore;
an invalid range creates no partial file; non-byte startup strings reject;
CRC32, bounded binary-record parsing, and preflighted RLE decompression pass;
malformed, truncated, and bomb/capacity inputs leave output unchanged; word/byte
headers and the explicit packing shim match their declared limits.

Current result (2026-07-20): 7 tests passed.

Verify:
`npm run test -- --run tests/os/cByteProfile.test.ts tests/os/osStorageImage.test.ts tests/computer/csAbiRuntime.test.ts`

Expect: the Linux driver selects the model library, shell inspection reports
identity, mixed output is absent, v17 restores without byte artifacts and
migrates to the current v19 image without losing its overlay, and both
executable versions reach the hosted lifecycle owner.

Current result (2026-07-20): this command is included in the passing combined
11-file / 92-test focused gate.

Verify: `npm run test:mcp:bds`

Expect: the real BDS guest execution gate passes with no hidden native fallback.

Current result (2026-07-20): PASS. The isolated real-BDS suite completed its
authentication, Make, and Git probes with zero failures, zero diagnostics, and
final state `idle`.

Verify: `npm run validate`

Expect: formatting, ESLint, TypeScript, Vitest, Bedrock pack build, and the
16-chapter Pages build all pass with zero diagnostics.

Current result (2026-07-20): PASS. Prettier, ESLint, TypeScript, 275 Vitest
files / 2,066 tests, hosted-C archive freshness, the production Bedrock pack,
and all 16 Pages chapters completed successfully.
