import type { EditorResult, EditorScreen } from "./editorScreen.js";
import type { HighlightedCell } from "./syntaxHighlight.js";

export type DosEditMode = "confirm-exit" | "editing" | "menu" | "search";

type MenuName = "edit" | "file" | "help" | "options" | "search";
type MenuAction =
  | "copy"
  | "cut"
  | "exit"
  | "find"
  | "find-next"
  | "help"
  | "paste"
  | "save"
  | "save-exit"
  | "toggle-insert"
  | "undo";

interface MenuEntry {
  readonly action: MenuAction;
  readonly label: string;
  readonly shortcut: string;
  readonly mnemonic: string;
}

interface UndoOperation {
  readonly cursorColumn: number;
  readonly cursorLine: number;
  readonly deleteCount: number;
  readonly index: number;
  readonly lines: readonly string[];
}

const maximumEditorLines = 4_096;
const maximumClipboardCharacters = 4_096;
const maximumLineCharacters = 4_096;
const maximumSearchCharacters = 64;
const maximumUndoStates = 32;

const menuOrder = ["file", "edit", "search", "options", "help"] as const;
const menuLabels: Readonly<Record<MenuName, string>> = {
  edit: "Edit",
  file: "File",
  help: "Help",
  options: "Options",
  search: "Search",
};
const menuEntries: Readonly<Record<MenuName, readonly MenuEntry[]>> = {
  file: [
    { action: "save", label: "Save", mnemonic: "s", shortcut: "F2" },
    {
      action: "save-exit",
      label: "Save and Exit",
      mnemonic: "a",
      shortcut: "",
    },
    { action: "exit", label: "Exit", mnemonic: "x", shortcut: "Alt+F X" },
  ],
  edit: [
    { action: "undo", label: "Undo", mnemonic: "u", shortcut: "Ctrl+Z" },
    { action: "cut", label: "Cut", mnemonic: "t", shortcut: "Ctrl+X" },
    { action: "copy", label: "Copy", mnemonic: "c", shortcut: "Ctrl+C" },
    { action: "paste", label: "Paste", mnemonic: "p", shortcut: "Ctrl+V" },
  ],
  search: [
    { action: "find", label: "Find", mnemonic: "f", shortcut: "Ctrl+F" },
    {
      action: "find-next",
      label: "Find Next",
      mnemonic: "n",
      shortcut: "F3",
    },
  ],
  options: [
    {
      action: "toggle-insert",
      label: "Insert/Overwrite",
      mnemonic: "i",
      shortcut: "Ins",
    },
  ],
  help: [
    { action: "help", label: "Keyboard Help", mnemonic: "h", shortcut: "F1" },
  ],
};

export class DosEditSession {
  private clipboard = "";
  private readonly lines: string[];
  private readonly undo: UndoOperation[] = [];
  private cursorColumn = 0;
  private cursorLine = 0;
  private dirty = false;
  private insertMode = true;
  private lastSearch = "";
  private menuIndex = 0;
  private menuItemIndex = 0;
  private modeValue: DosEditMode = "editing";
  private searchQuery = "";
  private selectionAnchor?: { readonly column: number; readonly line: number };
  private stateValue: "closed" | "editing" = "editing";
  private status = "Ready";
  private viewLeft = 0;
  private viewTop = 0;

  constructor(
    readonly fileName: string,
    contents: string,
    private widthValue = 51,
    private heightValue = 19,
    readonly displayName = fileName,
  ) {
    this.requireTerminalSize(widthValue, heightValue);
    this.lines = contents.replaceAll("\r\n", "\n").split("\n");
    if (this.lines.length === 0) this.lines.push("");
  }

  get contents(): string {
    return this.lines.join("\n");
  }

  get cursor(): { readonly column: number; readonly line: number } {
    return { column: this.cursorColumn, line: this.cursorLine };
  }

  get mode(): DosEditMode {
    return this.modeValue;
  }

  get state(): "closed" | "editing" {
    return this.stateValue;
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  resize(width: number, height: number): EditorScreen {
    this.requireTerminalSize(width, height);
    this.widthValue = width;
    this.heightValue = height;
    return this.screen();
  }

  screen(): EditorScreen {
    this.ensureVisible();
    const rows: HighlightedCell[][] = [];
    rows.push(this.menuBar());
    for (let offset = 0; offset < this.contentRows; offset += 1) {
      const lineIndex = this.viewTop + offset;
      const line = this.lines[lineIndex] ?? "";
      const rendered = this.plainRow(
        [...line].slice(this.viewLeft, this.viewLeft + this.width).join(""),
        0,
        11,
      );
      this.paintSelection(rendered, lineIndex);
      rows.push(rendered);
    }
    rows.push(this.plainRow(this.statusLine(), 15, 8));
    rows.push(this.plainRow(this.helpLine(), 15, 8));

    let cursor = this.editingCursor();
    if (this.modeValue === "menu") cursor = this.drawMenu(rows);
    else if (this.modeValue === "search") cursor = this.drawSearchDialog(rows);
    else if (this.modeValue === "confirm-exit") {
      cursor = this.drawExitDialog(rows);
    }
    return { cursor, rows };
  }

  key(key: string): EditorResult {
    this.assertEditing();
    if (key.length > 32) return this.continue("Key ignored");
    if (this.modeValue === "confirm-exit") return this.confirmExitKey(key);
    if (this.modeValue === "search") return this.searchKey(key);
    if (this.modeValue === "menu") return this.menuKey(key);
    return this.editingKey(key);
  }

  pointerDown(x: number, y: number): EditorResult {
    this.assertEditing();
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x < 1 ||
      x > this.width ||
      y < 1 ||
      y > this.height
    ) {
      return this.continue("Pointer ignored");
    }
    const column = x - 1;
    const row = y - 1;
    if (row === 0) {
      const menu = menuOrder.findIndex((_name, index) => {
        const heading = this.menuHeading(index);
        return (
          column >= heading.start && column < heading.start + heading.width
        );
      });
      if (menu >= 0) return this.openMenu(menuOrder[menu]!);
    }
    if (this.modeValue === "menu") {
      const entries = this.activeMenuEntries();
      const item = row - 2;
      if (item >= 0 && item < entries.length) {
        this.menuItemIndex = item;
        return this.applyMenuAction(entries[item]!.action);
      }
      this.modeValue = "editing";
      return this.continue("Menu cancelled");
    }
    if (row >= 1 && row <= this.contentRows) {
      this.modeValue = "editing";
      this.movePointer(column, row);
      this.selectionAnchor = this.cursor;
      return this.continue("Pointer cursor");
    }
    return this.continue(this.status);
  }

  pointerMove(x: number, y: number): EditorResult {
    this.assertEditing();
    if (
      this.selectionAnchor === undefined ||
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x < 1 ||
      x > this.width ||
      y < 2 ||
      y > this.contentRows + 1
    ) {
      return this.continue("Pointer ignored");
    }
    this.movePointer(x - 1, y - 1);
    return this.continue(
      this.selectedRange() === undefined ? "Pointer cursor" : "Selected",
    );
  }

  completeSave(closeAfter: boolean): EditorResult {
    this.dirty = false;
    this.status = `Saved ${this.displayName}`;
    if (!closeAfter) return { kind: "continue", screen: this.screen() };
    this.stateValue = "closed";
    return { kind: "closed", discardedChanges: false, screen: this.screen() };
  }

  failSave(detail: string): EditorResult {
    this.modeValue = "editing";
    return this.continue(`Save failed: ${detail}`);
  }

  private editingKey(key: string): EditorResult {
    const normalized = key.toLowerCase();
    if (key === "F1") return this.continue(this.keyboardHelp());
    if (key === "F2" || normalized === "ctrl+s") return this.save(false);
    if (key === "F3") return this.findNext();
    if (key === "F10") return this.openMenu("file");
    if (normalized === "ctrl+c") return this.copySelection();
    if (normalized === "ctrl+f") return this.beginSearch();
    if (normalized === "ctrl+v") return this.pasteClipboard();
    if (normalized === "ctrl+x") return this.cutSelection();
    if (normalized === "ctrl+z") return this.undoLast();
    if (normalized === "ctrl+y") return this.deleteLine();
    if (normalized.startsWith("alt+") && normalized.length === 5) {
      return this.openMenuByMnemonic(normalized.at(-1) ?? "");
    }
    if (key === "Insert") {
      this.insertMode = !this.insertMode;
      return this.continue(this.insertMode ? "Insert mode" : "Overwrite mode");
    }
    if (
      key === "Ctrl+Home" ||
      key === "Ctrl+End" ||
      key === "Ctrl+ArrowLeft" ||
      key === "Ctrl+ArrowRight" ||
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "ArrowUp" ||
      key === "ArrowDown" ||
      key === "Home" ||
      key === "End" ||
      key === "PageUp" ||
      key === "PageDown"
    ) {
      this.selectionAnchor = undefined;
    }
    if (key === "Ctrl+Home") {
      this.cursorLine = 0;
      this.cursorColumn = 0;
    } else if (key === "Ctrl+End") {
      this.cursorLine = this.lines.length - 1;
      this.cursorColumn = this.currentCharacters().length;
    } else if (key === "Ctrl+ArrowLeft") this.moveWordLeft();
    else if (key === "Ctrl+ArrowRight") this.moveWordRight();
    else if (key === "ArrowLeft") this.moveLeft();
    else if (key === "ArrowRight") this.moveRight();
    else if (key === "ArrowUp") this.cursorLine -= 1;
    else if (key === "ArrowDown") this.cursorLine += 1;
    else if (key === "Home") this.cursorColumn = 0;
    else if (key === "End") this.cursorColumn = this.currentCharacters().length;
    else if (key === "PageUp") this.cursorLine -= this.contentRows;
    else if (key === "PageDown") this.cursorLine += this.contentRows;
    else if (key === "Backspace") return this.backspace();
    else if (key === "Delete") return this.deleteForward();
    else if (key === "Enter") return this.insertNewline();
    else if (key === "Tab")
      return this.insertText(" ".repeat(4 - (this.cursorColumn % 4)));
    else if ([...key].length === 1) return this.insertText(key);
    else return this.continue(this.status);
    this.clampCursor();
    return this.continue(this.status);
  }

  private menuKey(key: string): EditorResult {
    const normalized = key.toLowerCase();
    if (key === "Escape" || key === "F10") {
      this.modeValue = "editing";
      return this.continue("Menu cancelled");
    }
    if (normalized.startsWith("alt+") && normalized.length === 5) {
      return this.openMenuByMnemonic(normalized.at(-1) ?? "");
    }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const direction = key === "ArrowLeft" ? -1 : 1;
      this.menuIndex =
        (this.menuIndex + direction + menuOrder.length) % menuOrder.length;
      this.menuItemIndex = 0;
      return this.continue("Menu");
    }
    const entries = this.activeMenuEntries();
    if (key === "ArrowUp" || key === "ArrowDown") {
      const direction = key === "ArrowUp" ? -1 : 1;
      this.menuItemIndex =
        (this.menuItemIndex + direction + entries.length) % entries.length;
      return this.continue("Menu");
    }
    if (key === "Enter")
      return this.applyMenuAction(entries[this.menuItemIndex]!.action);
    if ([...key].length === 1) {
      const entry = entries.find(({ mnemonic }) => mnemonic === normalized);
      if (entry !== undefined) return this.applyMenuAction(entry.action);
    }
    return this.continue("Menu");
  }

  private applyMenuAction(action: MenuAction): EditorResult {
    this.modeValue = "editing";
    if (action === "save") return this.save(false);
    if (action === "save-exit") return this.save(true);
    if (action === "exit") return this.requestExit();
    if (action === "undo") return this.undoLast();
    if (action === "copy") return this.copySelection();
    if (action === "cut") return this.cutSelection();
    if (action === "paste") return this.pasteClipboard();
    if (action === "find") return this.beginSearch();
    if (action === "find-next") return this.findNext();
    if (action === "toggle-insert") {
      this.insertMode = !this.insertMode;
      return this.continue(this.insertMode ? "Insert mode" : "Overwrite mode");
    }
    return this.continue(this.keyboardHelp());
  }

  private beginSearch(): EditorResult {
    this.modeValue = "search";
    this.searchQuery = this.lastSearch;
    return this.continue("Find text");
  }

  private searchKey(key: string): EditorResult {
    if (key === "Escape") {
      this.modeValue = "editing";
      this.searchQuery = "";
      return this.continue("Find cancelled");
    }
    if (key === "Backspace") {
      this.searchQuery = [...this.searchQuery].slice(0, -1).join("");
      return this.continue("Find text");
    }
    if (key === "Enter") {
      const query = this.searchQuery;
      this.modeValue = "editing";
      if (query.length === 0) return this.continue("Find text is empty");
      this.lastSearch = query;
      return this.find(query, this.cursorColumn);
    }
    if (
      [...key].length === 1 &&
      [...this.searchQuery].length < maximumSearchCharacters
    ) {
      this.searchQuery += key;
    }
    return this.continue("Find text");
  }

  private findNext(): EditorResult {
    if (this.lastSearch.length === 0) return this.beginSearch();
    return this.find(this.lastSearch, this.cursorColumn + 1);
  }

  private find(query: string, startColumn: number): EditorResult {
    const needle = query.toLocaleLowerCase();
    for (let offset = 0; offset < this.lines.length; offset += 1) {
      const lineIndex = (this.cursorLine + offset) % this.lines.length;
      const line = (this.lines[lineIndex] ?? "").toLocaleLowerCase();
      const from = offset === 0 ? startColumn : 0;
      const column = line.indexOf(needle, from);
      if (column >= 0) {
        this.cursorLine = lineIndex;
        this.cursorColumn = column;
        return this.continue(`Found: ${query}`);
      }
    }
    const current = (this.lines[this.cursorLine] ?? "").toLocaleLowerCase();
    const wrappedColumn = current.indexOf(needle);
    if (wrappedColumn >= 0 && wrappedColumn < startColumn) {
      this.cursorColumn = wrappedColumn;
      return this.continue(`Found: ${query}`);
    }
    return this.continue(`Not found: ${query}`);
  }

  private requestExit(): EditorResult {
    if (this.dirty) {
      this.modeValue = "confirm-exit";
      return this.continue("Save changes before exit?");
    }
    this.stateValue = "closed";
    return { kind: "closed", discardedChanges: false, screen: this.screen() };
  }

  private confirmExitKey(key: string): EditorResult {
    const normalized = key.toLowerCase();
    if (normalized === "y") {
      this.modeValue = "editing";
      return this.save(true);
    }
    if (normalized === "n") {
      this.modeValue = "editing";
      this.stateValue = "closed";
      return { kind: "closed", discardedChanges: true, screen: this.screen() };
    }
    if (key === "Escape" || normalized === "c") {
      this.modeValue = "editing";
      return this.continue("Exit cancelled");
    }
    return this.continue("Y Save  N Discard  Esc Cancel");
  }

  private save(closeAfter: boolean): EditorResult {
    this.modeValue = "editing";
    this.status = "Saving...";
    return {
      closeAfter,
      contents: this.contents,
      kind: "save",
      screen: this.screen(),
    };
  }

  private insertText(value: string): EditorResult {
    if (this.selectedRange() !== undefined) return this.replaceSelection(value);
    const inserted = [...value];
    const characters = this.currentCharacters();
    const replaced = this.insertMode
      ? 0
      : Math.min(inserted.length, characters.length - this.cursorColumn);
    const nextLength = characters.length - replaced + inserted.length;
    if (nextLength > maximumLineCharacters)
      return this.continue("Line limit reached");
    this.rememberLines(this.cursorLine, 1, [this.lines[this.cursorLine] ?? ""]);
    characters.splice(this.cursorColumn, replaced, ...inserted);
    this.lines[this.cursorLine] = characters.join("");
    this.cursorColumn += inserted.length;
    return this.changed();
  }

  private insertNewline(): EditorResult {
    if (this.selectedRange() !== undefined) return this.replaceSelection("\n");
    if (this.lines.length >= maximumEditorLines)
      return this.continue("Line limit reached");
    const original = this.lines[this.cursorLine] ?? "";
    const characters = [...original];
    const before = characters.slice(0, this.cursorColumn).join("");
    const after = characters.slice(this.cursorColumn).join("");
    this.rememberLines(this.cursorLine, 2, [original]);
    this.lines.splice(this.cursorLine, 1, before, after);
    this.cursorLine += 1;
    this.cursorColumn = 0;
    return this.changed();
  }

  private backspace(): EditorResult {
    if (this.selectedRange() !== undefined) return this.deleteSelection();
    if (this.cursorColumn > 0) {
      const characters = this.currentCharacters();
      this.rememberLines(this.cursorLine, 1, [
        this.lines[this.cursorLine] ?? "",
      ]);
      characters.splice(this.cursorColumn - 1, 1);
      this.lines[this.cursorLine] = characters.join("");
      this.cursorColumn -= 1;
      return this.changed();
    }
    if (this.cursorLine === 0) return this.continue(this.status);
    const previous = this.lines[this.cursorLine - 1] ?? "";
    const current = this.lines[this.cursorLine] ?? "";
    if ([...previous, ...current].length > maximumLineCharacters) {
      return this.continue("Line limit reached");
    }
    this.rememberLines(this.cursorLine - 1, 1, [previous, current]);
    this.lines.splice(this.cursorLine - 1, 2, `${previous}${current}`);
    this.cursorLine -= 1;
    this.cursorColumn = [...previous].length;
    return this.changed();
  }

  private deleteForward(): EditorResult {
    if (this.selectedRange() !== undefined) return this.deleteSelection();
    const characters = this.currentCharacters();
    if (this.cursorColumn < characters.length) {
      this.rememberLines(this.cursorLine, 1, [
        this.lines[this.cursorLine] ?? "",
      ]);
      characters.splice(this.cursorColumn, 1);
      this.lines[this.cursorLine] = characters.join("");
      return this.changed();
    }
    if (this.cursorLine + 1 >= this.lines.length)
      return this.continue(this.status);
    const current = this.lines[this.cursorLine] ?? "";
    const next = this.lines[this.cursorLine + 1] ?? "";
    if ([...current, ...next].length > maximumLineCharacters) {
      return this.continue("Line limit reached");
    }
    this.rememberLines(this.cursorLine, 1, [current, next]);
    this.lines.splice(this.cursorLine, 2, `${current}${next}`);
    return this.changed();
  }

  private undoLast(): EditorResult {
    const operation = this.undo.pop();
    if (operation === undefined) return this.continue("Nothing to undo");
    this.lines.splice(
      operation.index,
      operation.deleteCount,
      ...operation.lines,
    );
    this.cursorLine = operation.cursorLine;
    this.cursorColumn = operation.cursorColumn;
    this.selectionAnchor = undefined;
    this.dirty = true;
    this.clampCursor();
    return this.continue("Undo");
  }

  private deleteLine(): EditorResult {
    this.selectionAnchor = undefined;
    const current = this.lines[this.cursorLine] ?? "";
    if (this.lines.length === 1) {
      this.rememberLines(this.cursorLine, 1, [current]);
      this.lines[0] = "";
    } else {
      this.rememberLines(this.cursorLine, 0, [current]);
      this.lines.splice(this.cursorLine, 1);
    }
    this.cursorColumn = 0;
    this.clampCursor();
    return this.changed();
  }

  private copySelection(): EditorResult {
    const selected = this.selectedText();
    if (selected === undefined) return this.continue("Nothing selected");
    if ([...selected].length > maximumClipboardCharacters) {
      return this.continue("Selection exceeds clipboard limit");
    }
    this.clipboard = selected;
    return this.continue("Copied");
  }

  private cutSelection(): EditorResult {
    const selected = this.selectedText();
    if (selected === undefined) return this.continue("Nothing selected");
    if ([...selected].length > maximumClipboardCharacters) {
      return this.continue("Selection exceeds clipboard limit");
    }
    this.clipboard = selected;
    return this.deleteSelection("Cut");
  }

  private pasteClipboard(): EditorResult {
    if (this.clipboard.length === 0) return this.continue("Clipboard is empty");
    return this.replaceSelection(this.clipboard, "Pasted");
  }

  private deleteSelection(status = "Modified"): EditorResult {
    const range = this.selectedRange();
    if (range === undefined) return this.continue("Nothing selected");
    const originals = this.lines.slice(range.start.line, range.end.line + 1);
    const prefix = [...(this.lines[range.start.line] ?? "")]
      .slice(0, range.start.column)
      .join("");
    const suffix = [...(this.lines[range.end.line] ?? "")]
      .slice(range.end.column)
      .join("");
    const merged = `${prefix}${suffix}`;
    if ([...merged].length > maximumLineCharacters) {
      return this.continue("Line limit reached");
    }
    this.rememberLines(range.start.line, 1, originals);
    this.lines.splice(
      range.start.line,
      range.end.line - range.start.line + 1,
      merged,
    );
    this.cursorLine = range.start.line;
    this.cursorColumn = range.start.column;
    this.selectionAnchor = undefined;
    this.dirty = true;
    return this.continue(status);
  }

  private replaceSelection(value: string, status = "Modified"): EditorResult {
    const range = this.selectedRange() ?? {
      end: this.cursor,
      start: this.cursor,
    };
    const originals = this.lines.slice(range.start.line, range.end.line + 1);
    const prefix = [...(this.lines[range.start.line] ?? "")]
      .slice(0, range.start.column)
      .join("");
    const suffix = [...(this.lines[range.end.line] ?? "")]
      .slice(range.end.column)
      .join("");
    const insertedLines = value.replaceAll("\r\n", "\n").split("\n");
    const replacements =
      insertedLines.length === 1
        ? [`${prefix}${insertedLines[0] ?? ""}${suffix}`]
        : [
            `${prefix}${insertedLines[0] ?? ""}`,
            ...insertedLines.slice(1, -1),
            `${insertedLines.at(-1) ?? ""}${suffix}`,
          ];
    const resultingLineCount =
      this.lines.length - originals.length + replacements.length;
    if (resultingLineCount > maximumEditorLines) {
      return this.continue("Line limit reached");
    }
    if (
      replacements.some(
        (replacement) => [...replacement].length > maximumLineCharacters,
      )
    ) {
      return this.continue("Line limit reached");
    }
    this.rememberLines(range.start.line, replacements.length, originals);
    this.lines.splice(range.start.line, originals.length, ...replacements);
    this.cursorLine = range.start.line + insertedLines.length - 1;
    this.cursorColumn =
      insertedLines.length === 1
        ? range.start.column + [...(insertedLines[0] ?? "")].length
        : [...(insertedLines.at(-1) ?? "")].length;
    this.selectionAnchor = undefined;
    this.dirty = true;
    return this.continue(status);
  }

  private selectedText(): string | undefined {
    const range = this.selectedRange();
    if (range === undefined) return undefined;
    if (range.start.line === range.end.line) {
      return [...(this.lines[range.start.line] ?? "")]
        .slice(range.start.column, range.end.column)
        .join("");
    }
    const selected = [
      [...(this.lines[range.start.line] ?? "")]
        .slice(range.start.column)
        .join(""),
      ...this.lines.slice(range.start.line + 1, range.end.line),
      [...(this.lines[range.end.line] ?? "")]
        .slice(0, range.end.column)
        .join(""),
    ];
    return selected.join("\n");
  }

  private selectedRange():
    | {
        readonly end: { readonly column: number; readonly line: number };
        readonly start: { readonly column: number; readonly line: number };
      }
    | undefined {
    const anchor = this.selectionAnchor;
    if (anchor === undefined) return undefined;
    const cursor = this.cursor;
    if (anchor.line === cursor.line && anchor.column === cursor.column) {
      return undefined;
    }
    const anchorFirst =
      anchor.line < cursor.line ||
      (anchor.line === cursor.line && anchor.column < cursor.column);
    return anchorFirst
      ? { end: cursor, start: anchor }
      : { end: anchor, start: cursor };
  }

  private rememberLines(
    index: number,
    deleteCount: number,
    lines: readonly string[],
  ): void {
    if (this.undo.length === maximumUndoStates) this.undo.shift();
    this.undo.push({
      cursorColumn: this.cursorColumn,
      cursorLine: this.cursorLine,
      deleteCount,
      index,
      lines,
    });
  }

  private changed(): EditorResult {
    this.dirty = true;
    this.status = "Modified";
    this.clampCursor();
    return { kind: "continue", screen: this.screen() };
  }

  private moveLeft(): void {
    if (this.cursorColumn > 0) this.cursorColumn -= 1;
    else if (this.cursorLine > 0) {
      this.cursorLine -= 1;
      this.cursorColumn = [...(this.lines[this.cursorLine] ?? "")].length;
    }
  }

  private moveRight(): void {
    if (this.cursorColumn < this.currentCharacters().length)
      this.cursorColumn += 1;
    else if (this.cursorLine + 1 < this.lines.length) {
      this.cursorLine += 1;
      this.cursorColumn = 0;
    }
  }

  private moveWordLeft(): void {
    if (this.cursorColumn === 0) {
      this.moveLeft();
      return;
    }
    const prefix = this.currentCharacters()
      .slice(0, this.cursorColumn)
      .join("");
    this.cursorColumn = /\S+\s*$/u.exec(prefix)?.index ?? 0;
  }

  private moveWordRight(): void {
    const characters = this.currentCharacters();
    const suffix = characters.slice(this.cursorColumn).join("");
    const match = /^\S*\s*/u.exec(suffix)?.[0] ?? "";
    if (match.length === 0) this.moveRight();
    else this.cursorColumn += [...match].length;
  }

  private movePointer(column: number, row: number): void {
    this.cursorLine = Math.min(this.lines.length - 1, this.viewTop + row - 1);
    this.cursorColumn = this.viewLeft + column;
    this.clampCursor();
  }

  private paintSelection(row: HighlightedCell[], line: number): void {
    const range = this.selectedRange();
    if (
      range === undefined ||
      line < range.start.line ||
      line > range.end.line
    ) {
      return;
    }
    const start = line === range.start.line ? range.start.column : 0;
    const end =
      line === range.end.line
        ? range.end.column
        : [...(this.lines[line] ?? "")].length;
    const visibleStart = Math.max(0, start - this.viewLeft);
    const visibleEnd = Math.min(this.width, end - this.viewLeft);
    if (visibleEnd > visibleStart) {
      this.paint(row, visibleStart, visibleEnd - visibleStart, 15, 1);
    }
  }

  private openMenu(name: MenuName): EditorResult {
    this.modeValue = "menu";
    this.menuIndex = menuOrder.indexOf(name);
    this.menuItemIndex = 0;
    return this.continue("Menu");
  }

  private openMenuByMnemonic(mnemonic: string): EditorResult {
    const index = menuOrder.findIndex((name) => name.startsWith(mnemonic));
    return index < 0
      ? this.continue(this.status)
      : this.openMenu(menuOrder[index]!);
  }

  private activeMenuEntries(): readonly MenuEntry[] {
    return menuEntries[menuOrder[this.menuIndex]!];
  }

  private menuBar(): HighlightedCell[] {
    const cells = this.plainRow(
      menuOrder.map((name) => ` ${menuLabels[name]} `).join(" "),
      15,
      8,
    );
    if (this.modeValue !== "menu") return cells;
    const { start, width } = this.menuHeading(this.menuIndex);
    this.paint(cells, start, width, 0, 11);
    return cells;
  }

  private drawMenu(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const entries = this.activeMenuEntries();
    const labels = entries.map(({ label, shortcut }) =>
      shortcut.length === 0 ? label : `${label}  ${shortcut}`,
    );
    const menuWidth = Math.min(
      this.width,
      Math.max(...labels.map((label) => [...label].length)) + 4,
    );
    const heading = this.menuHeading(this.menuIndex);
    const left = Math.max(0, Math.min(heading.start, this.width - menuWidth));
    this.overlay(rows, 1, left, `+${"-".repeat(menuWidth - 2)}+`, 15, 8);
    for (let index = 0; index < entries.length; index += 1) {
      const selected = index === this.menuItemIndex;
      const text = [...(labels[index] ?? "")].slice(0, menuWidth - 4).join("");
      this.overlay(
        rows,
        index + 2,
        left,
        `| ${text.padEnd(menuWidth - 4)} |`,
        selected ? 0 : 15,
        selected ? 11 : 8,
      );
    }
    this.overlay(
      rows,
      entries.length + 2,
      left,
      `+${"-".repeat(menuWidth - 2)}+`,
      15,
      8,
    );
    return { x: left + 3, y: this.menuItemIndex + 3 };
  }

  private drawSearchDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.max(18, Math.min(40, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 5) / 2));
    const available = Math.max(1, width - 4);
    const visible = [...this.searchQuery].slice(-available).join("");
    this.drawDialog(rows, top, left, width, "Find", [
      ` ${visible.padEnd(available)} `,
      " Enter Find  Esc Cancel ",
    ]);
    return { x: left + 2 + [...visible].length, y: top + 2 };
  }

  private drawExitDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.max(18, Math.min(42, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 5) / 2));
    this.drawDialog(rows, top, left, width, "Save Changes", [
      " Save changes before exit? ",
      " Y Save  N Discard  Esc Cancel ",
    ]);
    return { x: left + 2, y: top + 3 };
  }

  private drawDialog(
    rows: HighlightedCell[][],
    top: number,
    left: number,
    width: number,
    title: string,
    body: readonly string[],
  ): void {
    const titleText = ` ${title} `;
    const remaining = Math.max(0, width - 2 - [...titleText].length);
    this.overlay(
      rows,
      top,
      left,
      `+${titleText}${"-".repeat(remaining)}+`,
      15,
      8,
    );
    for (let index = 0; index < body.length; index += 1) {
      const text = [...(body[index] ?? "")].slice(0, width - 2).join("");
      this.overlay(
        rows,
        top + index + 1,
        left,
        `|${text.padEnd(width - 2)}|`,
        15,
        8,
      );
    }
    this.overlay(
      rows,
      top + body.length + 1,
      left,
      `+${"-".repeat(width - 2)}+`,
      15,
      8,
    );
  }

  private statusLine(): string {
    const left = `${this.displayName}${this.dirty ? " [Modified]" : ""}`;
    const right = `Ln ${String(this.cursorLine + 1)} Col ${String(this.cursorColumn + 1)} ${this.insertMode ? "INS" : "OVR"}`;
    const available = this.width - [...right].length - 1;
    if (available <= 0) return right.slice(0, this.width);
    return `${[...left].slice(0, available).join("").padEnd(available)} ${right}`;
  }

  private helpLine(): string {
    if (this.modeValue === "search")
      return "Find: type text, Enter find, Esc cancel";
    if (this.modeValue === "confirm-exit")
      return "Y Save  N Discard  Esc Cancel";
    if (this.modeValue === "menu")
      return "Arrows navigate  Enter select  Esc cancel";
    if (this.status === "Ready")
      return "F1 Help F2 Save F3 Next Ctrl+F Find Ctrl+C/X/V F10 Menu";
    return `${this.status} | F2 Save  F10 Menu`;
  }

  private keyboardHelp(): string {
    return "Arrows move  Drag selects  Ctrl+C/X/V clipboard  F2 saves";
  }

  private menuHeading(index: number): {
    readonly start: number;
    readonly width: number;
  } {
    let start = 0;
    for (let current = 0; current < index; current += 1) {
      start += [...menuLabels[menuOrder[current]!]].length + 3;
    }
    return { start, width: [...menuLabels[menuOrder[index]!]].length + 2 };
  }

  private editingCursor(): { readonly x: number; readonly y: number } {
    return {
      x: Math.max(
        1,
        Math.min(this.width, this.cursorColumn - this.viewLeft + 1),
      ),
      y: Math.max(
        2,
        Math.min(this.height - 2, this.cursorLine - this.viewTop + 2),
      ),
    };
  }

  private ensureVisible(): void {
    this.clampCursor();
    if (this.cursorLine < this.viewTop) this.viewTop = this.cursorLine;
    if (this.cursorLine >= this.viewTop + this.contentRows) {
      this.viewTop = this.cursorLine - this.contentRows + 1;
    }
    if (this.cursorColumn < this.viewLeft) this.viewLeft = this.cursorColumn;
    if (this.cursorColumn >= this.viewLeft + this.width) {
      this.viewLeft = this.cursorColumn - this.width + 1;
    }
    this.viewTop = Math.max(0, this.viewTop);
    this.viewLeft = Math.max(0, this.viewLeft);
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

  private currentCharacters(): string[] {
    return [...(this.lines[this.cursorLine] ?? "")];
  }

  private get contentRows(): number {
    return this.height - 3;
  }

  private continue(status: string): EditorResult {
    this.status = status;
    return { kind: "continue", screen: this.screen() };
  }

  private plainRow(
    value: string,
    foreground: number,
    background: number,
  ): HighlightedCell[] {
    const row = [...value].slice(0, this.width).map((character) => ({
      background,
      character,
      foreground,
    }));
    while (row.length < this.width)
      row.push({ background, character: " ", foreground });
    return row;
  }

  private overlay(
    rows: HighlightedCell[][],
    y: number,
    x: number,
    value: string,
    foreground: number,
    background: number,
  ): void {
    const row = rows[y];
    if (row === undefined) return;
    for (const [offset, character] of [...value].entries()) {
      if (x + offset >= this.width) break;
      if (x + offset >= 0)
        row[x + offset] = { background, character, foreground };
    }
  }

  private paint(
    row: HighlightedCell[],
    start: number,
    width: number,
    foreground: number,
    background: number,
  ): void {
    for (
      let index = start;
      index < Math.min(row.length, start + width);
      index += 1
    ) {
      row[index] = { ...row[index]!, background, foreground };
    }
  }

  private requireTerminalSize(width: number, height: number): void {
    if (width < 20 || height < 6)
      throw new RangeError("EDIT terminal is too small");
  }

  private assertEditing(): void {
    if (this.stateValue !== "editing")
      throw new Error("EDIT session is already closed");
  }
}
