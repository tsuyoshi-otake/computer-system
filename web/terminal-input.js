export function hasCopySelection(input, documentSelection) {
  return (
    input.selectionStart !== input.selectionEnd ||
    documentSelection?.isCollapsed === false
  );
}

const functionKeyPattern = /^F(?:[1-9]|1[0-2])$/u;
const navigationKeys = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
  "PageDown",
  "PageUp",
]);
const namedEditorKeys = new Set([
  ...navigationKeys,
  "Backspace",
  "Delete",
  "Enter",
  "Escape",
  "Insert",
  "Tab",
]);
const terminalInputModes = new Set(["keys", "line", "none"]);
const terminalCursorShapes = new Set(["block", "underline"]);
const terminalPointerModes = new Set(["cell", "none"]);
const terminalPresentationModes = new Set(["dos-tui", "terminal"]);
const terminalInteractionContexts = new Set([
  "busy",
  "cs-abi",
  "csasm",
  "edit",
  "less",
  "login",
  "more",
  "pwb",
  "qbasic",
  "secret",
  "shell",
  "unavailable",
  "vi-command",
  "vi-insert",
  "vi-normal",
  "vi-output",
]);
const maximumInteractionHints = 5;
const maximumInteractionHintKeyLength = 32;
const maximumInteractionHintLabelLength = 64;
export class TerminalInteractionProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "TerminalInteractionProtocolError";
    this.code = "interaction_protocol_mismatch";
  }
}

export function terminalInteractionFromTerminal(terminal) {
  const interaction = terminal?.interaction;
  if (
    interaction === null ||
    typeof interaction !== "object" ||
    Array.isArray(interaction) ||
    interaction.schema !== 1
  ) {
    throw new TerminalInteractionProtocolError(
      "This terminal frame does not provide interaction schema 1.",
    );
  }
  if (!terminalInputModes.has(interaction.inputMode)) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has an unsupported input mode.",
    );
  }
  if (!terminalCursorShapes.has(interaction.cursorShape)) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has an unsupported cursor shape.",
    );
  }
  if (typeof interaction.history !== "boolean") {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has an invalid history flag.",
    );
  }
  if (!terminalPointerModes.has(interaction.pointer)) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has an unsupported pointer mode.",
    );
  }
  if (!terminalPresentationModes.has(interaction.presentation)) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has an unsupported presentation mode.",
    );
  }
  if (!terminalInteractionContexts.has(interaction.context)) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has an unsupported interaction context.",
    );
  }
  if (
    typeof interaction.secretInput !== "boolean" ||
    typeof interaction.interrupt !== "boolean"
  ) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has invalid interaction flags.",
    );
  }
  if (
    interaction.helpTopicId !== undefined &&
    !boundedProtocolText(interaction.helpTopicId, 64)
  ) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has an invalid help topic.",
    );
  }
  if (
    !Array.isArray(interaction.hints) ||
    interaction.hints.length > maximumInteractionHints ||
    interaction.hints.some(
      (hint) =>
        hint === null ||
        typeof hint !== "object" ||
        Array.isArray(hint) ||
        !boundedProtocolText(hint.key, maximumInteractionHintKeyLength) ||
        !boundedProtocolText(hint.label, maximumInteractionHintLabelLength),
    )
  ) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has invalid contextual hints.",
    );
  }
  if (
    interaction.history &&
    (interaction.inputMode !== "line" || interaction.secretInput)
  ) {
    throw new TerminalInteractionProtocolError(
      "Terminal history requires non-secret line input.",
    );
  }
  if (
    interaction.pointer === "cell" &&
    (interaction.inputMode !== "keys" || interaction.presentation !== "dos-tui")
  ) {
    throw new TerminalInteractionProtocolError(
      "Cell pointer input requires DOS key input.",
    );
  }
  if (
    interaction.secretInput &&
    interaction.inputMode !== "line" &&
    interaction.inputMode !== "none"
  ) {
    throw new TerminalInteractionProtocolError(
      "Secret input requires line input.",
    );
  }
  return Object.freeze({
    ...interaction,
    hints: Object.freeze(
      interaction.hints.map((hint) =>
        Object.freeze({ key: hint.key, label: hint.label }),
      ),
    ),
  });
}

export function editorKeyFromKeyboardEvent(event) {
  const key = typeof event?.key === "string" ? event.key : "";
  if (
    event?.metaKey === true ||
    key === "Alt" ||
    key === "Control" ||
    key === "Meta" ||
    key === "Shift"
  ) {
    return undefined;
  }
  const functionKey = functionKeyPattern.test(key);
  if (event?.ctrlKey === true) {
    if (event?.altKey === true) return undefined;
    if (key === " ") return "Ctrl+Space";
    if ([...key].length === 1) {
      return event?.shiftKey === true
        ? `Ctrl+Shift+${key.toUpperCase()}`
        : `Ctrl+${key.toLowerCase()}`;
    }
    return functionKey || navigationKeys.has(key) ? `Ctrl+${key}` : undefined;
  }
  if (event?.altKey === true) {
    if ([...key].length === 1) return `Alt+${key.toLowerCase()}`;
    return functionKey || key === "ArrowLeft" ? `Alt+${key}` : undefined;
  }
  if (event?.shiftKey === true && (functionKey || navigationKeys.has(key))) {
    return `Shift+${key}`;
  }
  if (event?.shiftKey === true && key === "Tab") return "Shift+Tab";
  if (functionKey || namedEditorKeys.has(key)) return key;
  return [...key].length === 1 ? key : undefined;
}

export function insertPastedCommand(
  value,
  pastedText,
  selectionStart,
  selectionEnd,
  maximumLength,
) {
  const normalized = pastedText.replace(/\r\n?|\n/gu, " ");
  const start = clamp(selectionStart, 0, value.length);
  const end = clamp(selectionEnd, start, value.length);
  const prefix = value.slice(0, start);
  const suffix = value.slice(end);
  const available = Math.max(0, maximumLength - prefix.length - suffix.length);
  const inserted = normalized.slice(0, available);
  return {
    cursor: prefix.length + inserted.length,
    value: `${prefix}${inserted}${suffix}`,
  };
}

const maximumCompletionCandidates = 64;
const maximumCompletionLineLength = 128;
const completionCandidateKinds = new Set([
  "command",
  "device",
  "directory",
  "file",
]);

export class CompletionShelfController {
  #generation = 0;
  #state = Object.freeze({ generation: 0, kind: "closed" });

  get state() {
    return this.#state;
  }

  begin(value, cursor) {
    requireCompletionLine(value, cursor);
    this.#generation += 1;
    const ticket = Object.freeze({
      cursor,
      generation: this.#generation,
      value,
    });
    this.#state = Object.freeze({ ...ticket, kind: "loading" });
    return ticket;
  }

  resolve(ticket, result, currentValue, currentCursor) {
    if (!this.#owns(ticket)) return { outcome: "stale" };
    if (ticket.value !== currentValue || ticket.cursor !== currentCursor) {
      this.#state = Object.freeze({
        generation: this.#generation,
        kind: "closed",
      });
      return { outcome: "stale" };
    }
    const completion = normalizedCompletionResult(result, ticket);
    if (completion === undefined) {
      this.#state = Object.freeze({
        generation: this.#generation,
        kind: "message",
        message: "COMPLETION PROTOCOL ERROR",
        tone: "error",
      });
      return { outcome: "invalid" };
    }
    if (completion.candidates.length === 0) {
      this.#state = Object.freeze({
        generation: this.#generation,
        kind: "message",
        message: completion.truncated
          ? "MATCHES EXCEED INPUT LIMIT"
          : "NO MATCHES",
        tone: completion.truncated ? "error" : "muted",
      });
      return { completion, outcome: "empty" };
    }
    if (completion.candidates.length === 1) {
      this.#state = Object.freeze({
        generation: this.#generation,
        kind: "closed",
      });
      return { completion, outcome: "applied" };
    }
    this.#state = Object.freeze({
      candidates: completion.candidates,
      cursor: completion.cursor,
      generation: this.#generation,
      kind: "open",
      replaceEnd: completion.replaceEnd,
      replaceStart: completion.replaceStart,
      requestValue: ticket.value,
      selected: 0,
      truncated: completion.truncated,
      value: completion.value,
    });
    return { completion, outcome: "applied" };
  }

  fail(ticket, currentValue, currentCursor) {
    if (!this.#owns(ticket)) return false;
    if (ticket.value !== currentValue || ticket.cursor !== currentCursor) {
      this.#state = Object.freeze({
        generation: this.#generation,
        kind: "closed",
      });
      return false;
    }
    this.#state = Object.freeze({
      generation: this.#generation,
      kind: "message",
      message: "COMPLETION UNAVAILABLE",
      tone: "error",
    });
    return true;
  }

  move(offset) {
    if (
      this.#state.kind !== "open" ||
      !Number.isSafeInteger(offset) ||
      offset === 0
    ) {
      return false;
    }
    const selected =
      (this.#state.selected + offset + this.#state.candidates.length) %
      this.#state.candidates.length;
    this.#state = Object.freeze({ ...this.#state, selected });
    return true;
  }

  select(index) {
    if (
      this.#state.kind !== "open" ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= this.#state.candidates.length
    ) {
      return false;
    }
    this.#state = Object.freeze({ ...this.#state, selected: index });
    return true;
  }

  accept(currentValue, currentCursor) {
    if (
      this.#state.kind !== "open" ||
      currentValue !== this.#state.value ||
      currentCursor !== this.#state.cursor
    ) {
      this.dismiss();
      return undefined;
    }
    const candidate = this.#state.candidates[this.#state.selected];
    const value = `${this.#state.requestValue.slice(
      0,
      this.#state.replaceStart,
    )}${candidate.insertText}${this.#state.requestValue.slice(
      this.#state.replaceEnd,
    )}`;
    const cursor = this.#state.replaceStart + candidate.insertText.length;
    this.#state = Object.freeze({
      generation: this.#generation,
      kind: "closed",
    });
    return { cursor, value };
  }

  dismiss() {
    this.#generation += 1;
    this.#state = Object.freeze({
      generation: this.#generation,
      kind: "closed",
    });
  }

  #owns(ticket) {
    return (
      ticket !== null &&
      typeof ticket === "object" &&
      ticket.generation === this.#generation &&
      this.#state.kind === "loading"
    );
  }
}

function normalizedCompletionResult(result, ticket) {
  if (
    result === null ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    typeof result.value !== "string" ||
    result.value.length > maximumCompletionLineLength ||
    /[\0\r\n]/u.test(result.value) ||
    !Number.isSafeInteger(result.cursor) ||
    result.cursor < 0 ||
    result.cursor > result.value.length ||
    !Number.isSafeInteger(result.replaceStart) ||
    !Number.isSafeInteger(result.replaceEnd) ||
    result.replaceStart < 0 ||
    result.replaceStart > result.replaceEnd ||
    result.replaceEnd !== ticket.cursor ||
    result.replaceEnd > ticket.value.length ||
    typeof result.truncated !== "boolean" ||
    !Array.isArray(result.candidates) ||
    result.candidates.length > maximumCompletionCandidates
  ) {
    return undefined;
  }
  const candidates = [];
  for (const candidate of result.candidates) {
    if (
      candidate === null ||
      typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      !boundedCompletionText(candidate.displayText) ||
      !boundedCompletionText(candidate.insertText) ||
      !completionCandidateKinds.has(candidate.kind)
    ) {
      return undefined;
    }
    const completedValue = `${ticket.value.slice(
      0,
      result.replaceStart,
    )}${candidate.insertText}${ticket.value.slice(result.replaceEnd)}`;
    if (completedValue.length > maximumCompletionLineLength) return undefined;
    candidates.push(
      Object.freeze({
        displayText: candidate.displayText,
        insertText: candidate.insertText,
        kind: candidate.kind,
      }),
    );
  }
  return Object.freeze({
    candidates: Object.freeze(candidates),
    cursor: result.cursor,
    replaceEnd: result.replaceEnd,
    replaceStart: result.replaceStart,
    truncated: result.truncated,
    value: result.value,
  });
}

function boundedCompletionText(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumCompletionLineLength &&
    !/[\0\r\n]/u.test(value)
  );
}

function requireCompletionLine(value, cursor) {
  if (
    typeof value !== "string" ||
    value.length > maximumCompletionLineLength ||
    /[\0\r\n]/u.test(value) ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > value.length
  ) {
    throw new RangeError("Completion input is out of range");
  }
}

export class BoundedEditorKeyQueue {
  #capacity;
  #head = 0;
  #values = [];

  constructor(capacity = 1_024) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new RangeError(
        "Editor key queue capacity must be a positive integer",
      );
    }
    this.#capacity = capacity;
  }

  get capacity() {
    return this.#capacity;
  }

  get length() {
    return this.#values.length - this.#head;
  }

  enqueue(keys) {
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
      throw new TypeError("Editor keys must be an array of strings");
    }
    const available = this.#capacity - this.length;
    if (keys.length > available) {
      return { available, outcome: "rejected", requested: keys.length };
    }
    this.#values.push(...keys);
    return { available: available - keys.length, outcome: "accepted" };
  }

  peekBatch(maximumCount = 16, maximumEncodedLength = 180) {
    if (!Number.isSafeInteger(maximumCount) || maximumCount <= 0) {
      throw new RangeError("Editor key batch size must be a positive integer");
    }
    if (
      !Number.isSafeInteger(maximumEncodedLength) ||
      maximumEncodedLength <= 0
    ) {
      throw new RangeError("Editor key relay limit must be a positive integer");
    }
    let count = Math.min(maximumCount, this.length);
    let batch = this.#values.slice(this.#head, this.#head + count);
    while (
      count > 1 &&
      encodeURIComponent(JSON.stringify(batch)).length > maximumEncodedLength
    ) {
      count -= 1;
      batch = this.#values.slice(this.#head, this.#head + count);
    }
    if (
      batch.length > 0 &&
      encodeURIComponent(JSON.stringify(batch)).length > maximumEncodedLength
    ) {
      throw new RangeError("One editor key exceeds the relay limit");
    }
    return batch;
  }

  acknowledge(batch) {
    if (
      !Array.isArray(batch) ||
      batch.length === 0 ||
      batch.length > this.length
    ) {
      throw new RangeError("Editor key acknowledgement is out of range");
    }
    for (let index = 0; index < batch.length; index += 1) {
      if (this.#values[this.#head + index] !== batch[index]) {
        throw new Error("Editor key acknowledgement is out of order");
      }
    }
    this.#head += batch.length;
    if (this.#head >= 128 && this.#head >= this.length) {
      this.#values = this.#values.slice(this.#head);
      this.#head = 0;
    }
    return this.length;
  }

  discard() {
    const discarded = this.length;
    this.#values = [];
    this.#head = 0;
    return discarded;
  }
}
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundedProtocolText(value, maximumLength) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\0\r\n]/u.test(value)
  );
}
