import {
  BlockPermutation,
  EntityComponentTypes,
  ItemStack,
  type Block,
  type Container,
  type Dimension,
  type Vector3,
} from "@minecraft/server";

import {
  ExclusiveOperationRegistry,
  OperationLease,
} from "../../phase0/exclusiveOperationRegistry.js";
import { offset, probeArenaY, requireCondition } from "./worldProbeSupport.js";

export interface TurtleProbeResult {
  readonly blockedMoveRejected: boolean;
  readonly conflictRejected: boolean;
  readonly dropRecovered: boolean;
  readonly inventoryTransferred: boolean;
  readonly rollbackRestored: boolean;
  readonly successfulMove: boolean;
  readonly unloadedMoveRejected: boolean;
}

interface MoveResult {
  readonly status:
    "blocked" | "conflict" | "moved" | "rolled_back" | "unloaded";
}

export function executeTurtleProbe(dimension: Dimension): TurtleProbeResult {
  const registry = new ExclusiveOperationRegistry();
  const origin = { x: -6, y: probeArenaY, z: 0 };
  const moved = offset(origin, { x: 1, y: 0, z: 0 });
  const occupied = offset(origin, { x: 2, y: 0, z: 0 });
  const rollbackTarget = offset(origin, { x: 1, y: 0, z: 1 });
  const dropLocation = offset(origin, { x: 0, y: 0, z: 3 });
  const sourceChest = offset(origin, { x: 2, y: 0, z: 3 });
  const targetChest = offset(origin, { x: 4, y: 0, z: 3 });
  const conflictTarget = offset(origin, { x: 1, y: 0, z: -1 });
  const unloadedTarget = { x: 16_384, y: probeArenaY, z: 16_384 };

  setBlock(dimension, origin, "minecraft:gold_block");
  setBlock(dimension, moved, "minecraft:air");
  const successfulMove =
    moveMarker(dimension, origin, moved, registry).status === "moved";

  setBlock(dimension, occupied, "minecraft:stone");
  const blockedMoveRejected =
    moveMarker(dimension, moved, occupied, registry).status === "blocked" &&
    getBlock(dimension, moved).typeId === "minecraft:gold_block" &&
    getBlock(dimension, occupied).typeId === "minecraft:stone";

  setBlock(dimension, rollbackTarget, "minecraft:air");
  const rollbackRestored =
    moveMarker(dimension, moved, rollbackTarget, registry, true).status ===
      "rolled_back" &&
    getBlock(dimension, moved).typeId === "minecraft:gold_block" &&
    getBlock(dimension, rollbackTarget).isAir;

  setBlock(dimension, conflictTarget, "minecraft:air");
  const held = registry.tryBegin("held-operation", [
    blockResource(dimension, moved),
    blockResource(dimension, conflictTarget),
  ]);
  requireCondition(held instanceof OperationLease, "Could not stage conflict.");
  const conflictRejected =
    moveMarker(dimension, moved, conflictTarget, registry).status ===
      "conflict" &&
    getBlock(dimension, moved).typeId === "minecraft:gold_block";
  held.rollback();

  const unloadedMoveRejected =
    moveMarker(dimension, moved, unloadedTarget, registry).status ===
      "unloaded" &&
    getBlock(dimension, moved).typeId === "minecraft:gold_block" &&
    registry.activeResourceCount === 0;

  setBlock(dimension, dropLocation, "minecraft:stone");
  setBlock(dimension, dropLocation, "minecraft:air");
  const droppedEntity = dimension.spawnItem(
    new ItemStack("minecraft:cobblestone", 1),
    offset(dropLocation, { x: 0.5, y: 0.5, z: 0.5 }),
  );
  const dropRecovered =
    droppedEntity.getComponent(EntityComponentTypes.Item)?.itemStack.typeId ===
    "minecraft:cobblestone";
  droppedEntity.remove();

  setBlock(dimension, sourceChest, "minecraft:chest");
  setBlock(dimension, targetChest, "minecraft:chest");
  const source = getContainer(dimension, sourceChest);
  const target = getContainer(dimension, targetChest);
  source.setItem(0, new ItemStack("minecraft:iron_ingot", 4));
  source.transferItem(0, target);
  const inventoryTransferred =
    source.getItem(0) === undefined &&
    target.getItem(0)?.typeId === "minecraft:iron_ingot" &&
    target.getItem(0)?.amount === 4;

  requireCondition(successfulMove, "Turtle marker did not move.");
  requireCondition(
    blockedMoveRejected,
    "Occupied turtle move was not rejected.",
  );
  requireCondition(rollbackRestored, "Failed turtle move did not roll back.");
  requireCondition(
    conflictRejected,
    "Conflicting turtle move was not rejected.",
  );
  requireCondition(
    unloadedMoveRejected,
    "Unloaded turtle destination was not rejected cleanly.",
  );
  requireCondition(dropRecovered, "Turtle drop could not be recovered.");
  requireCondition(
    inventoryTransferred,
    "Turtle inventory transfer did not preserve the stack.",
  );

  return {
    blockedMoveRejected,
    conflictRejected,
    dropRecovered,
    inventoryTransferred,
    rollbackRestored,
    successfulMove,
    unloadedMoveRejected,
  };
}

function moveMarker(
  dimension: Dimension,
  sourceLocation: Vector3,
  targetLocation: Vector3,
  registry: ExclusiveOperationRegistry,
  injectFailure = false,
): MoveResult {
  const lease = registry.tryBegin(
    `move-${sourceLocation.x}-${targetLocation.x}`,
    [
      blockResource(dimension, sourceLocation),
      blockResource(dimension, targetLocation),
    ],
  );
  if (!(lease instanceof OperationLease)) {
    return { status: "conflict" };
  }

  const source = dimension.getBlock(sourceLocation);
  const target = dimension.getBlock(targetLocation);
  if (source === undefined || target === undefined) {
    lease.rollback();
    return { status: "unloaded" };
  }
  if (source.typeId !== "minecraft:gold_block" || !target.isAir) {
    lease.rollback();
    return { status: "blocked" };
  }

  const sourceBefore = source.permutation;
  const targetBefore = target.permutation;
  try {
    target.setPermutation(sourceBefore);
    source.setType("minecraft:air");
    if (injectFailure) {
      throw new Error("Injected move failure");
    }
    lease.commit();
    return { status: "moved" };
  } catch {
    source.setPermutation(sourceBefore);
    target.setPermutation(targetBefore);
    lease.rollback();
    return { status: "rolled_back" };
  }
}

function blockResource(dimension: Dimension, location: Vector3): string {
  return `${dimension.id}:${location.x}:${location.y}:${location.z}`;
}

function getBlock(dimension: Dimension, location: Vector3): Block {
  const block = dimension.getBlock(location);
  requireCondition(block !== undefined, "Probe arena chunk is not loaded.");
  return block;
}

function setBlock(
  dimension: Dimension,
  location: Vector3,
  typeId: string,
): void {
  getBlock(dimension, location).setPermutation(
    BlockPermutation.resolve(typeId),
  );
}

function getContainer(dimension: Dimension, location: Vector3): Container {
  const component = getBlock(dimension, location).getComponent(
    "minecraft:inventory",
  );
  requireCondition(
    component?.container !== undefined,
    "Chest has no container.",
  );
  return component.container;
}
