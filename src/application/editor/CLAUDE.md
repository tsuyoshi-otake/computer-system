# Guest editor guidance

## Profile boundary

- `EDIT` is CS-DOS-only. CS-Linux rejects it and uses `vi`/`nano` behavior.
- Bare DOS `EDIT` opens an `UNTITLED` buffer backed by `C:\NONAME.TXT`. Bare
  `vi` opens `[No Name]`; `:w path` assigns the first filename.
- Use the selected OS path, newline, case, filename, and error rules. Editor
  save and rename operations pass through the credentialed guest filesystem and
  the active DOS transaction boundary where applicable.

## Bounded state machines

- DOS `EDIT`, `vi`, and `nano` consume writer-owned bounded `terminal_keys`
  batches and render only their fixed viewport. They do not own transport input.
- Every menu, mode, command line, search, replace, undo, save, discard, cancel,
  exit, failure, terminal close, and resize branch returns an explicit editor
  state. Dirty exit requires Save/Discard/Cancel ownership.
- Bound document size, line count/width, cursor movement, undo history, search
  query/results, replacement work, clipboard/paste, key batch, menu state, and
  redraw work.
- Syntax and indentation highlighting scans no more than visible rows and
  columns per redraw. User search text must not create an unbounded regex path.
- Preserve insert/overwrite state and deterministic cursor/selection behavior.
  DOS `EDIT` includes its five menus, bounded undo/search, Ctrl+Y line deletion,
  and save feedback; do not replace these with host editor behavior.

## Finalization

- Save commits bytes and metadata only after validation succeeds. A failed save
  keeps the buffer dirty and reports the error; it does not partially rename or
  clear undo state.
- Interactive exit owns the dirty Save/Discard/Cancel decision. Terminal close,
  shutdown, disconnect, credential loss, and final writer detach do not silently
  save; they explicitly discard/cancel the editor and release captured
  credentials through the outer runtime's finalization path.

## Verification

Use `tests/editor/` for mode transitions, viewport edges, empty-name behavior,
search/undo limits, profile rejection, save failure, dirty exit choices, resize,
terminal close, and credential/transaction propagation. Verify visible changes
through the live Web Terminal in a real browser.
