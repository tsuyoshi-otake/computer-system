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

Verify on 2026-07-25 on real BDS, in the isolated password-free acceptance world
through an MCP-owned Web Terminal session: run `reboot` from the guest shell,
wait for the CSBIOS POST surface, wait for the boundary surface, then type
`echo after-reboot-ok` on the same session.

Expect: The terminal is released by the power cycle, the boundary surface
carries no POST rows, and the same session accepts input again without a manual
reattach.

Result: PASS. The POST surface reported `lifecycle: "booting"` with rows
`CSBIOS Revision 1.1`, `CPU            : CS486DX2 at 66 MHz`, and
`Memory Test    : 1024 KB`. The next boundary surface contained only
`Computer System Linux 1.0`, the welcome and `man cs-linux` lines,
`Last login: … on tty1 (disconnect)`, and the prompt — no `CSBIOS` or
`Memory Test` row survived the boundary. `bds_send_tui_input` returned
`accepted` and the surface then showed the typed command followed by
`after-reboot-ok` and a fresh prompt, so Defect 2 does not reproduce on real
BDS.

Verify on 2026-07-25 on real BDS: read the cursor descriptor of the POST
surface.

Expect: No cursor is presented while CSBIOS owns the screen.

Result: PASS. The POST surface reported `cursor { blink: false, x: 1, y: 25 }`.
`renderTerminalRows` and `renderPlainTerminalRows` draw the cursor cell only
while `terminal.cursorBlink` is true, and the Web client hides its overlay
whenever `interaction.context === "unavailable"`, so neither surface presents a
cursor during POST.

Verify on 2026-07-25 on real BDS: open a second MCP Web Terminal session for the
same Computer while the first one is the writer, then type on the second one.

Expect: The new session becomes the writer, the previous session is demoted
rather than closed, and the shared Computer terminal is not finalized.

Result: PASS. Both session identifiers kept receiving `CS_WEB_TERMINAL`
snapshots after the handoff, `bds_verify_tui_screen` reported `verified: true`
with `exactDebugWriter: true` for the new session, and the typed command and its
output appeared in order. This is the writer-demotion path from
`src/application/terminal/CLAUDE.md`, not a `terminal_closed` finalization.

Verify: Real managed BDS/Web Terminal session on a Computer that requires a
CS-Linux password. Let a session reach a `terminal_closed` finalization,
reattach, and log in.

Expect: A cleared screen with `/etc/issue` and the `<computer-id> login:`
prompt, and login succeeds without a Computer power cycle.

Status: open for the authenticated boundary only. The acceptance world builds
with `requireLinuxLogin: false`, so it has no `login:` prompt to clear and
cannot carry this item; the real-BDS results above therefore cover the tty clear
at the OS boundary, the released-terminal input latch, and the POST cursor, but
not the password prompt itself. Entering a password is an operator action, so
this item stays with the user on the live world; record its date, engine
selection, and observed result before the Issue closes.

## Gap found by the real-BDS run, 2026-07-25

`setCursorBlink(false)` is called by the CSBIOS POST and halt renderers and by
the power boundary in `computerRuntime.ts`, and no OS path ever sets it back to
true. Only the guest `term.set_cursor_blink` syscall and the CS-ABI `applyFrame`
present path (which passes `blink: true`) can re-enable it.

- The Web Terminal is unaffected: `web/app.js` decides cursor visibility from
  `interaction.context === "unavailable"` and uses `blink` only to drive the CSS
  blink animation, so a freshly booted shell still shows a steady cell cursor.
- The in-world Bedrock display draws its cursor cell only while `cursorBlink` is
  true, so after a boot the in-world CS-Linux prompt presents no cursor until a
  CS-ABI program enables one. Observed on real BDS: the post-reboot prompt
  reported `blink: false` and stayed there across a completed command, while the
  same Computer reported `blink: true` at its prompt earlier in the session,
  after a CS-ABI foreground had exited.

This is not a regression of the reported symptom — `cursorBlinkValue` already
starts false, so a fresh Computer never presented an in-world cursor — but the
change does now reset the flag on every POST and power boundary. Deciding
whether the OS should assert cursor visibility when it takes an interactive
terminal was left open by that run; it is resolved by the section below.

## Gap closed, 2026-07-25: the OS owns the prompt cursor

Implemented and host-verified on the same day the gap was found. Cursor
visibility now has exactly two owners and no third one:

- CSBIOS POST, `clearCsBiosForOs`, both halt screens, and `failStopState` stop
  the cursor, because those screens accept no input.
- `writeTerminalPrompt` in `src/application/runtime/nativeModules.ts` takes it
  back. It is the only writer of an interactive OS prompt, shared by the native
  `shell.prompt()` event-loop op and by `abortLine`, `completeShellInput`, and
  `cancelTerminalInteraction` in `computerRuntime.ts`, and it already treats an
  empty `ShellSession.prompt()` as "a full-screen program owns the screen", so
  `vi`, the DOS editor, the pagers, and CS-ABI frames keep owning their own
  cursor through `term.set_cursor_blink` and `applyFrame`.

`Verify:`
`npx vitest run tests/computer/csBios.test.ts tests/runtime/nativeModules.test.ts`

`Expect:` a Computer powered on through the full CSBIOS sequence reports
`cursor.blink === false` at power-on and while `CSBIOS Revision 1.1` is on
screen, then `cursor.blink === true` once the guest waits for input with a shell
or `login:` prompt ending at the cursor cell; `writeTerminalPrompt` turns a
stopped cursor back on for a non-empty prompt and leaves it stopped for an empty
one.

`Result:` both assertions failed before the change (`expected false to be true`
at the two prompt cases) and pass after it.
`npm test -- tests/computer tests/os tests/runtime/nativeModules.test.ts tests/terminal`
reported 755 passed, including the three existing POST/halt `blink === false`
cases in `tests/computer/csBios.test.ts` and the two post-run halt cases in
`tests/computer/gracefulLifecycle.test.ts`, which now prove the halt path stops
a cursor that a prompt had really turned on.

`Verify:` `npx vitest run tests/computer/runtimeCredentials.test.ts`

`Expect:` the authenticated boundary keeps the cursor where its input lands.
`c-000218` reports `cursor { blink: true, x: <login prompt length + 1>, y: 2 }`
on the cleared post-disconnect tty, and `c-000219` reports the cursor
immediately after `Password: ` with `blink === true` while the descriptor is in
`secret` context.

`Result on 2026-07-25:` 22 tests passed. The re-armed getty writes its own
prompt through the same owner as the shell prompt, so the cleared boundary
presents one correctly placed cursor rather than a stale or misplaced one, and
masked input still shows where it lands.

Two side effects, both intended:

- A guest that hides the cursor with `term.set_cursor_blink(False)` and exits no
  longer leaves it hidden for the shell; the next prompt restores it.
- In the Web Terminal the prompt cursor now animates instead of standing steady,
  because `web/app.js` maps `blink` onto the `terminal-cell-cursor--blink` CSS
  class. That is what the existing stylesheet was written for, it stays disabled
  under `prefers-reduced-motion`, and cursor presence there is still decided by
  `interaction.context`, not by `blink`.

Not verified yet: the in-world Bedrock CRT. This needs one real-BDS or GDK check
that a booted Computer shows a cursor cell at its CS-Linux prompt on the block
face or integrated display. Host tests and the Web Terminal are not evidence for
the in-world renderer.

Partially blocked on 2026-07-25 by #112. The Computer that produced the original
report is now `crashed` with a full OS runtime journal and cannot boot at all,
so this item cannot be re-run on that specific machine until the rotating
journal lands. It can still be exercised on any bootable Computer, because the
cleared login boundary and the re-armed terminal are not machine specific. The
two defects are unrelated: #111 is the login-boundary clear and the interaction
latch, #112 is a capacity error in the persisted journal.

## Real-BDS cursor measurement, 2026-07-25

Recorded after redeploying the cursor-ownership change into the preserved
managed world with `bds_stop` followed by `bds_start({ resetWorld: false })`.
The restart rebuilt and reinstalled the packs, `CS_STORAGE_MIGRATION` reported
`state: "complete"` with zero migrated and zero missing Computers, and
`bds_status` reported `diagnostics: 0`.

- Verify: register the MCP debug writer for one placed Computer with
  `bds_open_web_terminal`, then read `bds_get_tui_screen` while its CS-Linux
  getty is at the login prompt.
- Expect: the validated text surface reports `cursor.blink === true` with the
  cursor in the cell immediately after `<computer-id> login: `.
- Result: passed. The surface reported `kind: "text"`, `width: 80`,
  `height: 25`, and `cursor: { blink: true, x: 17, y: 4 }`. The MCP surface
  cursor is 1-based, so row 4 is the `<computer-id> login: ` row and column 17
  is the cell right after its trailing space. The same read on the previous
  build reported `blink: false`.

This measures the snapshot the deployed Behavior Pack publishes inside a real
BDS world, which is the exact value the in-world viewport requires before it
draws a cursor cell. It is not evidence that the Minecraft client paints that
cell: the block face and integrated display are rendered by the client, so the
remaining item below still needs one human look in GDK.

## Operating note: gracefully restarting the managed MCP companion

Recorded 2026-07-25, and preferred over the termination procedure below. The
managed MCP companion owns BDS through its own stdio, so the supported way to
redeploy packs into the preserved interactive world is the MCP surface itself:
call `bds_stop`, which stops BDS gracefully and waits for finalization, then
`bds_start({ resetWorld: false })`, which rebuilds the packs, reinstalls them
into the existing world, and restarts. The companion process stays alive, so its
listener port, published origin, CPU-engine selection, and runtime-worker pool
survive the restart. On a preserved-world restart, wait for the
`CS_STORAGE_MIGRATION` record with `state: "complete"` before any probe.

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
