import { describe, expect, it } from "vitest";

import {
  BoundedEditorKeyQueue,
  editorKeyFromKeyboardEvent,
  hasCopySelection,
  insertPastedCommand,
  isEditorTerminalScreen,
  keyboardLockStatesFromEvent,
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

  it("maps every DOS IDE accelerator without dropping modifiers", () => {
    const key = (
      value,
      {
        altKey = false,
        ctrlKey = false,
        metaKey = false,
        shiftKey = false,
      } = {},
    ) =>
      editorKeyFromKeyboardEvent({
        altKey,
        ctrlKey,
        key: value,
        metaKey,
        shiftKey,
      });

    expect(key("f", { altKey: true })).toBe("Alt+f");
    expect(key("F7", { altKey: true })).toBe("Alt+F7");
    expect(key("ArrowLeft", { altKey: true })).toBe("Alt+ArrowLeft");
    expect(key("s", { ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+S");
    expect(key("o", { ctrlKey: true, shiftKey: true })).toBe("Ctrl+Shift+O");
    expect(key(" ", { ctrlKey: true })).toBe("Ctrl+Space");
    expect(key("F5", { ctrlKey: true })).toBe("Ctrl+F5");
    expect(key("F5", { shiftKey: true })).toBe("Shift+F5");
    expect(key("ArrowRight", { shiftKey: true })).toBe("Shift+ArrowRight");
    expect(key("Tab", { shiftKey: true })).toBe("Shift+Tab");
    expect(key("F4")).toBe("F4");
    expect(key("F12")).toBe("F12");
    expect(key("A", { shiftKey: true })).toBe("A");
    expect(key("f", { ctrlKey: true, metaKey: true })).toBeUndefined();
  });

  it("recognizes the actual EDIT, WorkBench, and vi screen contracts", () => {
    expect(
      isEditorTerminalScreen(["  File   Edit   Search   Options   Help "]),
    ).toBe(true);
    expect(
      isEditorTerminalScreen([
        " File Edit View Search Run Options                         Help ",
      ]),
    ).toBe(true);
    expect(
      isEditorTerminalScreen([
        "plain shell output",
        "                         -- INSERT --",
      ]),
    ).toBe(true);
    expect(
      isEditorTerminalScreen([
        "File Edit Search Options Help",
        "C:\\>echo normal terminal output",
      ]),
    ).toBe(false);
    expect(isEditorTerminalScreen(undefined)).toBe(false);
  });

  it("reports keyboard lock state without inventing unavailable browser state", () => {
    const active = new Set(["CapsLock", "ScrollLock"]);
    expect(
      keyboardLockStatesFromEvent({
        getModifierState: (modifier) => active.has(modifier),
      }),
    ).toEqual({
      capsLock: "on",
      numLock: "off",
      scrollLock: "on",
    });
    expect(keyboardLockStatesFromEvent({})).toEqual({
      capsLock: "unknown",
      numLock: "unknown",
      scrollLock: "unknown",
    });
  });

  it("admits editor keys atomically and removes them only after ordered acknowledgement", () => {
    const queue = new BoundedEditorKeyQueue(4);

    expect(queue.enqueue(["a", "b", "c"])).toEqual({
      available: 1,
      outcome: "accepted",
    });
    expect(queue.enqueue(["d", "e"])).toEqual({
      available: 1,
      outcome: "rejected",
      requested: 2,
    });
    expect(queue.length).toBe(3);
    expect(queue.peekBatch(2)).toEqual(["a", "b"]);
    expect(() => queue.acknowledge(["b"])).toThrow(/out of order/u);
    expect(queue.length).toBe(3);
    expect(queue.acknowledge(["a", "b"])).toBe(1);
    expect(queue.peekBatch()).toEqual(["c"]);
  });

  it("bounds encoded editor batches and explicitly discards retained work", () => {
    const queue = new BoundedEditorKeyQueue();
    expect(
      queue.enqueue(Array.from({ length: 33 }, () => "Ctrl+Shift+S")),
    ).toMatchObject({
      outcome: "accepted",
    });

    const batch = queue.peekBatch();
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThanOrEqual(16);
    expect(
      encodeURIComponent(JSON.stringify(batch)).length,
    ).toBeLessThanOrEqual(180);
    expect(queue.discard()).toBe(33);
    expect(queue.length).toBe(0);
  });
});
