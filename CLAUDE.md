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
#12 tracks the CS-Linux 1.0 / CS-DOS 6.2 shell profiles, CS486 toolchain, Web
Terminal, and operator manual expansion. GitHub Issue #13 tracks Python-to-CS486
compilation, filesystem imports, and CS486 C/C++ extension modules. GitHub Issue
#14 tracks the portable CS386SX 16 MHz / 2 MiB hardware profile. Most Phase 2
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
- Keep shell commands inside `InMemoryFilesystem` and application-layer
  abstractions. Never dispatch terminal input to host PowerShell, `cmd.exe`,
  Node child processes, or BDS administration commands.
- Bound scheduler work, redraws, queues, retries, polling, and startup waits.
- Every stateful branch must reach an explicit observable terminal state.
  Cancel, disconnect, competing form, server close, failure, and retry paths
  must each have one finalization owner.
- Preserve computer identity and storage transactionally across block, item,
  portable, monitor, reload, and rollback paths.
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
```

`npm run validate` is the standard host gate: formatting, lint, TypeScript type
checking, tests, and the production pack build must all pass. Bedrock-facing
changes also require the smallest applicable real-BDS or GDK verification.

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
  separate text box. Grid negotiation subtracts stage padding and fits both
  axes; the terminal stage stays scrollbar-free.
- Physical Enter submits `terminal_line`; Ctrl+C copies selected terminal or
  command text and invokes the bounded interrupt only without a selection;
  bounded plain-text paste never auto-submits; Up and Down navigate local
  command history.
- `EDIT` is a DOS-profile-only full-screen editor. Its blue viewport, five
  menus, insert/overwrite state, bounded undo/search, save feedback, and dirty
  Save/Discard/Cancel dialog are rendered from the terminal model. Linux rejects
  `EDIT` and uses the syntax-highlighted `vi` editor. Bare `EDIT` opens an
  `UNTITLED` buffer backed by `C:\NONAME.TXT`. Web terminal color spans fill the
  complete cell height so full-screen backgrounds do not develop row gaps.
- New identities use a collision-checked `c-xxxxxx` format. The lowercase
  Crockford Base32 payload decodes to the stable 30-bit numeric computer ID;
  legacy identity snapshots are not migrated automatically.
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
- `bds_wait_for_web_handoff` owns at most one bounded wait per Computer ID and
  suppresses auto-open for its matching handoff, preventing one-use URL races.
  `bds_execute_computer_command` returns bounded stdout, stderr, exit code, and
  modeled CPU cycles for one exact Computer's selected hardware model. TUI,
  sleep, and lifecycle-control commands fail explicitly on this debug path.
- The MCP-only `python <file>`/`micropython <file>` debug forms execute a
  bounded source file only when the target CPU specification enables
  MicroPython. CS386SX returns status 127. CS486DX and CS486DX2 reject waits and
  long-running execution; their returned `cpuCycles` use the same timing unit as
  ASM, C, C++, and BASIC.
- Periodic snapshot work is fixed-batch O(K), without an O(N) allocation per
  pass. Writer input uses an amortized-O(1), deduplicated, attempt-bounded eager
  queue so interactive latency does not inherit the viewer round-robin delay.
- `WEB_COMPANION_AUTO_OPEN=1` opens the activated path through loopback in the
  companion host's default browser even while the published entry page uses a
  LAN address. It cannot open a remote player's browser; Minecraft prints the
  stable LAN entry page and four-digit number for that player instead.
- Production CS-Linux requires first-boot password setup and later login. The
  salted bounded SHA-256 record lives in `/etc/shadow`; plaintext is never
  persisted or echoed. Secret Web input is masked and excluded from browser
  history/completion. MCP shell execution is rejected before login.

Reproduce native Resource Pack UI changes on the real GDK client. For Web
Terminal changes, run the focused Web tests and verify the connected state,
inline typing, physical Enter, and disconnect behavior in a real browser.

The Web Terminal includes a searchable 16-chapter field manual. Its canonical
learning sequence is: orientation, architecture, terminal/editors, Bash,
filesystem/storage, MicroPython, MicroPython API, Redstone, worked project,
assembly, BASIC, C/C++, optimization, DOS, diagnostics, and limits/glossary.
Keep chapter numbers, section numbers, search order, previous/next navigation,
and the appendix reading paths synchronized. `tests/tools/webManual.test.mjs`
locks the publication order and chapter/header agreement.

## Web companion networking

The BDS companion entry points listen on `0.0.0.0:19144` by default and select a
non-virtual LAN IPv4 address. `WEB_COMPANION_HOST` controls the listener, while
`WEB_COMPANION_PUBLIC_HOST` overrides the detected address. For Internet access,
keep the process on loopback, set `WEB_COMPANION_PUBLIC_ORIGIN` to an HTTPS
origin, and use a TLS reverse proxy. Never publish plain HTTP to the Internet.

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
remain entirely sandboxed. Linker symbol lookup is Map-backed and bounded;
duplicate/unresolved symbols, corrupt objects, excessive object counts, and RAM
overflow fail explicitly. The current ABI exposes zero-argument integer
functions with EAX returns. Restricted statement-boundary inline assembly may
not introduce labels, control flow, stack operations, or ESP/EBP access. Dynamic
linking is not implemented yet; extend the versioned object/ABI boundary rather
than dispatching to a host linker or loader.

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
to the same process.

Keep OS-specific behavior behind `osProfile.ts`: path dialect, boot layout,
environment, aliases, and virtual devices must not leak into the domain
filesystem. Linux is the default persisted profile; the DOS fixture protects
drive-letter, case-insensitive, CRLF, and `NUL` semantics, and Portable Computer
Systems select DOS explicitly. DOS startup processes at most 64 `CONFIG.SYS`
lines and 256 lines per batch, with depth 8, explicit failure, and a modeled
conventional/UMB/XMS layout. Only the built-in HIMEM/EMM386 and
`DOS=HIGH|LOW,UMB|NOUMB` contract may affect that layout; never claim native
drivers, paging, BIOS/DOS interrupts, TSRs, or `.COM`/`.EXE` execution. DOS
`EDIT` and cross-profile `vi` use writer-owned bounded `terminal_keys` batches
and render only their fixed viewports. Every menu, search, save, exit, failure,
and resize branch must return an explicit editor state. Syntax and indent
highlighting must scan no more than the visible columns/rows per redraw.

World Dynamic Properties remain the Bedrock source of truth (physically the
world LevelDB). Clean persistence checks use component revision tokens, not
whole-snapshot JSON fingerprints. Retain only the current and previous complete
paged generations, and preserve the checksum-backed fallback before expanding
storage features. SQLite belongs only behind the repository boundary for a
future non-Bedrock host.

## Development conventions

- Keep source, tests, documentation, and Issue evidence synchronized.
- Do not commit generated `dist/` output unless a release workflow explicitly
  requires it.
- Preserve unrelated working-tree changes.
- Use English commit messages with a useful description and reference Issue #4
  while Phase 2 work remains in scope. Reference Issue #12 for the OS,
  toolchain, Web Terminal, and field-manual work it tracks; reference Issue #15
  for the full-screen `EDIT` implementation.
- Keep temporary scripts and work artifacts under `%USERPROFILE%\tmp`, not the
  user home directory root.

Further details are in `README.md`, `docs/development.md`,
`docs/mcp-debugging.md`, and `docs/manual-verification.md`.
