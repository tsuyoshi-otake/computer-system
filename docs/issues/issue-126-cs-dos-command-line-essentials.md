# Issue #126: CS-DOS command-line essentials

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/126>

Status: implemented and host-verified. The isolated real-BDS integration smoke
passed on 2026-08-09. A targeted writer-owned Web Terminal/GDK interaction pass
for these new commands remains to be recorded; this issue therefore remains
open.

Dependencies: #12 (guest OS/toolchain), #25 (CS-DOS workflow), #31 (guest
capacity), and #34 (DOS memory/state).

## Implemented boundary

- CS-DOS now provides bounded, CRLF/DOS-diagnostic `FIND`, `SORT`, `FC`, and
  `COMP` utilities through guest filesystem callbacks only. `FIND` accepts `/V`,
  `/C`, `/N`, and `/I`; `SORT` accepts `/R` and `/+n`; and comparison commands
  read only explicit guest files. Wildcard operands and native tools fail
  explicitly.
- `CHOICE` and `PAUSE` use the existing terminal interaction owner rather than
  accepting input through the host. CHOICE supports bounded `/C`, `/N`, and `/S`
  options, returns its one-based selection as `ERRORLEVEL`, and resumes a batch
  file exactly once. Ctrl+C ends an active prompt with status 130.
- The existing sequential guest-spool DOS pipe contract remains deliberately
  narrow: `|`, `<`, `>`, and `>>` work; Linux-style `2>`, `2>&1`, `|&`, `&>`,
  `LESS`, and native `COMMAND.COM` semantics are rejected before side effects.
- Utilities are installed as versioned guest capsules under `C:\\DOS`; deleting
  a capsule makes the command unavailable without making a host executable
  reachable. CS-DOS remains a bounded compatibility surface, not an MS-DOS
  binary emulator.

## Acceptance evidence

### C1 - Guest-only text and comparison work

Verify:
`npm exec vitest run tests/os/dosTextUtilities.test.ts tests/os/dosBatch.test.ts`

Expect: `TYPE LOG.TXT | FIND /I "ERROR"`, `FIND /C /V`, `SORT /R`, `FC`, and
`COMP` produce deterministic CRLF/status results, reject invalid or
capacity-plus-one requests, and never delegate to a host command or filesystem.

### C2 - Prompt and batch finalization

Verify:
`npm exec vitest run tests/os/dosPrompt.test.ts tests/os/shellSession.test.ts`

Expect: CHOICE accepts only the active prompt's valid key, batches resume once
through the matching `ERRORLEVEL` branch, and success, invalid input, Ctrl+C,
disconnect, shutdown, and capacity paths have one observable terminal outcome.

### C3 - Full host gate

Verify: `npm run validate`

Expect: formatting, ESLint, TypeScript, all Vitest tests, production Bedrock
pack build, and the 16-chapter Pages build pass. Observed on 2026-08-09 under
Node.js 24: 317 Vitest files / 2,715 tests passed; no repository test runner
survived.

### C4 - Real Bedrock integration boundary

Verify: `npm run test:mcp:bds`

Expect: the isolated MCP/BDS suite reaches its complete PASS record, reports no
diagnostics, and stops the server. Observed on 2026-08-09: PASS in 50.902 s,
zero diagnostics, and final state `idle`; no `bedrock_server.exe` survived.

## Remaining evidence

Run the CS-DOS sequence in `docs/manual-verification.md` through a real
writer-owned Web Terminal/GDK session before closing the issue. The release does
not claim native `.COM`/`.EXE` execution, timeout defaults (`CHOICE /T`),
unbounded wildcard scans, or Linux stderr-redirection syntax on DOS.
