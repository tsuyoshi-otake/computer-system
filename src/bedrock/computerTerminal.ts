import type { Player } from "@minecraft/server";

import { TerminalTargetRegistry } from "../application/terminal/targetRegistry.js";
import type { ComputerRecord } from "../domain/computer/computer.js";
import { computerHost } from "./computerHost.js";
import { ensureComputer, identityService } from "./computerRegistry.js";
import { showTerminalView } from "./terminalView.js";

const targets = new TerminalTargetRegistry();

export async function openComputerTerminal(
  player: Player,
  record: ComputerRecord,
): Promise<void> {
  targets.select(player.id, record.computerId);
  if (record.lifecycle.state.kind === "off") {
    computerHost.runtime.powerOn(record.computerId);
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

export async function openSelectedComputerTerminal(
  player: Player,
): Promise<boolean> {
  const target = targets.resolve(player.id);
  if (target.outcome === "missing") {
    player.sendMessage(
      "Monitor has no terminal target. Open a Computer or Pocket Computer first.",
    );
    return false;
  }
  const observation = identityService().observation(target.computerId);
  if (observation === undefined) {
    targets.disconnect(player.id);
    player.sendMessage("The selected computer is no longer available.");
    return false;
  }
  await openComputerTerminal(
    player,
    ensureComputer(observation.computerId, observation.family),
  );
  return true;
}

export function disconnectComputerTerminalPlayer(playerId: string): void {
  targets.disconnect(playerId);
}
