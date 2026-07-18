import { ScriptEventSource } from "@minecraft/server";

import { ensureComputer, identityService } from "./computerRegistry.js";
import { requestDebugWebComputerTerminal } from "./webTerminalBridge.js";

const responseMarker = "CS_DEBUG_WEB_REQUEST ";
const requestPattern = /^(w[a-z0-9]+-[a-z0-9]+) (c-[0-9a-hjkmnp-tv-z]{6})$/u;

export function handleDebugWebSessionRequest(
  message: string,
  sourceType: ScriptEventSource,
): void {
  const match = requestPattern.exec(message);
  if (match === null) {
    emit({ status: "rejected", error: "invalid_request" });
    return;
  }

  const [, requestId, computerId] = match;
  try {
    if (sourceType !== ScriptEventSource.Server) {
      emit({
        requestId,
        computerId,
        status: "rejected",
        error: "server_source_required",
      });
      return;
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
    requestDebugWebComputerTerminal(record);
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
