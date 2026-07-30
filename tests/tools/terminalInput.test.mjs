import { describe, expect, it } from "vitest";

import {
  BoundedEditorKeyQueue,
  CompletionRequestController,
  SubmittedLineHandoffController,
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
      eof: false,
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

  it("accepts EOF only when the active source or REPL context advertises it", () => {
    expect(
      terminalInteractionFromTerminal({
        interaction: {
          ...interactionForValidation(),
          context: "python-repl",
          eof: true,
          history: false,
        },
      }),
    ).toMatchObject({ context: "python-repl", eof: true });
    expect(() =>
      terminalInteractionFromTerminal({
        interaction: { ...interactionForValidation(), eof: true },
      }),
    ).toThrow(/EOF input/u);
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
          eof: false,
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
          eof: false,
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

describe("submitted Web terminal line handoff", () => {
  it.each([
    ["CS-Linux", "printf ISSUE123-LINUX", "block"],
    ["CS-DOS", "ECHO ISSUE123-DOS", "underline"],
  ])(
    "retains an admitted %s command across stale and unrelated frames until its exact echo",
    (_profile, value, cursorShape) => {
      const controller = new SubmittedLineHandoffController();
      const baseline = terminalFrame({ cursorShape });
      const started = controller.begin({
        secretInput: false,
        terminal: baseline,
        value,
      });

      expect(started.outcome).toBe("started");
      expect(controller.accept(started.ticket, baseline)).toEqual({
        outcome: "pending",
      });
      expect(controller.presentation).toMatchObject({ value });

      const background = terminalFrame({
        cursorShape,
        rows: ["background job"],
        terminalRevision: 2,
      });
      expect(controller.observe(background)).toEqual({ outcome: "pending" });
      expect(controller.presentation).toMatchObject({ value });

      const echoed = terminalWithEcho(baseline, value, 3);
      expect(controller.observe(echoed)).toMatchObject({
        outcome: "echoed",
        presentation: { value },
      });
      expect(controller.pending).toBe(false);
      expect(controller.observe(echoed)).toEqual({ outcome: "idle" });
    },
  );

  it.each([
    ["Linux clear", "clear", "line", "terminal"],
    ["DOS CLS", "CLS", "line", "terminal"],
    ["Linux NetHack", "nethack", "keys", "terminal"],
    ["DOS EDIT", "EDIT C:\\ISSUE.TXT", "keys", "dos-tui"],
  ])(
    "hands %s directly to an authoritative clear, scroll, or full-screen replacement",
    (_scenario, value, inputMode, presentation) => {
      const controller = new SubmittedLineHandoffController();
      const baseline = terminalFrame();
      const started = controller.begin({
        secretInput: false,
        terminal: baseline,
        value,
      });
      expect(controller.accept(started.ticket, baseline)).toEqual({
        outcome: "pending",
      });

      const replaced = terminalFrame({
        inputMode,
        presentation,
        replacementEpoch: 1,
        rows: inputMode === "keys" ? ["File  Edit", "........", "Dlvl:1"] : [],
        terminalRevision: 2,
      });
      expect(controller.observe(replaced)).toMatchObject({
        outcome: "replaced",
        presentation: { value },
      });
      expect(controller.pending).toBe(false);
    },
  );

  it("matches an authoritative echo across the terminal's right edge", () => {
    const controller = new SubmittedLineHandoffController();
    const baseline = terminalFrame({ cursor: { blink: true, x: 15, y: 1 } });
    const started = controller.begin({
      secretInput: false,
      terminal: baseline,
      value: "abcdefg",
    });
    controller.accept(started.ticket, baseline);

    expect(
      controller.observe(terminalWithEcho(baseline, "abcxefg", 2)),
    ).toEqual({ outcome: "pending" });
    expect(
      controller.observe(terminalWithEcho(baseline, "abcdefg", 3)),
    ).toMatchObject({ outcome: "echoed" });
  });

  it("acknowledges an empty line only after the authoritative revision advances", () => {
    const controller = new SubmittedLineHandoffController();
    const baseline = terminalFrame();
    const started = controller.begin({
      secretInput: false,
      terminal: baseline,
      value: "",
    });

    expect(controller.accept(started.ticket, baseline)).toEqual({
      outcome: "pending",
    });
    expect(
      controller.observe(
        terminalFrame({
          cursor: { blink: true, x: 1, y: 2 },
          terminalRevision: 2,
        }),
      ),
    ).toMatchObject({ outcome: "advanced" });
  });

  it("never retains a secret and finalizes rejection, duplication, and disconnect explicitly", () => {
    const controller = new SubmittedLineHandoffController();
    const baseline = terminalFrame();
    expect(
      controller.begin({
        secretInput: true,
        terminal: baseline,
        value: "not-stored",
      }),
    ).toEqual({ outcome: "secret" });
    expect(controller.pending).toBe(false);

    const draft = "VER";
    const started = controller.begin({
      secretInput: false,
      terminal: baseline,
      value: draft,
    });
    expect(
      controller.begin({
        secretInput: false,
        terminal: baseline,
        value: "duplicate",
      }),
    ).toEqual({ outcome: "busy" });
    expect(controller.reject(started.ticket)).toBe(true);
    expect(draft).toBe("VER");
    expect(controller.pending).toBe(false);

    const next = controller.begin({
      secretInput: false,
      terminal: baseline,
      value: "nethack",
    });
    controller.accept(next.ticket, baseline);
    expect(controller.cancel()).toMatchObject({ value: "nethack" });
    expect(controller.pending).toBe(false);
  });

  it("fails closed when handoff counters are absent or unbounded", () => {
    const controller = new SubmittedLineHandoffController();
    const missing = terminalFrame();
    delete missing.replacementEpoch;
    expect(() => controller.observe(missing)).toThrow(/handoff state/u);
    expect(() =>
      controller.observe(
        terminalFrame({ terminalRevision: Number.MAX_SAFE_INTEGER + 1 }),
      ),
    ).toThrow(/handoff state/u);
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
    eof: false,
    secretInput: false,
    context: "shell",
    ctrlCAction: "abort-line",
    history: true,
    hints: [],
    interactionGeneration: 1,
  };
}

function terminalFrame(options = {}) {
  const width = 20;
  const height = 4;
  const inputMode = options.inputMode ?? "line";
  const presentation = options.presentation ?? "terminal";
  const keyInput = inputMode === "keys";
  const dosTui = presentation === "dos-tui";
  const rows = Array.from({ length: height }, (_, index) =>
    String(options.rows?.[index] ?? "")
      .padEnd(width, " ")
      .slice(0, width),
  );
  return {
    schema: 1,
    width,
    height,
    rows,
    cursor: options.cursor ?? { blink: true, x: 3, y: 1 },
    terminalRevision: options.terminalRevision ?? 1,
    replacementEpoch: options.replacementEpoch ?? 0,
    interaction: {
      ...interactionForValidation(),
      cursorShape: options.cursorShape ?? "block",
      inputMode,
      presentation,
      pointer: keyInput && dosTui ? "cell" : "none",
      context: keyInput ? (dosTui ? "edit" : "cs-abi") : "shell",
      ctrlCAction: keyInput
        ? dosTui
          ? "terminal-key"
          : "interrupt"
        : "abort-line",
      history: !keyInput,
    },
  };
}

function terminalWithEcho(baseline, value, terminalRevision) {
  const rows = baseline.rows.map((row) => [...row]);
  let x = baseline.cursor.x;
  let y = baseline.cursor.y;
  for (const character of [...value]) {
    if (x > baseline.width) {
      x = 1;
      y += 1;
    }
    rows[y - 1][x - 1] = character;
    x += 1;
  }
  return {
    ...baseline,
    rows: rows.map((row) => row.join("")),
    terminalRevision,
  };
}
