# Issue #123: Preserve submitted Web Terminal lines

- GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/123
- Status: implemented and verified with focused/full host gates, disposable
  real-BDS Computers, and the user's real Chrome session
- Date: 2026-07-30
- Scope: one shared CS-Linux/CS-DOS submitted-line presentation handoff from
  browser admission to authoritative terminal echo or screen replacement
- Dependencies: Issue #12 Web Terminal, Issue #29 terminal responsiveness, and
  Issue #40 fixed-cell cursor/input overlay
- Exclusions: NetHack gameplay changes, a second terminal buffer, secret-input
  retention, native GDK terminal fallback, and host command execution

## Implemented boundary

The browser retains one bounded, non-secret line at the cursor cell captured
before submission. HTTP/Bedrock admission does not clear it. A later terminal
frame completes the handoff only when the exact submitted characters occupy the
authoritative cells from that anchor, including right-edge wrapping, or when a
monotonic replacement marker proves that the guest cleared, scrolled, resized,
restored, or atomically applied a changed full-screen frame. Unrelated output
and stale snapshots leave the line in place.

The terminal revision and replacement marker cross the existing Bedrock snapshot
and companion validation boundary. They add no parallel screen or process truth.
An unchanged full-screen frame does not advance the marker, so the Issue #29
O(1) unchanged-snapshot fast path remains intact. The browser validates at most
200 by 100 cells and stores at most one 128-character line.

Accepted, rejected, echoed, replaced, empty-line advance, duplicate submission,
writer loss, session replacement, range loss, closure, protocol failure, and
reconnect paths all finalize explicitly. Passwords and other secret input never
enter the handoff controller, command history, or retained presentation.

## Acceptance evidence

1. Linux and DOS commands survive stale and unrelated frames until exact echo.

   `Verify:`
   `rtk npm test -- tests/tools/terminalInput.test.mjs tests/tools/webUi.test.mjs`

   `Expect:` `printf ISSUE123-LINUX` and `ECHO ISSUE123-DOS` remain retained
   across an unchanged frame and background output, then transfer once to the
   exact authoritative cells with no blank frame or duplicate overlay.

2. Destructive and full-screen guest operations take ownership atomically.

   `Verify:`
   `rtk npm test -- tests/tools/terminalInput.test.mjs tests/domains/terminal.test.ts`

   `Expect:` Linux `clear`, DOS `CLS`, Linux `nethack`, and DOS `EDIT` resolve
   on the replacement marker; ordinary writes do not advance it, invalid frames
   do not mutate it, and an identical frame preserves the unchanged-frame fast
   path.

3. The marker reaches every browser snapshot through one validated transport.

   `Verify:`
   `rtk npm test -- tests/bedrock/terminalAdapters.test.mjs tests/tools/webCompanionServer.test.mjs`

   `Expect:` the bridge publishes bounded `terminalRevision` and
   `replacementEpoch` fields, shared snapshot caching includes their state, and
   missing, negative, or unsafe values fail closed at the companion.

4. Secrets and every terminal lifecycle branch finalize without replay.

   `Verify:`
   `rtk npm test -- tests/tools/terminalInput.test.mjs tests/tools/webUi.test.mjs`

`Expect:` secret lines create no retained ticket and are cleared before the
admission result, including rejection; duplicate Enter is ignored; disconnect,
replacement, range loss, close, and reconnect discard the presentation without
resubmission.

5. The complete host and publication gates remain green.

   `Verify:` `rtk npm run validate`

   `Expect:` Prettier, ESLint, TypeScript, all Vitest suites, the production
   Bedrock pack, and all 16 canonical manual chapters pass.

6. A real Computer and Chrome display the shared Linux/DOS behavior.

   `Verify:` start the managed companion with `rtk npm run dev:bds:web`, attach
   real Chrome as writer, and follow the Issue #123 checklist in
   `docs/manual-verification.md`.

   `Expect:` submitted Linux and DOS lines never blink blank before echo or a
   real clear/full-screen takeover; NetHack and EDIT replace them atomically;
   secret input is never readable or retained; the page reports no browser
   exception or horizontal overflow.

## Verification results

- The six focused domain, bridge, companion, browser-state, UI, and manual
  suites passed 130 tests. `test:web` passed 9 files / 136 tests, `test:pages`
  passed 3 files / 31 tests, and the Pages build produced all 16 chapters.
- The complete `npm run validate` gate passed Prettier, ESLint, TypeScript, all
  313 Vitest files / 2,685 tests, the hosted-C and NetHack artifact checks, the
  vendor UI check, production Bedrock packs, and all 16 manual chapters.
- Two disposable real-BDS sessions exercised CS-Linux and CS-DOS through real
  Chrome. `printf ISSUE123-LINUX` and `ECHO ISSUE123-DOS` stayed visible until
  exact authoritative echo; `clear` and `CLS` stayed visible until their real
  clears; `nethack` and `EDIT C:\ISSUE.TXT` stayed visible until the full-screen
  owners replaced them. No command overlay or duplicate remained afterward.
- Rejected secret admission initially exposed a client ordering bug: the local
  password field was being cleared only after acceptance. The client now clears
  it before awaiting admission, and a real-Chrome rejection retest found the
  secret absent both immediately and after settlement.
- Both browser pages reported zero captured errors. At a 1,500 px viewport,
  root, body, and terminal client/scroll widths were equal, so there was no
  horizontal overflow. Both owned BDS sessions stopped at `idle` with zero BDS
  diagnostics and no surviving controller, BDS, or test-runner process.
