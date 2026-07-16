# Application guidance

## Boundary

Application services coordinate domain models and injected ports. They own
use-case policy, admission, orchestration, and observable finalization, but must
not import `@minecraft/*`, Web server code, or concrete Dynamic Property
repositories.

## Child scopes

| Child scope                         | Responsibility                                                 |
| ----------------------------------- | -------------------------------------------------------------- |
| [`computer/`](computer/CLAUDE.md)   | Computer boot, identity, lifecycle, persistence, and migration |
| [`display/`](display/CLAUDE.md)     | Shared display-delta drain and consumer fan-out                |
| [`editor/`](editor/CLAUDE.md)       | Bounded guest editor state machines                            |
| [`io/`](io/CLAUDE.md)               | Serial-link and peripheral-bus brokers                         |
| [`os/`](os/CLAUDE.md)               | Linux/DOS accounts, shell, images, and OS presence             |
| [`runtime/`](runtime/CLAUDE.md)     | Scheduler, WorkMonitor, Python compilation, and block I/O      |
| [`terminal/`](terminal/CLAUDE.md)   | Sessions, snapshots, targets, and writer access                |
| [`toolchain/`](toolchain/CLAUDE.md) | CS486 assembler, C/C++, IR, linker, and debugger               |

## Shared rules

- Inject clocks, identifiers, persistence, transport, and host-work admission.
  Do not read host state or call adapters through hidden globals.
- Keep domain aggregates authoritative. Application caches, indexes, and views
  must have explicit invalidation and must not become parallel persisted truth.
- Validate untrusted adapter/transport input before passing typed values inward.
  Translate failures at the owning boundary without leaking host paths or
  credentials into guest-visible output.
- Focus tests in the matching application suite plus the owning domain/adapter
  boundary. Include capacity-plus-one, injected failure, and exactly-once cases.
