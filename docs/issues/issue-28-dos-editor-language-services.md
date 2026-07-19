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

## 2026-07-18 Options correction verification

A writer-owned 80x25 CS-DOS Web Terminal exposed two gaps in the released
Options state machine: Editing, Completion, and Language had no reachable apply
transition because Escape restored the opening snapshot, and the Editing page
did not expose syntax, line-number, rainbow-indent, whitespace-marker, or wrap
controls. The host tests had covered only the Display OK path.

- The shared Editing page now exposes all nine bounded display/editing fields.
- Editing, Completion, and Language each have explicit keyboard- and
  pointer-reachable OK and Cancel terminal actions. OK retains the draft; Cancel
  and Escape restore the complete opening snapshot.
- The classic 80x25 Display dialog and the compact 51x19 Display fallback keep
  their existing single OK/Cancel path without duplicated commands.
- The same shared transition is exercised through EDIT, CS QBASIC, PWB/CS C/C++,
  and CSASM, and Save Settings persists only the active profile while preserving
  the others.

`Verify:` Run `npm test -- tests/editor`.

`Expect:` 10 files and 100 tests pass, including 51x19 and 80x25 layout,
keyboard and pointer OK/Cancel, complete apply/cancel rollback, all four product
profiles, `C:\EDITOR.INI` save/reopen, Reload Settings, and session-scoped
Restore Defaults.

`Result:` passed with 10 files and 100 tests.

`Verify:` Run `npm run test:web`.

`Expect:` 7 files and 92 tests pass with no Web Terminal transport or
presentation regression.

`Result:` passed before unrelated concurrent Web presentation changes entered
the working tree.

`Verify:` Run `npm run validate`.

`Expect:` formatting, ESLint, TypeScript, 156 Vitest files and 1,044 tests, the
production Bedrock pack build, and the 16-chapter Pages build pass.

`Result:` a pre-final run passed all 156 files and 1,044 tests. The final rerun
stopped on unrelated concurrent `web/app.js` formatting and
`web/terminal-presentation.js` default-value test mismatches. ESLint,
TypeScript, the issue-owned editor suite, the production Bedrock pack build, and
the Pages build passed after the final Options changes. A clean full-gate result
is therefore not claimed yet.

The updated-pack real-BDS/Chrome rerun remains pending. The running interactive
world was not force-stopped, so no post-fix live result is claimed yet.
