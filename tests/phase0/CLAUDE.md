# Phase 0 compatibility test guidance

- Phase 0 facades still have production consumers. Tests preserve their bounded
  lease, transaction, portable-session, redstone, terminal, probe, and scheduler
  contracts while modern owners evolve.
- Do not add new production policy to make a compatibility test pass. Prove the
  facade delegates or remains behaviorally equivalent to the current owner.
- Cover commit/rollback exactly once, capacity-plus-one, cancellation, conflict,
  stale lease/session, finalization, and unchanged state after failure.
- Before changing an export, search production `src/`, tools, compatibility
  tests, and probes; run focused tests for every consumer.
- The sibling `tests/compatibility/` scope owns the ComputerCraft-facing subset.
  Phase 0 behavior must not be approximated beyond an explicitly documented
  compatibility contract.

## Focused verification

Run `npm test -- tests/phase0 tests/compatibility`. If a facade participates in
a production probe, run the smallest applicable real-BDS acceptance.
