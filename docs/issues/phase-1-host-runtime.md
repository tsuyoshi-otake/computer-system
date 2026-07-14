# Phase 1: Build the host-side Computer System runtime

Parent: #1 Blocked by: #2

## Scope

- [x] Create the TypeScript, formatting, lint, type-check, Vitest, and build
      setup.
- [x] Define acyclic domain, application, and adapter boundaries.
- [x] Implement the original Python lexer, parser, AST, bytecode compiler, and
      stack VM. (The bytecode VM was later retired by Issue #13 in favor of the
      shared CS486 backend.)
- [x] Implement instruction, stack, collection, string, event, and timer limits.
- [x] Implement fair round-robin scheduling and explicit VM wait states.
- [x] Implement terminal buffer and in-memory filesystem domains.
- [x] Implement initial `os`, `term`, and `fs` native modules.
- [x] Add ComputerCraft-behavior compatibility fixtures without copying its code
      or assets.

## Acceptance rubric

`Verify:` Run formatting, lint, type-checking, unit tests, compatibility tests,
and deterministic scheduler tests entirely outside Minecraft.

`Expect:` All checks pass; infinite programs yield; sleeping and event-waiting
programs resume; terminating and crashing programs reach explicit final states;
and 20 runnable computers receive fair execution slices.

## Completion evidence

- `tests/architecture/dependencyBoundaries.test.ts` enforces inward-only,
  cycle-free Phase 1 dependencies.
- `tests/language` covers the documented lexer, parser, source spans, and syntax
  failures.
- `tests/runtime/compilerVm.test.ts` covers bytecode execution and explicit
  completion, wait, termination, crash, exception, and `finally` control flow.
- `tests/runtime/limits.test.ts` covers every configured resource boundary.
- `tests/runtime/scheduler.test.ts` runs 20 CPU-bound computers for 1,200 ticks
  and verifies sleep, event, timer, termination, and crash isolation behavior.
- `tests/domains` covers the fixed-cell terminal and transactional in-memory
  filesystem, including invalid operations and capacity failures.
- `tests/runtime/nativeModules.test.ts` and
  `tests/compatibility/computercraft.test.ts` cover the allowlisted native API,
  snake_case names, and independently specified camelCase compatibility aliases.
- `npm run validate` passes formatting, lint, type checking, all host tests, and
  the production pack build.
