# Issue #12: CS QBASIC and DOS editor convergence

Status: in progress  
Tracking: GitHub Issue #12  
Related historical scope: closed Issue #15 (`EDIT`)

## Product boundary

Computer System ships an original, sandboxed **CS QBASIC** implementation for
CS-DOS. It does not redistribute Microsoft `QBASIC.EXE`, `QBASIC.HLP`, fonts,
screens, examples, or other binary/assets. Compatibility means source, command,
editing, and debugging behavior within the documented ledger below; it does not
mean native 16-bit x86, DOS interrupts, or byte-for-byte Microsoft binaries.

CS-Linux no longer exposes `basic` or `basicc`. CS-DOS exposes `QBASIC.EXE`, and
`EDIT.COM` enters the same bounded UI engine in `/EDITOR` mode. The compiler and
runtime remain guest-owned and lower to the validated CS process; neither path
may invoke a host shell, compiler, filesystem, port, memory, or interrupt.

## Researched compatibility baseline

The behavioral baseline is Microsoft QBasic 1.1 as shipped with MS-DOS 6.22.
Primary or preserved reference material consulted for the design:

- Microsoft Knowledge Base Q81360: `/B`, `/EDITOR`, `/G`, `/H`, `/MBF`, `/NOHI`,
  and `/RUN` command-line switches:
  <https://jeffpar.github.io/kbarchive/kb/081/Q81360/>
- Microsoft Knowledge Base Q72740: Welcome dialog, source loading, new-file
  behavior, and `/RUN` startup:
  <https://jeffpar.github.io/kbarchive/kb/072/Q72740/>
- Microsoft Knowledge Base Q73084: interpreter/editor split, Immediate window,
  mouse, help, procedures, and data types:
  <https://jeffpar.github.io/kbarchive/kb/073/Q73084/>
- Microsoft Knowledge Base Q63777: DOS `EDIT` starts `QBASIC /EDITOR`:
  <https://jeffpar.github.io/kbarchive/kb/063/Q63777/>
- Extracted Microsoft QBasic Help topics for menus, run/debug keys, limits,
  graphics modes, statements, and devices:
  <https://dos-help.soulsphere.org/qbasic.hlp/>
- Microsoft Knowledge Base Q73320: GW-BASIC statements absent from QBasic:
  <https://jeffpar.github.io/kbarchive/kb/073/Q73320/>

These pages define behavior; no copyrighted help text or screen artwork is
copied into the product.

## Compatibility ledger

| Area           | CS QBASIC target                                                                                                                                                                                 | Deliberate boundary                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| DOS entry      | `QBASIC [switches] [file]`; bare invocation opens a Welcome dialog; a named missing file opens a new buffer; `/RUN file` starts it                                                               | unknown, duplicate, missing-operand, and incompatible switches fail visibly                                                                        |
| Switches       | `/B`, `/EDITOR`, `/G`, `/H`, `/MBF`, `/NOHI`, `/RUN`                                                                                                                                             | `/HELP` is not invented; display switches map to bounded terminal presentation                                                                     |
| Shared editor  | menu bar, status/key bar, load/save/save-as, search, selection, clipboard, undo, dirty-exit confirmation                                                                                         | `EDIT` selects `/EDITOR` features; it is not an independent editor implementation                                                                  |
| IDE            | Program and Immediate windows, F1 help, F4 output, F5 continue, Shift+F5 restart, F6 next window, F7 run to cursor, F8 step, F9 breakpoint, F10 step over                                        | deterministic state machine; all run, stop, close, save-error, and disconnect branches have one observable terminal state                          |
| Language       | case-insensitive QBasic source; numbered and structured control flow; scalar/array types; strings; procedures/functions; `DATA`/`READ`; console and bounded file I/O; documented graphics subset | unsupported QuickBASIC/GW-BASIC statements fail with source location; no silent approximation                                                      |
| Graphics       | `SCREEN` modes 0, 1, 2, 3, 4, 7-13 with profile-supported geometry/palette; drawing work is tick-sliced and dirty-region bounded                                                                 | the Portable panel remains 800x480 physical presentation, not a guest video mode                                                                   |
| IDE mouse      | menu, dialog, text cursor/selection, scroll controls, and debug controls use writer-owned cell/pixel events                                                                                      | mouse movement is coalesced and bounded; viewer input, stale sequence, out-of-range coordinates, and post-disconnect buttons are rejected/released |
| Program mouse  | optional modeled DOS mouse service exposed through a safe QBasic API/compatibility shim                                                                                                          | QBasic has no native `INTERRUPT`/`INT86`; raw INT 33h and arbitrary `CALL ABSOLUTE` machine code are not claimed                                   |
| Devices        | QBasic file handles and DOS paths are mapped to the guest filesystem                                                                                                                             | `SHELL`, `INP`, `OUT`, `PEEK`, `POKE`, `CALL ABSOLUTE`, `COM1/2`, and `LPT` never reach the host; unsupported access fails explicitly              |
| Numeric limits | documented QBasic ranges and suffixes, 40-character variable names, bounded arrays/procedures/arguments/files                                                                                    | tighter Computer System work budgets may reject before the historical memory ceiling, with an explicit resource-limit diagnostic                   |
| Legal identity | product name is `CS QBASIC`; manual states compatibility target and non-affiliation                                                                                                              | no Microsoft binary, help database, branding, or copied screen assets                                                                              |

### Implementation status (2026-07-16)

The ledger is a compatibility target, not a blanket completion claim.

| Status                        | Implemented boundary                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Implemented, host-verified    | DOS-only command/image boundary; all researched command-line switches and invalid combinations; Welcome/file/new-buffer/`/RUN` entry; one EDIT/QBASIC editor engine; save/search/undo/dirty exit; writer-owned pointer transport; click/drag selection and bounded clipboard; Shift+F5 run; F4 output; bounded numeric/console compiler; numbered/named jumps, integer expressions and structured loops; explicit dangerous-device rejection |
| Deliberately explicit partial | F9 records a visible breakpoint marker only. F5/F7/F8/F10 return a visible not-implemented result and never approximate source debugging by restarting. F1 is bounded keyboard help rather than the original help database.                                                                                                                                                                                                                  |
| Not yet implemented           | Immediate-window execution; procedure navigation; source-level continue/run-to-cursor/step/step-over; string variables/expressions; arrays; `INPUT`; `DATA`/`READ`; floating point; `SUB`/`FUNCTION`; QBasic file handles; graphics/sound; program mouse API; scrollbar/debug-control pointer behavior                                                                                                                                       |
| Verified shipped slice        | Real Chrome delivered one keyboard event and an ordered five-event drag for the writer, then delivered neither after the same session became a viewer. The isolated real-BDS probe passed twice, and `npm run validate` passed 140 test files / 864 tests plus both production builds. These checks do not promote any not-yet-implemented language, debugger, graphics, sound, or program-mouse row.                                        |

No unavailable item above may be described as QBasic-compatible behavior in the
operator manual. Adding one requires a positive conformance case, a negative /
capacity case, and an observable terminal-state test.

## Implementation architecture

```text
Web Terminal pointer/key events
          |
          v
writer-authenticated bounded input queue
          |
          v
QBasicUiSession(mode = program | editor)
  |-- shared text buffer, menus, dialogs, help, mouse hit testing
  |-- program-only Immediate/Output/Run/Debug controllers
  `-- explicit save/close/run terminal-state owner
          |
          v
QBasic parser + resumable runtime -> validated CS process / guest services
          |
          v
guest filesystem, terminal, graphics, and modeled DOS devices only
```

The hot pointer path is O(1): at most one pending move per writer is retained,
button transitions are ordered and bounded, and a tick drains a fixed amount.
Rendering is O(D) in dirty cells/regions rather than O(framebuffer). Parsing,
source lines, symbols, arrays, files, call depth, instructions, output, and
diagnostics all have named ceilings.

## Acceptance rubric

### A. Profile and image boundary

`Verify:` Run focused registry/image tests, boot current and previous Linux/DOS
base images, and execute `which basic`, `which basicc`, `QBASIC`, and `EDIT`.

`Expect:` Current CS-Linux has no BASIC command or utility file. Current CS-DOS
has `C:\COMMAND\QBASIC.EXE`; legacy overlays still attach to their immutable
base. `EDIT` and `QBASIC /EDITOR` render the same editor engine.

### B. Command-line and editor compatibility

`Verify:` Exercise every documented switch alone and in valid/invalid
combinations; load existing/missing/read-only/oversized files; save, cancel,
close dirty, disconnect, and force a write failure.

`Expect:` Each branch has one QBasic-compatible result or one explicit CS
resource/sandbox diagnostic. Dirty data remains available after failed save.

### C. IDE, keys, and mouse

`Verify:` In a real Chrome Web Terminal, use keyboard and pointer to open every
menu, place/drag the cursor, scroll, invoke help, set/clear a breakpoint, step,
continue, stop, and switch Program/Immediate/Output windows. Repeat as a viewer,
after takeover, outside the terminal, and across disconnect.

`Expect:` The writer receives ordered input; viewers and invalid coordinates do
not mutate guest state; moves stay bounded; disconnect releases every button;
debug execution returns to a single visible stopped/completed/error state.

### D. Language and sandbox

`Verify:` Run positive and negative conformance programs for syntax, types,
control flow, procedures, arrays, strings, data, files, graphics, and errors.
Probe `SHELL`, ports, memory, machine-code, serial/printer, path escape, large
allocation, deep calls, infinite loops, output floods, and malformed source.

`Expect:` Supported programs produce deterministic QBasic results under the
CS386SX budget. Unsupported or exhausted behavior reports a source location and
status. No test can access a host process, host path, raw port, raw memory, or
native DOS/BIOS interrupt.

### E. Product synchronization

`Verify:` Run focused tests, real Chrome checks, the smallest applicable BDS/GDK
probe, and finally `npm run validate` on Node.js 24 or later.

`Expect:` Source, tests, current/legacy images, README, the canonical Web
manual, Issue evidence, pack build, and browser behavior agree. Any
unimplemented ledger row remains explicitly marked in progress and is never
advertised as complete.
