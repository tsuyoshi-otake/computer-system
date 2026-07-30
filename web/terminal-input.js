export function hasCopySelection(input, documentSelection) {
  return (
    input.selectionStart !== input.selectionEnd ||
    documentSelection?.isCollapsed === false
  );
}

export function isRetryableEditorInputError(error) {
  const status = error?.status;
  return (
    error?.code === "input_busy" ||
    status === 429 ||
    (Number.isSafeInteger(status) && status >= 500 && status <= 599) ||
    (status === undefined && error instanceof TypeError)
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
const terminalCtrlCActions = new Set([
  "abort-line",
  "cancel",
  "interrupt",
  "none",
  "terminal-key",
]);
const terminalInteractionContexts = new Set([
  "busy",
  "cs-abi",
  "csasm",
  "edit",
  "less",
  "login",
  "more",
  "perl-source",
  "pwb",
  "python-repl",
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
    interaction.schema !== 2
  ) {
    throw new TerminalInteractionProtocolError(
      "This terminal frame does not provide interaction schema 2.",
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
    typeof interaction.eof !== "boolean" ||
    typeof interaction.secretInput !== "boolean" ||
    !terminalCtrlCActions.has(interaction.ctrlCAction) ||
    !Number.isSafeInteger(interaction.interactionGeneration) ||
    interaction.interactionGeneration < 0
  ) {
    throw new TerminalInteractionProtocolError(
      "The terminal frame has invalid interaction flags.",
    );
  }
  if (
    interaction.eof &&
    interaction.context !== "perl-source" &&
    interaction.context !== "python-repl"
  ) {
    throw new TerminalInteractionProtocolError(
      "EOF input is unavailable in this terminal context.",
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
  if (
    interaction.ctrlCAction === "abort-line" &&
    (interaction.inputMode !== "line" || interaction.secretInput)
  ) {
    throw new TerminalInteractionProtocolError(
      "Line abort requires non-secret line input.",
    );
  }
  if (
    interaction.ctrlCAction === "cancel" &&
    interaction.inputMode !== "line" &&
    interaction.inputMode !== "keys"
  ) {
    throw new TerminalInteractionProtocolError(
      "Cancellation requires interactive input.",
    );
  }
  if (
    interaction.ctrlCAction === "terminal-key" &&
    interaction.inputMode !== "keys"
  ) {
    throw new TerminalInteractionProtocolError(
      "Terminal-owned Ctrl+C requires key input.",
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

export function resolveTerminalCtrlCAction(
  interaction,
  { hasSelection = false, metaKey = false } = {},
) {
  if (interaction?.secretInput === true) {
    return !metaKey && interaction.ctrlCAction === "cancel" ? "cancel" : "none";
  }
  if (metaKey) return "copy";
  if (
    hasSelection &&
    (interaction?.ctrlCAction === "abort-line" ||
      interaction?.ctrlCAction === "cancel" ||
      interaction?.ctrlCAction === "none")
  ) {
    return "copy";
  }
  return terminalCtrlCActions.has(interaction?.ctrlCAction)
    ? interaction.ctrlCAction
    : "none";
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

const maximumSubmittedLineLength = 128;

/**
 * Keeps one admitted, non-secret line visible until the guest terminal either
 * echoes it or performs an authoritative destructive presentation operation.
 */
export class SubmittedLineHandoffController {
  #generation = 0;
  #pending;

  get pending() {
    return this.#pending !== undefined;
  }

  get presentation() {
    return this.#pending?.ticket.presentation;
  }

  begin({ secretInput = false, terminal, value }) {
    requireSubmittedLine(value);
    if (this.#pending !== undefined) return { outcome: "busy" };
    if (secretInput) return { outcome: "secret" };
    const frame = terminalSubmissionFrame(terminal);
    this.#generation += 1;
    const presentation = Object.freeze({
      anchor: Object.freeze({ x: frame.cursorX, y: frame.cursorY }),
      value,
    });
    const ticket = Object.freeze({
      baseReplacementEpoch: frame.replacementEpoch,
      baseTerminalRevision: frame.terminalRevision,
      generation: this.#generation,
      presentation,
    });
    this.#pending = { accepted: false, ticket };
    return { outcome: "started", ticket };
  }

  accept(ticket, terminal) {
    if (!this.#owns(ticket)) return { outcome: "stale" };
    this.#pending.accepted = true;
    return this.observe(terminal);
  }

  reject(ticket) {
    if (!this.#owns(ticket)) return false;
    this.#generation += 1;
    this.#pending = undefined;
    return true;
  }

  observe(terminal) {
    const frame = terminalSubmissionFrame(terminal);
    const pending = this.#pending;
    if (pending === undefined) return { outcome: "idle" };
    if (!pending.accepted) return { outcome: "pending" };
    const { ticket } = pending;
    if (
      frame.terminalRevision < ticket.baseTerminalRevision ||
      frame.replacementEpoch < ticket.baseReplacementEpoch
    ) {
      return { outcome: "pending" };
    }
    if (frame.replacementEpoch > ticket.baseReplacementEpoch) {
      return this.#complete("replaced");
    }
    if (frame.terminalRevision <= ticket.baseTerminalRevision) {
      return { outcome: "pending" };
    }
    if (ticket.presentation.value.length === 0) {
      return this.#complete("advanced");
    }
    if (submittedLineMatches(ticket.presentation, terminal)) {
      return this.#complete("echoed");
    }
    return { outcome: "pending" };
  }

  cancel() {
    const ticket = this.#pending?.ticket;
    this.#generation += 1;
    this.#pending = undefined;
    return ticket?.presentation;
  }

  #complete(outcome) {
    const presentation = this.#pending.ticket.presentation;
    this.#generation += 1;
    this.#pending = undefined;
    return { outcome, presentation };
  }

  #owns(ticket) {
    return (
      ticket !== null &&
      typeof ticket === "object" &&
      ticket.generation === this.#generation &&
      this.#pending?.ticket === ticket
    );
  }
}

function terminalSubmissionFrame(terminal) {
  if (
    terminal === null ||
    typeof terminal !== "object" ||
    !Number.isSafeInteger(terminal.width) ||
    terminal.width <= 0 ||
    terminal.width > 200 ||
    !Number.isSafeInteger(terminal.height) ||
    terminal.height <= 0 ||
    terminal.height > 100 ||
    !Array.isArray(terminal.rows) ||
    terminal.rows.length !== terminal.height ||
    terminal.rows.some(
      (row) => typeof row !== "string" || [...row].length !== terminal.width,
    ) ||
    !Number.isSafeInteger(terminal.cursor?.x) ||
    terminal.cursor.x <= 0 ||
    !Number.isSafeInteger(terminal.cursor?.y) ||
    terminal.cursor.y <= 0 ||
    terminal.cursor.y > terminal.height ||
    !Number.isSafeInteger(terminal.terminalRevision) ||
    terminal.terminalRevision < 0 ||
    !Number.isSafeInteger(terminal.replacementEpoch) ||
    terminal.replacementEpoch < 0
  ) {
    throw new TerminalInteractionProtocolError(
      "This terminal frame does not provide bounded submission handoff state.",
    );
  }
  return {
    cursorX: terminal.cursor.x,
    cursorY: terminal.cursor.y,
    replacementEpoch: terminal.replacementEpoch,
    terminalRevision: terminal.terminalRevision,
  };
}

function submittedLineMatches(presentation, terminal) {
  let x = presentation.anchor.x;
  let y = presentation.anchor.y;
  let rowCharacters;
  let rowY = 0;
  for (const character of [...presentation.value]) {
    if (x > terminal.width) {
      x = 1;
      y += 1;
    }
    if (y > terminal.height) return false;
    if (rowY !== y) {
      rowCharacters = [...terminal.rows[y - 1]];
      rowY = y;
    }
    if (rowCharacters[x - 1] !== character) {
      return false;
    }
    x += 1;
  }
  return true;
}

function requireSubmittedLine(value) {
  if (
    typeof value !== "string" ||
    value.length > maximumSubmittedLineLength ||
    /[\0\r\n]/u.test(value)
  ) {
    throw new RangeError("Submitted terminal line is out of range");
  }
}

const maximumCompletionLineLength = 128;
const completionOutcomes = new Set(["applied", "listed", "none"]);

export class CompletionRequestController {
  #generation = 0;
  #pending;

  get pending() {
    return this.#pending !== undefined;
  }

  begin(value, cursor) {
    requireCompletionLine(value, cursor);
    this.#generation += 1;
    const ticket = Object.freeze({
      cursor,
      generation: this.#generation,
      value,
    });
    this.#pending = ticket;
    return ticket;
  }

  resolve(ticket, result, currentValue, currentCursor) {
    if (!this.#owns(ticket)) return { outcome: "stale" };
    if (ticket.value !== currentValue || ticket.cursor !== currentCursor) {
      this.#pending = undefined;
      return { outcome: "stale" };
    }
    const completion = normalizedCompletionResult(result, ticket);
    this.#pending = undefined;
    if (completion === undefined) {
      return { outcome: "invalid" };
    }
    return { completion, outcome: "resolved" };
  }

  fail(ticket, currentValue, currentCursor) {
    if (!this.#owns(ticket)) return false;
    this.#pending = undefined;
    return ticket.value === currentValue && ticket.cursor === currentCursor;
  }

  cancel() {
    this.#generation += 1;
    this.#pending = undefined;
  }

  #owns(ticket) {
    return (
      ticket !== null &&
      typeof ticket === "object" &&
      ticket.generation === this.#generation &&
      this.#pending === ticket
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
    !completionOutcomes.has(result.outcome) ||
    typeof result.truncated !== "boolean" ||
    ((result.outcome === "listed" || result.outcome === "none") &&
      (result.value !== ticket.value || result.cursor !== ticket.cursor))
  ) {
    return undefined;
  }
  return Object.freeze({
    cursor: result.cursor,
    outcome: result.outcome,
    truncated: result.truncated,
    value: result.value,
  });
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
