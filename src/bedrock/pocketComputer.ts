import {
  EntityComponentTypes,
  ItemStack,
  system,
  world,
  type ItemComponentRegistry,
  type Player,
} from "@minecraft/server";

import { PocketSessionLifecycle } from "../phase0/pocketSessionLifecycle.js";
import type { ComputerIdentityObservation } from "../domain/computer/identity.js";
import {
  computerIdentityProperty,
  createPortableComputer,
  ensurePortableComputer,
  identityService,
} from "./computerRegistry.js";
import { disconnectComputerTerminalPlayer } from "./computerTerminal.js";
import { requestWebComputerTerminal } from "./webTerminalBridge.js";

export const pocketComputerTypeId = "computer_system:pocket_computer";
export const pocketIdentityProperty = computerIdentityProperty;
const componentId = "computer_system:pocket_computer";
const lifecycle = new PocketSessionLifecycle();

export function registerPocketComputerComponent(
  registry: ItemComponentRegistry,
): void {
  registry.registerCustomComponent(componentId, {
    onUse: ({ itemStack, source }): void => {
      const resolved = resolvePocketComputer(source, itemStack);
      if (resolved === undefined) return;
      const { identity, observation } = resolved;

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
          const record = ensurePortableComputer(
            observation.computerId,
            observation.family,
          );
          requestWebComputerTerminal(source, record);
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

function resolvePocketComputer(
  player: Player,
  itemStack: ItemStack | undefined,
):
  | {
      readonly identity: string;
      readonly observation: ComputerIdentityObservation;
    }
  | undefined {
  const identity = itemStack?.getDynamicProperty(pocketIdentityProperty);
  if (typeof identity === "string") {
    const observation = identityService().observation(identity);
    if (observation === undefined) {
      player.sendMessage("This Pocket Computer identity is unavailable.");
      return undefined;
    }
    return { identity, observation };
  }

  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const selectedItem = inventory?.getItem(player.selectedSlotIndex);
  if (
    inventory === undefined ||
    selectedItem?.typeId !== pocketComputerTypeId
  ) {
    player.sendMessage(
      "Pocket Computer initialization could not find the held item.",
    );
    return undefined;
  }

  try {
    const record = createPortableComputer("advanced");
    selectedItem.setDynamicProperty(pocketIdentityProperty, record.computerId);
    inventory.setItem(player.selectedSlotIndex, selectedItem);
    const observation = identityService().observation(record.computerId);
    if (observation === undefined)
      throw new Error("Pocket Computer identity was not persisted.");
    player.sendMessage(`Pocket Computer initialized (${record.computerId}).`);
    return {
      identity: record.computerId,
      observation,
    };
  } catch (error: unknown) {
    player.sendMessage(
      `Pocket Computer initialization failed: ${errorMessage(error)}`,
    );
    return undefined;
  }
}

export function startPocketComputerLifecycle(): void {
  world.afterEvents.playerLeave.subscribe(({ playerId }): void => {
    lifecycle.disconnect(playerId);
    disconnectComputerTerminalPlayer(playerId);
  });

  world.afterEvents.entityItemDrop.subscribe(({ items }): void => {
    // GDK 26.33 can surface a single native Entity even though the stable
    // declaration exposes Entity[]. Normalize both shapes at this adapter
    // boundary so joining/dropping never terminates the event callback.
    const droppedEntities = Array.isArray(items) ? items : [items];
    for (const entity of droppedEntities) {
      if (entity === undefined) continue;
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
