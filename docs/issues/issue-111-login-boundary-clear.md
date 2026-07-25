# Issue #111: CS-Linux login-boundary tty clear and released-terminal input

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/111

Status: implemented and host-verified. The real managed BDS/Web Terminal
acceptance item below is still open, so the GitHub Issue stays open. Neither
defect is a regression from `v0.1.0-alpha.9`; both are long standing.

## Reported symptom

Reported from a live managed Web Terminal session on `v0.1.0-alpha.9` with the
default `typescript` CPU engine: while an authenticated `cs` shell was on
screen, the `<computer-id> login:` prompt appeared without the screen being
cleared, and from that moment no input was accepted. A Computer power cycle was
the only escape, after which the bookmark reconnect form was shown.

One trigger, two independent defects: a `terminal_closed` finalization reaching
an authenticated CS-Linux shell.

## Defect 1: the tty was not cleared at the authentication boundary

`agetty` clears the tty before writing `/etc/issue` and the login prompt
(`--noclear` is what disables it). Neither CS-Linux logout path cleared, so
`<computer-id> login:` was appended under the previous session's output. Beyond
fidelity this is a disclosure across the CS-Linux authentication boundary: every
command and every byte of output from the previous authenticated session stayed
readable to whoever reached the Computer next, in game on the built-in CRT or
from the next Web session.

## Defect 2: the released terminal never became interactive again

`ShellSession.disconnected` was one flag doing two unrelated jobs: the
idempotency latch for logout finalization, and the state that forces
`terminalInteraction()` to report `context: "unavailable"`, `inputMode: "none"`,
`ctrlCAction: "none"`. It was cleared only as a side effect of an actual guest
input event, and nothing re-armed it. `web/app.js` sets `commandInput.readOnly`
exactly when `inputMode === "none"`, `webTerminalBridge.handleInput`
independently rejects a `line` submission with `input_mode_changed` while
`inputMode !== "line"`, and the bridge attach path queues no guest event, so a
fresh session could not break the tie either. The result was a live-looking
`login:` prompt that could not be typed into and did not self-recover.

## Implemented boundary

- `ShellSession.loginBoundaryScreen()` reports the getty lines a session returns
  to, or `undefined` when there is no login boundary. A login-disabled
  development session and CS-DOS return `undefined`, so their screens are
  preserved.
- `ComputerRuntime.finalizeTerminalDisconnect` clears the tty through the shared
  `resetTerminalScreen` helper only when `loginBoundaryScreen()` is present,
  then writes the disconnect warnings and `/etc/issue`. It remains the single
  `terminal_closed` security-finalization owner.
- `ShellSession.executeSessionLogout` returns `resetTerminal: true` on the full
  logout, reusing the existing `resetTerminal`/`action: "clear"` mechanism
  rather than adding a second clear path.
- `resetTerminalScreen` in `nativeModules.ts` is now the one implementation of
  "clear to default colors and home the cursor"; the previously duplicated
  inline clears in `executeShellOperation`, `banner`, and the `ComputerRuntime`
  `keys` branch call it.
- `ShellSession.armTerminalSession()` separates the reported interaction state
  from the logout latch, and the native `shell.prompt()` operation calls it. The
  guest event loop therefore re-arms the tty at the exact point it draws its
  next prompt, which also covers the `systemResumeQueued` branch of
  `finalizeTerminalDisconnect` that never queues `terminal_closed` to the guest.
  `disconnected` is now mutated in exactly two places: `disconnect()` and
  `armTerminalSession()`.

## Relationship to #108

#108 is a different root cause in the same area: a raw `shell.prompt()` write
inheriting a mid-line cursor from a `keys`/`mouse`/`disconnect` operation that
printed nothing. Clearing the tty removes the concatenation on the logout path
as a side effect, but #108's `keys` and `mouse` paths stay open and #108 keeps
its own scope.

## Acceptance

Verify: `npm exec vitest run tests/computer/runtimeCredentials.test.ts`.

Expect: `c-000218` proves the previous command and its output are absent after
`terminal_closed` and that the screen starts with `/etc/issue` then
`<computer-id> login:`; `c-000219` proves the descriptor returns to
`context: "login"`, `inputMode: "line"` and that username plus password
authenticate on the released terminal; `c-000220` proves the guest `exit` path
clears; `c-000221` proves a login-disabled session's screen is preserved.

Result on 2026-07-25: 1 file and 22 tests passed, including the four cases
above.

Verify:
`npm exec vitest run tests/computer tests/os tests/terminal tests/runtime tests/bedrock tests/editor`.

Expect: The shell, terminal-writer, credential, OS-presence, and adapter suites
that share the clear and interaction paths pass.

Result on 2026-07-25: 213 test files and 1,855 tests passed in 46.08s.

Verify: `npm run validate`.

Expect: Formatting, lint, TypeScript, all host tests, the Bedrock pack build,
and the 16-chapter Pages build pass.

Result on 2026-07-25: exit code 0. 310 test files and 2,565 tests passed in
49.96s; the Bedrock pack and 16-chapter Pages builds completed.

Verify: Real managed BDS/Web Terminal session. Let a session reach a
`terminal_closed` finalization, reattach, and type.

Expect: A cleared screen with `/etc/issue` and the login prompt, and login
succeeds without a Computer power cycle.

Status: open. Host tests are not evidence of Web Terminal behavior; this item
must be recorded with its date, engine selection, and observed result before the
Issue closes.
