# Live Web Terminal guidance

## Child scopes

| Child scope                   | Responsibility                           |
| ----------------------------- | ---------------------------------------- |
| [`assets/`](assets/CLAUDE.md) | Authored plates and manual illustrations |

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
  scaling subtracts stage padding, selects a whole-pixel cell size, and
  letterboxes both axes without mutating cell geometry or adding stage
  scrollbars.
- Render the authoritative cell cursor as an O(1) overlay: block cursors invert
  the current glyph, underline cursors draw a bar, and CSS-only stepped blink
  honors reduced-motion preferences without invalidating cached rows.
- Overlay semantic input at the terminal cursor so physical typing appears at
  the prompt. Physical Enter submits `terminal_line`.
- Ctrl+C copies selected terminal/command text; with no selection it interrupts
  advertised foreground work or aborts the current line without shutting down an
  idle Computer. Plain-text paste is bounded and never auto-submits. Up/Down
  navigate local history only when the interaction descriptor enables it; Linux
  enables it normally and DOS enables it after bare `DOSKEY`. DOS F3 recalls the
  most recently submitted local line without enabling history.
- Copy acts only on demand and copies the active selection or visible cell grid;
  it must not poll the terminal. Viewers may select/copy but cannot submit
  input.
- Present the `safe_boot` action only from authoritative crashed-machine state;
  the client does not decide eligibility or turn it into a guest command.
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

## Verification

Run `npm run test:web`, `npm run test:pages`, and relevant editor/terminal
tests. Use a real browser to verify connected state, inline typing, physical
Enter, selection/Ctrl+C, bounded paste, takeover, masked input, 80x25 fit,
resize, and disconnect. Desktop and narrow mobile layouts must have no
horizontal overflow.
