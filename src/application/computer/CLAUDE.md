# Computer application guidance

## Aggregate ownership

- `ComputerRuntime` is the application owner of one Computer's boot, execution,
  terminal, authentication, display, OS state, persistence callbacks, and final
  lifecycle result. Adapters request transitions; they do not finalize them.
- Preserve the same identity, hardware/display profile, filesystem state, and OS
  state through placement, breaking, item transfer, portable use, integrated
  display access, reload, rollback, and migration.
- Periodic snapshots must be fixed-batch O(K), without allocating an O(N) list
  on every pass.

## Terminal and security finalization

- `ComputerRuntime` owns the final `terminal_closed` security transition. On
  close, synchronously disconnect `ShellSession`, cancel credential-capturing
  foreground, compile, and MCP work, deliver exactly one bounded close/resume
  event, and fail safe to shutdown if delivery fails.
- Competing forms, cancellation, disconnect, runtime failure, shutdown, reboot,
  and adapter disposal each need one observable finalization owner. Never leave
  a shell or elevated credential live after its terminal disappears.
- An event that only wakes a process whose payload is buffered elsewhere keeps
  one pending wakeup at a time. Ask the event queue with `hasQueued` before
  queueing another `terminal_keys` wakeup: the guest drains the whole key FIFO
  from the first wakeup, so a surplus one resumes a wait with nothing to
  deliver.
- OS process accounting receives the uncapped cumulative modeled total. A cap
  belongs to a reported field only; capping the cumulative counter freezes the
  per-tick delta `accountLiveOsProcess` derives from it.

## Boot, shutdown, and recovery

- `powerOn()` enters `post` and starts the deterministic, tick-driven 80x25
  CSBIOS sequence. At 20 TPS it spans 70 ticks: black, CS-VGA, black,
  `CSBIOS Revision 1.1`, bounded same-row memory updates, factual device and
  boot-source detection, handoff black, and the selected OS starting line. Keep
  the Computer `booting`, the guest CPU paused, and input unavailable until the
  final handoff. Report only the active CPU, RAM, VGA/VRAM, floppy state, disk
  quota, source, and target; never add AMI vendor strings, unsupported setup
  prompts, or fabricated FPU/hardware claims. DOS then shows its identity, one
  blank line, and `C:\>`.
- Linux's `/sbin/cs-init` boots from `/etc/inittab`: `sysinit`/`wait`/
  `initdefault` entries pick the target runlevel and its `respawn` entry owns
  the tty1 getty; `S`-prefixed entries in that runlevel's `/etc/rcN.d` directory
  start rc.d services (today: `syslog`, `cron`) via `cs-init-ctl`. This inittab
  parse and rc.d service start-up runs synchronously inside `ShellSession`
  construction (see `os/CLAUDE.md`), not paced across additional ComputerRuntime
  ticks, so a standalone `ShellSession` (used directly by most unit tests, with
  no external tick driver) still reaches a fully running OS on construction.
  Once CSBIOS hands off, `ComputerRuntime` renders one authentic
  `Starting <service>... [ OK ]` (or `[FAIL]`) line per already-started rc.d
  service as a read-only pass over `OsRuntimeState` before the existing
  single-tick lifecycle handoff continues; it never mutates service state, so it
  does not consume extra ticks and does not change the pre-existing
  CSBIOS-ready-to-running tick contract. Linux then shows its identity, one
  blank line, then password setup/login or the shell prompt exactly as before;
  do not fabricate a startup shell-version banner. A malformed `/etc/inittab`
  (parse-time structural fault, e.g. missing or duplicate `initdefault`) fails
  the whole boot explicitly; one rc.d service's own start failure does not, and
  renders `[FAIL]` instead.
- Syntax/runtime failure terminates display state as `faulted`. Shutdown and
  reboot release VRAM explicitly.
- A failed lifecycle transition must leave its reason on the terminal.
  `csBios.ts` owns that text: `renderCsBiosHaltScreen` writes a full 80x25 halt
  screen (the POST rows actually reached, the failing phase, the reason wrapped
  into at most two rows, and one recovery row) and `csBiosHaltNoticeLines`
  appends the same facts as a few lines. `boot()`'s catch and the CSBIOS handoff
  catch use the full screen because their screen is blank or a stale POST frame;
  `failStopState` appends, because the guest's own shutdown output must survive.
  The guest-crash path uses neither: the guest already wrote a better
  diagnostic. Write only `TerminalBuffer`, never VRAM — every caller faults the
  display immediately after and `fault` releases VRAM by design — and stop the
  cursor blinking, because a halted machine accepts no input and an idle cursor
  reads as a prompt. Capture the halt facts before `detach`, which clears the
  active boot selection, and render after it, so its shell-disconnect output
  cannot scroll the screen.
- Cursor visibility has exactly two owners, because the in-world display draws
  its cursor cell only while `cursorBlink` is set. POST, `clearCsBiosForOs`, the
  halt screens, and `failStopState` stop it; `writeTerminalPrompt` in
  `runtime/nativeModules.ts` takes it back whenever the OS presents a non-empty
  interactive prompt, so the boot boundary, a halt, and a guest that hid the
  cursor all recover at the next prompt. An empty `ShellSession.prompt()` means
  a full-screen program owns the screen, and that program owns its own cursor
  through `term.set_cursor_blink` or the CS-ABI frame. Do not add a third owner.
- State only the recovery the machine really has. `crashed` accepts only
  `reset`, and both the sneaking Bedrock action and the Web Terminal power
  control expose that as safe boot, so halt text must name safe boot rather than
  a power cycle. The `/startup.py` bypass exists only when
  `supportsMicroPython && profile === "linux"`; elsewhere safe boot only skips
  bootable floppy media, and the halt row, the in-game crashed line, and the
  boot journal must all say that instead.
- Graceful stop is bounded and observable: stop admission, signal owned work,
  drain admitted work and block I/O, sync, unmount, stop services/devices, save
  final state, then terminate or reboot. Each phase has a 200-tick deadline and
  no more than 16 stopping Computers advance per host tick.
- `sync` must invoke a real persistence boundary. A deadline or durability
  failure faults; never report a clean stop without durable evidence.
- The stop phases append each journal record after performing the mutation it
  describes, so no append that follows a committed mutation may be able to fail;
  oldest-first journal rotation is what makes that order safe. Do not add a
  validating or capacity-bearing append after a mutation, and keep the original
  phase failure authoritative when the precommit rollback finds nothing to
  remove, because `advanceStopState` wraps a rollback failure and would
  otherwise mask the real persistence failure. Route a stop-request failure to
  `failStopState` rather than to the caller; the stop already owns the entry.
- Before the single final-save callback, append only truthful
  `final sync requested` and intent-prepared records. Do not append an unsaved
  post-callback success line. On marker/callback failure, remove only that
  attempt's provisional markers before shared fault finalization.
- Safe boot is a one-shot bypass of a broken `/startup.py`, available only while
  `crashed`. It preserves the file. Do not expose a guest or MCP safe-boot
  command, and do not reset, rename, delete, or rewrite the startup file. It
  also skips bootable floppy media, which is its only real effect on a machine
  without the `/startup.py` bypass.
- A failed CSBIOS handoff must fault the OS runtime it started before detaching.
  `completeOsRuntimeDetach` otherwise records a clean
  `begin_shutdown("runtime_detached")` over a failed handoff, so the journal
  never carries the reason and the phase never reflects the fault.

## Snapshot and startup migration orchestration

- Gate Computer and Web startup until storage migration reaches an explicit
  complete or failed terminal result.
- The coordinator accepts an explicit bounded operation budget (1..64), while
  the production host advances it with budget 1: at most one Dynamic Property
  operation per host tick. Do not describe every direct coordinator call as one
  operation.
- Validate and migrate every referenced Computer even when the identity store is
  already current. Commit and verify Computer generations before activating the
  identity registry last.
- Recognize only supported schema-1 Computer/filesystem snapshots and legacy
  indexed-page manifests. Migration is restart-idempotent and skips already
  current Computer generations.
- Identity-store format migration may re-encode a valid schema-2 registry but
  must not renumber legacy identities or reinterpret unsupported schemas.
- Coordinate account migration through the OS boundary. The recognized legacy
  `computer` account must become `cs` completely; no alias or compatibility
  symlink remains.

## Hardware handoff

- Stationary hardware migration rewrites only an exact former hardware tuple.
  Portable migration requires the recognized legacy Linux profile plus the exact
  default/former-desktop CPU, clock, and RAM tuple, then sets the complete
  Portable DOS/display profile. Preserve any customized OS, CPU, clock, or RAM;
  there is no persisted disk-profile field in this aggregate.
- Hand display attachment/replacement/power-off transitions to the display
  application boundary exactly once; its scoped guidance owns delta draining.

## Verification

Use `tests/computer/` for aggregate behavior. Migration work needs legacy,
current, fallback, conflicting-destination, injected-failure, restart, and
rollback coverage. Lifecycle work needs success, timeout, cancellation,
disconnect, persistence-failure, and exactly-once finalization coverage.
