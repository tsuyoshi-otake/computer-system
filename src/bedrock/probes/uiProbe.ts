import { system, type Player } from "@minecraft/server";

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

export function startTerminalCompetitionProbe(player: Player): void {
  const runId = `compete-${system.currentTick}`;
  const counts = { holder: 0, challenger: 0 };
  const report = (
    role: keyof typeof counts,
    kind: string,
    detail?: string,
  ): void => {
    counts[role] += 1;
    const record = `CS_TERMINAL_COMPETE ${JSON.stringify({
      runId,
      role,
      kind,
      count: counts[role],
      ...(detail === undefined ? {} : { detail }),
    })}`;
    console.warn(record);
    if (player.isValid) player.sendMessage(record);
  };

  void showTerminalView(
    player,
    competitionTerminal("holder"),
    {
      onLine: (): void => undefined,
      onTerminate: (): void => undefined,
      onClosed: (kind, detail): void => report("holder", kind, detail),
    },
    "Competition Holder",
  );
  system.runTimeout((): void => {
    void showTerminalView(
      player,
      competitionTerminal("challenger"),
      {
        onLine: (): void => undefined,
        onTerminate: (): void => undefined,
        onClosed: (kind, detail): void => report("challenger", kind, detail),
      },
      "Competition Challenger",
    );
  }, 10);
}

function competitionTerminal(role: string): TerminalBuffer {
  const terminal = new TerminalBuffer();
  terminal.write(`Competition ${role}`);
  terminal.setCursorPosition(1, 2);
  terminal.write("Keep this form open for the competing-form probe.");
  return terminal;
}
