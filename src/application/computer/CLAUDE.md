# Computer application guidance

## Aggregate ownership

- `ComputerRuntime` is the application owner of one Computer's boot, execution,
  terminal, authentication, display, OS state, persistence callbacks, and final
  lifecycle result. Adapters request transitions; they do not finalize them.
- Preserve the same identity and hardware/storage/display profile through
  placement, breaking, item transfer, portable use, Monitor attachment, reload,
  rollback, and migration.
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

## Boot, shutdown, and recovery

- `powerOn()` enters `post` and renders the actual hardware profile in 80x25.
  The next runtime step clears POST, enters text mode, and hands off to the
  guest. DOS shows its identity, one blank line, and `C:\>`; Linux shows its
  identity, one blank line, then password setup/login or the shell prompt. Do
  not fabricate `tty1` or a startup shell-version banner.
- Syntax/runtime failure terminates display state as `faulted`. Shutdown and
  reboot release VRAM explicitly.
- Graceful stop is bounded and observable: stop admission, signal owned work,
  drain admitted work and block I/O, sync, unmount, stop services/devices, save
  final state, then terminate or reboot. Each phase has a 200-tick deadline and
  no more than 16 stopping Computers advance per host tick.
- `sync` must invoke a real persistence boundary. A deadline or durability
  failure faults; never report a clean stop without durable evidence.
- Before the single final-save callback, append only truthful
  `final sync requested` and intent-prepared records. Do not append an unsaved
  post-callback success line. On marker/callback failure, remove only that
  attempt's provisional markers before shared fault finalization.
- Safe boot is a one-shot bypass of a broken `/startup.py`, available only while
  `crashed`. It preserves the file. The Web action becomes `safe_boot`; Bedrock
  requires sneaking. Do not expose a guest or MCP safe-boot command, and do not
  reset, rename, delete, or rewrite the startup file.

## Snapshot and startup migration orchestration

- Gate Computer and Web startup until storage migration reaches an explicit
  complete or failed terminal result.
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

- Hardware-profile migration rewrites only an exactly recognized former default;
  preserve every customized OS, CPU, clock, RAM, disk, and display field.
- Hand display attachment/replacement/power-off transitions to the display
  application boundary exactly once; its scoped guidance owns delta draining.

## Verification

Use `tests/computer/` for aggregate behavior. Migration work needs legacy,
current, fallback, conflicting-destination, injected-failure, restart, and
rollback coverage. Lifecycle work needs success, timeout, cancellation,
disconnect, persistence-failure, and exactly-once finalization coverage.
