# Live Web Terminal guidance

## Security boundary

`web/` is the authenticated live terminal client served by the local companion.
It is not the public Pages site.

- Treat bearer tokens, one-use paths, writer authority, session lifetime, and
  Computer-number exchange as security boundaries. Never log or place bearer
  tokens in a bookmark/query, repository file, manual link, or BDS command.
- Persistent browser state and bookmarks may remember only the stable four-digit
  Computer number. A bookmark at `/?computer=NNNN` reconnects through the
  bounded exchange and rotates the bearer token. Remove a received token from
  the URL fragment immediately and retain it only in active-tab
  `sessionStorage`, never in a query, bookmark, history entry, or persistent
  storage.
- Enforce writer/viewer/out-of-range/closed state in the UI, but treat server
  and application decisions as authoritative. Hiding controls is not
  authorization.
- Dedupe retry work, use bounded exponential backoff with jitter, respect the
  30-minute session lifetime, and finalize disconnect/expiry/close explicitly.
- Keep access logging transition-only. Do not create per-frame, per-cell,
  polling, token, or password log paths.

## Terminal interaction

- Render the fixed-cell terminal snapshot without creating parallel cursor,
  screen, editor, or process truth. Normalize a writer to 80x25 once; CSS
  scaling subtracts stage padding and fits both axes without mutating cell
  geometry or adding stage scrollbars.
- Overlay semantic input at the terminal cursor so physical typing appears at
  the prompt. Physical Enter submits `terminal_line`.
- Ctrl+C copies selected terminal/command text; with no selection it invokes the
  bounded interrupt. Plain-text paste is bounded and never auto-submits. Up/Down
  navigate local command history.
- Copy acts only on demand and copies the active selection or visible cell grid;
  it must not poll the terminal. Viewers may select/copy but cannot submit
  input.
- Preserve full cell-height color spans for full-screen editor backgrounds. Test
  DOS `EDIT`, `vi`, prompt input, masked secrets, resize, disconnect, and
  takeover through the same rendered snapshot path.

## Canonical field manual

- `manual.js` is the only authored source for the 16-chapter manual used by both
  the live dialog and static Pages. Never fork chapter prose into `site/`, docs,
  or generated HTML.
- Canonical order is: orientation/machine choice; terminal/Web/editors;
  filesystem/storage/persistence; CS-Linux; Python; Redstone/peripherals/events;
  worked project; Python API; architecture/execution; assembly; BASIC; C/C++;
  optimization; CS-DOS; diagnostics/recovery;
  limits/compatibility/glossary/index.
- Keep stable chapter/section IDs, generated numbering, header agreement,
  Previous/Next, the 24-result search bound, and all goal paths synchronized.
  Goal paths cover first program, Python+Redstone, CS-Linux, native development,
  Portable CS-DOS, and diagnostics.
- User-visible behavior, limits, error messages, hardware profiles, commands,
  and recovery steps must update the relevant chapter in the same change.

## Authored assets

- Machine plates live in `assets/machines/`; CPU identification plates live in
  `assets/cpu/`. Manual Chapter 2 serves both directly.
- Keep intrinsic image dimensions and useful alt text. Do not replace authored
  plates with generated block-face textures or generated Pages output.
- Asset-generation and pack-version rules live in `tools/CLAUDE.md` and
  `packs/CLAUDE.md`.

## Verification

Run `npm run test:web`, `npm run test:pages`, and relevant editor/terminal
tests. Use a real browser to verify connected state, inline typing, physical
Enter, selection/Ctrl+C, bounded paste, takeover, masked input, 80x25 fit,
resize, and disconnect. Desktop and narrow mobile layouts must have no
horizontal overflow.
