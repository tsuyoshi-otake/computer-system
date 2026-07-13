import { describe, expect, it } from "vitest";

import {
  bedrockCoreTextPayloadBytes,
  renderPlainTerminalRows,
  renderTerminalViewport,
  terminalViewportRows,
} from "../../src/application/terminal/viewport.js";
import {
  TerminalBuffer,
  type TerminalCell,
} from "../../src/domain/terminal/terminalBuffer.js";

describe("terminal viewport", (): void => {
  it("renders only seven rows so primary form controls stay above the fold", (): void => {
    const terminal = new TerminalBuffer();
    terminal.write("Computer System OS 0.1 (tty1)");
    terminal.setCursorPosition(1, 3);
    terminal.write("~$ ");

    const rows = renderTerminalViewport(cells(terminal), terminal).split("\n");

    expect(terminalViewportRows).toBe(7);
    expect(rows).toHaveLength(7);
    expect(rows[0]).toContain("Computer System OS 0.1 (tty1)");
    expect(rows[2]).toContain("~$");
  });

  it("follows the cursor while retaining the full nineteen-row buffer", (): void => {
    const terminal = new TerminalBuffer();
    terminal.write("old output");
    terminal.setCursorPosition(1, 12);
    terminal.write("latest output");

    const rows = renderTerminalViewport(cells(terminal), terminal).split("\n");

    expect(terminal.height).toBe(19);
    expect(rows).toHaveLength(7);
    expect(rows[0]).not.toContain("old output");
    expect(rows.at(-1)).toContain("latest output");
  });

  it("creates white-console rows that stay within the Bedrock Core payload limit", (): void => {
    const terminal = new TerminalBuffer();
    terminal.write("日本語".repeat(17));
    terminal.setCursorPosition(1, 2);
    terminal.write("cursor");
    terminal.setCursorPosition(1, 2);
    terminal.setCursorBlink(true);

    const rows = renderPlainTerminalRows(terminal);

    expect(rows).toHaveLength(terminal.height);
    expect(rows[1]?.startsWith("_ursor")).toBe(true);
    expect(
      rows.every(
        (row) => Buffer.byteLength(row, "utf8") <= bedrockCoreTextPayloadBytes,
      ),
    ).toBe(true);
  });
});

function cells(terminal: TerminalBuffer): TerminalCell[] {
  return Array.from({ length: terminal.width * terminal.height }, (_, index) =>
    terminal.cell(
      (index % terminal.width) + 1,
      Math.floor(index / terminal.width) + 1,
    ),
  );
}
