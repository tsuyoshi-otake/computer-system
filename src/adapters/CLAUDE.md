# Adapter guidance

## Boundary

Adapters implement outward ports for application services. They may depend on
application/domain abstractions, but application and domain code must never
depend on a concrete adapter.

## Child scopes

| Child scope                     | Responsibility                                              |
| ------------------------------- | ----------------------------------------------------------- |
| [`storage/`](storage/CLAUDE.md) | World Dynamic Property generations, recovery, and migration |

## Shared rules

- Treat every external payload as untrusted. Validate schema, size, identity,
  and representability before exposing it to application code.
- Bound calls, bytes, retries, cleanup, enumeration, and per-tick work. Adapter
  convenience must not hide an O(N) production scan or an unbounded host loop.
- Map host/provider failures into explicit repository outcomes while preserving
  enough cause for the application owner to choose retry, recovery, or failure.
  Never silently substitute empty/default state for corruption or outage.
- Do not place guest shell policy, Minecraft UI behavior, or domain invariants
  in an adapter. The adapter enforces its transport/storage boundary only.
- Verify malformed input, unavailable provider, partial mutation, idempotent
  retry, capacity-plus-one, and provider-visible state after failure.
