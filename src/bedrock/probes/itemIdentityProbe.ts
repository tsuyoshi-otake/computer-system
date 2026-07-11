import {
  EntityComponentTypes,
  ItemStack,
  world,
  type Dimension,
} from "@minecraft/server";

import { offset, probeArenaY, requireCondition } from "./worldProbeSupport.js";

const identityProperty = "computer_system:instance_id";

export interface ItemIdentityProbeResult {
  readonly droppedIdentityPreserved: boolean;
  readonly previousIdentityPresent: boolean;
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
      previous.typeId === "minecraft:diamond_sword" && previousIdentityPresent,
      "Persisted identity item was corrupt.",
    );
  }

  const identity = `computer-${world.getAbsoluteTime()}`;
  const item = new ItemStack("minecraft:diamond_sword", 1);
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

  return {
    droppedIdentityPreserved,
    previousIdentityPresent,
    storedIdentityPreserved,
  };
}
