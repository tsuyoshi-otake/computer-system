import {
  EntityComponentTypes,
  ItemStack,
  system,
  world,
  type ItemComponentRegistry,
  type Player,
} from "@minecraft/server";

import { PocketSessionLifecycle } from "../phase0/pocketSessionLifecycle.js";
import {
  computerIdentityProperty,
  createPortableComputer,
  ensureComputer,
  identityService,
} from "./computerRegistry.js";
import {
  disconnectComputerTerminalPlayer,
  openComputerTerminal,
} from "./computerTerminal.js";

export const pocketComputerTypeId = "computer_system:pocket_computer";
export const pocketIdentityProperty = computerIdentityProperty;
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
      const observation = identityService().observation(identity);
      if (observation === undefined) {
        source.sendMessage("This Pocket Computer identity is unavailable.");
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
        try {
          const record = ensureComputer(
            observation.computerId,
            observation.family,
          );
          void openComputerTerminal(source, record).catch((error: unknown) => {
            if (source.isValid)
              source.sendMessage(
                `Pocket Computer failed: ${errorMessage(error)}`,
              );
          });
        } catch (error: unknown) {
          if (source.isValid)
            source.sendMessage(
              `Pocket Computer failed: ${errorMessage(error)}`,
            );
        }
      });
    },
  });
}

export function startPocketComputerLifecycle(): void {
  world.afterEvents.playerLeave.subscribe(({ playerId }): void => {
    lifecycle.disconnect(playerId);
    disconnectComputerTerminalPlayer(playerId);
  });

  world.afterEvents.entityItemDrop.subscribe(({ items }): void => {
    for (const entity of items) {
      const stack = entity.getComponent(EntityComponentTypes.Item)?.itemStack;
      observeDropped(stack);
    }
  });
}

export function givePocketComputer(player: Player): string {
  const record = createPortableComputer("advanced");
  const item = new ItemStack(pocketComputerTypeId, 1);
  item.setDynamicProperty(pocketIdentityProperty, record.computerId);
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  let remainder: ItemStack | undefined;
  if (
    inventory !== undefined &&
    inventory.getItem(player.selectedSlotIndex) === undefined
  ) {
    inventory.setItem(player.selectedSlotIndex, item);
    if (
      inventory.getItem(player.selectedSlotIndex)?.typeId !==
      pocketComputerTypeId
    )
      throw new Error("Pocket Computer did not reach the selected slot.");
  } else {
    remainder = inventory === undefined ? item : inventory.addItem(item);
  }
  if (remainder !== undefined)
    player.dimension.spawnItem(remainder, player.location);
  return record.computerId;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
