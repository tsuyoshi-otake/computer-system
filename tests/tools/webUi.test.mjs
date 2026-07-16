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
    expect(script).toContain("Math.min(10_000");
  });

  it("masks secret input and paints full-height terminal cell backgrounds", async () => {
    const [css, script] = await Promise.all([
      source("web/styles.css"),
      source("web/app.js"),
    ]);

    expect(css).toContain("-webkit-text-security: disc");
    expect(css).toContain(".terminal-row > span");
    expect(css).toContain("height: 100%");
    expect(script).toContain("terminal.secretInput === true");
    expect(script).toContain("!submittedSecret");
    expect(script).toContain("if (!secretInput) moveHistory(-1)");
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
    expect(html).toContain('<textarea\n              id="command-input"');
    expect(css).toContain("text-indent: var(--cursor-left)");
    expect(css).toContain("top: calc(14px + var(--cursor-top))");
    expect(css).toContain("outline: 0 solid transparent");
    expect(script).toContain('"--cursor-left"');
    expect(script).toContain('"--cursor-top"');
    expect(script).toContain(
      "elements.terminalScreen.replaceChildren(fragment)",
    );
  });

  it("keeps physical Enter, Ctrl+C, history, and textual focus feedback", async () => {
    const [html, script] = await Promise.all([
      source("web/index.html"),
      source("web/app.js"),
    ]);

    expect(html).toContain("<kbd>Enter</kbd>");
    expect(html).toContain("<kbd>Tab</kbd>");
    expect(html).toContain('id="completion-menu"');
    expect(html).toContain("<kbd>Ctrl</kbd>+<kbd>C</kbd>");
    expect(script).toContain('key === "c"');
    expect(script).toContain('event.key === "ArrowUp"');
    expect(script).toContain('key === "u" || key === "k" || key === "w"');
    expect(script).toContain("void closeSession()");
    expect(script).toContain("historyDraft");
    expect(script).toContain('elements.inputState.textContent = "INPUT"');
    expect(script).toContain('elements.inputState.textContent = "WAIT"');
    expect(script).toContain('event.key === "Tab"');
    expect(script).toContain('api("/api/complete"');
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
    expect(script).toContain(
      "hasCopySelection(elements.commandInput, window.getSelection())",
    );
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

  it("places accessible PWR/HDD/FDD controls beside Copy and relays power", async () => {
    const [html, css, script] = await Promise.all([
      source("web/index.html"),
      source("web/styles.css"),
      source("web/app.js"),
    ]);

    for (const id of [
      "power-indicator",
      "hdd-indicator",
      "fdd-indicator",
      "power-button",
      "power-feedback",
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html.indexOf('id="copy-button"')).toBeLessThan(
      html.indexOf('class="machine-panel"'),
    );
    expect(html.indexOf('class="machine-panel"')).toBeLessThan(
      html.indexOf('id="manual-button"'),
    );
    expect(html).toContain('aria-describedby="lifecycle-state power-feedback"');
    expect(css).toContain('.hardware-indicator[data-state="read"]');
    expect(css).toContain('.hardware-indicator[data-state="write"]');
    expect(css).toContain('.hardware-indicator[data-state="fault"]');
    expect(css).toContain(".power-button:active:not(:disabled)");
    expect(script).toContain('api("/api/power"');
    expect(script).toContain("JSON.stringify({ action })");
    expect(script).toContain('return "safe_boot"');
    expect(script).toContain("/startup.py was not changed");
    expect(script).toContain("payload?.storage?.hdd?.state");
    expect(script).toContain("payload?.storage?.fdd?.state");
    expect(script).toContain("machineAcceptsInput(machineLifecycle)");
  });

  it("detects vi and DOS EDIT screens and relays bounded editor key batches", async () => {
    const script = await source("web/app.js");

    expect(script).toContain("editorActive =");
    expect(script).toContain("File\\s+Edit\\s+Search\\s+Options\\s+Help");
    expect(script).toContain("queueEditorKeys([key])");
    expect(script).toContain("Math.min(16, editorKeyQueue.length)");
    expect(script).toContain('kind: "keys"');
    expect(script).toContain("editorKeyQueue.length > 0");
    expect(script).toContain("`Ctrl+${event.key.toLowerCase()}`");
    expect(script).toContain("`Alt+${event.key.toLowerCase()}`");
    expect(script).toContain('"PageDown"');
    expect(script).toContain('"F10"');
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
    expect(script).toContain('accessMode === "viewer" ? "LOCKED" : state');
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
    expect(css).toContain("caret-color: var(--input-color, var(--text))");
    expect(css).not.toContain("caret-color: var(--green)");
    expect(script).toContain("function fitTerminal(columns, rows)");
    expect(script).toContain("function terminalContentSize()");
    expect(script).toContain("function ensureHardwareTextMode()");
    expect(script).toContain("new ResizeObserver(scheduleTerminalFit)");
    expect(script).toContain('api("/api/resize"');
    expect(script).toContain("const hardwareTextColumns = 80");
    expect(script).toContain("const hardwareTextRows = 25");
    expect(script).toContain("maximumPixels: 48");
    expect(layout).toContain("availableWidth / (columns * monospaceRatio)");
    expect(layout).toContain("availableHeight / (rows * lineHeightRatio)");
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
