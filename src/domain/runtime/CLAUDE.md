# Runtime primitive guidance

## Process values and events

- Runtime values, CPU-process contracts, waits, and events are deterministic
  guest abstractions. They contain no scheduler, host timer, Minecraft, Web, or
  filesystem-adapter policy.
- Runtime values and process results are TypeScript unions, not
  runtime-validated constructors. Validate untrusted data at the boundary that
  creates them; do not claim type tags alone reject malformed JavaScript values.
- Terminal CPU states are `completed`, `crashed`, and `terminated`. A process
  transition publishes one observable state/result; wait, resume, interrupt,
  fault, exit, and cancellation ownership must be unambiguous.
- `BoundedEventQueue` requires a positive injected capacity and nonempty event
  names. `take(filter)` deliberately discards earlier nonmatching events, so the
  queue itself is the only authority for whether a wakeup is still pending:
  `hasQueued(name)` answers that, and both `take` paths release the name.
  Callers that pair a queued event with separately buffered payload use it to
  keep one pending wakeup per name, because a surplus wakeup would resume a wait
  whose payload another wakeup already consumed. Timer queues also require
  positive injected capacity and nonnegative delay; `takeDue` is
  capacity-bounded O(N log N) and sorts by due tick then ID. It does not
  currently validate the starting tick or safe due-time overflow.

## Transaction quarantine

- Managed filesystem and DOS aggregate transactions accept synchronous callbacks
  only. Reject a declared async function before it runs.
- If a callback disguises a Promise, roll back immediately and register it in
  the shared `transactionQuarantine` until settlement. While quarantined, its
  continuation cannot enter another managed owner and mutate post-rollback
  state.
- Release quarantine exactly once on fulfillment or rejection and never treat
  settlement as transaction success. The current implementation exposes an
  unbounded process-local counter plus Promise settlement callbacks; do not
  describe retention as bounded without implementing and testing a real bound.

## Verification

Use runtime value/process suites plus filesystem and DOS injected-async tests.
Cover every value/event tag, terminal process outcome, declared async rejection,
disguised fulfillment/rejection, cross-owner escape attempts, exact rollback,
quarantine count, and release.
