import type { Player } from "@minecraft/server";

import { TerminalTargetRegistry } from "../application/terminal/targetRegistry.js";
import type { ComputerRecord } from "../domain/computer/computer.js";
import { computerHost } from "./computerHost.js";
import { showTerminalView } from "./terminalView.js";

const targets = new TerminalTargetRegistry();

export async function openComputerTerminal(
  player: Player,
  record: ComputerRecord,
): Promise<void> {
  selectComputerTerminal(player.id, record.computerId);
  if (record.lifecycle.state.kind === "off") {
    computerHost.runtime.powerOn(record.computerId);
  } else if (record.lifecycle.state.kind === "crashed") {
    if (player.isSneaking) {
      const recovered = computerHost.runtime.safeBoot(record.computerId);
      player.sendMessage(
        recovered.outcome === "accepted"
          ? "Safe boot selected. /startup.py was preserved and bypassed once."
          : `Safe boot failed: ${recovered.outcome === "failed" ? recovered.error.message : recovered.outcome}`,
      );
    } else {
      player.sendMessage(
        "Computer is crashed. Sneak while opening it to safe boot without changing /startup.py.",
      );
    }
  }
  await showTerminalView(
    player,
    record.terminal,
    {
      onLine: (line): void => {
        computerHost.runtime.queueEvent(
          record.computerId,
          "terminal_line",
          line,
        );
      },
      onTerminate: (): void => {
        computerHost.runtime.terminate(record.computerId);
      },
      onClosed: (kind, detail): void => {
        computerHost.runtime.queueEvent(
          record.computerId,
          "terminal_closed",
          kind,
          detail ?? "",
        );
      },
    },
    `${record.label ?? record.computerId} — shell`,
  );
}

export function selectComputerTerminal(
  playerId: string,
  computerId: string,
): void {
  targets.select(playerId, computerId);
}

export function disconnectComputerTerminalPlayer(
  playerId: string,
  computerId?: string,
): void {
  if (computerId !== undefined) {
    const target = targets.resolve(playerId);
    if (target.outcome === "missing" || target.computerId !== computerId)
      return;
  }
  targets.disconnect(playerId);
}
