import type {
  TerminalBuffer,
  TerminalCell,
} from "../../domain/terminal/terminalBuffer.js";

export const computerCraftPalette = [
  "#F0F0F0",
  "#F2B233",
  "#E57FD8",
  "#99B2F2",
  "#DEDE6C",
  "#7FCC19",
  "#F2B2CC",
  "#4C4C4C",
  "#999999",
  "#4C99B2",
  "#B266E5",
  "#3366CC",
  "#7F664C",
  "#57A64E",
  "#CC4C4C",
  "#111111",
] as const;

export const productionTerminalContract = {
  width: 51,
  height: 19,
  primaryControls: ["input", "submit", "terminate", "close"] as const,
  primaryControlsScroll: false,
  palette: computerCraftPalette,
} as const;

export interface TerminalCellChange extends TerminalCell {
  readonly x: number;
  readonly y: number;
}

export interface TerminalFlush {
  readonly changes: readonly TerminalCellChange[];
  readonly remaining: number;
}

export interface TerminalFrame {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
  readonly cursor: {
    readonly x: number;
    readonly y: number;
    readonly blink: boolean;
  };
}

export class TerminalPresentation {
  private readonly previous = new Map<number, TerminalCell>();
  private readonly pending = new Map<number, TerminalCellChange>();

  constructor(
    private readonly terminal: TerminalBuffer,
    readonly pendingCapacity = terminal.width * terminal.height,
  ) {
    if (!Number.isInteger(pendingCapacity) || pendingCapacity <= 0) {
      throw new RangeError("Terminal pending capacity must be positive");
    }
  }

  capture(): number {
    let changed = 0;
    for (let y = 1; y <= this.terminal.height; y += 1) {
      for (let x = 1; x <= this.terminal.width; x += 1) {
        const index = (y - 1) * this.terminal.width + x - 1;
        const cell = this.terminal.cell(x, y);
        if (sameCell(this.previous.get(index), cell)) continue;
        this.previous.set(index, cell);
        this.pending.set(index, { x, y, ...cell });
        changed += 1;
        if (this.pending.size > this.pendingCapacity) {
          throw new Error("Terminal redraw queue capacity exceeded");
        }
      }
    }
    return changed;
  }

  flush(limit: number): TerminalFlush {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("Terminal flush limit must be positive");
    }
    const entries = [...this.pending.entries()]
      .sort(([left], [right]) => left - right)
      .slice(0, limit);
    for (const [index] of entries) this.pending.delete(index);
    return {
      changes: entries.map(([, change]) => change),
      remaining: this.pending.size,
    };
  }

  frame(): TerminalFrame {
    return {
      width: this.terminal.width,
      height: this.terminal.height,
      rows: Array.from({ length: this.terminal.height }, (_, index) =>
        this.terminal.line(index + 1),
      ),
      cursor: {
        x: this.terminal.cursorX,
        y: this.terminal.cursorY,
        blink: this.terminal.cursorBlink,
      },
    };
  }
}

function sameCell(
  left: TerminalCell | undefined,
  right: TerminalCell,
): boolean {
  return (
    left !== undefined &&
    left.character === right.character &&
    left.foreground === right.foreground &&
    left.background === right.background
  );
}
