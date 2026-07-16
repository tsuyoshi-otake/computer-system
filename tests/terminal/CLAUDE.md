# Terminal application test guidance

- Prove every terminal-session path publishes at most one close event with an
  observable final result. Input after close has no side effects.
- Target registry tests reject unknown, stale, replaced, and ambiguous Computer
  targets without redirecting input.
- Snapshot scheduler tests prove fixed-batch O(K) fairness, bounded queues,
  deduplication, and the eager writer path without a whole-session scan.
- Writer takeover atomically demotes the old writer to viewer. Writer
  replacement alone does not close the guest; viewer input is rejected; only
  final detach requests `terminal_closed`.
- Viewport tests preserve guest geometry and validate crop/size limits.
  Transport tokens/session storage belong to `tests/tools`, not this authority
  model.

## Focused verification

Run `npm test -- tests/terminal`. For live Web authority changes also run
`npm run test:web` and verify takeover/final detach in a real browser.
