import {
  EntityComponentTypes,
  ItemStack,
  system,
  world,
  type ItemComponentRegistry,
  type Player,
} from "@minecraft/server";

import { PocketSessionLifecycle } from "../phase0/pocketSessionLifecycle.js";
import { showTerminalProbe } from "./probes/uiProbe.js";

export const pocketComputerTypeId = "computer_system:pocket_computer";
export const pocketIdentityProperty = "computer_system:instance_id";
const componentId = "computer_system:pocket_computer";
const lifecycle = new PocketSessionLifecycle();

export function registerPocketComputerComponent(
  registry: ItemComponentRegistry,
): void {
  registry.registerCustomComponent(componentId, {
    onUse: ({ itemStack, source }): void => {
      const identity = itemStack?.getDynamicProperty(pocketIdentityProperty);
      if (typeof identity !== "string") {
        source.sendMessage("This Pocket Computer has no instance identity.");
        return;
      }

      const transition = lifecycle.use({
        instanceId: identity,
        location: "held",
        ownerId: source.id,
      });
      if (transition.outcome === "duplicate") {
        source.sendMessage("Duplicate Pocket Computer identity rejected.");
        return;
      }
      system.run((): void => {
        void showTerminalProbe(source);
      });
    },
  });
}

export function startPocketComputerLifecycle(): void {
  world.afterEvents.playerLeave.subscribe(({ playerId }): void => {
    lifecycle.disconnect(playerId);
  });

  world.afterEvents.entityItemDrop.subscribe(({ items }): void => {
    for (const entity of items) {
      const stack = entity.getComponent(EntityComponentTypes.Item)?.itemStack;
      observeDropped(stack);
    }
  });
}

export function givePocketComputer(player: Player): string {
  const identity = `pocket-${world.getAbsoluteTime()}-${player.id}`;
  const item = new ItemStack(pocketComputerTypeId, 1);
  item.setDynamicProperty(pocketIdentityProperty, identity);
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  if (inventory === undefined) {
    throw new Error("Player inventory is unavailable.");
  }
  const remainder = inventory.addItem(item);
  if (remainder !== undefined) {
    throw new Error("Player inventory is full.");
  }
  return identity;
}

function observeDropped(stack: ItemStack | undefined): void {
  if (stack?.typeId !== pocketComputerTypeId) {
    return;
  }
  const identity = stack.getDynamicProperty(pocketIdentityProperty);
  if (typeof identity === "string") {
    lifecycle.observe({ instanceId: identity, location: "dropped" });
  }
}
