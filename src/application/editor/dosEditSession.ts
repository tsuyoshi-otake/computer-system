import type {
  DosFileDialogEntry,
  DosFileDialogProvider,
  DosFileDialogSnapshot,
  EditorResult,
  EditorScreen,
} from "./editorScreen.js";
import {
  highlightLineWithState,
  type HighlightedCell,
} from "./syntaxHighlight.js";
import {
  collectViCompletions,
  findViDefinition,
  maximumViBufferSummaries,
  maximumViJumpHistory,
  viWordAt,
  viWordPrefix,
  type ViBufferSummary,
  type ViCompletionCandidate,
  type ViExternalContextProvider,
  type ViExternalDocument,
} from "./viCompletion.js";
import {
  indexViDocument,
  resolveViFiletype,
  type ViDocumentIndex,
  type ViLexState,
  type ViSymbol,
} from "./viLanguage.js";
import {
  defaultDosEditorProfileOptions,
  emptyDosEditorConfiguration,
  resolveDosEditorOptions,
  serializeDosEditorConfiguration,
  updateDosEditorProfile,
  type DosEditorConfiguration,
  type DosEditorOptions,
  type DosEditorProfile,
} from "./dosEditorOptions.js";
import {
  dosTuiColor,
  dosTuiSingleLineBox as singleLineBox,
  drawDosTuiShadow,
} from "./dosTuiTheme.js";
import {
  editorLineNumberDigits,
  maximumEditorDocumentLines,
} from "./editorDocumentLimits.js";

export { dosTuiColor } from "./dosTuiTheme.js";

export type DosEditMode =
  | "command"
  | "completion"
  | "confirm-exit"
  | "confirm-save"
  | "editing"
  | "file-dialog"
  | "help"
  | "menu"
  | "options"
  | "output"
  | "replace"
  | "save-as"
  | "search"
  | "symbols";

type MenuName = "edit" | "file" | "help" | "options" | "search" | "tools";
export type DosEditAction =
  | "copy"
  | "cut"
  | "default-settings"
  | "display-options"
  | "dos-command"
  | "editing-options"
  | "exit"
  | "find"
  | "find-next"
  | "goto-back"
  | "goto-definition"
  | "help"
  | "new"
  | "open"
  | "paste"
  | "print"
  | "replace"
  | "repeat-dos-command"
  | "reload-settings"
  | "save"
  | "save-as"
  | "select-all"
  | "save-settings"
  | "completion-options"
  | "insert-command-output"
  | "language-options"
  | "symbols"
  | "toggle-insert"
  | "undo";

interface MenuEntry {
  readonly action: DosEditAction;
  readonly label: string;
  readonly separatorBefore?: boolean;
  readonly shortcut: string;
  readonly mnemonic: string;
}

interface UndoOperation {
  readonly cursorColumn: number;
  readonly cursorLine: number;
  readonly deleteCount: number;
  readonly index: number;
  readonly lines: readonly string[];
  readonly revisionBefore: number;
}

export interface DosEditSessionOptions {
  readonly configuration?: DosEditorConfiguration;
  readonly externalContext?: ViExternalContextProvider;
  readonly profile?: DosEditorProfile;
}

type OptionPage = "completion" | "display" | "editing" | "language";
const classicDisplayFieldCount = 5;
const genericOptionButtons = ["< OK >", "< Cancel >"] as const;
const genericOptionButtonGap = 4;
interface CompletionState {
  readonly candidates: readonly ViCompletionCandidate[];
  readonly prefixStart: number;
  selected: number;
}
interface JumpLocation {
  readonly column: number;
  readonly line: number;
  readonly path: string;
}

type PendingTransition = "exit" | "new" | "open";
type FileDialogFocus = "files" | "filter" | "name";
type FileDialogPurpose = "open" | "save-as";

interface PendingSaveDecision {
  readonly closeAfter: boolean;
  readonly contents: string;
  readonly fileName: string;
  readonly kind: "external-change" | "replace";
  readonly targetSnapshot?: string;
}

const maximumEditorLines = maximumEditorDocumentLines;
const maximumClipboardCharacters = 4_096;
const maximumLineCharacters = 4_096;
const maximumSearchCharacters = 64;
const maximumSaveAsCharacters = 128;
const maximumUndoStates = 32;
const maximumReplacements = 4_096;
const maximumRenderedLineCacheEntries = 64;

const menuOrder = [
  "file",
  "edit",
  "search",
  "tools",
  "options",
  "help",
] as const;
const editMenuOrder: readonly MenuName[] = [
  "file",
  "edit",
  "search",
  "options",
  "help",
];
const menuLabels: Readonly<Record<MenuName, string>> = {
  edit: "Edit",
  file: "File",
  help: "Help",
  options: "Options",
  search: "Search",
  tools: "Tools",
};
const menuEntries: Readonly<Record<MenuName, readonly MenuEntry[]>> = {
  file: [
    { action: "new", label: "New", mnemonic: "n", shortcut: "Ctrl+N" },
    { action: "open", label: "Open...", mnemonic: "o", shortcut: "Ctrl+O" },
    { action: "save", label: "Save", mnemonic: "s", shortcut: "F2" },
    {
      action: "save-as",
      label: "Save As...",
      mnemonic: "a",
      shortcut: "Ctrl+Shift+S",
    },
    {
      action: "print",
      label: "Print...",
      mnemonic: "p",
      separatorBefore: true,
      shortcut: "",
    },
    {
      action: "exit",
      label: "Exit",
      mnemonic: "x",
      separatorBefore: true,
      shortcut: "Alt+F X",
    },
  ],
  edit: [
    { action: "undo", label: "Undo", mnemonic: "u", shortcut: "Ctrl+Z" },
    { action: "cut", label: "Cut", mnemonic: "t", shortcut: "Ctrl+X" },
    { action: "copy", label: "Copy", mnemonic: "c", shortcut: "Ctrl+C" },
    { action: "paste", label: "Paste", mnemonic: "p", shortcut: "Ctrl+V" },
    {
      action: "select-all",
      label: "Select All",
      mnemonic: "a",
      shortcut: "Ctrl+A",
    },
  ],
  search: [
    { action: "find", label: "Find", mnemonic: "f", shortcut: "Ctrl+F" },
    {
      action: "find-next",
      label: "Find Next",
      mnemonic: "n",
      shortcut: "F3",
    },
    {
      action: "replace",
      label: "Replace...",
      mnemonic: "r",
      shortcut: "Ctrl+H",
    },
    {
      action: "symbols",
      label: "Document Symbols...",
      mnemonic: "s",
      shortcut: "Ctrl+Shift+O",
    },
    {
      action: "goto-definition",
      label: "Go To Definition",
      mnemonic: "d",
      shortcut: "F12",
    },
    {
      action: "goto-back",
      label: "Go Back",
      mnemonic: "b",
      shortcut: "Alt+Left",
    },
  ],
  tools: [
    {
      action: "dos-command",
      label: "DOS Command...",
      mnemonic: "d",
      shortcut: "",
    },
    {
      action: "repeat-dos-command",
      label: "Repeat DOS Command",
      mnemonic: "r",
      shortcut: "",
    },
    {
      action: "insert-command-output",
      label: "Insert Command Output...",
      mnemonic: "i",
      shortcut: "",
    },
  ],
  options: [
    {
      action: "display-options",
      label: "Display...",
      mnemonic: "d",
      shortcut: "",
    },
    {
      action: "editing-options",
      label: "Editing...",
      mnemonic: "e",
      shortcut: "",
    },
    {
      action: "completion-options",
      label: "Completion...",
      mnemonic: "c",
      shortcut: "Ctrl+Space",
    },
    {
      action: "language-options",
      label: "Language...",
      mnemonic: "l",
      shortcut: "",
    },
    {
      action: "toggle-insert",
      label: "Insert/Overwrite",
      mnemonic: "i",
      shortcut: "Ins",
    },
    {
      action: "save-settings",
      label: "Save Settings",
      mnemonic: "s",
      shortcut: "",
    },
    {
      action: "reload-settings",
      label: "Reload Settings",
      mnemonic: "r",
      shortcut: "",
    },
    {
      action: "default-settings",
      label: "Restore Defaults",
      mnemonic: "f",
      shortcut: "",
    },
  ],
  help: [
    { action: "help", label: "Keyboard Help", mnemonic: "h", shortcut: "F1" },
  ],
};
const editFileMenuEntries: readonly MenuEntry[] = menuEntries.file;

export class DosEditSession {
  private readonly bufferSummaries: ViBufferSummary[] = [];
  private clipboard = "";
  private commandInput = "";
  private commandInsertOutput = false;
  private completion?: CompletionState;
  private confirmExitChoice = 0;
  private configurationValue: DosEditorConfiguration;
  private readonly externalContext?: ViExternalContextProvider;
  private readonly lines: string[];
  private readonly jumpHistory: JumpLocation[] = [];
  private indexCache?: {
    readonly fileName: string;
    readonly filetype: string;
    readonly index: ViDocumentIndex;
    readonly revision: number;
  };
  private includeCache?: {
    readonly documents: readonly ViExternalDocument[];
    readonly fileName: string;
    readonly revision: number;
  };
  private lastShellCommand?: string;
  private optionIndex = 0;
  private optionPage: OptionPage = "display";
  private optionsValue: DosEditorOptions;
  private optionsSnapshot?: DosEditorOptions;
  private outputLines: readonly string[] = [];
  private outputTop = 0;
  private pendingConfiguration?: DosEditorConfiguration;
  private readonly profile: DosEditorProfile;
  private symbolIndex = 0;
  private readonly undo: UndoOperation[] = [];
  private cursorColumn = 0;
  private cursorLine = 0;
  private fileDialogFilter = "*.*";
  private fileDialogFocus: FileDialogFocus = "files";
  private fileDialogPath = "";
  private fileDialogPurpose: FileDialogPurpose = "open";
  private fileDialogSelection = 0;
  private fileDialogSnapshot?: DosFileDialogSnapshot;
  private fileDialogTop = 0;
  private insertMode = true;
  private lastSearch = "";
  private menuIndex = 0;
  private menuItemIndex = 0;
  private modeValue: DosEditMode = "editing";
  private pendingTransition?: PendingTransition;
  private pendingSaveDecision?: PendingSaveDecision;
  private replaceField: "find" | "replacement" = "find";
  private replacementText = "";
  private revision = 0;
  private savedRevision = 0;
  private lastRenderedScreen?: EditorScreen;
  private lineDecodeCountValue = 0;
  private readonly renderedLineCache = new Map<
    number,
    { readonly characters: readonly string[]; readonly value: string }
  >();
  private screenBuildCountValue = 0;
  private saveAsPath = "";
  private screenBatch?: EditorScreen;
  private searchQuery = "";
  private selectionAnchor?: { readonly column: number; readonly line: number };
  private sourceSnapshot?: string;
  private stateValue: "closed" | "editing" = "editing";
  private status = "Ready";
  private viewLeft = 0;
  private viewTop = 0;
  private viewTopSegment = 0;

  constructor(
    public fileName: string,
    contents: string,
    private widthValue = 51,
    private heightValue = 19,
    public displayName = fileName,
    sourceExists = true,
    private readonly fileDialogProvider?: DosFileDialogProvider,
    sessionOptions: DosEditSessionOptions = {},
  ) {
    this.requireTerminalSize(widthValue, heightValue);
    this.lines = normalizeEditorContents(contents);
    if (this.lines.length === 0) this.lines.push("");
    this.profile = sessionOptions.profile ?? "edit";
    this.configurationValue =
      sessionOptions.configuration ?? emptyDosEditorConfiguration();
    this.optionsValue = resolveDosEditorOptions(
      this.configurationValue,
      this.profile,
    );
    this.externalContext = sessionOptions.externalContext;
    this.sourceSnapshot = sourceExists ? contents : undefined;
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

  get modified(): boolean {
    return this.revision !== this.savedRevision;
  }

  get options(): DosEditorOptions {
    return this.optionsValue;
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  get statusPosition(): string {
    const position = `${String(this.cursorLine + 1).padStart(5, "0")}:${String(this.cursorColumn + 1).padStart(3, "0")}`;
    return this.profile === "edit"
      ? position
      : `${this.insertMode ? "N" : "O"} ${position}`;
  }

  get screenBuildCount(): number {
    return this.screenBuildCountValue;
  }

  get lineDecodeCount(): number {
    return this.lineDecodeCountValue;
  }

  resize(width: number, height: number): EditorScreen {
    this.requireTerminalSize(width, height);
    this.widthValue = width;
    this.heightValue = height;
    return this.screen();
  }

  beginKeyBatch(): void {
    if (this.screenBatch !== undefined) {
      throw new Error("Editor key batch is already active");
    }
    this.screenBatch = this.lastRenderedScreen ?? this.screen();
  }

  endKeyBatch(): EditorScreen {
    if (this.screenBatch === undefined) {
      throw new Error("Editor key batch is not active");
    }
    this.screenBatch = undefined;
    return this.screen();
  }

  screen(): EditorScreen {
    if (this.screenBatch !== undefined) return this.screenBatch;
    this.screenBuildCountValue += 1;
    this.ensureVisible();
    const rows: HighlightedCell[][] = [];
    rows.push(this.menuBar());
    rows.push(this.titleBar());
    let lineIndex = this.viewTop;
    let segment = this.optionsValue.wrap ? this.viewTopSegment : 0;
    let lexState: ViLexState = { multiline: null };
    for (let offset = 0; offset < this.contentRows; offset += 1) {
      if (lineIndex >= this.lines.length) {
        rows.push(this.plainRow("", dosTuiColor.white, dosTuiColor.document));
        continue;
      }
      const rendered = this.renderLineRow(lineIndex, segment, lexState);
      rows.push(rendered.cells);
      lexState = rendered.state;
      if (!this.optionsValue.wrap) {
        lineIndex += 1;
      } else {
        segment += 1;
        if (segment >= this.visualRowCount(lineIndex)) {
          lineIndex += 1;
          segment = 0;
        }
      }
    }
    rows.push(this.horizontalScrollBar());
    rows.push(
      this.plainRow(this.footerLine(), dosTuiColor.black, dosTuiColor.status),
    );
    this.drawDocumentLeftBorder(rows);
    this.drawVerticalScrollBar(rows);

    let cursor = this.editingCursor();
    if (this.modeValue === "menu") cursor = this.drawMenu(rows);
    else if (this.modeValue === "completion") {
      cursor = this.drawCompletion(rows);
    } else if (this.modeValue === "options") cursor = this.drawOptions(rows);
    else if (this.modeValue === "symbols") cursor = this.drawSymbols(rows);
    else if (this.modeValue === "command") cursor = this.drawCommand(rows);
    else if (this.modeValue === "output") cursor = this.drawOutput(rows);
    else if (this.modeValue === "search") cursor = this.drawSearchDialog(rows);
    else if (this.modeValue === "replace")
      cursor = this.drawReplaceDialog(rows);
    else if (this.modeValue === "file-dialog") {
      cursor = this.drawFileDialog(rows);
    } else if (this.modeValue === "save-as")
      cursor = this.drawSaveAsDialog(rows);
    else if (this.modeValue === "help") cursor = this.drawHelpDialog(rows);
    else if (this.modeValue === "confirm-exit") {
      cursor = this.drawExitDialog(rows);
    } else if (this.modeValue === "confirm-save") {
      cursor = this.drawSaveDecisionDialog(rows);
    }
    const screen = { cursor, rows };
    this.lastRenderedScreen = screen;
    return screen;
  }

  key(key: string): EditorResult {
    this.assertEditing();
    if (key.length > 32) return this.continue("Key ignored");
    if (this.modeValue === "completion") return this.completionKey(key);
    if (this.modeValue === "options") return this.optionsKey(key);
    if (this.modeValue === "symbols") return this.symbolsKey(key);
    if (this.modeValue === "command") return this.commandKey(key);
    if (this.modeValue === "output") return this.outputKey(key);
    if (this.modeValue === "confirm-exit") return this.confirmExitKey(key);
    if (this.modeValue === "confirm-save") return this.confirmSaveKey(key);
    if (this.modeValue === "file-dialog") return this.fileDialogKey(key);
    if (this.modeValue === "help") return this.helpKey(key);
    if (this.modeValue === "replace") return this.replaceKey(key);
    if (this.modeValue === "save-as") return this.saveAsKey(key);
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
    if (
      this.modeValue === "file-dialog" &&
      this.fileDialogProvider !== undefined
    ) {
      return this.fileDialogPointerDown(x - 1, y - 1);
    }
    if (this.modeValue === "save-as") {
      return this.saveAsPointerDown(x - 1, y - 1);
    }
    if (this.modeValue === "confirm-exit") {
      return this.confirmExitPointerDown(x - 1, y - 1);
    }
    if (this.modeValue === "confirm-save") {
      return this.confirmSavePointerDown(x - 1, y - 1);
    }
    if (this.modeValue === "help") return this.helpKey("Escape");
    if (this.modeValue === "options") {
      return this.optionsPointerDown(x - 1, y - 1);
    }
    if (this.modeValue !== "editing" && this.modeValue !== "menu") {
      return this.continue("Finish the active dialog with the keyboard");
    }
    const column = x - 1;
    const row = y - 1;
    if (row === 0) {
      const menu = this.visibleMenuOrder.findIndex((_name, index) => {
        const heading = this.menuHeading(index);
        return (
          column >= heading.start && column < heading.start + heading.width
        );
      });
      if (menu >= 0) return this.openMenu(this.visibleMenuOrder[menu]!);
    }
    if (this.modeValue === "menu") {
      const entries = this.activeMenuEntries();
      const item = entries.findIndex(
        (_entry, index) => row === this.menuEntryRow(entries, index),
      );
      const box = this.menuBox();
      if (
        column >= box.left &&
        column < box.left + box.width &&
        item >= 0 &&
        item < entries.length
      ) {
        this.menuItemIndex = item;
        return this.applyMenuAction(entries[item]!.action);
      }
      this.modeValue = "editing";
      return this.continue("Menu cancelled");
    }
    if (row >= 2 && row < this.contentRows + 2 && column === this.width - 1) {
      return this.verticalScrollPointer(row - 2);
    }
    if (row === this.height - 2) {
      return this.horizontalScrollPointer(column);
    }
    if (row >= 2 && row < this.contentRows + 2 && column < this.width - 1) {
      this.modeValue = "editing";
      this.movePointer(column, row - 1);
      this.selectionAnchor = this.cursor;
      return this.continue("Pointer cursor");
    }
    return this.continue(this.status);
  }

  pointerMove(x: number, y: number): EditorResult {
    this.assertEditing();
    if (this.modeValue !== "editing") {
      return this.continue("Finish the active dialog with the keyboard");
    }
    if (
      this.selectionAnchor === undefined ||
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x < 1 ||
      x > this.width - 1 ||
      y < 3 ||
      y > this.contentRows + 2
    ) {
      return this.continue("Pointer ignored");
    }
    this.movePointer(x - 1, y - 2);
    return this.continue(
      this.selectedRange() === undefined ? "Pointer cursor" : "Selected",
    );
  }

  private verticalScrollPointer(offset: number): EditorResult {
    if (offset <= 0) {
      this.cursorLine -= 1;
    } else if (offset >= this.contentRows - 1) {
      this.cursorLine += 1;
    } else {
      const maximumTop = Math.max(0, this.lines.length - this.contentRows);
      const trackLength = Math.max(1, this.contentRows - 2);
      const ratio = (offset - 1) / Math.max(1, trackLength - 1);
      this.cursorLine = Math.round(ratio * maximumTop);
    }
    this.selectionAnchor = undefined;
    this.clampCursor();
    return this.continue("Vertical scroll");
  }

  private horizontalScrollPointer(column: number): EditorResult {
    if (column <= 0) {
      this.cursorColumn -= 1;
    } else if (column >= this.width - 1) {
      this.cursorColumn += 1;
    } else {
      const maximumLeft = Math.max(
        0,
        this.currentCharacters().length - this.contentWidth,
      );
      const ratio = (column - 1) / Math.max(1, this.width - 3);
      this.cursorColumn = Math.round(ratio * maximumLeft);
    }
    this.selectionAnchor = undefined;
    this.clampCursor();
    return this.continue("Horizontal scroll");
  }

  completeSave(
    closeAfter: boolean,
    savedFileName?: string,
    savedDisplayName?: string,
  ): EditorResult {
    if (savedFileName !== undefined) this.fileName = savedFileName;
    if (savedDisplayName !== undefined) this.displayName = savedDisplayName;
    this.sourceSnapshot = this.serializedContents;
    this.fileDialogSnapshot = undefined;
    this.savedRevision = this.revision;
    this.status = `Saved ${this.displayName}`;
    if (this.pendingTransition !== undefined) {
      const transition = this.pendingTransition;
      this.pendingTransition = undefined;
      return this.executeTransition(transition);
    }
    if (!closeAfter) return { kind: "continue", screen: this.screen() };
    this.stateValue = "closed";
    return { kind: "closed", discardedChanges: false, screen: this.screen() };
  }

  failSave(detail: string): EditorResult {
    this.modeValue =
      this.pendingTransition === undefined ? "editing" : "confirm-exit";
    return this.continue(`Save failed: ${detail}`);
  }

  private fileDialogPointerDown(column: number, row: number): EditorResult {
    if (this.usesClassicFileDialog) {
      return this.classicFileDialogPointerDown(column, row);
    }
    const width = Math.max(32, Math.min(70, this.width - 2));
    const left = Math.floor((this.width - width) / 2);
    const listRows = this.fileDialogListRows;
    const top = Math.max(1, Math.floor((this.height - (listRows + 7)) / 2));
    if (row === top + 2) {
      if (column >= left + 10 && column <= left + 13) {
        this.refreshFileDialog("C:\\", false);
        return this.continue(this.status);
      }
      if (column >= left + 15 && column <= left + 18) {
        this.refreshFileDialog("A:\\", false);
        return this.continue(this.status);
      }
    }
    if (row === top + 3) {
      this.fileDialogFocus = "filter";
      return this.continue("Open File: filter");
    }
    if (row >= top + 4 && row < top + 4 + listRows) {
      const index = this.fileDialogTop + row - (top + 4);
      if (index < this.filteredFileDialogEntries().length) {
        this.fileDialogSelection = index;
        this.fileDialogFocus = "files";
        const selected = this.filteredFileDialogEntries()[index];
        if (this.fileDialogPurpose === "save-as" && selected?.kind === "file") {
          this.fileDialogPath = selected.displayName;
        }
        return this.continue("Open File: select an entry");
      }
      return this.continue("No file is selected");
    }
    if (row === top + listRows + 4) {
      this.fileDialogFocus = "name";
      return this.continue("Open File: name");
    }
    if (row === top + listRows + 5) {
      if (column >= left + 2 && column <= left + 9) {
        return this.fileDialogPath.trim().length > 0
          ? this.openNamedFileDialogEntry()
          : this.openSelectedFileDialogEntry();
      }
      if (column >= left + 13 && column <= left + 22) {
        return this.fileDialogKey("Escape");
      }
    }
    return this.continue("Open File");
  }

  private classicFileDialogPointerDown(
    column: number,
    row: number,
  ): EditorResult {
    const geometry = this.classicFileDialogGeometry();
    if (row === geometry.fieldRow) {
      this.fileDialogFocus =
        this.fileDialogPurpose === "open" ? "filter" : "name";
      return this.continue(`Open File: ${this.fileDialogFocus}`);
    }
    if (row >= geometry.listTop && row < geometry.listTop + geometry.listRows) {
      const offset = row - geometry.listTop;
      const panes = this.classicFileDialogPaneRows(geometry.listRows);
      let selected: DosFileDialogEntry | undefined;
      if (
        column > geometry.filesLeft &&
        column < geometry.filesLeft + geometry.filesWidth - 1
      ) {
        selected = panes.files[offset];
      } else if (
        column > geometry.directoriesLeft &&
        column < geometry.directoriesLeft + geometry.directoriesWidth - 1
      ) {
        selected = panes.directories[offset];
        const drive = panes.drives[offset - panes.directories.length];
        if (selected === undefined && drive !== undefined) {
          this.refreshFileDialog(`${drive}\\`, false);
          return this.continue(this.status);
        }
      }
      if (selected !== undefined) {
        const index = this.filteredFileDialogEntries().findIndex(
          ({ fileName }) => fileName === selected.fileName,
        );
        if (index >= 0) {
          this.fileDialogSelection = index;
          this.fileDialogFocus = "files";
          if (
            this.fileDialogPurpose === "save-as" &&
            selected.kind === "file"
          ) {
            this.fileDialogPath = selected.displayName;
          }
          return this.continue("Open File: select an entry");
        }
      }
      return this.continue("No file is selected");
    }
    if (this.optionPage !== "display" && row === geometry.buttonRow) {
      if (column < geometry.left + Math.floor(geometry.width / 2)) {
        return this.fileDialogPath.trim().length > 0
          ? this.openNamedFileDialogEntry()
          : this.openSelectedFileDialogEntry();
      }
      return this.fileDialogKey("Escape");
    }
    return this.continue("Open File");
  }

  private saveAsPointerDown(column: number, row: number): EditorResult {
    const width = Math.max(24, Math.min(58, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 5) / 2));
    if (row === top + 1) return this.continue("Save As");
    if (row === top + 2) {
      return column < left + 15
        ? this.saveAsKey("Enter")
        : this.saveAsKey("Escape");
    }
    return this.continue("Save As");
  }

  private confirmExitPointerDown(column: number, row: number): EditorResult {
    const width = Math.max(38, Math.min(54, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 7) / 2));
    const buttonRow = top + (this.status.startsWith("Save failed:") ? 3 : 2);
    if (row !== buttonRow)
      return this.continue("Save changes decision required");
    if (column < left + 12) this.confirmExitChoice = 0;
    else if (column < left + 23) this.confirmExitChoice = 1;
    else if (column < left + 35) this.confirmExitChoice = 2;
    else this.confirmExitChoice = 3;
    return this.confirmExitKey("Enter");
  }

  private confirmSavePointerDown(column: number, row: number): EditorResult {
    const width = Math.max(28, Math.min(64, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 6) / 2));
    if (row !== top + 2) return this.continue("Save decision required");
    if (column < left + 14) return this.confirmSaveKey("y");
    if (
      this.pendingSaveDecision?.kind === "external-change" &&
      column < left + 25
    ) {
      return this.confirmSaveKey("r");
    }
    return this.confirmSaveKey("Escape");
  }

  offerSaveDecision(
    kind: PendingSaveDecision["kind"],
    request: Extract<EditorResult, { readonly kind: "save" }>,
    resolvedFileName: string,
    targetSnapshot?: string,
  ): EditorResult {
    this.pendingSaveDecision = {
      closeAfter: request.closeAfter,
      contents: request.contents,
      fileName: resolvedFileName,
      kind,
      targetSnapshot,
    };
    this.modeValue = "confirm-save";
    return this.continue(
      kind === "replace"
        ? "Destination exists; Replace or Cancel"
        : "File changed on disk; Overwrite, Reopen, or Cancel",
    );
  }

  completeOpen(
    fileName: string,
    contents: string,
    displayName = fileName,
  ): EditorResult {
    try {
      this.rememberBuffer();
      this.setDocument(fileName, contents, displayName, true);
      this.fileDialogSnapshot = undefined;
      return this.continue(`Opened ${displayName}`);
    } catch (error: unknown) {
      return this.failOpen(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  goTo(line: number, column: number): EditorResult {
    this.assertEditing();
    if (
      !Number.isSafeInteger(line) ||
      !Number.isSafeInteger(column) ||
      line < 1 ||
      column < 1
    ) {
      return this.continue("Invalid source location");
    }
    this.modeValue = "editing";
    this.selectionAnchor = undefined;
    this.cursorLine = Math.min(this.lines.length - 1, line - 1);
    this.cursorColumn = Math.min(this.currentCharacters().length, column - 1);
    this.viewTop = Math.max(
      0,
      this.cursorLine - Math.floor(this.contentRows / 2),
    );
    this.ensureVisible();
    return this.continue(
      `Diagnostic ${this.displayName}(${String(line)},${String(column)})`,
    );
  }

  failOpen(detail: string): EditorResult {
    this.modeValue =
      this.fileDialogProvider !== undefined &&
      this.fileDialogSnapshot !== undefined
        ? "file-dialog"
        : "editing";
    this.pendingTransition = undefined;
    return this.continue(`Open failed: ${detail}`);
  }

  private editingKey(key: string): EditorResult {
    const normalized = key.toLowerCase();
    if (normalized === "ctrl+space" || normalized === "alt+/") {
      return this.beginCompletion();
    }
    if (normalized === "ctrl+shift+o") return this.beginSymbols();
    if (key === "F12") return this.goToDefinition();
    if (normalized === "alt+left") return this.goBack();
    if (key === "F1") return this.beginHelp();
    if (key === "F2" || normalized === "ctrl+s") return this.save(false);
    if (normalized === "ctrl+n") return this.requestTransition("new");
    if (normalized === "ctrl+o") return this.requestTransition("open");
    if (normalized === "ctrl+shift+s") return this.beginSaveAs();
    if (key === "F3") return this.findNext();
    if (key === "F10") return this.openMenu("file");
    if (normalized === "ctrl+a") return this.selectAll();
    if (normalized === "ctrl+c") return this.copySelection();
    if (normalized === "ctrl+f") return this.beginSearch();
    if (normalized === "ctrl+h") return this.beginReplace();
    if (normalized === "ctrl+v") return this.pasteClipboard();
    if (normalized === "ctrl+x") return this.cutSelection();
    if (normalized === "ctrl+z") return this.undoLast();
    if (normalized === "ctrl+y") return this.deleteLine();
    if (normalized.startsWith("alt+") && normalized.length === 5) {
      return this.openMenuByMnemonic(normalized.at(-1) ?? "");
    }
    if (key.startsWith("Shift+")) {
      const movement = key.slice("Shift+".length);
      if (
        movement === "ArrowLeft" ||
        movement === "ArrowRight" ||
        movement === "ArrowUp" ||
        movement === "ArrowDown" ||
        movement === "Home" ||
        movement === "End" ||
        movement === "PageUp" ||
        movement === "PageDown"
      ) {
        return this.extendSelection(movement);
      }
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
    else if (key === "Tab") {
      return this.insertText(
        this.optionsValue.expandtab
          ? " ".repeat(
              this.optionsValue.tabstop -
                (this.cursorColumn % this.optionsValue.tabstop),
            )
          : "\t",
      );
    } else if ([...key].length === 1) return this.insertText(key);
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
        (this.menuIndex + direction + this.visibleMenuOrder.length) %
        this.visibleMenuOrder.length;
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
      if (
        this.profile === "edit" &&
        this.visibleMenuOrder[this.menuIndex] === "file"
      ) {
        const extension = menuEntries.tools.find(
          ({ mnemonic }) => mnemonic === normalized,
        );
        if (extension !== undefined) {
          return this.applyMenuAction(extension.action);
        }
      }
    }
    return this.continue("Menu");
  }

  invoke(action: DosEditAction): EditorResult {
    this.assertEditing();
    if (this.modeValue !== "editing") {
      return this.continue("Finish the active dialog first");
    }
    return this.applyMenuAction(action);
  }

  private applyMenuAction(action: DosEditAction): EditorResult {
    this.modeValue = "editing";
    if (action === "new") return this.requestTransition("new");
    if (action === "open") return this.requestTransition("open");
    if (action === "save") return this.save(false);
    if (action === "save-as") return this.beginSaveAs();
    if (action === "print") {
      return this.continue("Print is not available in CS-DOS Editor");
    }
    if (action === "exit") return this.requestExit();
    if (action === "undo") return this.undoLast();
    if (action === "copy") return this.copySelection();
    if (action === "cut") return this.cutSelection();
    if (action === "paste") return this.pasteClipboard();
    if (action === "select-all") return this.selectAll();
    if (action === "find") return this.beginSearch();
    if (action === "find-next") return this.findNext();
    if (action === "replace") return this.beginReplace();
    if (action === "symbols") return this.beginSymbols();
    if (action === "goto-definition") return this.goToDefinition();
    if (action === "goto-back") return this.goBack();
    if (action === "display-options") return this.beginOptions("display");
    if (action === "editing-options") return this.beginOptions("editing");
    if (action === "completion-options") return this.beginOptions("completion");
    if (action === "language-options") return this.beginOptions("language");
    if (action === "save-settings") return this.saveSettings();
    if (action === "reload-settings") {
      this.status = "Reloading C:\\EDITOR.INI...";
      return { kind: "settings-reload", screen: this.screen() };
    }
    if (action === "default-settings") {
      this.setOptions(defaultDosEditorProfileOptions(this.profile));
      return this.continue("Default settings restored for this session");
    }
    if (action === "dos-command") return this.beginCommand(false);
    if (action === "insert-command-output") return this.beginCommand(true);
    if (action === "repeat-dos-command") return this.repeatCommand();
    if (action === "toggle-insert") {
      this.insertMode = !this.insertMode;
      return this.continue(this.insertMode ? "Insert mode" : "Overwrite mode");
    }
    return this.beginHelp();
  }

  completeSettingsSave(): EditorResult {
    if (this.pendingConfiguration !== undefined) {
      this.configurationValue = this.pendingConfiguration;
      this.pendingConfiguration = undefined;
    }
    this.modeValue = "editing";
    return this.continue("Settings saved to C:\\EDITOR.INI");
  }

  failSettingsSave(detail: string): EditorResult {
    this.pendingConfiguration = undefined;
    this.modeValue = "editing";
    return this.continue(`Settings save failed: ${detail}`);
  }

  completeSettingsReload(configuration: DosEditorConfiguration): EditorResult {
    this.configurationValue = configuration;
    this.pendingConfiguration = undefined;
    this.setOptions(resolveDosEditorOptions(configuration, this.profile));
    this.modeValue = "editing";
    return this.continue("Settings reloaded from C:\\EDITOR.INI");
  }

  failSettingsReload(detail: string): EditorResult {
    this.modeValue = "editing";
    return this.continue(`Settings reload failed: ${detail}`);
  }

  completeShellCommand(
    exitCode: number,
    stdout: string,
    stderr: string,
    insertOutput: boolean,
  ): EditorResult {
    const combined = `${insertOutput ? stdout : `${stdout}${stderr}`}`
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n");
    if (!insertOutput) {
      const characters = [...combined].slice(0, 4_096).join("");
      const outputLines: string[] = [];
      const outputWidth = Math.max(1, this.width - 6);
      for (const source of characters.split("\n")) {
        const line = [...source];
        if (line.length === 0) outputLines.push("");
        for (let start = 0; start < line.length; start += outputWidth) {
          outputLines.push(line.slice(start, start + outputWidth).join(""));
          if (outputLines.length >= 128) break;
        }
        if (outputLines.length >= 128) break;
      }
      this.outputLines = outputLines;
      this.outputTop = 0;
      this.modeValue = "output";
      this.status = `DOS command exit ${String(exitCode)}`;
      return { kind: "continue", screen: this.screen() };
    }
    const lines = combined.split("\n").slice(0, 128);
    if (lines.at(-1) === "") lines.pop();
    let remaining = 4_096;
    const bounded: string[] = [];
    for (const line of lines) {
      if (remaining <= 0) break;
      const value = [...line]
        .slice(0, Math.min(remaining, maximumLineCharacters))
        .join("");
      bounded.push(value);
      remaining -= [...value].length;
    }
    if (bounded.length === 0) {
      this.modeValue = "editing";
      return this.continue(`DOS command exit ${String(exitCode)}; no output`);
    }
    if (this.lines.length + bounded.length > maximumEditorLines) {
      this.modeValue = "editing";
      return this.continue("Command output exceeds document line limit");
    }
    const index = this.cursorLine + 1;
    this.rememberLines(index, bounded.length, []);
    this.lines.splice(index, 0, ...bounded);
    this.cursorLine = index;
    this.cursorColumn = 0;
    this.modeValue = "editing";
    return this.changed(`Inserted command output; exit ${String(exitCode)}`);
  }

  completeNavigation(
    path: string,
    contents: string,
    displayName: string,
    line: number,
    column: number,
  ): EditorResult {
    this.rememberBuffer();
    this.setDocument(path, contents, displayName, true);
    this.cursorLine = Math.max(0, Math.min(this.lines.length - 1, line));
    this.cursorColumn = Math.max(
      0,
      Math.min(this.currentCharacters().length, column),
    );
    return this.continue(`Definition: ${displayName}`);
  }

  failNavigation(detail: string): EditorResult {
    return this.continue(`Definition navigation failed: ${detail}`);
  }

  private saveSettings(): EditorResult {
    const configuration = updateDosEditorProfile(
      this.configurationValue,
      this.profile,
      this.optionsValue,
    );
    let contents: string;
    try {
      contents = serializeDosEditorConfiguration(configuration);
    } catch (error) {
      return this.continue(
        `Settings save failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.pendingConfiguration = configuration;
    this.status = "Saving C:\\EDITOR.INI...";
    return { contents, kind: "settings-save", screen: this.screen() };
  }

  private beginOptions(page: OptionPage): EditorResult {
    this.optionPage = page;
    this.optionIndex = 0;
    this.optionsSnapshot = this.optionsValue;
    this.modeValue = "options";
    return this.continue(`${this.optionPageLabel} options`);
  }

  private optionsPointerDown(column: number, row: number): EditorResult {
    if (
      this.optionPage === "display" &&
      this.width >= 64 &&
      this.height >= 22
    ) {
      const dialogWidth = Math.min(62, this.width - 2);
      const left = Math.floor((this.width - dialogWidth) / 2);
      const top = Math.max(1, Math.floor((this.height - 6) / 2));
      if (row === top + 2) {
        const scrollLeft = left + 5;
        const tabLeft = left + 1 + Math.max(30, dialogWidth - 2 - 20);
        if (column >= scrollLeft && column < scrollLeft + 15) {
          this.optionIndex = 0;
          return this.continue("Scroll Bars field selected");
        }
        if (column >= tabLeft && column < tabLeft + 13) {
          this.optionIndex = 1;
          return this.continue("Tab Stops field selected");
        }
      }
      if (row === top + 4) {
        const buttons = [
          { column: 10, length: 6 },
          { column: 25, length: 10 },
          { column: 43, length: 8 },
        ] as const;
        const selected = buttons.findIndex(
          ({ column: buttonColumn, length }) =>
            column >= left + 1 + buttonColumn &&
            column < left + 1 + buttonColumn + length,
        );
        if (selected >= 0) {
          this.optionIndex = selected + 2;
          return this.displayOptionsKey("Enter");
        }
      }
      return this.continue("Pointer outside Display fields");
    }

    const entries = this.optionRows();
    const geometry = this.genericOptionsGeometry(entries.length);
    const contentColumn = column - geometry.left - 1;
    if (row === geometry.buttonRow) {
      const button = geometry.buttonColumns.findIndex(
        (start, index) =>
          contentColumn >= start &&
          contentColumn < start + genericOptionButtons[index]!.length,
      );
      if (button >= 0) {
        this.optionIndex = entries.length + button;
        return this.optionsKey("Enter");
      }
    }
    const selected = row - geometry.top - 1;
    if (
      column > geometry.left &&
      column < geometry.left + geometry.width - 1 &&
      selected >= 0 &&
      selected < entries.length
    ) {
      this.optionIndex = selected;
      return this.continue(`${this.optionPageLabel} field selected`);
    }
    return this.continue("Pointer outside options fields");
  }

  private optionsKey(key: string): EditorResult {
    if (key === "Escape") return this.finishOptions(true, "Options cancelled");
    if (key === "Tab" || key === "Shift+Tab") {
      const direction = key === "Shift+Tab" ? -1 : 1;
      this.optionIndex =
        (this.optionIndex + direction + this.optionCount) % this.optionCount;
      return this.continue(`${this.optionPageLabel} field selected`);
    }
    if (this.optionPage === "display") return this.displayOptionsKey(key);
    const fieldCount = this.optionRows().length;
    if (key === "ArrowUp" || key === "ArrowDown") {
      const direction = key === "ArrowUp" ? -1 : 1;
      this.optionIndex =
        (this.optionIndex + direction + this.optionCount) % this.optionCount;
      return this.continue(`${this.optionPageLabel} options`);
    }
    if (this.optionIndex >= fieldCount) {
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const direction = key === "ArrowLeft" ? -1 : 1;
        this.optionIndex =
          fieldCount +
          ((this.optionIndex -
            fieldCount +
            direction +
            genericOptionButtons.length) %
            genericOptionButtons.length);
        return this.continue(`${this.optionPageLabel} command selected`);
      }
      if (key === "Enter" || key === " ") {
        return this.optionIndex === fieldCount
          ? this.finishOptions(false, `${this.optionPageLabel} options applied`)
          : this.finishOptions(
              true,
              `${this.optionPageLabel} options cancelled`,
            );
      }
      return this.continue(
        "Tab selects fields and buttons; Enter executes; Esc cancels",
      );
    }
    if (
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "Enter" ||
      key === " "
    ) {
      const direction = key === "ArrowLeft" ? -1 : 1;
      this.adjustOption(direction);
      return this.continue(`${this.optionPageLabel} options updated`);
    }
    return this.continue(
      "Tab selects fields and buttons; arrows change options; Esc cancels",
    );
  }

  private displayOptionsKey(key: string): EditorResult {
    if (key === "F1") {
      this.optionIndex = 4;
      return this.continue(
        "Tab selects fields; arrows change Tab Stops; Enter executes",
      );
    }
    if (
      this.optionIndex >= 2 &&
      (key === "ArrowLeft" || key === "ArrowRight")
    ) {
      const direction = key === "ArrowLeft" ? -1 : 1;
      this.optionIndex = 2 + ((this.optionIndex - 2 + direction + 3) % 3);
      return this.continue("Display command selected");
    }
    if (key === "Enter") {
      if (this.optionIndex === 2) {
        return this.finishOptions(false, "Display options applied");
      }
      if (this.optionIndex === 3) {
        return this.finishOptions(true, "Display options cancelled");
      }
      if (this.optionIndex === 4) {
        return this.continue(
          "Tab selects fields; arrows change Tab Stops; Esc cancels",
        );
      }
    }
    if (
      this.optionIndex === 1 &&
      (key === "ArrowLeft" ||
        key === "ArrowRight" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "Enter" ||
        key === " ")
    ) {
      const direction = key === "ArrowLeft" || key === "ArrowDown" ? -1 : 1;
      const next = ((this.optionsValue.tabstop - 1 + direction + 16) % 16) + 1;
      this.setOptions({ ...this.optionsValue, tabstop: next });
      return this.continue("Display Tab Stops updated");
    }
    if (this.optionIndex === 0) {
      return this.continue("CS-DOS EDIT scroll bars remain enabled");
    }
    return this.continue("Tab selects fields; Enter executes; Esc cancels");
  }

  private finishOptions(restore: boolean, status: string): EditorResult {
    if (restore && this.optionsSnapshot !== undefined) {
      this.setOptions(this.optionsSnapshot);
    }
    this.optionsSnapshot = undefined;
    this.modeValue = "editing";
    return this.continue(status);
  }

  private adjustOption(direction: -1 | 1): void {
    const current = this.optionsValue;
    if (this.optionPage === "display") return;
    if (this.optionPage === "editing") {
      const booleanOptions = [
        "syntax",
        "number",
        "rainbow",
        "list",
        "wrap",
        "autoindent",
        "expandtab",
      ] as const;
      if (this.optionIndex < booleanOptions.length) {
        const key = booleanOptions[this.optionIndex]!;
        this.setOptions({ ...current, [key]: !current[key] });
      } else {
        const key =
          this.optionIndex === booleanOptions.length ? "tabstop" : "shiftwidth";
        const next = ((current[key] - 1 + direction + 16) % 16) + 1;
        this.setOptions({ ...current, [key]: next });
      }
      return;
    }
    if (this.optionPage === "language") {
      const filetypes = [
        "auto",
        "text",
        "basic",
        "c",
        "cpp",
        "asm",
        "python",
      ] as const;
      const currentIndex = filetypes.indexOf(
        current.filetype as (typeof filetypes)[number],
      );
      const next =
        (Math.max(0, currentIndex) + direction + filetypes.length) %
        filetypes.length;
      this.setOptions({ ...current, filetype: filetypes[next]! });
      return;
    }
    if (this.optionIndex === 0) {
      this.setOptions({ ...current, complete: !current.complete });
    } else if (this.optionIndex === 1) {
      const cases = ["smart", "sensitive", "insensitive"] as const;
      const next =
        (cases.indexOf(current.completecase) + direction + cases.length) %
        cases.length;
      this.setOptions({ ...current, completecase: cases[next]! });
    } else if (this.optionIndex === 2) {
      const next = ((current.completeprefix - 1 + direction + 8) % 8) + 1;
      this.setOptions({ ...current, completeprefix: next });
    } else {
      const source = (["buffers", "symbols", "keywords", "includes"] as const)[
        this.optionIndex - 3
      ];
      if (source !== undefined) {
        const enabled = current.completesources.includes(source);
        const sources = enabled
          ? current.completesources.filter((entry) => entry !== source)
          : [...current.completesources, source];
        this.setOptions({ ...current, completesources: sources });
      } else {
        const enabled = current.definitionsources.includes("includes");
        this.setOptions({
          ...current,
          definitionsources: enabled
            ? current.definitionsources.filter((entry) => entry !== "includes")
            : [...current.definitionsources, "includes"],
        });
      }
    }
  }

  private setOptions(options: DosEditorOptions): void {
    this.optionsValue = Object.freeze({
      ...options,
      completesources: Object.freeze([...options.completesources]),
      definitionsources: Object.freeze([...options.definitionsources]),
    });
    this.completion = undefined;
    this.indexCache = undefined;
    this.includeCache = undefined;
    this.viewLeft = this.optionsValue.wrap ? 0 : this.viewLeft;
    this.ensureVisible();
  }

  private get optionCount(): number {
    if (this.optionPage === "display") return classicDisplayFieldCount;
    return this.optionRows().length + genericOptionButtons.length;
  }

  private genericOptionsGeometry(fieldCount: number): {
    readonly buttonColumns: readonly number[];
    readonly buttonRow: number;
    readonly innerWidth: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
  } {
    const width = Math.max(34, Math.min(60, this.width - 2));
    const innerWidth = width - 2;
    const left = Math.floor((this.width - width) / 2);
    const bodyRows = fieldCount + 2;
    const top = Math.max(1, Math.floor((this.height - bodyRows - 2) / 2));
    const totalButtonWidth =
      genericOptionButtons.reduce((total, label) => total + label.length, 0) +
      genericOptionButtonGap;
    const firstButtonColumn = Math.max(
      1,
      Math.floor((innerWidth - totalButtonWidth) / 2),
    );
    return {
      buttonColumns: [
        firstButtonColumn,
        firstButtonColumn +
          genericOptionButtons[0].length +
          genericOptionButtonGap,
      ],
      buttonRow: top + fieldCount + 1,
      innerWidth,
      left,
      top,
      width,
    };
  }

  private get optionPageLabel(): string {
    return `${this.optionPage[0]!.toUpperCase()}${this.optionPage.slice(1)}`;
  }

  private beginCommand(insertOutput: boolean): EditorResult {
    this.commandInput = "";
    this.commandInsertOutput = insertOutput;
    this.modeValue = "command";
    return this.continue(
      insertOutput ? "Insert DOS command output" : "DOS command",
    );
  }

  private repeatCommand(): EditorResult {
    if (this.lastShellCommand === undefined) {
      return this.continue("No previous DOS command");
    }
    return {
      command: this.lastShellCommand,
      insertOutput: false,
      kind: "shell",
      screen: this.screen(),
    };
  }

  private commandKey(key: string): EditorResult {
    if (key === "Escape") {
      this.modeValue = "editing";
      return this.continue("DOS command cancelled");
    }
    if (key === "Backspace") {
      this.commandInput = [...this.commandInput].slice(0, -1).join("");
      return this.continue("DOS command");
    }
    if (key === "Enter") {
      const command = this.commandInput.trim();
      if (command.length === 0) return this.continue("DOS command is required");
      this.lastShellCommand = command;
      this.modeValue = "editing";
      return {
        command,
        insertOutput: this.commandInsertOutput,
        kind: "shell",
        screen: this.screen(),
      };
    }
    if ([...key].length === 1 && [...this.commandInput].length < 512) {
      this.commandInput += key;
    }
    return this.continue("DOS command");
  }

  private outputKey(key: string): EditorResult {
    if (key === "Escape" || key === "Enter") {
      this.modeValue = "editing";
      return this.continue("Ready");
    }
    const visible = Math.max(1, this.height - 6);
    if (key === "ArrowUp") this.outputTop -= 1;
    else if (key === "ArrowDown") this.outputTop += 1;
    else if (key === "PageUp") this.outputTop -= visible;
    else if (key === "PageDown") this.outputTop += visible;
    this.outputTop = Math.max(
      0,
      Math.min(Math.max(0, this.outputLines.length - visible), this.outputTop),
    );
    return this.continue(this.status);
  }

  private beginCompletion(): EditorResult {
    if (!this.optionsValue.complete) return this.continue("Completion is off");
    const prefix = viWordPrefix(
      this.lines[this.cursorLine] ?? "",
      this.cursorColumn,
    );
    if ([...prefix.text].length < this.optionsValue.completeprefix) {
      return this.continue(
        `Type ${String(this.optionsValue.completeprefix)} characters before completion`,
      );
    }
    let candidates: readonly ViCompletionCandidate[];
    try {
      candidates = collectViCompletions(
        this.optionsValue,
        prefix.text,
        this.cursorLine,
        this.currentIndex(),
        this.bufferSummaries,
        this.externalDocuments(),
      );
    } catch (error) {
      return this.continue(
        `Completion failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (candidates.length === 0) return this.continue("No completion matches");
    this.completion = { candidates, prefixStart: prefix.start, selected: 0 };
    this.modeValue = "completion";
    return this.continue(`${String(candidates.length)} completion matches`);
  }

  private completionKey(key: string): EditorResult {
    const completion = this.completion;
    if (completion === undefined) {
      this.modeValue = "editing";
      return this.continue("Completion cancelled");
    }
    if (key === "Escape") {
      this.completion = undefined;
      this.modeValue = "editing";
      return this.continue("Completion cancelled");
    }
    if (key === "ArrowUp" || key === "ArrowDown" || key === "Ctrl+Space") {
      const direction = key === "ArrowUp" ? -1 : 1;
      completion.selected =
        (completion.selected + direction + completion.candidates.length) %
        completion.candidates.length;
      return this.continue("Select completion; Enter accepts");
    }
    if (key !== "Enter" && key !== "Tab") {
      return this.continue("Arrows select, Enter accepts, Esc cancels");
    }
    const candidate = completion.candidates[completion.selected];
    if (candidate === undefined) return this.continue("Completion unavailable");
    const original = this.lines[this.cursorLine] ?? "";
    const characters = [...original];
    const deleteCount = this.cursorColumn - completion.prefixStart;
    const nextLength =
      characters.length - deleteCount + [...candidate.text].length;
    if (nextLength > maximumLineCharacters) {
      this.completion = undefined;
      this.modeValue = "editing";
      return this.continue("Completion exceeds line limit");
    }
    this.rememberLines(this.cursorLine, 1, [original]);
    characters.splice(completion.prefixStart, deleteCount, ...candidate.text);
    this.lines[this.cursorLine] = characters.join("");
    this.cursorColumn = completion.prefixStart + [...candidate.text].length;
    this.completion = undefined;
    this.modeValue = "editing";
    return this.changed(`Completed ${candidate.text} [${candidate.source}]`);
  }

  private beginSymbols(): EditorResult {
    const symbols = this.currentIndex().symbols;
    if (symbols.length === 0) return this.continue("No document symbols");
    this.symbolIndex = 0;
    this.modeValue = "symbols";
    return this.continue(`${String(symbols.length)} document symbols`);
  }

  private symbolsKey(key: string): EditorResult {
    const symbols = this.currentIndex().symbols;
    if (key === "Escape") {
      this.modeValue = "editing";
      return this.continue("Symbols closed");
    }
    if (key === "ArrowUp" || key === "ArrowDown") {
      const direction = key === "ArrowUp" ? -1 : 1;
      this.symbolIndex =
        (this.symbolIndex + direction + symbols.length) % symbols.length;
      return this.continue("Document symbols");
    }
    if (key === "Enter") {
      const symbol = symbols[this.symbolIndex];
      if (symbol === undefined) return this.continue("Symbol unavailable");
      this.rememberJump();
      this.cursorLine = symbol.line;
      this.cursorColumn = symbol.column;
      this.modeValue = "editing";
      return this.continue(`Symbol ${symbol.name}`);
    }
    return this.continue("Arrows select, Enter jumps, Esc closes");
  }

  private goToDefinition(): EditorResult {
    const name = viWordAt(this.lines[this.cursorLine] ?? "", this.cursorColumn);
    if (name.length === 0) return this.continue("No symbol under cursor");
    let symbol: ViSymbol | undefined;
    try {
      symbol = findViDefinition(
        name,
        this.currentIndex(),
        this.bufferSummaries,
        this.externalDocuments(),
        this.optionsValue,
      );
    } catch (error) {
      return this.continue(
        `Definition lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (symbol === undefined)
      return this.continue(`Definition not found: ${name}`);
    this.rememberJump();
    if (symbol.path === undefined || symbol.path === this.fileName) {
      this.cursorLine = symbol.line;
      this.cursorColumn = symbol.column;
      return this.continue(`Definition: ${name}`);
    }
    if (this.modified) {
      this.jumpHistory.pop();
      return this.continue(
        "Save changes before opening an external definition",
      );
    }
    return {
      column: symbol.column,
      kind: "navigate",
      line: symbol.line,
      path: symbol.path,
      screen: this.screen(),
    };
  }

  private goBack(): EditorResult {
    const location = this.jumpHistory.at(-1);
    if (location === undefined) return this.continue("Jump history is empty");
    if (location.path === this.fileName) {
      this.jumpHistory.pop();
      this.cursorLine = location.line;
      this.cursorColumn = location.column;
      return this.continue("Returned to previous location");
    }
    if (this.modified)
      return this.continue("Save changes before switching files");
    this.jumpHistory.pop();
    return {
      column: location.column,
      kind: "navigate",
      line: location.line,
      path: location.path,
      screen: this.screen(),
    };
  }

  private rememberJump(): void {
    if (this.jumpHistory.length === maximumViJumpHistory) {
      this.jumpHistory.shift();
    }
    this.jumpHistory.push({
      column: this.cursorColumn,
      line: this.cursorLine,
      path: this.fileName,
    });
  }

  private rememberBuffer(): void {
    if (this.fileName.length === 0 || this.modified) return;
    const summary = { index: this.currentIndex(), path: this.fileName };
    const existing = this.bufferSummaries.findIndex(
      ({ path }) => path === this.fileName,
    );
    if (existing >= 0) this.bufferSummaries.splice(existing, 1);
    this.bufferSummaries.unshift(summary);
    if (this.bufferSummaries.length > maximumViBufferSummaries) {
      this.bufferSummaries.length = maximumViBufferSummaries;
    }
  }

  private currentIndex(): ViDocumentIndex {
    const filetype = resolveViFiletype(
      this.optionsValue.filetype,
      this.fileName,
      this.lines[0] ?? "",
    );
    if (
      this.indexCache?.revision === this.revision &&
      this.indexCache.fileName === this.fileName &&
      this.indexCache.filetype === filetype
    ) {
      return this.indexCache.index;
    }
    const index = indexViDocument(filetype, this.fileName, this.contents);
    this.indexCache = {
      fileName: this.fileName,
      filetype,
      index,
      revision: this.revision,
    };
    return index;
  }

  private externalDocuments(): readonly ViExternalDocument[] {
    const needsIncludes =
      this.optionsValue.completesources.includes("includes") ||
      this.optionsValue.definitionsources.includes("includes");
    if (!needsIncludes || this.externalContext === undefined) return [];
    if (
      this.includeCache?.revision === this.revision &&
      this.includeCache.fileName === this.fileName
    ) {
      return this.includeCache.documents;
    }
    const documents = this.externalContext({
      fileName: this.fileName,
      includes: this.currentIndex().includes,
    });
    this.includeCache = {
      documents,
      fileName: this.fileName,
      revision: this.revision,
    };
    return documents;
  }

  private beginHelp(): EditorResult {
    this.modeValue = "help";
    return this.continue("Editor help");
  }

  private helpKey(key: string): EditorResult {
    if (key === "Escape" || key === "Enter" || key === "F1") {
      this.modeValue = "editing";
      return this.continue("Ready");
    }
    return this.continue("F1, Enter, or Esc closes Help");
  }

  private beginSaveAs(): EditorResult {
    if (this.fileDialogProvider !== undefined) {
      this.modeValue = "file-dialog";
      this.fileDialogPurpose = "save-as";
      this.fileDialogPath =
        this.displayName.toUpperCase() === "UNTITLED"
          ? "NONAME.TXT"
          : editorBaseName(this.displayName);
      this.fileDialogFilter = "*.*";
      this.fileDialogFocus = "name";
      this.fileDialogSelection = 0;
      this.fileDialogTop = 0;
      this.refreshFileDialog(editorParentDirectory(this.fileName), false);
      return this.continue(this.status);
    }
    this.modeValue = "save-as";
    this.saveAsPath =
      this.displayName.toUpperCase() === "UNTITLED"
        ? "C:\\NONAME.TXT"
        : this.displayName;
    return this.continue("Save As");
  }

  private beginOpen(): EditorResult {
    this.modeValue = "file-dialog";
    this.fileDialogPurpose = "open";
    if (this.fileDialogProvider === undefined) {
      this.fileDialogPath = this.fileName;
      return this.continue("Open File");
    }
    this.fileDialogPath = "";
    this.fileDialogFilter = "*.TXT";
    this.fileDialogFocus = "filter";
    this.fileDialogSelection = 0;
    this.fileDialogTop = 0;
    this.refreshFileDialog(editorParentDirectory(this.fileName), false);
    return this.continue(this.status);
  }

  private fileDialogKey(key: string): EditorResult {
    if (this.fileDialogProvider === undefined) {
      return this.legacyFileDialogKey(key);
    }
    if (key === "Escape") {
      this.modeValue = "editing";
      this.fileDialogPath = "";
      this.fileDialogSnapshot = undefined;
      return this.continue(
        this.fileDialogPurpose === "open"
          ? "Open cancelled"
          : "Save As cancelled",
      );
    }
    const drive = /^Alt\+([ac])$/iu.exec(key)?.[1]?.toUpperCase();
    if (drive !== undefined) {
      this.refreshFileDialog(`${drive}:\\`, false);
      return this.continue(this.status);
    }
    if (key === "F5") {
      this.refreshFileDialog(
        this.fileDialogSnapshot?.directory ??
          editorParentDirectory(this.fileName),
        true,
      );
      return this.continue(this.status);
    }
    if (key === "Tab") {
      const order: readonly FileDialogFocus[] = ["files", "name", "filter"];
      this.fileDialogFocus =
        order[(order.indexOf(this.fileDialogFocus) + 1) % order.length]!;
      return this.continue(`Open File: ${this.fileDialogFocus}`);
    }
    if (this.fileDialogFocus === "files") {
      const entries = this.filteredFileDialogEntries();
      if (
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        key === "PageUp" ||
        key === "PageDown" ||
        key === "Home" ||
        key === "End"
      ) {
        const page = this.fileDialogListRows;
        if (key === "ArrowUp") this.fileDialogSelection -= 1;
        else if (key === "ArrowDown") this.fileDialogSelection += 1;
        else if (key === "PageUp") this.fileDialogSelection -= page;
        else if (key === "PageDown") this.fileDialogSelection += page;
        else if (key === "Home") this.fileDialogSelection = 0;
        else this.fileDialogSelection = Math.max(0, entries.length - 1);
        this.clampFileDialogSelection(entries.length);
        return this.continue("Open File: select an entry");
      }
      if (key === "Backspace") {
        this.refreshFileDialog(
          editorParentDirectory(
            this.fileDialogSnapshot?.directory ??
              editorParentDirectory(this.fileName),
          ),
          false,
        );
        return this.continue(this.status);
      }
      if (key === "Enter") return this.openSelectedFileDialogEntry();
      if ([...key].length === 1) {
        this.fileDialogFocus = "name";
        this.fileDialogPath = key;
        return this.continue("Open File: name");
      }
      return this.continue("Arrows select; Tab changes field; Enter opens");
    }
    if (key === "Backspace") {
      if (this.fileDialogFocus === "name") {
        this.fileDialogPath = [...this.fileDialogPath].slice(0, -1).join("");
      } else {
        this.fileDialogFilter = [...this.fileDialogFilter]
          .slice(0, -1)
          .join("");
      }
      return this.continue("Open File");
    }
    if (key === "Enter") {
      if (this.fileDialogFocus === "filter") {
        if (!validDosFileDialogFilter(this.fileDialogFilter)) {
          return this.continue("Invalid DOS wildcard filter");
        }
        this.fileDialogSelection = 0;
        this.fileDialogTop = 0;
        this.fileDialogFocus = "files";
        return this.continue(
          this.filteredFileDialogEntries().length === 0
            ? "No files match the filter"
            : "Filter applied",
        );
      }
      return this.openNamedFileDialogEntry();
    }
    if (
      [...key].length === 1 &&
      (this.fileDialogFocus === "name"
        ? [...this.fileDialogPath].length
        : [...this.fileDialogFilter].length) < maximumSaveAsCharacters
    ) {
      if (this.fileDialogFocus === "name") this.fileDialogPath += key;
      else this.fileDialogFilter += key;
    }
    return this.continue("Open File");
  }

  private legacyFileDialogKey(key: string): EditorResult {
    if (key === "Escape") {
      this.modeValue = "editing";
      this.fileDialogPath = "";
      return this.continue("Open cancelled");
    }
    if (key === "Backspace") {
      this.fileDialogPath = [...this.fileDialogPath].slice(0, -1).join("");
      return this.continue("Open File");
    }
    if (key === "Enter") return this.emitOpen(this.fileDialogPath.trim());
    if (
      [...key].length === 1 &&
      [...this.fileDialogPath].length < maximumSaveAsCharacters
    ) {
      this.fileDialogPath += key;
    }
    return this.continue("Open File");
  }

  private refreshFileDialog(
    directory: string,
    guardGeneration: boolean,
  ): boolean {
    const previous = this.fileDialogSnapshot;
    try {
      const snapshot = this.fileDialogProvider!({ directory });
      validateDosFileDialogSnapshot(snapshot);
      const mediaChanged =
        guardGeneration &&
        previous !== undefined &&
        previous.directory === snapshot.directory &&
        previous.mediaGeneration !== snapshot.mediaGeneration;
      this.fileDialogSnapshot = snapshot;
      this.fileDialogSelection = 0;
      this.fileDialogTop = 0;
      if (mediaChanged) {
        this.status = "Media changed; selection reset";
        return false;
      }
      this.status =
        snapshot.error ??
        (this.filteredFileDialogEntries().length === 0
          ? "Directory is empty"
          : this.fileDialogPurpose === "open"
            ? "Open File"
            : "Save As");
      return snapshot.error === undefined;
    } catch (error: unknown) {
      this.status = `Directory error: ${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
  }

  private filteredFileDialogEntries(): readonly DosFileDialogEntry[] {
    const entries = this.fileDialogSnapshot?.entries ?? [];
    if (!validDosFileDialogFilter(this.fileDialogFilter)) return [];
    return entries.filter(
      (entry) =>
        entry.kind === "directory" ||
        matchesDosFileDialogFilter(entry.displayName, this.fileDialogFilter),
    );
  }

  private get usesClassicFileDialog(): boolean {
    return this.width >= 64 && this.height >= 18;
  }

  private classicFileDialogGeometry(): {
    readonly buttonRow: number;
    readonly directoriesLeft: number;
    readonly directoriesWidth: number;
    readonly fieldRow: number;
    readonly filesLeft: number;
    readonly filesWidth: number;
    readonly left: number;
    readonly listRows: number;
    readonly listTop: number;
    readonly top: number;
    readonly width: number;
  } {
    const width = Math.min(70, this.width - 2);
    const left = Math.floor((this.width - width) / 2);
    const listRows = this.fileDialogListRows;
    const top = Math.max(1, Math.floor((this.height - (listRows + 8)) / 2));
    const innerWidth = width - 2;
    const filesWidth = Math.max(24, innerWidth - 22);
    const directoriesWidth = innerWidth - filesWidth - 3;
    const filesLeft = left + 2;
    const directoriesLeft = filesLeft + filesWidth + 2;
    return {
      buttonRow: top + listRows + 6,
      directoriesLeft,
      directoriesWidth,
      fieldRow: top + 1,
      filesLeft,
      filesWidth,
      left,
      listRows,
      listTop: top + 5,
      top,
      width,
    };
  }

  private classicFileDialogPaneRows(listRows: number): {
    readonly directories: readonly DosFileDialogEntry[];
    readonly drives: readonly ("A:" | "C:")[];
    readonly files: readonly DosFileDialogEntry[];
    readonly selected?: DosFileDialogEntry;
  } {
    const entries = this.filteredFileDialogEntries();
    const selected = entries[this.fileDialogSelection];
    const files = entries.filter(({ kind }) => kind === "file");
    const directories = entries.filter(({ kind }) => kind === "directory");
    const drives = this.fileDialogSnapshot?.drives ?? [];
    const directoryRows = Math.max(1, listRows - drives.length);
    return {
      directories: boundedDialogWindow(directories, selected, directoryRows),
      drives,
      files: boundedDialogWindow(files, selected, listRows),
      selected,
    };
  }

  private get fileDialogListRows(): number {
    return Math.max(1, Math.min(10, this.height - 11));
  }

  private clampFileDialogSelection(entryCount: number): void {
    this.fileDialogSelection =
      entryCount === 0
        ? 0
        : Math.max(0, Math.min(entryCount - 1, this.fileDialogSelection));
    const maximumTop = Math.max(0, entryCount - this.fileDialogListRows);
    if (this.fileDialogSelection < this.fileDialogTop) {
      this.fileDialogTop = this.fileDialogSelection;
    } else if (
      this.fileDialogSelection >=
      this.fileDialogTop + this.fileDialogListRows
    ) {
      this.fileDialogTop =
        this.fileDialogSelection - this.fileDialogListRows + 1;
    }
    this.fileDialogTop = Math.max(0, Math.min(maximumTop, this.fileDialogTop));
  }

  private openSelectedFileDialogEntry(): EditorResult {
    const selected = this.filteredFileDialogEntries()[this.fileDialogSelection];
    if (selected === undefined) {
      return this.continue(
        this.fileDialogSnapshot?.error ?? "No file is selected",
      );
    }
    if (!this.refreshFileDialog(this.fileDialogSnapshot!.directory, true)) {
      return this.continue(this.status);
    }
    const refreshed = this.filteredFileDialogEntries().find(
      ({ fileName }) => fileName === selected.fileName,
    );
    if (refreshed === undefined) {
      return this.continue("Selected entry changed; choose again");
    }
    if (refreshed.kind === "directory") {
      this.refreshFileDialog(refreshed.fileName, false);
      return this.continue(this.status);
    }
    return this.fileDialogPurpose === "open"
      ? this.emitOpen(refreshed.fileName)
      : this.emitSaveAs(refreshed.fileName);
  }

  private openNamedFileDialogEntry(): EditorResult {
    const input = this.fileDialogPath.trim();
    if (input.length === 0) return this.continue("File name is required");
    if (
      !this.refreshFileDialog(
        this.fileDialogSnapshot?.directory ??
          editorParentDirectory(this.fileName),
        true,
      )
    ) {
      return this.continue(this.status);
    }
    const direct = /^(?:[A-Za-z]:|\/)/u.test(input);
    const fileName = direct
      ? input
      : joinEditorPath(this.fileDialogSnapshot!.directory, input);
    const entry = this.fileDialogSnapshot!.entries.find(
      (candidate) =>
        asciiUpper(candidate.displayName) === asciiUpper(input) ||
        candidate.fileName === fileName,
    );
    if (entry?.kind === "directory") {
      this.refreshFileDialog(entry.fileName, false);
      this.fileDialogFocus = "files";
      return this.continue(this.status);
    }
    return this.fileDialogPurpose === "open"
      ? this.emitOpen(fileName)
      : this.emitSaveAs(fileName);
  }

  private emitOpen(fileName: string): EditorResult {
    if (fileName.length === 0) return this.continue("File name is required");
    if ([...fileName].length > maximumSaveAsCharacters) {
      return this.continue("File name limit exceeded");
    }
    this.modeValue = "editing";
    this.status = "Opening...";
    return {
      fileName,
      kind: "open",
      screen: this.screen(),
    };
  }

  private emitSaveAs(fileName: string): EditorResult {
    if (fileName.length === 0) return this.continue("File name is required");
    if ([...fileName].length > maximumSaveAsCharacters) {
      return this.continue("File name limit exceeded");
    }
    this.modeValue = "editing";
    this.status = "Saving...";
    return {
      closeAfter: false,
      contents: this.serializedContents,
      expectedContents: this.sourceSnapshot,
      fileName,
      kind: "save",
      screen: this.screen(),
    };
  }

  private saveAsKey(key: string): EditorResult {
    if (key === "Escape") {
      this.modeValue = "editing";
      this.saveAsPath = "";
      return this.continue("Save As cancelled");
    }
    if (key === "Backspace") {
      this.saveAsPath = [...this.saveAsPath].slice(0, -1).join("");
      return this.continue("Save As");
    }
    if (key === "Enter") {
      const fileName = this.saveAsPath.trim();
      return this.emitSaveAs(fileName);
    }
    if (
      [...key].length === 1 &&
      [...this.saveAsPath].length < maximumSaveAsCharacters
    ) {
      this.saveAsPath += key;
    }
    return this.continue("Save As");
  }

  private beginSearch(): EditorResult {
    this.modeValue = "search";
    this.searchQuery = this.lastSearch;
    return this.continue("Find text");
  }

  private beginReplace(): EditorResult {
    this.modeValue = "replace";
    this.searchQuery = this.lastSearch;
    this.replacementText = "";
    this.replaceField = "find";
    return this.continue("Replace text");
  }

  private replaceKey(key: string): EditorResult {
    if (key === "Escape") {
      this.modeValue = "editing";
      return this.continue("Replace cancelled");
    }
    if (key === "Tab") {
      this.replaceField = this.replaceField === "find" ? "replacement" : "find";
      return this.continue("Replace text");
    }
    if (key === "Backspace") {
      if (this.replaceField === "find") {
        this.searchQuery = [...this.searchQuery].slice(0, -1).join("");
      } else {
        this.replacementText = [...this.replacementText].slice(0, -1).join("");
      }
      return this.continue("Replace text");
    }
    if (key === "Enter") {
      this.modeValue = "editing";
      return this.replaceNext();
    }
    if (key === "Ctrl+Enter" || key.toLowerCase() === "alt+a") {
      this.modeValue = "editing";
      return this.replaceAll();
    }
    if ([...key].length === 1) {
      if (
        this.replaceField === "find" &&
        [...this.searchQuery].length < maximumSearchCharacters
      ) {
        this.searchQuery += key;
      } else if (
        this.replaceField === "replacement" &&
        [...this.replacementText].length < maximumSearchCharacters
      ) {
        this.replacementText += key;
      }
    }
    return this.continue("Replace text");
  }

  private replaceNext(): EditorResult {
    const query = this.searchQuery;
    if (query.length === 0) return this.continue("Find text is empty");
    this.lastSearch = query;
    const match = this.locate(query, this.cursorColumn);
    if (match === undefined) return this.continue(`Not found: ${query}`);
    this.cursorLine = match.line;
    this.cursorColumn = match.column + [...query].length;
    this.selectionAnchor = { column: match.column, line: match.line };
    return this.replaceSelection(this.replacementText, `Replaced: ${query}`);
  }

  private replaceAll(): EditorResult {
    const query = this.searchQuery;
    if (query.length === 0) return this.continue("Find text is empty");
    const replacements: string[] = [];
    let count = 0;
    for (const line of this.lines) {
      const replaced = replaceAsciiLiteral(
        line,
        query,
        this.replacementText,
        maximumReplacements - count + 1,
      );
      replacements.push(replaced.value);
      count += replaced.count;
      if (count > maximumReplacements) {
        return this.continue("Replace All limit reached; no changes made");
      }
    }
    if (count === 0) return this.continue(`Not found: ${query}`);
    if (
      replacements.some(
        (replacement) => [...replacement].length > maximumLineCharacters,
      )
    ) {
      return this.continue("Line limit reached; no changes made");
    }
    this.rememberLines(0, replacements.length, [...this.lines]);
    this.lines.splice(0, this.lines.length, ...replacements);
    this.selectionAnchor = undefined;
    this.lastSearch = query;
    return this.changed(`Replaced ${String(count)} occurrence(s)`);
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
    const match = this.locate(query, startColumn);
    if (match !== undefined) {
      this.cursorLine = match.line;
      this.cursorColumn = match.column;
      this.selectionAnchor = undefined;
      return this.continue(`Found: ${query}`);
    }
    return this.continue(`Not found: ${query}`);
  }

  private locate(
    query: string,
    startColumn: number,
  ): { readonly column: number; readonly line: number } | undefined {
    for (let offset = 0; offset < this.lines.length; offset += 1) {
      const lineIndex = (this.cursorLine + offset) % this.lines.length;
      const from = offset === 0 ? startColumn : 0;
      const column = indexOfAsciiLiteral(
        this.lines[lineIndex] ?? "",
        query,
        from,
      );
      if (column >= 0) return { column, line: lineIndex };
    }
    const wrappedColumn = indexOfAsciiLiteral(
      this.lines[this.cursorLine] ?? "",
      query,
      0,
    );
    return wrappedColumn >= 0 && wrappedColumn < startColumn
      ? { column: wrappedColumn, line: this.cursorLine }
      : undefined;
  }

  private requestExit(): EditorResult {
    return this.requestTransition("exit");
  }

  private requestTransition(transition: PendingTransition): EditorResult {
    this.pendingTransition = transition;
    if (this.modified) {
      this.confirmExitChoice = 0;
      this.modeValue = "confirm-exit";
      return this.continue(
        transition === "exit"
          ? "Save changes before exit?"
          : "Save changes before continuing?",
      );
    }
    return this.executeTransition(transition);
  }

  private executeTransition(transition: PendingTransition): EditorResult {
    this.pendingTransition = undefined;
    this.modeValue = "editing";
    if (transition === "new") {
      this.setDocument("C:\\NONAME.TXT", "", "UNTITLED", false);
      return this.continue("New file");
    }
    if (transition === "open") return this.beginOpen();
    this.stateValue = "closed";
    return { kind: "closed", discardedChanges: false, screen: this.screen() };
  }

  private confirmExitKey(key: string): EditorResult {
    if (
      key === "ArrowLeft" ||
      key === "ArrowRight" ||
      key === "Tab" ||
      key === "Shift+Tab"
    ) {
      const direction = key === "ArrowLeft" || key === "Shift+Tab" ? -1 : 1;
      this.confirmExitChoice = (this.confirmExitChoice + direction + 4) % 4;
      return this.continue("Choose Yes, No, Cancel, or Help");
    }
    if (key === "Enter") {
      return this.confirmExitKey(
        this.confirmExitChoice === 0
          ? "y"
          : this.confirmExitChoice === 1
            ? "n"
            : this.confirmExitChoice === 2
              ? "Escape"
              : "F1",
      );
    }
    const normalized = key.toLowerCase();
    if (normalized === "y") {
      this.modeValue = "editing";
      return this.save(false);
    }
    if (normalized === "n") {
      this.modeValue = "editing";
      const transition = this.pendingTransition ?? "exit";
      const result = this.executeTransition(transition);
      return result.kind === "closed"
        ? { ...result, discardedChanges: true }
        : result;
    }
    if (key === "Escape" || normalized === "c") {
      this.modeValue = "editing";
      this.pendingTransition = undefined;
      return this.continue("Exit cancelled");
    }
    if (key === "F1" || normalized === "h") {
      return this.continue(
        "Yes saves; No discards; Cancel returns to the editor",
      );
    }
    return this.continue("Choose Yes, No, Cancel, or Help");
  }

  private confirmSaveKey(key: string): EditorResult {
    const decision = this.pendingSaveDecision;
    if (decision === undefined) {
      this.modeValue = "editing";
      return this.continue("Save decision expired");
    }
    const normalized = key.toLowerCase();
    if (decision.kind === "external-change" && normalized === "r") {
      this.pendingSaveDecision = undefined;
      this.pendingTransition = undefined;
      this.modeValue = "editing";
      this.status = "Reopening changed file...";
      return {
        fileName: decision.fileName,
        kind: "open",
        screen: this.screen(),
      };
    }
    if (normalized === "y") {
      this.pendingSaveDecision = undefined;
      this.modeValue = "editing";
      this.status = "Saving confirmed replacement...";
      return {
        closeAfter: decision.closeAfter,
        contents: decision.contents,
        expectedContents: decision.targetSnapshot,
        expectedTargetExists: decision.targetSnapshot !== undefined,
        fileName: decision.fileName,
        kind: "save",
        overwrite: true,
        screen: this.screen(),
      };
    }
    if (normalized === "n" || key === "Escape") {
      this.pendingSaveDecision = undefined;
      this.pendingTransition = undefined;
      this.modeValue = "editing";
      return this.continue("Save cancelled; buffer retained");
    }
    return this.continue(
      decision.kind === "replace"
        ? "Y Replace  Esc Cancel"
        : "Y Overwrite  R Reopen  Esc Cancel",
    );
  }

  private save(closeAfter: boolean): EditorResult {
    this.modeValue = "editing";
    this.status = "Saving...";
    return {
      closeAfter,
      contents: this.serializedContents,
      expectedContents: this.sourceSnapshot,
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
    const indentation = this.optionsValue.autoindent
      ? (/^\s*/u.exec(before)?.[0] ?? "")
      : "";
    this.rememberLines(this.cursorLine, 2, [original]);
    this.lines.splice(this.cursorLine, 1, before, `${indentation}${after}`);
    this.cursorLine += 1;
    this.cursorColumn = [...indentation].length;
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
    this.revision = operation.revisionBefore;
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

  private selectAll(): EditorResult {
    this.selectionAnchor = { column: 0, line: 0 };
    this.cursorLine = this.lines.length - 1;
    this.cursorColumn = [...(this.lines.at(-1) ?? "")].length;
    return this.continue("Selected all");
  }

  private extendSelection(movement: string): EditorResult {
    this.selectionAnchor ??= this.cursor;
    if (movement === "ArrowLeft") this.moveLeft();
    else if (movement === "ArrowRight") this.moveRight();
    else if (movement === "ArrowUp") this.cursorLine -= 1;
    else if (movement === "ArrowDown") this.cursorLine += 1;
    else if (movement === "Home") this.cursorColumn = 0;
    else if (movement === "End") {
      this.cursorColumn = this.currentCharacters().length;
    } else if (movement === "PageUp") this.cursorLine -= this.contentRows;
    else if (movement === "PageDown") this.cursorLine += this.contentRows;
    this.clampCursor();
    return this.continue(
      this.selectedRange() === undefined ? "Selection cleared" : "Selected",
    );
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
    return this.changed(status);
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
    return this.changed(status);
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
      revisionBefore: this.revision,
    });
  }

  private changed(status = "Modified"): EditorResult {
    this.revision += 1;
    this.indexCache = undefined;
    this.includeCache = undefined;
    this.status = status;
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
    if (!this.optionsValue.wrap) {
      this.cursorLine = Math.min(this.lines.length - 1, this.viewTop + row - 1);
      this.cursorColumn =
        this.viewLeft +
        Math.max(0, column - this.documentInset - this.gutterWidth);
      this.clampCursor();
      return;
    }
    let line = this.viewTop;
    let segment = this.viewTopSegment;
    let remaining = Math.max(0, row - 1);
    while (remaining > 0 && line < this.lines.length) {
      segment += 1;
      if (segment >= this.visualRowCount(line)) {
        line += 1;
        segment = 0;
      }
      remaining -= 1;
    }
    this.cursorLine = Math.min(this.lines.length - 1, line);
    this.cursorColumn =
      segment * this.contentWidth +
      Math.max(0, column - this.documentInset - this.gutterWidth);
    this.clampCursor();
  }

  private paintSelection(
    row: HighlightedCell[],
    line: number,
    startColumn: number,
  ): void {
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
    const visibleStart = Math.max(
      this.documentInset + this.gutterWidth,
      this.documentInset + this.gutterWidth + start - startColumn,
    );
    const visibleEnd = Math.min(
      this.width - 1,
      this.documentInset + this.gutterWidth + end - startColumn,
    );
    if (visibleEnd > visibleStart) {
      this.paint(row, visibleStart, visibleEnd - visibleStart, 15, 1);
    }
  }

  private openMenu(name: MenuName): EditorResult {
    this.modeValue = "menu";
    this.menuIndex = this.visibleMenuOrder.indexOf(name);
    this.menuItemIndex = 0;
    return this.continue("Menu");
  }

  private openMenuByMnemonic(mnemonic: string): EditorResult {
    const index = this.visibleMenuOrder.findIndex((name) =>
      name.startsWith(mnemonic),
    );
    return index < 0
      ? this.continue(this.status)
      : this.openMenu(this.visibleMenuOrder[index]!);
  }

  private activeMenuEntries(): readonly MenuEntry[] {
    const name = this.visibleMenuOrder[this.menuIndex]!;
    return this.profile === "edit" && name === "file"
      ? editFileMenuEntries
      : menuEntries[name];
  }

  private get visibleMenuOrder(): readonly MenuName[] {
    return this.profile === "edit" ? editMenuOrder : menuOrder;
  }

  private menuBar(): HighlightedCell[] {
    const leftMenus = this.visibleMenuOrder.filter((name) => name !== "help");
    const left = ` ${leftMenus
      .map((name) => ` ${menuLabels[name]} `)
      .join(" ")}`;
    const help = " Help ";
    const cells = this.plainRow(left, dosTuiColor.black, dosTuiColor.chrome);
    const helpStart = Math.max(0, this.width - [...help].length);
    for (const [offset, character] of [...help].entries()) {
      cells[helpStart + offset] = {
        background: dosTuiColor.chrome,
        character,
        foreground: dosTuiColor.black,
      };
    }
    if (this.modeValue !== "menu") return cells;
    const { start, width } = this.menuHeading(this.menuIndex);
    this.paint(cells, start, width, dosTuiColor.white, dosTuiColor.black);
    return cells;
  }

  private titleBar(): HighlightedCell[] {
    const cells = this.plainRow(
      "─".repeat(this.width),
      dosTuiColor.white,
      dosTuiColor.document,
    );
    if (this.width > 0) cells[0] = { ...cells[0]!, character: "┌" };
    if (this.width > 1)
      cells[this.width - 1] = {
        ...cells[this.width - 1]!,
        character: "┐",
      };
    const normalized = this.displayName.replaceAll("/", "\\");
    const slash = normalized.lastIndexOf("\\");
    const fileName = (
      slash >= 0 ? normalized.slice(slash + 1) : normalized
    ).toUpperCase();
    const title = ` ${fileName.length > 0 ? fileName : "UNTITLED"}${this.modified ? " *" : ""} `;
    const visible = [...title].slice(0, Math.max(1, this.width - 2)).join("");
    const start = Math.max(
      1,
      Math.floor((this.width - [...visible].length) / 2),
    );
    for (const [offset, character] of [...visible].entries()) {
      if (start + offset >= this.width - 1) break;
      cells[start + offset] = {
        background: dosTuiColor.chrome,
        character,
        foreground: dosTuiColor.document,
      };
    }
    return cells;
  }

  private horizontalScrollBar(): HighlightedCell[] {
    const cells = this.plainRow(
      "░".repeat(this.width),
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    if (this.width > 0) cells[0] = { ...cells[0]!, character: "←" };
    if (this.width > 1)
      cells[this.width - 1] = {
        ...cells[this.width - 1]!,
        character: "→",
      };
    if (this.width > 2) {
      const maximumLeft = Math.max(
        0,
        this.currentCharacters().length - this.contentWidth,
      );
      const position =
        maximumLeft === 0
          ? 1
          : 1 +
            Math.round(
              (this.viewLeft / maximumLeft) * Math.max(0, this.width - 3),
            );
      cells[Math.min(this.width - 2, position)] = {
        background: dosTuiColor.black,
        character: " ",
        foreground: dosTuiColor.white,
      };
    }
    return cells;
  }

  private drawVerticalScrollBar(rows: HighlightedCell[][]): void {
    const maximumTop = Math.max(0, this.lines.length - this.contentRows);
    const trackLength = Math.max(1, this.contentRows - 2);
    const thumb =
      maximumTop === 0
        ? 0
        : Math.round(
            (this.viewTop / maximumTop) * Math.max(0, trackLength - 1),
          );
    for (let offset = 0; offset < this.contentRows; offset += 1) {
      const target = rows[offset + 2];
      if (target === undefined || this.width <= 0) continue;
      const isThumb = offset === thumb + 1 && this.contentRows > 2;
      target[this.width - 1] = {
        background: isThumb ? dosTuiColor.black : dosTuiColor.chrome,
        character:
          offset === 0
            ? "↑"
            : offset === this.contentRows - 1
              ? "↓"
              : isThumb
                ? " "
                : "░",
        foreground: dosTuiColor.black,
      };
    }
  }

  private drawDocumentLeftBorder(rows: HighlightedCell[][]): void {
    if (this.documentInset === 0) return;
    for (let offset = 0; offset < this.contentRows; offset += 1) {
      const target = rows[offset + 2];
      if (target === undefined || this.width <= 0) continue;
      target[0] = {
        background: dosTuiColor.document,
        character: "│",
        foreground: dosTuiColor.white,
      };
    }
  }

  private menuBox(): {
    readonly entries: readonly MenuEntry[];
    readonly labels: readonly string[];
    readonly left: number;
    readonly width: number;
  } {
    const entries = this.activeMenuEntries();
    const labels = entries.map(({ label, shortcut }) =>
      this.profile === "edit" || shortcut.length === 0
        ? label
        : `${label}  ${shortcut}`,
    );
    const width = Math.min(
      this.width,
      Math.max(...labels.map((label) => [...label].length)) + 4,
    );
    const heading = this.menuHeading(this.menuIndex);
    const left = Math.max(0, Math.min(heading.start, this.width - width));
    return { entries, labels, left, width };
  }

  private menuEntryRow(entries: readonly MenuEntry[], index: number): number {
    let row = index + 2;
    for (let current = 0; current <= index; current += 1) {
      if (entries[current]?.separatorBefore === true) row += 1;
    }
    return row;
  }

  private drawMenu(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const { entries, labels, left, width: menuWidth } = this.menuBox();
    const horizontal = singleLineBox.horizontal.repeat(menuWidth - 2);
    this.overlay(
      rows,
      1,
      left,
      `${singleLineBox.topLeft}${horizontal}${singleLineBox.topRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    for (let index = 0; index < entries.length; index += 1) {
      const row = this.menuEntryRow(entries, index);
      if (entries[index]?.separatorBefore === true) {
        this.overlay(
          rows,
          row - 1,
          left,
          `${singleLineBox.leftTee}${horizontal}${singleLineBox.rightTee}`,
          dosTuiColor.black,
          dosTuiColor.chrome,
        );
      }
      const selected = index === this.menuItemIndex;
      const text = [...(labels[index] ?? "")].slice(0, menuWidth - 4).join("");
      this.overlay(
        rows,
        row,
        left,
        `${singleLineBox.vertical} ${text.padEnd(menuWidth - 4)} ${singleLineBox.vertical}`,
        selected ? dosTuiColor.chrome : dosTuiColor.black,
        selected ? dosTuiColor.black : dosTuiColor.chrome,
      );
    }
    const bottom = this.menuEntryRow(entries, entries.length - 1) + 1;
    this.overlay(
      rows,
      bottom,
      left,
      `${singleLineBox.bottomLeft}${horizontal}${singleLineBox.bottomRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    drawDosTuiShadow(rows, 1, left, menuWidth, bottom);
    return {
      x: left + 3,
      y: this.menuEntryRow(entries, this.menuItemIndex) + 1,
    };
  }

  private drawCompletion(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const completion = this.completion;
    if (completion === undefined) return this.editingCursor();
    const visibleRows = Math.min(8, completion.candidates.length);
    const width = Math.max(28, Math.min(48, this.width - 2));
    const left = Math.max(
      0,
      Math.min(this.editingCursor().x - 1, this.width - width),
    );
    const top = Math.max(
      1,
      Math.min(this.height - visibleRows - 3, this.editingCursor().y),
    );
    const first = Math.max(
      0,
      Math.min(
        completion.selected - Math.floor(visibleRows / 2),
        completion.candidates.length - visibleRows,
      ),
    );
    const body = completion.candidates
      .slice(first, first + visibleRows)
      .map(({ source, text }) => ` ${text} [${source}] `);
    this.drawDialog(rows, top, left, width, "Completion", body);
    const selectedRow = completion.selected - first;
    this.overlay(
      rows,
      top + selectedRow + 1,
      left + 1,
      [...(body[selectedRow] ?? "")]
        .slice(0, width - 2)
        .join("")
        .padEnd(width - 2),
      0,
      7,
    );
    return { x: left + 2, y: top + selectedRow + 2 };
  }

  private drawOptions(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    if (
      this.optionPage === "display" &&
      this.width >= 64 &&
      this.height >= 22
    ) {
      return this.drawClassicDisplayOptions(rows);
    }
    const entries = this.optionRows();
    const geometry = this.genericOptionsGeometry(entries.length);
    if (this.optionPage === "display") {
      const body = [
        ...entries.map(({ label, value }) => ` ${label.padEnd(22)} ${value} `),
        " Tab/Arrows select  Enter=execute  Esc=cancel ",
      ];
      this.drawDialog(
        rows,
        geometry.top,
        geometry.left,
        geometry.width,
        "Display Options",
        body,
      );
      this.overlay(
        rows,
        geometry.top + this.optionIndex + 1,
        geometry.left + 1,
        [...(body[this.optionIndex] ?? "")]
          .slice(0, geometry.innerWidth)
          .join("")
          .padEnd(geometry.innerWidth),
        0,
        7,
      );
      return {
        x: geometry.left + 2,
        y: geometry.top + this.optionIndex + 2,
      };
    }
    const buttonLine = genericOptionButtons.reduce(
      (line, label, index) =>
        `${line.padEnd(geometry.buttonColumns[index]!)}${label}`,
      "",
    );
    const body = [
      ...entries.map(({ label, value }) => ` ${label.padEnd(22)} ${value} `),
      buttonLine.padEnd(geometry.innerWidth),
      " Arrows/Space change  Enter=button  Esc=cancel ",
    ];
    this.drawDialog(
      rows,
      geometry.top,
      geometry.left,
      geometry.width,
      `${this.optionPageLabel} Options`,
      body,
    );
    if (this.optionIndex < entries.length) {
      this.overlay(
        rows,
        geometry.top + this.optionIndex + 1,
        geometry.left + 1,
        [...(body[this.optionIndex] ?? "")]
          .slice(0, geometry.innerWidth)
          .join("")
          .padEnd(geometry.innerWidth),
        0,
        7,
      );
      return {
        x: geometry.left + 2,
        y: geometry.top + this.optionIndex + 2,
      };
    }
    const buttonIndex = this.optionIndex - entries.length;
    const label = genericOptionButtons[buttonIndex] ?? genericOptionButtons[0];
    const buttonColumn =
      geometry.buttonColumns[buttonIndex] ?? geometry.buttonColumns[0]!;
    this.overlay(
      rows,
      geometry.buttonRow,
      geometry.left + 1 + buttonColumn,
      label,
      0,
      7,
    );
    return {
      x: geometry.left + buttonColumn + 2,
      y: geometry.buttonRow + 1,
    };
  }

  private drawClassicDisplayOptions(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.min(62, this.width - 2);
    const left = Math.floor((this.width - width) / 2);
    const innerWidth = width - 2;
    const groupColumn = 1;
    const groupWidth = innerWidth - 2;
    const bottomBorder = (boxWidth: number): string =>
      `${singleLineBox.bottomLeft}${singleLineBox.horizontal.repeat(boxWidth - 2)}${singleLineBox.bottomRight}`;
    const groupSides = (): readonly {
      readonly column: number;
      readonly value: string;
    }[] => [
      { column: groupColumn, value: singleLineBox.vertical },
      {
        column: groupColumn + groupWidth - 1,
        value: singleLineBox.vertical,
      },
    ];
    const body: string[] = [
      composeFixedRow(innerWidth, [
        {
          column: groupColumn,
          value: titledBorder("Display Options", groupWidth),
        },
      ]),
      composeFixedRow(innerWidth, [
        ...groupSides(),
        { column: 4, value: "[X] Scroll Bars" },
        {
          column: Math.max(30, innerWidth - 20),
          value: `Tab Stops: ${String(this.optionsValue.tabstop)}`,
        },
      ]),
      composeFixedRow(innerWidth, [
        { column: groupColumn, value: bottomBorder(groupWidth) },
      ]),
      composeFixedRow(innerWidth, [
        { column: 10, value: "< OK >" },
        { column: 25, value: "< Cancel >" },
        { column: 43, value: "< Help >" },
      ]),
    ];
    const top = Math.max(1, Math.floor((this.height - (body.length + 2)) / 2));
    this.drawDialog(rows, top, left, width, "Display", body);

    const scrollBarsColumn = left + 1 + 4;
    const tabStopsColumn = left + 1 + Math.max(30, innerWidth - 20);
    const optionRow = top + 2;
    if (this.optionIndex === 0) {
      this.overlay(
        rows,
        optionRow,
        scrollBarsColumn,
        "[X] Scroll Bars",
        dosTuiColor.chrome,
        dosTuiColor.black,
      );
    } else if (this.optionIndex === 1) {
      this.overlay(
        rows,
        optionRow,
        tabStopsColumn,
        `Tab Stops: ${String(this.optionsValue.tabstop)}`,
        dosTuiColor.chrome,
        dosTuiColor.black,
      );
    }

    const buttons = [
      { column: 10, label: "< OK >" },
      { column: 25, label: "< Cancel >" },
      { column: 43, label: "< Help >" },
    ] as const;
    if (this.optionIndex >= 2) {
      const button = buttons[this.optionIndex - 2]!;
      this.overlay(
        rows,
        top + 4,
        left + 1 + button.column,
        button.label,
        dosTuiColor.chrome,
        dosTuiColor.black,
      );
    }

    const targets = [
      { x: scrollBarsColumn + 1, y: optionRow },
      { x: tabStopsColumn + 1, y: optionRow },
      ...buttons.map(({ column }) => ({
        x: left + 1 + column + 2,
        y: top + 4,
      })),
    ] as const;
    const target = targets[this.optionIndex] ?? targets[0];
    return { x: target.x + 1, y: target.y + 1 };
  }

  private optionRows(): readonly {
    readonly label: string;
    readonly value: string;
  }[] {
    const enabled = (value: boolean): string => (value ? "On" : "Off");
    if (this.optionPage === "display") {
      return [
        { label: "Scroll Bars", value: "On" },
        { label: "Tab Stops", value: String(this.optionsValue.tabstop) },
        { label: "OK", value: "Apply" },
        { label: "Cancel", value: "Revert" },
        { label: "Help", value: "Keys" },
      ];
    }
    if (this.optionPage === "editing") {
      return [
        { label: "Syntax Highlight", value: enabled(this.optionsValue.syntax) },
        { label: "Line Numbers", value: enabled(this.optionsValue.number) },
        { label: "Rainbow Indent", value: enabled(this.optionsValue.rainbow) },
        { label: "Whitespace Marks", value: enabled(this.optionsValue.list) },
        { label: "Line Wrapping", value: enabled(this.optionsValue.wrap) },
        { label: "Auto Indent", value: enabled(this.optionsValue.autoindent) },
        { label: "Expand Tabs", value: enabled(this.optionsValue.expandtab) },
        { label: "Tab Width", value: String(this.optionsValue.tabstop) },
        { label: "Indent Width", value: String(this.optionsValue.shiftwidth) },
      ];
    }
    if (this.optionPage === "language") {
      return [{ label: "File Type", value: this.optionsValue.filetype }];
    }
    const source = (
      name: "buffers" | "includes" | "keywords" | "symbols",
    ): string => enabled(this.optionsValue.completesources.includes(name));
    return [
      { label: "Completion", value: enabled(this.optionsValue.complete) },
      { label: "Case Matching", value: this.optionsValue.completecase },
      {
        label: "Minimum Prefix",
        value: String(this.optionsValue.completeprefix),
      },
      { label: "Buffer Candidates", value: source("buffers") },
      { label: "Symbol Candidates", value: source("symbols") },
      { label: "Keyword Candidates", value: source("keywords") },
      { label: "Include Candidates", value: source("includes") },
      {
        label: "Definition Includes",
        value: enabled(
          this.optionsValue.definitionsources.includes("includes"),
        ),
      },
    ];
  }

  private drawSymbols(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const symbols = this.currentIndex().symbols;
    const visibleRows = Math.min(8, symbols.length);
    const width = Math.max(34, Math.min(58, this.width - 2));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - visibleRows - 3) / 2));
    const first = Math.max(
      0,
      Math.min(
        this.symbolIndex - Math.floor(visibleRows / 2),
        symbols.length - visibleRows,
      ),
    );
    const body = symbols
      .slice(first, first + visibleRows)
      .map(
        ({ kind, line, name }) =>
          ` ${String(line + 1).padStart(4)} ${kind.padEnd(8)} ${name} `,
      );
    this.drawDialog(rows, top, left, width, "Document Symbols", body);
    const selectedRow = this.symbolIndex - first;
    this.overlay(
      rows,
      top + selectedRow + 1,
      left + 1,
      [...(body[selectedRow] ?? "")]
        .slice(0, width - 2)
        .join("")
        .padEnd(width - 2),
      0,
      7,
    );
    return { x: left + 2, y: top + selectedRow + 2 };
  }

  private drawCommand(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.max(30, Math.min(64, this.width - 2));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 5) / 2));
    const available = width - 4;
    const visible = [...this.commandInput].slice(-available).join("");
    this.drawDialog(
      rows,
      top,
      left,
      width,
      this.commandInsertOutput ? "Insert Command Output" : "DOS Command",
      [` ${visible.padEnd(available)} `, " Enter run  Esc cancel "],
    );
    return { x: left + 2 + [...visible].length, y: top + 2 };
  }

  private drawOutput(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.max(30, Math.min(70, this.width - 2));
    const left = Math.floor((this.width - width) / 2);
    const visibleRows = Math.max(1, this.height - 6);
    const top = 1;
    const body = Array.from(
      { length: visibleRows },
      (_, offset) =>
        ` ${[...(this.outputLines[this.outputTop + offset] ?? "")]
          .slice(0, width - 4)
          .join("")} `,
    );
    body.push(" Arrows scroll  Enter/Esc close ");
    this.drawDialog(rows, top, left, width, "DOS Command Output", body);
    return { x: left + 2, y: top + 2 };
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

  private drawReplaceDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.max(28, Math.min(58, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 7) / 2));
    const available = Math.max(1, width - 12);
    const find = [...this.searchQuery].slice(-available).join("");
    const replacement = [...this.replacementText].slice(-available).join("");
    this.drawDialog(rows, top, left, width, "Replace", [
      ` Find:    ${find.padEnd(available)} `,
      ` Replace: ${replacement.padEnd(available)} `,
      " Tab changes field ",
      " Enter Replace  Ctrl+Enter Replace All  Esc Cancel ",
    ]);
    const active = this.replaceField === "find" ? find : replacement;
    return {
      x: left + 11 + [...active].length,
      y: top + (this.replaceField === "find" ? 2 : 3),
    };
  }

  private drawFileDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    if (this.fileDialogProvider !== undefined) {
      if (this.usesClassicFileDialog) {
        return this.drawClassicFileDialog(rows);
      }
      const width = Math.max(32, Math.min(70, this.width - 2));
      const left = Math.floor((this.width - width) / 2);
      const listRows = this.fileDialogListRows;
      const top = Math.max(1, Math.floor((this.height - (listRows + 7)) / 2));
      const available = Math.max(1, width - 4);
      const entries = this.filteredFileDialogEntries();
      this.clampFileDialogSelection(entries.length);
      const fileRows = Array.from({ length: listRows }, (_, offset) => {
        const entry = entries[this.fileDialogTop + offset];
        if (entry === undefined) {
          return offset === 0 && entries.length === 0
            ? ` ${(this.fileDialogSnapshot?.error ?? "No matching files").slice(0, available).padEnd(available)} `
            : ` ${"".padEnd(available)} `;
        }
        const label =
          entry.kind === "directory"
            ? `[DIR] ${entry.displayName}`
            : `${entry.displayName.padEnd(12)} ${String(entry.size).padStart(8)}`;
        return ` ${[...label].slice(0, available).join("").padEnd(available)} `;
      });
      const displayDirectory =
        this.fileDialogSnapshot?.displayDirectory ?? "C:\\";
      const filter = [...this.fileDialogFilter]
        .slice(0, Math.max(1, available - 8))
        .join("");
      const name = [...this.fileDialogPath]
        .slice(-Math.max(1, available - 6))
        .join("");
      const dialogTitle =
        this.fileDialogPurpose === "open" ? "Open File" : "Save As";
      const button = this.fileDialogPurpose === "open" ? "Open" : "Save";
      this.drawDialog(rows, top, left, width, dialogTitle, [
        ` Look in: ${[...displayDirectory].slice(0, Math.max(1, available - 9)).join("")} `,
        " Drives: [C:] [A:] ",
        ` Filter: ${filter} `,
        ...fileRows,
        ` Name: ${name} `,
        ` [ ${button} ]   [ Cancel ]   Tab changes field `,
      ]);
      const selectedOffset = this.fileDialogSelection - this.fileDialogTop;
      if (
        entries.length > 0 &&
        selectedOffset >= 0 &&
        selectedOffset < listRows
      ) {
        this.overlay(
          rows,
          top + 4 + selectedOffset,
          left + 1,
          fileRows[selectedOffset] ?? "",
          dosTuiColor.white,
          dosTuiColor.black,
        );
      }
      if (this.fileDialogFocus === "filter") {
        return {
          x: left + 11 + filter.length,
          y: top + 4,
        };
      }
      if (this.fileDialogFocus === "name") {
        return {
          x: left + 9 + name.length,
          y: top + listRows + 5,
        };
      }
      return {
        x: left + 3,
        y: top + 5 + Math.max(0, selectedOffset),
      };
    }
    const width = Math.max(24, Math.min(58, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 5) / 2));
    const available = Math.max(1, width - 4);
    const visible = [...this.fileDialogPath].slice(-available).join("");
    this.drawDialog(rows, top, left, width, "Open File", [
      ` ${visible.padEnd(available)} `,
      " Enter Open  Esc Cancel ",
    ]);
    return { x: left + 2 + [...visible].length, y: top + 2 };
  }

  private drawClassicFileDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const geometry = this.classicFileDialogGeometry();
    const innerWidth = geometry.width - 2;
    const filesColumn = geometry.filesLeft - geometry.left - 1;
    const directoriesColumn = geometry.directoriesLeft - geometry.left - 1;
    const panes = this.classicFileDialogPaneRows(geometry.listRows);
    const fieldSource =
      this.fileDialogFocus === "name" && this.fileDialogPath.length > 0
        ? this.fileDialogPath
        : this.fileDialogFilter;
    const fieldWidth = Math.max(8, innerWidth - 14);
    const field = [...fieldSource].slice(-Math.max(1, fieldWidth - 2)).join("");
    const displayDirectory = [
      ...(this.fileDialogSnapshot?.displayDirectory ?? "C:\\"),
    ]
      .slice(0, innerWidth - 2)
      .join("");
    const fileRows = Array.from({ length: geometry.listRows }, (_, index) => {
      const entry = panes.files[index];
      if (entry !== undefined) return entry.displayName;
      if (index === 0 && panes.files.length === 0) {
        return this.fileDialogSnapshot?.error ?? "No matching files";
      }
      return "";
    });
    const directoryRows = Array.from(
      { length: geometry.listRows },
      (_, index) =>
        panes.directories[index]?.displayName ??
        (index >= panes.directories.length
          ? panes.drives[index - panes.directories.length] === undefined
            ? ""
            : `[-${panes.drives[index - panes.directories.length]![0]}-]`
          : ""),
    );
    const body = [
      composeFixedRow(innerWidth, [
        {
          column: 1,
          value: `File Name: [${field.padEnd(fieldWidth - 2)}]`,
        },
      ]),
      composeFixedRow(innerWidth, [{ column: 1, value: displayDirectory }]),
      composeFixedRow(innerWidth, [
        {
          column: filesColumn,
          value: centeredText("Files", geometry.filesWidth),
        },
        {
          column: directoriesColumn,
          value: centeredText("Dirs/Drives", geometry.directoriesWidth),
        },
      ]),
      composeFixedRow(innerWidth, [
        {
          column: filesColumn,
          value: `+${"-".repeat(geometry.filesWidth - 2)}+`,
        },
        {
          column: directoriesColumn,
          value: `+${"-".repeat(geometry.directoriesWidth - 3)}↑+`,
        },
      ]),
      ...fileRows.map((file, index) =>
        composeFixedRow(innerWidth, [
          {
            column: filesColumn,
            value: `| ${[...file]
              .slice(0, geometry.filesWidth - 4)
              .join("")
              .padEnd(geometry.filesWidth - 4)} |`,
          },
          {
            column: directoriesColumn,
            value: `| ${[...(directoryRows[index] ?? "")]
              .slice(0, geometry.directoriesWidth - 5)
              .join("")
              .padEnd(geometry.directoriesWidth - 5)}${
              panes.selected?.kind === "directory" &&
              panes.selected.fileName === panes.directories[index]?.fileName
                ? "█"
                : index === 0 && directoryRows.some((value) => value.length > 0)
                  ? "█"
                  : "░"
            } |`,
          },
        ]),
      ),
      composeFixedRow(innerWidth, [
        {
          column: filesColumn,
          value: `←█${"░".repeat(geometry.filesWidth - 3)}→`,
        },
        {
          column: directoriesColumn,
          value: `+${"-".repeat(geometry.directoriesWidth - 3)}↓+`,
        },
      ]),
      composeFixedRow(innerWidth, [
        { column: 10, value: "< OK >" },
        { column: Math.max(24, innerWidth - 25), value: "< Cancel >" },
        { column: Math.max(38, innerWidth - 10), value: "< Help >" },
      ]),
    ];
    this.drawDialog(
      rows,
      geometry.top,
      geometry.left,
      geometry.width,
      this.fileDialogPurpose === "open" ? "Open" : "Save As",
      body,
    );
    if (this.fileDialogFocus === "filter" || this.fileDialogFocus === "name") {
      this.overlay(
        rows,
        geometry.fieldRow,
        geometry.left + 14,
        field.padEnd(fieldWidth - 2),
        dosTuiColor.white,
        dosTuiColor.black,
      );
    }

    const selected = panes.selected;
    if (selected !== undefined) {
      const pane = selected.kind === "file" ? panes.files : panes.directories;
      const row = pane.findIndex(
        ({ fileName }) => fileName === selected.fileName,
      );
      if (row >= 0) {
        const left =
          selected.kind === "file"
            ? geometry.filesLeft
            : geometry.directoriesLeft;
        const width =
          selected.kind === "file"
            ? geometry.filesWidth
            : geometry.directoriesWidth;
        this.overlay(
          rows,
          geometry.listTop + row,
          left + 1,
          ` ${[...selected.displayName]
            .slice(0, width - (selected.kind === "file" ? 3 : 4))
            .join("")
            .padEnd(width - (selected.kind === "file" ? 3 : 4))}${
            selected.kind === "file" ? "" : "█"
          }`,
          dosTuiColor.white,
          dosTuiColor.black,
        );
        if (this.fileDialogFocus === "files") {
          return { x: left + 3, y: geometry.listTop + row + 1 };
        }
      }
    }
    if (this.fileDialogFocus === "files") {
      return { x: geometry.filesLeft + 2, y: geometry.listTop + 1 };
    }
    return {
      x: geometry.left + 15 + [...field].length,
      y: geometry.fieldRow + 1,
    };
  }

  private drawSaveAsDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.max(24, Math.min(58, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 5) / 2));
    const available = Math.max(1, width - 4);
    const visible = [...this.saveAsPath].slice(-available).join("");
    this.drawDialog(rows, top, left, width, "Save As", [
      ` ${visible.padEnd(available)} `,
      " Enter Save  Esc Cancel ",
    ]);
    return { x: left + 2 + [...visible].length, y: top + 2 };
  }

  private drawHelpDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const body = [
      " F1 / Enter / Esc   Close Help",
      " Ctrl+N / Ctrl+O     New / Open",
      " F2 / Ctrl+S        Save",
      " Ctrl+Shift+S       Save As",
      " F3 / Ctrl+F        Find next / Find",
      " Ctrl+H             Replace",
      " Ctrl+A / Shift+key Select",
      " Ctrl+C/X/V         Copy / Cut / Paste",
      " Ctrl+Space         Complete word",
      " F12 / Alt+Left    Definition / back",
      " Ctrl+Shift+O      Document symbols",
      " File              New, open, save, print, exit",
      " Options           Display/edit/language",
      " F10 / Alt+letter   Open menus",
    ];
    const width = Math.max(32, Math.min(54, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - body.length - 2) / 2));
    this.drawDialog(rows, top, left, width, "CS-DOS Editor Help", body);
    return { x: left + 2, y: top + 2 };
  }

  private drawSaveDecisionDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const decision = this.pendingSaveDecision;
    const width = Math.max(28, Math.min(64, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 6) / 2));
    const external = decision?.kind === "external-change";
    this.drawDialog(
      rows,
      top,
      left,
      width,
      external ? "File Changed" : "Confirm Replace",
      external
        ? [
            " The file changed after it was opened. ",
            " Y Overwrite  R Reopen  Esc Cancel ",
          ]
        : [" The destination already exists. ", " Y Replace  Esc Cancel "],
    );
    return { x: left + 2, y: top + 3 };
  }

  private drawExitDialog(rows: HighlightedCell[][]): {
    readonly x: number;
    readonly y: number;
  } {
    const width = Math.max(38, Math.min(54, this.width - 4));
    const left = Math.floor((this.width - width) / 2);
    const top = Math.max(1, Math.floor((this.height - 7) / 2));
    const exiting = this.pendingTransition === "exit";
    const subject =
      this.sourceSnapshot === undefined ? "New file" : "Loaded file";
    const question = exiting
      ? ` ${subject} is not saved. Save it now? `
      : " File is not saved. Save it before continuing? ";
    const failed = this.status.startsWith("Save failed:");
    const buttons = ["< Yes >", "< No >", "<Cancel>", "< Help >"] as const;
    const buttonLine = `  ${buttons.join("   ")} `;
    this.drawDialog(
      rows,
      top,
      left,
      width,
      "",
      failed
        ? [` ${this.status} `, question, buttonLine]
        : [question, buttonLine],
    );
    const buttonRow = top + (failed ? 3 : 2);
    let buttonLeft = left + 3;
    for (const [index, label] of buttons.entries()) {
      const selected = index === this.confirmExitChoice;
      this.overlay(
        rows,
        buttonRow,
        buttonLeft,
        label,
        selected ? dosTuiColor.white : dosTuiColor.black,
        selected ? dosTuiColor.black : dosTuiColor.chrome,
      );
      buttonLeft += [...label].length + 3;
    }
    const selectedLeft =
      left +
      3 +
      buttons
        .slice(0, this.confirmExitChoice)
        .reduce((total, label) => total + [...label].length + 3, 0);
    return { x: selectedLeft + 2, y: buttonRow + 1 };
  }

  private drawDialog(
    rows: HighlightedCell[][],
    top: number,
    left: number,
    width: number,
    title: string,
    body: readonly string[],
  ): void {
    const titleText = title.length === 0 ? "" : ` ${title} `;
    const remaining = Math.max(0, width - 2 - [...titleText].length);
    this.overlay(
      rows,
      top,
      left,
      `${singleLineBox.topLeft}${titleText}${singleLineBox.horizontal.repeat(remaining)}${singleLineBox.topRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    for (let index = 0; index < body.length; index += 1) {
      const text = [...(body[index] ?? "")].slice(0, width - 2).join("");
      this.overlay(
        rows,
        top + index + 1,
        left,
        `${singleLineBox.vertical}${text.padEnd(width - 2)}${singleLineBox.vertical}`,
        dosTuiColor.black,
        dosTuiColor.chrome,
      );
    }
    this.overlay(
      rows,
      top + body.length + 1,
      left,
      `${singleLineBox.bottomLeft}${singleLineBox.horizontal.repeat(width - 2)}${singleLineBox.bottomRight}`,
      dosTuiColor.black,
      dosTuiColor.chrome,
    );
    const bottom = top + body.length + 1;
    drawDosTuiShadow(rows, top, left, width, bottom);
  }

  private footerLine(): string {
    if (this.modeValue === "menu") {
      return this.positionedFooter(` F1=Help  ${this.activeMenuDescription()}`);
    }
    if (this.modeValue !== "editing") return ` ${this.helpLine()}`;
    return this.positionedFooter(
      this.status === "Ready"
        ? " CS-DOS Editor  <F1=Help> Press ALT to activate menus"
        : ` ${this.status}  <F1=Help>`,
    );
  }

  private positionedFooter(left: string): string {
    const right = this.statusPosition;
    const available = this.width - [...right].length - 1;
    if (available <= 0) return right.slice(0, this.width);
    return `${[...left].slice(0, available).join("").padEnd(available)} ${right}`;
  }

  private activeMenuDescription(): string {
    const entry = this.activeMenuEntries()[this.menuItemIndex];
    if (entry === undefined) return "Menu";
    if (entry.action === "new") {
      return "Removes currently loaded file from memory";
    }
    if (entry.action === "open") return "Loads a file from disk";
    if (entry.action === "save") return "Saves the current file";
    if (entry.action === "save-as") return "Saves using a new file name";
    if (entry.action === "print") return "Prints the current file";
    if (entry.action === "exit") return "Exits the CS-DOS Editor";
    return `${entry.label} command`;
  }

  private helpLine(): string {
    if (this.modeValue === "help")
      return "F1=Help  Enter=Execute  Esc=Cancel  Arrow=Next Item";
    if (this.modeValue === "completion")
      return "F1=Help  Enter=Execute  Esc=Cancel  Arrow=Next Item";
    if (this.modeValue === "options")
      return "F1=Help  Enter=Execute  Esc=Cancel  Space=Toggle  Arrow=Next Item";
    if (this.modeValue === "symbols")
      return "F1=Help  Enter=Execute  Esc=Cancel  Arrow=Next Item";
    if (this.modeValue === "command")
      return "F1=Help  Enter=Execute  Esc=Cancel";
    if (this.modeValue === "output")
      return "F1=Help  Enter=Execute  Esc=Cancel  Arrow=Scroll";
    if (this.modeValue === "file-dialog") {
      const ready = this.fileDialogPurpose === "open" ? "Open File" : "Save As";
      if (this.status !== ready) return this.status;
      return "F1=Help  Enter=Execute  Esc=Cancel  Tab=Next Field  Arrow=Next Item";
    }
    if (this.modeValue === "replace")
      return "F1=Help  Enter=Execute  Esc=Cancel  Tab=Next Field";
    if (this.modeValue === "save-as")
      return "F1=Help  Enter=Execute  Esc=Cancel";
    if (this.modeValue === "search")
      return "F1=Help  Enter=Execute  Esc=Cancel";
    if (this.modeValue === "confirm-exit")
      return "F1=Help  Enter=Execute  Esc=Cancel  Tab=Next Field  Arrow=Next Item";
    if (this.modeValue === "confirm-save")
      return "F1=Help  Enter=Execute  Esc=Cancel  Tab=Next Field  Arrow=Next Item";
    if (this.modeValue === "menu")
      return "F1=Help  Enter=Execute  Esc=Cancel  Arrow=Next Item";
    return this.status;
  }

  private menuHeading(index: number): {
    readonly start: number;
    readonly width: number;
  } {
    const name = this.visibleMenuOrder[index]!;
    if (name === "help") {
      const width = [...menuLabels.help].length + 2;
      return { start: Math.max(0, this.width - width), width };
    }
    let start = 1;
    for (let current = 0; current < index; current += 1) {
      start += [...menuLabels[this.visibleMenuOrder[current]!]].length + 3;
    }
    return { start, width: [...menuLabels[name]].length + 2 };
  }

  private editingCursor(): { readonly x: number; readonly y: number } {
    const segment = this.optionsValue.wrap
      ? Math.floor(this.cursorColumn / this.contentWidth)
      : 0;
    const displayColumn = this.optionsValue.wrap
      ? this.cursorColumn - segment * this.contentWidth
      : this.cursorColumn - this.viewLeft;
    return {
      x: Math.max(
        1,
        Math.min(
          this.width - 1,
          this.documentInset + this.gutterWidth + displayColumn + 1,
        ),
      ),
      y: Math.max(3, Math.min(this.height - 2, this.cursorScreenRow() + 3)),
    };
  }

  private ensureVisible(): void {
    this.clampCursor();
    if (!this.optionsValue.wrap) {
      this.viewTopSegment = 0;
      if (this.cursorLine < this.viewTop) this.viewTop = this.cursorLine;
      if (this.cursorLine >= this.viewTop + this.contentRows) {
        this.viewTop = this.cursorLine - this.contentRows + 1;
      }
      if (this.cursorColumn < this.viewLeft) this.viewLeft = this.cursorColumn;
      if (this.cursorColumn >= this.viewLeft + this.contentWidth) {
        this.viewLeft = this.cursorColumn - this.contentWidth + 1;
      }
      this.viewTop = Math.max(0, this.viewTop);
      this.viewLeft = Math.max(0, this.viewLeft);
      return;
    }
    this.viewLeft = 0;
    const segment = Math.floor(this.cursorColumn / this.contentWidth);
    if (
      this.cursorLine < this.viewTop ||
      this.cursorLine - this.viewTop >= this.contentRows
    ) {
      this.viewTop = this.cursorLine;
      this.viewTopSegment = Math.max(0, segment - this.contentRows + 1);
      return;
    }
    const row = this.cursorScreenRow();
    if (row < 0 || row >= this.contentRows) {
      this.viewTop = this.cursorLine;
      this.viewTopSegment = Math.max(0, segment - this.contentRows + 1);
    }
  }

  private cursorScreenRow(): number {
    if (!this.optionsValue.wrap) return this.cursorLine - this.viewTop;
    let row = -this.viewTopSegment;
    for (
      let line = this.viewTop;
      line < this.cursorLine && row < this.contentRows;
      line += 1
    ) {
      row += this.visualRowCount(line);
    }
    return row + Math.floor(this.cursorColumn / this.contentWidth);
  }

  private renderLineRow(
    lineIndex: number,
    segment: number,
    lexState: ViLexState,
  ): { readonly cells: HighlightedCell[]; readonly state: ViLexState } {
    const characters = this.renderedLineCharacters(lineIndex);
    const start = this.optionsValue.wrap
      ? segment * this.contentWidth
      : this.viewLeft;
    const visible = characters.slice(start, start + this.contentWidth);
    let leadingWhitespace = 0;
    while (
      leadingWhitespace < visible.length &&
      (visible[leadingWhitespace] === " " ||
        visible[leadingWhitespace] === "\t")
    ) {
      leadingWhitespace += 1;
    }
    const gutter =
      this.optionsValue.number && segment === 0
        ? `${String(lineIndex + 1).padStart(this.numberDigits)} `
        : " ".repeat(this.gutterWidth);
    const highlighted = highlightLineWithState(
      this.fileName,
      visible.join(""),
      this.contentWidth,
      {
        baseColumn: start,
        endOfLine: start + visible.length >= characters.length,
        filetype: this.optionsValue.filetype,
        lexState,
        list: this.optionsValue.list,
        rainbow: this.optionsValue.rainbow,
        rainbowColumns: start === 0 ? leadingWhitespace : 0,
        rainbowWidth: this.optionsValue.shiftwidth,
        syntax: this.optionsValue.syntax,
      },
    );
    const cells = [
      ...Array.from({ length: this.documentInset }, () => ({
        background: dosTuiColor.document,
        character: "│",
        foreground: dosTuiColor.white,
      })),
      ...[...gutter].map((character) => ({
        background: 11,
        character,
        foreground:
          lineIndex === this.cursorLine && segment === 0
            ? dosTuiColor.activeLineNumber
            : dosTuiColor.chrome,
      })),
      ...highlighted.cells.map((cell) => ({
        ...cell,
        background: cell.background === 15 ? 11 : cell.background,
      })),
    ];
    while (cells.length < this.width) {
      cells.push({ background: 11, character: " ", foreground: 0 });
    }
    if (cells.length > this.width) cells.length = this.width;
    this.paintSelection(cells, lineIndex, start);
    return { cells, state: highlighted.state };
  }

  private visualRowCount(lineIndex: number): number {
    const length = this.renderedLineCharacters(lineIndex).length;
    const displayLength = length + (this.optionsValue.list ? 1 : 0);
    return Math.max(1, Math.ceil(displayLength / this.contentWidth));
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

  private renderedLineCharacters(lineIndex: number): readonly string[] {
    const value = this.lines[lineIndex] ?? "";
    const cached = this.renderedLineCache.get(lineIndex);
    if (cached?.value === value) return cached.characters;
    const characters = [...value];
    this.lineDecodeCountValue += 1;
    if (
      !this.renderedLineCache.has(lineIndex) &&
      this.renderedLineCache.size >= maximumRenderedLineCacheEntries
    ) {
      const oldest = this.renderedLineCache.keys().next().value;
      if (oldest !== undefined) this.renderedLineCache.delete(oldest);
    }
    this.renderedLineCache.set(lineIndex, { characters, value });
    return characters;
  }

  private currentCharacters(): string[] {
    return [...(this.lines[this.cursorLine] ?? "")];
  }

  private get serializedContents(): string {
    return this.lines.join("\r\n");
  }

  private setDocument(
    fileName: string,
    contents: string,
    displayName: string,
    sourceExists: boolean,
  ): void {
    const lines = normalizeEditorContents(contents);
    this.lines.splice(0, this.lines.length, ...lines);
    if (this.lines.length === 0) this.lines.push("");
    this.renderedLineCache.clear();
    this.fileName = fileName;
    this.displayName = displayName;
    this.sourceSnapshot = sourceExists ? contents : undefined;
    this.cursorColumn = 0;
    this.cursorLine = 0;
    this.revision = 0;
    this.savedRevision = 0;
    this.selectionAnchor = undefined;
    this.undo.length = 0;
    this.viewLeft = 0;
    this.viewTop = 0;
    this.viewTopSegment = 0;
    this.completion = undefined;
    this.indexCache = undefined;
    this.includeCache = undefined;
    this.stateValue = "editing";
  }

  private get contentRows(): number {
    return this.height - 4;
  }

  private get contentWidth(): number {
    return Math.max(1, this.width - this.documentInset - this.gutterWidth - 1);
  }

  private get documentInset(): number {
    return 1;
  }

  private get gutterWidth(): number {
    return this.optionsValue.number ? this.numberDigits + 1 : 0;
  }

  private get numberDigits(): number {
    return editorLineNumberDigits;
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

function normalizeEditorContents(contents: string): string[] {
  if (contents.includes("\0") || contents.includes("\x1a")) {
    throw new Error("binary files containing NUL or Ctrl+Z are not supported");
  }
  const lines = contents
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  if (lines.length > maximumEditorLines) {
    throw new Error("document line limit exceeded");
  }
  if (lines.some((line) => [...line].length > maximumLineCharacters)) {
    throw new Error("document line width limit exceeded");
  }
  return lines;
}

function boundedDialogWindow(
  entries: readonly DosFileDialogEntry[],
  selected: DosFileDialogEntry | undefined,
  visibleRows: number,
): readonly DosFileDialogEntry[] {
  if (entries.length <= visibleRows) return entries;
  const selectedIndex =
    selected === undefined
      ? -1
      : entries.findIndex(({ fileName }) => fileName === selected.fileName);
  const top =
    selectedIndex < 0
      ? 0
      : Math.max(
          0,
          Math.min(
            entries.length - visibleRows,
            selectedIndex - Math.floor(visibleRows / 2),
          ),
        );
  return entries.slice(top, top + visibleRows);
}

function centeredText(value: string, width: number): string {
  const visible = [...value].slice(0, width).join("");
  const left = Math.max(0, Math.floor((width - visible.length) / 2));
  return `${" ".repeat(left)}${visible}`.padEnd(width);
}

function titledBorder(title: string, width: number): string {
  const label = ` ${[...title].slice(0, Math.max(0, width - 4)).join("")} `;
  const remaining = Math.max(0, width - 2 - [...label].length);
  const before = Math.floor(remaining / 2);
  return `${singleLineBox.topLeft}${singleLineBox.horizontal.repeat(before)}${label}${singleLineBox.horizontal.repeat(remaining - before)}${singleLineBox.topRight}`;
}

function composeFixedRow(
  width: number,
  segments: readonly { readonly column: number; readonly value: string }[],
): string {
  const characters = Array.from({ length: width }, () => " ");
  for (const { column, value } of segments) {
    for (const [offset, character] of [...value].entries()) {
      const index = column + offset;
      if (index >= width) break;
      if (index >= 0) characters[index] = character;
    }
  }
  return characters.join("");
}

const dosDialogShortNamePattern =
  /^[A-Za-z0-9!#$%&'()@^_`{}~-]{1,8}(?:\.[A-Za-z0-9!#$%&'()@^_`{}~-]{1,3})?$/u;
const dosDialogWildcardPattern =
  /^[A-Za-z0-9!#$%&'()@^_`{}~*?-]{1,8}(?:\.[A-Za-z0-9!#$%&'()@^_`{}~*?-]{0,3})?$/u;

function validateDosFileDialogSnapshot(snapshot: DosFileDialogSnapshot): void {
  if (
    snapshot.directory.length === 0 ||
    snapshot.directory.length > maximumSaveAsCharacters ||
    snapshot.displayDirectory.length === 0 ||
    snapshot.displayDirectory.length > maximumSaveAsCharacters ||
    !Number.isSafeInteger(snapshot.mediaGeneration) ||
    snapshot.mediaGeneration < 0 ||
    snapshot.entries.length > 256 ||
    snapshot.drives.length > 2 ||
    snapshot.drives.some((drive) => drive !== "A:" && drive !== "C:") ||
    (snapshot.error !== undefined && snapshot.error.length > 128)
  ) {
    throw new Error("invalid or oversized file dialog snapshot");
  }
  const identities = new Set<string>();
  const prefix = snapshot.directory.endsWith("/")
    ? snapshot.directory
    : `${snapshot.directory}/`;
  for (const entry of snapshot.entries) {
    const identity = asciiUpper(entry.displayName);
    if (
      !dosDialogShortNamePattern.test(entry.displayName) ||
      entry.fileName.length > maximumSaveAsCharacters ||
      !entry.fileName.startsWith(prefix) ||
      entry.fileName.slice(prefix.length).includes("/") ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      identities.has(identity)
    ) {
      throw new Error("invalid DOS 8.3 file dialog entry");
    }
    identities.add(identity);
  }
}

function validDosFileDialogFilter(filter: string): boolean {
  return (
    filter.length > 0 &&
    filter.length <= 12 &&
    dosDialogWildcardPattern.test(filter)
  );
}

function matchesDosFileDialogFilter(name: string, filter: string): boolean {
  const pattern = asciiUpper(filter === "*.*" ? "*" : filter);
  const value = asciiUpper(name);
  let patternIndex = 0;
  let valueIndex = 0;
  let starIndex = -1;
  let starValueIndex = -1;
  while (valueIndex < value.length) {
    const token = pattern[patternIndex];
    if (token === "?" || token === value[valueIndex]) {
      patternIndex += 1;
      valueIndex += 1;
    } else if (token === "*") {
      starIndex = patternIndex;
      starValueIndex = valueIndex;
      patternIndex += 1;
    } else if (starIndex >= 0) {
      patternIndex = starIndex + 1;
      starValueIndex += 1;
      valueIndex = starValueIndex;
    } else {
      return false;
    }
  }
  while (pattern[patternIndex] === "*") patternIndex += 1;
  return patternIndex === pattern.length;
}

function editorParentDirectory(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  if (/^\/drives\/[a-z]$/u.test(normalized)) return normalized;
  const driveRoot = /^([A-Za-z]):(?:\/.*)?$/u.exec(normalized);
  if (driveRoot !== null) {
    const slash = normalized.lastIndexOf("/");
    return slash <= 2
      ? `${driveRoot[1]!.toUpperCase()}:\\`
      : normalized.slice(0, slash).replaceAll("/", "\\");
  }
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return "/";
  return normalized.slice(0, slash);
}

function editorBaseName(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function joinEditorPath(directory: string, name: string): string {
  const separator = directory.includes("\\") ? "\\" : "/";
  return `${directory.endsWith("/") || directory.endsWith("\\") ? directory : `${directory}${separator}`}${name}`;
}

function asciiUpper(value: string): string {
  return [...value]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 97 && code <= 122
        ? String.fromCodePoint(code - 32)
        : character;
    })
    .join("");
}

function asciiFold(character: string): string {
  const code = character.codePointAt(0) ?? 0;
  return code >= 65 && code <= 90 ? String.fromCodePoint(code + 32) : character;
}

function indexOfAsciiLiteral(
  value: string,
  query: string,
  fromColumn: number,
): number {
  const haystack = [...value];
  const needle = [...query];
  if (needle.length === 0) return Math.min(fromColumn, haystack.length);
  const start = Math.max(0, Math.min(fromColumn, haystack.length));
  for (
    let index = start;
    index + needle.length <= haystack.length;
    index += 1
  ) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (asciiFold(haystack[index + offset]!) !== asciiFold(needle[offset]!)) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function replaceAsciiLiteral(
  value: string,
  query: string,
  replacement: string,
  limit: number,
): { readonly count: number; readonly value: string } {
  const source = [...value];
  const needle = [...query];
  const output: string[] = [];
  let count = 0;
  let column = 0;
  while (column < source.length) {
    let matches = count < limit && column + needle.length <= source.length;
    for (let offset = 0; matches && offset < needle.length; offset += 1) {
      if (asciiFold(source[column + offset]!) !== asciiFold(needle[offset]!)) {
        matches = false;
      }
    }
    if (matches) {
      output.push(replacement);
      column += needle.length;
      count += 1;
    } else {
      output.push(source[column]!);
      column += 1;
    }
  }
  return { count, value: output.join("") };
}
