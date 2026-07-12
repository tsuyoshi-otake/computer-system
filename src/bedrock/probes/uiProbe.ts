import type { Player } from "@minecraft/server";

import { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { showTerminalView } from "../terminalView.js";

const probeTerminal = new TerminalBuffer();
probeTerminal.write("Computer System terminal ready");
for (let color = 0; color < 16; color += 1) {
  probeTerminal.setCursorPosition(color + 1, 3);
  probeTerminal.setTextColor(15 - color);
  probeTerminal.setBackgroundColor(color);
  probeTerminal.write(color.toString(16));
}
probeTerminal.setCursorPosition(18, 3);
probeTerminal.setCursorBlink(true);

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
