import { highlightLine, type HighlightedCell } from "./syntaxHighlight.js";
import type { EditorResult, EditorScreen } from "./editorScreen.js";

export type ViMode = "command" | "insert" | "normal";
export type ViState = "closed" | "editing";

export type ViScreen = EditorScreen;
export type ViResult = EditorResult;

const maximumUndoStates = 32;

type UndoOperation =
  | { readonly index: number; readonly kind: "replace"; readonly line: string }
  | {
      readonly deleteCount: number;
      readonly index: number;
      readonly kind: "splice";
      readonly lines: readonly string[];
    };

export class ViSession {
  private readonly lines: string[];
  private readonly undo: UndoOperation[] = [];
  private command = "";
  private cursorColumn = 0;
  private cursorLine = 0;
  private dirty = false;
  private modeValue: ViMode = "normal";
  private pendingNormal = "";
  private stateValue: ViState = "editing";
  private status = "NORMAL  i insert  : command";
  private viewTop = 0;

  constructor(
    readonly fileName: string,
    contents: string,
    private widthValue = 51,
    private heightValue = 19,
  ) {
    if (widthValue < 20 || heightValue < 6)
      throw new RangeError("vi terminal is too small");
    this.lines = contents.replaceAll("\r\n", "\n").split("\n");
    if (this.lines.length === 0) this.lines.push("");
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  resize(width: number, height: number): ViScreen {
    if (width < 20 || height < 6)
      throw new RangeError("vi terminal is too small");
    this.widthValue = width;
    this.heightValue = height;
    return this.screen();
  }

  get mode(): ViMode {
    return this.modeValue;
  }

  get state(): ViState {
    return this.stateValue;
  }

  get contents(): string {
    return this.lines.join("\n");
  }

  screen(): ViScreen {
    this.ensureVisible();
    const contentRows = this.height - 3;
    const rows: HighlightedCell[][] = [];
    rows.push(
      this.plainRow(`VI  ${this.fileName}${this.dirty ? " [+]" : ""}`, 15, 11),
    );
    for (let offset = 0; offset < contentRows; offset += 1) {
      const lineIndex = this.viewTop + offset;
      if (lineIndex >= this.lines.length) {
        rows.push(this.plainRow("~", 9, 15));
        continue;
      }
      const number = `${String(lineIndex + 1).padStart(3)} `;
      const cells = [
        ...this.plainCells(number, lineIndex === this.cursorLine ? 0 : 8, 15),
        ...highlightLine(
          this.fileName,
          this.lines[lineIndex] ?? "",
          this.width - number.length,
        ),
      ];
      rows.push(this.padRow(cells));
    }
    const mode = `-- ${this.modeValue.toUpperCase()} --`;
    rows.push(this.plainRow(`${mode} ${this.status}`, 0, 15));
    rows.push(
      this.plainRow(
        this.modeValue === "command"
          ? `:${this.command}`
          : "Esc normal  :w save  :q quit",
        0,
        15,
      ),
    );
    const y = this.cursorLine - this.viewTop + 2;
    const x = Math.min(this.width, this.cursorColumn + 5);
    return { cursor: { x, y }, rows };
  }

  key(key: string): ViResult {
    this.assertEditing();
    if (key.length > 32) return this.continue("Key ignored");
    if (this.modeValue === "insert") return this.insertKey(key);
    if (this.modeValue === "command") return this.commandKey(key);
    return this.normalKey(key);
  }

  completeSave(closeAfter: boolean): ViResult {
    this.dirty = false;
    this.status = `Wrote ${this.lines.length} lines`;
    if (!closeAfter) return { kind: "continue", screen: this.screen() };
    this.stateValue = "closed";
    return { kind: "closed", discardedChanges: false, screen: this.screen() };
  }

  failSave(detail: string): ViResult {
    return this.continue(`Write failed: ${detail}`);
  }

  private normalKey(key: string): ViResult {
    if (key === ":") {
      this.modeValue = "command";
      this.command = "";
      return this.continue("COMMAND");
    }
    if (key === "i") {
      this.modeValue = "insert";
      return this.continue("INSERT");
    }
    if (key === "a") {
      this.cursorColumn = Math.min(
        this.currentCharacters().length,
        this.cursorColumn + 1,
      );
      this.modeValue = "insert";
      return this.continue("INSERT");
    }
    if (key === "o") {
      this.remember({
        deleteCount: 1,
        index: this.cursorLine + 1,
        kind: "splice",
        lines: [],
      });
      this.lines.splice(this.cursorLine + 1, 0, "");
      this.cursorLine += 1;
      this.cursorColumn = 0;
      this.dirty = true;
      this.modeValue = "insert";
      return this.continue("INSERT");
    }
    if (key === "u") {
      const previous = this.undo.pop();
      if (previous === undefined)
        return this.continue("Already at oldest change");
      if (previous.kind === "replace") {
        this.lines[previous.index] = previous.line;
      } else {
        this.lines.splice(
          previous.index,
          previous.deleteCount,
          ...previous.lines,
        );
      }
      this.clampCursor();
      this.dirty = true;
      return this.continue("Undo");
    }
    if (key === "x" || key === "Delete") {
      const characters = this.currentCharacters();
      if (characters.length === 0) return this.continue("Nothing to delete");
      this.rememberCurrentLine();
      characters.splice(this.cursorColumn, 1);
      this.lines[this.cursorLine] = characters.join("");
      this.dirty = true;
      this.clampCursor();
      return this.continue("Deleted character");
    }
    if (key === "d") {
      if (this.pendingNormal === "d") {
        const deleted = this.lines[this.cursorLine] ?? "";
        this.remember({
          deleteCount: 0,
          index: this.cursorLine,
          kind: "splice",
          lines: [deleted],
        });
        this.lines.splice(this.cursorLine, 1);
        if (this.lines.length === 0) this.lines.push("");
        this.pendingNormal = "";
        this.dirty = true;
        this.clampCursor();
        return this.continue("Deleted line");
      }
      this.pendingNormal = "d";
      return this.continue("d");
    }
    if (key === "Z") {
      if (this.pendingNormal === "Z") {
        this.pendingNormal = "";
        return {
          kind: "save",
          closeAfter: true,
          contents: this.contents,
          screen: this.screen(),
        };
      }
      this.pendingNormal = "Z";
      return this.continue("Z");
    }
    this.pendingNormal = "";
    if (key === "h" || key === "ArrowLeft") this.cursorColumn -= 1;
    else if (key === "l" || key === "ArrowRight") this.cursorColumn += 1;
    else if (key === "k" || key === "ArrowUp") this.cursorLine -= 1;
    else if (key === "j" || key === "ArrowDown") this.cursorLine += 1;
    else if (key === "0" || key === "Home") this.cursorColumn = 0;
    else if (key === "$" || key === "End")
      this.cursorColumn = this.currentCharacters().length;
    else return this.continue("NORMAL");
    this.clampCursor();
    return this.continue(`Line ${this.cursorLine + 1}`);
  }

  private insertKey(key: string): ViResult {
    if (key === "Escape" || key === "Ctrl+[") {
      this.modeValue = "normal";
      this.clampCursor();
      return this.continue("NORMAL");
    }
    if (
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowUp" ||
      key === "ArrowDown"
    ) {
      return this.normalKey(key);
    }
    if (key === "Enter") {
      const original = this.lines[this.cursorLine] ?? "";
      const characters = this.currentCharacters();
      const before = characters.slice(0, this.cursorColumn).join("");
      const after = characters.slice(this.cursorColumn).join("");
      const indent = /^\s*/u.exec(before)?.[0] ?? "";
      this.remember({
        deleteCount: 2,
        index: this.cursorLine,
        kind: "splice",
        lines: [original],
      });
      this.lines.splice(this.cursorLine, 1, before, `${indent}${after}`);
      this.cursorLine += 1;
      this.cursorColumn = indent.length;
      this.dirty = true;
      return this.continue("INSERT");
    }
    if (key === "Backspace") {
      if (this.cursorColumn > 0) {
        this.rememberCurrentLine();
        const characters = this.currentCharacters();
        characters.splice(this.cursorColumn - 1, 1);
        this.lines[this.cursorLine] = characters.join("");
        this.cursorColumn -= 1;
        this.dirty = true;
      }
      return this.continue("INSERT");
    }
    if (key === "Tab") key = "  ";
    if ([...key].length > 2 || key.length === 0) return this.continue("INSERT");
    this.rememberCurrentLine();
    const characters = this.currentCharacters();
    characters.splice(this.cursorColumn, 0, ...key);
    this.lines[this.cursorLine] = characters.join("");
    this.cursorColumn += [...key].length;
    this.dirty = true;
    return this.continue("INSERT");
  }

  private commandKey(key: string): ViResult {
    if (key === "Escape") {
      this.modeValue = "normal";
      this.command = "";
      return this.continue("NORMAL");
    }
    if (key === "Backspace") {
      this.command = [...this.command].slice(0, -1).join("");
      return this.continue("COMMAND");
    }
    if (key !== "Enter") {
      if ([...key].length === 1 && this.command.length < 64)
        this.command += key;
      return this.continue("COMMAND");
    }
    const command = this.command.trim();
    this.command = "";
    this.modeValue = "normal";
    if (command === "w" || command === "wq" || command === "wq!") {
      return {
        kind: "save",
        closeAfter: command !== "w",
        contents: this.contents,
        screen: this.screen(),
      };
    }
    if (command === "q") {
      if (this.dirty)
        return this.continue("No write since last change; use :q!");
      this.stateValue = "closed";
      return { kind: "closed", discardedChanges: false, screen: this.screen() };
    }
    if (command === "q!") {
      this.stateValue = "closed";
      return {
        kind: "closed",
        discardedChanges: this.dirty,
        screen: this.screen(),
      };
    }
    return this.continue(`Not an editor command: ${command}`);
  }

  private continue(status: string): ViResult {
    this.status = status;
    return { kind: "continue", screen: this.screen() };
  }

  private rememberCurrentLine(): void {
    this.remember({
      index: this.cursorLine,
      kind: "replace",
      line: this.lines[this.cursorLine] ?? "",
    });
  }

  private remember(operation: UndoOperation): void {
    if (this.undo.length === maximumUndoStates) this.undo.shift();
    this.undo.push(operation);
  }

  private currentCharacters(): string[] {
    return [...(this.lines[this.cursorLine] ?? "")];
  }

  private clampCursor(): void {
    this.cursorLine = Math.max(
      0,
      Math.min(this.lines.length - 1, this.cursorLine),
    );
    this.cursorColumn = Math.max(
      0,
      Math.min(this.currentCharacters().length, this.cursorColumn),
    );
  }

  private ensureVisible(): void {
    const contentRows = this.height - 3;
    if (this.cursorLine < this.viewTop) this.viewTop = this.cursorLine;
    if (this.cursorLine >= this.viewTop + contentRows) {
      this.viewTop = this.cursorLine - contentRows + 1;
    }
  }

  private plainRow(
    value: string,
    foreground: number,
    background: number,
  ): HighlightedCell[] {
    return this.padRow(this.plainCells(value, foreground, background));
  }

  private plainCells(
    value: string,
    foreground: number,
    background: number,
  ): HighlightedCell[] {
    return [...value].slice(0, this.width).map((character) => ({
      background,
      character,
      foreground,
    }));
  }

  private padRow(cells: readonly HighlightedCell[]): HighlightedCell[] {
    const row = cells.slice(0, this.width);
    while (row.length < this.width) {
      row.push({ background: 15, character: " ", foreground: 0 });
    }
    return row;
  }

  private assertEditing(): void {
    if (this.stateValue !== "editing")
      throw new Error("vi session is already closed");
  }
}
