import type { Player } from "@minecraft/server";

import { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { showTerminalView } from "../terminalView.js";

const probeTerminal = new TerminalBuffer();
probeTerminal.write("Computer System terminal ready");

export async function showTerminalProbe(player: Player): Promise<void> {
  await showTerminalView(
    player,
    probeTerminal,
    {
      onLine: (line): void => {
        probeTerminal.setCursorPosition(1, 2);
        probeTerminal.clearLine();
        probeTerminal.write(`> ${line}`);
      },
      onTerminate: (): void => undefined,
      onClosed: (kind): void => {
        if (player.isValid) player.sendMessage(`Terminal closed: ${kind}`);
      },
    },
    "Computer System Terminal",
  );
}
