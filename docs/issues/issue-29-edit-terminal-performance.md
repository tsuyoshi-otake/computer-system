# Issue #29: EDIT and Web Terminal responsiveness

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/29>

Status on 2026-07-18: implemented. The complete `npm run validate` gate passes
with 149 test files and 997 tests. MCP-only real-BDS startup, preserved-world
storage migration, Computer enumeration, headless activation, default-browser
launch, exact debug-writer ownership, TUI frame capture, EDIT File/Open/Display,
and DOS `DIR` are verified with zero diagnostics. No connected Bedrock player,
Computer right-click, Minecraft UI automation, or separate browser automation
was used. The manual rapid-burst, five-viewer, and Chrome Performance-trace
criteria remain before closing the Issue.

## Root-cause boundary

The dominant delay was in the Add-On's host interaction pipeline, not in the
modeled CS386SX or CS486 CPU profiles. One browser input crosses the serialized
browser queue, HTTP companion, Bedrock script-event admission, guest
shell/editor, terminal frame, Bedrock snapshot, authenticated NDJSON stream, and
browser DOM paths. The former path could redraw and copy the fixed terminal
repeatedly for individual keys, rebuild unchanged browser rows, and treat relay
completion as input success before Bedrock had admitted the event. Those serial
stages dominate perceived EDIT latency under Amdahl's law.

The CPU profiles still own deterministic guest instruction and cycle accounting.
This change does not raise their modeled clock, rewrite guest timing from host
elapsed time, or bypass their execution limits. A CPU model can dominate a
guest-compiled workload, but it was not the proximate cause of delayed EDIT key
reflection. Chrome/BDS wall time is responsiveness evidence, not `cpuCycles`.

For Gustafson-style growth, the implementation bounds work and retains only the
latest replaceable state as documents, bursts, Computers, and attached viewers
increase. It does not assume that more browser sessions make the serial
Bedrock/companion path parallel.

## Implemented boundary

- EDIT, CS QBASIC, and the DOS IDE path apply a bounded key batch sequentially
  but construct one observable editor screen at the batch terminal state. A
  value-validated 64-entry rendered-line cache avoids repeatedly decoding
  unchanged visible lines, and revision-keyed language/include indexes avoid
  whole-document cache keys on hits.
- `TerminalBuffer.applyFrame` validates the complete frame before mutation,
  retains unchanged cell objects, applies changed cells atomically, and advances
  the terminal revision once. An unchanged frame does not advance it.
- Bedrock snapshot emission compares terminal identity, revision, small
  metadata, and pending audio before copying the fixed cell grid. Sessions
  attached to one Computer share the captured frame for a revision;
  session-specific envelopes and required wire serialization remain separate.
- The browser owns a 1,024-key FIFO. Enqueue is atomic, relayed batches are at
  most 16 keys and 180 encoded characters, and keys leave the queue only after a
  correlated Bedrock admission acknowledgement. Session replacement and closure
  explicitly discard the superseded generation.
- The companion admits at most 32 pending input acknowledgements. Accepted,
  ignored, missing, failed, busy, timeout, relay failure, BDS stop, and server
  stop paths each finalize exactly once. Explicit busy responses use 429 and
  `Retry-After`; the browser retries at most five times with exponential backoff
  and jitter.
- Blocked NDJSON output retains the newest terminal frame and newest control
  state in constant-size slots, never lets keepalive replace meaningful state,
  and gives replacement one terminal end. The browser consumes terminal updates
  on `requestAnimationFrame` and reuses unchanged terminal-row DOM nodes.
- MCP binds TUI inspection/input to the exact debug-owned writer session
  returned by `bds_open_web_terminal`. `principalKind` prevents a simultaneous
  normal Player handoff from satisfying that wait. The companion exposes the
  existing authoritative text snapshot as a versioned `surface.kind: "text"`; it
  adds no parallel screen state. Screen waits are observer-driven, one per
  session and eight globally, while geometry is rejected above 200 x 100. MCP
  input reuses the correlated Web admission path, and secret prompts are
  rejected both from the last companion frame and again from current Bedrock
  runtime state before queueing. Normal Player input remains unchanged.

## Complexity and scaling

Let `B` be keys in one admitted batch, `V = width * height` the visible terminal
cells, `L` the edited line length, `D` the document line count, `S` the attached
sessions, and `C` the number of changed browser rows.

- Editor state transitions remain ordered and bounded by the actual edits,
  approximately `O(B * L)` with the current immutable line representation. The
  screen is now built once per batch in `O(V + visible line work)`, rather than
  once per key. The deterministic 4,096-line case proves batch redraw work does
  not scale with `D` for an edit on the visible line.
- Terminal frame application remains `O(V)` because the complete frame must be
  validated, but allocation and mutation are proportional to changed cells and
  revision publication is `O(1)`.
- An unchanged session snapshot stops after `O(1)` identity/revision/metadata
  checks. For a changed Computer revision, terminal capture is `O(V)` once per
  Computer, while the current full-frame protocol still requires `O(S * V)` wire
  serialization and delivery.
- Browser row signatures inspect `O(V)` data for a delivered frame, while DOM
  replacement is `O(C * width)` and unchanged row nodes survive. Rapid incoming
  terminal events collapse to the newest frame per animation frame.
- Queue storage, retry count, pending acknowledgements, key batch size, NDJSON
  replacement slots, and rendered-line cache are all fixed-capacity. This keeps
  overload explicit and prevents hidden unbounded work as sessions scale.
- Exact MCP session lookup is `O(1)`, and a waiting verifier performs no
  periodic log/session scan. Validating/copying a requested screen is the
  unavoidable `O(V)` operation. Foreground/background grids are copied only when
  requested; observer, timeout, writer replacement, close, BDS stop, and
  companion stop all converge on one finalizer.

## Acceptance evidence

1. Editor batching and frame atomicity

   `Verify:`
   `npm test -- tests/editor/dosEditSession.test.ts tests/domains/terminal.test.ts`

   `Expect:` 16- and 32-key bursts build one final screen; the 4,096-line
   fixture decodes the edited visible line once; unchanged frames preserve
   revision; an invalid frame leaves the prior snapshot intact.

2. Browser queue ownership and bounded retries

   `Verify:`
   `npm test -- tests/tools/terminalInput.test.mjs tests/tools/webUi.test.mjs`

   `Expect:` Enqueue overflow is atomic, acknowledgement order is enforced,
   relay batches stay within both limits, superseded work is explicitly
   discarded, and only explicit busy results enter the five-attempt
   `Retry-After`-aware policy.

3. Bedrock admission, snapshot sharing, and companion backpressure

   `Verify:`
   `npm test -- tests/tools/webCompanionServer.test.mjs tests/bedrock/terminalAdapters.test.mjs`

   `Expect:` HTTP 202 follows the exact session/request admission marker; all
   negative and timeout branches clean pending state; capacity plus one returns
   explicit busy; unchanged snapshots short-circuit before terminal copying; a
   blocked stream emits the newest terminal/control state and final replacement.

4. Complete host gate

   `Verify:` `npm run validate`

   `Expect:` Formatting, ESLint, TypeScript, all Vitest suites, the production
   Bedrock pack build, and all 16 Pages chapters pass.

   `Result (2026-07-18):` Pass — 149 test files and 997 tests passed; both pack
   and 16-chapter Pages production builds completed.

5. Real runtime responsiveness

   `Verify:` Through the Computer System MCP server only, call
   `bds_start({ resetWorld: false })`, wait for storage migration to complete,
   page `bds_list_computers`, select the exact Computer identity, and call
   `bds_open_web_terminal`. With zero connected players, call
   `bds_wait_for_tui_screen`, submit `edit` through `bds_send_tui_input`, wait
   for the EDIT marker, submit `Escape` and `Alt+f`, wait for the File menu,
   then read the same frame through `bds_get_tui_screen`. Separately perform the
   Issue #29 section in `docs/manual-verification.md` for the remaining
   multi-viewer and trace criteria.

   `Expect:` The MCP call activates the exact Computer, opens the default
   browser, and succeeds only after that exact debug session owns writer state.
   MCP observes a valid 80 x 25 text surface with matching row/color dimensions
   and cursor, then observes later snapshot versions for EDIT and its File menu.
   Rapid EDIT input appears once and in order, five viewers converge on the
   newest complete frame, overload/paused/discarded input remains visible, and
   correlated Bedrock acceptance precedes browser acknowledgement. Record
   BDS/GDK and browser versions with the manual result.

   `Result (2026-07-18):` Pass for the MCP-only lifecycle - managed server
   startup on Bedrock UDP 19142 and Web TCP 80, preserved-world migration, exact
   Computer selection, headless activation, default-browser launch, exact debug
   writer ownership, 80 x 25 rows/colors/cursor validation, the continuous left
   document border, leading cells, four arrow directions, canonical File menu,
   Open/Display dialogs, and fixed-column `DIR` all passed across snapshot
   versions 1 through 8 with zero diagnostics. No connected Bedrock player,
   in-game interaction, exposed one-use URL/token, or separate browser
   automation was required. The manual responsiveness steps 1, 2, and 4 remain
   separate multi-viewer/trace evidence.

### Browser input-gate follow-up

A 2026-07-18 follow-up found that the MCP TUI acceptance injected encoded keys
after the browser boundary and therefore did not prove the browser's editor-mode
gate. Plain EDIT renders two leading menu-bar cells, while WorkBench renders
one; the Web detector accepted only the latter. That left editorActive false for
plain EDIT, so browser Alt handling and every pointer relay returned before the
already-verified guest input path. This was a Web-client integration defect, not
CS386SX or CS486 timing.

Verify: npm test -- tests/tools/terminalInput.test.mjs
tests/tools/webUi.test.mjs tests/editor/dosEditSession.test.ts
tests/editor/qbasicSession.test.ts

Expect: The real two-cell plain-EDIT row, one-cell WorkBench row, and vi mode
row all select bounded editor input; normal shell text does not. Alt+F remains
Alt+f, primary mouse state remains bounded, and all focused Web/editor tests
pass.

Result (2026-07-18): Pass — 4 focused files and 54 tests passed. The Web
companion gate also passed 3 files and 65 tests.

### DOS EDIT display-fidelity follow-up

Verify:
`npm test -- tests/editor/dosEditorOptions.test.ts tests/editor/dosEditSession.test.ts tests/tools/webUi.test.mjs tests/tools/webManual.test.mjs`

Expect: The Display dialog uses bounded Tab/Shift+Tab focus across Foreground,
Background, Scroll Bars, Tab Stops, OK, Cancel, and Help. OK applies, Cancel/Esc
restore the opening options, primary-pointer OK executes, menu/dialog frames use
single-line box glyphs and black shadows, and Web EDIT exposes only `#AAAAAA`,
`#0000AA`, `#00AAAA`, and `#000000`. Browser rendering splits vertical joining
glyphs into bounded spans and fills the one-pixel row seam.

Result (2026-07-18): Pass - 4 focused files and 58 tests passed. The complete
`npm run validate` gate passed 149 files and 998 tests, the Bedrock pack build,
and the 16-chapter Pages build. A preserved-world MCP-only restart on Web TCP 80
and Bedrock UDP 19142 opened the default browser, verified the exact debug
writer, the File/Open/Display screens, single-line Display borders, more than
ten continuous vertical-border rows, four Tab fields to OK, Enter application,
and zero diagnostics through snapshot version 9. Served `app.js` and
`styles.css` returned HTTP 200 with `Cache-Control: no-store`, all four exact
colors, no old `#0100AB`/`#00AAA9`, and the vertical seam class.

## Residual risks

- Editing one very long line still copies immutable strings/code-point arrays in
  `O(L)` per key. A piece table or rope should be considered only if profiling
  shows line length, rather than redraw/transport, has become dominant.
- The current protocol still serializes and transmits a full `V`-cell terminal
  payload per viewer for every changed frame. Computer-scoped deltas or a binary
  frame format remain future work and require independent compatibility and
  real-browser evidence.
- Browser signature calculation remains `O(V)` for each delivered frame even
  though unchanged DOM rows are retained. Canvas rendering is not implemented.
- The text-surface MCP contract is intentionally not a graphics implementation.
  A future CS Windows-style 320 x 200 or 640 x 480 mode must route display VRAM
  through bounded palette/tile epochs and one Computer-scoped immutable
  keyframe, rather than copying a framebuffer per session or treating text VRAM
  as a second truth. Logical graphics and final Canvas/CSS rendering require
  separate MCP and real-browser evidence; native Windows 3.1/x86 compatibility
  is not implied.
- Deterministic work-count tests prove the removed multiplicative work, and the
  single-session MCP/BDS/default-browser lifecycle now passes. They are not a
  multi-user wall-time benchmark; final capacity claims still require the manual
  five-viewer and Chrome trace evidence. CPU-profile changes require separate
  guest benchmark evidence.
