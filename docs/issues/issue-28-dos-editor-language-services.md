# Issue #28: DOS editor language services and guest commands

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/28>

Status on 2026-07-18: implemented and host-verified; real Web Terminal browser
verification remains required before closing the Issue.

## Implemented boundary

- DOS `EDIT`, CS QBASIC, PWB/CS C/C++, and CSASM share bounded display, editing,
  completion, and language option pages.
- `C:\EDITOR.INI` supports `[common]`, `[edit]`, `[qbasic]`, `[pwb]`, and
  `[csasm]` sections, with atomic parsing at 4,096 characters and 64 lines.
- Lightweight BASIC, C, C++, ASM, Python, and text lexing/indexing powers
  Ctrl+Space completion, Ctrl+Shift+O symbols, F12 definition navigation, and
  Alt+Left jump history without an LSP or host process.
- Completion priority is current buffer, up to eight saved recent buffers,
  indexed symbols, language keywords, then opted-in direct includes. Results,
  index work, include bytes, and jump history are bounded.
- EDIT exposes guest commands from File; the IDE profiles expose them from Run.
  DOS Command, Repeat, and Insert Output use only the guest shell, reject nested
  TUI/background/session-control work, and restore parent guest shell/editor
  ownership before returning.

Excluded: recursive project scanning, an LSP, semantic type analysis, native DOS
executables, host-shell execution, and Python execution on CS-DOS.

## Acceptance evidence

1. Configuration and product defaults

   Verify: `npm test -- tests/editor`

   Expect: valid common/profile overrides resolve per product; malformed,
   65-line, and 4,097-character input fails atomically; saving one product keeps
   other authored sections and stays within the configured limits.

2. Highlighting, completion, symbols, and navigation

   Verify: `npm test -- tests/editor`

   Expect: BASIC/C/C++/ASM/Python/Text tokenization remains bounded; BASIC
   symbol matching is case-insensitive; candidate priority includes saved recent
   buffers and opted-in direct includes; external F12 returns the exact guest
   path and Alt+Left restores the prior location.

3. Guest command isolation and finalization

   Verify: `npm test -- tests/editor`

   Expect: DOS commands run inside the guest shell; inserted stdout is one
   undoable bounded edit; nested editor/TUI work is rejected; current directory,
   environment, aliases, functions, umask, exit status, and editor ownership are
   restored on every terminal branch.

4. Host integration gate

   Verify: `npm run validate`

   Expect: formatting, ESLint, TypeScript, Vitest, Bedrock pack build, and the
   16-chapter Pages build all pass. Record any unrelated dirty-worktree failure
   separately rather than treating it as Issue #28 evidence.

5. Real Web Terminal acceptance

   Verify: follow the Issue #28 blocks in `docs/manual-verification.md` in a
   writer-owned 80x25 CS-DOS Web Terminal, including narrow-window resizing.

   Expect: options, popup selection, definitions/back navigation, command
   output, keyboard and pointer ownership, DOS colors, and close/error paths are
   visible without overflow or host-state leakage. This criterion is pending.

## 2026-07-18 verification record

- `npm run validate`: passed; 149 test files and 966 tests passed, followed by
  the Bedrock pack build and 16-chapter Pages build.
- `npm test -- tests/editor`: passed; 9 files and 78 tests.
- `npm run test:web`: passed; 3 files and 49 tests.
- `npm run test:pages`: passed; 3 files and 25 tests.
- Chrome opened the generated chapter 02 manual from a loopback-only static
  server. The DOS editor callout was present, ordinary and 375 px widths had no
  page-level horizontal overflow, the narrow callout was 341 px wide, and the
  console contained no warning or error. The temporary server was stopped.
- A connected writer-owned CS-DOS Web Terminal was not available during this
  run, so actual EDIT/QBASIC/PWB/CSASM pointer and keyboard acceptance remains
  open and is not claimed by the static manual browser check.
