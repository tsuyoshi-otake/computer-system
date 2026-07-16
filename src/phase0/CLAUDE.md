# Phase 0 compatibility guidance

## Scope

This directory contains early feasibility primitives and compatibility facades
that are still imported by production code and probes. It is not abandoned test
code.

- Keep facades thin and behaviorally compatible with the current domain or
  application owner. New production policy belongs in the owning modern
  subsystem, not duplicated here.
- Preserve bounded operation leases, terminal finalization, monitor-surface,
  portable-session, redstone constraints, probe protocol, and scheduler-probe
  semantics until every production import has migrated.
- A compatibility wrapper must propagate explicit success/failure/rollback and
  must not translate an unsupported outcome into success.
- Transactional operations commit or roll back exactly once. Probe helpers bound
  input, output, retained state, and work per tick.
- Before deleting or reshaping an export, search production `src/`, tools, and
  tests for consumers and provide an intentional migration.

## Verification

Run `tests/phase0/` plus the focused tests for every production consumer. If a
facade participates in Bedrock probes, also run the smallest real-BDS
acceptance.
