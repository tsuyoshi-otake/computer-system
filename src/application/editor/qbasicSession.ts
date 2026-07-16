import { DosEditSession } from "./dosEditSession.js";
import type { EditorResult, EditorScreen } from "./editorScreen.js";
import type { HighlightedCell } from "./syntaxHighlight.js";

export type QBasicRunMode =
  "continue" | "restart" | "run-to-cursor" | "step" | "step-over";

export type QBasicSessionResult =
  | EditorResult
  | {
      readonly kind: "run";
      readonly mode: QBasicRunMode;
      readonly screen: EditorScreen;
    };

export interface QBasicSessionOptions {
  readonly editorMode?: boolean;
  readonly showWelcome?: boolean;
}

export interface TerminalMouseEvent {
  readonly action: "down" | "move" | "up";
  readonly button: 0 | 1 | 2;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
}

/** Shared UI controller used by QBASIC and, in editor mode, DOS EDIT. */
export class QBasicSession {
  private readonly editor: DosEditSession;
  private readonly breakpoints = new Set<number>();
  private readonly pressedButtons = new Set<0 | 1 | 2>();
  private output = "";
  private outputVisible = false;
  private primaryDrag = false;
  private status = "Ready";
  private welcomeVisible: boolean;

  constructor(
    readonly fileName: string,
    contents: string,
    width = 51,
    height = 19,
    readonly displayName = fileName,
    readonly options: QBasicSessionOptions = {},
  ) {
    this.editor = new DosEditSession(
      fileName,
      contents,
      width,
      height,
      displayName,
    );
    this.welcomeVisible = options.showWelcome ?? false;
  }

  get contents(): string {
    return this.editor.contents;
  }

  get state(): "closed" | "editing" {
    return this.editor.state;
  }

  completeRun(exitCode: number, output = ""): EditorScreen {
    this.output = output.slice(0, 256_000);
    this.status =
      exitCode === 0
        ? "Program finished"
        : `Program stopped with status ${String(exitCode)}`;
    this.outputVisible = false;
    return this.screen();
  }

  completeSave(closeAfter: boolean): QBasicSessionResult {
    return this.transform(this.editor.completeSave(closeAfter));
  }

  failSave(detail: string): QBasicSessionResult {
    return this.transform(this.editor.failSave(detail));
  }

  resize(width: number, height: number): EditorScreen {
    this.editor.resize(width, height);
    return this.screen();
  }

  screen(): EditorScreen {
    const base = this.editor.screen();
    const rows = base.rows.map((row) => row.map((cell) => ({ ...cell })));
    if (this.options.editorMode !== true) {
      rows[0] = row(
        " File  Edit  View  Search  Run  Debug  Options  Help",
        base.rows[0]?.length ?? 51,
        15,
        8,
      );
      rows[rows.length - 1] = row(
        this.status === "Ready"
          ? "F1 Help  F4 Output  Shift+F5 Run  F9 Breakpoint marker"
          : `${this.status} | Shift+F5 Run`,
        base.rows[0]?.length ?? 51,
        15,
        8,
      );
    }
    if (this.outputVisible) this.drawOutput(rows);
    if (this.welcomeVisible) this.drawWelcome(rows);
    return {
      cursor:
        this.outputVisible || this.welcomeVisible
          ? { x: 1, y: 1 }
          : base.cursor,
      rows,
    };
  }

  key(key: string): QBasicSessionResult {
    if (this.welcomeVisible) {
      if (key === "Enter" || key === "Escape" || key === "F1") {
        this.welcomeVisible = false;
        this.status = key === "F1" ? "F1 opens context help" : "Ready";
      }
      return { kind: "continue", screen: this.screen() };
    }
    if (this.options.editorMode !== true) {
      if (key === "F4") {
        this.outputVisible = !this.outputVisible;
        this.status = this.outputVisible ? "Output window" : "Program window";
        return { kind: "continue", screen: this.screen() };
      }
      if (this.outputVisible && key === "Escape") {
        this.outputVisible = false;
        this.status = "Program window";
        return { kind: "continue", screen: this.screen() };
      }
      if (key === "F9") {
        const line = this.editor.cursor.line;
        if (this.breakpoints.has(line)) {
          this.breakpoints.delete(line);
          this.status = `Breakpoint marker removed at line ${String(line + 1)}; debugger unavailable`;
        } else {
          this.breakpoints.add(line);
          this.status = `Breakpoint marker set at line ${String(line + 1)}; debugger unavailable`;
        }
        return { kind: "continue", screen: this.screen() };
      }
      const runMode = runModeForKey(key);
      if (runMode !== undefined) {
        if (runMode !== "restart") {
          this.status = `${runLabel(runMode)} is not implemented`;
          return { kind: "continue", screen: this.screen() };
        }
        this.status = runStatus(runMode);
        return { kind: "run", mode: runMode, screen: this.screen() };
      }
    }
    return this.transform(this.editor.key(key));
  }

  mouse(event: TerminalMouseEvent): QBasicSessionResult {
    if (event.action === "up") {
      this.pressedButtons.delete(event.button);
      if (event.button === 0) this.primaryDrag = false;
      return { kind: "continue", screen: this.screen() };
    }
    if (event.action === "move") {
      if (this.primaryDrag && this.pressedButtons.has(0)) {
        return this.transform(this.editor.pointerMove(event.x, event.y));
      }
      return { kind: "continue", screen: this.screen() };
    }
    this.pressedButtons.add(event.button);
    if (event.button !== 0) {
      this.primaryDrag = false;
      this.status = "Only the primary button is used by the IDE";
      return { kind: "continue", screen: this.screen() };
    }
    if (this.welcomeVisible) {
      this.primaryDrag = false;
      this.welcomeVisible = false;
      this.status = "Ready";
      return { kind: "continue", screen: this.screen() };
    }
    if (this.options.editorMode !== true && event.y === 1) {
      this.primaryDrag = false;
      const heading = qbasicHeadingAt(event.x);
      if (heading === "view") return this.key("F4");
      if (heading === "run") return this.key("Shift+F5");
      if (heading === "debug") return this.key("F9");
      if (heading !== undefined) {
        return this.transform(this.editor.key(`Alt+${heading[0]}`));
      }
    }
    if (this.outputVisible) {
      this.primaryDrag = false;
      this.status = "Output window is read-only";
      return { kind: "continue", screen: this.screen() };
    }
    this.primaryDrag = event.y >= 2 && event.y <= this.editor.height - 2;
    return this.transform(this.editor.pointerDown(event.x, event.y));
  }

  private transform(result: EditorResult): QBasicSessionResult {
    return { ...result, screen: this.screen() };
  }

  private drawOutput(rows: HighlightedCell[][]): void {
    const width = rows[0]?.length ?? 0;
    const height = rows.length;
    for (let y = 1; y < Math.max(1, height - 2); y += 1) {
      rows[y] = row("", width, 0, 11);
    }
    const lines = this.output.replaceAll("\r\n", "\n").split("\n");
    for (
      let index = 0;
      index < Math.min(lines.length, height - 3);
      index += 1
    ) {
      rows[index + 1] = row(lines[index] ?? "", width, 0, 11);
    }
  }

  private drawWelcome(rows: HighlightedCell[][]): void {
    const width = rows[0]?.length ?? 0;
    const dialogWidth = Math.max(28, Math.min(46, width - 4));
    const left = Math.max(0, Math.floor((width - dialogWidth) / 2));
    const top = Math.max(1, Math.floor((rows.length - 8) / 2));
    const body = [
      "+ CS QBASIC -------------------------------+",
      "| Original QBasic-compatible DOS IDE       |",
      "|                                           |",
      "| Enter  Continue    F1  Help              |",
      "+-------------------------------------------+",
    ];
    for (const [offset, source] of body.entries()) {
      const text = [...source]
        .slice(0, dialogWidth)
        .join("")
        .padEnd(dialogWidth);
      overlay(rows, top + offset, left, text, 15, 8);
    }
  }
}

export function parseTerminalMouseEvent(value: string): TerminalMouseEvent {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new RangeError("Invalid terminal mouse event");
  }
  if (typeof decoded !== "object" || decoded === null)
    throw new RangeError("Invalid terminal mouse event");
  const event = decoded as Record<string, unknown>;
  if (
    (event.action !== "down" &&
      event.action !== "move" &&
      event.action !== "up") ||
    (event.button !== 0 && event.button !== 1 && event.button !== 2) ||
    !Number.isSafeInteger(event.sequence) ||
    (event.sequence as number) < 0 ||
    !Number.isSafeInteger(event.x) ||
    (event.x as number) < 1 ||
    (event.x as number) > 80 ||
    !Number.isSafeInteger(event.y) ||
    (event.y as number) < 1 ||
    (event.y as number) > 25
  ) {
    throw new RangeError("Invalid terminal mouse event");
  }
  return event as unknown as TerminalMouseEvent;
}

function runModeForKey(key: string): QBasicRunMode | undefined {
  if (key === "Shift+F5") return "restart";
  if (key === "F5") return "continue";
  if (key === "F7") return "run-to-cursor";
  if (key === "F8") return "step";
  if (key === "F10") return "step-over";
  return undefined;
}

function qbasicHeadingAt(
  x: number,
):
  | "debug"
  | "edit"
  | "file"
  | "help"
  | "options"
  | "run"
  | "search"
  | "view"
  | undefined {
  const headings = [
    "file",
    "edit",
    "view",
    "search",
    "run",
    "debug",
    "options",
    "help",
  ] as const;
  const bar = " File  Edit  View  Search  Run  Debug  Options  Help";
  const column = x - 1;
  return headings.find((heading) => {
    const start = bar.toLowerCase().indexOf(heading);
    return column >= start - 1 && column <= start + heading.length;
  });
}

function runStatus(mode: QBasicRunMode): string {
  if (mode === "restart") return "Running from start...";
  if (mode === "continue") return "Continuing...";
  if (mode === "run-to-cursor") return "Running to cursor...";
  if (mode === "step") return "Stepping...";
  return "Stepping over procedure...";
}

function runLabel(mode: QBasicRunMode): string {
  if (mode === "continue") return "Continue (F5)";
  if (mode === "run-to-cursor") return "Run to cursor (F7)";
  if (mode === "step") return "Step (F8)";
  if (mode === "step-over") return "Step over (F10)";
  return "Restart (Shift+F5)";
}

function row(
  value: string,
  width: number,
  foreground: number,
  background: number,
): HighlightedCell[] {
  const result = [...value].slice(0, width).map((character) => ({
    background,
    character,
    foreground,
  }));
  while (result.length < width)
    result.push({ background, character: " ", foreground });
  return result;
}

function overlay(
  rows: HighlightedCell[][],
  y: number,
  x: number,
  value: string,
  foreground: number,
  background: number,
): void {
  const target = rows[y];
  if (target === undefined) return;
  for (const [offset, character] of [...value].entries()) {
    if (x + offset < 0 || x + offset >= target.length) continue;
    target[x + offset] = { background, character, foreground };
  }
}
