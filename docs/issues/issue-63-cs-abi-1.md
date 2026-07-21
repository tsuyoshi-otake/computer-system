# Issue #63 — CS ABI 1.0 completion evidence

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/63

Status: complete and host/real-BDS/Web-Terminal-verified. The browser acceptance
path uses Issue #99's isolated safe authenticated fixture.

## Scope

CS ABI 1.0 is the hosted foreground-process boundary for version-4 CS486
executables on CS-Linux. It does not grant host execution, host filesystem or
environment access, background/DOS/debugger syscalls, or any NetHack-specific
behavior. The preserved NetHack prototype and Issue #64 are frozen and excluded
from this completion evidence.

## Implemented contract

- `prepareCsAbiStartup` validates `main(void)` or `main(int, char **)`, copies a
  capped immutable `argv`, environment, cwd, uid/gid, heap description, and
  startup header into admitted guest words, and rejects the whole launch before
  PID/RAM admission when a count or byte ceiling is exceeded.
- `ComputerRuntime` resolves guest PATH, captures credentials and an allowlisted
  guest environment, installs the startup image, and owns one long-lived,
  tick-sliced hosted foreground process. Normal return, `exit`, signal, terminal
  close, runtime stop, and fault converge on the same idempotent
  descriptor/wait/FIFO/RAM finalizer.
- CS ABI selectors provide terminal size/frame presentation, bounded key poll
  and wait, deterministic clock/sleep, declared heap metadata, and credentialed
  word-stream file open/read/write/seek/stat/close/remove/rename. Guest
  pointer/count/frame validation happens before host mutation.
- Every filesystem atom is admitted through the block-I/O owner. Every frame or
  standard-stream terminal atom is admitted through the terminal owner.
  Rejection reports `EAGAIN` without changing guest result memory, descriptor
  position, terminal state, or filesystem state.
- Standard descriptors are separate from the eight-entry opened-file table.
  `stdout` is line-buffered, `stderr` is unbuffered, a zero-word write to
  descriptor 1 implements `fflush(stdout)`, and the combined admitted lifetime
  output ceiling is 64,000 guest words. Finalization flushes pending stdout
  once.
- Rootfs v16 ships guest-buildable CS syscall/terminal/filesystem headers and
  the bounded C headers/libc baseline. Rootfs v15 retains its exact pre-flush
  libc behavior and historical integer headers during migration.

## Verification rubric

Verify:
`rtk npm run test -- --run tests/runtime/csAbi.test.ts tests/computer/csAbiRuntime.test.ts tests/os/osStorageImage.test.ts`

Expect: startup limits, guest-built libc, errno, heap/free-list behavior,
stdio/flush ordering, selector bounds, frame atomicity, FIFO/waits, DAC, file
round-trips, deferred open/write/seek/stat/rename, capacity boundaries, normal
return, interrupt, terminal close, and runtime termination all pass; RAM and
owned state finalize once.

Verify: `rtk npm run test:web` and `rtk npm run test:pages`

Expect: canonical Web Terminal/manual behavior and all generated 16-chapter
Pages artifacts remain synchronized with the shipped ABI.

Verify: real Chrome Web Terminal guest flow plus `rtk npm run test:mcp:bds`.

Expect: a guest-authored program compiles and runs through `vi`, `cc`, `ld`, and
the exact foreground `run` path; arguments/environment, key wait, frame output,
heap, stdio flush, and atomic file replacement work with no host fallback and
real BDS reports zero diagnostics.

Verify: `rtk npm run validate`.

Expect: formatting, ESLint, TypeScript, Vitest, production pack build, and the
16-chapter Pages build all pass.

## Current results

Verify on 2026-07-21:
`rtk npm run test -- --run tests/runtime/csAbi.test.ts tests/runtime/csAbiByteProfile.test.ts tests/computer/csAbiRuntime.test.ts tests/computer/guestResourceAccounting.test.ts tests/os/osStorageImage.test.ts`.

Expect: both data-model startup paths, streams, heap, filesystem, waits,
capacity-plus-one, rollback, DAC, migration, and exactly-once cleanup pass.

Result: PASS, 5 files / 54 tests.

Verify on 2026-07-21: `rtk npm run test:mcp:bds` and `rtk npm run validate`.

Expect: real BDS reports no failures/diagnostics and the complete repository
gate passes.

Result: PASS. BDS ended in `idle`; the complete gate passed 284 files / 2,142
tests, hosted-C archive freshness, the production pack, and 16 Pages chapters.

Verify on 2026-07-21: provision Issue #99 in a fresh dedicated world, confirm
`whoami`, open the exact debug-owned Web Terminal writer, compile a guest
libcurses executable, present its frame, deliver one key, and observe process
exit plus prompt return. Retain the focused ABI suite for argv/environment,
stdio, heap, filesystem, rollback, and exactly-once cleanup.

Expect: all operations use the foreground hosted process, no host fallback or
secret disclosure occurs, browser diagnostics are zero, and cleanup remains
exactly once.

Result: PASS. The exact fixture authenticated as `cs`; guest `cc` linked
`-lcurses` in 63,877 modeled cycles. Web Terminal displayed `C_ACCEPT` in the
fixed 80x25 frame, accepted `q`, and returned to the same shell prompt.
Diagnostics were zero and BDS finalized in `idle`. No host fallback, secret,
token, or URL was recorded; ordinary secret terminal automation remains
prohibited.
