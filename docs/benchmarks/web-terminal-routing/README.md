# Web Terminal routing benchmark

This directory owns the immutable Phase 0 evidence for Issue #30. The benchmark
characterizes the production pre-change route; it does not select or implement a
replacement protocol.

## Captured baseline

- Artifact: `2026-07-18-current-route.json`
- Baseline commit: `9a06d2d7cc7523b8b4300dedf741413307e91e11`
- Surface: 80 columns by 25 rows with text and 16-color foreground/background
  grids
- Sessions: 1, 5, and 32
- Scenarios: unchanged surface, one changed cell, one changed row, full-screen
  change, audio-only delivery, mixed range, out-of-range resume, a blocked
  NDJSON consumer, and terminal replacement/resize/power-cycle boundaries

The harness calls the production `WebSessionStore` and production coalesced
NDJSON writer. It mirrors the current bridge's computer-scoped snapshot cache
and session-scoped full-envelope serialization. Counters distinguish shared
snapshot construction from per-session serialization, BDS marker bytes, bytes
actually accepted by the companion writer, access transitions, audio, and MCP
`terminalVersion` advances.

The deterministic host model is not a capacity or latency claim. BDS tick
percentiles, emergency deferrals, Chrome Enter-to-visible latency, and Chrome
main-thread render time remain explicitly absent because this capture had
neither configured `bds_*` tools nor a writer-owned Web Terminal tab. The
delivery-model decision is therefore deferred until those live measurements are
recorded.

## Deterministic findings

| Sessions | Full-screen BDS marker bytes | Companion NDJSON bytes | Full-surface traversals | Periodic max wait (ticks) | Eager max wait (ticks) |
| -------: | ---------------------------: | ---------------------: | ----------------------: | ------------------------: | ---------------------: |
|        1 |                       12,679 |                 25,652 |                       1 |                         5 |                      1 |
|        5 |                       63,395 |                128,260 |                       5 |                        15 |                      2 |
|       32 |                      405,728 |                820,864 |                      32 |                        80 |                      8 |

One shared snapshot is built for each changed computer frame, but the current
route still performs one full-surface envelope serialization per eligible
session. Both marker bytes and companion NDJSON bytes therefore scale exactly
with session count in this fixture. The NDJSON event contains the terminal both
as the event payload and in its public-session representation, which explains
why its bytes are approximately twice the BDS terminal-envelope bytes.

With 32 sessions, 100 changed frames, and one blocked consumer, the bridge still
performs 3,200 full-surface serializations and MCP version advances. The
production writer coalesces 98 superseded terminal events for the one blocked
consumer, so 3,102 terminal events and 3,102 audio events are actually written.

## Reproduce

Use Node.js 24 or later from the repository root:

```powershell
node tools/benchmark-web-terminal-routing.mjs --commit 9a06d2d7cc7523b8b4300dedf741413307e91e11 --captured-at 2026-07-18T09:09:41.234Z --baseline-worktree clean --output docs/benchmarks/web-terminal-routing/reproduction.json
```

The output path must be a new `.json` file in this directory. Existing artifacts
cannot be overwritten. Compare a reproduction with the dated artifact after
accounting for its capture timestamp and environment fields, then remove the
reproduction before committing.

## Acceptance evidence

- Verify: `npm test -- tests/tools/webTerminalRoutingBenchmark.test.mjs` Expect:
  all routing scenarios and the committed artifact's deterministic counters
  match.
- Verify: `npm run test:web` Expect: the existing Web Terminal application and
  companion behavior remain green.
- Verify: `npm run validate` Expect: formatting, lint, TypeScript, all tests,
  pack build, and the 16-chapter Pages build pass.

Do not edit a dated JSON artifact after capture. Record corrections or new live
evidence in a new dated artifact.
