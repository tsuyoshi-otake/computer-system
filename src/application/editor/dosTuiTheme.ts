import type { HighlightedCell } from "./syntaxHighlight.js";

export const dosTuiColor = {
  black: 15,
  chrome: 8,
  document: 11,
  status: 9,
  white: 0,
} as const;

export const dosTuiSingleLineBox = {
  bottomLeft: "\u2514",
  bottomRight: "\u2518",
  horizontal: "\u2500",
  leftTee: "\u251c",
  rightTee: "\u2524",
  topLeft: "\u250c",
  topRight: "\u2510",
  vertical: "\u2502",
} as const;

export function drawDosTuiShadow(
  rows: HighlightedCell[][],
  top: number,
  left: number,
  width: number,
  bottom: number,
): void {
  for (let row = top + 1; row <= bottom + 1; row += 1) {
    overlayDosTuiCells(
      rows,
      row,
      left + width,
      " ",
      dosTuiColor.black,
      dosTuiColor.black,
    );
  }
  overlayDosTuiCells(
    rows,
    bottom + 1,
    left + 2,
    " ".repeat(width),
    dosTuiColor.black,
    dosTuiColor.black,
  );
}

export function overlayDosTuiCells(
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
    const column = x + offset;
    if (column < 0 || column >= target.length) continue;
    target[column] = { background, character, foreground };
  }
}
