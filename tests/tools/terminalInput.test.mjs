import { describe, expect, it } from "vitest";

import {
  BoundedEditorKeyQueue,
  CompletionShelfController,
  editorKeyFromKeyboardEvent,
  hasCopySelection,
  insertPastedCommand,
  terminalInteractionFromTerminal,
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

  it("uses the authoritative interaction descriptor instead of screen text", () => {
    const interaction = {
      schema: 1,
      inputMode: "line",
      cursorShape: "block",
      pointer: "none",
      presentation: "terminal",
      secretInput: false,
      context: "shell",
      interrupt: false,
      history: true,
      hints: [{ key: "Enter", label: "Run" }],
    };

    for (const rows of [
      ["  File   Edit   Search   Options   Help "],
      ["plain shell output", "                         -- INSERT --"],
    ]) {
      expect(
        terminalInteractionFromTerminal({ interaction, rows }),
      ).toMatchObject({ inputMode: "line", presentation: "terminal" });
    }
  });

  it("accepts the key-only CS ABI foreground interaction", () => {
    expect(
      terminalInteractionFromTerminal({
        interaction: {
          ...interactionForValidation(),
          context: "cs-abi",
          history: false,
          inputMode: "keys",
          interrupt: true,
        },
      }),
    ).toMatchObject({
      context: "cs-abi",
      inputMode: "keys",
      interrupt: true,
      presentation: "terminal",
    });
  });

  it("fails closed for missing, unknown, or unbounded interaction schemas", () => {
    expect(() => terminalInteractionFromTerminal({ rows: [] })).toThrow(
      /interaction schema 1/u,
    );
    expect(() =>
      terminalInteractionFromTerminal({
        interaction: {
          schema: 2,
          inputMode: "keys",
          cursorShape: "block",
          pointer: "cell",
          presentation: "dos-tui",
          secretInput: false,
          context: "edit",
          interrupt: false,
          history: false,
          hints: [],
        },
      }),
    ).toThrow(/interaction schema 1/u);
    expect(() =>
      terminalInteractionFromTerminal({
        interaction: {
          schema: 1,
          inputMode: "keys",
          cursorShape: "block",
          pointer: "cell",
          presentation: "dos-tui",
          secretInput: false,
          context: "edit",
          interrupt: false,
          history: false,
          hints: Array.from({ length: 6 }, (_, index) => ({
            key: `F${String(index + 1)}`,
            label: "Action",
          })),
        },
      }),
    ).toThrow(/contextual hints/u);
    expect(() =>
      terminalInteractionFromTerminal({
        interaction: {
          ...interactionForValidation(),
          cursorShape: "beam",
        },
      }),
    ).toThrow(/cursor shape/u);
    expect(() =>
      terminalInteractionFromTerminal({
        interaction: {
          ...interactionForValidation(),
          history: true,
          secretInput: true,
        },
      }),
    ).toThrow(/history requires/u);
  });

  it("owns a bounded completion shelf through selection and acceptance", () => {
    const shelf = new CompletionShelfController();
    const ticket = shelf.begin("wh", 2);
    expect(shelf.state.kind).toBe("loading");

    expect(
      shelf.resolve(
        ticket,
        {
          candidates: [
            { displayText: "who", insertText: "who ", kind: "command" },
            {
              displayText: "whoami",
              insertText: "whoami ",
              kind: "command",
            },
          ],
          cursor: 2,
          replaceEnd: 2,
          replaceStart: 0,
          truncated: false,
          value: "wh",
        },
        "wh",
        2,
      ),
    ).toMatchObject({ outcome: "applied" });
    expect(shelf.state).toMatchObject({
      kind: "open",
      selected: 0,
      truncated: false,
    });
    expect(shelf.move(1)).toBe(true);
    expect(shelf.accept("wh", 2)).toEqual({
      cursor: 7,
      value: "whoami ",
    });
    expect(shelf.state.kind).toBe("closed");
  });

  it("discards late completion responses and reports invalid payloads", () => {
    const shelf = new CompletionShelfController();
    const dismissed = shelf.begin("ca", 2);
    shelf.dismiss();
    expect(shelf.resolve(dismissed, completionResponse(), "ca", 2)).toEqual({
      outcome: "stale",
    });

    const moved = shelf.begin("ca", 2);
    expect(shelf.resolve(moved, completionResponse(), "cat", 3)).toEqual({
      outcome: "stale",
    });
    expect(shelf.state.kind).toBe("closed");

    const invalid = shelf.begin("ca", 2);
    expect(
      shelf.resolve(
        invalid,
        {
          ...completionResponse(),
          candidates: [{ displayText: "cat", insertText: "", kind: "command" }],
        },
        "ca",
        2,
      ),
    ).toEqual({ outcome: "invalid" });
    expect(shelf.state).toMatchObject({
      kind: "message",
      message: "COMPLETION PROTOCOL ERROR",
      tone: "error",
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

function completionResponse() {
  return {
    candidates: [
      { displayText: "cat", insertText: "cat ", kind: "command" },
      { displayText: "case", insertText: "case ", kind: "command" },
    ],
    cursor: 2,
    replaceEnd: 2,
    replaceStart: 0,
    truncated: false,
    value: "ca",
  };
}

function interactionForValidation() {
  return {
    schema: 1,
    inputMode: "line",
    cursorShape: "block",
    pointer: "none",
    presentation: "terminal",
    secretInput: false,
    context: "shell",
    interrupt: false,
    history: true,
    hints: [],
  };
}
