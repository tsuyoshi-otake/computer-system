export interface TerminalCell {
  readonly character: string;
  readonly foreground: number;
  readonly background: number;
}

export interface TerminalSizeLimits {
  readonly maxWidth: number;
  readonly maxHeight: number;
}

export interface TerminalBufferSnapshot {
  readonly schema: 1;
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
  readonly foreground: readonly (readonly number[])[];
  readonly background: readonly (readonly number[])[];
  readonly cursor: {
    readonly x: number;
    readonly y: number;
    readonly blink: boolean;
  };
}

const defaultSizeLimits: TerminalSizeLimits = { maxWidth: 200, maxHeight: 100 };

export class TerminalBuffer {
  private cells: TerminalCell[];
  private widthValue: number;
  private heightValue: number;
  private cursorXValue = 1;
  private cursorYValue = 1;
  private foregroundValue = 0;
  private backgroundValue = 15;
  private cursorBlinkValue = false;
  private revisionValue = 0;
  private replacementEpochValue = 0;

  constructor(
    width = 51,
    height = 19,
    private readonly limits: TerminalSizeLimits = defaultSizeLimits,
  ) {
    requireDimension(width, limits.maxWidth, "width");
    requireDimension(height, limits.maxHeight, "height");
    this.widthValue = width;
    this.heightValue = height;
    this.cells = Array.from({ length: width * height }, () => this.blankCell());
  }

  get width(): number {
    return this.widthValue;
  }

  get height(): number {
    return this.heightValue;
  }

  get cursorX(): number {
    return this.cursorXValue;
  }

  get cursorY(): number {
    return this.cursorYValue;
  }

  get foreground(): number {
    return this.foregroundValue;
  }

  get background(): number {
    return this.backgroundValue;
  }

  get cursorBlink(): boolean {
    return this.cursorBlinkValue;
  }

  get revision(): number {
    return this.revisionValue;
  }

  /**
   * Monotonic transient marker for operations that replace visible terminal
   * content rather than incrementally writing it. It is intentionally absent
   * from persisted snapshots.
   */
  get replacementEpoch(): number {
    return this.replacementEpochValue;
  }

  resize(width: number, height: number): void {
    requireDimension(width, this.limits.maxWidth, "width");
    requireDimension(height, this.limits.maxHeight, "height");
    if (width === this.width && height === this.height) return;
    const previous = this.cells;
    const previousWidth = this.width;
    const previousHeight = this.height;
    this.widthValue = width;
    this.heightValue = height;
    this.cells = Array.from({ length: width * height }, () => this.blankCell());
    for (let y = 1; y <= Math.min(previousHeight, height); y += 1) {
      for (let x = 1; x <= Math.min(previousWidth, width); x += 1) {
        this.cells[this.index(x, y)] =
          previous[(y - 1) * previousWidth + x - 1]!;
      }
    }
    this.cursorXValue = Math.min(this.cursorXValue, width + 1);
    this.cursorYValue = Math.min(this.cursorYValue, height);
    this.revisionValue += 1;
    this.replacementEpochValue += 1;
  }

  setCursorPosition(x: number, y: number): void {
    requireCoordinate(x, this.width, "x");
    requireCoordinate(y, this.height, "y");
    if (this.cursorXValue === x && this.cursorYValue === y) return;
    this.cursorXValue = x;
    this.cursorYValue = y;
    this.revisionValue += 1;
  }

  setCursorBlink(blink: boolean): void {
    if (this.cursorBlinkValue === blink) return;
    this.cursorBlinkValue = blink;
    this.revisionValue += 1;
  }

  setTextColor(color: number): void {
    const next = requireColor(color);
    if (this.foregroundValue === next) return;
    this.foregroundValue = next;
    this.revisionValue += 1;
  }

  setBackgroundColor(color: number): void {
    const next = requireColor(color);
    if (this.backgroundValue === next) return;
    this.backgroundValue = next;
    this.revisionValue += 1;
  }

  write(text: string): void {
    if (text.length === 0) return;
    if (text.includes("\n") || text.includes("\r")) {
      throw new TerminalError("term.write does not accept line breaks");
    }
    for (const character of [...text]) {
      if (this.cursorXValue <= this.width) {
        this.cells[this.index(this.cursorXValue, this.cursorYValue)] = {
          character,
          foreground: this.foregroundValue,
          background: this.backgroundValue,
        };
      }
      this.cursorXValue += 1;
    }
    this.revisionValue += 1;
  }

  clear(): void {
    this.cells = Array.from({ length: this.width * this.height }, () =>
      this.blankCell(),
    );
    this.revisionValue += 1;
    this.replacementEpochValue += 1;
  }

  clearLine(): void {
    for (let x = 1; x <= this.width; x += 1) {
      this.cells[this.index(x, this.cursorYValue)] = this.blankCell();
    }
    this.revisionValue += 1;
    this.replacementEpochValue += 1;
  }

  scroll(lines: number): void {
    if (!Number.isInteger(lines))
      throw new TerminalError("Scroll distance must be an integer");
    if (lines === 0) return;
    const next = Array.from({ length: this.width * this.height }, () =>
      this.blankCell(),
    );
    for (let y = 1; y <= this.height; y += 1) {
      const sourceY = y + lines;
      if (sourceY < 1 || sourceY > this.height) continue;
      for (let x = 1; x <= this.width; x += 1) {
        next[this.index(x, y)] = this.cells[this.index(x, sourceY)]!;
      }
    }
    this.cells = next;
    this.revisionValue += 1;
    this.replacementEpochValue += 1;
  }

  cell(x: number, y: number): TerminalCell {
    requireCoordinate(x, this.width, "x");
    requireCoordinate(y, this.height, "y");
    return this.cells[this.index(x, y)]!;
  }

  line(y: number): string {
    requireCoordinate(y, this.height, "y");
    let value = "";
    for (let x = 1; x <= this.width; x += 1) value += this.cell(x, y).character;
    return value;
  }

  applyFrame(
    rows: readonly (readonly TerminalCell[])[],
    cursor: { readonly blink: boolean; readonly x: number; readonly y: number },
    foreground = 0,
    background = 15,
  ): number {
    if (rows.length > this.height) {
      throw new TerminalError("Terminal frame has too many rows");
    }
    const nextForeground = requireColor(foreground);
    const nextBackground = requireColor(background);
    requireCoordinate(cursor.x, this.width, "x");
    requireCoordinate(cursor.y, this.height, "y");
    if (typeof cursor.blink !== "boolean") {
      throw new TerminalError("Terminal cursor blink must be boolean");
    }

    const pending: { readonly cell: TerminalCell; readonly index: number }[] =
      [];
    for (let y = 0; y < this.height; y += 1) {
      const sourceRow = rows[y];
      if (sourceRow !== undefined && sourceRow.length > this.width) {
        throw new TerminalError(
          `Terminal frame row ${String(y + 1)} is too wide`,
        );
      }
      for (let x = 0; x < this.width; x += 1) {
        const source = sourceRow?.[x];
        const character = source?.character ?? " ";
        if (
          typeof character !== "string" ||
          character.length === 0 ||
          character.length > 2 ||
          [...character].length !== 1 ||
          character.includes("\r") ||
          character.includes("\n")
        ) {
          throw new TerminalError("Terminal frame cell must be one character");
        }
        const cell: TerminalCell = {
          character,
          foreground:
            source === undefined
              ? nextForeground
              : requireColor(source.foreground),
          background:
            source === undefined
              ? nextBackground
              : requireColor(source.background),
        };
        const index = y * this.width + x;
        const previous = this.cells[index]!;
        if (
          previous.character !== cell.character ||
          previous.foreground !== cell.foreground ||
          previous.background !== cell.background
        ) {
          pending.push({ cell, index });
        }
      }
    }

    const stateChanged =
      pending.length > 0 ||
      this.cursorXValue !== cursor.x ||
      this.cursorYValue !== cursor.y ||
      this.cursorBlinkValue !== cursor.blink ||
      this.foregroundValue !== nextForeground ||
      this.backgroundValue !== nextBackground;
    if (!stateChanged) return 0;
    this.replacementEpochValue += 1;
    for (const { cell, index } of pending) this.cells[index] = cell;
    this.cursorXValue = cursor.x;
    this.cursorYValue = cursor.y;
    this.cursorBlinkValue = cursor.blink;
    this.foregroundValue = nextForeground;
    this.backgroundValue = nextBackground;
    this.revisionValue += 1;
    return pending.length;
  }

  snapshot(): TerminalBufferSnapshot {
    return {
      schema: 1,
      width: this.width,
      height: this.height,
      rows: Array.from({ length: this.height }, (_, index) =>
        this.line(index + 1),
      ),
      foreground: Array.from({ length: this.height }, (_, y) =>
        Array.from(
          { length: this.width },
          (_value, x) => this.cell(x + 1, y + 1).foreground,
        ),
      ),
      background: Array.from({ length: this.height }, (_, y) =>
        Array.from(
          { length: this.width },
          (_value, x) => this.cell(x + 1, y + 1).background,
        ),
      ),
      cursor: {
        x: this.cursorXValue,
        y: this.cursorYValue,
        blink: this.cursorBlinkValue,
      },
    };
  }

  restore(snapshot: TerminalBufferSnapshot): void {
    if (
      snapshot.schema !== 1 ||
      snapshot.width !== this.width ||
      snapshot.height !== this.height
    ) {
      throw new TerminalError("Terminal snapshot dimensions do not match");
    }
    const cells: TerminalCell[] = [];
    for (let y = 0; y < this.height; y += 1) {
      const characters = [...(snapshot.rows[y] ?? "")];
      const foreground = snapshot.foreground[y];
      const background = snapshot.background[y];
      if (
        characters.length !== this.width ||
        foreground?.length !== this.width ||
        background?.length !== this.width
      ) {
        throw new TerminalError(`Terminal snapshot row ${y + 1} is invalid`);
      }
      for (let x = 0; x < this.width; x += 1) {
        cells.push({
          character: characters[x]!,
          foreground: requireColor(foreground[x]!),
          background: requireColor(background[x]!),
        });
      }
    }
    requireWriteCursorX(snapshot.cursor.x);
    requireCoordinate(snapshot.cursor.y, this.height, "y");
    if (typeof snapshot.cursor.blink !== "boolean") {
      throw new TerminalError("Terminal cursor blink must be boolean");
    }
    this.cells = cells;
    this.cursorXValue = snapshot.cursor.x;
    this.cursorYValue = snapshot.cursor.y;
    this.cursorBlinkValue = snapshot.cursor.blink;
    this.revisionValue += 1;
    this.replacementEpochValue += 1;
  }

  private blankCell(): TerminalCell {
    return {
      character: " ",
      foreground: this.foregroundValue,
      background: this.backgroundValue,
    };
  }

  private index(x: number, y: number): number {
    return (y - 1) * this.width + x - 1;
  }
}

export class TerminalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TerminalError";
  }
}

function requireDimension(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new TerminalError(`${name} must be between 1 and ${maximum}`);
  }
}

function requireCoordinate(value: number, maximum: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new TerminalError(`${name} must be between 1 and ${maximum}`);
  }
}

function requireWriteCursorX(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TerminalError("x must be a positive safe integer");
  }
}

function requireColor(color: number): number {
  if (!Number.isInteger(color) || color < 0 || color > 15) {
    throw new TerminalError("Color must be an integer from 0 through 15");
  }
  return color;
}
