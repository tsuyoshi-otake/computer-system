# Manual verification

## CSBIOS and display-profile host gate

Run the deterministic microarchitecture checks:

```powershell
npx vitest run tests/runtime/memoryHierarchy.test.ts tests/runtime/cs486.test.ts
```

`Expect:` CS386SX odd dwords add one 16-bit bus transfer; CS486 repeated
16-byte-line access produces L1 hits; DX2 can hit its external L2 after a
four-way L1 eviction; taken branches record pipeline flushes; every new process
starts with cold caches.

Run before attempting live graphics work:

```powershell
npm run test -- --run tests/domains/display.test.ts tests/computer/hardwareProfiles.test.ts tests/os/systemBoot.test.ts
```

- `Verify:` Inspect the focused test result. `Expect:` Portable has 256 KiB VRAM
  and rejects 640x480x8; both desktops have 512 KiB and accept it; no guest mode
  exceeds 640x480.
- `Verify:` Power-on assertions run before the first runtime tick. `Expect:` An
  80x25 CSBIOS frame reports the actual CPU, RAM, panel, and VRAM profile.
- `Verify:` Advance one runtime tick for DOS and Linux. `Expect:` POST is
  cleared exactly once. CS-DOS shows its identity, a blank line, and `C:\>`;
  CS-Linux shows its identity, a blank line, and the password or shell prompt.
  Neither profile shows a tty label or startup shell banner.
- `Verify:` Inspect a saved Computer snapshot. `Expect:` It contains a compact
  `displayProfileId` and no VRAM, framebuffer, dirty-tile, or palette payload.

The current live Web Terminal remains text-backed. Canvas rendering,
Computer-scoped delta fan-out, and guest graphics APIs require their own focused
and real-browser acceptance before claiming playable Web graphics.

Most Computer System behavior is verified by host tests or the headless Bedrock
Dedicated Server harness. Manual testing is reserved for behavior that depends
on a real player's visual, audio, or interaction experience.

## Phase 2 Computer vertical-slice checklist

Build and deploy both packs, create a clean world, and obtain
`computer_system:computer_item` plus `computer_system:advanced_computer_item`.
Record the exact client and server versions with each result.

Verify lifecycle and persistence:

- Place each Computer family while facing north, east, south, and west. Confirm
  the front faces the placer, the Desktop body is wider than the Monitor base,
  and redstone output changes do not reset orientation.
- Put one Monitor adjacent to a Desktop, interact within three blocks, and
  verify Minecraft prints the stable LAN entry page plus a permanent four-digit
  number. Enter it within two minutes. Confirm the URL becomes
  `/?computer=NNNN`, the number is in browser local storage, and no bearer token
  appears in the query. Move beyond three blocks and expect one `out_of_range`
  transition with input disabled but no session close. Return within three
  blocks and expect one automatic `in_range` resume. Reload the bookmark and
  verify it reconnects after proximity is valid, rotates the bearer token, and
  does not create parallel reconnect requests.
- On a fresh CS-Linux Computer, set an eight-or-more-character password twice.
  Confirm the boot banner and `New password:` prompt each appear exactly once
  for the initial `cs` account; no additional simulated first-boot notice or
  startup transcript is printed. Input is masked and absent from command
  history. Reboot and verify the prior display is cleared, `/etc/shadow` remains
  present, `login:` accepts `cs`, a wrong password is rejected, and the correct
  password reaches `/home/cs` with a `$` prompt.
- On a DOS-profile Portable Computer, run `EDIT C:\DEMO.TXT`, enter text in the
  blue full-screen viewport, save with F2, and exit through File > Exit. Modify
  it again and verify the Save/Discard/Cancel prompt owns the dirty exit. On a
  Linux Computer, verify `edit` is unavailable and use `vi /startup.py`. Also
  run bare `EDIT`, type text, press F2, and verify `C:\NONAME.TXT` is created
  without horizontal gaps between the blue editor rows.
- On that Portable, verify `VER`, `VOL`, `TIME`, `DIR C:\`, `TREE C:\ /F`,
  `MEM /F`, and `DOSKEY /HISTORY`. Expect DOS-style labels and CRLF output;
  `TIME` must show the clock rather than timing a command. Run `TIMER VER` and
  expect a separate elapsed-time line. Verify `CHDIR`, `ERASE`, `RENAME`, and
  `RMDIR` behave as DOS aliases and malformed switches fail explicitly.
- On CS-Linux, run `id`, `groups`, `uname -a`, `date`, `uptime`, `ls -la /etc`,
  `stat /etc/os-release`, `df -h`, `du -sh /etc`, `free -h`, `mount`, and
  `dmesg`. Expect LF Linux-style output, UID/GID 1000 for `cs`, `sudo` in the
  supplementary groups, `/home/cs` as the home, and root-owned system entries.
  Read `/proc/version`, `/proc/uptime`, `/proc/loadavg`, and `/proc/mounts`;
  writes must fail explicitly.
- Create a file, run `chmod 640`, make both `ln` and `ln -s` links, edit through
  the hard link, and confirm both names share content while `readlink` and
  `realpath` resolve the symbolic link. Reboot and verify metadata and links
  persist. Exercise `tee`, `sha256sum`, `file`, `cmp`, `diff`, `hexdump`,
  `mktemp`, and `xargs`; oversized work must terminate at its documented bound.
- Run bare `vi`; confirm `[No Name]` is displayed. Enter and erase a `:`
  command, then press Backspace once more and confirm Normal mode returns.
  Confirm `:w` reports no file name, then `:wq note.txt` saves and closes.
  Exercise `I`, `A`, `O`, `gg`, `G`, `ZZ`, and `ZQ`. In DOS EDIT verify
  Ctrl+Home/End, Ctrl+Left/Right, and Ctrl+Y with Ctrl+Z undo.
- Select part of the Web Terminal and press Copy beside Manual; confirm only the
  selection is copied. Clear the selection, press Copy again, and confirm the
  visible terminal grid is copied without padded trailing cells.
- Break the Computer, confirm exactly one non-stackable item is returned, place
  it elsewhere, and confirm its numeric computer ID and file remain unchanged.
- Reload the world and confirm `startup.py` runs from a fresh VM.
- Run an infinite program, press Terminate, and confirm Minecraft remains
  responsive and the lifecycle reaches `off` exactly once.

Verify redstone using a startup program that waits for `redstone`, reads `left`,
and calls `redstone.set_output("right", value)`:

- Toggle each of the six adjacent inputs and confirm the reported side and
  analog level are correct.
- Mirror left input to right output and confirm only the right output face emits
  digital power 15.
- Reload and repeat to prove identity, program, and output configuration
  survive.

Verify the shared terminal from a Computer, Portable Computer System, and
Monitor touch:

- All 51 columns and 19 rows remain visible with monospace alignment.
- Cursor position/blink and every foreground/background combination from the 16
  ComputerCraft palette colors are visually distinguishable.
- The terminal and primary Input, Submit, Terminate, and Close controls require
  no scrolling at the reference resolution.
- Continuous output does not freeze Minecraft or expose a partial redraw queue.
- Every submitted line reaches the VM once; rapid double submission creates two,
  not zero, one, or more than two, events.
- Terminate, normal Close, player disconnect, a competing form, server close,
  and an injected presentation failure each produce exactly one visible/VM
  result.

Do not mark Phase 2 complete when any item above is `NOT_RECORDED`; host tests
do not substitute for layout, controller focus, background-color, or
responsiveness evidence.

### Phase 2 terminal result: Windows GDK 1.26.33

- Palette: `PASS_WITH_CONSTRAINT` — all 16 indexed foreground colors and all 16
  background swatches were visibly distinct at 1280x1030 after assigning each
  index a unique native formatting color. The native label has no cell
  background API, so a blank cell with a non-default background is represented
  by a colored block glyph rather than exact RGB behind arbitrary text.
- Continuous output: `PASS_WITH_CONSTRAINT` — the bounded stream reached 200
  updates, Minecraft remained responsive, and Close reported `updates: 200`,
  `state: completed`, and `kind: cancelled`. A capture taken immediately around
  a full-label replacement could still show a transient partial frame; the next
  stable frame was complete.
- Layout: `FAIL_COMPATIBILITY_BOUNDARY` — 51-character rows wrap in the native
  form width and Input, Submit, and Terminate are not all simultaneously visible
  without vertical scrolling. GDK 1.26.33 ignored the attempted Resource Pack
  header/label remapping, so this cannot truthfully satisfy the no-scroll gate
  through the current stable `CustomForm` API.
- Real disconnect: `PASS` — the GDK client joined the persistent localhost BDS,
  opened the terminal, and exited while the form remained open. The server
  stayed running and recorded exactly one
  `CS_TERMINAL_CLOSE {"kind":"disconnected"}`; the disconnect harness passed
  with `terminalResults: 1`.

## Phase 0 terminal checklist

Run this command as a player in the `Computer System Phase 0` test world:

```text
/scriptevent computer_system:probe ui
```

Verify:

- The form title is `Computer System Phase 0 Terminal`.
- The terminal reports `Size: 51x19`.
- Rows through `19:` are present and remain readable.
- The fixed-width rows do not wrap or clip in a way that prevents terminal use.
- `Observable updates` changes while the form remains open.
- Text typed into `Command` appears in the live `Input:` status.
- Submitting `hello computer` briefly produces `> hello computer` and clears the
  input.
- `Terminate` closes the form and produces a terminal chat result.
- The normal close control also produces a terminal chat result.

Record `PASS` or `FAIL` for size/readability, live updates, input/submit,
terminate, and normal close. Include a short note for any clipping, wrapping,
focus, or controller-navigation problem.

### Result: Windows GDK 1.26.33

- Size/readability: `PASS_WITH_CONSTRAINT` — all rows through `19:` were
  readable, but the input field and action buttons required vertical scrolling
  at 1280x1024.
- Live updates: `PASS_WITH_CONSTRAINT` — the counter advanced and live input was
  reflected, while rapid full-label replacement occasionally exposed a partial
  redraw frame.
- Input/submit: `PASS` — `hello computer` appeared in the live input status and
  Submit cleared the client-writable field. The transient echo was shorter than
  the capture interval and was not independently captured.
- Terminate: `PASS` — the client returned `ServerClosed`; the terminal session
  now reports `result=terminated` with an empty final input.
- Normal close: `PASS` — the client returned `ClientClosed`; the terminal
  session now reports `result=cancelled` with an empty final input.

The mapping of disconnect and competing-form outcomes is host-tested. A real
disconnect can additionally be verified against an isolated copy of the official
BDS distribution:

```powershell
$env:BDS_HOME = "C:\path\to\bedrock-server"
npm run test:bds:disconnect
```

Wait for `BDS_DISCONNECT_READY`, add its localhost address and port to the GDK
client, join, run `/scriptevent computer_system:probe ui`, and leave the server
while the terminal remains open. The harness passes only when the server logs
exactly one `CS_TERMINAL_CLOSE` record whose kind is `disconnected`; it then
stops the isolated server. Set `BDS_PORT` when a fixed UDP port is needed and
`BDS_WORKDIR` when the generated isolated work directory must be retained at a
known location. `BDS_WORKDIR` must be empty and outside `BDS_HOME`.

By default, the harness recreates the isolated server at the stable
`%USERPROFILE%\tmp\computer-system-bds\runtime` path. Windows Firewall therefore
sees one stable executable path instead of a new timestamped executable on every
run. Approve that runtime executable once for the required network profile;
later default runs reuse the same application path. Setting `BDS_WORKDIR`
overrides this behavior and can require a separate Firewall rule for that custom
executable path.

To create the rule without waiting for the Windows prompt, open PowerShell as
Administrator once and run:

```powershell
$bds = "$env:USERPROFILE\tmp\computer-system-bds\runtime\bedrock_server.exe"
New-NetFirewallRule `
  -DisplayName "Computer System BDS Harness" `
  -Description "Allow the isolated Computer System BDS harness." `
  -Direction Inbound -Action Allow -Program $bds `
  -Protocol UDP -Profile Private
```

Administrative rights are required to add a machine-wide Firewall rule. Keep the
rule scoped to `Private`; the harness does not require a `Public` network rule.

An invalid player maps to `disconnected`, and `UserBusy` maps to
`competing_form`; the first terminal result always owns cleanup.

## Later manual-only checks

The following checks remain manual when their probes are implemented:

- monitor text readability and interaction alignment;
- computer, portable computer, and turtle visual appearance;
- registered sound audibility, pitch, attenuation, and note timing;
- overall keyboard, mouse, touch, and controller usability.

Logic behind these surfaces still requires automated tests. A manual result must
not substitute for state-transition, persistence, scheduling, or failure-path
coverage.

## Phase 0 speaker checklist

Stand somewhere quiet and run:

```text
/scriptevent computer_system:probe speaker
```

Verify:

- Two short registered notes are audible at the player's position.
- The second note is clearly higher than the first.
- Chat reports two calls and pitches `0.5,2`.

The automated BDS suite proves that both stable API calls are accepted. This
manual check covers only audibility and perceived pitch; it does not replace the
automated result.

## Phase 0 Portable Computer System checklist

Run this command as a player:

```text
/scriptevent computer_system:probe portable
```

Verify:

- Chat reports that one Portable Computer System was granted with an instance
  ID.
- The item appears with a clock icon and cannot stack above one.
- Holding and using the item opens `Computer System Phase 0 Terminal`.
- Dropping the item closes ownership cleanly; picking it up and using it opens
  the terminal again.

Automated tests cover identity persistence and lifecycle transitions. This check
covers the real player's item-use interaction and presentation only.

### Result: Windows GDK 1.26.33

- Item grant and presentation: `PASS` — the Portable Computer System was granted
  and appeared as a usable held item.
- Item use: `PASS` — using the held Portable Computer System opened the Computer
  System terminal.
- Drop and pickup reuse: `NOT_RECORDED` — identity preservation through an item
  entity is covered by BDS, but the player interaction was not separately
  recorded in this manual run.

## GitHub Pages static manual checklist

Run the deterministic build and focused host checks first:

```powershell
npm run build:pages
npm run test:pages
```

- `Verify:` Inspect `dist/pages`. `Expect:` The landing page, static manual,
  allowlisted CSS/JavaScript, referenced `web/assets/`, SEO metadata, sitemap,
  robots file, and fallback page are present; the live Web Terminal entry page
  and application are absent.
- `Verify:` Open the built landing page and follow its Manual link. `Expect:`
  All 16 chapters appear in canonical order, the part and reading-path
  navigation is usable, every image loads below the current site base, and no
  four-digit connection form or terminal input is offered.
- `Verify:` Search for `static GitHub Pages reference`, then reload the selected
  section's hash URL. `Expect:` Search returns at most 24 section results and
  the stable `#terminal-editor-static-github-pages-reference` target is restored
  without a server-side route.
- `Verify:` Disable JavaScript and reload the manual. `Expect:` The complete
  publication, table of contents, chapter/section anchors, and browser Find
  remain available; a no-JavaScript search hint is visible.
- `Verify:` Inspect browser network requests. `Expect:` Every local request
  stays under the deployed GitHub Pages base path; no `/api/*`, bearer token,
  session, BDS, EventSource, handoff, reconnect, input, power, or close request
  occurs.
- `Verify:` Open the independently running local companion afterward. `Expect:`
  its connection-number flow and live terminal still work and are not redirected
  to GitHub Pages.

The initial public deployment was verified from `main` on 2026-07-17 through
[Actions run 29541984914](https://github.com/tsuyoshi-otake/computer-system/actions/runs/29541984914)
and the published
[GitHub Pages URL](https://tsuyoshi-otake.github.io/computer-system/). Chrome
loaded the landing page, all 16 manual chapters, and the `manual/#chapter-basic`
deep link with zero console errors. Repeat the link, search, hash-reload,
JavaScript-disabled, mobile, 404, and network checks after publication changes.
The deployment must contain only `dist/pages`. A successful Pages check proves
static-document publication only; it is never evidence of BDS reachability or a
live Web Terminal session.

## Persistent Web companion networking checklist

Use a temporary configuration path for this verification so the system-wide
administrator configuration is not changed:

```powershell
$config = Join-Path $env:TEMP "computer-system-web-verification.json"
npm run web:config -- set --port 18080 --url http://127.0.0.1:18080 --config-file $config
npm run web:config -- show --config-file $config
$env:WEB_COMPANION_CONFIG_FILE = $config
npm run dev:bds:web
```

Verify:

- `Verify:` Inspect `show` output. `Expect:` Version 1, port 18080, and the
  normalized public origin are present and `restartRequired` was reported by
  `set`.
- `Verify:` Open `http://127.0.0.1:18080/`. `Expect:` The stable Web Terminal
  entry page loads and a Computer handoff uses the configured public origin.
- `Verify:` Restart the companion without setting `WEB_COMPANION_PORT` or
  `WEB_COMPANION_PUBLIC_ORIGIN`. `Expect:` It listens on 18080 again.
- `Verify:` Start once with `WEB_COMPANION_PORT=18081`. `Expect:` The temporary
  environment override wins without changing the persisted 18080 value.
- `Verify:` Run `npm run web:config -- reset --config-file $config`. `Expect:`
  the file is removed and the next unmodified start returns to port 80.

For the real system-wide configuration, repeat `set` without `--config-file`
from an administrator/root shell. Open only the selected LAN firewall port.
Never expose the plain HTTP listener directly to the Internet; use an HTTPS
reverse proxy and persist its HTTPS origin instead.

## Preserved-world storage migration checklist

Run the host checks first:

```powershell
npx vitest run tests/phase0/transactionalPagedStore.test.ts tests/computer/snapshotMigration.test.ts tests/computer/storageMigration.test.ts
```

`Expect:` The reader validates the current head before falling back to the
immediately previous complete generation for either page format. Schema-1
Computer/filesystem payloads preserve contents and metadata, a corrupt Computer
does not advance the identity head, a valid current-format fallback repairs and
reload-verifies the corrupt Computer or identity head, each coordinator step
performs at most one Dynamic Property operation, an interrupted run resumes
idempotently, and a fresh world creates no migration properties. A valid head
survives a corrupt previous manifest, recovery removes target-only content
blobs, legacy indexed pages, and stray manifests left behind by
corrupt/interrupted generations, and a normal periodic save performs no
whole-prefix key enumeration. Page-count and manifest-length overflow fail
before a storage mutation.

Use a disposable copy of a real legacy-format world for the live check:

1. Stop BDS cleanly. Confirm its process has exited and its configured UDP and
   Web TCP ports are closed.
2. Copy the complete stopped world directory, including `db`, packs, and world
   metadata, to a timestamped backup outside the managed runtime. Never copy or
   edit the LevelDB while BDS is running.
3. Install the new packs and start that same world without resetting it.
4. Inspect BDS logs for transition-only `CS_STORAGE_MIGRATION` JSON. Confirm the
   phase and completed/total counts make bounded progress and that no Computer,
   Portable, Monitor, or Web Terminal interaction becomes available before the
   terminal `complete` record.
5. Open representative existing Computers. Verify identity, family, block/item
   form, label, OS and hardware profiles, display profile, terminal state,
   files, ownership/mode/mtime, symbolic links, and hard-link sharing.
6. Stop and restart the migrated world without resetting it. Confirm migration
   reports `complete` without converting a Computer again and the same data
   remains available.
7. On any `failed` record, stop BDS, preserve the failed copy for diagnosis, and
   restore only from the stopped-world backup. Do not repair LevelDB keys by
   hand.

`Expect:` Every referenced Computer generation is committed and read back before
the identity generation becomes the activation point. A restart may rescan while
that identity head is legacy, but it skips already-current Computer generations;
failure never exposes a partially migrated identity registry. When the identity
head is already current, the same bounded scan still upgrades and verifies a
changed Computer payload, such as missing DOS runtime state or a live OS state
that must become cold, without creating a new identity generation. A healthy
head remains unchanged; a corrupt current-format head recovered from its
previous generation is rebuilt and must reload without fallback before the
terminal `complete` state.

## Phase 0 Monitor checklist

Run this command while facing south with three blocks of clear space ahead:

```text
/scriptevent computer_system:probe monitor
```

Verify:

- A 3x2 black Monitor surface appears three blocks south of the player.
- Touching the near (north) face reports `monitor_touch north x y` in chat.
- Touching near the top-left reports coordinates near `1,1`; touching near the
  bottom-right reports coordinates near `51,18`.
- Each valid touch opens the Computer System terminal UI fallback.

The BDS suite verifies discovery and update bounds. This manual check covers the
real block-face coordinates and player-facing fallback interaction.

### Result: Windows GDK 1.26.33

- Connected surface: `PASS` — the generated 3x2 Monitor surface was available
  for player interaction.
- Touch mapping: `PASS` — separate touches reported `monitor_touch north 45 3`
  and `monitor_touch north 38 3`, proving that the mapped cell changes with the
  interaction position.
- Terminal fallback: `PASS` — a valid Monitor touch opened the Computer System
  terminal UI.

## Web Terminal identity and multi-session checklist

Use a clean managed debug world for this checklist. Identity snapshot schema 2
does not migrate the previous sequential `computer-N` registry.

1. Publish through a literal IP assigned to the companion host, leave
   `WEB_COMPANION_AUTO_OPEN` unset, run `npm run dev:bds:web`, connect
   Minecraft, and use a Portable Computer System. Use `1` only to enable opening
   explicitly or `0` to disable it.
2. Confirm the default browser opens without typing the URL and the printed
   one-use fallback opens a Computer whose identity matches
   `c-[0-9a-hjkmnp-tv-z]{6}` and whose status shows `CONTROL`.
3. Use the same Portable Computer System again to mint a second link and open it
   in a second browser session.
4. Confirm the second session immediately shows `CONTROL`, the first session
   changes to `VIEW ONLY`, and physical Enter works only in the second session.
5. Choose **Take control** in the first session. Confirm it returns to
   `CONTROL`, the second session changes to `VIEW ONLY`, and physical Enter
   works only in the reclaimed writer.
6. Close either one of the two sessions and confirm the remaining view continues
   receiving terminal snapshots. Close the last session and confirm exactly one
   `terminal_closed` record is emitted.
7. Open a second Computer alongside the first and confirm both Computers can
   have independent writers.
8. Repeat at a 390-pixel viewport and confirm the ownership state, takeover
   action, terminal, and status bar fit without page-level horizontal or
   vertical scrolling.
9. Start once with `WEB_COMPANION_AUTO_OPEN=0`, once with an unassigned
   published IP, and once with a custom public origin. Confirm no browser
   process is launched automatically and the printed two-minute fallback remains
   usable.
10. Drag-select several terminal rows and press Ctrl+C. Confirm the exact range
    is copied, the selection remains visible until the next user action, and no
    interrupt is emitted. Select command-line text and repeat; then press Ctrl+C
    with no selection and confirm exactly one interrupt.
11. Paste a single-line command and a multiline command. Confirm insertion
    occurs at the current selection, line breaks become spaces, the value stops
    at 128 characters, and neither paste runs a command before physical Enter.
12. Keep five browser sessions attached, take control in one, and submit three
    unique `printf latency-N` commands. Measure from Enter to visible output;
    confirm no command is duplicated and the writer does not wait for the
    five-session periodic round-robin.
13. Run `whoami`, `hostname`, `date`, `uptime`, `ls /`, and `ls /dev`. Confirm
    the identity is the sandbox user `cs`, the hostname is the compact Computer
    ID, Linux profile directories are present, and `null` is listed but is not
    an ordinary persisted file.
14. Type `who` and press Tab, then type `cat /et` and press Tab. Confirm the
    values become `whoami ` and `cat /etc/` without submitting. Resize the
    browser and confirm the reported cell size remains 80x25, the glyphs scale
    to fit both axes without a scrollbar, and no duplicate resize relay or
    command is produced.
15. Run `date`, `date --game`, `date --virtual`, `du -s /home`, and `quota`.
    Confirm wall UTC, Minecraft time, deterministic VM time, subtree bytes, and
    enforced capacity/file/entry limits are distinguishable.
16. Put `export FAVORITE=doraemon` in `~/.bashrc`, restart the Computer, and run
    `echo $FAVORITE`. Run a Bash script using `$1`, `if`, `for`, and a function;
    confirm it stays inside the Computer filesystem and loop limits fail
    explicitly rather than hanging the server.
17. Run `vi /home/cs/demo.py`, press `i`, enter an indented Python sample, press
    Escape, and run `:wq`. Confirm Normal/Insert/Command states, Python token
    colors, four repeating indentation background colors, save, shell
    restoration, and `cat`/reopen contents. Repeat `:q` with dirty contents and
    confirm it blocks; use `:q!` and confirm discard. Repeat with bare `vi`,
    `:w demo2.py`, empty-command Backspace, `gg`/`G`, and `ZZ`/`ZQ`.
18. Run `free` and `/proc/meminfo`; confirm used memory exceeds guest runtime
    and the kernel, services, buffers, and guest fields sum to the reported
    usage. On CS-DOS run `MEM` and `MEM /C`; confirm DOS system/driver plus
    guest runtime accounting agrees with the conventional, upper, reserved, and
    XMS region total.
19. Restart the Computer. Confirm `/home/cs/demo.py` and `/etc` survive, `/tmp`
    is empty, and BDS logs contain no persistence failure. Stop BDS before
    backing up the complete world directory; restore the stopped-world copy and
    confirm the latest complete generation loads.

`Expect:` Every committed identity is compact and stable, viewer input never
reaches the VM, takeover has one observable winner, a non-final detach does not
close the shared terminal, and each Computer owns its writer lease
independently.

## CS-Linux accounts, privilege, and DAC checklist

Use a fresh CS-Linux Computer first, then repeat the migration portion with a
stopped backup of an older world. Record command output and the relevant file
metadata before and after each reboot.

Run the deterministic account and Python-boundary checks before the live pass:

```powershell
npx vitest run tests/os/linuxAccounts.test.ts tests/os/linuxMultiUser.test.ts tests/computer/runtimeCredentials.test.ts
```

`Expect:` The reserved-name, 32-group ceiling, recursive-home rollback, startup,
foreground Python, and MCP Python cases all pass without a partial account,
directory tree, credential, or live-shell leak.

Run the real-BDS authentication boundary in a new dedicated MCP work directory:

```powershell
npm run test:mcp:bds
```

`Expect:` The JSON summary contains `linux_authentication` details with
`preLoginRejected`, `passwordMasked`, `setupCompleted`, and `laterLoginRequired`
all true, `authenticatedUser` equal to `cs`, and final state `idle`. The
isolated probe Computer reaches `off`, and no password appears in the emitted
record or BDS diagnostics.

1. Complete first boot by assigning the `cs` password twice. Run `whoami`, `id`,
   `groups`, and `pwd`.
   - `Verify:` Inspect the four command results and `/etc/passwd`, `/etc/group`,
     and `/etc/shadow`.
   - `Expect:` `cs` is UID/GID 1000, its home is `/home/cs`, it belongs to
     `sudo`, root is UID/GID 0 with a locked password, and no plaintext password
     appears in the terminal, history, or account files. `/startup.py` exists
     empty at mode 0644 with UID/GID 1000 while `/` remains root-owned and
     non-writable; saving it with `vi` succeeds without granting permission to
     create another root-level file.
2. Reboot, enter `cs` at `login:`, then enter its password at `Password:`.
   Attempt an unknown user, a wrong password, and the locked root account first.
   - `Verify:` Observe every prompt and return state.
   - `Expect:` Only the correct unlocked account reaches a shell; secret input
     is masked; repeated failures incur the bounded delay; no startup script
     runs before authentication succeeds.
3. Use `sudo` as `cs`, then create another group and user with `groupadd` and
   `useradd`, assign the new password with `passwd`, update the account with
   `usermod`, and inspect the result with `id`, `groups`, and the three account
   files. Exercise `groupdel` and `userdel` on disposable records. Attempt to
   create both a user and a group named `computer`, then attempt to rename a
   disposable user and group to that name. Add exactly 32 supplementary groups
   to one disposable user, record all three account files, and attempt a 33rd.
   - `Verify:` Repeat one account mutation without elevation and one while
     elevated. Compare the account files byte-for-byte before and after the
     33-group rejection. In the focused host fixture, force
     `useradd -d /home/partial/final alice` to exhaust the entry limit while it
     recursively provisions the home.
   - `Expect:` The ordinary attempt is denied; the elevated mutation commits all
     account-file references consistently; root and the UID 1000 boot-service
     identity cannot be removed, and the active account cannot be renamed or
     have its home moved; each error leaves an observable nonzero status instead
     of a partial account. Directly writing, linking, moving, changing metadata
     on, or deleting any of the three managed account files fails even under
     `sudo`, while the account commands remain functional. The legacy name
     `computer` is permanently rejected in both namespaces. Exactly 32
     supplementary groups are accepted, the 33rd leaves all records unchanged,
     and failed recursive home provisioning leaves neither the user nor
     `/home/partial` or `/home/partial/final`.
4. Exercise both elevation paths. Run one command through `sudo`, then enter a
   target user's context with `su` and leave it with `exit`.
   - `Verify:` Compare `id` before, during, and after each scope, including a
     bad password and a command that fails.
   - `Expect:` `sudo` is available only to `sudo` members and authenticates the
     caller; `su` authenticates the target account; the caller's credentials and
     directory are restored after every success, failure, and nested-session
     exit. Locked root cannot be selected until its password is deliberately
     set. A script or pipeline cannot log out the terminal session or open a
     password prompt; scripted elevation must already be cached or use
     `sudo -n`.
5. Set `umask 027`, create files and directories as two different users, and
   exercise read, write, traversal, `chmod`, `chgrp`, `chown`, hard links,
   symbolic links, and deletion in `/tmp`.
   - `Verify:` Use `ls -la` and `stat` to compare mode, UID, and GID; attempt
     each operation as the owner, a group member, an unrelated user, and root.
   - `Expect:` owner/group/other DAC applies at the guest filesystem boundary;
     new entries use the effective UID/GID and active umask; `/tmp` sticky
     deletion and protected hard links are enforced; only permitted ownership
     changes succeed; setuid/setgid bits do not grant credentials.
6. Reboot and log in as each created user.
   - `Verify:` Recheck account records, home paths, credentials, modes, links,
     and password acceptance.
   - `Expect:` users, groups, hashes, ownership, umask-controlled modes,
     symbolic links, and shared hard-link contents survive without privilege
     leakage.
7. On a disposable Computer or stopped-world copy, leave `/startup.py` empty and
   reboot once, then run a foreground file containing only `import shell`. Put
   the same import in a non-empty user-authored `/startup.py` and reboot;
   finally issue bounded MCP Python with `python -c import shell` against the
   authenticated Computer.
   - `Verify:` Compare the empty-startup shell with the foreground, authored
     startup, and MCP results. Restore the stopped copy after the authored
     startup fault.
   - `Expect:` Only the built-in program selected by an empty `/startup.py`
     receives the native `shell` module. User-authored startup, foreground
     Python, and MCP Python reject the import explicitly and never expose the
     authenticated live `ShellSession` object.
8. Start a `sudo` password prompt and close the final terminal session. Repeat
   while a root foreground Python program is waiting for an event, while a
   compiler request is admitted but not complete, and while a bounded `sudo -n`
   MCP Python request is queued.
   - `Verify:` Reconnect after each close, inspect the prompt and intended
     output paths, and try the event that would have resumed the old Python
     process.
   - `Expect:` Every branch immediately loses its secret prompt, nested
     identity, sudo timestamp, and captured process credentials. Foreground,
     compile, and MCP work finish explicitly with cancellation status; no
     post-close side effect appears, and reconnect starts at `login:`. If the
     bounded internal completion event cannot be queued, the Computer shuts down
     explicitly.

For the complete legacy migration:

1. Start from a stopped-world backup containing the recognized `computer`
   account, `/home/computer`, a working password, files with non-default modes
   and mtimes, a symbolic link, a hard-link pair, and a deletion tombstone.
2. Record the old password payload and `stat`/link evidence, then start the
   updated server and wait for migration to finish before opening the Computer.
3. Log in as `cs` using the exact old password. Inspect `/etc/passwd`,
   `/etc/group`, `/etc/shadow`, `/home/cs`, and `/home/computer`.
4. Restart once more and repeat the inspection.

`Expect:` The old user, group, shadow key, and `/home/computer` path are absent;
there is no compatibility alias or symlink. `cs` keeps UID/GID 1000 and the
exact old password payload. `/home/cs` retains every file, mode, owner, group,
mtime, symbolic-link target, hard-link identity/content, and tombstone. The
second boot makes no further migration change. An ambiguous existing `/home/cs`
destination fails explicitly and never merges or discards either tree. The
`computer` name remains unavailable for both new users and new groups after the
migration completes.

## OS Presence v1 checklist

Run the deterministic ownership and failure-injection gate first:

```powershell
npx vitest run tests/os/osRuntimeState.test.ts tests/os/osNetworkState.test.ts tests/os/linuxHistory.test.ts tests/os/linuxManual.test.ts tests/os/dosRuntimeState.test.ts tests/os/dosPresence.test.ts tests/os/dosBatch.test.ts tests/computer/osRuntimeOwnership.test.ts tests/computer/osRuntimeProcessOwnership.test.ts tests/computer/backgroundJobs.test.ts tests/computer/gracefulLifecycle.test.ts tests/runtime/schedulerPause.test.ts tests/computer/persistence.test.ts tests/computer/snapshotMigration.test.ts
```

`Expect:` The process/job/session/service/mount/device/journal tables, bounded
future network-state transitions, STOP/CONT scheduler ownership, cold
projections, stale-media rejection, DOS utilities, bounded BAT control flow,
real persistence sync, ordered shutdown/reboot, durability failure, and
startup-preserving safe boot all pass.

The network-state portion is host-only integration evidence. Confirm the default
aggregate omits its optional network key; register bounded interface/address and
socket/listener fixtures; then test each capacity plus one and one invalid
reference. Cold-project the result twice.

`Expect:` The limits are 8 interfaces, 32 addresses, and 64 sockets; failure
does not mutate state; the outer OS revision advances only for successful
transitions; cold state retains interface/address definitions while setting
links down, counters to zero, and sockets/listeners empty; the second projection
is identical. This does not make `lo`, `eth0`, packet routing, DNS, `ip`,
`ping`, or `ss` production features.

Use an authenticated Desktop Web Terminal and one Portable DOS Computer for the
live pass. Record the exact `c-xxxxxx` identities and retain terminal captures.

1. Log in as `cs`, run `pwd`, then inspect the prompt and welcome text. Run
   `echo presence-one`, log out, and log in again.
   - `Verify:` Inspect the second login, run `history`, and run
     `stat /home/cs/.bash_history`.
   - `Expect:` The prompt is `cs@<computer-id>:~$`; `/etc/motd` is displayed;
     the second login includes the previous tty/tick; `history` includes the
     ordinary command; the file is mode 0600 and owned by the authenticated
     account. Neither password entry appears in terminal history or the file.
2. Start `sleep 30 &`, then run `jobs`, `ps -f`, and
   `cat /proc/<sleep-pid>/status`. Run `kill -STOP <pid>`, wait several ticks,
   run `jobs`, then use `bg %1`, `kill -TERM <pid>`, and `wait %1`.
   - `Verify:` Compare the job number, PID/PPID/UID, state, cycles, shell PID,
     and `/proc/loadavg` runnable/active counts at each transition.
   - `Expect:` The sleep process is a child of the login shell; STOP leaves the
     job stopped without CPU progress; CONT resumes it; TERM reaches a terminal
     status; `wait` removes both the completed job and zombie process. PID 1
     remains protected. `echo leak > /tmp/leak &` is rejected before the file
     exists.
3. Run `tty`, `who`, `w`, `last`, `service --status-all`,
   `service cs-login status`, `top`, `man ps`, and `apropos process`.
   - `Verify:` Compare the login identity, tty, shell/getty PIDs, service PID,
     and process counts across all output.
   - `Expect:` Every view agrees with one authenticated `tty1` session and the
     bounded process table. `top` prints one snapshot and returns. Service
     status is readable, while `service cs-login restart` fails explicitly
     because `cs-init` owns mutation. Manual lookup is local and bounded.
4. Read `/proc/devices`, `/proc/services`, `/proc/mounts`, `/proc/self/status`,
   and one other live PID's `cmdline`, `stat`, and `status`. Use `sudo` to read
   `/var/log/messages` and `/var/log/auth.log`; compare `dmesg` after one failed
   and one successful login.
   - `Verify:` Check boot, mount, device, service, authentication, process, and
     session records, including `/dev/fd0` absent-media state.
   - `Expect:` The files are dynamic guest views, not static image text or host
     logs. `dmesg` is the boot channel, `auth.log` contains no password, and a
     write to any proc or log view is rejected.
5. Create `/home/cs/synced.txt`, run `sync`, then reboot normally. After login,
   inspect the file and use `sudo tail /var/log/messages`.
   - `Verify:` Observe PWR/HDD transitions and the ordered stop records.
   - `Expect:` New work admission closes first; owned work and accepted I/O
     drain; data sync precedes unmount; service/device stop precedes final sync;
     reboot starts only after the stop phases complete. The file and the bounded
     journal survive. After another restore, `final sync requested` and the
     shutdown/reboot-prepared record each occur once; there is no unsaved
     post-callback success line. The host failure fixture also lets the final
     callback fail once and a later automatic dirty save succeed; the restored
     journal contains the exact fault once and neither provisional marker. A
     persistence failure is verified only through the focused host injection
     test; never corrupt a live world to test it.
6. On a disposable Computer, put invalid source in `/startup.py` and confirm a
   normal boot enters `crashed`. Interact once without sneaking, then sneak
   while opening it. Repeat on a crashed Computer with an attached Web Terminal
   session by using its power control.
   - `Verify:` The ordinary Bedrock interaction prints the safe-boot gesture and
     leaves lifecycle `crashed`; the sneaking interaction and crashed-state Web
     power control each boot once. Reopen the shell and inspect `/startup.py`
     and the boot journal. Also verify that a non-crashed Web power control
     never sends `safe_boot`.
   - `Expect:` Both production adapters call the same one-shot recovery
     boundary. Safe boot preserves the exact broken file, bypasses it for that
     boot, and records the decision. No reset, delete, rename, or rewrite
     occurs, and neither the guest shell nor MCP exposes safe boot.
7. On CS-DOS, create `C:\WORK\ONE.TXT`, `TWO.TXT`, and `OLD.BAK`. Exercise
   `DIR *.TXT`, `COPY *.TXT C:\BACKUP`, `REN *.BAK *.OLD`, and `DEL *.OLD`.
   Switch to `A:` and back to `C:`; change directories before and after the
   switch.
   - `Verify:` Compare selected drive, per-drive current directory, wildcard
     results, and `DIR` timestamps.
   - `Expect:` C: operations are bounded and case-insensitive, timestamps use
     persisted FAT two-second granularity, A: reports `Not ready`, and returning
     to C: restores its current directory. A: is not fabricated from C:.
8. Run `ATTRIB +R C:\WORK\ONE.TXT`, attempt to edit/delete/overwrite it, then
   clear R. Set H/S/A combinations, inspect them with `ATTRIB`, `ATTRIB /S`, and
   `DIR /A:H`. Run `LABEL C: PRESENCE`, `VOL C:`, and `CHKDSK C:`. In a host
   fixture, cap FAT metadata at one entry, retain both state snapshots, then
   redirect output to a second path. Repeat with a wildcard `COPY` whose full
   destination hierarchy would exceed capacity. In host tests, inject an error
   after the second real wildcard write/delete/rename, after `MOVE` changes both
   aggregates, after FAT attribute and single-write/directory mutations, and
   from the cold-state observer. Also inject observer failure after drive
   selection, active and inactive drive `CD`, `LABEL`, and lazy FAT metadata
   creation. Inject failure while creating the second operand of
   `MD C:\\FIRST C:\\SECOND`. Finally, pass both a declared async callback and
   an ordinary callback returning a Promise/thenable to the filesystem and DOS
   transaction fixtures, with mutations before and after `await`.
   - `Verify:` Reboot and repeat `ATTRIB`, `VOL`, and `CHKDSK`; compare the
     capacity fixture's filesystem and DOS-state snapshots before and after the
     rejected write.
   - `Expect:` R/H/S/A and the label survive in the Computer's DOS runtime
     snapshot; read-only blocks every mutation path; `DIR /A` filters the same
     metadata; CHKDSK reports actual bounded file/directory/byte/free counts and
     states that it performed no repairs. It does not change file contents,
     labels, or attributes; a legacy entry may cause missing versioned FAT
     metadata to be materialized during reconciliation. Capacity-plus-one and
     every injected post-mutation failure leave the exact filesystem/FAT
     snapshots, inode/link identities, revisions, free space, and blob metrics
     unchanged. Nested wildcard writes take one outer filesystem snapshot, and
     an observer failure restores the prompt/drive/cwd/label/FAT state and
     republishes the rolled-back DOS aggregate. Multi-path `MD` leaves neither
     operand after a later failure. Declared async callbacks never run;
     disguised Promise/thenable callbacks roll back pre-await work and reject
     post-await mutation until settlement.
9. Run a disposable BAT fixture that exercises a label, `GOTO`, internal and
   external `CALL`, `SHIFT`, `IF ERRORLEVEL`, `IF EXIST`, and `COMMAND /C`; run
   a second fixture through `COMMAND /K`.
   - `Verify:` Check argument shifting, return status, selected branches, and
     environment retention. Also test a missing label and a loop that reaches
     the bounded jump/step limit in the host fixture.
   - `Expect:` Valid control flow reaches the expected terminal line; `/C`
     returns after the command; `/K` retains the resulting DOS environment;
     missing labels, unquoted Unix-style `&&`/`||`, and exhausted bounds fail
     explicitly without invoking native COMMAND.COM. Pipes/redirections, where
     used, remain documented safe-shell extensions rather than native behavior.
10. On a disposable DOS Computer, record the current memory report, remove or
    corrupt the installed HIMEM/EMM386 guest driver referenced by `CONFIG.SYS`,
    and reboot once.
    - `Verify:` Compare the boot error and memory state with the intact driver
      capsule, then restore the utility from a stopped backup or known base.
    - `Expect:` A missing or invalid capsule fails explicitly before enabling
      XMS/UMB state. Matching only the driver basename never executes or enables
      a native driver.
11. Verify the non-claims: run `ip`, `ping`, and `ss` on Linux; inspect the FDD
    indicator and `A:` on DOS; and try a native `.COM`/`.EXE` artifact.
    - `Expect:` Guest networking commands are unavailable, FDD/A: remains absent
      without an operator media adapter, and native DOS binaries do not execute.
      Web Terminal connectivity is host transport, not proof of a guest NIC.

For a preserved-world pass, stop and back up the whole world first. Upgrade one
Linux and one DOS Computer that predate optional runtime fields, then restart
again.

`Verify:` Inspect `CS_STORAGE_MIGRATION`, Linux last-login/journal state, C:
label/attributes/mtimes, active DOS drive, and A: media before and after both
starts.

`Expect:` Missing legacy runtime fields become validated defaults; Linux
restores cold without a live shell/job/session; DOS preserves C: metadata,
activates C:, and forces A: absent; an unused network key remains absent, while
future registered interface/address definitions restore down with zero counters
and no sockets; the second restart is idempotent. The identity registry is never
activated before every referenced Computer generation verifies.

## CS486DX toolchain

`Verify:` In a CS-Linux Web Terminal, create a short `.asm`, `.c`, and `.cpp`
program. Compile them with `as`, `cc`, and `c++`, then use `run --stats`, direct
`./program` execution, and `objdump`. Submit `basic` and `basicc` separately.

`Expect:` The three installed frontends execute inside the sandbox, both BASIC
commands return status 127, `cpuinfo` reports a Computer System 486DX at 33 MHz,
and stats show deterministic instruction/cycle counts. An infinite ASM jump
exits with status 124 at the bounded instruction limit; invalid memory and
corrupted executables report explicit faults without affecting BDS.

## CS386SX CS QBASIC and shared EDIT

`Verify:` In the CS-DOS Web Terminal, confirm `C:\COMMAND\QBASIC.EXE`, open bare
`QBASIC`, open the same text file with both `EDIT` and `QBASIC /EDITOR`,
drag-select text with the writer mouse, copy/cut / paste it, save it, and run a
supported `.BAS` file with `QBASIC /RUN`. Repeat the pointer attempt from a
viewer, after writer takeover, and after leaving range.

`Expect:` The Welcome dialog is original CS QBASIC content; EDIT and
`QBASIC /EDITOR` show the same buffer/UI and save the same bytes. Writer drag
selection and clipboard operations work, while viewer, stale, out-of-range, and
disconnected input cannot mutate the guest. `/RUN` returns to the IDE and F4
shows bounded output. F5/F7/F8/F10 explicitly report that source-debug actions
are not implemented rather than restarting the program.

`Verify:` Compile a C or C++ `main` and an ASM zero-argument function with `-c`,
inspect both objects with `nm` and `objdump`, link them with `ld`, and execute
the result with `run --stats`. Also compile statement-boundary inline assembly
that moves `6` into EAX and attempt an unsafe `asm("push eax")` statement.

`Expect:` The external ASM symbol resolves, the mixed program produces the
expected output under deterministic CPU-cycle accounting, object-relative data
does not overlap, and unsafe inline assembly fails explicitly. Missing and
duplicate symbols must not produce an executable. No command invokes a host
compiler or linker.

`Verify:` Compile one object declaring `extern int helper()` and another
defining `void helper()`. Reverse the return types in a second pair. Inspect
their JSON symbol records, then attempt both links. Also link the integer caller
against an untyped legacy ASM definition and import an object containing only a
known `()->void` function from Python.

`Expect:` C/C++ defined and undefined function symbols serialize `()->i32` or
`()->void` identically on Linux and DOS. Both known mismatches fail with an
explicit deterministic function-signature diagnostic. The untyped ASM link
remains compatible, while Python does not expose the known void function through
its integer/EAX extension ABI.

`Verify:` Assemble one Linux program using a relative `%include`, `%define`, a
bounded `%macro`, `.rodata`, `.data`, `.bss`, `align`, `db`/`dw`/`dd`, and a
typed data symbol. Build with `as -c`, inspect with `nm` and `objdump`, link
with `ld -e`, and execute it. Link a second object that reads the exported data.

`Expect:` `CS486OBJ` v2 reports all four sections, typed symbols, and structured
relocations. Initialized bytes and BSS addresses do not overlap, cross-object
alignment is preserved, and the program reads the expected data. A circular
include, recursive macro, `call` to data, `load` from text, corrupt relocation,
and cumulative size overflow each terminate explicitly without an output file.

`Verify:` On the Portable CS-DOS profile, build the equivalent source with
strict 8.3 names and CRLF using `ASM MAIN.ASM /C /OUT:MAIN.CSO`, then
`LINK MAIN.CSO /ENTRY:MAIN /OUT:MAIN.CSX`, `NM`, `OBJDUMP`, and
`RUN /STATS MAIN.CSX`. Attempt `ORG 100h` and `INT 21h`.

`Expect:` DOS aliases and slash options feed the same CS486OBJ/CS486 pipeline,
all displayed diagnostics and inspection output use CRLF, and CS386SX timing is
reported. `ORG`, interrupts, downloaded COM/EXE files, ELF, and OMF are rejected
explicitly rather than treated as native binaries.

`Verify:` Reserve static data to four bytes below the RAM ceiling and execute a
PUSH; separately forge ESP below the static boundary and POP, and return to an
out-of-range address.

`Expect:` PUSH/POP/CALL/RET cannot cross the aligned static-data/BSS floor.
Stack overflow/underflow and invalid return targets are explicit faults; no
static byte is read or overwritten as stack storage.

### C/C++ frontend, CSIR, and backend bounds

`Verify:` Run
`npm exec vitest run tests/os/cFamilyProfiles.test.ts tests/runtime/cs486Ir.test.ts`.
Then compile equivalent zero-argument C and C++ programs under CS-Linux with
`cc`/`c++` and under CS-DOS with `CC`/`C++`. Include nested lexical scopes, a
compound function-call expression, a canonical `for` loop, and a local whose
lifetime crosses a call. Inspect the objects with `nm` and `objdump`.

`Expect:` The dedicated bounded tokenizer and parser produce source-span
diagnostics and a typed AST; case-sensitive lexical scopes reject undeclared or
duplicate names. CSIR verification accepts one definition per computed SSA value
and explicit local loads/stores, rejects bad types, dominance, targets, or block
termination, and stops at its documented limits. Optimization is deterministic
and pass-capped. Register assignment reports deterministic linear-scan
allocation and checked spills; ESP/EBP are never allocated, values across calls
are safely spilled, and locals use EBP-relative stack slots. No graph-coloring
or unbounded/backtracking allocator path is entered. Both OS profiles emit typed
function symbols and structured relocations for the same validated CS486 ABI,
including matching defined/undefined return signatures, with LF diagnostics on
Linux and CRLF on DOS.

`Verify:` Compile source containing `#define`, a global data declaration, an
undeclared identifier, a duplicate local, a parameterized function, a C++ class,
and malformed syntax. Also link an unresolved function and attempt to load ELF,
OMF, COM, and EXE artifacts.

`Expect:` Every unsupported construct terminates with a bounded source-span or
format diagnostic and leaves no executable artifact. No path invokes a host
compiler/linker, performs dynamic linking, or interprets native x86, ELF, OMF,
COM, or EXE input.

### Bounded CS486 instruction debugger

`Verify:` Run
`npm exec vitest run tests/runtime/cs486Debugger.test.ts tests/os/cs486DebuggerProfiles.test.ts`.
In CS-Linux, build a short program and run the following commands in one shell
session:

```text
csdb program
break main
continue
regs
disasm main 8
memory 0 16
step
clear main
continue 1000
status
quit
```

Repeat on CS-DOS with a strict 8.3 executable name and `DEBUG`, `BP`, `G`, `R`,
`U`, `D`, `T`, `BC`, `STATUS`, and `Q`.

`Expect:` Linux `csdb` and DOS `DEBUG` use the same validated CS486 debugger
core. They pause at exact instruction boundaries, distinguish breakpoints,
steps, halt, faults, instruction-limit exhaustion, interruption, and quit, and
show register values, bounded disassembly, and read-only memory. Linux output
uses LF; DOS output uses CRLF and hexadecimal address defaults. Quitting,
logging out, switching user, or disconnecting the terminal destroys the debug
session.

`Verify:` Request 257 disassembled instructions, a 4,097-byte memory read, a
100,001-instruction continue, and more than 256 breakpoints. Attempt memory
modification, source-level stepping, native GDB/DOS DEBUG behavior, dynamic
loading, and code that depends on PIC, IRQ, IDT, BIOS, or DOS interrupts.

`Expect:` The documented ceilings (256 breakpoints, 100,000 continued
instructions, 256 disassembled instructions, and 4,096 read-only memory bytes)
fail explicitly without corrupting the paused process. Writable memory,
source-variable reconstruction, native debugger emulation, dynamic linking,
PIC/IRQ/IDT execution, and native interrupt delivery remain explicitly
unsupported.
