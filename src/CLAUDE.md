# Source guidance

## Child scopes

These rules apply to all production TypeScript under `src/`. Read the deeper
`CLAUDE.md` before changing a listed subsystem.

| Child scope                             | Responsibility                                                 |
| --------------------------------------- | -------------------------------------------------------------- |
| [`domain/`](domain/CLAUDE.md)           | Pure deterministic models, split further by model family       |
| [`application/`](application/CLAUDE.md) | Use-case orchestration, split further by application subsystem |
| [`adapters/`](adapters/CLAUDE.md)       | Outward persistence/integration implementations                |
| [`bedrock/`](bedrock/CLAUDE.md)         | Minecraft Script API edge and deeper probe rules               |
| [`phase0/`](phase0/CLAUDE.md)           | Production compatibility facades and feasibility primitives    |

## Dependency direction

Dependencies point inward:

```text
src/bedrock and src/adapters
  -> src/application
    -> src/domain and runtime abstractions
```

- `src/adapters/` implements outward persistence and integration boundaries.
- `src/bedrock/` is the only Minecraft Script API edge. Keep it thin.
- Do not create dependency cycles or move a stable abstraction outward merely to
  reuse an adapter implementation.

## State and performance

- Give every mutable aggregate one authoritative owner. Presentation layers and
  virtual files derive views from that owner; they do not maintain parallel
  truth.
- Validate capacities and invariants before mutation. Capacity-plus-one and
  malformed persisted input must fail without partial state change.
- Bound all work that can run in a BDS tick or grow from guest input. Prefer
  Map-backed O(1) identity lookup and fixed-batch O(K) scans over repeated O(N)
  enumeration.
- Admit side-effecting work before executing it. A post-execution budget check
  must not turn a successful mutation into an uncaught failure.
- Guest-facing errors and output use the selected OS profile; host exceptions
  and host paths must not leak into the guest.

## Cross-cutting changes

- Keep source tests in the matching `tests/` subtree and update user-visible
  manual content whenever behavior, limits, commands, hardware, or diagnostics
  change.
- Persistence-shape changes require backward-compatible migration and restart
  idempotence tests.
- Security-boundary changes require negative tests proving the bypass remains
  closed, not just positive-path tests.
- Use the root `npm run validate` gate before handoff.
