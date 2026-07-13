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
    expect(html).toContain("<kbd>Ctrl</kbd>+<kbd>C</kbd>");
    expect(script).toContain('key === "c"');
    expect(script).toContain('event.key === "ArrowUp"');
    expect(script).toContain('key === "u" || key === "k" || key === "w"');
    expect(script).toContain("void closeSession()");
    expect(script).toContain("historyDraft");
    expect(script).toContain('elements.inputState.textContent = "INPUT"');
    expect(script).toContain('elements.inputState.textContent = "WAIT"');
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

  it("fits fixed terminal columns and keeps disconnected input disabled", async () => {
    const [css, script] = await Promise.all([
      source("web/styles.css"),
      source("web/app.js"),
    ]);

    expect(css).toContain("font-size: var(--terminal-font-size)");
    expect(script).toContain("function fitTerminal(columns)");
    expect(script).toContain('setInputAvailable(false, "OFFLINE")');
    expect(script).toContain('connectionState === "online"');
    expect(script).toContain('api("/api/close"');
  });
});

async function source(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}
