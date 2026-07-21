# Issue #99 — MCP-safe authenticated CS-Linux acceptance fixture

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/99

Status: complete and host/real-BDS/Web-Terminal-verified.

## Implemented boundary

- `CS_ACCEPTANCE_FIXTURE=1` is a compile-time, opt-in build boundary. Production
  builds omit the fixture path and ordinary managed worlds cannot request it.
- `bds_start` accepts the fixture only with a fresh reset of the dedicated MCP
  work directory/world. Non-empty, non-fixture, missing-build-flag, malformed,
  stale, Player-owned, and secret-input paths fail closed.
- `bds_provision_acceptance_fixture` creates one bounded CS-Linux Computer and
  returns only its public Computer identity. It accepts no password or arbitrary
  secret input and does not return credentials, browser URLs, or tokens.
- Bedrock keeps Server source, exact Computer/session/writer correlation, normal
  authentication, and secret-input rejection. Setup, disconnect, timeout, server
  stop, and cleanup have explicit final owners.
- The Web companion and browser terminal accept the hosted `cs-abi` interaction
  context without treating an expected structured debug marker as a diagnostic.

## Verification evidence

Verify on 2026-07-21: run the focused acceptance-fixture, debug-session,
MCP-server, Web companion, and terminal-input tests, then
`rtk npm run validate`.

Expect: opt-in provisioning succeeds only for the dedicated fixture; ordinary,
Player-owned, stale, malformed, secret, disconnect, and cleanup paths fail
closed; formatting, lint, TypeScript, all tests, pack, and Pages gates pass.

Result: PASS. The complete gate passed 284 files / 2,142 tests, all 12 hosted-C
payload checks, the production Bedrock pack, and all 16 Pages chapters.

Verify on 2026-07-21: start a fresh dedicated real-BDS work directory with the
acceptance build, provision the fixture, confirm `whoami`, open the exact writer
with `bds_open_web_terminal`, exercise guest `cc`, `ld`, `run`, libcurses frame
presentation and one key, inspect diagnostics, then stop BDS.

Expect: the exact debug-owned writer authenticates as `cs`; guest-only builds
and runs succeed; the 80x25 frame and key are observable; no password, token,
handoff URL, host compiler, or native fallback appears; diagnostics are zero;
and BDS reaches `idle`.

Result: PASS. The fresh fixture Computer returned `cs`; the recursive
array/struct program produced `FIB_STRUCT=32`; the libcurses program displayed
`C_ACCEPT`, accepted `q`, and returned the shell prompt. The exact writer stayed
connected, diagnostics remained zero, and BDS stopped in `idle`.

Verify on 2026-07-21: `rtk npm run test:mcp:bds`.

Expect: the standard non-fixture real-BDS path remains unchanged, reports no
diagnostics, and reaches its explicit terminal state.

Result: PASS. Suite, authentication, Make, and Git probes passed with zero
failures/diagnostics and final state `idle`.

## Explicit exclusions

The fixture is not a production login bypass, does not automate or expose
password entry, does not accept Player-owned writers, and does not enable
arbitrary host commands, host files, host compilers, native execution, or
NetHack implementation.
