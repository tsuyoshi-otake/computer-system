import { system, world, type Dimension, type Vector3 } from "@minecraft/server";

export const probeArenaY = 200;

export function getProbeDimension(): Dimension {
  return world.getDimension("minecraft:overworld");
}

export function offset(location: Vector3, delta: Readonly<Vector3>): Vector3 {
  return {
    x: location.x + delta.x,
    y: location.y + delta.y,
    z: location.z + delta.z,
  };
}

export function waitTicks(ticks: number): Promise<void> {
  return new Promise((resolve): void => {
    system.runTimeout(resolve, ticks);
  });
}

export async function prepareProbeArena(dimension: Dimension): Promise<void> {
  try {
    dimension.runCommand("tickingarea remove computer_system_probe");
  } catch {
    // A missing ticking area is the expected first-run state.
  }

  dimension.runCommand(
    `tickingarea add circle 0 ${probeArenaY} 0 2 computer_system_probe`,
  );
  let loaded = false;
  const requiredLocations = [
    { x: -8, y: probeArenaY, z: -8 },
    { x: -8, y: probeArenaY, z: 8 },
    { x: 0, y: probeArenaY, z: 0 },
    { x: 8, y: probeArenaY, z: -8 },
    { x: 12, y: probeArenaY, z: 0 },
  ];
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await waitTicks(1);
    try {
      loaded = requiredLocations.every(
        (location) => dimension.getBlock(location) !== undefined,
      );
    } catch {
      loaded = false;
    }
    if (loaded) {
      break;
    }
  }
  requireCondition(loaded, "Probe ticking area did not load within 40 ticks.");
  dimension.runCommand(
    `fill -8 ${probeArenaY - 4} -8 8 ${probeArenaY + 5} 8 air`,
  );
}

export function releaseProbeArena(dimension: Dimension): void {
  try {
    dimension.runCommand("tickingarea remove computer_system_probe");
  } catch {
    // The suite is already terminal even if BDS removed the area first.
  }
}

export function requireCondition(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}
