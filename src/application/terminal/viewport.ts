import type {
  TerminalBuffer,
  TerminalCell,
} from "../../domain/terminal/terminalBuffer.js";

export const terminalViewportRows = 7;
export const bedrockCoreTextPayloadBytes = 77;

const formattingCodes = [
  "f",
  "6",
  "5",
  "b",
  "e",
  "a",
  "d",
  "8",
  "7",
  "3",
  "9",
  "1",
  "4",
  "2",
  "c",
  "0",
] as const;

export function renderTerminalViewport(
  cells: readonly TerminalCell[],
  terminal: TerminalBuffer,
): string {
  const rows: string[] = [];
  const visibleRows = Math.min(terminalViewportRows, terminal.height);
  const lastRow = Math.max(visibleRows, terminal.cursorY);
  const firstRow = lastRow - visibleRows + 1;

  for (let y = firstRow; y <= lastRow; y += 1) {
    let row = "";
    let renderedColor = -1;
    for (let x = 1; x <= terminal.width; x += 1) {
      const cell = cells[(y - 1) * terminal.width + x - 1]!;
      const cursor =
        terminal.cursorBlink &&
        terminal.cursorX === x &&
        terminal.cursorY === y;
      const showBackground = cell.character === " " && cell.background !== 15;
      const color = showBackground ? cell.background : cell.foreground;
      if (color !== renderedColor) {
        row += `§${formattingCodes[color] ?? "f"}`;
        renderedColor = color;
      }
      row += cursor ? "_" : showBackground ? "█" : cell.character;
    }
    rows.push(`${row}§r`);
  }
  return rows.join("\n");
}

export function renderPlainTerminalRows(
  terminal: TerminalBuffer,
): readonly string[] {
  return Array.from({ length: terminal.height }, (_, rowIndex) => {
    const y = rowIndex + 1;
    let row = "";
    for (let x = 1; x <= terminal.width; x += 1) {
      const cursor =
        terminal.cursorBlink &&
        terminal.cursorX === x &&
        terminal.cursorY === y;
      row += cursor ? "_" : terminal.cell(x, y).character;
    }
    return truncateUtf8(row, bedrockCoreTextPayloadBytes);
  });
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    const width =
      codePoint <= 0x7f
        ? 1
        : codePoint <= 0x7ff
          ? 2
          : codePoint <= 0xffff
            ? 3
            : 4;
    if (bytes + width > maximumBytes) break;
    bytes += width;
    result += character;
  }
  return result;
}
