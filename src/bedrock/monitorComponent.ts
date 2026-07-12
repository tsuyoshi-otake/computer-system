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
import { monitorTypeId } from "./probes/monitorProbe.js";
import { showTerminalProbe } from "./probes/uiProbe.js";

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
  system.run((): void => {
    if (event.player !== undefined) void showTerminalProbe(event.player);
  });
}
