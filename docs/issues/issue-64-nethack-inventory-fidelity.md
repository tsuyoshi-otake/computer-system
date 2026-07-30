# Issue #64 — NetHack fixed-slot inventory fidelity

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/64

Status: implemented and verified through the host gate, real BDS, and the
Chrome-opened Web Terminal.

On 2026-07-29 the user explicitly reauthorized this bounded inventory-fidelity
slice. The wider reduced-game prototype remains frozen and excluded from project
completion percentages.

## Upstream behavior retained

The command surface now follows the NetHack interaction model instead of the
prototype's former first-item shortcut:

- `i` opens a full-screen inventory with stable `a` through `p` object letters.
- `e`, `q`, `r`, `w`, `W`, `T`, and `d` own distinct eat, quaff, read, wield,
  wear, take-off, and drop flows. `w-` unwields.
- `?` and `*` redisplay an object selector and Escape cancels it.
- Floor objects remain in place until the explicit `,` pickup command.
- `q` means quaff. Only the complete `#quit` command abandons the game.
- Weapon and armor state is visible in the inventory and survives an explicit
  save.

This is still a reduced guest-authored game, not an unmodified upstream port.
Shops, containers, throwing, rings, wands, burden, BUC, identification, and the
full object catalog remain outside this authorized slice.

## Bounded implementation

The pack is a fixed 16-slot structure. Selection and capacity checks are O(16).
Ground transfer work is O(64), using the existing fixed entity store. A ground
entity carries one to four identical objects in two previously unused packed
bits; larger drops are split only after an O(64) capacity preflight proves that
the complete mutation fits. No allocation, recursion, polling, or unbounded
retry was added.

Stable slots avoid compaction after consumption or drop, so existing object
letters and equipment references do not change unexpectedly. A successful item
mutation commits exactly one guest turn. Display, redisplay, cancellation,
invalid class/slot input, already-equipped requests, and capacity rejection are
explicit no-turn terminal states.

Save version 3 appends two equipment references to the exact 2,191-word version
2 layout. The loader accepts only exact v2 or v3 lengths, reads into scratch
storage, validates headers, scalar bounds, active entities, inventory rules, and
equipment references, and only then mutates live globals. A valid v2 record
normalizes its historically stale unused inventory tail and migrates to v3 on
the next explicit save.

## Acceptance rubric

1. Full-screen inventory and stable selection
   - Verify: `npx vitest run tests/computer/nethackRuntime.test.ts`
   - Expect: the 80×25 screen shows fixed `a`–`p` rows, quantities, names, and
     equipped markers; `?`, `*`, and Escape leave the saved turn unchanged.
2. Command and transaction fidelity
   - Verify: run the same focused test file.
   - Expect: eat/quaff/read/wield/wear/take-off/drop/pickup each have observable
     success and rejection paths, and each successful mutation advances exactly
     one saved turn.
3. Bounded stack transfer
   - Verify: run the same focused test file.
   - Expect: ground stacks round-trip at quantities 1–4, duplicate pickup works
     at 16 occupied slots, and capacity-plus-one rejects atomically.
4. Save compatibility and validation
   - Verify: run the same focused test file.
   - Expect: exact v2 loads and migrates, v3 equipment round-trips, and
     malformed v3 input remains byte-identical after rejection.
5. Corridor performance remains fixed
   - Verify: run the same focused test file.
   - Expect: a deterministic room-to-corridor transition remains within three
     modeled ticks, 419,819 instructions, and 831,336 cycles.
6. Complete host gate
   - Verify: `npm run validate`
   - Expect: formatting, ESLint, TypeScript, all Vitest tests, the Bedrock pack,
     and all 16 manual chapters pass.

## Verification evidence

Verify on 2026-07-29: `npx vitest run tests/computer/nethackRuntime.test.ts`.

Expect: the complete reduced NetHack runtime suite passes, including fixed-slot
inventory commands, transactional ground stacks, save v2/v3 compatibility, and
the corridor performance ceiling.

Result: PASS, 15 tests.

Verify on 2026-07-29: `npm run validate` with Node.js 24 or later, followed by a
process check for repository Vitest or `node --test` survivors.

Expect: formatting, ESLint, TypeScript, all Vitest suites, the production
Bedrock pack, and all 16 Pages chapters pass, and no test runner remains.

Result: PASS, 312 test files and 2,644 tests. The pack and Pages builds passed,
and the post-run process check found no surviving test runner.

Verify on 2026-07-29: start a fresh isolated `ComputerSystemAcceptance` world
through the BDS MCP, provision its advanced CS486 Computer, and open its Web
Terminal in the configured Chrome browser through `bds_open_web_terminal`.
Launch `nethack`, send only correlated MCP TUI input, and verify the resulting
screens at 80×25 with color grids.

Expect: `i` opens `Inventory`; Escape cancels; `q` opens `Quaff what?` without a
quit prompt; the complete `#quit` command returns to the CS-Linux shell; and BDS
stops cleanly after verification.

Result: PASS on Computer `c-k9b9bx`. Inventory was snapshot 16, the quaff
selector was snapshot 19, and `#quit` returned to `cs@c-k9b9bx:~$` at
snapshot 21. The verifier used an external disposable work root, did not reset
the preserved operator world, and stopped the isolated BDS session.
