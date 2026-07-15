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
  Confirm the boot banner, first-boot notice, and `New password:` prompt each
  appear exactly once; input is masked and absent from command history. Reboot
  and verify the prior display is cleared, `/etc/shadow` remains present, a
  wrong password is rejected, and the correct password reaches `~$ `.
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
  `dmesg`. Expect LF Linux-style output, UID/GID 1000 for `computer`, and
  root-owned system entries. Read `/proc/version`, `/proc/uptime`,
  `/proc/loadavg`, and `/proc/mounts`; writes must fail explicitly.
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

## Preserved-world storage migration checklist

Run the host checks first:

```powershell
npx vitest run tests/phase0/transactionalPagedStore.test.ts tests/computer/snapshotMigration.test.ts tests/computer/storageMigration.test.ts
```

`Expect:` The reader validates the current head before falling back to the
immediately previous complete generation for either page format. Schema-1
Computer/filesystem payloads preserve contents and metadata, a corrupt Computer
does not advance the identity head, each coordinator step performs at most one
Dynamic Property operation, an interrupted run resumes idempotently, and a fresh
world creates no migration properties.

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
failure never exposes a partially migrated identity registry.

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
    the identity is the sandbox user `computer`, the hostname is the compact
    Computer ID, Linux profile directories are present, and `null` is listed but
    is not an ordinary persisted file.
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
17. Run `vi /home/computer/demo.py`, press `i`, enter an indented Python sample,
    press Escape, and run `:wq`. Confirm Normal/Insert/Command states, Python
    token colors, four repeating indentation background colors, save, shell
    restoration, and `cat`/reopen contents. Repeat `:q` with dirty contents and
    confirm it blocks; use `:q!` and confirm discard. Repeat with bare `vi`,
    `:w demo2.py`, empty-command Backspace, `gg`/`G`, and `ZZ`/`ZQ`.
18. Run `free` and `/proc/meminfo`; confirm used memory exceeds guest runtime
    and the kernel, services, buffers, and guest fields sum to the reported
    usage. On CS-DOS run `MEM` and `MEM /C`; confirm DOS system/driver plus
    guest runtime accounting agrees with the conventional, upper, reserved, and
    XMS region total.
19. Restart the Computer. Confirm `/home/computer/demo.py` and `/etc` survive,
    `/tmp` is empty, and BDS logs contain no persistence failure. Stop BDS
    before backing up the complete world directory; restore the stopped-world
    copy and confirm the latest complete generation loads.

`Expect:` Every committed identity is compact and stable, viewer input never
reaches the VM, takeover has one observable winner, a non-final detach does not
close the shared terminal, and each Computer owns its writer lease
independently.

## CS486DX toolchain

`Verify:` In the Web Terminal, create a short `.asm`, `.bas`, `.c`, and `.cpp`
program. Compile them with `as`, `basicc`, `cc`, and `c++`, then use
`run --stats`, direct `./program` execution, and `objdump`.

`Expect:` All four frontends execute inside the sandbox, `cpuinfo` reports a
Computer System 486DX at 33 MHz, and stats show deterministic instruction/cycle
counts. An infinite ASM jump exits with status 124 at the bounded instruction
limit; invalid memory and corrupted executables report explicit faults without
affecting BDS.

`Verify:` Compile a C or C++ `main` and an ASM zero-argument function with `-c`,
inspect both objects with `nm` and `objdump`, link them with `ld`, and execute
the result with `run --stats`. Also compile statement-boundary inline assembly
that moves `6` into EAX and attempt an unsafe `asm("push eax")` statement.

`Expect:` The external ASM symbol resolves, the mixed program produces the
expected output under deterministic CPU-cycle accounting, object-relative data
does not overlap, and unsafe inline assembly fails explicitly. Missing and
duplicate symbols must not produce an executable. No command invokes a host
compiler or linker.
