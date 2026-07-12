import {
  EntityComponentTypes,
  ItemStack,
  world,
  type Dimension,
} from "@minecraft/server";

import { offset, probeArenaY, requireCondition } from "./worldProbeSupport.js";
import {
  pocketComputerTypeId,
  pocketIdentityProperty,
} from "../pocketComputer.js";

const identityProperty = pocketIdentityProperty;

export interface ItemIdentityProbeResult {
  readonly droppedIdentityPreserved: boolean;
  readonly placedIdentityPreserved: boolean;
  readonly previousIdentityPresent: boolean;
  readonly roundTripIdentityPreserved: boolean;
  readonly storedIdentityPreserved: boolean;
}

export function executeItemIdentityProbe(
  dimension: Dimension,
): ItemIdentityProbeResult {
  const chestLocation = { x: 12, y: probeArenaY, z: 0 };
  const chest = dimension.getBlock(chestLocation);
  requireCondition(chest !== undefined, "Identity chest chunk is not loaded.");
  if (chest.typeId !== "minecraft:chest") {
    chest.setType("minecraft:chest");
  }

  const inventory = chest.getComponent("minecraft:inventory");
  requireCondition(
    inventory?.container !== undefined,
    "Identity chest has no inventory.",
  );

  const previous = inventory.container.getItem(0);
  const previousIdentity = previous?.getDynamicProperty(identityProperty);
  const previousIdentityPresent = typeof previousIdentity === "string";
  if (previous !== undefined) {
    requireCondition(
      previous.typeId === pocketComputerTypeId && previousIdentityPresent,
      "Persisted identity item was corrupt.",
    );
  }

  const identity = `computer-${world.getAbsoluteTime()}`;
  const placedLocation = { x: 14, y: probeArenaY, z: 0 };
  const placedIdentityProperty = "computer_system:phase0_placed_identity";
  const item = new ItemStack(pocketComputerTypeId, 1);
  requireCondition(
    !item.isStackable && item.maxAmount === 1,
    `Pocket Computer item definition is stackable (isStackable=${String(item.isStackable)}, maxAmount=${String(item.maxAmount)}).`,
  );
  item.setDynamicProperty(identityProperty, identity);
  inventory.container.setItem(0, item);

  const stored = inventory.container.getItem(0);
  const storedIdentityPreserved =
    stored?.getDynamicProperty(identityProperty) === identity;
  requireCondition(
    storedIdentityPreserved && stored !== undefined,
    "Container round trip lost item identity.",
  );

  const dropped = dimension.spawnItem(
    stored,
    offset(chestLocation, { x: 0.5, y: 1.5, z: 0.5 }),
  );
  const droppedIdentityPreserved =
    dropped
      .getComponent(EntityComponentTypes.Item)
      ?.itemStack.getDynamicProperty(identityProperty) === identity;
  dropped.remove();
  requireCondition(droppedIdentityPreserved, "Dropped item lost its identity.");

  const placed = dimension.getBlock(placedLocation);
  requireCondition(
    placed !== undefined,
    "Identity placement chunk is not loaded.",
  );
  placed.setType("minecraft:gold_block");
  world.setDynamicProperty(placedIdentityProperty, identity);
  const placedIdentityPreserved =
    placed.typeId === "minecraft:gold_block" &&
    world.getDynamicProperty(placedIdentityProperty) === identity;
  requireCondition(
    placedIdentityPreserved,
    "Placed block identity mapping was not preserved.",
  );

  placed.setType("minecraft:air");
  const roundTripItem = new ItemStack(pocketComputerTypeId, 1);
  roundTripItem.setDynamicProperty(
    identityProperty,
    world.getDynamicProperty(placedIdentityProperty),
  );
  const roundTripIdentityPreserved =
    roundTripItem.getDynamicProperty(identityProperty) === identity;
  world.setDynamicProperty(placedIdentityProperty, undefined);
  requireCondition(
    roundTripIdentityPreserved,
    "Placed block to item round trip lost identity.",
  );

  return {
    droppedIdentityPreserved,
    placedIdentityPreserved,
    previousIdentityPresent,
    roundTripIdentityPreserved,
    storedIdentityPreserved,
  };
}
