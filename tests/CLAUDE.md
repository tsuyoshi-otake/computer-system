# Test guidance

## Placement and scope

- Mirror production ownership: `tests/domains/` for domain models;
  `tests/computer/`, `tests/os/`, `tests/runtime/`, `tests/io/`,
  `tests/terminal/`, and `tests/editor/` for application behavior;
  `tests/adapters/` for outward repositories; `tests/architecture/` for
  dependency and host/guest-shell boundaries; `tests/compatibility/` and
  `tests/phase0/` for preserved facades/contracts; `tests/bedrock/` for thin
  adapter/probe contracts; and `tests/tools/` for Node, Web, MCP, build, and
  publication tooling.
- When testing a subsystem, read its source-scoped `CLAUDE.md`. Tests must
  enforce that contract rather than inventing a second one.
- Prefer behavior and serialized-state assertions over source-string assertions.
  Source inspection is acceptable only where Minecraft APIs cannot run on host,
  and it is never evidence that native UI behavior works.

## Required test shape

- Cover success plus malformed input, boundary values, capacity-plus-one,
  cancellation, timeout, disconnect, retry, rollback, persistence failure, and
  exactly-once finalization as applicable.
- Stateful tests assert the observable terminal outcome and the complete
  retained state. A rejected mutation must prove there is no partial write,
  stale index, leaked credential, queued continuation, or duplicate callback.
- Migration suites include legacy, current, recovered fallback, conflict,
  corruption, injected failure, restart at intermediate states, and a second
  idempotent run.
- Security tests prove negative boundaries: pre-login rejection, viewer input
  rejection, DAC traversal, managed-account-file protection, privilege cleanup,
  host-command isolation, token/log redaction, and static-site separation.
- Performance-sensitive tests assert algorithmic/batch invariants and one item
  above each documented capacity. Do not use fragile host wall-clock thresholds
  as guest timing evidence.
- Use deterministic clocks, IDs, and randomness plus isolated free/ephemeral
  ports and work directories. Clean up owned processes/servers and never reset
  the interactive BDS world.

## Focused gates

- `npm run test:web`: session store, companion server/config, live Web behavior.
- `npm run test:pages`: static builder/UI and canonical manual agreement.
- `npm run test:mcp`: MCP server/debug-session host contract.
- `npm run test:mcp:bds`: managed real-BDS smoke acceptance.
- `npm run test:mcp:serial:bds`: isolated serial matrix acceptance.
- `npm run test:bds` / `npm run test:bds:disconnect`: production pack probes.

The Linux authentication BDS record must prove pre-login MCP rejection, masked
first-boot setup, rebooted `cs` username/password login, authenticated `whoami`,
explicit shutdown, and no probe-password emission.

`tests/tools/webManual.test.mjs` locks the 16-chapter order, chapter/header
agreement, IDs, goal paths, and search/navigation contract. Update canonical
manual content and its agreement tests together.

## Evidence

Host tests do not replace real behavior checks. Bedrock-facing work needs real
BDS/GDK evidence; live Web and Pages changes need a real browser. Record an
executable `Verify:` and observable `Expect:` for every acceptance criterion,
and keep failures/log excerpts bounded and free of secrets.
