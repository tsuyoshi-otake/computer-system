# Terminal domain guidance

## Fixed-cell buffer

- `TerminalBuffer` is the authoritative text screen. Web, Resource Pack,
  application presentation, and editors render or mutate it through explicit
  operations; they never maintain a competing screen/cursor truth.
- Geometry, cell count, cursor, color, scrolling, clear, writes, and snapshots
  are deterministic. Defaults are 51x19; default injected size limits are
  200x100, but callers may supply different validated limits. Coordinates are
  1-based and colors are 0..15.
- `write` accepts cell text without CR/LF, has no internal input-length cap, and
  does not wrap; callers must bound it. Cells are JavaScript Unicode code
  points, not a UTF-8 byte policy.
- Snapshot schema 1 preserves exact dimensions, cell attributes, and cursor, but
  deliberately excludes revision and current write colors. A presentation
  resize/crop must not change guest geometry.

## Session protocol

- Domain `TerminalSession` owns line submission, termination requests, close,
  and failure. Interrupts, key batches, and resize are application/transport
  protocols, not domain events.
- Finalization is idempotent. `ClientClosed` maps to `cancelled`, `UserBusy` to
  `competing_form`, and `ServerClosed` to `terminated` only after a termination
  request, otherwise `server_closed`; failure with an invalid player maps to
  `disconnected`, while failure with a valid player maps to `failed`. Input
  after close is rejected without side effects.

## Verification

Use `tests/domains/terminal.test.ts` for buffer behavior,
`tests/phase0/terminalSession.test.ts` for direct domain mappings, and
`tests/terminal/session.test.ts` for application finalization. Cover injected
geometry limits, caller write bounds, scroll edges, attributes, CR/LF rejection,
non-wrapping writes, snapshot inclusions/exclusions, Unicode code points, every
close/failure mapping, close exactly once, and input-after-close rejection.
