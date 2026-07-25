import type { Player } from "@minecraft/server";

import { safeBootBypassesStartupProgram } from "../application/computer/csBios.js";
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
    // Safe boot bypasses `/startup.py` only on a MicroPython-capable CS-Linux
    // machine. A Portable CS386SX only skips bootable floppy media, so the chat
    // line must not promise a bypass that machine cannot perform.
    const bypassesStartup = safeBootBypassesStartupProgram(record);
    if (player.isSneaking) {
      const recovered = computerHost.runtime.safeBoot(record.computerId);
      player.sendMessage(
        recovered.outcome === "accepted"
          ? bypassesStartup
            ? "Safe boot selected. /startup.py was preserved and bypassed once."
            : "Safe boot selected. Bootable floppy media was skipped once."
          : `Safe boot failed: ${recovered.outcome === "failed" ? recovered.error.message : recovered.outcome}`,
      );
    } else {
      player.sendMessage(
        bypassesStartup
          ? "Computer is crashed. Read the halt screen, then sneak while opening it to safe boot without changing /startup.py."
          : "Computer is crashed. Read the halt screen, then sneak while opening it to safe boot without bootable floppy media.",
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
