import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Web terminal UI", () => {
  it("accepts a one-use four-digit code at the stable LAN entry page", async () => {
    const [html, script] = await Promise.all([
      source("web/index.html"),
      source("web/app.js"),
    ]);

    expect(html).toContain('id="handoff-code"');
    expect(html).toContain('pattern="[0-9]{4}"');
    expect(script).toContain('fetch("/api/handoff"');
    expect(script).toContain('fetch("/api/reconnect"');
    expect(script).toContain("localStorage.setItem(codeStorageKey, code)");
    expect(script).toContain('url.searchParams.set("computer", code)');
    expect(script).toContain("reconnectGeneration");
    expect(script).toMatch(/Math\.min\(\s*10_000/u);
    expect(script).toContain('initialSearch.get("handoff") === "1"');
    expect(script).toContain('stableUrl.searchParams.delete("handoff")');
    expect(script).toContain('response.headers.get("retry-after")');
    expect(script).toContain('setConnection("offline", "REPLACED")');
    expect(script).toContain("const maximumAttempts = 64");
  });

  it("masks secret input and paints full-height terminal cell backgrounds", async () => {
    const [css, script] = await Promise.all([
      source("web/styles.css"),
      source("web/app.js"),
    ]);

    expect(css).toContain("-webkit-text-security: disc");
    expect(css).toContain(".terminal-row > span");
    expect(css).toContain("height: 100%");
    expect(script).toContain("terminalInteractionFromTerminal(terminal)");
    expect(script).toContain("terminalInteraction.secretInput");
    expect(script).toContain("!submittedSecret");
    expect(script).toContain(
      "if (terminalInteraction?.history === true) moveHistory(-1)",
    );
  });

  it("places the command input at the terminal cursor without a visible field", async () => {
    const [html, css, script] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
    ]);

    expect(html).toContain('id="terminal-stage"');
    expect(html).toContain('id="terminal-screen"');
    expect(html.indexOf('id="terminal-screen"')).toBeLessThan(
      html.indexOf('id="command-form"'),
    );
    expect(html).not.toContain('class="prompt"');
    expect(html).toContain('id="input-state"');
    expect(css).toContain("position: absolute");
    expect(html).toMatch(/<textarea\r?\n\s+id="command-input"/u);
    expect(css).toContain("text-indent: var(--cursor-left)");
    expect(css).toContain("top: var(--cursor-top)");
    expect(css).toContain("outline: 0 solid transparent");
    expect(script).toContain('"--cursor-left"');
    expect(script).toContain('"--cursor-top"');
    expect(script).toContain(
      "elements.terminalScreen.replaceChildren(fragment)",
    );
    expect(script).toContain("terminalRenderFrame = requestAnimationFrame");
    expect(script).toContain(
      "renderedTerminalRowElements[y].replaceWith(line)",
    );
  });

  it("centers one fixed display frame and exposes bounded display options", async () => {
    const [html, css, script, presentation] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
      source("web/terminal-presentation.js"),
    ]);

    expect(html).toContain('id="options-button"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-controls="display-options-dialog"');
    const optionsButton =
      /<button[\s\S]*?id="options-button"[\s\S]*?<\/button>/u.exec(html)?.[0] ??
      "";
    expect(optionsButton).not.toContain("aria-pressed");
    expect(html).toContain('id="display-options-dialog"');
    expect(html).toContain('aria-labelledby="display-options-title"');
    expect(html).toContain("<legend>CRT profile</legend>");
    expect(html).toContain("<legend>Screen shape</legend>");
    for (const value of ["off", "subtle", "arcade", "shadow-mask"]) {
      expect(html).toContain('name="crt-profile" value="' + value + '"');
    }
    for (const value of ["flat", "curved"]) {
      expect(html).toContain('name="screen-shape" value="' + value + '"');
    }
    expect(html).toMatch(/Changes\s+apply immediately to this tab only\./u);
    expect(html).toContain('data-crt-profile="subtle"');
    expect(html).toContain('data-screen-shape="flat"');
    expect(html).toContain('data-curvature-percent="2"');
    expect(html).toContain('id="curvature-strength"');
    expect(html).toContain('name="curvature-percent"');
    const curvatureInputStart = html.indexOf('id="curvature-strength"');
    const curvatureInput = html.slice(
      curvatureInputStart,
      html.indexOf("/>", curvatureInputStart) + 2,
    );
    for (const attribute of [
      'type="range"',
      'min="0"',
      'max="30"',
      'step="1"',
      'value="2"',
      "disabled",
    ]) {
      expect(curvatureInput).toContain(attribute);
    }
    expect(html).toContain('id="curvature-value"');
    expect(html).toContain('id="terminal-display"');
    expect(html).toContain('data-raster-kind="text"');
    expect(html).toContain('id="terminal-optical-source"');
    expect(html).toContain('id="terminal-raster-content"');
    expect(html.indexOf('id="terminal-display"')).toBeLessThan(
      html.indexOf('id="terminal-optical-source"'),
    );
    expect(html.indexOf('id="terminal-optical-source"')).toBeLessThan(
      html.indexOf('id="terminal-raster-content"'),
    );
    expect(html.indexOf('id="terminal-raster-content"')).toBeLessThan(
      html.indexOf('id="terminal-screen"'),
    );
    expect(html).toContain('id="terminal-curved-glass"');
    expect(html).toContain('id="terminal-curvature-displacement"');
    expect(html).toContain('href="/crt-curvature-map.png"');
    expect(html).toContain('color-interpolation-filters="sRGB"');
    expect(css).toMatch(
      /\.terminal-stage\s*\{[^}]*display: grid;[^}]*place-items: center;[^}]*overflow: hidden;/su,
    );
    expect(css).toMatch(
      /\.terminal-display\s*\{[^}]*width: var\(--terminal-frame-width\);[^}]*height: var\(--terminal-frame-height\);[^}]*overflow: hidden;/su,
    );
    expect(css).toMatch(
      /\.terminal-display\s*\{[^}]*box-shadow: none;[^}]*font-family: var\(--terminal-screen-font\);/su,
    );
    expect(css).toContain("--terminal-raster-margin: 1em");
    expect(css).toContain(
      "width: calc(100% / var(--terminal-horizontal-scale))",
    );
    expect(css).toContain(
      "transform: scaleX(var(--terminal-horizontal-scale))",
    );
    expect(css).toMatch(
      /\.terminal-optical-source\s*\{[^}]*inset: var\(--terminal-raster-margin\) 0;/su,
    );
    expect(css).not.toContain("0 0 0 5px #050708");
    expect(css).toMatch(
      /\.terminal-optical-source::before,[\s\S]*?\.terminal-optical-source::after\s*\{[^}]*pointer-events: none;/su,
    );
    expect(css).toContain('.terminal-display[data-crt-profile="subtle"]');
    expect(css).toContain('.terminal-display[data-crt-profile="arcade"]');
    expect(css).toContain('.terminal-display[data-crt-profile="shadow-mask"]');
    expect(css).toContain('.terminal-display[data-screen-shape="curved"]');
    expect(css).toContain('.curvature-control input[type="range"]');
    expect(css).toContain("repeating-linear-gradient(");
    expect(css).toContain("mix-blend-mode: multiply");
    expect(script).toContain("function applyTerminalPresentation(value)");
    expect(script).toContain(
      'elements.curvatureStrength.addEventListener("input"',
    );
    expect(script).toContain('"scale"');
    expect(script).toContain(
      "curvatureScaleFromPercent(terminalPresentation.curvaturePercent)",
    );
    expect(script).toContain("terminalCellFromDisplayPoint({");
    expect(script).toContain(
      "curvaturePercent: terminalPresentation.curvaturePercent",
    );
    expect(script).toContain(
      'if (terminalInteraction.inputMode === "keys") return "EDIT"',
    );
    expect(script).toContain('"--terminal-frame-width"');
    expect(script).toContain('"--terminal-frame-height"');
    expect(script).toContain("const lineHeightRatio = 1");
    expect(script).toContain(
      "calculateTextRasterPresentation({ columns, rows })",
    );
    expect(script).toContain(
      'elements.terminalDisplay.dataset.rasterKind = "text"',
    );
    expect(script).toContain('"--terminal-raster-margin"');
    expect(script).toContain('"--terminal-horizontal-scale"');
    expect(presentation).not.toContain("localStorage");
    expect(presentation).not.toContain("sessionStorage");
    expect(presentation).toContain("MAX_CURVATURE_PERCENT = 30");
    const rowRender =
      /function renderTerminalNow\([\s\S]+?(?=function terminalRowSignature)/u.exec(
        script,
      )?.[0] ?? "";
    expect(rowRender).not.toContain("terminalPresentation");
    expect(rowRender).not.toContain("data-crt-profile");
  });

  it("keeps physical Enter, Ctrl+C, history, and textual focus feedback", async () => {
    const [html, css, script, inputHelpers] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
      source("web/terminal-input.js"),
    ]);

    expect(html).toContain("Waiting for terminal interaction details.");
    expect(html).toContain('id="keyboard-help"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).not.toContain('id="completion-menu"');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('aria-controls="completion-options"');
    expect(html).not.toContain('role="listbox"');
    expect(script).toContain("resolveTerminalCtrlCAction(terminalInteraction");
    expect(script).toContain('event.key === "ArrowUp"');
    expect(script).toContain('key === "u" || key === "k" || key === "w"');
    expect(script).toContain("void closeSession()");
    expect(script).toContain("historyDraft");
    expect(script).toContain('event.key === "F3"');
    expect(script).toContain('cursorShape === "underline"');
    expect(script).toContain('["a", "d", "e", "k", "u", "w"].includes(key)');
    expect(script).toContain('sendInput({ kind: "abort-line" })');
    expect(script).toContain("function interactionStateLabel()");
    expect(script).toContain("function renderInteractionHints(interaction)");
    expect(script).toContain("elements.keyboardHelp.replaceChildren(fragment)");
    expect(script).toContain('"Reload page"');
    expect(script).toContain("location.reload()");
    expect(css).not.toContain(
      ".terminal-display:has(.command-line textarea:focus-visible)",
    );
    expect(css).toContain("#keyboard-help kbd");
    expect(css).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important;/u);
    expect(script).toContain('event.key === "Tab"');
    expect(script).toContain('api("/api/complete"');
    expect(script).toContain("new CompletionRequestController()");
    expect(script).not.toContain("acceptSelectedCompletion()");
    expect(inputHelpers).toContain("class CompletionRequestController");
    expect(inputHelpers).toContain('outcome: "stale"');
    expect(css).not.toContain(".completion-option");
    expect(script).not.toContain("completionShelf");
    for (const [id, label] of [
      ["caps-lock-indicator", "Caps Lock"],
      ["num-lock-indicator", "Num Lock"],
      ["scroll-lock-indicator", "Scroll Lock"],
    ]) {
      const button = new RegExp(
        `<button[\\s\\S]*?id="${id}"[\\s\\S]*?<\\/button>`,
        "u",
      ).exec(html)?.[0];
      expect(button).toBeDefined();
      expect(button).toContain('type="button"');
      expect(button).toContain('data-state="off"');
      expect(button).toContain('aria-pressed="false"');
      expect(button).toContain(`aria-label="Virtual ${label} off"`);
    }
    expect(html).toContain('aria-label="Web Terminal virtual keyboard locks"');
    expect(html).toContain(
      "They do not change operating-system or terminal input behavior.",
    );
    expect(css).toContain('.keyboard-lock-indicator[data-state="on"]');
    expect(css).toContain(".keyboard-lock-indicator:focus-visible");
    expect(script).toContain(
      "function toggleVirtualKeyboardLock(element, label)",
    );
    expect(script).toContain('element.getAttribute("aria-pressed") !== "true"');
    expect(script).toContain(
      'element.setAttribute("aria-pressed", String(enabled))',
    );
    expect(script).not.toContain("updateKeyboardLockIndicators");
    expect(inputHelpers).not.toContain("getModifierState");
  });

  it("preserves native copy selections and normalizes bounded paste", async () => {
    const [html, css, script, inputHelpers] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
      source("web/terminal-input.js"),
    ]);

    expect(css).toContain("user-select: text");
    expect(html).toContain('id="copy-button"');
    expect(html.indexOf('id="copy-button"')).toBeLessThan(
      html.indexOf('id="manual-button"'),
    );
    expect(css).toContain(".terminal-output ::selection");
    expect(script).toContain("hasSelection: hasCopySelection(");
    expect(script).toContain(
      "if (window.getSelection()?.isCollapsed === false) return",
    );
    expect(script).toContain('addEventListener("paste"');
    expect(script).toContain("insertPastedCommand(");
    expect(script).toContain("copyTerminalText()");
    expect(script).toContain("navigator.clipboard?.writeText");
    expect(script).toContain('document.execCommand("copy")');
    expect(inputHelpers).toContain('replace(/\\r\\n?|\\n/gu, " ")');
  });

  it("places equal-size Options, Copy, and Manual controls before the hardware controls", async () => {
    const [html, css, script, manual] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
      source("web/manual.js"),
    ]);

    for (const id of [
      "power-indicator",
      "hdd-indicator",
      "fdd-indicator",
      "runtime-worker-indicator",
      "runtime-worker-state",
      "eject-button",
      "eject-feedback",
      "power-button",
      "power-feedback",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html.indexOf('id="options-button"')).toBeLessThan(
      html.indexOf('id="copy-button"'),
    );
    expect(html.indexOf('id="copy-button"')).toBeLessThan(
      html.indexOf('id="manual-button"'),
    );
    expect(html.indexOf('id="manual-button"')).toBeLessThan(
      html.indexOf('class="machine-panel"'),
    );
    expect(css).toMatch(
      /\.topbar-button\s*\{[^}]*width:\s*68px;[^}]*min-width:\s*68px;[^}]*min-height:\s*36px;/u,
    );
    expect(css).toMatch(
      /\.power-button\s*\{[^}]*width:\s*68px;[^}]*min-width:\s*68px;[^}]*min-height:\s*36px;/u,
    );
    expect(html).toContain('aria-describedby="lifecycle-state power-feedback"');
    expect(html).toContain('title="No floppy disk is present"');
    expect(css).toContain('.hardware-indicator[data-state="read"]');
    expect(css).toContain('.hardware-indicator[data-state="write"]');
    expect(css).toContain('.hardware-indicator[data-state="fault"]');
    expect(css).toContain(".power-button:active:not(:disabled)");
    expect(css).toContain(".eject-button:active:not(:disabled)");
    expect(script).toContain('api("/api/power"');
    expect(script).toContain('api("/api/floppy/eject"');
    expect(script).toContain('floppyDriveState !== "absent"');
    expect(script).toContain("Floppy disk ejected to the connected player.");
    expect(script).toContain("JSON.stringify({ action })");
    expect(script).toContain('return "safe_boot"');
    expect(script).toContain("/startup.py was not changed");
    expect(script).toContain("payload?.storage?.hdd?.state");
    expect(script).toContain("payload?.storage?.fdd?.state");
    expect(script).toContain(
      "updateRuntimeWorkerIndicator(payload?.execution)",
    );
    expect(script).toContain("W${String(workerIndex)}/${String(workerCount)}");
    expect(script).toContain("dataset.backend = backend");
    expect(css).toContain('.runtime-worker-indicator[data-backend="worker"]');
    expect(css).toContain('.runtime-worker-indicator[data-backend="mixed"]');
    expect(script).toContain("machineAcceptsInput(machineLifecycle)");
    expect(script).toContain("terminalDisplayPowerState(");
    expect(html).toContain('data-power-state="off"');
    expect(css).toContain(
      '.terminal-display[data-power-state="off"] .terminal-optical-source',
    );
    expect(manual).toContain("the CRT goes dark and Copy is disabled");
  });

  it("uses authoritative interaction descriptors for bounded editor input", async () => {
    const [script, inputHelpers] = await Promise.all([
      source("web/app.js"),
      source("web/terminal-input.js"),
    ]);

    expect(script).toContain("terminalInteractionFromTerminal(terminal)");
    expect(inputHelpers).not.toContain("isEditorTerminalScreen");
    expect(inputHelpers).not.toContain("-- INSERT --");
    expect(script).toContain('nextInteraction.presentation === "dos-tui"');
    expect(script).toContain("terminalInteraction.interactionGeneration !==");
    expect(script).toContain('terminalInteraction?.pointer === "cell"');
    expect(script).toContain("queueEditorKeys([key])");
    expect(script).toContain("new BoundedEditorKeyQueue()");
    expect(script).toContain("editorKeyQueue.peekBatch()");
    expect(script).toContain("editorKeyQueue.acknowledge(keys)");
    expect(script).toContain('admission.outcome === "rejected"');
    expect(script).toContain("isRetryableEditorInputError(error)");
    expect(inputHelpers).toContain("status >= 500 && status <= 599");
    expect(script).toContain("retryEditorInputOnDismiss");
    expect(script).toContain('"Retry input"');
    expect(script).toContain("generation !== editorInputGeneration");
    expect(script).toContain("discardEditorKeys()");
    expect(script).toContain("unacknowledged editor key(s) were discarded");
    expect(script).toContain('kind: "keys"');
    expect(script).toContain('addEventListener("pointerdown"');
    expect(script).toContain('addEventListener("pointermove"');
    expect(script).toContain('addEventListener("pointerup"');
    expect(script).toContain('kind: "mouse"');
    expect(script).toContain("mouseTransitionQueue.length >= 16");
    expect(script).toContain("editorKeyQueue.length > 0");
    expect(script).toContain("editorKeyFromKeyboardEvent(event)");
    expect(script).toContain('event.key === "Alt"');
    expect(script).toContain('queueEditorKeys(["F10"])');
    expect(script).toContain('"X-Computer-System-Interaction-Schema": "2"');
    expect(script).toContain('setConnection("offline", "RELOAD REQUIRED")');
  });

  it("renders the fixed-cell screen with the reference VGA font and exact palette", async () => {
    const [css, script, font] = await Promise.all([
      source("web/styles.css"),
      source("web/app.js"),
      readFile(path.join(root, "web/fonts/WebPlus_IBM_VGA_9x16.woff")),
    ]);

    expect(font.subarray(0, 4).toString("ascii")).toBe("wOFF");
    expect(font.byteLength).toBeGreaterThan(20_000);
    expect(css).toContain('font-family: "IBM VGA 9x16"');
    expect(css).toContain(
      'src: url("/fonts/WebPlus_IBM_VGA_9x16.woff") format("woff")',
    );
    expect(css).toMatch(
      /\.terminal-display\s*\{[^}]*font-weight: 400;[^}]*font-synthesis: none;[^}]*line-height: 1;[^}]*letter-spacing: 0;/su,
    );
    expect(css).toContain("-webkit-font-smoothing: none");
    expect(css).toMatch(
      /\.terminal-stage\.dos-editor-active \.command-line textarea\s*\{[^}]*pointer-events: none;/su,
    );
    for (const color of [
      '"#FFFFFF"',
      '"#a8a8a8"',
      '"#00AAAA"',
      '"#0000AA"',
      '"#000000"',
    ]) {
      expect(script).toContain(color);
    }
    for (const color of ['"#00AAA9"', '"#0100AB"']) {
      expect(script).not.toContain(color);
    }
    expect(script).toContain('"terminal-cell--join-y"');
    expect(css).toMatch(
      /\.terminal-stage\.dos-editor-active \.terminal-cell--join-y\s*\{[^}]*text-shadow: 0 1px currentcolor;/su,
    );
    expect(script).toMatch(
      /classList\.toggle\(\s*"dos-editor-active",\s*dosTuiPresentation,\s*\)/u,
    );
    expect(script).toContain(
      "const activePalette = dosTuiPresentation ? dosTuiPalette : palette",
    );
  });

  it("exposes view-only ownership and an explicit bounded takeover action", async () => {
    const [html, css, script] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
    ]);

    expect(html).toContain('id="access-state"');
    expect(html).toContain('id="take-control-button"');
    expect(html).toContain("Take control");
    expect(css).toContain('#access-state[data-mode="viewer"]');
    expect(css).toContain('button[aria-busy="true"]');
    expect(script).toContain('api("/api/take-control"');
    expect(script).toContain('accessMode === "writer"');
    expect(script).toMatch(
      /accessMode === "viewer"\s+\? "LOCKED"\s+: writable\s+\? interactionStateLabel\(\)\s+: state/u,
    );
    expect(script).toContain('error?.code === "read_only"');
    expect(script).toContain('error?.code === "out_of_range"');
  });

  it("fits a fixed 80x25 hardware grid while keeping disconnected input disabled", async () => {
    const [css, script, layout] = await Promise.all([
      source("web/styles.css"),
      source("web/app.js"),
      source("web/terminal-layout.js"),
    ]);

    expect(css).toContain("font-size: var(--terminal-font-size)");
    expect(css).toMatch(/\.terminal-stage\s*\{[^}]*overflow: hidden;/su);
    expect(css).not.toMatch(/\.terminal-stage\s*\{[^}]*overflow: auto;/su);
    expect(css).toContain("caret-color: transparent");
    expect(css).not.toContain("caret-color: var(--green)");
    expect(css).toContain(".terminal-cell-cursor");
    expect(css).toContain("steps(1, end)");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(script).toContain("function fitTerminal(columns, rows)");
    expect(script).toContain("function terminalContentSize()");
    expect(script).toContain("function ensureHardwareTextMode()");
    expect(script).toContain("new ResizeObserver(scheduleTerminalFit)");
    expect(script).toContain('api("/api/resize"');
    expect(script).toContain("const hardwareTextColumns = 80");
    expect(script).toContain("const hardwareTextRows = 25");
    expect(script).toContain("maximumPixels: 48");
    expect(script).toContain("calculateIntegerGridPresentation");
    expect(script).toContain("calculateLineCursorCell");
    expect(script).toContain("renderTerminalCursor");
    expect(script).toContain("refreshLocalLineCursor");
    expect(script).toContain("terminalInteraction.secretInput === true");
    expect(script).toContain('? "•"');
    expect(layout).toContain("availableWidth / (columns * monospaceRatio)");
    expect(layout).toContain("availableHeight / (rows * lineHeightRatio)");
    expect(layout).toContain("export function calculateRasterPresentation");
    expect(layout).toContain("export function calculateTextRasterPresentation");
    expect(layout).toContain("logicalWidth: columns * glyphWidth");
    expect(layout).toContain("logicalHeight: fittedRows * glyphHeight");
    const scheduledFit =
      /function scheduleTerminalFit\(\)[\s\S]+?(?=async function ensureHardwareTextMode)/u.exec(
        script,
      )?.[0] ?? "";
    expect(scheduledFit).not.toContain("/api/resize");
    expect(script).not.toContain("Math.min(160");
    expect(script).not.toContain("Math.min(60");
    expect(script).toContain('setInputAvailable(false, "OFFLINE")');
    expect(script).toContain('connectionState === "online"');
    expect(script).toContain('api("/api/close"');
  });

  it("places an accessible programming manual before connection status", async () => {
    const [html, css, script, manual] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
      source("web/manual.js"),
    ]);

    expect(html.indexOf('id="manual-button"')).toBeLessThan(
      html.indexOf('id="status-text"'),
    );
    expect(html).toContain('id="manual-dialog"');
    expect(html).toContain('id="manual-search"');
    expect(html).not.toContain('id="manual-path"');
    expect(html).not.toContain('id="manual-path-steps"');
    expect(html).toContain('id="manual-search-status"');
    expect(html).toContain('id="manual-previous"');
    expect(html).toContain('id="manual-next"');
    expect(html).toContain("Search manual");
    expect(manual).toContain("System orientation");
    expect(manual).toContain("Machine architecture");
    expect(manual).toContain("MicroPython");
    expect(manual).toContain("Assembly language");
    expect(manual).toContain("BASIC");
    expect(manual).toContain("C and C++");
    expect(manual).toContain("Faults, diagnostics, and recovery");
    expect(manual).toContain("run --stats");
    expect(css).toContain(".manual-workspace");
    expect(css).toContain("grid-template-columns: 280px minmax(0, 1fr)");
    expect(css).toContain(".manual-part-title");
    expect(css).toContain(".manual-search-result");
    expect(css).toContain(".manual-search-snippet");
    expect(script).toContain("renderManualChapter(manualChapterIndex, true)");
    expect(script).toContain("searchManual(");
    expect(script).not.toContain("manualPaths");
    expect(script).not.toContain("renderManualPathSteps");
    expect(script).toContain('concept: "Concept"');
    expect(script).toContain('event.key === "ArrowRight"');
  });
});

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}
