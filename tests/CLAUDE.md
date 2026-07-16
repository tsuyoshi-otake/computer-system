# Test guidance

## Child scopes

| Child scope                                 | Responsibility                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| [`adapters/`](adapters/CLAUDE.md)           | Concrete outward repository and payload-boundary tests                 |
| [`application/`](application/CLAUDE.md)     | Directly mirrored application-unit test scopes                         |
| [`architecture/`](architecture/CLAUDE.md)   | Dependency and host/guest boundary enforcement                         |
| [`domains/`](domains/CLAUDE.md)             | Filesystem, display, redstone, and terminal domain contracts           |
| [`domain/`](domain/CLAUDE.md)               | Other domain-family test scopes                                        |
| [`language/`](language/CLAUDE.md)           | Core Computer System lexer/parser contracts                            |
| [`computer/`](computer/CLAUDE.md)           | Computer aggregate, lifecycle, persistence, migration, and integration |
| [`os/`](os/CLAUDE.md)                       | Linux/DOS profiles, accounts, DAC, shell, and OS presence              |
| [`runtime/`](runtime/CLAUDE.md)             | Scheduler, WorkMonitor, CS486, Python, cache, and core toolchain       |
| [`terminal/`](terminal/CLAUDE.md)           | Session, target, snapshot, viewport, and writer authority              |
| [`editor/`](editor/CLAUDE.md)               | DOS `EDIT`, vi, nano, and bounded highlighting                         |
| [`io/`](io/CLAUDE.md)                       | RS-232C, I2C/SPI, brokers, and serial matrix                           |
| [`phase0/`](phase0/CLAUDE.md)               | Production compatibility facades and feasibility contracts             |
| [`compatibility/`](compatibility/CLAUDE.md) | ComputerCraft-facing compatibility boundary                            |
| [`bedrock/`](bedrock/CLAUDE.md)             | Script API adapter/probe wiring and native evidence boundary           |
| [`tools/`](tools/CLAUDE.md)                 | MCP, Web, Pages, manual, build, and asset tooling                      |

- Mirror production ownership: `tests/domains/`, `tests/domain/`, and
  `tests/language/` for domain models; `tests/computer/`, `tests/os/`,
  `tests/runtime/`, `tests/io/`, `tests/terminal/`, and `tests/editor/` for
  application behavior; `tests/application/` for directly mirrored application
  units; `tests/adapters/` for outward repositories; `tests/architecture/` for
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

## Evidence

Host tests do not replace real behavior checks. Bedrock-facing work needs real
BDS/GDK evidence; live Web and Pages changes need a real browser. Record an
executable `Verify:` and observable `Expect:` for every acceptance criterion,
and keep failures/log excerpts bounded and free of secrets.

`npm run validate` remains the complete host gate after focused child tests.
