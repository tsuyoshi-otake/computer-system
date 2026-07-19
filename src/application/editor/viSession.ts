import {
  highlightLineWithState,
  type HighlightedCell,
} from "./syntaxHighlight.js";
import type { EditorResult, EditorScreen } from "./editorScreen.js";
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
} from "./viLanguage.js";
import {
  applyViSet,
  defaultViOptions,
  formatViOptions,
  parseViConfiguration,
  type ViOptions,
} from "./viOptions.js";
import {
  editorLineNumberDigits,
  maximumEditorDocumentLines,
} from "./editorDocumentLimits.js";
import {
  createTerminalInteractionDescriptor,
  type TerminalInteractionContext,
  type TerminalInteractionDescriptor,
  type TerminalInteractionHint,
} from "../terminal/terminalInteraction.js";

export type ViMode = "command" | "insert" | "normal";
export type ViState = "closed" | "editing";

export type ViScreen = EditorScreen;
export type ViResult =
  | EditorResult
  | {
      readonly command: string;
      readonly insertOutput: boolean;
      readonly kind: "shell";
      readonly screen: EditorScreen;
    }
  | {
      readonly column: number;
      readonly kind: "navigate";
      readonly line: number;
      readonly path: string;
      readonly screen: EditorScreen;
    };

const maximumUndoStates = 32;
const maximumCommandCharacters = 512;
const maximumInsertedCommandCharacters = 4_096;
const maximumInsertedCommandLines = 128;
const maximumVisibleCommandCharacters = 4_096;

type UndoOperation =
  | { readonly index: number; readonly kind: "replace"; readonly line: string }
  | {
      readonly deleteCount: number;
      readonly index: number;
      readonly kind: "splice";
      readonly lines: readonly string[];
    };

interface ViCommandOutput {
  readonly exitCode?: number;
  readonly lines: readonly string[];
  readonly prompt: string;
  readonly truncated: boolean;
}

interface ViCompletionState {
  readonly candidates: readonly ViCompletionCandidate[];
  readonly originalColumn: number;
  readonly originalDirty: boolean;
  readonly originalLine: string;
  readonly prefixStart: number;
  readonly undoDepth: number;
  selected: number;
}

interface ViJumpLocation {
  readonly column: number;
  readonly line: number;
  readonly path: string | undefined;
}

export class ViSession {
  private readonly lines: string[];
  private readonly undo: UndoOperation[] = [];
  private readonly bufferSummaries: ViBufferSummary[] = [];
  private readonly jumpHistory: ViJumpLocation[] = [];
  private command = "";
  private cursorColumn = 0;
  private cursorLine = 0;
  private completion: ViCompletionState | undefined;
  private dirty = false;
  private fileNameValue: string | undefined;
  private indexCache:
    | {
        readonly contents: string;
        readonly filetype: string;
        readonly index: ViDocumentIndex;
      }
    | undefined;
  private includeCache:
    | {
        readonly contents: string;
        readonly documents: readonly ViExternalDocument[];
      }
    | undefined;
  private lastShellCommand: string | undefined;
  private modeValue: ViMode = "normal";
  private optionsValue: ViOptions = defaultViOptions;
  private output: ViCommandOutput | undefined;
  private pendingNavigation:
    | { readonly failure: "pop" }
    | { readonly failure: "restore"; readonly location: ViJumpLocation }
    | undefined;
  private pendingNormal = "";
  private stateValue: ViState = "editing";
  private status = "NORMAL  i insert  : command";
  private viewLeft = 0;
  private viewTop = 0;
  private viewTopSegment = 0;

  constructor(
    fileName: string | undefined,
    contents: string,
    private widthValue = 51,
    private heightValue = 19,
    configuration = "",
    private readonly externalContext?: ViExternalContextProvider,
  ) {
    if (widthValue < 20 || heightValue < 6)
      throw new RangeError("vi terminal is too small");
    this.fileNameValue = fileName;
    this.lines = normalizeViContents(contents);
    this.optionsValue = parseViConfiguration(configuration);
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

  terminalInteraction(): TerminalInteractionDescriptor {
    if (this.stateValue === "closed") {
      return createTerminalInteractionDescriptor({
        context: "unavailable",
        helpTopicId: "vi",
        inputMode: "none",
        interrupt: false,
        pointer: "none",
        presentation: "terminal",
        secretInput: false,
      });
    }
    const context: TerminalInteractionContext =
      this.output !== undefined ? "vi-output" : `vi-${this.modeValue}`;
    let hints: readonly TerminalInteractionHint[];
    if (this.output !== undefined) {
      hints = [{ key: "Any key", label: "Return to editor" }];
    } else if (this.modeValue === "insert") {
      hints = [{ key: "Esc", label: "Normal mode" }];
    } else if (this.modeValue === "command") {
      hints = [
        { key: "Enter", label: "Run command" },
        { key: "Esc", label: "Cancel" },
      ];
    } else {
      hints = [
        { key: "i", label: "Insert mode" },
        { key: ":", label: "Command mode" },
        { key: ":w", label: "Save" },
        { key: ":q", label: "Quit" },
      ];
    }
    return createTerminalInteractionDescriptor({
      context,
      helpTopicId: "vi",
      hints,
      inputMode: "keys",
      interrupt: false,
      pointer: "none",
      presentation: "dos-tui",
      secretInput: false,
    });
  }

  get contents(): string {
    return this.lines.join("\n");
  }

  get fileName(): string | undefined {
    return this.fileNameValue;
  }

  get options(): ViOptions {
    return this.optionsValue;
  }

  screen(): ViScreen {
    if (this.output !== undefined) return this.outputScreen();
    this.ensureVisible();
    const rows: HighlightedCell[][] = [];
    rows.push(
      this.plainRow(
        `VI  ${this.fileNameValue ?? "[No Name]"}${this.dirty ? " [+]" : ""}`,
        15,
        11,
      ),
    );
    let lineIndex = this.viewTop;
    let segment = this.optionsValue.wrap ? this.viewTopSegment : 0;
    let lexState: ViLexState = { multiline: null };
    for (let offset = 0; offset < this.contentRows; offset += 1) {
      if (lineIndex >= this.lines.length) {
        rows.push(this.plainRow("~", 9, 15));
        continue;
      }
      const rendered = this.renderLineRow(lineIndex, segment, lexState);
      rows.push(rendered.cells);
      lexState = rendered.state;
      if (!this.optionsValue.wrap) {
        lineIndex += 1;
        continue;
      }
      segment += 1;
      if (segment >= this.visualRowCount(lineIndex)) {
        lineIndex += 1;
        segment = 0;
      }
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
    const cursorSegment = this.optionsValue.wrap
      ? Math.floor(this.cursorColumn / this.contentWidth)
      : 0;
    const cursorDisplayColumn = this.optionsValue.wrap
      ? this.cursorColumn - cursorSegment * this.contentWidth
      : this.cursorColumn - this.viewLeft;
    const y = this.cursorScreenRow() + 2;
    const x = Math.min(this.width, this.gutterWidth + cursorDisplayColumn + 1);
    return { cursor: { x, y }, rows };
  }

  key(key: string): ViResult {
    this.assertEditing();
    if (this.output !== undefined) {
      this.output = undefined;
      return this.continue("NORMAL");
    }
    if (key.length > 32) return this.continue("Key ignored");
    if (this.modeValue === "insert") return this.insertKey(key);
    if (this.modeValue === "command") return this.commandKey(key);
    return this.normalKey(key);
  }

  completeSave(closeAfter: boolean, fileName?: string): ViResult {
    if (fileName !== undefined && fileName !== this.fileNameValue) {
      this.fileNameValue = fileName;
      this.indexCache = undefined;
      this.includeCache = undefined;
    }
    this.dirty = false;
    this.status = `Wrote ${this.lines.length} lines`;
    if (!closeAfter) return { kind: "continue", screen: this.screen() };
    this.stateValue = "closed";
    return { kind: "closed", discardedChanges: false, screen: this.screen() };
  }

  completeNavigation(
    path: string,
    contents: string,
    line: number,
    column: number,
  ): ViResult {
    let lines: string[];
    try {
      lines = normalizeViContents(contents);
    } catch (error) {
      return this.failNavigation(
        error instanceof Error ? error.message : String(error),
      );
    }
    this.pendingNavigation = undefined;
    this.fileNameValue = path;
    this.lines.splice(0, this.lines.length, ...lines);
    this.cursorLine = line;
    this.cursorColumn = column;
    this.dirty = false;
    this.undo.splice(0);
    this.completion = undefined;
    this.indexCache = undefined;
    this.includeCache = undefined;
    this.viewLeft = 0;
    this.viewTop = 0;
    this.viewTopSegment = 0;
    this.clampCursor();
    return this.continue(`Definition: ${path}:${String(line + 1)}`);
  }

  failNavigation(detail: string): ViResult {
    if (this.pendingNavigation?.failure === "pop") this.jumpHistory.pop();
    if (this.pendingNavigation?.failure === "restore")
      this.pushJump(this.pendingNavigation.location);
    this.pendingNavigation = undefined;
    return this.continue(`Definition jump failed: ${detail}`);
  }

  failSave(detail: string): ViResult {
    return this.continue(`Write failed: ${detail}`);
  }

  completeShellCommand(
    exitCode: number,
    stdout: string,
    stderr: string,
    insertOutput: boolean,
  ): ViResult {
    if (!insertOutput) {
      this.showOutput(
        `${stdout}${stderr}`,
        `Press any key to return  [exit ${String(exitCode)}]`,
        exitCode,
      );
      return { kind: "continue", screen: this.screen() };
    }
    const normalized = stdout.replaceAll("\r\n", "\n");
    const withoutFinalNewline = normalized.endsWith("\n")
      ? normalized.slice(0, -1)
      : normalized;
    const inserted =
      withoutFinalNewline.length === 0 ? [] : withoutFinalNewline.split("\n");
    if (
      inserted.length > maximumInsertedCommandLines ||
      [...withoutFinalNewline].length > maximumInsertedCommandCharacters
    ) {
      return this.continue(
        `Command output exceeds ${String(maximumInsertedCommandLines)} lines or ${String(maximumInsertedCommandCharacters)} characters`,
      );
    }
    if (this.lines.length + inserted.length > maximumEditorDocumentLines) {
      return this.continue("Command output exceeds document line limit");
    }
    if (inserted.length > 0) {
      this.remember({
        deleteCount: inserted.length,
        index: this.cursorLine + 1,
        kind: "splice",
        lines: [],
      });
      this.lines.splice(this.cursorLine + 1, 0, ...inserted);
      this.cursorLine += inserted.length;
      this.cursorColumn = 0;
      this.dirty = true;
    }
    const detail = stderr.replaceAll("\r\n", "\n").trim().split("\n")[0];
    return this.continue(
      detail === undefined || detail.length === 0
        ? `Command exited ${String(exitCode)}; inserted ${String(inserted.length)} lines`
        : `Command exited ${String(exitCode)}: ${detail}`,
    );
  }

  private normalKey(key: string): ViResult {
    if (key === "Ctrl+O") return this.jumpBack();
    if (key === "d" && this.pendingNormal === "g") {
      this.pendingNormal = "";
      return this.gotoDefinition();
    }
    if (key === ":") {
      this.modeValue = "command";
      this.command = "";
      return this.continue("COMMAND");
    }
    if (key === "i") {
      this.modeValue = "insert";
      return this.continue("INSERT");
    }
    if (key === "I") {
      this.cursorColumn =
        /^\s*/u.exec(this.lines[this.cursorLine] ?? "")?.[0].length ?? 0;
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
    if (key === "A") {
      this.cursorColumn = this.currentCharacters().length;
      this.modeValue = "insert";
      return this.continue("INSERT");
    }
    if (key === "o") {
      if (this.lines.length >= maximumEditorDocumentLines)
        return this.continue("Document line limit reached");
      const indent = this.optionsValue.autoindent
        ? (/^\s*/u.exec(this.lines[this.cursorLine] ?? "")?.[0] ?? "")
        : "";
      this.remember({
        deleteCount: 1,
        index: this.cursorLine + 1,
        kind: "splice",
        lines: [],
      });
      this.lines.splice(this.cursorLine + 1, 0, indent);
      this.cursorLine += 1;
      this.cursorColumn = indent.length;
      this.dirty = true;
      this.modeValue = "insert";
      return this.continue("INSERT");
    }
    if (key === "O") {
      if (this.lines.length >= maximumEditorDocumentLines)
        return this.continue("Document line limit reached");
      const indent = this.optionsValue.autoindent
        ? (/^\s*/u.exec(this.lines[this.cursorLine] ?? "")?.[0] ?? "")
        : "";
      this.remember({
        deleteCount: 1,
        index: this.cursorLine,
        kind: "splice",
        lines: [],
      });
      this.lines.splice(this.cursorLine, 0, indent);
      this.cursorColumn = indent.length;
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
    if (key === ">" || key === "<") {
      if (this.pendingNormal === key) {
        this.pendingNormal = "";
        this.indentCurrentLine(key === ">");
        return this.continue(key === ">" ? "Indented" : "Unindented");
      }
      this.pendingNormal = key;
      return this.continue(key);
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
    if (key === "Q" && this.pendingNormal === "Z") {
      this.pendingNormal = "";
      this.stateValue = "closed";
      return {
        kind: "closed",
        discardedChanges: this.dirty,
        screen: this.screen(),
      };
    }
    if (key === "g") {
      if (this.pendingNormal === "g") {
        this.pendingNormal = "";
        this.cursorLine = 0;
        this.cursorColumn = 0;
        return this.continue("Top");
      }
      this.pendingNormal = "g";
      return this.continue("g");
    }
    this.pendingNormal = "";
    if (key === "h" || key === "ArrowLeft") this.cursorColumn -= 1;
    else if (key === "l" || key === "ArrowRight") this.cursorColumn += 1;
    else if (key === "k" || key === "ArrowUp") this.cursorLine -= 1;
    else if (key === "j" || key === "ArrowDown") this.cursorLine += 1;
    else if (key === "0" || key === "Home") this.cursorColumn = 0;
    else if (key === "$" || key === "End")
      this.cursorColumn = this.currentCharacters().length;
    else if (key === "G") {
      this.cursorLine = this.lines.length - 1;
      this.cursorColumn = 0;
    } else if (key === "PageUp") this.cursorLine -= this.height - 3;
    else if (key === "PageDown") this.cursorLine += this.height - 3;
    else return this.continue("NORMAL");
    this.clampCursor();
    return this.continue(`Line ${this.cursorLine + 1}`);
  }

  private insertKey(key: string): ViResult {
    if (key === "Ctrl+N") return this.completeWord(1);
    if (key === "Ctrl+P") return this.completeWord(-1);
    if (key === "Ctrl+E") return this.cancelCompletion();
    this.completion = undefined;
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
      if (this.lines.length >= maximumEditorDocumentLines)
        return this.continue("Document line limit reached");
      const original = this.lines[this.cursorLine] ?? "";
      const characters = this.currentCharacters();
      const before = characters.slice(0, this.cursorColumn).join("");
      const after = characters.slice(this.cursorColumn).join("");
      const indent = this.optionsValue.autoindent
        ? (/^\s*/u.exec(before)?.[0] ?? "")
        : "";
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
      } else if (this.cursorLine > 0) {
        const previous = this.lines[this.cursorLine - 1] ?? "";
        const current = this.lines[this.cursorLine] ?? "";
        this.remember({
          deleteCount: 1,
          index: this.cursorLine - 1,
          kind: "splice",
          lines: [previous, current],
        });
        this.lines.splice(this.cursorLine - 1, 2, `${previous}${current}`);
        this.cursorLine -= 1;
        this.cursorColumn = [...previous].length;
        this.dirty = true;
      }
      return this.continue("INSERT");
    }
    if (key === "Tab") {
      key = this.optionsValue.expandtab
        ? " ".repeat(
            this.optionsValue.tabstop -
              (this.cursorColumn % this.optionsValue.tabstop),
          )
        : "\t";
    }
    if (
      [...key].length > Math.max(2, this.optionsValue.tabstop) ||
      key.length === 0
    ) {
      return this.continue("INSERT");
    }
    this.rememberCurrentLine();
    const characters = this.currentCharacters();
    characters.splice(this.cursorColumn, 0, ...key);
    this.lines[this.cursorLine] = characters.join("");
    this.cursorColumn += [...key].length;
    this.dirty = true;
    return this.continue("INSERT");
  }

  private commandKey(key: string): ViResult {
    if (key === "Escape" || key === "Ctrl+[") {
      this.modeValue = "normal";
      this.command = "";
      return this.continue("NORMAL");
    }
    if (key === "Backspace") {
      if (this.command.length === 0) {
        this.modeValue = "normal";
        return this.continue("NORMAL");
      }
      this.command = [...this.command].slice(0, -1).join("");
      return this.continue("COMMAND");
    }
    if (key !== "Enter") {
      if (
        [...key].length === 1 &&
        this.command.length < maximumCommandCharacters
      ) {
        this.command += key;
      }
      return this.continue("COMMAND");
    }
    const command = this.command.trim();
    this.command = "";
    this.modeValue = "normal";
    const syntax = /^syntax\s+(on|off)$/u.exec(command);
    if (syntax !== null) {
      this.applyOptions({
        ...this.optionsValue,
        syntax: syntax[1] === "on",
      });
      return this.continue(`syntax ${syntax[1]}`);
    }
    if (command.startsWith("syntax")) {
      return this.continue("Usage: :syntax on|off");
    }
    const set = /^set(?:\s+(.*))?$/u.exec(command);
    if (set !== null) return this.setOptions(set[1] ?? "");
    if (command === "symbols") return this.showSymbols();

    const readShell = /^r\s+!(.*)$/u.exec(command);
    if (readShell !== null) {
      const shellCommand = readShell[1]!.trim();
      if (shellCommand.length === 0) return this.continue("Usage: :r !command");
      this.lastShellCommand = shellCommand;
      return {
        command: shellCommand,
        insertOutput: true,
        kind: "shell",
        screen: this.screen(),
      };
    }
    if (command.startsWith("!")) {
      const authored = command.slice(1).trim();
      const shellCommand = authored === "!" ? this.lastShellCommand : authored;
      if (shellCommand === undefined || shellCommand.length === 0) {
        return this.continue("No previous shell command");
      }
      this.lastShellCommand = shellCommand;
      return {
        command: shellCommand,
        insertOutput: false,
        kind: "shell",
        screen: this.screen(),
      };
    }
    if (/^w(?:q!?)?\s+!/u.test(command)) {
      return this.continue(":w !command is unsupported; use :! or :r !");
    }
    const write = /^(w|wq!?|x|xit)(?:\s+(.+))?$/u.exec(command);
    if (write !== null) {
      return {
        kind: "save",
        closeAfter: write[1] !== "w",
        contents: this.contents,
        ...(write[2] === undefined ? {} : { fileName: write[2] }),
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

  private setOptions(authored: string): ViResult {
    const tokens = authored.trim().split(/\s+/u).filter(Boolean);
    if (tokens.length === 0) {
      this.showOutput(
        formatViOptions(this.optionsValue).join(" "),
        "Press any key to return",
      );
      return { kind: "continue", screen: this.screen() };
    }
    try {
      const applied = applyViSet(this.optionsValue, tokens);
      this.applyOptions(applied.options);
      if (applied.messages.length > 0) {
        this.showOutput(applied.messages.join(" "), "Press any key to return");
        return { kind: "continue", screen: this.screen() };
      }
      return this.continue(`Options updated: ${tokens.join(" ")}`);
    } catch (error: unknown) {
      this.showOutput(
        error instanceof Error ? error.message : String(error),
        "Press any key to return",
      );
      return { kind: "continue", screen: this.screen() };
    }
  }

  private completeWord(direction: 1 | -1): ViResult {
    if (!this.optionsValue.complete)
      return this.continue("Completion disabled");
    if (this.completion === undefined) {
      const prefix = viWordPrefix(
        this.lines[this.cursorLine] ?? "",
        this.cursorColumn,
      );
      if (prefix.text.length < this.optionsValue.completeprefix)
        return this.continue(
          `Completion needs ${String(this.optionsValue.completeprefix)} characters`,
        );
      const candidates = collectViCompletions(
        this.optionsValue,
        prefix.text,
        this.cursorLine,
        this.currentIndex(),
        this.bufferSummaries,
        this.optionsValue.completesources.includes("includes")
          ? this.includeDocuments()
          : [],
      );
      if (candidates.length === 0)
        return this.continue(`No completion for ${prefix.text}`);
      const undoDepth = this.undo.length;
      this.rememberCurrentLine();
      this.completion = {
        candidates,
        originalColumn: this.cursorColumn,
        originalDirty: this.dirty,
        originalLine: this.lines[this.cursorLine] ?? "",
        prefixStart: prefix.start,
        selected: direction === 1 ? 0 : candidates.length - 1,
        undoDepth,
      };
    } else {
      this.completion.selected =
        (this.completion.selected +
          direction +
          this.completion.candidates.length) %
        this.completion.candidates.length;
    }
    const completion = this.completion;
    const candidate = completion.candidates[completion.selected]!;
    const original = [...completion.originalLine];
    this.lines[this.cursorLine] = [
      ...original.slice(0, completion.prefixStart),
      ...candidate.text,
      ...original.slice(completion.originalColumn),
    ].join("");
    this.cursorColumn = completion.prefixStart + [...candidate.text].length;
    this.dirty = true;
    return this.continue(
      `[${String(completion.selected + 1)}/${String(completion.candidates.length)}] ${candidate.text} (${candidate.source})`,
    );
  }

  private cancelCompletion(): ViResult {
    const completion = this.completion;
    if (completion === undefined) return this.continue("No active completion");
    this.lines[this.cursorLine] = completion.originalLine;
    this.cursorColumn = completion.originalColumn;
    this.dirty = completion.originalDirty;
    this.undo.length = completion.undoDepth;
    this.completion = undefined;
    return this.continue("Completion cancelled");
  }

  private gotoDefinition(): ViResult {
    const name = viWordAt(this.lines[this.cursorLine] ?? "", this.cursorColumn);
    if (name.length === 0) return this.continue("No symbol under cursor");
    const symbol = findViDefinition(
      name,
      this.currentIndex(),
      this.bufferSummaries,
      this.optionsValue.definitionsources.includes("includes")
        ? this.includeDocuments()
        : [],
      this.optionsValue,
    );
    if (symbol === undefined)
      return this.continue(`Definition not found: ${name}`);
    return this.navigateTo(symbol.path, symbol.line, symbol.column, name);
  }

  private jumpBack(): ViResult {
    const target = this.jumpHistory.pop();
    if (target === undefined) return this.continue("Jump history is empty");
    if (this.dirty) {
      this.jumpHistory.push(target);
      return this.continue("Write changes before leaving this buffer");
    }
    if (target.path === this.fileNameValue) {
      this.cursorLine = target.line;
      this.cursorColumn = target.column;
      this.clampCursor();
      return this.continue("Jumped back");
    }
    if (target.path === undefined) {
      this.jumpHistory.push(target);
      return this.continue("Cannot reload an unnamed buffer");
    }
    this.rememberCurrentBuffer();
    this.pendingNavigation = { failure: "restore", location: target };
    return {
      column: target.column,
      kind: "navigate",
      line: target.line,
      path: target.path,
      screen: this.screen(),
    };
  }

  private navigateTo(
    path: string | undefined,
    line: number,
    column: number,
    name: string,
  ): ViResult {
    if (path === undefined || path === this.fileNameValue) {
      this.pushJump({
        column: this.cursorColumn,
        line: this.cursorLine,
        path: this.fileNameValue,
      });
      this.cursorLine = line;
      this.cursorColumn = column;
      this.clampCursor();
      return this.continue(`Definition: ${name}`);
    }
    if (this.dirty)
      return this.continue("Write changes before leaving this buffer");
    this.rememberCurrentBuffer();
    this.pushJump({
      column: this.cursorColumn,
      line: this.cursorLine,
      path: this.fileNameValue,
    });
    this.pendingNavigation = { failure: "pop" };
    return {
      column,
      kind: "navigate",
      line,
      path,
      screen: this.screen(),
    };
  }

  private showSymbols(): ViResult {
    const symbols = this.currentIndex().symbols;
    this.showOutput(
      symbols.length === 0
        ? "No symbols"
        : symbols
            .map(
              (symbol) =>
                `${String(symbol.line + 1)}:${String(symbol.column + 1)} ${symbol.kind} ${symbol.name}`,
            )
            .join("\n"),
      "Press any key to return",
    );
    return { kind: "continue", screen: this.screen() };
  }

  private currentIndex(): ViDocumentIndex {
    const contents = this.contents;
    const filetype = resolveViFiletype(
      this.optionsValue.filetype,
      this.fileNameValue,
      this.lines[0],
    );
    if (
      this.indexCache?.contents === contents &&
      this.indexCache.filetype === filetype
    )
      return this.indexCache.index;
    const index = indexViDocument(filetype, this.fileNameValue, contents);
    this.indexCache = { contents, filetype, index };
    return index;
  }

  private includeDocuments(): readonly ViExternalDocument[] {
    const contents = this.contents;
    if (this.includeCache?.contents === contents)
      return this.includeCache.documents;
    if (this.externalContext === undefined) return [];
    let documents: readonly ViExternalDocument[];
    try {
      documents = this.externalContext({
        fileName: this.fileNameValue,
        includes: this.currentIndex().includes,
      });
    } catch {
      documents = [];
    }
    this.includeCache = { contents, documents };
    return documents;
  }

  private rememberCurrentBuffer(): void {
    if (this.fileNameValue === undefined) return;
    const existing = this.bufferSummaries.findIndex(
      (buffer) => buffer.path === this.fileNameValue,
    );
    if (existing >= 0) this.bufferSummaries.splice(existing, 1);
    this.bufferSummaries.unshift({
      index: this.currentIndex(),
      path: this.fileNameValue,
    });
    if (this.bufferSummaries.length > maximumViBufferSummaries)
      this.bufferSummaries.length = maximumViBufferSummaries;
  }

  private pushJump(location: ViJumpLocation): void {
    if (this.jumpHistory.length === maximumViJumpHistory)
      this.jumpHistory.shift();
    this.jumpHistory.push(location);
  }

  private applyOptions(options: ViOptions): void {
    const filetypeChanged = options.filetype !== this.optionsValue.filetype;
    const viewportChanged =
      options.number !== this.optionsValue.number ||
      options.wrap !== this.optionsValue.wrap;
    this.optionsValue = Object.freeze({ ...options });
    this.completion = undefined;
    if (filetypeChanged) {
      this.indexCache = undefined;
      this.includeCache = undefined;
    }
    if (viewportChanged) {
      this.viewTop = this.cursorLine;
      this.viewTopSegment = 0;
      this.viewLeft = 0;
    }
  }

  private indentCurrentLine(increase: boolean): void {
    const characters = this.currentCharacters();
    this.rememberCurrentLine();
    if (increase) {
      const tabs = this.optionsValue.expandtab
        ? 0
        : Math.floor(this.optionsValue.shiftwidth / this.optionsValue.tabstop);
      const spaces =
        this.optionsValue.shiftwidth - tabs * this.optionsValue.tabstop;
      const indentation = [..."\t".repeat(tabs), ..." ".repeat(spaces)];
      characters.splice(0, 0, ...indentation);
      this.cursorColumn += indentation.length;
    } else {
      let columns = 0;
      let removed = 0;
      while (
        removed < characters.length &&
        columns < this.optionsValue.shiftwidth
      ) {
        const character = characters[removed];
        if (character !== " " && character !== "\t") break;
        columns += character === "\t" ? this.optionsValue.tabstop : 1;
        removed += 1;
      }
      characters.splice(0, removed);
      this.cursorColumn = Math.max(0, this.cursorColumn - removed);
    }
    this.lines[this.cursorLine] = characters.join("");
    this.dirty = true;
    this.clampCursor();
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
      return;
    }
    this.viewLeft = 0;
    const cursorSegment = Math.floor(this.cursorColumn / this.contentWidth);
    if (
      this.cursorLine < this.viewTop ||
      this.cursorLine - this.viewTop >= this.contentRows
    ) {
      this.viewTop = this.cursorLine;
      this.viewTopSegment = Math.max(0, cursorSegment - this.contentRows + 1);
      return;
    }
    const cursorRow = this.cursorScreenRow();
    if (cursorRow < 0 || cursorRow >= this.contentRows) {
      this.viewTop = this.cursorLine;
      this.viewTopSegment = Math.max(0, cursorSegment - this.contentRows + 1);
    }
  }

  private cursorScreenRow(): number {
    if (!this.optionsValue.wrap) return this.cursorLine - this.viewTop;
    let row = -this.viewTopSegment;
    for (
      let lineIndex = this.viewTop;
      lineIndex < this.cursorLine && row < this.contentRows;
      lineIndex += 1
    ) {
      row += this.visualRowCount(lineIndex);
    }
    return row + Math.floor(this.cursorColumn / this.contentWidth);
  }

  private renderLineRow(
    lineIndex: number,
    segment: number,
    lexState: ViLexState,
  ): { readonly cells: HighlightedCell[]; readonly state: ViLexState } {
    const characters = [...(this.lines[lineIndex] ?? "")];
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
      this.fileNameValue ?? "",
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
      ...this.plainCells(
        gutter,
        lineIndex === this.cursorLine && segment === 0 ? 0 : 8,
        15,
      ),
      ...highlighted.cells,
    ];
    return { cells: this.padRow(cells), state: highlighted.state };
  }

  private visualRowCount(lineIndex: number): number {
    const characters = [...(this.lines[lineIndex] ?? "")].length;
    const displayLength = characters + (this.optionsValue.list ? 1 : 0);
    return Math.max(1, Math.ceil(displayLength / this.contentWidth));
  }

  private get contentRows(): number {
    return this.height - 3;
  }

  private get contentWidth(): number {
    return Math.max(1, this.width - this.gutterWidth);
  }

  private get gutterWidth(): number {
    return this.optionsValue.number ? this.numberDigits + 1 : 0;
  }

  private get numberDigits(): number {
    return editorLineNumberDigits;
  }

  private showOutput(value: string, prompt: string, exitCode?: number): void {
    const normalized = value.replaceAll("\r\n", "\n");
    const authoredCharacters = [...normalized];
    const boundedCharacters = authoredCharacters.slice(
      0,
      maximumVisibleCommandCharacters,
    );
    const bounded = boundedCharacters.join("");
    const lines: string[] = [];
    for (const sourceLine of bounded.split("\n")) {
      const characters = [...sourceLine];
      if (characters.length === 0) {
        lines.push("");
        continue;
      }
      for (let start = 0; start < characters.length; start += this.width) {
        lines.push(characters.slice(start, start + this.width).join(""));
      }
    }
    const maximumLines = this.height - 2;
    this.output = {
      ...(exitCode === undefined ? {} : { exitCode }),
      lines: lines.slice(0, maximumLines),
      prompt,
      truncated:
        authoredCharacters.length > maximumVisibleCommandCharacters ||
        lines.length > maximumLines,
    };
  }

  private outputScreen(): ViScreen {
    const output = this.output;
    if (output === undefined) throw new Error("vi output state is unavailable");
    const rows: HighlightedCell[][] = [
      this.plainRow(
        `VI  ${this.fileNameValue ?? "[No Name]"}  command output`,
        15,
        11,
      ),
    ];
    const maximumLines = this.height - 2;
    for (let index = 0; index < maximumLines; index += 1) {
      rows.push(this.plainRow(output.lines[index] ?? "", 0, 15));
    }
    rows.push(
      this.plainRow(
        `${output.prompt}${output.truncated ? "  [truncated]" : ""}`,
        0,
        15,
      ),
    );
    return { cursor: { x: 1, y: this.height }, rows };
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

function normalizeViContents(contents: string): string[] {
  const lines = contents.replaceAll("\r\n", "\n").split("\n");
  if (lines.length > maximumEditorDocumentLines) {
    throw new Error("vi document line limit exceeded");
  }
  return lines.length === 0 ? [""] : lines;
}
