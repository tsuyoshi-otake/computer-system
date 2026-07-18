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
const dosEditorMenuPattern =
  /^ {1,2}File\s+Edit\s+(?:(?:View\s+)?Search\s+(?:Make\s+)?(?:Run\s+)?(?:Debug\s+)?)?Options\s+Help/u;
const viModePattern = /^-- (?:COMMAND|INSERT|NORMAL) --/u;
const keyboardLockModifiers = {
  capsLock: "CapsLock",
  numLock: "NumLock",
  scrollLock: "ScrollLock",
};

export function isEditorTerminalScreen(rows) {
  if (!Array.isArray(rows)) return false;
  if (
    rows.some(
      (row) => typeof row === "string" && viModePattern.test(row.trimStart()),
    )
  ) {
    return true;
  }
  return dosEditorMenuPattern.test(typeof rows[0] === "string" ? rows[0] : "");
}

export function keyboardLockStatesFromEvent(event) {
  if (typeof event?.getModifierState !== "function") {
    return {
      capsLock: "unknown",
      numLock: "unknown",
      scrollLock: "unknown",
    };
  }
  return Object.fromEntries(
    Object.entries(keyboardLockModifiers).map(([name, modifier]) => [
      name,
      event.getModifierState(modifier) ? "on" : "off",
    ]),
  );
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
