# Issue #25: Complete the CS-DOS 1.0 development environment

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/25>

Status: implementation and complete host verification are complete; final live
Chrome interaction evidence is pending at the time of this record.

Dependencies: #12 (guest OS/toolchain), #13 (C/C++ frontend), #15 (EDIT), #18
(assembler/object ABI), and #19 (C/C++ hardening).

## Implemented boundary

- EDIT, CS QBASIC, and the ASM/C/C++ WorkBench share explicit dirty-buffer,
  open/save, overwrite/external-change, and close terminal states.
- Open and Save As use a bounded guest-only A:/C: DOS 8.3 browser with filters,
  scrolling, keyboard/primary-mouse input, media-generation revalidation, and
  explicit empty/error states.
- `CS PROGRAM LIST 1.0` supports mixed ASM/C/C++ sources, authored objects,
  includes/defines, deterministic per-unit fingerprints, transactional outputs,
  listing/map files, exact last-artifact ownership, and ownership-scoped Clean.
- The C-family tokenizer is preceded by a bounded practical preprocessor with
  guest-credentialed includes, macro rescanning, conditionals, provenance, and
  Linux/DOS option parity.
- The C++/ASM boundary remains one limited unmangled zero-argument CS object
  ABI. Individual `extern "C"` declarations are accepted; C++ linkage blocks and
  unsupported C++/MASM/OMF/near/far behavior fail explicitly.
- CS QBASIC executes saved source transiently and never installs OBJ/CSX/EXE
  artifacts. ASM/C/C++ debugging starts in WorkBench; DOS `DEBUG` is optional.
- F4 output is scrollable and F3/Shift+F3 navigate bounded DOS compiler
  file/line/column locations.
- EDIT and each WorkBench use the five-heading DOS layout, centered document
  title, blue document surface, gray menu/dialog/scroll chrome, cyan status
  line, black selection/shadow state, and a licensed IBM VGA 8x16 Web font.
  Plain EDIT leaves one cell before File and F1 Help, continues the title corner
  down the document's left edge, uses arrow rather than triangle scrollbar ends,
  shows the canonical six-entry File menu without inline shortcuts, and keeps
  only the zero-padded line/column at the right.
- At 80x25, EDIT Open starts with selected `*.TXT` and bounded Files plus
  Dirs/Drives panes; Display presents the fixed White-on-Blue palette, Scroll
  Bars, and the eight-column plain-EDIT tab default. The 51x19 compact dialogs
  remain the fallback. Normal `DIR` renders split 8.3 base/extension columns,
  aligned `<DIR>` or comma-grouped size, and DOS 12-hour timestamps without
  changing `/B`, `/W`, or Linux `ls`.
- The Web input bridge preserves Alt, Ctrl, Shift, F1-F12, navigation, and
  compound IDE accelerators. In editor mode its transparent keyboard textarea
  cannot intercept menu/document pointer events; Welcome-to-menu clicks remain
  one action.

Excluded: native DOS COM/EXE or OMF ingestion, MASM compatibility, ISO C++,
source-level debugging, user keyboard/mouse/framebuffer/sound APIs, DOOM-class
graphics, and CS Windows 1.0. Those remain future ABI/product work.

## Acceptance evidence

### C1 - EDIT safety and file browsing

Verify: `npm exec vitest run tests/editor/dosEditSession.test.ts`

Expect: dirty transitions, CRLF, binary rejection, overwrite/reopen decisions,
capacity-plus-one atomicity, keyboard/mouse browsing, stale media, and the
257-entry rejection all pass without losing the active buffer. The 80x25 File,
Open, and Display screens also retain their exact ordered labels, leading cells,
arrow ends, selected fields, pane bounds, fixed palette selections, and buttons.

### C2 - Program Lists and exact artifacts

Verify:
`npm exec vitest run tests/runtime/csDosProgramList.test.ts tests/editor/qbasicSession.test.ts tests/os/systemBoot.test.ts`

Expect: mixed builds, reuse, header invalidation, rollback, stale Run Last,
Rebuild, ownership-scoped Clean, canonical collisions, and deferred CS386SX
execution pass.

### C3 - Practical C/C++ preprocessor

Verify:
`npm exec vitest run tests/runtime/cs486CPreprocessor.test.ts tests/os/cFamilyProfiles.test.ts`

Expect: include/macro/conditional features, provenance, Linux/DOS switches,
guest-only reads, direct/deferred parity, and all documented bounds pass.

### C4 - Truthful C++/ASM ABI

Verify:
`npm exec vitest run tests/os/cFamilyProfiles.test.ts tests/os/assemblerProfiles.test.ts`

Expect: individual `extern "C"` maps to the unmangled typed CS symbol; mixed
objects link under the zero-argument EAX/void contract; unsupported linkages and
native/MASM constructs fail explicitly.

### C5 - QBASIC source-run behavior

Verify:
`npm exec vitest run tests/editor/qbasicSession.test.ts tests/os/systemBoot.test.ts`

Expect: F5-family and `/RUN` return output to the IDE, expose no Make/Debug
menu, and leave no OBJ or CSX.

### C6 - Help and manual agreement

Verify: `npm run test:web && npm run test:pages`

Expect: command help, README, canonical 16-chapter manual, field verification,
and release notes agree on product names, behavior, and exclusions.

### C7 - Complete host gate

Verify: `npm run validate`

Expect: formatting, lint, TypeScript, all Vitest tests, Bedrock pack production
build, and the 16-chapter Pages build pass under Node.js 24 or later.

Observed 2026-07-18: 149 test files and 996 tests passed, followed by the
production behavior/resource-pack build and the 16-chapter Pages build.

### C8 - Real runtime and browser

Verify: `npm run test:mcp:bds`, then exercise EDIT, QBASIC, and PWB through the
live Web Terminal in Chrome at 80x25.

Expect: real CS386SX execution, guest files, keyboard/mouse dialog ownership,
Program List build/run/output/error navigation, source-run QBASIC, selection,
resize, disconnect, and reconnect behavior match the host contract without a
native GDK terminal fallback.

Host-to-browser preparation observed 2026-07-18: the production build passed and
the managed BDS/Web companion restarted on the preserved world. Final manual
handoff activation and the real-Chrome interaction sequence remain to be
recorded.

### C9 - MS-DOS 6.22 layout and playerless logical screen

Verify:
`npm exec vitest run tests/editor/dosEditSession.test.ts tests/os/dosProfile.test.ts`,
then use only the Computer System MCP server to preserve-start BDS, activate the
exact Computer with zero players, open EDIT File/Open/Display, exit, run `DIR`,
and capture each non-secret screen through the exact debug writer.

Expect: the File menu has New/Open/Save/Save As, two separators, Print, and Exit
without inline shortcuts; the left margin, line/column field, `↑`/`↓`/`←`/`→`
scroll ends, `*.TXT` field, Files plus Dirs/Drives panes, Display palette lists,
and DIR fixed columns match the host tests. Every frame remains an 80x25
`surface.kind: "text"` bound to the same debug-owned writer, with no Player,
right-click, exposed handoff secret, or separate browser automation. This proves
logical cells and palette only, not final VGA glyph/CSS pixels.

Observed 2026-07-18: pass. With the preserved world and zero connected players,
MCP retained the exact debug-owned writer across 80x25 color/cursor snapshots,
verified the continuous left document border, leading menu/footer cells, four
arrow directions, canonical File menu, Open and Display dialogs, and
fixed-column `DIR`, then reported zero diagnostics. Web remained on TCP 80 and
BDS on UDP 19142/19143; no right-click or separate browser automation was used.
