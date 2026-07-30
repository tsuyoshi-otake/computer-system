# Issue #122: persistent bounded CS-Linux Python REPL

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/122

Status: implemented and verified on the host, real BDS, and real Chrome.

Depends on Epic #49, the Python 3.14 CS Profile issues, #16 scheduler ownership,
#31 guest resource accounting, #33 compile-lease finalization, #40 terminal
interaction state, #113 bounded CS486 slices, and #115's single production
`Cs486Process` contract.

## Boundary

On a desktop CS486DX or CS486DX2 Computer, bare `python` and its compatibility
alias `micropython` open a persistent `>>> ` / `... ` terminal session. Existing
`python FILE` and `python --stats FILE` behavior is unchanged. The portable
CS386SX profile continues to reject user Python with status 127.

This is not a host evaluator and not a replay loop. The shell prepares one
Python frontend/runtime, acquires one `GuestProcessMemoryGrant`, registers one
OS PID and one scheduler process, and constructs one production `Cs486Process`.
Every accepted cell is compiled to new CS486 instructions and appended
atomically only at a completed process boundary. Globals, imports, closures,
functions, classes, instances, iterators, and generators therefore remain in the
same managed runtime and heap across cells. Previous cells and their side
effects are never re-executed.

The final expression of a cell is displayed once with the bounded Python
representation when it is not `None`. Compound suites request `... ` until a
blank input line; open delimiters and triple-quoted strings request it until
they close. Syntax errors publish no new instructions or definitions. Ordinary
Python runtime errors report the diagnostic and return to the primary prompt
while preserving already committed state. Re-importing an initialized source
module reuses its namespace and does not repeat module side effects.

## Bounds and unsupported forms

- One interactive source session admits at most 512,000 UTF-8 bytes. Existing
  Python frontend token, nesting, statement, symbol, collection, call-depth,
  instruction, heap, and output bounds continue to apply.
- Pending source and the live runtime are covered by the same 1 MiB foreground
  Python RAM grant. There is no second physical lease or optional accounting
  path.
- Redirects, pipelines, background execution, shell-script invocation, MCP debug
  invocation, and `--stats` are rejected explicitly for the interactive form.
  File execution keeps its existing supported pipeline, redirection, script,
  MCP, and statistics paths.
- Filesystem `CS486OBJ` extension-module imports are rejected in interactive
  cells because their process-image relocation is a file-execution capability;
  built-in and guest Python source imports remain supported and persistent.
- Source lines are excluded from shell and browser history.

## Interaction and finalization

The versioned terminal descriptor advertises line input, Ctrl+D EOF, and Ctrl+C
only while the foreground Python REPL owns input. The Bedrock bridge, Web
companion, and browser validate the current session, writer lease, interaction
generation, and context before admitting EOF. EOF carries no payload.

| Branch                                                 | Observable outcome                                                             | Finalization owner                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------- |
| Ctrl+D at a clean prompt                               | Exit 0 and restore the shell prompt                                            | Normal foreground completion            |
| Ctrl+C with pending source                             | Discard only that cell and return `>>> `                                       | Python REPL input owner                 |
| Ctrl+C while executing                                 | Terminate the REPL with status 130                                             | Existing foreground interrupt/finalizer |
| Syntax or ordinary runtime error                       | One diagnostic, same PID/runtime, restored prompt                              | Cell-boundary owner                     |
| Malformed/stale/viewer EOF or line                     | Reject before guest mutation                                                   | Transport/interaction admission owner   |
| Disconnect, logout, reboot, shutdown, or process fault | Release PID, scheduler entry, RAM, credentials, and pending input exactly once | Existing foreground lifecycle finalizer |

The guest system shell remains parked on its original foreground completion
event while `ComputerRuntime` routes REPL line/EOF events directly to that one
foreground process. Cell boundaries do not synthesize process completion and do
not release or reacquire resources.

## Acceptance

1. Verify: enter `value = 40`, then `value + 2`. Expect: `42`, one PID,
   scheduler registration, RAM grant, runtime, and `Cs486Process` throughout.
2. Verify: define and later use a function, closure, class, import, and
   generator in separate cells. Expect: each object retains identity/state
   without replay.
3. Verify: enter an incomplete suite, open delimiter, and triple-quoted string.
   Expect: `... ` until respectively a blank-line boundary or the closing token;
   one atomic installation after successful compilation.
4. Verify: enter a syntax error and then `1 + 1`; enter `1 / 0` and then
   `2 + 2`. Expect: diagnostics followed by `2` and `4` on the same process.
5. Verify: Ctrl+C at a continuation prompt, Ctrl+C during a running cell, and
   Ctrl+D at `>>> `. Expect: respectively discard-and-continue, explicit status
   130 termination, and normal status 0 completion with one restored shell
   prompt.
6. Verify: stale generation, viewer, wrong context, payload-bearing EOF,
   disconnect, logout, reboot, and shutdown. Expect: rejected input or one
   explicit terminal outcome, with no retained credential, PID, scheduler event,
   process, source, or RAM grant.
7. Verify: `python FILE`, `python --stats FILE`, MCP file execution, and CS386SX
   bare `python`. Expect: existing file modes remain unchanged and portable
   Python returns 127.
8. Verify: focused runtime/OS/Computer/terminal/Web suites, then
   `npm run validate`. Expect: all checks and builds exit 0 and no repository
   Vitest process remains.
9. Verify: run the smallest applicable real-BDS probe and use a real Chrome
   writer session for primary/continuation/result/interrupt/EOF flows. Expect:
   exact visible prompts and restoration with no new BDS or browser diagnostic.

## Verification result

Observed 2026-07-30 on Node 24 and Windows 11:

- The 12-file focused runtime/OS/Computer/terminal/Web/BDS command passed 238
  tests. It covers persistent object identity and state, one PID/process/grant,
  atomic exact/plus-one bounds, syntax/runtime recovery, Ctrl+C at pending and
  running states, Ctrl+D, stale/viewer/malformed input, lifecycle finalization,
  CS386SX rejection, file-mode compatibility, and the exact no-payload BDS EOF
  relay. No Vitest process survived the run.
- `npm run validate` passed Prettier, ESLint, `tsc --noEmit`, all 2,670 tests in
  313 files, the production Bedrock pack build, and the 16-chapter Pages build.
- An isolated real BDS created Computer `c-r20rqv`, selected the TypeScript
  CS486 engine with two bounded runtime workers, and reached the `cs` shell.
  Real Chrome displayed the Python banner, `>>>`, `...`, persistent values and a
  separately completed function returning `42`, then restored one shell prompt
  after Ctrl+D. A final run repeated the continuation/EOF path. The terminal and
  Web Manual showed the persistent one-`Cs486Process` contract and limits.
- Chrome reported no page diagnostics and no horizontal overflow (1,835 px
  client width and scroll width). Its automation safety layer reserves synthetic
  Ctrl+C as a clipboard shortcut, and Windows Computer Use stopped because it
  could not establish the localhost URL with policy-level confidence. The exact
  Ctrl+C browser-handler, Web request, BDS relay, pending-cell cancellation, and
  running-cell status-130 branches therefore use the passing focused automated
  evidence; no browser safety restriction was bypassed.
- Each isolated BDS run reached `LIVE_BDS_STOPPED {"state":"idle"}` with empty
  stderr, and all owned BDS, MCP, controller, and runtime-worker processes
  exited.
