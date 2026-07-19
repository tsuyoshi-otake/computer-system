# Verified project rules

- Structured VM blocks must propagate `return`, `break`, and `continue` through
  `finally` using explicit continuations; tests must observe the final target
  and every executed finalizer.
- A filtered ComputerCraft-style event pull discards queued non-matching events
  before returning the first match.
- Keep host-runtime limits instance-scoped. Built-ins such as `range` must use
  the active VM limits rather than global defaults.
- On Windows, Prettier uses `endOfLine: auto` so repository-wide checks preserve
  existing line endings while still validating content formatting.
- Source-string tests that cross line boundaries must accept both LF and CRLF;
  use `\r?\n` instead of embedding one platform's newline sequence.
- Do not treat generated Bedrock JSON UI structure as runtime evidence. On GDK
  26.33, `CustomForm` collection controls outside the native factory did not
  resolve indexed text, and native label/header templates ignored attempted
  factory remapping. Keep generator tests, but require a client check for
  visible layout, colors, and scrolling.
- A Bedrock custom item's `onUse` needs a built-in use driver. For the Portable
  Computer, Food plus a 0.05-second use modifier makes a click observable while
  the terminal form interrupts consumption; verify on-client that the item stays
  in its slot and keeps its dynamic identity across a world reload.
- `npm run deploy` copies the existing `dist` packs and does not rebuild source.
  After Bedrock script or pack-generator changes, run `npm run build` before
  `npm run deploy`, then restart the GDK client when module or atlas reload is
  required.
- On GDK 26.33, a custom Computer `onPlayerBreak` can be followed by a same-key
  `onPlace` before the block is visibly gone. Keep the physical key under an
  explicit break owner through the next tick, suppress reallocation, remove any
  residual Computer block, then give the identity-bearing item and release the
  guard in `finally`.
- Deferred cleanup must isolate every preparation, finalization, and failure
  reporting step so one exception cannot skip later work or leak ownership. —
  Evidence: deferred-finalization tests inject failures into all three phases
  and observe remaining steps plus guard release.
- GDK 1.26.33 native labels expose foreground formatting but no per-cell
  background API. Render non-default blank backgrounds as block glyphs and keep
  the 16-index formatting-code mapping injective; otherwise distinct terminal
  palette entries silently collapse to the same visible color.
- Relaunch Minecraft for Windows through its registered app ID
  `Microsoft.MinecraftUWP_8wekyb3d8bbwe!Game`. Immediately launching the
  `C:\XboxGames\...\Minecraft.Windows.exe` path after shutdown can be ignored
  even when no process or crash event remains.
- Treat interactive terminal completion and viewport resize as writer-owned
  operations. Validate at HTTP and Bedrock boundaries, serialize per Computer,
  and cap dimensions/candidates so viewers cannot race shared terminal state.
- A script loop budget must be shared across nested blocks and function calls.
  Per-block counters allow multiplicative nested work even when every individual
  loop appears bounded.
- Native operations that perform sandbox work must return bounded VM cycle debt;
  otherwise a low-clock Computer can bypass CPU limits through shell or host
  adapters. Keep aggregate RAM measurement pressure-triggered so the normal
  allocation path stays O(1), and scan only reachable runtime objects when
  reclamation or overflow must be decided.
- Treat nominal guest CPU identity and host-safe execution scale as separate
  concepts. Guest executables must be structurally validated at load, have
  bounded instruction/output/memory paths, and charge measured opcode cycles
  back to the owning VM rather than executing as unmetered native work.
- Reuse an already-booted `ShellSession` when constructing a secondary native
  environment for MCP/debug execution. Constructing another session re-runs the
  OS boot profile and can erase volatile paths such as `/tmp` between a compile
  command and the program that consumes its output. — Evidence: the Computer
  host integration test compiles `/tmp/fastmath.o`, imports it from Python, and
  observes `42` without losing the object during debug-environment creation.
- Keep the guest instruction schema in a stable CPU module below both the
  process and model-specific timing tables. Importing instructions from the
  process into timing creates a reverse dependency when the process selects its
  timing model. — Evidence: the architecture cycle test passes after extracting
  `instructionSet.ts` from `cs486.ts`.
- A hardware capability gate must cover every user-visible entry point: boot
  artifact selection, shell/debug dispatch, and MCP reporting. Keep the flag on
  the CPU specification so one frontend cannot silently re-enable an unavailable
  language. — Evidence: portable CS386SX tests retain C++ execution, ignore a
  user `/startup.py`, and return status 127 for MCP MicroPython.
- DOS compatibility boot must parse bounded files sequentially and surface every
  unsupported `CONFIG.SYS` directive. Store modeled HIMEM/EMM386/DOS-high flags
  in the same session environment consumed by `MEM` so startup, diagnostics, and
  batch execution cannot disagree. — Evidence: DOS profile tests verify the
  conventional/UMB/XMS map, boot variables, explicit warnings, and line/depth
  termination.
- Keep OS command exposure closed by default. Linux and DOS must select separate
  Map-backed registries for execution, help, discovery, and completion; adding a
  command to one registry must not expose it through the other frontend. Keep
  DOS names and formatting in DOS adapters and share structured filesystem and
  toolchain services instead of aliasing `DIR`/`COPY` to Linux applets. —
  Evidence: OS command-boundary and architecture tests reject cross-profile
  names and preserve the documented DOS extensions and CS486 toolchains.
- Gate profile-specific interactive commands twice: filter discovery and
  completion in the command runtime, and guard the `ShellSession` TUI intercept
  itself. A runtime-only gate can be bypassed when the session starts an editor
  before dispatch. — Evidence: Linux returns status 127 for `edit` and status 1
  for `which edit`, while DOS opens the bounded full-screen EDIT session and MCP
  rejects it as TUI without retaining editor state.
- Treat a portable item's persistent Computer identity separately from its
  current player session owner. On an owner conflict, inspect only the bounded
  former-owner inventory, reject a true duplicate, and otherwise explicitly
  finalize that Computer's former native and Web sessions before reassignment;
  do not disconnect the player's unrelated Computers. — Evidence: lifecycle and
  Bedrock adapter tests cover duplicate rejection, transfer finalization, and
  scoped session teardown.
- Migrate persisted family hardware only from an exactly recognized former
  default. Standard Desktop, Advanced Desktop, and Portable profiles may evolve,
  but a customized CPU, clock, or RAM value remains authoritative. — Evidence:
  hardware profile tests cover CS486DX 33 MHz/2 MiB, CS486DX2 66 MHz/8 MiB,
  CS386SX 16 MHz/2 MiB, one-time migration, and customized-profile preservation.
- Keep high-resolution isometric machine plates as manual/inventory sources and
  derive purpose-built block geometry, face textures, and terrain-atlas entries
  separately. Stretching one isometric view across cube faces cannot represent a
  placed machine. — Evidence: machine asset tests cover three bounded
  geometries, six 16 px face textures, the terrain atlas, and three transparent
  machine item icons; the production pack builds with no new BDS diagnostics.
- Desktop and Advanced are one-block all-in-one machines with a built-in CRT.
  Resolve terminal access directly from the touched Computer identity; do not
  add a separate display block, item, probe, or adjacency gate. Portable retains
  its explicit built-in-display capability. — Evidence: Bedrock adapter and
  generated-pack checks cover direct Desktop access, absence of standalone
  display paths, Portable held/placed paths, and stationary-redstone exclusion
  for Portable blocks.
- Treat live cross-language benchmarks as correctness experiments first: use
  identical workload/checksum sources, cold guest processes, exact persisted
  hardware identities, and runtime statistics rather than MCP command overhead.
  A yielded process is an incomplete measurement, not a slow result; keep the
  runner bounded but large enough for the declared workload, and record an
  unsupported frontend as an explicit status cell instead of a host estimate. —
  Evidence: the 1,500-iteration strength-reduction matrix completed all 28
  supported live-BDS/MCP runs on CS486DX2, CS486DX, and CS386SX, while both
  Portable Python cells terminated with DOS status 127.
- A bounded CPU budget is insufficient when scheduler preparation or result
  materialization still enumerates every process. Rotate one fixed-size window
  through event preparation, execution, and returned views, and test fairness at
  a population much larger than the window. — Evidence: the WorkMonitor scale
  gate reaches all 10,000 processes in 157 ticks while exposing at most 64 views
  per tick with zero soft/emergency deferrals.
- Incremental persistence must mark the exact revision captured at job start as
  saved, not the record's revision at commit. Otherwise a mutation during a
  multi-tick page transaction is silently treated as durable. Change the head
  only after every new page exists and retain the previous complete generation.
  — Evidence: paged-store tests permit one property operation per step and the
  persistence test observes a second dirty job after mutation during save.
- Export host-load telemetry through a fixed schema, never raw per-Computer or
  per-player maps. Normalize Bedrock log records before caching them in MCP
  status and derive p50/p95/p99 from fixed histogram buckets. — Evidence: BDS
  debug-session tests reject malformed records, and isolated MCP/BDS acceptance
  reports bounded WorkMonitor metrics with zero emergency deferrals.
- Large immutable guest OS images must cache their validated content IDs and
  logical sizes once. Per-Computer mounts may reference those cached descriptors
  in O(number of image files), but must not rehash or duplicate the immutable
  file contents. — Evidence: mounting shared Linux/DOS images stopped dominating
  the parallel test suite after blob IDs and sizes were prevalidated once.
- Guest storage deadlines are deterministic guest time. Host WorkMonitor
  admission may defer delivery, but must never rewrite the modeled completion
  deadline or convert host elapsed time into guest CPU, RAM, or device timing. —
  Evidence: block-I/O scheduler tests preserve deadlines across host deferral.
- Final terminal detachment is a host-owned security boundary, not merely a
  guest event. Revoke the live shell synchronously, clear secret/elevated state,
  cancel every job that captured its credentials, and then deliver one bounded
  completion/close event; if that event cannot be delivered, fail safe to an
  explicit shutdown. — Evidence: runtime credential tests cancel root
  foreground, compiler, and MCP work on close and prevent every post-close side
  effect before a new login.
- When login can be disabled for development, reconnect must rebuild the whole
  session from the authoritative service UID, not only replace numeric
  credentials. Reset cwd, HOME/USER/LOGNAME, aliases, history, sudo timestamps,
  and umask; if the current home is unavailable, fall back to `/` with an
  observable warning. — Evidence: multi-user tests remove `sudo` membership
  while a root login shell is active and observe a clean UID-1000 session after
  an idempotent disconnect.
- A persisted base-image overlay may replace an immutable entry with a different
  kind. Tombstones, metadata elision, and live image-upgrade suppression must
  all compare entry kind as well as existence/content; otherwise
  file↔directory↔link replacements either fail restore or silently lose
  metadata. Grandfather valid older limits during restore, charge any capacity
  debt, and reject only new growth until deletion/shrinkage recovers it. —
  Evidence: filesystem tests preserve same-metadata symlink and directory/file
  replacements through fresh restore, live base upgrade, a second
  snapshot/restart, and legacy over-capacity symlink recovery.
- A final persistence-boundary journal record is provisional in both durable and
  live state until its callback succeeds. On failure, remove exactly that
  attempt's records before publishing the fault, so a later dirty retry cannot
  persist a false successful boundary. — Evidence: lifecycle cold-restore tests
  retain one fault and neither provisional marker after an automatic retry.
- A synchronous transaction that rejects a Promise/thenable needs one settlement
  quarantine shared by every managed state owner. Explicitly joined owners
  define pre-await rollback; the shared quarantine prevents any filesystem or
  DOS owner from accepting its post-await continuation until settlement. —
  Evidence: cross-instance and cross-subsystem tests preserve all snapshots and
  reject the delayed mutations.
- Current identity-page format does not prove that referenced Computer payloads
  are current. Scan every reference, treat a previous-generation load only as
  recovery input, rebuild and reload-verify the canonical head, and activate the
  identity registry last. — Evidence: current-registry and recovered-head
  migration tests are idempotent and do not renumber identities.
- Recovery cleanup must handle storage that an invalid manifest can no longer
  name: blobs, legacy indexed pages, and stray manifests. Keep prefix
  enumeration on startup/recovery paths, delete at most one candidate per step,
  and never put an O(total storage) scan on ordinary periodic saves. — Evidence:
  cleanup tests cover more than 80 orphans, interruption/restart,
  current/previous retention, and zero normal-save key scans.
- Persistence writers and readers must enforce the same structural limits before
  mutation, including nested metadata such as a manifest that must itself fit
  one Dynamic Property. — Evidence: page-count and manifest-length
  capacity-plus-one tests fail without writes/deletes, and oversized manifests
  are rejected by the reader too.
- Bedrock production probes must not depend on Node-only globals. Run their host
  tests with suspect globals removed, then execute the probe through the real
  BDS MCP boundary. — Evidence: the authentication/reboot probe passes without
  `structuredClone` and in two isolated stdio MCP runs.
- Do not construct a service at module evaluation when its repository reads
  Bedrock World Dynamic Properties. Instantiate it from the world-ready startup
  owner and expose a guarded accessor to later adapters. — Evidence: the Floppy
  repository failed real-BDS early execution until `startComputerHost()` became
  its construction owner.
- `Server started` is transport readiness, not application-storage readiness.
  Restart probes that depend on migrated state must wait for the explicit
  `CS_STORAGE_MIGRATION` complete record and deduplicate their command. —
  Evidence: the second BDS session migrated 20 persisted probe Computers and
  passed only after the runner replaced its fixed one-second delay with the
  readiness record.
- Managed Web Terminal acceptance is playerless and MCP-only: preserve the
  managed world, wait for storage migration, page exact identities, then call
  `bds_open_web_terminal`. Bedrock admits the headless principal only from
  `ScriptEventSource.Server`; bind later TUI capture/input/waits to that exact
  debug-owned writer, reject secret prompts again at Bedrock admission, and
  never let a simultaneous Player handoff satisfy the MCP wait. Normal
  player-owned sessions retain proximity, input, and disconnect rules. —
  Evidence: real MCP acceptance with zero connected players opened the default
  browser, observed an exact 80 x 25 row/color/cursor surface, drove EDIT
  through its File menu across snapshot versions 1 through 4, and retained zero
  diagnostics without in-game or separate browser automation.
- MCP TUI key injection is not browser-input evidence: it bypasses client-side
  mode detection, focus, keyboard-event mapping, and pointer gates. Feed the
  actual serialized screen contract into executable client tests and retain a
  real-browser keyboard/mouse check for behavior at that boundary. — Evidence:
  plain EDIT's two leading menu cells did not match the one-cell WorkBench
  detector, so MCP Alt+F passed while browser Alt+F and primary mouse were both
  disabled until the detector consumed the real row shape.
- Machine-checkable MCP TUI acceptance should bind to the exact debug-owned
  writer and return derived, bounded evidence rather than duplicating screen
  text. Treat expectation mismatch as an explicit `verified: false` result, but
  keep malformed criteria, capacity overflow, secret input, missing ownership,
  and invalid surfaces as tool errors. — Evidence: real preserved-world EDIT
  Display verification proved 80x25 geometry, cursor/color grids, literal and
  same-row constraints, and five continuous vertical runs without returning a
  single screen row.
- Give each guest resource exactly one accounting owner: RAM through opaque
  `GuestRamLedger` leases, persistent capacity through `InMemoryFilesystem`, and
  modeled HDD time through `ComputerHost`. Acquire before mutation and release
  in the lifecycle finalization owner; keep the RAM ledger derived and
  transient. — Evidence: Issue #31 tests reconcile every lease, round FAT16
  capacity to 2,048-byte clusters, reject full-disk writes atomically, and
  charge a 196,608-byte executable as three sequential 64 KiB HDD requests.
