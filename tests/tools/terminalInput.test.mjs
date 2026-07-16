import { describe, expect, it } from "vitest";

import {
  hasCopySelection,
  insertPastedCommand,
} from "../../web/terminal-input.js";

describe("Web terminal input helpers", () => {
  it("preserves native copy when either input or terminal output is selected", () => {
    expect(
      hasCopySelection(
        { selectionStart: 1, selectionEnd: 3 },
        { isCollapsed: true },
      ),
    ).toBe(true);
    expect(
      hasCopySelection(
        { selectionStart: 2, selectionEnd: 2 },
        { isCollapsed: false },
      ),
    ).toBe(true);
    expect(
      hasCopySelection(
        { selectionStart: 2, selectionEnd: 2 },
        { isCollapsed: true },
      ),
    ).toBe(false);
  });

  it("inserts plain text at the current selection without auto-submitting", () => {
    expect(insertPastedCommand("echo old", "new", 5, 8, 128)).toEqual({
      cursor: 8,
      value: "echo new",
    });
  });

  it("normalizes multiline paste and enforces the terminal line bound", () => {
    expect(insertPastedCommand("", "one\r\ntwo\nthree", 0, 0, 128)).toEqual({
      cursor: 13,
      value: "one two three",
    });
    expect(insertPastedCommand("abcd", "123456", 2, 2, 8)).toEqual({
      cursor: 6,
      value: "ab1234cd",
    });
  });
});
