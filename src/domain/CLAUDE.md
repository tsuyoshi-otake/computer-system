# Domain guidance

## Scope and purity

This directory contains host-independent domain models. Do not import Minecraft,
Node host-process APIs, Web transports, storage adapters, wall-clock timers, or
application services. Inject time, persistence, I/O, admission decisions, and
randomness when repeatability matters. `ComputerIdAllocator` has the one
isolated default `Math.random` source; do not spread implicit randomness to
other models.

## Child scopes

| Child scope                           | Responsibility                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| [`computer/`](computer/CLAUDE.md)     | Stable identity, lifecycle transitions, hardware aggregate, and faces        |
| [`cpu/`](cpu/CLAUDE.md)               | CS486 process, object/executable representation, timing, and cache/bus model |
| [`display/`](display/CLAUDE.md)       | Display profiles, transient VRAM, dirty tiles, and modes                     |
| [`filesystem/`](filesystem/CLAUDE.md) | In-memory inode/filesystem persistence and transactions                      |
| [`io/`](io/CLAUDE.md)                 | Byte rings and bounded RS-232C/I2C/SPI device atoms                          |
| [`language/`](language/CLAUDE.md)     | Core Computer System language source, lexer, parser, and AST                 |
| [`redstone/`](redstone/CLAUDE.md)     | Side and power-state invariants                                              |
| [`runtime/`](runtime/CLAUDE.md)       | Generic process values, events, errors, and transaction quarantine           |
| [`storage/`](storage/CLAUDE.md)       | IDE/FDD profiles, block requests, deadlines, and media state                 |
| [`terminal/`](terminal/CLAUDE.md)     | Fixed-cell buffer and terminal-session protocol                              |
| [`text/`](text/CLAUDE.md)             | Deterministic UTF-8 primitives                                               |

## Shared domain rules

- Validate all invariants and capacities before mutation. Domain failures are
  explicit and deterministic; they do not inspect host state to choose an
  outcome.
- Keep lookup/update complexity documented and bounded. Avoid hidden allocation,
  global enumeration, nondeterministic iteration, or regular expressions over
  unbounded user input. Do not claim locale independence for a model that uses
  locale-aware comparison.
- Every snapshot explicitly defines which state is persisted and which state is
  transient. A round trip preserves its declared persistence contract. Where an
  operation promises rejection without modeled mutation, verify exact retained
  state; do not assume rejection counters or conflict observations are inert.
- Application policy such as Linux/DOS paths, commands, boot layout, access
  control, presentation text, and Minecraft interaction does not belong here.
- Place tests in the matching `tests/` subtree, including `domains/`,
  `domain/storage/`, `language/`, `io/`, `terminal/`, `runtime/`, or
  `computer/`, and include boundary/capacity failures.
