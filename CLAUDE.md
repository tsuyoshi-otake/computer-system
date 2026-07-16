# CLAUDE.md

## Project overview

Computer System is a ComputerCraft-inspired Minecraft Bedrock Add-On. It ships
deterministic, sandboxed CS-Linux and CS-DOS computers backed by one validated
CS process. Computer System Python compiles to that process; it has no separate
Python VM. Desktop machines use CS486DX/CS486DX2 profiles. Portable machines use
CS386SX, retain ASM, C, C++, BASIC, and bounded DOS batch support, and reject
user MicroPython.

Minecraft-specific code is a thin adapter around host-testable domain and
application layers:

```text
Bedrock adapters -> application services -> domain/runtime abstractions
```

Production interaction uses the local Web Terminal companion started with
`npm run dev:bds:web`. Companion failure must remain explicit and must not open
the native GDK terminal as a fallback.

## Instruction scopes

This root file contains only repository-wide rules. More specific `CLAUDE.md`
files are loaded on demand when work enters their directory. Apply all ancestor
instructions together; a child file narrows its scope and must not silently
weaken a repository-wide safety rule.

| Scope                           | Responsibility                                                                  |
| ------------------------------- | ------------------------------------------------------------------------------- |
| `src/`                          | Dependency direction, deterministic state, and shared source rules              |
| `src/domain/`                   | Pure domain models: filesystem, CPU, display, terminal, and devices             |
| `src/application/computer/`     | Computer identity, boot, lifecycle, hardware, and migration orchestration       |
| `src/application/display/`      | Shared display-delta fan-out and consumer lifecycle                             |
| `src/application/editor/`       | Bounded DOS `EDIT`, `vi`, and `nano` state machines                             |
| `src/application/io/`           | Face I/O, serial links, and peripheral bus brokers                              |
| `src/application/os/`           | CS-Linux/CS-DOS accounts, shell, filesystem images, and OS presence             |
| `src/application/runtime/`      | Scheduler, work monitor, Python, block I/O, and guest execution                 |
| `src/application/terminal/`     | Terminal sessions, snapshot scheduling, targets, and writer authority           |
| `src/application/toolchain/`    | CS486 assembler, IR, compilers, debugger, object format, and linker             |
| `src/adapters/storage/`         | Dynamic Property persistence, paged generations, recovery, and migration        |
| `src/bedrock/`                  | Script API adapters, player interaction, blocks, terminal, and Web handoff      |
| `src/phase0/`                   | Production compatibility facades and bounded feasibility primitives             |
| `web/`                          | Live authenticated Web Terminal and canonical authored manual module            |
| `site/`                         | Static public landing page and progressively enhanced field manual              |
| `tools/`                        | Build tooling, BDS/MCP companion, Web service, deployment, and asset generation |
| `packs/`                        | Authored Behavior/Resource Pack manifests, definitions, and versioning          |
| `tests/`                        | Test placement, acceptance evidence, and focused verification                   |
| `docs/`                         | Maintainer/operator documentation, verification records, and issue evidence     |
| `.github/`                      | GitHub Actions, least privilege, and Pages publication                          |
| `vendor/bedrock-core-ui-0.9.2/` | Pinned upstream UI source, compiled mirror, and RP protocol assets              |

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
  portable, monitor, reload, migration, failure, and rollback paths.
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

Use English commit messages with useful detail and reference every applicable
Issue. Issue #4 remains relevant while Phase 2 work is in scope.

## Current publication status

The Pages artifact and workflow exist, but the public site is not live because
of an external private-repository plan constraint. Do not claim publication or
make the repository public without explicit user authorization. Operational
status and recovery steps belong to `.github/CLAUDE.md`.

## Working references

`README.md` is the project/operator entry point. Keep it synchronized with
installation, supported behavior, limits, and links. Start work with it,
`docs/development.md`, `docs/mcp-debugging.md`, `docs/manual-verification.md`,
and the nearest scoped `CLAUDE.md`. Keep temporary scripts and work artifacts
under `%USERPROFILE%\tmp`, never directly in the home directory.
