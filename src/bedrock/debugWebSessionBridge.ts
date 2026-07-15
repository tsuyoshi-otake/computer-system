import { world } from "@minecraft/server";

import { ensureComputer, identityService } from "./computerRegistry.js";
import { requestWebComputerTerminal } from "./webTerminalBridge.js";

const responseMarker = "CS_DEBUG_WEB_REQUEST ";
const requestPattern = /^(w[a-z0-9]+-[a-z0-9]+) (c-[0-9a-hjkmnp-tv-z]{6})$/u;

export function handleDebugWebSessionRequest(message: string): void {
  const match = requestPattern.exec(message);
  if (match === null) {
    emit({ status: "rejected", error: "invalid_request" });
    return;
  }

  const [, requestId, computerId] = match;
  try {
    const players = world.getAllPlayers().filter((player) => player.isValid);
    if (players.length !== 1) {
      emit({
        requestId,
        computerId,
        status: "failed",
        error:
          players.length === 0
            ? "Exactly one connected player is required; none are connected."
            : "Exactly one connected player is required; multiple players are connected.",
      });
      return;
    }
    const player = players[0];
    if (player === undefined) {
      throw new Error("The connected debug player became unavailable.");
    }

    const observation = identityService().observation(computerId ?? "");
    if (observation === undefined) {
      emit({
        requestId,
        computerId,
        status: "missing",
        error: "Computer identity is unavailable.",
      });
      return;
    }

    const record = ensureComputer(observation.computerId, observation.family);
    requestWebComputerTerminal(player, record);
    emit({
      requestId,
      computerId: record.computerId,
      status: "requested",
    });
  } catch (error: unknown) {
    emit({
      requestId,
      computerId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function emit(payload: Readonly<Record<string, unknown>>): void {
  console.warn(`${responseMarker}${JSON.stringify(payload)}`);
}
