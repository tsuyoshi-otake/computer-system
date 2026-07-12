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
const paletteSize = 16;

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
  const backgrounds = cells.map(
    (cell) => new ObservableString(cell.background.toString(16)),
  );
  const foregrounds = Array.from(
    { length: paletteSize },
    (_, color) => new ObservableString(render(cells, terminal, color)),
  );
  const input = new ObservableString("", { clientWritable: true });
  const session = new ManagedTerminalSession((event): void =>
    dispatch(event, handlers),
  );
  const form = new CustomForm(player, title)
    .textField("Input", input, {
      description: "51x19 terminal — submit one line at a time.",
    })
    .button("Submit", (): void => {
      if (session.submitLine(input.getData())) input.setData("");
    })
    .button("Terminate", (): void => {
      if (session.requestTermination()) handlers.onTerminate();
      form.close();
    });
  for (const background of backgrounds) form.label(background);
  for (const foreground of foregrounds) form.label(foreground);
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
      backgrounds[(change.y - 1) * terminal.width + change.x - 1]?.setData(
        change.background.toString(16),
      );
    }
    renderedCursor = nextCursor;
    for (let color = 0; color < paletteSize; color += 1) {
      foregrounds[color]?.setData(render(cells, terminal, color));
    }
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

function render(
  cells: readonly {
    character: string;
    foreground: number;
    background: number;
  }[],
  terminal: TerminalBuffer,
  foreground: number,
): string {
  const rows: string[] = [];
  for (let y = 1; y <= terminal.height; y += 1) {
    let row = "";
    for (let x = 1; x <= terminal.width; x += 1) {
      const cell = cells[(y - 1) * terminal.width + x - 1]!;
      const cursor =
        terminal.cursorBlink &&
        terminal.cursorX === x &&
        terminal.cursorY === y;
      row +=
        cell.foreground === foreground ? (cursor ? "_" : cell.character) : " ";
    }
    rows.push(row);
  }
  return rows.join("\n");
}
