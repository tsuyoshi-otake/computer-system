# CLAUDE.md

## Project overview

Computer System is a ComputerCraft-inspired Minecraft Bedrock Add-On. Computer
System Python is a deterministic, sandboxed, MicroPython-compatible language
compiled to the shared validated CS process; it has no dedicated Python VM. It
is a user-facing CS486DX/CS486DX2 desktop capability. Portable CS386SX machines
retain ASM, C, C++, BASIC, and bounded DOS batch support but reject user
MicroPython. The persisted hardware profile selects CS486DX, CS486DX2, or
CS386SX execution timing. Minecraft-specific behavior is implemented by thin
Bedrock adapters around host-testable domain and application layers.

GitHub Issue #4 tracks the Phase 2 Bedrock Computer vertical slice. GitHub Issue
#12 tracks the CS-Linux 1.0 / CS-DOS 6.2 shell profiles, virtual disks, CS486
toolchain, Web Terminal, and operator manual expansion. GitHub Issue #13 tracks
Python-to-CS486 compilation, filesystem imports, and CS486 C/C++ extension
modules. GitHub Issue #14 tracks the portable CS386SX 16 MHz / 2 MiB hardware
profile. GitHub Issue #16 tracks tick-sliced guest/MCP execution, runnable-only
scheduler bookkeeping, and real-BDS multi-user load evidence. GitHub Issue #17
tracks the complete CS-Linux multi-user account, superuser, DAC, and legacy
`computer`-to-`cs` migration. GitHub Issue #18 tracks the CS486 assembler v2,
structured relocations, Linux/DOS frontend parity, and stack-boundary hardening.
GitHub Issue #20 tracks OS Presence v1: authoritative per-Computer process,
session, service, mount, device, journal, lifecycle, DOS drive, FAT metadata,
bounded batch state, and the future guest-NIC state boundary. Most Phase 2
behavior is implemented and verified. Production interaction uses the local Web
Terminal companion started with `npm run dev:bds:web`; companion failures must
remain explicit and must not open the native GDK terminal as a fallback.

## Architecture rules

Keep dependencies directed inward:

```text
Bedrock adapters -> application services -> domain/runtime abstractions
```

- Do not import Minecraft APIs into the domain or application core.
- Keep terminal state in the fixed-cell terminal model; Resource Pack UI is a
  rendering and input adapter, not the source of truth.
- Keep GitHub Pages separate from the live Web Terminal. `web/manual.js` is the
  only authored source for the canonical 16-chapter publication; the Pages build
  may pre-render and bundle that source, but it must publish only the explicit
  static-site allowlist and `web/assets/`. Never deploy `web/index.html`,
  `web/app.js`, bearer-token/session code, connection-number forms, `/api/*`
  calls, or any representation that implies the static site can reach BDS.
- Keep shell commands inside `InMemoryFilesystem` and application-layer
  abstractions. Never dispatch terminal input to host PowerShell, `cmd.exe`,
  Node child processes, or BDS administration commands.
- Treat `/etc/passwd`, `/etc/group`, and `/etc/shadow` as the bounded CS-Linux
  account database. Guest filesystem access must pass through the credentialed
  filesystem boundary with a process credential snapshot; no shell command,
  editor, compiler, Python module, startup path, or MCP debug path may bypass
  DAC by reaching the persistence filesystem directly. Even UID 0 must mutate
  those three managed files through the account commands, never by raw file I/O,
  so the validated in-memory indexes cannot diverge from persisted records.
- Reserve the legacy name `computer` permanently in both the CS-Linux user and
  group namespaces so current records can never be mistaken for migration input.
  A user may belong to at most 32 supplementary groups; reject the 33rd before
  changing any account file. Recursive home provisioning belongs to the
  `useradd` transaction, so a capacity or filesystem failure must roll back the
  user, group references, home, and every newly created home ancestor.
- Keep root and elevation explicit. UID 0 is the only superuser identity, root
  starts password-locked, `sudo` membership is independently represented, and
  temporary `sudo`/`su` credentials must terminate or restore their caller on
  every success, failure, cancellation, exit, and disconnect branch.
- `ComputerRuntime` owns final `terminal_closed` security finalization; do not
  delegate it only to the built-in guest shell program. Synchronously disconnect
  the `ShellSession`, cancel credential-capturing foreground, compile, and MCP
  debug work, deliver one bounded resume/close event, and fail safe to shutdown
  if that terminal event cannot be delivered.
- Keep one bounded `OsRuntimeState` per Computer as the authoritative owner of
  Linux lifecycle, PID/PPID/UID/GID/cycle records, shell jobs, login sessions,
  last-login records, service state, active mounts, device state, and journal
  entries. Derive `ps`, job control, login tools, `/proc`, `dmesg`, and guest
  log files from that state; never fabricate an independent view for
  presentation.
- Persist only the cold OS-runtime projection: journals, last-login records,
  service definitions, mount definitions, and offline device identities survive,
  while live processes, jobs, sessions, active mounts, and PID/job cursors
  restart from a validated cold state. Missing legacy state must migrate
  idempotently.
- Keep the future network contract inside `OsRuntimeState.network`: at most 8
  interfaces, 32 addresses, and 64 sockets, with Map-backed identity and
  endpoint indexes. An unused network must serialize exactly like a legacy
  snapshot with no `network` key. Cold persistence keeps interface/address
  definitions but forces links down, zeroes counters, and removes every
  process-owned socket/listener. Do not synthesize `lo`, `eth0`, routes,
  packets, DNS, or `ip`/`ping`/`ss` output until the Issue #6 adapter owns those
  transitions.
- Graceful stop owns a bounded, observable phase sequence: stop new admission,
  signal owned work, drain already-admitted block I/O, save data, unmount, stop
  services/devices, save the final state, then terminate or reboot. A durability
  or deadline failure faults explicitly; `sync` must call the real persistence
  boundary and must not report success when no boundary exists.
- Keep one bounded `DosRuntimeState` per DOS Computer. Drive selection,
  per-drive current directories, media generations, labels, FAT attributes and
  two-second timestamps must mutate transactionally with filesystem operations.
  The same boundary owns shell current-directory/prompt state and the cold-state
  observer: an observer failure must restore and republish the previous
  aggregate. Treat every operand of one DOS command, including multi-path `MD`,
  as one all-or-nothing operation. Filesystem and DOS transaction callbacks must
  be synchronous; reject an async function before it runs and quarantine a
  disguised Promise until it settles so post-`await` work cannot escape
  rollback. The settlement quarantine is shared across every managed filesystem
  and DOS aggregate, so a continuation cannot escape through a second owner
  after its callback stack unwinds. A persisted cold projection always detaches
  transient A: media while preserving C: and its metadata; stale
  media-generation operations fail explicitly.
- Bound scheduler work, redraws, queues, retries, polling, and startup waits.
- Every stateful branch must reach an explicit observable terminal state.
  Cancel, disconnect, competing form, server close, failure, and retry paths
  must each have one finalization owner.
- Preserve computer identity and storage transactionally across block, item,
  portable, monitor, reload, and rollback paths.
- Preserve the startup storage-migration activation boundary: validate the
  current generation before its previous-generation fallback, migrate and verify
  referenced Computers even when the identity storage format is already current,
  repair a recovered fallback into a verified canonical head before completion,
  repair or remove corrupt previous-generation metadata without discarding a
  valid canonical head, and commit a legacy identity registry only after those
  payloads. Recovery may incrementally sweep target-only content blobs, legacy
  indexed pages, or stray manifests that corrupt/interrupted metadata can no
  longer name, but normal periodic saves must never enumerate a whole storage
  prefix. Writer limits must reject a generation before mutation whenever its
  page count or manifest would violate the reader/Dynamic Property contract.
  Advance at no more than one Dynamic Property operation per host tick.
- Mount immutable OS-image bytes from one shared, prevalidated base. Persist
  only per-Computer content-addressed overlays, metadata, hard links, and
  deletion tombstones; never duplicate the base image for every Computer or
  generation.
- Keep guest device deadlines independent from host admission. WorkMonitor may
  defer a due completion, but host elapsed time must never rewrite guest CPU,
  memory, disk, or wire timing.
- Unsupported Bedrock behavior must fail explicitly rather than silently
  approximating incompatible behavior.

## Required verification

Use Node.js 24 or later. Before handing off a non-trivial change, run:

```powershell
npm run validate
```

Relevant focused commands are:

```powershell
npm run test:mcp
npm run test:mcp:bds
npm run test:bds
npm run test:bds:disconnect
npm run build:pages
npm run test:pages
```

`npm run validate` is the standard host gate: formatting, lint, TypeScript type
checking, tests, and the production pack build must all pass. Bedrock-facing
changes also require the smallest applicable real-BDS or GDK verification.
`npm run test:mcp:bds` must include a `linux_authentication/PASS` record proving
pre-login MCP rejection, masked first-boot setup, rebooted `cs`
username/password login, authenticated `whoami`, and explicit runtime shutdown
without emitting the probe password.

For each non-trivial acceptance criterion, record an executable `Verify:` step
and an observable `Expect:` result. Do not treat a successful build as proof of
Minecraft UI behavior.

## BDS and MCP workflow

The Resource Pack cannot run MCP. Use the local stdio companion in
`tools/bds-mcp-server.mjs`, registered as `computer_system_bds` by
`.codex/config.toml`.

The companion exposes status, start, stop, logs, bounded log waits, allowlisted
commands, Computer System probes, exact-Computer non-TUI shell execution, and
computer-scoped Web handoff waits. Preserve the managed debug world for
interactive development and reset it only for clean-world acceptance. MCP shell
execution must remain inside `ShellSession`; never broaden it into host shell or
arbitrary BDS command execution.

`npm run test:mcp:serial:bds` is the isolated real-BDS serial acceptance. Give
it free BDS/Web ports and a new dedicated `BDS_MCP_WORKDIR`; it drives only MCP
tools and requires `serial_matrix/PASS` for three machines, six faces, 36
ordered links, and 72 bidirectional Linux ttyS/DOS COM transmissions before
stopping the isolated server. Do not point it at the interactive managed world.

### MCP Computer benchmark and load-test procedure

Use the MCP companion for guest-machine measurements; do not substitute a host
Python, compiler, shell, or timer. The repeatable sequence is:

1. Call `bds_status`, then call `bds_start` with `resetWorld: false` for
   ordinary work. Use `resetWorld: true` only for an explicitly requested
   clean-world acceptance run. Confirm Script API readiness and the expected
   player count with `bds_run_command {"command":"list"}` and bounded log
   inspection.
2. Resolve the current managed world's exact `c-xxxxxx` identities and persisted
   hardware profiles. Do not assume that an old four-digit browser code,
   Computer ID, LAN address, or player name is still valid. A browser code is a
   Web entry credential, not the identity accepted by MCP execution.
3. Create benchmark sources inside each Computer's sandbox. Keep every
   `bds_execute_computer_command` request to one non-TUI shell line and at most
   128 characters; use several bounded `echo`/redirection calls when necessary.
   If DOS quoting cannot represent a source line safely, enter it through the
   Web Terminal editor instead of widening MCP into host or BDS command access.
4. Compile inside the guest with `as`, `basicc`, `cc`, or `c++`, then execute
   the resulting validated CS486 binary with `run --stats <program>`. For Python
   on CS486 machines, use bounded `python <file>`, `micropython <file>`, or
   `python -c <source>` through the same MCP tool. A CS386SX status 127 for user
   Python is the expected hardware restriction, not a failed benchmark setup.
5. Use the same algorithm, input size, expected checksum, cold process start,
   and compiler mode on every language and hardware profile. Record `stdout`,
   `stderr`, `exitCode`, and `cpuCycles`. Treat the instruction/cache/bus/cycle
   diagnostics from `run --stats` or Python as the authoritative modeled guest
   cost; wall-clock MCP latency includes relay, shell, compile, and tick delay
   and is useful only as a separately labeled responsiveness measurement.
6. Run correctness and single-Computer measurements sequentially first. For a
   load test, increase bounded concurrency deliberately, never exceed the MCP
   debug pending-command limit, and record server tick p50/p95/p99/max plus MCP
   response latency. A successful response and quiet logs do not prove the 50 ms
   BDS tick budget was met. A timeout, status 124, or yielded/incomplete process
   is not a language-speed result.
7. After each load stage, call `bds_get_logs` from the saved cursor and inspect
   watchdog, crash, fatal, Script API, queue-capacity, and slow-tick evidence.
   Verify Minecraft interaction and Web typing remain responsive. Exercise one
   request above each documented capacity and require an explicit bounded
   rejection while existing work continues.

For a minimal compiled measurement, call:

```json
{
  "computerId": "c-xxxxxx",
  "command": "run --stats /tmp/bench",
  "timeoutMs": 30000
}
```

On CS-DOS use its valid 8.3 path syntax. The tool returns at most bounded output
and rejects TUI editors, sleep, lifecycle commands, unknown identities, commands
over 128 characters, and timeouts over 30 seconds. Keep authentication secrets,
one-use Web URLs, and bearer tokens out of repository files and logs. Issue #16
owns conversion of synchronous guest and MCP execution to fixed per-tick slices;
until it is complete, do not claim multi-user capacity from sequential MCP
results alone.

`BDS_HOME` is a read-only distribution source. Never modify or recursively
delete it. The default managed work directory is
`%USERPROFILE%\tmp\computer-system-bds\mcp-runtime`. A custom `BDS_MCP_WORKDIR`
must be a dedicated directory; tooling must not reset a non-empty custom
directory.

BDS reports transport readiness before Script API initialization is complete.
Keep the bounded startup grace period. For player UI probes, wait until the
player has finished joining before opening a form, and retry a bounded number of
times when the result is `competing_form`.

Minecraft for Windows may reject loopback with `InitialConnection-13`. When that
happens, connect to the BDS port through the machine's active LAN IPv4 address.
Do not hard-code a workstation-specific address in repository files.

## Current terminal UI findings

The July 2026 live GDK verification established the following:

- Minecraft connected to the persistent managed BDS runtime on port 19142.
- The MCP `ui` probe reached the player and opened the production Resource Pack
  terminal.
- The form displayed the terminal title, ready text, cursor, and all 16 color
  samples.
- Closing the form produced exactly one `CS_TERMINAL_CLOSE` record with
  `kind: "cancelled"`.
- At a 2560-pixel-wide desktop, the native form remained roughly 700 logical
  pixels wide, and scrolling could leave a large blank content region. This is a
  client CustomForm constraint rather than a terminal-model constraint.
- The Web Terminal renders the same terminal snapshot in a full-width browser
  screen. Its semantic input is visually overlaid at the terminal cursor, so
  physical typing appears immediately after the shell prompt instead of in a
  separate text box. Each writer session normalizes the guest hardware text mode
  to 80x25 once; CSS scaling subtracts stage padding and fits both axes without
  mutating cell geometry, and the stage stays scrollbar-free.
- Physical Enter submits `terminal_line`; Ctrl+C copies selected terminal or
  command text and invokes the bounded interrupt only without a selection;
  bounded plain-text paste never auto-submits; Up and Down navigate local
  command history.
- The header Copy action copies a terminal selection or the visible cell grid on
  demand and has no polling path. Bare `vi` opens `[No Name]`, an empty `:` line
  exits with Backspace, and `:w path` assigns the first file name. DOS EDIT
  supports bounded document/word navigation and Ctrl+Y line deletion.
- Memory reports add bounded OS residency to dynamic guest usage: CS-Linux
  separates kernel, services, buffers, and guest runtime; CS-DOS separates its
  system/driver footprint while preserving conventional/UMB/XMS totals.
- Portable, Desktop, and Advanced Desktop Computers expose 20 MiB, 40 MiB, and
  80 MiB fixed IDE disks. A fresh CS-Linux image uses roughly 2–4 MiB and a
  fresh CS-DOS image roughly 0.5–1 MiB. Utilities are sized executable files
  under the shared base image; deleting one creates a persistent per-Computer
  tombstone and makes the command unavailable until its file is restored.
- CS-DOS commands return CRLF and DOS-specific text. `TIME` displays the guest
  clock while `TIMER` measures bounded command execution; `DIR`, `COPY`,
  `DEL`/`ERASE`, `MD`/`RD`, `MOVE`, `REN`/`RENAME`, `TYPE`, `TREE`, `VOL`,
  `VER`, `DOSKEY /HISTORY`, `MEM /F`, `ATTRIB`, `LABEL`, and read-only `CHKDSK`
  must not leak Linux output. A: and C: keep separate current directories;
  bounded `*`/`?` expansion, FAT two-second mtimes, R/H/S/A attributes, volume
  labels, and `DIR /A` use the persisted `DosRuntimeState`. `TREE` remains O(N),
  capped at 512 entries and 32 levels. Production A: stays absent until a media
  adapter exists, and cold restore must always detach it. Single-path writes,
  `MD`/`RD`, wildcard `COPY`/`REN`/`DEL`, `MOVE`, and `ATTRIB` trial their full
  FAT aggregate clone, then commit filesystem bytes/inodes and FAT state inside
  one bounded undo transaction. Nested writes reuse the outer boundary.
  Post-mutation failure injection must restore the exact filesystem snapshot,
  inode/link identity, metadata, revision, byte/blob accounting, and DOS state.
- DOS batch execution supports bounded labels, `GOTO`/`GOTO :EOF`, internal and
  external `CALL`, `SHIFT`, `IF [NOT] ERRORLEVEL`, `IF [NOT] EXIST`, and
  `COMMAND /C` or `/K`. Default ceilings are 256 lines and labels, nine
  positional arguments, call depth 8, 1,024 jumps, 4,096 steps, 64 loaded
  programs, 4,096 expanded-command characters, and 256,000 output characters.
  This is not native COMMAND.COM or `.COM`/`.EXE` execution.
- CS-Linux boots real bounded OS state: PID 1 is `/sbin/cs-init`, `cs-login`
  owns a waiting getty, an authenticated shell becomes their child, and admitted
  Python/CS486/background work receives a PID, credentials, state, and modeled
  cycle account. `ps`, snapshot-only `top`, `kill`, `jobs`, `fg`, `bg`, `wait`,
  `tty`, `who`, `w`, `last`, status-only `service`, `man`, and `apropos` read
  that state. Only one interactive `sleep`, `python`/`micropython`, or `run`
  command may use trailing `&`; redirects, pipelines, scripts, aliases,
  functions, MCP submissions, and unsupported commands fail before side effects.
- The Linux prompt is `<login>@<computer-id>:<path>$` or `#`. Login displays a
  previous-session line when available, then the real `/etc/motd`; history is
  capped at 100 entries, 512 UTF-8 bytes per line, and 32 KiB total and persists
  in the user's mode-0600 `.bash_history`. Secret input never enters it.
- `/proc/devices`, `/proc/services`, `/proc/loadavg`, `/proc/mounts`,
  `/proc/<pid>/{cmdline,stat,status}`, and `/proc/self/*` are dynamic
  state-backed views. `/var/log/messages`, `/var/log/auth.log`, and `dmesg` read
  the bounded journal (256 entries and 32 KiB by default). `/dev/null`,
  `/dev/zero`, `/dev/tty`, `/dev/console`, `/dev/tty1`, `/dev/hda`, and
  absent-media `/dev/fd0` share the device registry; they do not imply host
  Linux devices.
- `OsRuntimeState.network` is an empty-by-default schema-1 boundary for the
  future Issue #6 guest-NIC adapter. It bounds interfaces/addresses/sockets at
  8/32/64, uses Map-backed identity/endpoint lookup, propagates successful
  mutations to the outer revision, and rejects capacity-plus-one without a
  partial state change. Cold projection retains interface/address definitions
  but forces links down and counters to zero, removes every socket/listener, and
  stays omitted entirely when unused. It does not ship `lo`, `eth0`, routes,
  packets, DNS, `ip`, `ping`, or `ss`.
- Shutdown and reboot stop admission and advance through signal, owned-work
  drain, admitted-I/O drain, data sync, unmount, service/device stop, final
  sync, and termination. Each phase has a 200-tick deadline and at most 16
  stopping Computers advance per host tick. A sync failure faults instead of
  claiming a clean stop. Before the one final callback, append only truthful
  `final sync requested` and intent-prepared records; their presence after cold
  restore proves that boundary included them. Never append a post-callback
  success line that would itself be unsaved. If either marker append or the
  callback fails, remove only that attempt's provisional markers before the
  shared fault finalizer runs, so a later dirty-record retry cannot persist
  false final-boundary evidence. The one-shot safe boot preserves but bypasses a
  broken `/startup.py`. Expose it only while the Computer is `crashed`: the Web
  power action becomes `safe_boot`, and a Bedrock player must sneak while
  opening the crashed Computer. A normal interaction prints that recovery
  instruction. Neither adapter may reset, delete, rename, or rewrite the startup
  file, and the guest shell and MCP debug path must not gain a safe-boot
  command.
- CS-Linux initializes `cs` at UID/GID 1000 with `/home/cs`, `/bin/bash`, and
  membership in the `sudo` group. Root is UID/GID 0 and initially
  password-locked. `/etc/passwd`, `/etc/group`, and `/etc/shadow` are the
  authoritative bounded account database; `passwd`, `useradd`, `userdel`,
  `usermod`, `groupadd`, and `groupdel` update it transactionally. `sudo` grants
  scoped effective privilege only to members of `sudo`, while `su` authenticates
  the target account. Direct mutation of the three account files is rejected,
  including for root; account commands own their atomic update boundary. The
  credentialed filesystem enforces owner/group/other access, directory
  traversal, ownership changes, sticky directories, protected hard links, and
  per-session `umask`; setuid/setgid bits never create a hidden privilege path.
  UID 1000 is the protected boot-service account: resolve its current name,
  primary group, supplementary groups, and home from the account database, never
  from a static `cs` credential. It may be renamed or moved only while inactive,
  but guest `userdel` must not remove it. Trusted desktop boot creates only an
  empty mode-0644 `/startup.py` owned by that account; `/` remains root-owned.
  An empty startup file selects the built-in shell source, while a non-empty
  file executes as the authoritative UID 1000 identity. The backward-compatible
  filesystem snapshot persists mode, UID, GID, mtime, symbolic links, and shared
  hard-link contents. Linux-facing commands use LF and Linux-style identity,
  listing, stat, time, memory, disk, mount, and error output. `/proc/version`,
  `/proc/uptime`, `/proc/loadavg`, and `/proc/mounts` are dynamic read-only
  devices. Hard-link counts are O(1) so `ls -l` remains O(N); materializing
  utilities have explicit limits. The legacy name `computer` remains reserved
  for both users and groups after migration. Account mutations cap each user at
  32 supplementary groups, and over-limit or failed recursive `useradd` home
  provisioning is transactional with no partial account or directory tree.
- `EDIT` is a DOS-profile-only full-screen editor. Its blue viewport, five
  menus, insert/overwrite state, bounded undo/search, save feedback, and dirty
  Save/Discard/Cancel dialog are rendered from the terminal model. Linux rejects
  `EDIT` and uses the syntax-highlighted `vi` editor. Bare `EDIT` opens an
  `UNTITLED` buffer backed by `C:\NONAME.TXT`. Web terminal color spans fill the
  complete cell height so full-screen backgrounds do not develop row gaps.
- New identities use a collision-checked `c-xxxxxx` format. The lowercase
  Crockford Base32 payload decodes to the stable 30-bit numeric computer ID;
  migration does not renumber an existing `computer-N` identity or accept an
  unsupported identity-payload schema. It only re-encodes a valid schema-2
  identity registry from the legacy paged-store format.
- Startup recognizes legacy schema-1 indexed page manifests and schema-1
  Computer/filesystem snapshots. It migrates and verifies referenced Computers
  before writing the identity generation last, logs state transitions as
  `CS_STORAGE_MIGRATION`, and gates Computer/Web startup until an explicit
  terminal result. A restart rescans safely and skips already-current Computer
  generations.
- A Computer has one Web Terminal writer lease. Each newly opened session takes
  control immediately and demotes the previous writer to view-only. A demoted
  session may use **Take control** to reclaim the lease. Viewer input is
  rejected at both transport boundaries, and only the final detached session
  emits `terminal_closed`.
- Each Computer derives a permanent four-digit browser connection number from
  its stable identity. A machine interaction activates that number once for two
  minutes; invalid guesses are rate-limited per client and simultaneous code
  collisions fail explicitly. Browser bearer tokens do not pass through BDS
  logs. Placed-machine sessions require the player to remain within three blocks
  and pause as `out_of_range` otherwise. Returning resumes the same live stream;
  a bookmark at `/?computer=NNNN` reconnects with the locally remembered number
  and rotates the bearer token. Access logs are transition-only, connection-code
  lookup is O(1), and browser retry work is deduplicated, exponentially backed
  off, and bounded by the 30-minute session lifetime.
- `bds_issue_web_handoff` atomically installs a Computer-scoped waiter and asks
  the single connected debug player to issue that exact Computer's one-use URL.
  `bds_wait_for_web_handoff` retains the passive interaction-first workflow.
  Both own at most one bounded wait per Computer ID and suppress auto-open for
  the matching handoff, preventing one-use URL races. Zero or multiple players
  and every request/relay/timeout failure finalize explicitly.
  `bds_execute_computer_command` returns bounded stdout, stderr, exit code, and
  modeled CPU cycles for one exact Computer's selected hardware model. TUI,
  sleep, and lifecycle-control commands fail explicitly on this debug path.
- The normal CS-Linux shell runs `python <file>`, `python --stats <file>`, and
  the `micropython` alias as one foreground CS486 process. It may wait for guest
  events and returns to the prompt after completion, failure, or Ctrl+C. The
  non-TUI MCP debug forms accept `python <file>` and bounded multiline
  `python -c <source>`, reject waits and long-running execution, and do not
  authenticate the interactive shell. Only this Python form may contain encoded
  line breaks; other debug commands remain single-line. Both paths require a CPU
  specification with MicroPython enabled, use the same timing unit as ASM, C,
  C++, and BASIC, and return status 127 on CS386SX.
- Periodic snapshot work is fixed-batch O(K), without an O(N) allocation per
  pass. Writer input uses an amortized-O(1), deduplicated, attempt-bounded eager
  queue so interactive latency does not inherit the viewer round-robin delay.
- `ComputerWorkMonitor` owns one host-time scope per BDS tick and fixed lanes
  for CPU, compilation, MCP, block I/O, RS-232C, I2C, SPI, redstone, topology,
  terminal, and persistence work. The `block_io` lane admits only due HDD/FDD
  completions from one bounded deadline heap; idle devices are never polled.
  Host time is admission/observability only and must never be converted into
  guest cycles or wire timing. Normal `run` and MCP Python/CS486 execution are
  resumable scheduler jobs with machine-instruction ceilings. RS-232C uses an
  O(1) ready deque with exact removal on disconnect. I2C/SPI remain bounded
  256-byte synchronous atoms accounted inside the guest CPU lane until their
  adapters expose explicit resumable/deferred outcomes; do not claim their
  reserved lanes as separate production measurements yet. See
  `docs/work-monitor.md`.
- Admit bounded native shell and terminal work before executing it. A
  post-execution admission check can turn an otherwise successful command into
  an uncaught host-budget failure after its side effects have already occurred.
- BDS 1.26 rejects a custom block that declares both
  `minecraft:redstone_consumer` and `minecraft:redstone_producer`. Computer
  blocks keep the producer component and sample all six adjacent inputs through
  the existing fixed-batch redstone poll; do not restore the incompatible
  consumer component.
- With `WEB_COMPANION_AUTO_OPEN` unset, a literal published IP that belongs to
  the companion host automatically opens the activated path through loopback in
  that host's default browser. `0` disables this behavior and `1` enables it
  explicitly while retaining listener-reachability checks. A custom public
  origin never enables automatic mode. The check identifies the server endpoint,
  not the initiating player's IP, and cannot open a remote player's browser;
  Minecraft prints the stable LAN entry page and four-digit number for that
  player instead.
- Production CS-Linux requires first-boot password setup for `cs`; later boots
  require both a username and password and may authenticate any unlocked
  account. Root starts locked and cannot log in until an administrator
  deliberately sets its password. Salted bounded SHA-256 records live in
  `/etc/shadow`; plaintext is never persisted or echoed. Secret Web input is
  masked and excluded from browser history/completion. MCP shell execution is
  rejected before login.
- Login-disabled development sessions must refresh the authoritative UID 1000
  credentials, login environment, and working directory after disconnect; clear
  elevated environment state and fall back to `/` with an explicit warning when
  the current home is unavailable. When no account is authenticated, retain only
  the unprivileged `nobody` filesystem identity; never restore a static `cs` or
  `sudo` credential.
- The recognized legacy `computer` account is completely renamed to `cs` during
  boot migration: `/home/computer` moves to `/home/cs`, the old
  user/group/shadow keys disappear, and no alias or compatibility symlink
  remains. Preserve the exact password payload, UID/GID, file contents, modes,
  ownership, mtimes, symbolic links, hard-link identities, and tombstones.
  Migration must be idempotent and fail explicitly on an ambiguous/conflicting
  destination.

Reproduce native Resource Pack UI changes on the real GDK client. For Web
Terminal changes, run the focused Web tests and verify the connected state,
inline typing, physical Enter, and disconnect behavior in a real browser.

The Web Terminal includes a searchable 16-chapter field manual. Its canonical
publication order is: orientation and machine choice; terminal, Web access, and
editors; filesystem, storage, and persistence; the CS-Linux shell; Computer
System Python; Redstone, peripherals, and events; a worked project; the Python
API reference; architecture and execution; assembly; BASIC; C/C++; optimization;
CS-DOS; diagnostics and recovery; then limits, compatibility, glossary, and
indexes. Goal paths use stable chapter IDs and may skip through that order for
first-program, Python-and-Redstone, CS-Linux, native-development,
Portable-CS-DOS, and diagnostic work. Keep chapter and section IDs, generated
numbers, search results, Previous/Next navigation, and every goal path
synchronized. `tests/tools/webManual.test.mjs` locks the publication order and
chapter/header agreement. The GitHub Pages manual is a static, progressively
enhanced projection of this same module: every chapter and stable hash target
must remain readable without JavaScript, while enhanced search retains the same
24-result bound. It is never a Web Terminal endpoint and cannot authenticate,
connect to BDS, accept a Computer number, or submit guest input. Build it with
`npm run build:pages`, verify it with `npm run test:pages`, and publish only
`dist/pages` through `.github/workflows/pages.yml`.

## Web companion networking

The BDS companion entry points listen on `0.0.0.0:80` by default and select a
non-virtual LAN IPv4 address. `WEB_COMPANION_HOST` controls the listener, while
`WEB_COMPANION_PUBLIC_HOST` overrides the detected address. For Internet access,
keep the process on loopback, set `WEB_COMPANION_PUBLIC_ORIGIN` to an HTTPS
origin, and use a TLS reverse proxy. Never publish plain HTTP to the Internet.
Administrators persist the listener port and complete public origin with
`npm run web:config -- set --port PORT --url ORIGIN`. The versioned system-wide
JSON is loaded by both companion entry points; environment values remain
explicit per-process overrides. Reject unknown fields and invalid origins, and
require a restart after configuration changes.

`WEB_COMPANION_DEBUG_IGNORE_RANGE=1` is a managed-debug-only escape hatch for
the placed-machine three-block and dimension check. It is disabled by default
and must not bypass the initial interaction, player connection, writer lease,
bearer token, session lifetime, or disconnect finalization.

## Shell compatibility

The CS-Linux 1.0 shell is a bounded BusyBox-compatible subset implemented by
`shellSyntax.ts`, `shellCommands.ts`, and `shellSession.ts`. It supports
quoting, variables, `$?`, `|`, `<`, `>`, `>>`, `&&`, `||`, `;`, and bounded
`sh`/`bash` scripts. Pipeline data stays in memory and is capped; script depth
and line counts are capped; regex-like user input must not introduce an
unbounded regular expression execution path. Add applets to the sandboxed
command runtime rather than invoking host tools.

The CS486 toolchain uses versioned `CS486OBJ` relocatable objects and validated
`CS486` executables. `as`/`cc`/`c++`/`basicc -c`, `ld`, `nm`, and `objdump` must
remain entirely sandboxed. Assembly flows through the dedicated tokenizer,
bounded preprocessor, parser, constant-expression evaluator, and source-span
diagnostics. Include reads stay inside the credentialed guest filesystem.
Character and token budgets must be checked before token arrays, definition
expansions, or macro output are appended. New writers emit v2 objects with
`.text`, `.rodata`, `.data`, and `.bss`, typed symbols, initialized data,
alignment, and structured relocations; readers keep v1 compatibility. Linker
symbol lookup and local relocation lookup are Map-backed and bounded, layouts
are computed once, and assembly text must never be regex-rewritten during
linking. Duplicate/unresolved/type-mismatched symbols, corrupt objects,
excessive objects, section data, relocations, and RAM overflow fail explicitly.
Neither `CS486OBJ` nor `CS486` is ELF, OMF, DOS COM/EXE, or native x86. The
current ABI exposes zero-argument integer functions with EAX returns. Restricted
statement-boundary inline assembly may not introduce labels, control flow, stack
operations, or ESP/EBP access. Dynamic linking is not implemented yet; extend
the versioned object/ABI boundary rather than dispatching to a host linker or
loader.

CPU identity, clock, and RAM are one persisted hardware profile. Desktop
Computer Systems default to CS486DX at 33 MHz with 2 MiB RAM. Advanced Desktop
Computer Systems default to CS486DX2 at 66 MHz with 8 MiB RAM. Portable Computer
Systems default to DOS on CS386SX at 16 MHz with 2 MiB RAM.
`instructionTiming.ts` selects timing in O(1): CS486DX and CS486DX2 share the
existing 486 instruction costs and differ by persisted clock rate, while CS386SX
uses Intel 80386-derived arithmetic, branch, early-out multiply, and 16-bit
data-bus penalties. The scheduler derives per-tick credit from the persisted
clock. Keep the shared executable and ABI representation; never fork a
language-specific CPU engine. Profile migration may rewrite only an exactly
recognized former default and must leave every customized OS or hardware field
unchanged.

`CpuMemoryHierarchy` is transient per shared CS process and must remain O(1) per
instruction/access with fixed storage. CS386SX has no L1 or L2; even-addressed
32-bit data uses two 16-bit bus transfers and odd-addressed data uses three.
CS486DX and CS486DX2 use a cold 8 KiB four-way unified L1 with 16-byte lines and
write-through stores; CS486DX2 additionally uses a 256 KiB external L2. Do not
persist cache tags, recency, prefetch state, or counters. Neither CPU has
dynamic branch prediction: count taken control transfers as deterministic
pipeline or prefetch flushes. Keep `run --stats`, CPU identity output, CSBIOS,
tests, and the manual synchronized with L1/L2 hits and misses, bus transfers,
unaligned accesses, pipeline flushes, and the default SIMM descriptions.

Each Computer selects one versioned fixed-disk profile: Portable uses 20 MiB,
Desktop 40 MiB, and Advanced Desktop 80 MiB. Fixed IDE requests model controller
setup, CHS seek, 3,600 RPM rotational latency, PIO transfer, and write settling.
The future-ready 1.44 MiB FDD profile models 80 cylinders, two heads, 18 sectors
per track, 300 RPM, motor spin-up/idle, media generations, write protection,
ejection, and DMA/controller timing. No operator media-insertion command ships
yet, so production FDD state remains `absent` until that adapter is added. Keep
queues, request sizes, due completions, and per-tick delivery budgets bounded.

OS image files have real sizes, modes, and inode identities. The Linux and DOS
base images are immutable and shared; every mount must reuse their prevalidated
content IDs in O(number of image files), while Computer snapshots store only
copy-on-write blobs, metadata changes, hard-link identities, and tombstones.
Command discovery and execution must validate the installed executable file, so
deleting `/usr/bin/ls` or `C:\COMMAND\EDIT.COM` returns status 127 on later use.

Each Computer also persists one versioned display-profile ID. Portable selects
`portable-vga-256k`; Desktop selects `desktop-vga-512k`; Advanced Desktop
selects `advanced-vga-512k`. All profiles stop at 640x480. Portable supports
80x25 text, 320x200x8, and 640x480x4 with 256 KiB VRAM on an 800x480 physical
LCD. Both desktops add 640x480x8 with 512 KiB VRAM on a 640x480 Monitor. Keep
framebuffer bytes transient: `DisplayDevice` allocates VRAM on POST, releases it
at power-off, marks dirty tiles in O(1), and drains a fixed-capacity ring in
bounded O(D) batches. Never add display revision or framebuffer data to the
World Dynamic Property persistence revision.

Power-on owns one observable CSBIOS handoff: `powerOn()` enters `post` and
renders the actual profile in 80x25; the next runtime step clears POST, enters
`text`, and lets the guest run. CS-DOS starts with only its OS identity, one
blank line, and `C:\>`; CS-Linux starts with only its OS identity, one blank
line, and the password or shell prompt. Neither profile prints a simulated
`tty1` or startup shell-version banner. Syntax/runtime failure terminates
display state as `faulted`; shutdown and reboot finalization release VRAM
explicitly. The current text TerminalBuffer remains the Web source of truth.
`ComputerDisplayDeltaBroker` is the sole destructive dirty-tile drain owner. It
drains once per Computer, publishes the same immutable update to all attached
consumers, gives late consumers a complete queued keyframe, increments epochs on
mode/device replacement, and releases its entry after the final detach. Keep its
per-pass Computer, tile, and byte budgets fixed. The next graphics increment is
to connect this broker to a Web Canvas adapter; never serialize or drain a
framebuffer separately for every Web session.

Authored machine plates live in `web/assets/machines/`; CPU identification
plates live in `web/assets/cpu/`. Manual Chapter 2 serves both sets directly.
The build derives bounded transparent 256 px item icons from the four machine
plates through `tools/machine-textures.mjs`. Purpose-built geometry, terrain
atlas entries, and 16 px face textures come from
`tools/machine-block-assets.mjs`; keep the isometric plates out of block-face UV
maps. Reject unsupported source PNGs explicitly and increment the Resource Pack
version whenever shipped artwork changes.

Desktop and Advanced Desktop Web Terminal access requires exactly one physically
adjacent Monitor. Selecting a bare desktop must not request a browser handoff,
and a Monitor with zero or multiple adjacent desktop identities must fail
explicitly. Portable Computer Systems have a built-in display and may open Web
Terminal while held or placed. Their item/block round trip must preserve one
persistent identity and retain the CS386SX/CS-DOS hardware profile.

Computer System Python parses directly to CS486 control flow plus the
allowlisted `python` syscall ABI in `pythonCs486.ts`. Calls, returns, branches,
waits, instruction accounting, and cycle debt belong to `Cs486Process`; do not
reintroduce a Python instruction pointer, bytecode VM, or scheduler. Python
module lookup is bounded and deterministic: importer directory, `/lib/python`,
`/usr/lib/computer-system/python`. `.py` modules initialize once. Imported `.o`
modules must be valid `CS486OBJ` files and expose only the current zero-argument
EAX-return ABI. Keep module graph resolution O(source + modules), explicitly
terminate missing/circular/oversized imports, and charge extension instructions
to the same process. The native `shell` module is an internal capability of only
the built-in shell program selected by an empty `/startup.py`; it must be
unavailable to user-authored `/startup.py`, foreground Python, and MCP Python.

Keep OS-specific behavior behind `osProfile.ts`: path dialect, boot layout,
environment, aliases, and virtual devices must not leak into the domain
filesystem. Linux is the default persisted profile; the DOS fixture protects
drive-letter, case-insensitive, strict 8.3, CRLF, and `NUL` semantics, and
Portable Computer Systems select DOS explicitly. New DOS volumes start at `C:\>`
and do not create a Linux-like `C:\USERS` hierarchy. DOS startup processes at
most 64 `CONFIG.SYS` lines and 256 lines per batch, with depth 8, explicit
failure, and a modeled conventional/UMB/XMS layout. Only the built-in
HIMEM/EMM386 and `DOS=HIGH|LOW,UMB|NOUMB` contract may affect that layout; never
change memory state from a driver basename alone. Validate the referenced
installed HIMEM/EMM386 guest file and its versioned capsule first. Never claim
native drivers, paging, BIOS/DOS interrupts, TSRs, or `.COM`/`.EXE` execution.
DOS `EDIT` and cross-profile `vi` use writer-owned bounded `terminal_keys`
batches and render only their fixed viewports. Every menu, search, save, exit,
failure, and resize branch must return an explicit editor state. Syntax and
indent highlighting must scan no more than the visible columns/rows per redraw.

World Dynamic Properties remain the Bedrock source of truth (physically the
world LevelDB). Clean persistence checks use component revision tokens, not
whole-snapshot JSON fingerprints. Retain only the current and previous complete
paged generations, address pages by content, reuse unchanged page properties,
and preserve the checksum-backed, current-head-first fallback before expanding
storage features. The startup migrator may read schema-1 indexed pages and
schema-1 Computer/filesystem payloads, but it must commit and verify each
current-format Computer before the identity registry is activated last. Every
branch must terminate as complete or failed, one tick may perform at most one
Dynamic Property read/write/delete, and restart must be idempotent. Never
inspect or copy a live world LevelDB for deployment; stop BDS and back up the
complete world first. SQLite belongs only behind the repository boundary for a
future non-Bedrock host.

## Development conventions

- Keep source, tests, documentation, and Issue evidence synchronized.
- Do not commit generated `dist/` output unless a release workflow explicitly
  requires it.
- Preserve unrelated working-tree changes.
- Use English commit messages with a useful description and reference Issue #4
  while Phase 2 work remains in scope. Reference Issue #12 for the OS,
  toolchain, Web Terminal, and field-manual work it tracks; reference Issue #15
  for the full-screen `EDIT` implementation; reference Issue #17 for CS-Linux
  users, superuser security, DAC, and account/home migration; reference Issue
  #18 for assembler v2, CS486OBJ sections/relocations, DOS frontend parity, and
  stack guards.
- Keep temporary scripts and work artifacts under `%USERPROFILE%\tmp`, not the
  user home directory root.

Further details are in `README.md`, `docs/development.md`,
`docs/mcp-debugging.md`, and `docs/manual-verification.md`.
