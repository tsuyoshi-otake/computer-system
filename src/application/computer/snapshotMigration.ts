import type { ComputerSnapshot } from "../../domain/computer/computer.js";
import type { TerminalBufferSnapshot } from "../../domain/terminal/terminalBuffer.js";

const legacyShellPrompt = /^user@computer-[1-9][0-9]*:~\$/u;
const legacyShellForeground = 5;
const defaultShellForeground = 0;

export function migrateComputerSnapshot(
  snapshot: ComputerSnapshot,
): ComputerSnapshot {
  const terminal = migrateLegacyShellTerminal(snapshot.terminal);
  return terminal === snapshot.terminal ? snapshot : { ...snapshot, terminal };
}

function migrateLegacyShellTerminal(
  snapshot: TerminalBufferSnapshot,
): TerminalBufferSnapshot {
  let changed = false;
  let cursorX = snapshot.cursor.x;
  const rows = snapshot.rows.map((row, rowIndex) => {
    const match = legacyShellPrompt.exec(row);
    if (match === null) return row;

    changed = true;
    const replacement = `~$${row.slice(match[0].length)}`
      .slice(0, snapshot.width)
      .padEnd(snapshot.width, " ");
    if (snapshot.cursor.y === rowIndex + 1 && cursorX > match[0].length) {
      cursorX -= match[0].length - 2;
    }
    return replacement;
  });
  const foreground = snapshot.foreground.map((row) =>
    row.map((color) => {
      if (color !== legacyShellForeground) return color;
      changed = true;
      return defaultShellForeground;
    }),
  );

  if (!changed) return snapshot;
  return {
    ...snapshot,
    rows,
    foreground,
    cursor: { ...snapshot.cursor, x: cursorX },
  };
}
