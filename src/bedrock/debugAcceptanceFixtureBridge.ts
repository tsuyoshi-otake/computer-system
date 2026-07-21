import { ScriptEventSource, world } from "@minecraft/server";

import { acceptanceFixtureBuild } from "./acceptanceFixture.js";
import { ensureComputer, identityService } from "./computerRegistry.js";

const responseMarker = "CS_DEBUG_ACCEPTANCE_FIXTURE ";
const requestPattern = /^(a[a-z0-9]+-[a-z0-9]+)$/u;
const fixturePhysicalKey = "acceptance-fixture:linux";

export function handleDebugAcceptanceFixtureRequest(
  message: string,
  sourceType: ScriptEventSource,
): void {
  const match = requestPattern.exec(message);
  if (match === null) {
    emit({ status: "rejected", error: "invalid_request" });
    return;
  }
  const requestId = match[1]!;
  try {
    if (!acceptanceFixtureBuild) {
      emit({ requestId, status: "rejected", error: "fixture_disabled" });
      return;
    }
    if (sourceType !== ScriptEventSource.Server) {
      emit({ requestId, status: "rejected", error: "server_source_required" });
      return;
    }
    if (world.getAllPlayers().length !== 0) {
      emit({ requestId, status: "rejected", error: "players_connected" });
      return;
    }

    const identities = identityService();
    const existing = identities.atPhysicalKey(fixturePhysicalKey);
    const placed =
      existing === undefined
        ? identities.place(fixturePhysicalKey, "advanced")
        : { outcome: "placed" as const, ...existing, generation: 0 };
    if (placed.outcome !== "placed") {
      emit({ requestId, status: "rejected", error: "fixture_conflict" });
      return;
    }
    try {
      ensureComputer(placed.computerId, placed.family);
    } catch (error: unknown) {
      if (existing === undefined) {
        identities.rollbackPlacement(
          fixturePhysicalKey,
          placed.computerId,
          false,
        );
      }
      throw error;
    }
    emit({ requestId, status: "completed", computerId: placed.computerId });
  } catch (error: unknown) {
    emit({
      requestId,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function emit(payload: Readonly<Record<string, unknown>>): void {
  console.warn(`${responseMarker}${JSON.stringify(payload)}`);
}
