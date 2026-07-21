import type { HighlightedCell } from "./syntaxHighlight.js";
import type { EditorScreen } from "./editorScreen.js";
import { maximumEditorDocumentLines } from "./editorDocumentLimits.js";
import {
  createTerminalInteractionDescriptor,
  type TerminalInteractionContext,
  type TerminalInteractionDescriptor,
  type TerminalInteractionHint,
} from "../terminal/terminalInteraction.js";

export type PagerMode = "less" | "more";
export type PagerState = "closed" | "viewing";

export type PagerResult =
  | { readonly kind: "continue"; readonly screen: EditorScreen }
  | { readonly kind: "closed"; readonly screen: EditorScreen };

const pagerBackground = 15;
const pagerForeground = 0;
const pagerStatusBackground = 0;
const pagerStatusForeground = 15;

const forwardScreenKeys = new Set(["Space", " ", "PageDown", "f", "Ctrl+F"]);
const forwardLineKeys = new Set(["Enter", "ArrowDown", "j"]);
const backwardScreenKeys = new Set(["PageUp", "b", "Ctrl+B"]);
const backwardLineKeys = new Set(["ArrowUp", "k"]);
const quitKeys = new Set(["q", "Q", "Escape"]);

/**
 * Bounded, read-only text pager backing `more`/`less`. Unlike real Unix
 * pagers it is document-resident (like `ViSession`) and requires a real file
 * path rather than accepting stdin - `more`/`less` are rejected in pipelines
 * and redirects for the same reason `vi` is.
 *
 * `more` is deliberately forward-only (POSIX behavior); `less` adds backward
 * scrolling and top/bottom jumps. No horizontal scroll or search is modeled;
 * long lines truncate at the terminal width.
 */
export class PagerSession {
  private readonly lines: readonly string[];
  private viewTop = 0;
  private stateValue: PagerState = "viewing";

  constructor(
    readonly mode: PagerMode,
    private readonly fileNameValue: string,
    contents: string,
    private widthValue = 80,
    private heightValue = 25,
  ) {
    if (widthValue < 20 || heightValue < 6) {
      throw new RangeError("pager terminal is too small");
    }
    this.lines = normalizePagerContents(contents);
  }

  get fileName(): string {
    return this.fileNameValue;
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  get state(): PagerState {
    return this.stateValue;
  }

  resize(width: number, height: number): EditorScreen {
    if (width < 20 || height < 6) {
      throw new RangeError("pager terminal is too small");
    }
    this.widthValue = width;
    this.heightValue = height;
    this.clampViewTop();
    return this.screen();
  }

  key(key: string): PagerResult {
    if (this.stateValue === "closed") {
      throw new Error("pager session is already closed");
    }
    if (quitKeys.has(key)) {
      this.stateValue = "closed";
      return { kind: "closed", screen: this.screen() };
    }
    if (forwardScreenKeys.has(key)) {
      this.viewTop += this.contentRows;
    } else if (forwardLineKeys.has(key)) {
      this.viewTop += 1;
    } else if (this.mode === "less") {
      if (backwardScreenKeys.has(key)) this.viewTop -= this.contentRows;
      else if (backwardLineKeys.has(key)) this.viewTop -= 1;
      else if (key === "g") this.viewTop = 0;
      else if (key === "G") this.viewTop = this.maxViewTop;
    }
    this.clampViewTop();
    return { kind: "continue", screen: this.screen() };
  }

  screen(): EditorScreen {
    const rows: HighlightedCell[][] = [];
    for (let index = 0; index < this.contentRows; index += 1) {
      rows.push(
        this.plainRow(
          this.lines[this.viewTop + index] ?? "",
          pagerForeground,
          pagerBackground,
        ),
      );
    }
    rows.push(this.statusRow());
    const status = this.statusText();
    const cursor = {
      x: Math.min(this.widthValue, [...status].length + 1),
      y: this.heightValue,
    };
    return { cursor, rows };
  }

  terminalInteraction(): TerminalInteractionDescriptor {
    if (this.stateValue === "closed") {
      return createTerminalInteractionDescriptor({
        context: "unavailable",
        cursorShape: "underline",
        helpTopicId: this.mode,
        history: false,
        inputMode: "none",
        interrupt: false,
        pointer: "none",
        presentation: "terminal",
        secretInput: false,
      });
    }
    const context: TerminalInteractionContext =
      this.mode === "less" ? "less" : "more";
    const hints: readonly TerminalInteractionHint[] =
      this.mode === "less"
        ? [
            { key: "Space", label: "Page down" },
            { key: "b", label: "Page up" },
            { key: "g / G", label: "Top / bottom" },
            { key: "q", label: "Quit" },
          ]
        : [
            { key: "Space", label: "Page down" },
            { key: "Enter", label: "Line down" },
            { key: "q", label: "Quit" },
          ];
    return createTerminalInteractionDescriptor({
      context,
      cursorShape: "block",
      helpTopicId: this.mode,
      history: false,
      hints,
      inputMode: "keys",
      interrupt: false,
      pointer: "none",
      presentation: "dos-tui",
      secretInput: false,
    });
  }

  private get contentRows(): number {
    return this.heightValue - 1;
  }

  private get maxViewTop(): number {
    return Math.max(0, this.lines.length - this.contentRows);
  }

  private clampViewTop(): void {
    this.viewTop = Math.max(0, Math.min(this.maxViewTop, this.viewTop));
  }

  private statusText(): string {
    const atBottom = this.viewTop >= this.maxViewTop;
    if (this.mode === "more") {
      return atBottom
        ? "--More--(END)"
        : `--More--(${String(this.percentage())}%)`;
    }
    return `${this.fileNameValue} (${this.viewportLabel(atBottom)})`;
  }

  private percentage(): number {
    if (this.lines.length === 0) return 100;
    const shown = Math.min(this.lines.length, this.viewTop + this.contentRows);
    return Math.max(
      1,
      Math.min(100, Math.floor((shown * 100) / this.lines.length)),
    );
  }

  private viewportLabel(atBottom: boolean): string {
    if (this.viewTop === 0 && atBottom) return "All";
    if (this.viewTop === 0) return "Top";
    if (atBottom) return "Bot";
    return `${String(this.percentage())}%`;
  }

  private statusRow(): HighlightedCell[] {
    return this.plainRow(
      this.statusText(),
      pagerStatusForeground,
      pagerStatusBackground,
    );
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
    return [...value].slice(0, this.widthValue).map((character) => ({
      background,
      character,
      foreground,
    }));
  }

  private padRow(cells: readonly HighlightedCell[]): HighlightedCell[] {
    const row = cells.slice(0, this.widthValue);
    while (row.length < this.widthValue) {
      row.push({
        background: pagerBackground,
        character: " ",
        foreground: pagerForeground,
      });
    }
    return row;
  }
}

function normalizePagerContents(contents: string): readonly string[] {
  const lines = contents.replaceAll("\r\n", "\n").split("\n");
  if (lines.length > maximumEditorDocumentLines) {
    throw new Error("pager document line limit exceeded");
  }
  return lines.length === 0 ? [""] : lines;
}
