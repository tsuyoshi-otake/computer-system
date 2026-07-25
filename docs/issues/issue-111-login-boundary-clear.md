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

Verify: Restart the managed companion on the fixed build with the preserved
world, then compare the deployed world pack against the freshly built one:
`md5sum <world>/behavior_packs/computer_system_phase_0/scripts/main.js dist/behavior_pack/scripts/main.js`
plus `grep -c armTerminalSession` on the deployed pack and on a copy taken
before the restart.

Expect: Equal digests, the new symbols present only after the restart, the
preserved world reaching `CS_STORAGE_MIGRATION {"state":"complete"}`, and the
operator-selected engine reported by the pool and every compute worker.

Result on 2026-07-25 15:05 JST with `WEB_COMPANION_CPU_ENGINE=wasm-rust` and BDS
1.26.33: digests identical; the deployed pack contains `armTerminalSession` 7
times, `loginBoundaryScreen` twice, and `resetTerminalScreen` 5 times against 0
occurrences in the pre-restart copy, so the reported session had indeed been
running a build without this fix; migration reached `complete`; `state` is
`running` with `cpuEngine: "wasm-rust"` for the pool and both workers. The world
was preserved through `resetWorld: false` and a pre-restart copy was kept
outside the repository.

Verify: Real managed BDS/Web Terminal session. Let a session reach a
`terminal_closed` finalization, reattach, and type.

Expect: A cleared screen with `/etc/issue` and the login prompt, and login
succeeds without a Computer power cycle.

Status: open. Host tests and a deployment digest are not evidence of Web
Terminal behavior. The fixed build is now the live managed build, so this item
only needs a session on it; record its date, engine selection, and observed
result before the Issue closes.

Partially blocked on 2026-07-25 by #112. The Computer that produced the original
report is now `crashed` with a full OS runtime journal and cannot boot at all,
so this item cannot be re-run on that specific machine until the rotating
journal lands. It can still be exercised on any bootable Computer, because the
cleared login boundary and the re-armed terminal are not machine specific. The
two defects are unrelated: #111 is the login-boundary clear and the interaction
latch, #112 is a capacity error in the persisted journal.

## Operating note: stopping a managed companion on Windows

Recorded 2026-07-25. A companion started outside an interactive console cannot
be asked to shut down gracefully from another process on Windows.
`GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)` reports success after
`AttachConsole`, but the companion keeps running because it does not share the
sending process group, and `Stop-Process`/`uv_kill` is `TerminateProcess`, not a
deliverable `SIGINT`. The companion exposes no shutdown endpoint, which is
correct: `/api/*` is the session surface, not an administration surface.

What worked without risking the world: copy the world directory aside, terminate
only the companion process, and let BDS observe the closed stdin. BDS exited on
its own within three seconds and both ports were free afterwards, and the
preserved world reloaded and migrated cleanly on the next start. Prefer an
interactive console for a companion you expect to stop again; keep the copy
until the restarted world is verified.
