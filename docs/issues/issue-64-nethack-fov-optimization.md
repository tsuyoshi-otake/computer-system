# Issue #64 — NetHack corridor FOV and differential presentation

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/64

Status: implemented, host-verified, real-BDS-verified, and Chrome/Web
Terminal-verified.

On 2026-07-29 the user explicitly reauthorized this narrow NetHack correctness
and latency change. The wider reduced-game prototype remains frozen and excluded
from project completion percentages.

## The defect and dominant work

The old visibility model used room identity plus Manhattan distance. A
successful move within one room scanned a local rectangle, while crossing a
room/corridor identity boundary scanned all **1,638** cells. Every changed
visible cell also touched a 3×3 wall neighborhood. The dirty list held only 256
cells; overflow promoted the move to a full-frame render. That discontinuity
made walking into a corridor take the Issue #113 full-repaint path and appear to
freeze.

The bottleneck was guest-serial work, not terminal host I/O. Issue #113 measured
599,742 guest instructions and 1,187,623 modeled cycles for a full repaint,
while steady terminal presentation took 71–350 host microseconds. Parallelizing
a single move or adding workers would not shorten that serial dependency path.

## Upstream and algorithm evidence

Sources were rechecked on 2026-07-29, including the May 2026 NetHack 5.0
release:

- NetHack 5.0 recalculates vision after every successful hero move with
  [`vision_recalc(1)`](https://github.com/NetHack/NetHack/blob/NetHack-5.0/src/hack.c#L2803-L2812).
  Its own documentation says the adjacent-move optimization is presently
  unimplemented and is treated as a full recalculation
  ([`vision.c`](https://github.com/NetHack/NetHack/blob/NetHack-5.0/src/vision.c#L435-L466)).
- Upstream builds into an unused visibility buffer, swaps it into place,
  compares old and new visibility, and calls `newsym` only for changed positions
  ([`vision.c`](https://github.com/NetHack/NetHack/blob/NetHack-5.0/src/vision.c#L654-L781)).
  Its display buffer then flushes only entries marked new
  ([`display.c`](https://github.com/NetHack/NetHack/blob/NetHack-5.0/src/display.c#L2151-L2168)).
- Debenham and Solis-Oba, _New Algorithms for Computing Field of Vision over 2D
  Grids_
  ([DOI 10.5121/csit.2020.101801](https://doi.org/10.5121/csit.2020.101801),
  [arXiv:2101.11002](https://arxiv.org/abs/2101.11002)), found that their
  spatial and incremental FOV algorithms win mainly on medium/large grids, while
  recursive shadowcasting remains a strong choice for low-resolution enclosed
  maps. They explicitly report that there is no universal best FOV algorithm.
- Ibrahim et al., ICRA 2024, _An Efficient Solution to the 2D Visibility Problem
  in Cartesian Grid Maps_
  ([DOI 10.1109/ICRA57147.2024.10611529](https://doi.org/10.1109/ICRA57147.2024.10611529),
  [arXiv:2403.06494](https://arxiv.org/abs/2403.06494)), presents an O(N)
  single-pass PDE/upwind visibility approximation aimed at large occupancy
  grids. It scans the whole grid and converges to exact visibility with grid
  refinement, so it is not an exact integer replacement for this 78×21 guest.

The selected design follows NetHack's state transition—recalculate after every
move, double-buffer visibility, and redraw only differences—while using bounded
integer shadowcasting suited to this much smaller machine.

## Implemented boundary

### Exact, bounded FOV

- Every successful movement runs an eight-octant, radius-15 shadowcast. Rational
  slope comparisons use integer cross-products; the inner scan performs no
  floating-point work or division.
- A level-generation pass precomputes static room/stair lighting and adjacent
  lit walls. Dark corridors are visible only beside the hero, matching the
  reduced game's lighting contract without rescanning room identity on every
  move.
- Two fixed visibility lists and generation stamps deduplicate the new FOV and
  compare only the prior visible set. Visibility and exploration changes call
  the existing dirty-cell owner.
- The shadow wedges use a fixed 512-entry task store. One radius-15 octant has
  at most 135 candidate cell visits; the bound also covers split-boundary
  duplicates. No recursion, allocation, user-sized queue, or unbounded retry was
  introduced.

Level generation remains O(N). A movement is O(r² + V_old + D), where r=15,
V_old is the previous visible set, and D is the unique changed-display set. With
fixed r and the 78×21 map, movement work is bounded independently of
explored-map size. The executable data segment grows from 158,788 to 200,788
bytes (+42,000 bytes) for the fixed buffers.

### Differential presentation with explicit retry ownership

- The dirty list now covers all 1,638 cells and still deduplicates through the
  dirty bitset, so a legitimate visibility delta cannot silently turn into a
  full raster merely because it exceeds 256 cells.
- Map cells, message cells, player movement, and status changes all feed the
  same dirty owner. Initial frames, help, level changes, and explicit redraws
  retain the full-frame path.
- Dirty/full/message state is cleared only after `cs_term_present` succeeds. On
  `EAGAIN` or another failed presentation, the unchanged frame and exact dirty
  ownership remain pending for the next attempt; failure no longer forces an
  expensive reraster.

Independent Computers remain the parallel unit. Four sessions can advance in one
scheduler without a shared FOV lock or presentation retry storm; adding workers
inside one 78×21 FOV would only add coordination to its serial key → FOV →
render → present span.

## Measurements

Host measurement on 2026-07-29 used one CS486DX standard Computer, the real
`ComputerWorkMonitor`, and accumulated the real `CpuProcessSliceResult` from
modeled scheduler ticks. The deterministic save uses seed 12,345, starts at
(50,14), moves within the room to (51,14), returns to the boundary, then enters
the corridor at (49,14).

| Path                       | Guest instructions | Modeled cycles | Ticks | CPU admissions | Presents | Terminal deferrals |
| -------------------------- | -----------------: | -------------: | ----: | -------------: | -------: | -----------------: |
| Same-room move             |            385,307 |        768,761 |     1 |              3 |        1 |                  0 |
| Move back to room boundary |            394,977 |        794,435 |     1 |              3 |        1 |                  0 |
| Room → corridor transition |            400,708 |        810,462 |     1 |              3 |        1 |                  0 |
| Issue #113 full repaint    |            599,742 |      1,187,623 |     — |              — |        — |                  — |

The corridor transition removes **33.2%** of the old full-repaint instructions
and **31.8%** of its modeled cycles. It is 4.0% above the adjacent same-room
move in instructions and 5.4% in cycles, without a modeled-tick latency cliff.

Four deterministic Computers entering the corridor together all reach (49,14)
within the four-tick test bound. Each publishes exactly one frame; the shared
monitor reports zero `guest_cpu` and zero `terminal` deferrals.

## Rejected alternatives

- The first continuation-frame shadowcast prototype stored and resumed too much
  state in guest memory. It measured about 1.41 million instructions and 3.47
  million cycles for the transition. Row-local octant scanning with compact
  wedge tasks removed that interpreter and memory-locality bottleneck.
- The Debenham/Solis-Oba incremental FOV structure was not selected. Its
  advantage appears on substantially larger grids; here its indices, update
  bookkeeping, and extra state would serve a fixed 78×21 enclosed map where
  bounded shadowcasting is simpler and measured faster.
- The ICRA 2024 PDE method was not selected because it scans all N cells, uses a
  numerical approximation, and adds arithmetic that is expensive on CS486. The
  game needs deterministic cell-exact occlusion.
- A sparse host-terminal ABI was not added. Measurement still shows one admitted
  present and no terminal deferral, so widening the stable CS ABI would attack a
  non-bottleneck. The guest now minimizes FOV and raster work while preserving
  the existing complete-frame presentation contract.

## Verification evidence

Verify on 2026-07-29:
`npm test -- --run tests/computer/nethackRuntime.test.ts -t "corridor boundary"`.

Expect: unobstructed lit room cells are visible, dark corridor cells beyond the
adjacent segment remain hidden, an L-turn blocks the room behind it, the move
finishes in at most three modeled ticks, publishes one frame, has no terminal
deferral, stays at least 30% below the Issue #113 full-repaint work, and remains
within 10% of the adjacent same-room move.

Result: PASS. 400,708 instructions, 810,462 cycles, one modeled tick, one
presentation, zero terminal deferrals.

Verify on 2026-07-29:
`npm test -- --run tests/computer/nethackRuntime.test.ts -t "four corridor"`.

Expect: all four Computers reach the deterministic corridor cell, each emits one
frame, and neither the `guest_cpu` nor `terminal` lane defers work.

Result: PASS.

Verify on 2026-07-29: `npm run generate:guest-nethack` followed by
`npm run check:guest-nethack`.

Expect: the checked-in compiler-built executable is byte-current with the
authored guest sources.

Result: PASS. The generated executable is 5,149,841 bytes.

Verify on 2026-07-29:
`npm test -- --run tests/computer/nethackRuntime.test.ts tests/computer/interactiveFrameLatency.test.ts`.

Expect: NetHack lifecycle/save/render/FOV behavior and the repository's
interactive latency contracts all pass.

Result: PASS, 14 tests.

Verify on 2026-07-29: `npm run validate` with Node.js 24, covering formatting,
ESLint, TypeScript, all Vitest suites, the production Bedrock pack, and the
16-chapter Pages build.

Expect: the complete repository gate exits successfully and leaves no test
runner resident.

Result: PASS, 312 test files and 2,641 tests. The pack and Pages builds also
passed, and the post-run process check found no repository Vitest/Node runner.

Verify on 2026-07-29: start a fresh isolated `ComputerSystemAcceptance` world
through the BDS MCP with `resetWorld` and `acceptanceFixture`, provision its one
advanced CS486 Computer, open its Web Terminal through MCP, launch `nethack`,
and drive only MCP `bds_send_tui_input` movement calls until a pre-move `#` cell
is entered. Verify the resulting frame with `bds_verify_tui_screen` at 80×25
with colors and `@`, `Dlvl:`, and `HP:` present; then request diagnostic logs
and stop BDS.

Expect: the player coordinate changes onto the rendered corridor cell, every
input obtains a later coherent frame, TUI verification succeeds, diagnostics are
empty, and `bds_stop` returns the session to `idle`.

Result: PASS. The player moved right from (14,8) to the pre-move `#` at (15,8)
in snapshot 53; TUI verification returned true, diagnostic count was zero, and
BDS stopped in `idle`. The fixture used a new external work root and did not
reset or authenticate into the preserved operator world.

Verify on 2026-07-29: inspect the Web Terminal tab opened by
`bds_open_web_terminal` in the existing Chrome session without sending browser
input.

Expect: Chrome renders the same NetHack map and status as an 80×25 terminal,
including the hero beside the visible corridor, and exposes the final stopped
connection state without a native-terminal fallback.

Result: PASS. Chrome rendered the room, `##` corridor segment, hero, distant
rooms, and `Dlvl:1 HP:22(23) Lv:2 XP:8 T:19`; after MCP-owned shutdown it
reported `OFFLINE`, `80 × 25`, and `BDS_STOPPED`.

## Residual boundary

The previous 85,589-instruction ordinary-move p95 from Issue #113 came from the
room-ID/local-Manhattan approximation. Correct upstream-like FOV on every move
now costs 385,307 instructions for this fixture. That is a deliberate fidelity
trade rather than a claimed universal speedup: the reported win removes the
room-to-corridor full-repaint cliff. A future incremental algorithm should be
considered only if a larger map/profile makes this fixed bounded scan the newly
measured bottleneck.
