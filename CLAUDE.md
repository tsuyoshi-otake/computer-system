# CLAUDE.md

## Project overview

Computer System is a ComputerCraft-inspired Minecraft Bedrock Add-On. It ships
deterministic, sandboxed CS-Linux and CS-DOS computers backed by one validated
CS process. Computer System Python compiles to that process; it has no separate
Python VM. Desktop machines use CS486DX/CS486DX2 profiles. Portable machines use
CS386SX, retain ASM, C, C++, CS QBASIC, and bounded DOS batch support, and
reject user MicroPython.

Minecraft-specific code is a thin adapter around host-testable domain and
application layers:

```text
Bedrock adapters -> application services -> domain/runtime abstractions
```

Production interaction uses the local Web Terminal companion started with
`npm run dev:bds:web`. Companion failure must remain explicit and must not open
the native GDK terminal as a fallback.

## Child scopes

This root file contains only repository-wide rules. More specific `CLAUDE.md`
files are loaded on demand when work enters their directory. Apply all ancestor
instructions together; a child file narrows its scope and must not silently
weaken a repository-wide safety rule.

| Child scope                                                               | Responsibility                                                                  |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`src/`](src/CLAUDE.md)                                                   | Production TypeScript and its deeper architecture scopes                        |
| [`web/`](web/CLAUDE.md)                                                   | Live authenticated Web Terminal, canonical manual, and authored Web assets      |
| [`site/`](site/CLAUDE.md)                                                 | Static public landing page and progressively enhanced field manual              |
| [`tools/`](tools/CLAUDE.md)                                               | Build tooling, BDS/MCP companion, Web service, deployment, and asset generation |
| [`packs/`](packs/CLAUDE.md)                                               | Authored Behavior/Resource Pack manifests, definitions, and versioning          |
| [`tests/`](tests/CLAUDE.md)                                               | Test placement, acceptance evidence, and focused verification                   |
| [`docs/`](docs/CLAUDE.md)                                                 | Maintainer/operator documentation, verification records, and issue evidence     |
| [`.github/`](.github/CLAUDE.md)                                           | GitHub automation and its workflow-specific rules                               |
| [`vendor/bedrock-core-ui-0.9.2/`](vendor/bedrock-core-ui-0.9.2/CLAUDE.md) | Pinned upstream UI source, compiled mirror, and RP protocol assets              |
| [`wasm/`](wasm/CLAUDE.md)                                                 | Gated Issue #106 Phase 4 Rust/AssemblyScript wasm batch-executor prototype      |

Keep a scoped rule in the narrowest directory that owns it. Do not copy the same
rule into several files. If a change crosses scopes, read each applicable
`CLAUDE.md` before editing.

## Repository-wide engineering rules

- Do not import Minecraft APIs into the domain or application core.
- Keep shell commands inside the guest filesystem and application abstractions.
  Never dispatch terminal input to host PowerShell, `cmd.exe`, Node child
  processes, arbitrary BDS administration commands, or host compilers.
- Bound scheduler work, redraws, queues, retries, polling, startup waits,
  parsers, user-controlled expansion, persistence operations, and output.
- For optimization, reason about O(N), remove the dominant serial bottleneck,
  and preserve designs that scale under parallel workloads.
- Every stateful branch must reach an explicit observable terminal state.
  Cancel, disconnect, skip, retry, rollback, competing form, server close, and
  failure paths each need one finalization owner.
- Preserve Computer identity and storage transactionally across block, item,
  portable, integrated display, reload, migration, failure, and rollback paths.
- New guest RAM, filesystem-capacity, or I/O-time consumers must account through
  `GuestRamLedger`, `InMemoryFilesystem`, or the `ComputerHost` block-I/O owner;
  do not add bypass counters or optional accounting calls.
- Keep guest timing independent from host admission and wall-clock delay. Host
  elapsed time may control admission and observability but must never rewrite
  guest CPU, disk, memory, or wire timing.
- Unsupported Bedrock or guest-OS behavior must fail explicitly. Never silently
  approximate an incompatible feature or imply support that does not exist.
- Preserve unrelated working-tree changes. Do not commit generated `dist/`
  output unless a release workflow explicitly requires it.

## Required verification

Use Node.js 24 or later. Before handing off a non-trivial change, run:

```powershell
npm run validate
```

`npm run validate` is the complete host gate: formatting, ESLint, TypeScript,
all Vitest tests, the production Bedrock pack build, and the 16-chapter Pages
build must pass. Use the smallest relevant focused command while iterating:

```powershell
npm run test:mcp
npm run test:mcp:bds
npm run test:bds
npm run test:bds:disconnect
npm run test:web
npm run test:pages
npm run build:pages
```

Bedrock-facing work also requires the smallest applicable real-BDS or GDK
verification. Browser-facing work requires a real-browser check. A successful
build alone is not proof of Minecraft or browser behavior.

For every non-trivial acceptance criterion, record an executable `Verify:` step
and an observable `Expect:` result. Keep source, tests, docs, and Issue evidence
synchronized.

## Issue map

- #4: Phase 2 Bedrock Computer vertical slice.
- #5: Redstone and local peripherals.
- #6: Networking and Portable Computer Systems.
- #12: CS-Linux/CS-DOS, virtual disks, toolchain, Web Terminal, and manual.
- #13: Python-to-CS486 compilation, filesystem imports, and C/C++ extensions.
- #14: Portable CS386SX 16 MHz / 2 MiB hardware profile.
- #15: Full-screen DOS `EDIT`.
- #16: Tick-sliced guest/MCP execution and multi-user load evidence.
- #17: CS-Linux accounts, superuser security, DAC, and `computer`-to-`cs`
  migration.
- #18: Assembler v2, structured relocations, frontend parity, and stack safety.
- #19: CS486 C/C++ frontend hardening.
- #20: State-backed OS Presence and lifecycle fidelity.
- #21: Static GitHub Pages landing page and 16-chapter field manual.
- #22: Scoped `CLAUDE.md` responsibility split.
- #24: Web Terminal handoff deduplication, exact-session lifecycle, and
  range-state stability.
- #25: Complete CS-DOS 1.0 EDIT, Program Lists, C/C++ preprocessing, ABI help,
  and QBASIC source-run development workflow.
- #26: Configurable `vi` options, bounded vimrc loading, and guest-shell
  commands.
- #27: Lightweight `vi` syntax lexers, completion, symbol indexing, and
  definition navigation.
- #28: Shared DOS editor options, lightweight language services, navigation, and
  guest-shell command integration.
- #29: EDIT and Web Terminal responsiveness, bounded input admission, and
  multi-session frame scaling.
- #31: Structural guest disk-capacity, HDD-time, and RAM accounting.
- #37: CS-Linux memory architecture v2, reclaimable buffers, and per-process
  VIRT/RSS accounting.
- #38: Authentic CS-Linux/CS-DOS filesystem layout and command placement.
- #39: Authentic CS-Linux login and session text with wall-clock history.
- #40: Web Terminal cell cursor, bounded line editing, and integer grid scaling.
- #48: CS Make state consistency v2 and scheduler-admitted planning.
- #42: SysV init and the single `/etc/crontab` command/scheduler surface.
- #44: Bounded guest-side CS-Linux Make and tick-sliced build ownership.
- #45: Bounded guest-owned `sed` and `awk` text processors.
- #46: Binary guest filesystem blobs and bounded `tar`/`gzip`/`zip` utilities.
- #47: Observable `nice`, detachable `nohup`, and finite tick-paced `watch`.
- #49-#57: Python 3.14 profile contract, foundations, bindings, calls, integers,
  expressions, assignments, and unpacking.
- #58/#61/#62: CS C 2.0, global objects, and large-program capacity.
- #59: bounded Python slicing and list slice assignment.
- #60: bounded CS-Linux Git-like VCS architecture; #63 owns CS ABI 1.0.
- #64: Preserved reduced NetHack prototype. It is frozen unless the user
  explicitly reauthorizes game implementation and is excluded from current
  completion percentages.
- #65-#68: VCS tracking plus Python assignment expressions, assertions, sets,
  comprehensions, scopes, and evaluation order.
- #69-#73: hosted C/libc, archives/Make, byte8, and deterministic floating
  point.
- #74-#78: Python classes, decorators, iterators, generators, and `send`.
- #79: Python generator exception suspension, `throw`, `close`, and
  `GeneratorExit`.
- #80: Bounded Python `yield from` delegation and nested generator protocols.
- #81: Bounded synchronous Python generator expressions and lazy comprehension
  scopes.
- #82: Bounded synchronous Python context managers and exact finalization.
- #83: Bounded user-defined Python iterator protocol and managed special-method
  calls.
- #85: Bounded generic Python iterable materialization for displays, calls,
  unpacking, slices, and sets.
- #87: Bounded Python `__getitem__` sequence-iteration fallback.
- #88: Bounded Python 3.14 deferred annotations and annotation scopes.
- #89: Bounded Python callable/sentinel iteration.
- #90: Bounded Python 3.14 type parameters and lazy type aliases.
- #91: Bounded Python generic aliases and runtime subscription.
- #92: Bounded Python 3.14 typing runtime core.
- #93: Bounded Python 3.14 coroutines and async protocols.
- #94: Bounded Python 3.14 async generators and comprehensions.
- #95: Bounded Python exception groups and `except*`.
- #96: Bounded Python 3.14 template strings and `string.templatelib`.
- #97/#98/#100/#101/#102: Bounded Python descriptors, attribute customization,
  deletion, C3 inheritance, `super`/class cells, and `__new__` construction.
- #33: Compile RAM lease finalization across completion, disconnect, and detach.
- #34: DOS memory architecture v2, atomic CONFIG, address allocation, MEM
  snapshots, and declared process grants.

Use English commit messages with useful detail and reference every applicable
Issue. Issue #4 remains relevant while Phase 2 work is in scope.

## Current publication status

The public Pages site is live at
`https://tsuyoshi-otake.github.io/computer-system/` through the official
workflow. Keep publication on `main` or manual dispatch, require successful
build/deploy jobs, and verify the deployed URL before claiming an update.
Actions evidence and recovery steps belong to `.github/workflows/CLAUDE.md`.

## Working references

`README.md` is the project/operator entry point. Keep it synchronized with
installation, supported behavior, limits, and links. Start work with it,
`docs/development.md`, `docs/mcp-debugging.md`, `docs/manual-verification.md`,
and the nearest scoped `CLAUDE.md`. Keep temporary scripts and work artifacts
under `%USERPROFILE%\tmp`, never directly in the home directory.
