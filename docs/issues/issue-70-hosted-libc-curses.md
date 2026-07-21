# Issue #70 — Hosted libc and libcs-curses evidence

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/70

Status: complete and host/real-BDS/Web-Terminal-verified. Issue #71 is complete,
and the browser curses acceptance uses Issue #99's isolated safe authenticated
fixture.

## Scope

Rootfs v17 expands the CS-Linux hosted C profile with a bounded libc/POSIX
surface and a guest-buildable character-terminal library. The preserved NetHack
prototype is only a compatibility consumer of the shared toolchain; Issue #64
and all further NetHack game implementation are excluded.

## Implemented contract

- CS ABI selectors 16–25 expose injected wall-clock time, process cwd,
  mkdir/rmdir/access, directory iteration, and extended metadata. These calls
  use guest credentials and the block-I/O admission owner. Wall time remains
  independent of deterministic guest CPU ticks.
- Directory opening takes one bounded O(N) snapshot of at most 256 entries;
  subsequent reads are O(1). Each process owns at most eight directory
  descriptors, and finalization clears them with all other process state.
- Exclusive creation is transactional and non-truncating. Temporary-file,
  rename, removal, seek, stat, stdout/stderr, and flush paths preserve the
  admission-before-mutation rule and structured errno results.
- The hosted library supplies bounded string conversion, deterministic O(N log
  N) heapsort `qsort`, O(log N) `bsearch`, 16 `atexit` handlers,
  getopt/getopt_long, cwd/directory/stat/temp-file wrappers, wall-clock and tick
  time, synchronous guest `signal`/`raise`, and fixed-format printing.
- The linker bootstrap runs registered exit handlers after a normal `main`
  return while preserving its result. Runtime-owned fault, signal, close, and
  shutdown finalization remain idempotent.
- Because the CS C ABI does not yet pass or return aggregates by value, `div`
  writes through `div_t *` and `vsnprintf` accepts `va_list *`. Asynchronous
  custom host-signal delivery is not claimed; handlers are invoked only by
  synchronous guest `raise`.
- `/usr/src/libcs-curses/curses.c` implements a fixed 80×25 screen, `stdscr`
  plus seven allocated windows, 16 color pairs, bounded formatting, blocking key
  input, and one atomic terminal-frame presentation per refresh. Capacity
  failures are explicit.
- Rootfs v17 publishes the new headers and sources. Rootfs v16 is retained as an
  immutable historical payload and migration base.

## Verification rubric

### ABI and hosted programs

Verify:

```powershell
rtk npm run test -- --run tests/runtime/csAbi.test.ts tests/runtime/cs486CHostedLibcPosix.test.ts
```

Expect: cwd and directory traversal, metadata, wall/tick separation, exclusive
creation, errno paths, descriptor and snapshot capacity-plus-one rejection,
callbacks, conversion, sorting/searching, getopt, signal/raise, atexit,
formatted output, curses windows/colors/refresh, and key input pass. Compiling
the guest libc and curses sources twice produces byte-identical objects.

### Historical image and boot compatibility

Verify:

```powershell
rtk npm run test -- --run tests/os/osStorageImage.test.ts tests/os/linuxBoot.test.ts
```

Expect: rootfs v17 contains the new headers and sources, remains within the
declared disk profile, v16 stays byte-stable and migrates overlays, and Linux
boots the current image.

### Toolchain and external path

Verify: build a guest program through the completed Issue #71 archive/driver
path, then run `rtk npm run test:mcp:bds` and exercise the same program in the
real Chrome Web Terminal.

Expect: archive selection links only demanded members, the program builds and
runs without host fallback, curses refresh/key input is observable, and BDS
reports zero diagnostics.

### Repository gate

Verify: `rtk npm run validate`.

Expect: formatting, ESLint, TypeScript, all Vitest suites, production pack
build, and all 16 generated Pages chapters pass.

## Current results

Verify on 2026-07-21:
`rtk npm run test -- --run tests/runtime/cs486CHostedHeaders.test.ts tests/runtime/cs486CHostedLibcPosix.test.ts tests/runtime/cs486CHostedPortabilityIntegration.test.ts tests/runtime/cs486CLibm.test.ts tests/os/cByteProfile.test.ts tests/os/cFloatPortability.test.ts tests/os/linuxBoot.test.ts tests/os/osStorageImage.test.ts tests/os/staticArchiveToolchain.test.ts`.

Expect: hosted headers/libc/POSIX/curses, both data models, libm, historical
images, current boot, and archive selection pass with deterministic guest
objects and no host fallback.

Result: PASS, 9 files / 56 tests.

Verify on 2026-07-21: `rtk npm run test:mcp:bds` and `rtk npm run validate`.

Expect: real BDS has zero diagnostics and the complete gate including generated
hosted-C archives passes.

Result: PASS. BDS reported zero failures/diagnostics and final state `idle`; the
complete gate passed 284 files / 2,142 tests, all 12 hosted-C payloads, the
production pack, and all 16 Pages chapters.

Verify on 2026-07-21: in a fresh Issue #99 world, build the curses fixture
through the guest archive/driver path, present its fixed 80x25 frame in the
exact authenticated MCP debug-owned Web Terminal writer, deliver one bounded
key, and inspect BDS/Web session diagnostics and final state.

Expect: the frame and key result are observable, the program exits successfully,
no password/token/URL or host fallback appears, and browser diagnostics are
zero.

Result: PASS. Guest `cc /tmp/a.c -lcurses -o /tmp/a` completed in 63,877 modeled
cycles. The connected exact writer displayed `C_ACCEPT` in an 80x25 text
surface, accepted `q`, and returned the `cs` shell prompt. Diagnostics remained
zero and BDS stopped in `idle`. Secret-input rejection remained intact; no
password, token, handoff URL, or host fallback was recorded.
