# Computer integration test guidance

- This scope owns the Computer aggregate: identity, hardware, BIOS/boot,
  lifecycle, credentials integration, display broker, persistence, migration,
  host orchestration, and production probe composition.
- Keep OS command/account units in `tests/os`, CPU/Python/toolchain units in
  `tests/runtime`, writer authority in `tests/terminal`, and wire protocols in
  `tests/io`. Test their cross-boundary ownership here only where
  ComputerRuntime coordinates it.
- Lifecycle coverage includes success, fault, cancel, timeout, disconnect,
  shutdown/reboot, persistence failure, safe boot, credential cleanup, and
  exactly one final callback/result.
- Migration covers legacy/current payloads, valid fallback, corrupt previous
  metadata, conflicts, injected failures, restart at every state,
  already-current identity with legacy Computers, and a second idempotent run.
- Production storage migration advances with at most one Dynamic Property
  operation per host tick, verifies/commits Computers first, and activates the
  identity registry last. Rejection proves exact prior identity/generation
  state.
- Broker tests prove one destructive display drain, identical fan-out, late
  keyframes, epoch replacement, and final detach release.
- Interactive latency is counted in modeled scheduler ticks with no work scope
  and no host clock. Assert that dividing a dispatch into bounded atomic
  sub-slices leaves those counts identical, and that a presented frame is
  identified by guest-drawn content rather than by any terminal change, which a
  shell screen clear also produces. A stepping host clock is not admissible
  evidence: `tryRun` reads the clock a fixed number of times per operation, so
  it charges per operation instead of per unit of work.

## Focused verification

Run `npm test -- tests/computer`. Add real-BDS/GDK evidence when the aggregate
change crosses a Bedrock adapter or visible lifecycle behavior.
