# Editor test guidance

- Cover every DOS `EDIT`, vi, nano, and syntax-highlighting state: menu, mode,
  cursor, command line, search, undo, save, discard, cancel, exit, resize,
  terminal close, credential loss, and failure.
- A failed save preserves dirty state, prior filename/metadata, undo history,
  and original filesystem bytes; it never partially renames or reports success.
- Interactive dirty exit owns Save/Discard/Cancel. Forced terminal/shutdown /
  disconnect finalization does not silently save and releases captured
  credentials.
- Enforce document, line, undo, search, key-batch, paste, and viewport ceilings.
  Highlighting scans only visible rows/columns; user search cannot trigger an
  unbounded regular expression.
- Assert DOS-only `EDIT`, `UNTITLED`/`C:\NONAME.TXT`, Linux rejection, bare vi
  `[No Name]`, first `:w path`, newline/path profile, and complete cell
  backgrounds.

## Focused verification

Run `npm test -- tests/editor`. Visible/editor-input changes also require
`npm run test:web` and a real-browser exercise.
