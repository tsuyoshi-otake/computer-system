# Terminal application guidance

## State ownership

- The fixed-cell domain terminal is authoritative. Presentation, viewport,
  scheduling, target selection, and access objects may cache only bounded
  derived state and must not invent cursor, history, editor, or guest-process
  state.
- `TerminalSession` emits at most one `terminal_closed` event with one explicit
  final result. Success, cancel, fault, detach, shutdown, and disconnect all
  converge on that close state.
- Keep terminal targets keyed by stable Computer identity. Reject unknown,
  replaced, ambiguous, or stale targets explicitly.

## Snapshots and input

- Snapshot scheduling is fixed-batch O(K); do not allocate or scan every
  Computer or session on each pass.
- Writer input uses an amortized-O(1), deduplicated, attempt-bounded eager queue
  so typing latency does not inherit viewer round-robin delay.
- Normalize writer text geometry to 80x25 at most once per attachment. Viewports
  may crop/scale presentation but never mutate the guest cell grid to fit a UI.
- Bound key batches, line input, paste, viewport dimensions, snapshots, retries,
  output, and per-pass delivery. Reject input before side effects when admission
  or authority fails.

## Writer access

- `WebTerminalAccess` owns one writer per Computer while allowing bounded
  viewers. Attaching or taking control atomically demotes the previous writer;
  closing the writer does not silently promote an arbitrary viewer.
- Viewer input is rejected at the application and transport boundaries. Viewer
  selection/copy remains a presentation capability, not guest input.
- A final detach requests guest `terminal_closed`; replacing the writer alone
  must not close the shared Computer terminal.
- Takeover, detach, expiry, machine stop, and transport failure must update
  writer indexes and session records together without a stale authority window.

## Verification

Use `tests/terminal/` for exactly-once close, target lookup, viewport bounds,
snapshot fairness, writer takeover/demotion, viewer rejection, final detach, and
capacity-plus-one behavior. Transport/session-store behavior belongs in
`tests/tools/` and must agree with this authority model.
