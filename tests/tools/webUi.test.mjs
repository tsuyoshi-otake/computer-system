import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Web terminal UI", () => {
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
    const [css, script, inputHelpers] = await Promise.all([
      source("web/styles.css"),
      source("web/app.js"),
      source("web/terminal-input.js"),
    ]);

    expect(css).toContain("user-select: text");
    expect(css).toContain(".terminal-output ::selection");
    expect(script).toContain(
      "hasCopySelection(elements.commandInput, window.getSelection())",
    );
    expect(script).toContain(
      "if (window.getSelection()?.isCollapsed === false) return",
    );
    expect(script).toContain('addEventListener("paste"');
    expect(script).toContain("insertPastedCommand(");
    expect(inputHelpers).toContain('replace(/\\r\\n?|\\n/gu, " ")');
  });

  it("detects vi screens and relays bounded coalesced editor key batches", async () => {
    const script = await source("web/app.js");

    expect(script).toContain("viActive = terminal.rows.some");
    expect(script).toContain("queueViKeys([key])");
    expect(script).toContain("Math.min(16, viKeyQueue.length)");
    expect(script).toContain('kind: "keys"');
    expect(script).toContain("viKeyQueue.length > 0");
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
    expect(script).toContain("error?.status === 409");
  });

  it("fits and requests bounded terminal dimensions while keeping disconnected input disabled", async () => {
    const [css, script] = await Promise.all([
      source("web/styles.css"),
      source("web/app.js"),
    ]);

    expect(css).toContain("font-size: var(--terminal-font-size)");
    expect(script).toContain("function fitTerminal(columns)");
    expect(script).toContain('api("/api/resize"');
    expect(script).toContain("Math.min(160");
    expect(script).toContain("Math.min(60");
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
    expect(html).toContain('id="manual-previous"');
    expect(html).toContain('id="manual-next"');
    expect(manual).toContain("System orientation");
    expect(manual).toContain("Machine architecture");
    expect(manual).toContain("MicroPython");
    expect(manual).toContain("Assembly language");
    expect(manual).toContain("BASIC");
    expect(manual).toContain("C and C++");
    expect(manual).toContain("Faults and diagnostics");
    expect(manual).toContain("run --stats");
    expect(css).toContain(".manual-workspace");
    expect(css).toContain("grid-template-columns: 280px minmax(0, 1fr)");
    expect(script).toContain("renderManualChapter(manualChapterIndex, true)");
    expect(script).toContain('event.key === "ArrowRight"');
  });
});

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}
