import {
  Direction,
  system,
  type BlockComponentPlayerInteractEvent,
  type BlockComponentRegistry,
  type Player,
} from "@minecraft/server";

import {
  discoverMonitorSurface,
  mapMonitorTouch,
} from "../phase0/monitorSurface.js";
import { adjacentDesktopComputers } from "./computerComponent.js";
import { notifyComputerStorageUnavailable } from "./computerRegistry.js";
import { monitorTypeId } from "./probes/monitorProbe.js";
import { requestWebComputerTerminal } from "./webTerminalBridge.js";

export function registerMonitorComponent(
  registry: BlockComponentRegistry,
): void {
  registry.registerCustomComponent("computer_system:monitor", {
    onPlayerInteract: handleMonitorInteraction,
  });
}

export function placeMonitorProbe(player: Player): void {
  const origin = {
    x: Math.floor(player.location.x) - 1,
    y: Math.floor(player.location.y),
    z: Math.floor(player.location.z) + 3,
  };
  player.dimension.runCommand(
    `fill ${String(origin.x)} ${String(origin.y)} ${String(origin.z)} ${String(origin.x + 2)} ${String(origin.y + 1)} ${String(origin.z)} ${monitorTypeId}`,
  );
  player.sendMessage(
    `Placed a north-facing 3x2 Monitor at ${String(origin.x)},${String(origin.y)},${String(origin.z)}. Touch its near face.`,
  );
}

function handleMonitorInteraction(
  event: BlockComponentPlayerInteractEvent,
): void {
  if (
    event.player === undefined ||
    event.face !== Direction.North ||
    event.faceLocation === undefined
  )
    return;
  if (notifyComputerStorageUnavailable(event.player)) return;
  const { block } = event;
  const tiles = [];
  for (let y = block.y - 1; y <= block.y + 1; y += 1) {
    for (let x = block.x - 2; x <= block.x + 2; x += 1) {
      if (
        block.dimension.getBlock({ x, y, z: block.z })?.typeId === monitorTypeId
      ) {
        tiles.push({ x, y });
      }
    }
  }
  const discovery = discoverMonitorSurface(tiles);
  if (discovery.outcome !== "connected") {
    event.player.sendMessage(
      `Monitor connection failed: ${discovery.outcome}.`,
    );
    return;
  }
  const touch = mapMonitorTouch(
    discovery.surface,
    { x: block.x, y: block.y },
    event.faceLocation.x,
    event.faceLocation.y,
  );
  if (touch.outcome !== "mapped") return;
  event.player.sendMessage(
    `monitor_touch north ${String(touch.cell.x)} ${String(touch.cell.y)}`,
  );
  const computers = new Map(
    discovery.surface.tiles.flatMap((tile) => {
      const monitor = block.dimension.getBlock({
        x: tile.x,
        y: tile.y,
        z: block.z,
      });
      if (monitor === undefined) return [];
      return adjacentDesktopComputers(monitor).map((record) => [
        record.computerId,
        record,
      ]);
    }),
  );
  if (computers.size === 0) {
    event.player.sendMessage(
      "Monitor is not connected. Place it next to one Desktop Computer System.",
    );
    return;
  }
  if (computers.size !== 1) {
    event.player.sendMessage(
      "Monitor connection is ambiguous. Keep only one adjacent Desktop Computer System.",
    );
    return;
  }
  const record = computers.values().next().value;
  if (record === undefined) return;
  system.run((): void => {
    const player = event.player;
    if (player === undefined || !player.isValid) return;
    try {
      requestWebComputerTerminal(player, record, block);
    } catch (error: unknown) {
      if (player.isValid)
        player.sendMessage(
          `Monitor terminal failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  });
}
