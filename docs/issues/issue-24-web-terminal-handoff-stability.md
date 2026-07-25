# Issue #24: Web Terminal handoff stability

- GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/24
- Status: implemented; full host validation, isolated real BDS, and real Chrome
  acceptance passed; physical GDK interaction acceptance remains pending
- Date: 2026-07-17
- Scope: duplicate interaction admission, exact-session handoff ownership,
  Bedrock activation acknowledgement, side-effect-free browser entry, bounded
  reconnect policy, range hysteresis, and Minecraft chat-noise removal
- Dependencies: Issue #4 Computer vertical slice and Issue #12 Web Terminal
- Exclusions: public deployment, native CustomForm fallback, and changes to
  guest terminal semantics

## Implemented boundary

The Bedrock bridge now admits one pending interaction per source, player, and
Computer in O(1), with a short accepted cooldown. The companion prepares a
viewer session, installs its activation waiter before relaying, and exposes the
handoff only after Bedrock emits an exact-session ready acknowledgement.
Rejection, supersession, expiry, relay failure, BDS stop, and activation timeout
all have an explicit finalization owner.

Four-digit handoff and session indexes delete only their exact owning session. A
stale final marker cannot remove a newer activation. `GET /p/NNNN` only
redirects to the stable application and has no authentication side effect; one
same-origin `POST /api/handoff` performs the exchange and writer takeover.
Reconnect work is single-flight, attempt- and lifetime-bounded, stops on
terminal authentication outcomes, and respects `Retry-After`.

Placed sessions exit range beyond 3.0 blocks and resume at 2.75 blocks or
nearer. The deadband retains the current state. Range state remains observable
in the Web UI and bridge transition marker, while steady transition notices are
removed from Minecraft chat.

## Acceptance evidence

1. Duplicate admission is bounded and source-aware.
   - Verify: `npm test -- tests/terminal/webTerminalRequestAdmission.test.ts`
   - Expect: identical interaction requests deduplicate without another user
     message; debug and interaction sources remain independent; capacity plus
     one rejects without a leaked pending entry.

2. Browser launch waits for Bedrock attachment and finalizes every branch.
   - Verify: `npm test -- tests/tools/webCompanionServer.test.mjs`
   - Expect: no launch or exchange occurs before ready; timeout sends one exact
     close; a late superseded final cannot remove the replacement handoff.

3. Browser entry does not expose or consume authentication on GET.
   - Verify:
     `npm test -- tests/tools/webSessionStore.test.mjs tests/tools/webCompanionServer.test.mjs`
   - Expect: repeated `GET /p/NNNN` returns the stable redirect without a token;
     the first valid POST succeeds, reuse fails, and failed takeover restores
     the unclaimed handoff.

4. Distance jitter does not flap or spam Minecraft chat.
   - Verify:
     `npm test -- tests/terminal/webTerminalRange.test.ts tests/bedrock/terminalAdapters.test.mjs`
   - Expect: 3.0 is initially and actively in range, exit occurs only above 3.0,
     resume occurs at or below 2.75, the deadband retains state, and the former
     paused/reconnected chat strings are absent.

5. Browser retry paths are bounded and terminal outcomes stop retry.
   - Verify: `npm test -- tests/tools/webUi.test.mjs`
   - Expect: the handoff flag is removed from history, replaced tabs stop,
     reconnect attempts cap at 64, and 429 handling reads `Retry-After`.

6. Repository host gate remains green.
   - Verify: `npm run validate`
   - Expect: formatting, ESLint, TypeScript, all Vitest suites, production pack
     build, and Pages build pass.

7. Native and browser behavior matches the host contracts.
   - Verify: start `npm run dev:bds:web`, interact rapidly with one eligible
     Computer in GDK, and inspect the existing Chrome session.
   - Expect: one admitted activation and one browser launch; no raw unauthorized
     JSON page; one connected writer tab; boundary movement produces one Web UI
     state transition without Minecraft chat spam.

8. A typed four-digit number reaches the session it names even after that
   Computer's activation was spent.
   - Verify:
     `npm test -- tests/tools/webCompanionServer.test.mjs tests/tools/webUi.test.mjs`
   - Expect: `POST /api/handoff` for an in-range session whose activation is
     already consumed answers `401 unauthorized`, the following
     `POST /api/reconnect` for the same number answers `200` with the same
     `sessionId`, `access: "in_range"`, and a rotated token that invalidates the
     superseded one; the client dialog treats `401` and `410` as a fall-through
     into the bounded reconnect exchange instead of a terminal failure.

## Residual verification

Criteria 1 through 6 are verified. For criterion 7, the isolated real-BDS pack
run and real-Chrome browser entry are verified. Rapid repeated interaction and
range-boundary movement in GDK remain manual acceptance items because the
existing interactive BDS world was intentionally left running and unmodified.

## Verification result (2026-07-17)

- Verify: `npm run validate`
  - Result: passed; 143 Vitest files and 884 tests passed, followed by the
    production Bedrock pack and all 16 Pages chapters.
- Verify: `npm run test:bds` with the known BDS 1.26.33.2 distribution and an
  isolated `BDS_WORKDIR`.
  - Result: passed twice with zero failures, including storage, authentication,
    serial, turtle, item, monitor, speaker, redstone, and runtime probes.
- Verify: navigate real Chrome to the fixture-backed `/p/6660` twice.
  - Result: the first navigation settled at `/?computer=6660` with the connected
    terminal UI; the consumed second navigation showed the activation prompt.
    Neither navigation exposed raw unauthorized JSON.
- Verify: rapid repeated Computer interaction and range-boundary movement in
  GDK.
  - Result: pending; use the criterion 7 procedure without resetting the
    currently running interactive world.

## Manual connection-code entry (2026-07-25)

The four-digit number is permanent, so it names two different things: an
unconsumed activation, and the session that already owns the number. `/p/NNNN`
and `/?computer=NNNN` already branched between the one-use exchange and the
bounded reconnect exchange, but the dialog's own manual-entry path only ever
implemented the one-use half. A browser holding no token therefore dead-ended on
`A valid browser terminal token is required.` while standing inside the 3-block
range, even though the 3-block rule exists only to stop a distant player from
reading the screen. `connectWithCode` now treats `401` and `410` as a
fall-through into the existing `reconnectWithCode`, which already owns range
waiting, bounded backoff, the 64-attempt and 30-minute caps, and the terminal
"activate the Computer in Minecraft" outcome.

- Verify: with the managed companion running and a placed in-range Computer
  whose activation was already consumed, clear the tab's `sessionStorage` and
  `localStorage`, load the companion root with no query, type that Computer's
  four-digit number, and press CONNECT.
  - Result: passed in real Chrome. Before the change the same sequence stopped
    at `A valid browser terminal token is required.`; after it the tab settles
    at `/?computer=NNNN`, the header reads `CONNECTED`, and the footer reads
    `CONTROL · LOGIN · 80 × 25 · WAITING_EVENT` over the live CS-Linux `login:`
    screen.
- Verify: the criterion 8 focused suites.
  - Result: passed; the added companion test measures the `401` handoff and
    `200` reconnect pair against a real HTTP server on an ephemeral port, and
    the added UI test locks the client fall-through and the dialog wording.

The dialog copy and canonical manual chapter 8.1 now state that the number
reconnects a terminal it already owns or claims a fresh activation, so the
documented behavior and the implemented behavior agree.
