import { describe, expect, it } from "vitest";

import {
  BoundedEditorKeyQueue,
  CompletionRequestController,
  editorKeyFromKeyboardEvent,
  hasCopySelection,
  insertPastedCommand,
  isRetryableEditorInputError,
  resolveTerminalCtrlCAction,
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

  it("retries transient editor transport failures but not contract failures", () => {
    expect(isRetryableEditorInputError({ status: 429 })).toBe(true);
    expect(isRetryableEditorInputError({ code: "input_busy" })).toBe(true);
    expect(isRetryableEditorInputError({ status: 500 })).toBe(true);
    expect(isRetryableEditorInputError({ status: 503 })).toBe(true);
    expect(isRetryableEditorInputError({ status: 504 })).toBe(true);
    expect(isRetryableEditorInputError(new TypeError("fetch failed"))).toBe(
      true,
    );
    expect(isRetryableEditorInputError({ status: 409 })).toBe(false);
    expect(isRetryableEditorInputError(new Error("invalid input"))).toBe(false);
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
      schema: 2,
      inputMode: "line",
      cursorShape: "block",
      pointer: "none",
      presentation: "terminal",
      secretInput: false,
      context: "shell",
      ctrlCAction: "abort-line",
      history: true,
      hints: [{ key: "Enter", label: "Run" }],
      interactionGeneration: 4,
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
          ctrlCAction: "interrupt",
        },
      }),
    ).toMatchObject({
      context: "cs-abi",
      inputMode: "keys",
      ctrlCAction: "interrupt",
      presentation: "terminal",
    });
  });

  it("fails closed for missing, unknown, or unbounded interaction schemas", () => {
    expect(() => terminalInteractionFromTerminal({ rows: [] })).toThrow(
      /interaction schema 2/u,
    );
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
          ctrlCAction: "terminal-key",
          history: false,
          hints: [],
          interactionGeneration: 1,
        },
      }),
    ).toThrow(/interaction schema 2/u);
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
          ctrlCAction: "terminal-key",
          history: false,
          hints: Array.from({ length: 6 }, (_, index) => ({
            key: `F${String(index + 1)}`,
            label: "Action",
          })),
          interactionGeneration: 1,
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

  it("resolves Ctrl+C ownership before selection-based copy", () => {
    const interaction = interactionForValidation();
    expect(
      resolveTerminalCtrlCAction(
        { ...interaction, ctrlCAction: "interrupt", inputMode: "none" },
        { hasSelection: true },
      ),
    ).toBe("interrupt");
    expect(
      resolveTerminalCtrlCAction(interaction, { hasSelection: true }),
    ).toBe("copy");
    expect(
      resolveTerminalCtrlCAction(
        {
          ...interaction,
          ctrlCAction: "terminal-key",
          history: false,
          inputMode: "keys",
        },
        { hasSelection: true },
      ),
    ).toBe("terminal-key");
    expect(
      resolveTerminalCtrlCAction(
        { ...interaction, ctrlCAction: "cancel", secretInput: true },
        { hasSelection: true },
      ),
    ).toBe("cancel");
  });

  it("accepts only the bounded OS-owned completion response", () => {
    const request = new CompletionRequestController();
    const ticket = request.begin("wh", 2);
    expect(request.pending).toBe(true);
    expect(
      request.resolve(
        ticket,
        {
          cursor: 2,
          outcome: "listed",
          truncated: false,
          value: "wh",
        },
        "wh",
        2,
      ),
    ).toEqual({
      completion: {
        cursor: 2,
        outcome: "listed",
        truncated: false,
        value: "wh",
      },
      outcome: "resolved",
    });
    expect(request.pending).toBe(false);

    const mutatedNone = request.begin("ca", 2);
    expect(
      request.resolve(
        mutatedNone,
        {
          ...completionResponse(),
          outcome: "none",
          value: "cat",
        },
        "ca",
        2,
      ),
    ).toEqual({ outcome: "invalid" });
    expect(request.pending).toBe(false);
  });

  it("discards late completion responses and reports invalid payloads", () => {
    const request = new CompletionRequestController();
    const dismissed = request.begin("ca", 2);
    request.cancel();
    expect(request.resolve(dismissed, completionResponse(), "ca", 2)).toEqual({
      outcome: "stale",
    });

    const moved = request.begin("ca", 2);
    expect(request.resolve(moved, completionResponse(), "cat", 3)).toEqual({
      outcome: "stale",
    });
    expect(request.pending).toBe(false);

    const invalid = request.begin("ca", 2);
    expect(
      request.resolve(
        invalid,
        {
          ...completionResponse(),
          outcome: "listed",
          value: "cat",
        },
        "ca",
        2,
      ),
    ).toEqual({ outcome: "invalid" });
    expect(request.pending).toBe(false);
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
    cursor: 2,
    outcome: "listed",
    truncated: false,
    value: "ca",
  };
}

function interactionForValidation() {
  return {
    schema: 2,
    inputMode: "line",
    cursorShape: "block",
    pointer: "none",
    presentation: "terminal",
    secretInput: false,
    context: "shell",
    ctrlCAction: "abort-line",
    history: true,
    hints: [],
    interactionGeneration: 1,
  };
}
