# Phase 1: Build the host-side Computer System runtime

Parent: #1
Blocked by: #2

## Scope

- [ ] Create the TypeScript, formatting, lint, type-check, Vitest, and build setup.
- [ ] Define acyclic domain, application, and adapter boundaries.
- [ ] Implement the Python lexer, parser, AST, bytecode compiler, and stack VM.
- [ ] Implement instruction, stack, collection, string, event, and timer limits.
- [ ] Implement fair round-robin scheduling and explicit VM wait states.
- [ ] Implement terminal buffer and in-memory filesystem domains.
- [ ] Implement initial `os`, `term`, and `fs` native modules.
- [ ] Add ComputerCraft-behavior compatibility fixtures without copying its code or assets.

## Acceptance rubric

`Verify:` Run formatting, lint, type-checking, unit tests, compatibility tests,
and deterministic scheduler tests entirely outside Minecraft.

`Expect:` All checks pass; infinite programs yield; sleeping and event-waiting
programs resume; terminating and crashing programs reach explicit final states;
and 20 runnable computers receive fair execution slices.
