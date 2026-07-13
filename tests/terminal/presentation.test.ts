import { describe, expect, it } from "vitest";

import {
  computerCraftPalette,
  productionTerminalContract,
  TerminalPresentation,
} from "../../src/application/terminal/presentation.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

describe("production terminal presentation", (): void => {
  it("defines the fixed 51x19 non-scrolling primary-control contract", (): void => {
    expect(productionTerminalContract).toMatchObject({
      width: 51,
      height: 19,
      viewportRows: 7,
      primaryControls: ["input", "submit", "terminate"],
      primaryControlsScroll: false,
      dismissal: "system_back",
    });
    expect(computerCraftPalette).toHaveLength(16);
    expect(new Set(computerCraftPalette).size).toBe(16);
  });

  it("renders exact fixed rows and cursor state", (): void => {
    const terminal = new TerminalBuffer();
    terminal.setCursorPosition(1, 1);
    terminal.write("Computer System OS");
    terminal.setCursorPosition(4, 2);
    terminal.setCursorBlink(true);
    const frame = new TerminalPresentation(terminal).frame();

    expect(frame.width).toBe(51);
    expect(frame.height).toBe(19);
    expect(frame.rows).toHaveLength(19);
    expect(frame.rows.every((row) => [...row].length === 51)).toBe(true);
    expect(frame.rows[0]).toMatch(/^Computer System OS/u);
    expect(frame.cursor).toEqual({ x: 4, y: 2, blink: true });
  });

  it("coalesces repeated cell changes and flushes within a strict budget", (): void => {
    const terminal = new TerminalBuffer(4, 2);
    const presentation = new TerminalPresentation(terminal);
    expect(presentation.capture()).toBe(8);
    expect(presentation.flush(8).remaining).toBe(0);

    terminal.setCursorPosition(1, 1);
    terminal.write("a");
    terminal.setCursorPosition(1, 1);
    terminal.write("b");
    terminal.setCursorPosition(2, 1);
    terminal.write("c");
    expect(presentation.capture()).toBe(2);

    const first = presentation.flush(1);
    expect(first.changes).toEqual([
      { x: 1, y: 1, character: "b", foreground: 0, background: 15 },
    ]);
    expect(first.remaining).toBe(1);
    expect(presentation.flush(1)).toMatchObject({ remaining: 0 });
  });

  it("fails explicitly instead of silently dropping redraw work", (): void => {
    const terminal = new TerminalBuffer(3, 1);
    const presentation = new TerminalPresentation(terminal, 2);
    expect(() => presentation.capture()).toThrow(/capacity exceeded/u);
  });
});
