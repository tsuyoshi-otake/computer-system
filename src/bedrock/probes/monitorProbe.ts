import { type Dimension } from "@minecraft/server";

import {
  BoundedMonitorUpdates,
  discoverMonitorSurface,
} from "../../phase0/monitorSurface.js";
import { probeArenaY, requireCondition } from "./worldProbeSupport.js";

export const monitorTypeId = "computer_system:monitor";

export interface MonitorProbeResult {
  readonly cellsHigh: number;
  readonly cellsWide: number;
  readonly coalescedUpdate: boolean;
  readonly flushBudgetRespected: boolean;
  readonly tilesDiscovered: number;
}

export function executeMonitorProbe(dimension: Dimension): MonitorProbeResult {
  const tiles = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const location = { x: column - 3, y: probeArenaY + row, z: 5 };
      const block = dimension.getBlock(location);
      requireCondition(
        block !== undefined,
        "Monitor probe chunk is not loaded.",
      );
      block.setType(monitorTypeId);
      requireCondition(
        block.typeId === monitorTypeId,
        "Monitor block failed to place.",
      );
      tiles.push({ x: location.x, y: location.y });
    }
  }

  const discovery = discoverMonitorSurface(tiles);
  requireCondition(
    discovery.outcome === "connected",
    "3x2 monitor was not connected.",
  );
  requireCondition(
    discovery.surface.width === 3 && discovery.surface.height === 2,
    "Monitor dimensions were incorrect.",
  );

  const updates = new BoundedMonitorUpdates(64);
  for (let index = 0; index < 64; index += 1) {
    requireCondition(
      updates.write({ x: index + 1, y: 1, character: "x" }) === "queued",
      "Monitor update queue rejected an in-budget update.",
    );
  }
  const coalescedUpdate =
    updates.write({ x: 1, y: 1, character: "y" }) === "coalesced";
  const flush = updates.flush(16);
  const flushBudgetRespected =
    flush.updates.length === 16 && flush.remaining === 48;
  requireCondition(coalescedUpdate, "Monitor update was not coalesced.");
  requireCondition(flushBudgetRespected, "Monitor flush exceeded its budget.");

  return {
    cellsHigh: 18,
    cellsWide: 51,
    coalescedUpdate,
    flushBudgetRespected,
    tilesDiscovered: tiles.length,
  };
}
