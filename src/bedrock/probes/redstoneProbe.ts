import {
  BlockPermutation,
  type Block,
  type Dimension,
  type Vector3,
} from "@minecraft/server";

import {
  readRedstoneProbeEvents,
  resetRedstoneProbeEvents,
} from "./redstoneProbeComponent.js";
import {
  offset,
  probeArenaY,
  requireCondition,
  waitTicks,
} from "./worldProbeSupport.js";

const directions = [
  { face: "down", delta: { x: 0, y: -1, z: 0 } },
  { face: "east", delta: { x: 1, y: 0, z: 0 } },
  { face: "north", delta: { x: 0, y: 0, z: -1 } },
  { face: "south", delta: { x: 0, y: 0, z: 1 } },
  { face: "up", delta: { x: 0, y: 1, z: 0 } },
  { face: "west", delta: { x: -1, y: 0, z: 0 } },
] as const;

export interface RedstoneProbeResult {
  readonly consumerEvents: number;
  readonly digitalMasksVerified: number;
  readonly inputFacesVerified: number;
}

export async function executeRedstoneProbe(
  dimension: Dimension,
): Promise<RedstoneProbeResult> {
  const center = { x: 0, y: probeArenaY, z: 0 };
  setProbeMask(dimension, center, 0);
  let consumerEvents = 0;

  for (const { delta, face } of directions) {
    clearNeighbors(dimension, center);
    await waitTicks(1);
    resetRedstoneProbeEvents();
    getBlock(dimension, offset(center, delta)).setType(
      "minecraft:redstone_block",
    );
    await waitTicks(2);

    const power = getBlock(dimension, offset(center, delta)).getRedstonePower();
    requireCondition(power === 15, `${face} input did not report power 15.`);
    const eventObserved = readRedstoneProbeEvents().some(
      ({ location, powerLevel }) =>
        sameLocation(location, center) && powerLevel === 15,
    );
    if (eventObserved) {
      consumerEvents += 1;
    }
  }

  clearNeighbors(dimension, center);
  let digitalMasksVerified = 0;
  for (let mask = 0; mask < 64; mask += 1) {
    for (const { delta } of directions) {
      getBlock(dimension, offset(center, delta)).setType(
        "minecraft:redstone_lamp",
      );
    }
    setProbeMask(dimension, center, mask);
    let matched = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await waitTicks(1);
      matched = outputMatches(dimension, center, mask);
      if (matched) {
        break;
      }
    }
    requireCondition(matched, describeOutputMismatch(dimension, center, mask));
    digitalMasksVerified += 1;
  }

  return {
    consumerEvents,
    digitalMasksVerified,
    inputFacesVerified: directions.length,
  };
}

function clearNeighbors(dimension: Dimension, center: Vector3): void {
  for (const { delta } of directions) {
    getBlock(dimension, offset(center, delta)).setType("minecraft:air");
  }
}

function setProbeMask(
  dimension: Dimension,
  center: Vector3,
  mask: number,
): void {
  getBlock(dimension, center).setPermutation(
    BlockPermutation.resolve(
      `computer_system:redstone_probe_${String(mask).padStart(2, "0")}`,
    ),
  );
}

function getBlock(dimension: Dimension, location: Vector3): Block {
  const block = dimension.getBlock(location);
  requireCondition(block !== undefined, "Redstone probe chunk is not loaded.");
  return block;
}

function sameLocation(left: Vector3, right: Vector3): boolean {
  return left.x === right.x && left.y === right.y && left.z === right.z;
}

function outputMatches(
  dimension: Dimension,
  center: Vector3,
  mask: number,
): boolean {
  return directions.every(({ delta }, bit) => {
    const powered =
      getBlock(dimension, offset(center, delta)).typeId ===
      "minecraft:lit_redstone_lamp";
    return powered === ((mask & (1 << bit)) !== 0);
  });
}

function describeOutputMismatch(
  dimension: Dimension,
  center: Vector3,
  mask: number,
): string {
  const mismatch = directions.find(({ delta }, bit) => {
    const powered =
      getBlock(dimension, offset(center, delta)).typeId ===
      "minecraft:lit_redstone_lamp";
    return powered !== ((mask & (1 << bit)) !== 0);
  });
  return `Output mask ${mask} did not settle${mismatch === undefined ? "" : ` on ${mismatch.face}`}.`;
}
