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
  private cursorXValue = 1;
  private cursorYValue = 1;
  private foregroundValue = 0;
  private backgroundValue = 15;
  private cursorBlinkValue = false;

  constructor(
    readonly width = 51,
    readonly height = 19,
    limits: TerminalSizeLimits = defaultSizeLimits,
  ) {
    requireDimension(width, limits.maxWidth, "width");
    requireDimension(height, limits.maxHeight, "height");
    this.cells = Array.from({ length: width * height }, () => this.blankCell());
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

  setCursorPosition(x: number, y: number): void {
    requireCoordinate(x, this.width, "x");
    requireCoordinate(y, this.height, "y");
    this.cursorXValue = x;
    this.cursorYValue = y;
  }

  setCursorBlink(blink: boolean): void {
    this.cursorBlinkValue = blink;
  }

  setTextColor(color: number): void {
    this.foregroundValue = requireColor(color);
  }

  setBackgroundColor(color: number): void {
    this.backgroundValue = requireColor(color);
  }

  write(text: string): void {
    for (const character of [...text]) {
      if (character === "\n" || character === "\r") {
        throw new TerminalError("term.write does not accept line breaks");
      }
      if (this.cursorXValue <= this.width) {
        this.cells[this.index(this.cursorXValue, this.cursorYValue)] = {
          character,
          foreground: this.foregroundValue,
          background: this.backgroundValue,
        };
      }
      this.cursorXValue += 1;
    }
  }

  clear(): void {
    this.cells = Array.from({ length: this.width * this.height }, () =>
      this.blankCell(),
    );
  }

  clearLine(): void {
    for (let x = 1; x <= this.width; x += 1) {
      this.cells[this.index(x, this.cursorYValue)] = this.blankCell();
    }
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
    this.cells = cells;
    this.cursorXValue = snapshot.cursor.x;
    this.cursorYValue = snapshot.cursor.y;
    this.cursorBlinkValue = snapshot.cursor.blink;
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
