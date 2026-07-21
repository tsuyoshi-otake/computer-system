# Issue #44: bounded guest-side Make for CS-Linux

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/44

Status: implemented and verified on the complete host gate, isolated MCP/BDS,
and real Chrome.

## Implemented boundary

- CS-Linux rootfs v10 introduced /usr/bin/make; current v11 retains it, while
  immutable v1-v9 images and current CS-DOS remain make-free.
- guestMake.ts owns bounded argument parsing, variables, explicit rules, .PHONY,
  dependency planning, automatic variables, cycle detection, and mtime decisions
  in O(source bytes + nodes + edges).
- .cs-make-state adds a bounded deterministic content fingerprint with each
  input read once per pass and a 1 MiB aggregate fingerprint-input limit.
- ComputerRuntime owns one make PID, one 128 KiB RAM lease, one recipe per
  scheduler tick, block-I/O waits, and exactly-once foreground finalization.
- Recipes are isolated from parent cwd, environment, aliases, functions, and
  umask. Only the documented guest toolchain, synchronous filesystem, and output
  commands are admitted.
- No path invokes host make, a host shell, host processes, host filesystems,
  compilers, network access, or BDS administration commands.

## Explicit exclusions

GNU/BSD Make compatibility is not claimed. Pattern and implicit rules, includes,
conditionals, functions/eval, shell/wildcard expansion, recursive make, parallel
jobs above one, pipelines, redirects, command chains, background work,
TUI/session/lifecycle commands, and CS-DOS MAKE are unsupported and fail
explicitly.

## Verification evidence

Verify: node .\node_modules\vitest\vitest.mjs run
tests/runtime/guestMake.test.ts tests/os/makeCommand.test.ts
tests/computer/guestResourceAccounting.test.ts
tests/computer/linuxMakeProbe.test.ts
tests/bedrock/headlessAuthenticationProbe.test.mjs.

Expect: Parser/planner limits, variable and automatic-variable expansion,
dependency ordering, cycle and missing-target failures, rootfs v10/v9/DOS
boundaries, real C compile/link, no-op, content-fingerprint rebuild, dry-run,
and recipe rejection all pass.

Result on 2026-07-20: 5 files and 16 tests passed.

Verify: npm exec vitest run tests/computer/guestResourceAccounting.test.ts -t
"ticks one make recipe".

Expect: One recipe advances on one tick; the 128 KiB lease and make PID are
present while active; Ctrl+C publishes one exit 130, reaps the PID, returns the
lease, and prevents later recipes.

Result on 2026-07-20: included in the focused 5-file run and passed.

Verify: npm run validate.

Expect: Prettier, ESLint, TypeScript, all Vitest suites, the Bedrock pack build,
and the 16-chapter Pages build pass.

Result on 2026-07-20: 180 test files and 1,248 tests passed; both production
builds completed.

Verify: set isolated BDS_MCP_WORKDIR, BDS_MCP_PORT, and WEB_COMPANION_PORT
values, then run npm run test:mcp:bds.

Expect: The real BDS headless suite emits linux_make/PASS only after the
production synchronous MCP path builds, reports an unchanged second build,
rebuilds older-mtime changed content, stops after a rejected recipe, finalizes
the Computer off, and reports no diagnostics.

Result on 2026-07-20: PASS with built=true, noOp=true, rebuilt=true,
failureStopped=true, finalized=true, ticks=80, diagnostics=0, and finalState
idle. The standard isolated npm run test:bds suite also passed twice with zero
probe failures.

Verify: serve dist/pages locally, open /manual/ in Chrome, search for "CS Make
1.0", open the Chapter 04 result, and apply a temporary 390x844 viewport.

Expect: Search returns the CS Make section, the documented Linux/DOS boundary
and production limits are visible, the document and body do not overflow
horizontally, the search field and heading remain inside the viewport, and no
browser warnings or errors are recorded.

Result on 2026-07-20: 7 search results with the CS Make section first;
document/body width 375/375, both controls inside the viewport, and zero
warnings/errors.
