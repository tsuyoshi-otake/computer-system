import { system, type Player } from "@minecraft/server";
import { CustomForm, ObservableString } from "@minecraft/server-ui";

import { TerminalPresentation } from "../application/terminal/presentation.js";
import {
  ManagedTerminalSession,
  type TerminalSessionEvent,
} from "../application/terminal/session.js";
import type { TerminalBuffer } from "../domain/terminal/terminalBuffer.js";

export interface TerminalViewHandlers {
  readonly onLine: (line: string) => void;
  readonly onTerminate: () => void;
  readonly onClosed: (kind: string, detail?: string) => void;
}

const activeSessions = new Map<string, symbol>();

export async function showTerminalView(
  player: Player,
  terminal: TerminalBuffer,
  handlers: TerminalViewHandlers,
  title = "Computer System",
): Promise<void> {
  const token = Symbol(player.id);
  activeSessions.set(player.id, token);
  const presentation = new TerminalPresentation(terminal);
  const cells = Array.from(
    { length: terminal.width * terminal.height },
    (_, index) =>
      terminal.cell(
        (index % terminal.width) + 1,
        Math.floor(index / terminal.width) + 1,
      ),
  );
  const display = new ObservableString(renderDisplay(cells, terminal));
  const input = new ObservableString("", { clientWritable: true });
  const session = new ManagedTerminalSession((event): void =>
    dispatch(event, handlers),
  );
  const form = new CustomForm(player, title);
  form
    .label(display)
    .textField("Input", input)
    .button("Submit", (): void => {
      if (session.submitLine(input.getData())) input.setData("");
    })
    .button("Terminate", (): void => {
      if (session.requestTermination()) handlers.onTerminate();
      form.close();
    });
  form.closeButton();

  let renderedCursor = cursorState(terminal);
  const redrawRun = system.runInterval((): void => {
    presentation.capture();
    const flush = presentation.flush(128);
    const nextCursor = cursorState(terminal);
    const cursorChanged = nextCursor !== renderedCursor;
    if (flush.changes.length === 0 && !cursorChanged) return;
    for (const change of flush.changes) {
      cells[(change.y - 1) * terminal.width + change.x - 1] = change;
    }
    renderedCursor = nextCursor;
    display.setData(renderDisplay(cells, terminal));
  }, 2);

  try {
    const reason = await form.show();
    session.finalizeClose(reason);
  } catch (error: unknown) {
    session.finalizeFailure(error, player.isValid);
  } finally {
    system.clearRun(redrawRun);
    if (activeSessions.get(player.id) === token)
      activeSessions.delete(player.id);
  }
}

function cursorState(terminal: TerminalBuffer): string {
  return `${terminal.cursorX}:${terminal.cursorY}:${terminal.cursorBlink}`;
}

function dispatch(
  event: TerminalSessionEvent,
  handlers: TerminalViewHandlers,
): void {
  if (event.type === "terminal_line") handlers.onLine(event.line);
  else handlers.onClosed(event.result.kind, event.result.detail);
}

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

function renderDisplay(
  cells: readonly {
    character: string;
    foreground: number;
    background: number;
  }[],
  terminal: TerminalBuffer,
): string {
  const rows: string[] = [];
  for (let y = 1; y <= terminal.height; y += 1) {
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
