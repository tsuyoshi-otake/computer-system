import { describe, expect, it } from "vitest";

import {
  TerminalBuffer,
  TerminalError,
} from "../../src/domain/terminal/terminalBuffer.js";

describe("terminal cell buffer", (): void => {
  it("tracks fixed cells, colors, cursor position, and clipping", (): void => {
    const terminal = new TerminalBuffer(5, 2);
    terminal.setTextColor(3);
    terminal.setBackgroundColor(12);
    terminal.setCursorPosition(4, 1);
    terminal.write("abcd");

    expect(terminal.line(1)).toBe("   ab");
    expect(terminal.cell(4, 1)).toEqual({
      character: "a",
      foreground: 3,
      background: 12,
    });
    expect(terminal.cursorX).toBe(8);
    expect(terminal.cursorY).toBe(1);
  });

  it("clears with current colors and scrolls in both directions", (): void => {
    const terminal = new TerminalBuffer(3, 3);
    for (let row = 1; row <= 3; row += 1) {
      terminal.setCursorPosition(1, row);
      terminal.write(String(row).repeat(3));
    }
    terminal.setTextColor(2);
    terminal.setBackgroundColor(9);
    terminal.scroll(1);

    expect([terminal.line(1), terminal.line(2), terminal.line(3)]).toEqual([
      "222",
      "333",
      "   ",
    ]);
    expect(terminal.cell(1, 3)).toMatchObject({ foreground: 2, background: 9 });
    terminal.scroll(-1);
    expect([terminal.line(1), terminal.line(2), terminal.line(3)]).toEqual([
      "   ",
      "222",
      "333",
    ]);
    terminal.setCursorPosition(1, 2);
    terminal.clearLine();
    expect(terminal.line(2)).toBe("   ");
    terminal.clear();
    expect(terminal.line(3)).toBe("   ");
  });

  it("stores cursor blink and rejects invalid dimensions, coordinates, colors, and line breaks", (): void => {
    const terminal = new TerminalBuffer(2, 2);
    terminal.setCursorBlink(true);
    expect(terminal.cursorBlink).toBe(true);
    expect(() => new TerminalBuffer(0, 1)).toThrow(TerminalError);
    expect(() => new TerminalBuffer(201, 1)).toThrow(TerminalError);
    expect(() => terminal.setCursorPosition(0, 1)).toThrow(TerminalError);
    expect(() => terminal.setTextColor(16)).toThrow(TerminalError);
    expect(() => terminal.write("a\nb")).toThrow(TerminalError);
  });

  it("resizes while preserving overlapping cells and respecting bounds", (): void => {
    const terminal = new TerminalBuffer(3, 2, { maxHeight: 4, maxWidth: 6 });
    terminal.write("abc");
    terminal.setCursorPosition(3, 2);
    terminal.write("z");
    const revision = terminal.revision;

    terminal.resize(6, 4);

    expect(terminal.line(1).startsWith("abc")).toBe(true);
    expect(terminal.cell(3, 2).character).toBe("z");
    expect(terminal.revision).toBe(revision + 1);
    expect(() => terminal.resize(7, 4)).toThrow(TerminalError);
  });
  it("applies validated frames atomically and retains unchanged cells", (): void => {
    const terminal = new TerminalBuffer(3, 2);
    const rows = [
      [
        { background: 2, character: "A", foreground: 1 },
        { background: 15, character: " ", foreground: 0 },
      ],
      [],
    ] as const;
    const before = terminal.revision;

    expect(terminal.applyFrame(rows, { blink: true, x: 2, y: 1 })).toBe(1);
    expect(terminal.revision).toBe(before + 1);
    expect(terminal.cell(1, 1)).toEqual({
      background: 2,
      character: "A",
      foreground: 1,
    });
    const stableRevision = terminal.revision;
    expect(terminal.applyFrame(rows, { blink: true, x: 2, y: 1 })).toBe(0);
    expect(terminal.revision).toBe(stableRevision);

    expect(terminal.applyFrame(rows, { blink: true, x: 3, y: 1 })).toBe(0);
    expect(terminal.revision).toBe(stableRevision + 1);
    const snapshot = terminal.snapshot();
    expect(() =>
      terminal.applyFrame(
        [[{ background: 2, character: "\n", foreground: 1 }]],
        { blink: true, x: 1, y: 1 },
      ),
    ).toThrow(TerminalError);
    expect(terminal.snapshot()).toEqual(snapshot);
  });
});
