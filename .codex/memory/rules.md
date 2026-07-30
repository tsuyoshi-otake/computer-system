# Verified project rules

- Keep application, companion, and browser interaction-context allowlists
  synchronized; a valid hosted TUI frame can otherwise force an exact Web
  Terminal session into reload/disconnect. — Evidence: adding `cs-abi` to both
  Web companion and terminal-input validators kept the real-BDS libcurses writer
  connected through frame presentation, key input, and prompt return with zero
  diagnostics.

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
- A command generated from the live OS registry must not retroactively appear in
  immutable base images. Freeze every pre-feature command snapshot, introduce a
  new image ID, and test the prior image plus tombstones. — Evidence: CS Make
  first appears in Linux v10, remains present in current v11, stays absent from
  v1-v9 and CS-DOS, and passes restore/upgrade tests.
- Multi-step guest orchestration needs a production headless probe in addition
  to host state-machine tests. Run the real synchronous MCP path and emit PASS
  only after success, no-op, changed-input rebuild, fail-closed behavior, and
  finalization are all observed. — Evidence: isolated MCP/BDS reports
  `linux_make/PASS` with ticks 80 and zero diagnostics.
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
- A cell-rendered terminal cursor must combine the last authoritative terminal
  surface with the client's current bounded line value and selection. Waiting
  for a server redraw leaves the overlay behind local typing; expose the shared
  row/column calculation as a pure layout function and mask secret input before
  painting a block cursor. Evidence: Web layout tests cover wrapping, clamping,
  and Unicode input, while real Chrome checks observe immediate local movement.
- Keep interactive capability flags orthogonal. A DOSKEY-backed `history` flag
  gates arrow traversal only; it must not accidentally disable Tab completion or
  DOS F3 recall, and DOS mode must suppress browser-native Emacs shortcuts that
  the guest does not advertise. Evidence: focused Web input tests and real
  browser checks cover pre-DOSKEY Tab/F3, post-DOSKEY arrows, and Linux-only
  Ctrl+A behavior.
- In a dependency-ordered incremental build, the global planning snapshot is not
  the target execution baseline: an earlier target legitimately changes a later
  target's prerequisite. Capture each target's inputs immediately before its
  first recipe, then compare that exact snapshot after recipe I/O before
  recording success. Evidence: CS Make's main.o/app build failed the first
  state-v2 iteration until the baseline moved from plan time to per-target time;
  mid-build mutation is now rejected without advancing state.
- A durable incremental-build record must bind inputs, output, recipes, and
  toolchain identity. Missing, evicted, legacy, or foreign records are
  conservative rebuild signals, never implicit proof that an older target is
  current. Evidence: CSMAKE2 SHA-256 tests and the real BDS probe rebuild
  missing state, converge, and retain zero diagnostics.
- Normalize Python slice bounds before replacement inspection, clip arbitrary-
  precision indices without a host-safe-integer conversion, and preflight
  extended arity/final capacity before mutating a list. Evidence: Issue #59
  tests cover oversized positive/negative bounds and steps, zero-step
  precedence, exact/capacity-plus-one stores, and unchanged targets after
  rejection.
- Lower a Python assignment expression as RHS, stack copy, then one lexical
  store, and classify its identifier as a whole-function assignment during scope
  analysis. Keep unparenthesized placement an explicit parser-context decision.
  Evidence: Issue #66 tests cover same-object results, RHS-once,
  global/nonlocal/ unbound-local behavior, placement restrictions, branch
  skipping, and nesting capacity plus one.
- Model an eager Python comprehension as an implicit function scope: evaluate
  only its leftmost iterable in the enclosing scope, keep iteration targets and
  later clauses local, and route contained `:=` stores to the nearest enclosing
  non-comprehension scope. Reject named expressions anywhere in an iterable and
  any target conflict before code generation. Evidence: Issue #68 nested-scope,
  evaluation-order, walrus, and exact/capacity-plus-one tests.
- Back bounded Python sets with one insertion-ordered canonical-key map instead
  of repeated array scans. This gives average O(1) unique insertion/membership,
  deterministic CS-profile iteration, shared numeric equality, bounded hash-key
  construction, and reachable accounting for both keys and values. Evidence:
  Issue #68 display/comprehension/constructor, mutable-key, hash-ceiling, and
  heap tests.
- Execute Python class suites in a dedicated managed frame and publish only from
  one successful class-completion owner. Forward enclosing function cells
  through that frame without treating class locals as method closure bindings;
  this also supports a method capturing the outer class-name cell that is
  initialized only when publication completes. Evidence: Issue #74 class-scope
  and identity tests.
- Represent instance lookup as average-O(1) instance/class maps plus an O(D)
  bounded single-base walk. Bind only managed functions found through the class
  path, and use the existing Python call marker to turn a successful `None`-
  returning `__init__` into the constructed instance. Evidence: Issue #74
  binding, inheritance, fault-finalization, capacity, and heap tests.
- Model Python generator suspension as frame-owned locals, closure cells, value-
  stack suffix, and one compiler resume target. Resume through the existing
  `Cs486Process` call/return path, close on every return/fault branch, and
  expose suspended children to reachable heap accounting instead of adding a
  Python VM, scheduler, instruction pointer, or RAM lease. Evidence: Issue #77
  generator, closure, exhaustion, fault, and heap tests plus the full host gate.
- Treat a value sent into a suspended Python generator as input owned by the
  resumed frame: restore its saved stack first, then push exactly one `None` or
  sent value as the current yield-expression result. Reject a non-`None` first
  send before changing created state, and represent `generator.send` with the
  existing bound-method graph so its receiver remains reachable. Evidence: Issue
  #78 syntax, identity, closure, capacity, re-entry, exhaustion, heap, and
  full-gate tests.
- A Python generator suspended inside exception handling must retain frame-
  relative handlers, active handled faults, and pending finalizer control with
  its locals and value stack. Restore them only after the normal CS486 resume
  call establishes the physical return stack, then inject `throw`/`close` at the
  first resumed Python operation. Evidence: Issue #79 caught/replacement fault,
  bare re-raise, yielding-finally, `GeneratorExit`, heap, and full-gate tests.
- A `yield from` delegate owns one retained iterator stack entry until exact
  exhaustion. Forward an injected `throw` or `close` as a fault operation, never
  as a sent value or an extra `__next__`; a closed delegate rethrows the
  injected fault and the outer owner removes the delegate exactly once.
  Evidence: Issue #80 nested delegation, injected-fault, close, return-value,
  and heap tests.
- Publish a generator expression only after evaluating and acquiring the
  leftmost iterator in the enclosing frame. Pass that existing cursor into the
  implicit generator scope so later clauses stay lazy and the cursor is neither
  restarted nor duplicated; pair positive manual claims with a regression that
  rejects stale deferral prose. Evidence: Issue #81 evaluation-order, position-
  retention, PEP 479, heap, compatibility, and manual tests.
- Lower multiple synchronous `with` items as nested protected finalizers. Retain
  the class-resolved bound exit before entry, protect target assignment, ignore
  the exit result on normal/control completion, and use it only to suppress an
  exact active fault. A suspended generator must retain the handler, finalizer,
  fault, stack, and bound exit together. Evidence: Issue #82 order, assignment-
  fault, control-flow, suppression, generator-close, capacity, and heap tests.
- A managed user-iterator protocol call must restore both logical Python state
  and the physical CS486 return slot. Under the current call convention the
  marker records the authoritative return address at `esp - 4`; receiver and
  optional default remain heap roots, and every `StopIteration`, normal return,
  escaping fault, and rejected admission has one explicit terminal owner.
  Evidence: Issue #83 inherited/special lookup, loop/default/yield-from,
  call-depth, capacity, and heap tests.
- Commands that delete and rebuild the same generated output directory must run
  sequentially. On Windows, use bounded `rm` retries so transient file handles
  do not replace the original build failure with a cleanup error. Evidence:
  Issue #83 Pages tests/build passed sequentially after bounded cleanup exposed
  the underlying esbuild admission failure.
- Generic Python materialization must retain the current iterator, accumulator,
  pending consumer state, and original CS486 return slot under one owner.
  Repeated generator resumes create nested physical return slots, so normal
  exhaustion and yield-side capacity/fault paths must restore the original slot
  before finalization. Route the eventual call through a compiled dispatch
  trampoline so managed, native, and extension calls resume at the correct
  target. Evidence: Issue #85 consumer, transactional-publication, capacity,
  call-depth, generator, native-call, and extension-call tests.
- A Python legacy sequence iterator must own its source, current index, and
  sticky exhaustion state. Increment only after a successful class-backed
  `__getitem__`; convert `IndexError`/`StopIteration` to exhaustion and preserve
  the index on every other fault. Distinguish a nested managed-call completion
  from an immediate/exhausted continuation so only the former returns through a
  physical CS486 caller slot. Evidence: Issue #87 independent-cursor, fault,
  generator-function-item, all-consumer, call-depth, and heap tests.
- Pure Python semantic tests should use the core-only CS486 harness, including
  an injected in-memory guest filesystem for source-module imports. Import the
  full OS-native registry only when a test exercises native modules or globals;
  otherwise unrelated eager guest C-image compilation can prevent test
  collection. Evidence: Issue #87 related iterator/generator suites pass 97/97
  while concurrent NetHack hosted-C initialization remains independently red.
- A built-in Python iterator that must invoke arbitrary existing callables can
  be modeled as an unexposed class whose methods are ordinary compiled managed
  functions. Store its operands and sticky terminal state in an accounted
  instance so functions, bound methods, classes, native waits, extensions, all
  iterator consumers, call-depth rollback, physical returns, and heap roots
  reuse one proven path. Evidence: Issue #89 passes 8 focused and 105 related
  callable/sentinel iterator tests, including waits and CS486 extensions.
- Runtime-visible Python typing metadata should be built by an ordinary managed
  annotation-scope function. Keep definition defaults/decorators outside that
  scope, retain parameter cells for annotations/class bodies/aliases, and model
  each lazy value with explicit evaluating, uncached, and successfully cached
  states. A fault must reset evaluation without publishing, and every evaluator,
  stable tuple, cached value, and in-progress root must remain in reachable heap
  accounting. Evidence: Issue #90 syntax/scope, reflection, fault-retry,
  recursion, capacity-plus-one, and bounded-slice tests.
- [Python generics] Normalize an explicit `ParamSpec` subscription to one
  tuple-shaped `__args__` slot: accept list/tuple form, and accept empty or
  expanded arguments when it is the sole parameter. — Evidence: the
  generic-alias suite passes explicit sole, trailing, empty, list, tuple, and
  expanded cases.
- [CS486 object composition] When appending an independently linked object,
  subtract its link-local data base before applying the executable-wide base.
  Reserve the null-pointer guard once, then use one relocation delta for
  instructions, initialized data, and data-held function pointers. — Evidence:
  Python extension, linker, alignment, indirect-call, and C function-pointer
  selections pass 8/8 and 25/25 after eliminating the duplicated base.
- [CS486 protocol hand-off] When a managed special-method call returns a
  suspendable object and completion continues in that object, retain and restore
  the original caller's physical return slot before publishing the resumed
  result. Otherwise the intermediate method resumes after its authored return
  and can overwrite the result or duplicate finalization. — Evidence: Issue #93
  synchronous `__anext__`/`__await__` hand-off regressions and all 18 coroutine
  tests pass after restoring the marker stack pointer.
- [Python async generators] Give every `__anext__`/`asend`/`athrow`/`aclose`
  awaitable a single-use operation owner distinct from the async generator's
  lifetime. A yield closes only that operation and leaves the generator
  suspended; completion or fault closes both as required, while call-depth
  rejection restores the operation to its retryable created state. — Evidence:
  Issue #94 focused async-generator tests pass under eight-instruction slices,
  re-entry/reuse, close-yield, fault, heap, and call-depth cases.
- [C literals] For `0x`/`0X` tokens, classify floating syntax by a dot or `p`
  exponent, never by hexadecimal digits `e`/`f`; decimal exponent and suffix
  checks apply only to non-hex tokens. — Evidence: the bit-field `0xabcdefu`
  regression and C aggregate/preprocessor selection pass.
- [Python exception groups] Keep `except*` continuation values in a managed
  stack root separate from static handler metadata. Preserve authored splitting,
  original subgroup identity for bare reraises, deterministic new/unmatched
  merging, and the physical return slot between callable predicate calls. —
  Evidence: Issue #95 nested merge, callable-fault, suspension, low-slice,
  capacity, and heap tests, the 2,066-test full gate, real browser, and real
  BDS.
- [Python interpolated strings] Represent f-string and t-string replacement
  fields with one recursive interpolation AST and one left-to-right operand
  lowering path. A t-string retains the outer value and metadata while nested
  format fields still render eagerly; an f-string renders the outer field only
  after its nested operands complete. Evidence: Issue #96 shared grammar,
  debug/conversion/nested-order, fault rollback, capacity, heap, and low-slice
  tests plus the production Guest-RAM baseline regression and 2,073-test full
  gate.
- [Python intrinsic imports] A bare dotted intrinsic import must bind its root
  namespace just like a regular package: `import string.templatelib` validates
  the leaf but stores `string`, while `import string.templatelib as alias`
  stores the leaf. Evidence: Issue #96 bare, aliased, and selected import tests
  and the complete Python aggregate.
- [BDS startup] Prebuild immutable deterministic guest-library archives instead
  of compiling, hashing, or compressing them during Bedrock module evaluation.
  Check generated payload freshness during host builds; native startup-watchdog
  evidence showed module import dropping from about 7.8 seconds to 0.2 seconds.
- [Bedrock text boundary] Do not depend on browser/Node `TextEncoder` or
  `TextDecoder` globals in production Script API paths. Use deterministic UTF-8
  primitives, cache immutable base-image content facts once, and prove the real
  BDS Git/archive path in addition to host tests.
- [Python class completion] Do not invoke the next managed `__set_name__`
  directly from the previous descriptor function's return opcode. Emit a
  compiled class step/resume trampoline so every notification has a valid
  physical CS486 caller, retained heap roots, and one atomic publication owner.
  Evidence: Issue #97 ordered, nested, fault, capacity, low-slice, production
  RAM-baseline, 2,086-test full-gate, browser, and MCP/BDS verification.
- [Python AttributeError fallback] When an escaping managed protocol call must
  transfer to a second managed fallback, do not emit another physical CS486 call
  from the faulting syscall. Roll back the first frame/marker, retain its
  authoritative return slot, install the fallback frame/marker, and jump to the
  fallback target so its one return consumes the original caller address.
  Evidence: Issue #98 descriptor/getattribute-to-getattr fallback, retry,
  call-depth, low-slice, 2,102-test full gate, and real MCP/BDS verification.
- [Python C3 lookup] Retain each runtime class's direct bases and one canonical
  bounded C3 MRO, then route attributes, descriptors, hooks, implicit special
  methods, class patterns, and subclass checks through that same order.
  Duplicate/inconsistent MRO faults occur after the class body but before
  publication; reflection tuples and referenced bases remain heap-accounted.
  Evidence: Issue #100 ordering, diamond, fault, pattern, generic, exact-limit,
  heap, low-slice, production RAM-baseline, 2,115-test full-gate, browser, and
  MCP/BDS verification.
- [Python super cells] Keep the implicit class cell separate from every authored
  outer, class-body, local, or parameter `__class__` binding. Initialize it only
  after canonical C3 and heap admission succeed, clear it when later class
  finalization faults, and route `super` through the same C3 descriptor lookup.
  Retain proxy, receiver, class, frame, and suspended-call roots in heap
  accounting. Evidence: Issue #101 scope/finalization, cooperative diamond,
  descriptor/reflection, exact-limit, low-slice, RAM-baseline, 2,125-test
  full-gate, browser, and MCP/BDS verification.
- [Python construction] Treat a class call as a two-stage `__new__`/`__init__`
  protocol owned by the compiled after-call path. Retain the requested class,
  original arguments, and custom-new result; initialize only a requested-class
  or subclass instance through its returned type, and return other values
  unchanged. Preflight bare allocation and every new destination binding before
  publication. Evidence: Issue #102 C3/argument/result, nested-fault, heap,
  low-slice, RAM-baseline, 2,133-test full-gate, browser, and MCP/BDS
  verification.
- [Terminal relay allowlists] Model no-payload actions as exact alternatives,
  separate from payload-bearing actions. Applying a shared trailing-space and
  payload pattern makes a valid EOF impossible to relay or accidentally accepts
  malformed EOF data. Evidence: the exact `eof` BDS relay regression, malformed
  `eof ` and `eof payload` rejections, and real-BDS Perl/Python Ctrl+D flows all
  pass after separating the alternatives.
