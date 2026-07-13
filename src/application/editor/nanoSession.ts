export type NanoEditorState = "editing" | "closed";

export interface NanoEditorSnapshot {
  readonly fileName: string;
  readonly lines: readonly string[];
  readonly currentLine: number;
  readonly dirty: boolean;
  readonly revision: number;
  readonly state: NanoEditorState;
  readonly status: string;
}

export interface NanoVisibleRow {
  readonly lineNumber: number;
  readonly text: string;
  readonly active: boolean;
}

export type NanoEditorResult =
  | { readonly kind: "continue"; readonly snapshot: NanoEditorSnapshot }
  | { readonly kind: "saved"; readonly snapshot: NanoEditorSnapshot }
  | {
      readonly kind: "blocked";
      readonly reason: "unsaved_changes";
      readonly snapshot: NanoEditorSnapshot;
    }
  | {
      readonly kind: "closed";
      readonly saved: boolean;
      readonly discardedChanges: boolean;
      readonly snapshot: NanoEditorSnapshot;
    };

export class NanoEditorSession {
  readonly #fileName: string;
  readonly #lines: string[];
  #currentLine = 0;
  #dirty = false;
  #revision = 0;
  #state: NanoEditorState = "editing";
  #status = "Enter edits the current line and advances.";

  constructor(fileName: string, contents: string) {
    this.#fileName = fileName;
    this.#lines = contents.replaceAll("\r\n", "\n").split("\n");
    if (this.#lines.length === 0) this.#lines.push("");
  }

  get snapshot(): NanoEditorSnapshot {
    return {
      fileName: this.#fileName,
      lines: [...this.#lines],
      currentLine: this.#currentLine,
      dirty: this.#dirty,
      revision: this.#revision,
      state: this.#state,
      status: this.#status,
    };
  }

  visibleRows(maxRows = 12): readonly NanoVisibleRow[] {
    if (!Number.isInteger(maxRows) || maxRows < 1)
      throw new RangeError("maxRows must be a positive integer");

    const half = Math.floor(maxRows / 2);
    const lastStart = Math.max(0, this.#lines.length - maxRows);
    const start = Math.min(Math.max(0, this.#currentLine - half), lastStart);
    return this.#lines.slice(start, start + maxRows).map((text, index) => ({
      lineNumber: start + index + 1,
      text,
      active: start + index === this.#currentLine,
    }));
  }

  submit(value: string): NanoEditorResult {
    this.#assertEditing();
    const command = value.trim();

    if (command === ":w") return this.#save();
    if (command === ":wq") {
      this.#save();
      return this.#close(true, false);
    }
    if (command === ":q") {
      if (this.#dirty) {
        this.#status = "Unsaved changes. Use :w, :wq, or :q!";
        return {
          kind: "blocked",
          reason: "unsaved_changes",
          snapshot: this.snapshot,
        };
      }
      return this.#close(false, false);
    }
    if (command === ":q!") return this.#close(false, this.#dirty);
    if (command === ":up") {
      this.#currentLine = Math.max(0, this.#currentLine - 1);
      this.#status = `Line ${this.#currentLine + 1}`;
      return { kind: "continue", snapshot: this.snapshot };
    }
    if (command === ":down") {
      this.#currentLine = Math.min(
        this.#lines.length - 1,
        this.#currentLine + 1,
      );
      this.#status = `Line ${this.#currentLine + 1}`;
      return { kind: "continue", snapshot: this.snapshot };
    }

    const previous = this.#lines[this.#currentLine] ?? "";
    if (previous !== value) {
      this.#lines[this.#currentLine] = value;
      this.#dirty = true;
    }
    if (this.#currentLine === this.#lines.length - 1) this.#lines.push("");
    this.#currentLine += 1;
    this.#status = `Editing line ${this.#currentLine + 1}`;
    return { kind: "continue", snapshot: this.snapshot };
  }

  cancel(): NanoEditorResult {
    this.#assertEditing();
    return this.#close(false, this.#dirty);
  }

  #save(): NanoEditorResult {
    this.#revision += 1;
    this.#dirty = false;
    this.#status = `Wrote ${this.#lines.length} lines to ${this.#fileName}`;
    return { kind: "saved", snapshot: this.snapshot };
  }

  #close(saved: boolean, discardedChanges: boolean): NanoEditorResult {
    this.#state = "closed";
    this.#status = discardedChanges
      ? "Closed; unsaved changes were discarded."
      : "Closed.";
    return {
      kind: "closed",
      saved,
      discardedChanges,
      snapshot: this.snapshot,
    };
  }

  #assertEditing(): void {
    if (this.#state !== "editing")
      throw new Error("Nano editor session is already closed");
  }
}
