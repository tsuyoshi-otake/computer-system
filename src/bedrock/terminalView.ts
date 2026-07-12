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
const foregroundCodes = [
  "f",
  "6",
  "d",
  "b",
  "e",
  "a",
  "c",
  "8",
  "7",
  "3",
  "5",
  "9",
  "4",
  "2",
  "c",
  "0",
] as const;

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
    () => ({
      character: " ",
      foreground: 0,
      background: 15,
    }),
  );
  const output = new ObservableString(render(cells, terminal));
  const input = new ObservableString("", { clientWritable: true });
  const session = new ManagedTerminalSession((event): void =>
    dispatch(event, handlers),
  );
  const form = new CustomForm(player, title)
    .label(output)
    .textField("Input", input, {
      description: "51x19 terminal — submit one line at a time.",
    })
    .button("Submit", (): void => {
      if (session.submitLine(input.getData())) input.setData("");
    })
    .button("Terminate", (): void => {
      if (session.requestTermination()) handlers.onTerminate();
      form.close();
    })
    .closeButton();

  const redrawRun = system.runInterval((): void => {
    presentation.capture();
    const flush = presentation.flush(128);
    if (flush.changes.length === 0) return;
    for (const change of flush.changes) {
      cells[(change.y - 1) * terminal.width + change.x - 1] = change;
    }
    output.setData(render(cells, terminal));
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
): string {
  const rows: string[] = [];
  for (let y = 1; y <= terminal.height; y += 1) {
    let row = "";
    let previous = -1;
    for (let x = 1; x <= terminal.width; x += 1) {
      const cell = cells[(y - 1) * terminal.width + x - 1]!;
      if (cell.foreground !== previous) {
        row += `§${foregroundCodes[cell.foreground]}`;
        previous = cell.foreground;
      }
      const cursor =
        terminal.cursorBlink &&
        terminal.cursorX === x &&
        terminal.cursorY === y;
      row += cursor ? "_" : cell.character;
    }
    rows.push(`${row}§r`);
  }
  return rows.join("\n");
}
