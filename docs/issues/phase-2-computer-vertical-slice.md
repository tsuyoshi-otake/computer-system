# Phase 2: Deliver the Bedrock Computer vertical slice

Parent: #1 Blocked by: #2 and #3

## Scope

- [x] Create installable Behavior Pack and Resource Pack artifacts.
- [x] Add Computer and Advanced Computer blocks and items.
- [x] Transfer stable computer identity between block and item forms.
- [x] Integrate the VM scheduler with Bedrock ticks and lifecycle events.
- [x] Implement the Computer System OS shell and editor.
- [x] Replace the Phase 0 probe implementation with a production terminal view
      coordinator shared by Computers, Pocket Computers, and the Monitor
      fallback.
- [ ] Verify the dedicated ComputerCraft-inspired terminal view on the supported
      GDK client at the reference resolution.
- [x] Model and render 51x19 fixed cells, monospace rows, cursor state, and all
      16 ComputerCraft foreground and background palette colors.
- [ ] Verify background colors and that neither the terminal nor primary input
      controls scroll at the reference resolution.
- [x] Coalesce changed cells, bound redraw work, convert submitted lines into VM
      events, and finalize terminate, cancel, disconnect, competing-form,
      server-close, and failure paths explicitly.
- [x] Implement paged, transactional Dynamic Properties persistence.
- [x] Implement `startup.py`, shutdown, reboot, terminate, and crash reporting.
- [x] Implement six-sided redstone input and validated digital output behavior.

## Automated evidence

- `npm run validate` passes formatting, lint, type checking, 41 test files with
  152 tests, and the production pack build.
- Lifecycle tests cover boot, scheduling, sleep, event wait, completion,
  shutdown, reboot, terminate, syntax failure, and runtime crash ownership.
- Identity tests cover transactional reload, block-item-block transfer,
  duplicate rejection, immutable family, and placement rollback.
- Dynamic Properties tests cover paging, generation isolation, dirty-write
  suppression, checksum validation, and previous-generation recovery.
- Terminal tests cover the 51x19/16-color contract, a 128-cell flush budget, one
  event per submitted line, and exactly one final event for every close path.
- Resource Pack UI tests cover the 51x19 logical dimensions, the native
  CustomForm collection wiring, primary-control bounds, and the absence of the
  indexed planes rejected by GDK 26.33.
- Pack tests generate both Computer items plus 128 hidden block variants for all
  independent six-face digital output masks.

`npm run test:bds` currently stops before launch because `BDS_HOME` is not set
in this workspace. The clean-world and player-experience rubric below therefore
remains an explicit release gate rather than being inferred from host tests.
When configured, the runner requires two passing `computer_vertical` records and
proves identity, snapshot, startup, redstone output, and termination across the
server restart.

The GDK 26.33 client was also exercised at 1280x1030. The production form showed
the terminal-ready text, a 16-color `0` through `f` foreground probe, and the
cursor. Submitting `hello` produced one `> hello`, and Terminate produced one
`Terminal closed: terminated` result while the client remained responsive. This
is partial evidence only. Follow-up experiments confirmed that GDK 26.33 ignores
the Resource Pack's attempted DDUI header/label factory remapping: the native
large header and right-side scrolling container remain. Indexed exact-RGB planes
also failed to resolve at runtime and were removed instead of being left as
test-only behavior. The background palette and disconnect path have not yet been
recorded manually. A dedicated Pocket Computer texture now renders in the hotbar
and first-person hand. GDK confirmed a newly issued `computer-5` opens the
production terminal, remains in its selected slot after Close, and reopens as
the same identity with restored terminal history after saving and reloading the
world. A north-face touch on a generated 3x2 Monitor produced
`monitor_touch north 43 2` and opened that same `computer-5` terminal.

A separate clean creative world then passed the complete in-client headless
suite twice across client restarts. The second run advanced storage generation 3
to 4 and reported `loadedSnapshot: true`, `startupPresent: true`, stable
`computer-900000`, right output mask 2, termination to off, all 16 analog
levels, all 64 digital masks, all six input faces, and zero suite failures. In
that world the production Computer workflow also created and saved `/startup.py`
with a left-input/right-output program. A GDK-only break race was found during
the manual block round trip: the identity moved to the item, but the same
coordinate immediately received a fresh identity. The break handler now owns
that coordinate through next-tick residual cleanup. After rebuilding and
restarting the client, `computer-900006` disappeared on break, produced its
identity-bearing item, and reopened as `computer-900006` after replacement. A
final post-fix headless run (`headless-45173`) again completed with zero
failures. The dedicated competition probe then opened a holder form and a second
form ten ticks later. Run `compete-5972` reported the challenger exactly once as
`competing_form` and the holder exactly once as `cancelled`, while the holder
remained usable until it was closed. A real disconnect cannot be reproduced by
Save & Quit in a single-player world: that operation closes the world server and
therefore exercises `server_closed`. The `disconnected` adapter result requires
the form promise to fail while `player.isValid` is false, so its real-client
check requires a persistent multiplayer host such as BDS; the exact branch and
single-finalization behavior remain covered by the terminal session tests. BDS
later passed the persistent GDK disconnect harness with exactly one
`disconnected` result while the server remained running.

## July 2026 compact identity and Web Terminal update

New Computers now use collision-checked `c-xxxxxx` identities. The six-character
lowercase Crockford Base32 payload decodes to the stable 30-bit
`os.getComputerID()` value. Allocation retries at most 16 times against the
persisted registry. Snapshot schema 2 intentionally does not migrate the earlier
sequential identity examples recorded above; those runs remain historical
evidence only.

The local Web Terminal is the preferred full-width interactive surface. A
Computer has one writer session and any additional browser sessions are
view-only. Viewer input is rejected at both the companion and Bedrock boundary.
The bounded **Take control** transition demotes the previous writer, while
input, takeover, and close operations share one per-Computer serialization lane.
Only the final detached browser session emits `terminal_closed`; different
Computers remain independently writable.

An explicit `WEB_COMPANION_AUTO_OPEN=1` option provides the local one-action
workflow: using a Pocket Computer opens the newly minted handoff once in the
host default browser. It is eligible only when the listener and published origin
are both loopback. Launch work is serialized and bounded, does not use a command
shell, and never removes the 60-second in-game fallback URL when disabled,
blocked, or failed.

Output selection and clipboard behavior now follow terminal conventions: Ctrl+C
copies selected output or command text and interrupts only when no text is
selected. Plain-text paste is newline-normalized, length-bounded, and never
auto-submits. The measured five-session command latency was dominated by the
periodic 5-tick, two-session round-robin. Interactive input now enters a
deduplicated eager queue with fixed per-tick work and bounded attempts. Periodic
work no longer materializes all N sessions on every pass; its hot path is O(K)
for fixed K, while attach/detach retain bounded O(N) maintenance outside the
tick-critical path.

Host verification covers 500 deterministic ID allocations, injected collisions,
persistence reload, writer/viewer assignment, takeover, rejected viewer input,
bounded operation queues, and final-detach ownership. Desktop and 390-pixel
browser checks confirmed a single ownership state, a single takeover action, and
no page-level overflow. A clean managed debug-world reset remains required for
real GDK acceptance because legacy identity snapshots are deliberately ignored.

## Acceptance rubric

`Verify:` In a clean Bedrock world, place a computer, create `startup.py`,
mirror left redstone input to right output, break and replace the computer,
reload the world, and terminate an infinite program.

Open the same terminal from a Computer and Pocket Computer, then from a Monitor
touch. Exercise typed input, continuous output, all 16 colors, cursor movement,
Terminate, normal Close, disconnect, and a competing form.

`Expect:` Identity and files remain stable, startup runs after reload, redstone
events and output work, all lifecycle paths are visible, and Minecraft remains
responsive.

The terminal remains fixed-cell and usable without primary-control scrolling,
continuous output stays within its redraw budget, every submitted line becomes
one VM event, and every close path produces exactly one VM-visible result.

## July 2026 OS profile, persistence, and vi update

The default Linux profile now bootstraps `/etc`, `/dev`, volatile `/tmp`,
`/usr`, `/var`, and `/home/computer` without overwriting existing configuration.
Sandbox identity/time and bounded utility applets include `whoami`, `id`,
`hostname`, `uname`, `date`, `uptime`, `time`, `history`, `sleep`, `test`,
`seq`, `cut`, `stat`, and `df`. OS-specific paths, aliases, environment, boot
files, and virtual devices live behind an application profile boundary. A
minimal DOS fixture proves drive letters, case-insensitive canonical paths, CRLF
boot files, `DIR`/`TYPE`, and `NUL` without importing DOS behavior into the
domain core.

`vi` is a bounded Normal/Insert/Command state machine with cursor movement,
character/line deletion, bounded line-local undo, `:w`, `:q`, `:wq`, and `:q!`.
The fixed viewport highlights Python, shell, JSON/TOML tokens and four repeating
indent backgrounds by default. Web input is coalesced into at most 16 keys per
HTTP/BDS relay and rejected above 32 keys at both transport boundaries.

Persistence remains canonical in World Dynamic Properties/world LevelDB. Clean
checks compare O(1) component revisions; filesystem directory listing uses a
parent index and free-space checks use a cached byte total. Dirty snapshots keep
the checksum-backed copy-on-write protocol while pruning all but the current and
previous complete generations. SQLite remains a future non-Bedrock repository,
not a direct Script API dependency.

The shell follow-up adds wall/game/virtual `date` sources, writer-authorized Tab
completion, Computer System Bash control flow and positional parameters,
non-destructive `/etc/bash.bashrc` plus `~/.bashrc`, `du`, and `quota`. Web
sessions negotiate terminal dimensions from 51x19 through 160x60; native GDK
remains at 51x19. All completion, resize, loop, script, traversal, and output
paths are bounded. `npm run validate` passed 60 files / 242 tests and the
production pack build. A preserved-world BDS restart then completed headless run
`headless-289000` with `failures: 0`.

## July 2026 virtual hardware update

Computer snapshots now persist a validated CPU clock and RAM size, defaulting
legacy machines to 20 kHz and 1 MiB. CPU clock controls per-tick VM credit under
the existing global round-robin scheduler cap. MicroPython instructions and
bounded shell/Bash native work share that credit. Aggregate reachable VM data is
limited by RAM and fails explicitly with `MemoryError`; pressure-triggered live
graph measurement permits unreachable values to be reclaimed without adding an
O(N) scan to every instruction.

Linux reports the same profile through `cpuinfo`, `free`, and dynamic read-only
`/proc` files. DOS reports it through `CPU`, `MEM`, `SYSTEMINFO`, and `VER`
while retaining DOS paths and command discovery. Filesystem quota remains
independent from RAM.

## July 2026 CS486DX toolchain update

Follow-up Issue #12 adds the sandboxed CS486DX toolchain. The visible CPU is a
nominal 33 MHz 486DX while the existing persisted scheduler scale continues to
bound BDS work. ASM, BASIC, C, and C++ safe subsets target one validated
register machine with checked RAM and opcode cycle costs. `run --stats` and
`objdump` make manual optimization observable without allowing native host
execution.
