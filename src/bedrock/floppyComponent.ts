import {
  EntityComponentTypes,
  ItemStack,
  world,
  type Block,
  type BlockComponentPlayerInteractEvent,
  type Player,
} from "@minecraft/server";

import type { ComputerRecord } from "../domain/computer/computer.js";
import {
  computerHost,
  floppyMediaService,
  setGuestFloppyEjectHandler,
} from "./computerHost.js";
import { identityService } from "./computerRegistry.js";
import { giveOrDropItem } from "./giveOrDropItem.js";

export const floppyDiskItemId = "computer_system:floppy_disk";
export const floppyMediaIdProperty = "computer_system:floppy_media_id";
export const floppyGenerationProperty = "computer_system:floppy_generation";

export function startFloppyComponent(): void {
  setGuestFloppyEjectHandler((computerId): void => {
    const observation = identityService().observation(computerId);
    const block =
      observation === undefined
        ? undefined
        : blockFromPhysicalKey(observation.physicalKey);
    if (block === undefined)
      throw new Error("Floppy eject has no item delivery target");
    ejectFloppy(computerId, undefined, block);
  });
}

/** Returns true when the interaction was fully consumed by the floppy bay. */
export function handleFloppyInteraction(
  event: BlockComponentPlayerInteractEvent,
  record: ComputerRecord,
): boolean {
  const player = event.player;
  if (player === undefined) return false;
  // Crashed+sneak belongs exclusively to one-shot safe boot.
  if (record.lifecycle.state.kind === "crashed" && player.isSneaking)
    return false;
  const held = selectedItem(player);
  if (held?.typeId === floppyDiskItemId) {
    insertFloppy(player, held, record.computerId);
    return true;
  }
  if (
    player.isSneaking &&
    held === undefined &&
    computerHost.runtime.floppyDrive(record.computerId)?.media !== undefined
  ) {
    try {
      ejectFloppy(record.computerId, player, event.block);
      player.sendMessage("Floppy Disk ejected.");
    } catch (error: unknown) {
      player.sendMessage(`Floppy eject failed: ${message(error)}`);
    }
    return true;
  }
  return false;
}

export function ejectFloppyForBreak(
  computerId: string,
  player: Player | undefined,
  block: Block | undefined,
): void {
  if (computerHost.runtime.floppyDrive(computerId)?.media === undefined) return;
  try {
    ejectFloppy(computerId, player, block);
  } catch (error: unknown) {
    player?.sendMessage(`Floppy eject failed: ${message(error)}`);
  }
}

function insertFloppy(
  player: Player,
  item: ItemStack,
  computerId: string,
): void {
  try {
    const selected = selectedItem(player);
    if (selected === undefined || selected.typeId !== floppyDiskItemId)
      throw new Error("Selected Floppy Disk changed");
    let mediaId = item.getDynamicProperty(floppyMediaIdProperty);
    let instanceGeneration = item.getDynamicProperty(floppyGenerationProperty);
    if (mediaId === undefined && instanceGeneration === undefined) {
      const created = floppyMediaService().create();
      if (created.outcome !== "created")
        throw created.outcome === "failed"
          ? created.error
          : new Error("Unable to create Floppy media");
      mediaId = created.identity.mediaId;
      instanceGeneration = created.identity.instanceGeneration;
      selected.setDynamicProperty(floppyMediaIdProperty, mediaId);
      selected.setDynamicProperty(floppyGenerationProperty, instanceGeneration);
      setSelectedItem(player, selected);
    }
    if (
      typeof mediaId !== "string" ||
      typeof instanceGeneration !== "number" ||
      !Number.isSafeInteger(instanceGeneration)
    ) {
      throw new Error("Floppy Disk identity is invalid");
    }
    const loaded = floppyMediaService().load(mediaId);
    if (loaded.outcome !== "loaded")
      throw loaded.outcome === "failed"
        ? loaded.error
        : new Error("Floppy media is missing");
    computerHost.insertFloppyMedia(computerId, loaded.media);
    const inserted = floppyMediaService().insert(computerId, {
      instanceGeneration,
      mediaId,
    });
    if (inserted.outcome !== "inserted") {
      computerHost.ejectFloppyMedia(computerId);
      throw inserted.outcome === "failed"
        ? inserted.error
        : new Error("Floppy insertion was rejected");
    }
    setSelectedItem(player, undefined);
    player.sendMessage(`Floppy Disk ${mediaId} inserted.`);
  } catch (error: unknown) {
    player.sendMessage(`Floppy insert failed: ${message(error)}`);
  }
}

function ejectFloppy(
  computerId: string,
  player: Player | undefined,
  block: Block | undefined,
): void {
  if (player?.isValid !== true && block === undefined)
    throw new Error("Floppy eject has no item delivery target");
  const media = computerHost.ejectFloppyMedia(computerId);
  const result = floppyMediaService().eject(computerId, media.mediaId);
  if (result.outcome !== "ejected") {
    computerHost.insertFloppyMedia(computerId, media);
    throw result.outcome === "failed"
      ? result.error
      : new Error("Floppy media is missing");
  }
  const item = new ItemStack(floppyDiskItemId, 1);
  item.setDynamicProperty(floppyMediaIdProperty, result.identity.mediaId);
  item.setDynamicProperty(
    floppyGenerationProperty,
    result.identity.instanceGeneration,
  );
  try {
    if (player?.isValid) giveOrDropItem(player, item);
    else {
      block!.dimension.spawnItem(item, {
        x: block!.x + 0.5,
        y: block!.y + 1,
        z: block!.z + 0.5,
      });
    }
  } catch (deliveryError: unknown) {
    try {
      computerHost.insertFloppyMedia(computerId, media);
      const rollback = floppyMediaService().insert(computerId, result.identity);
      if (rollback.outcome !== "inserted")
        throw rollback.outcome === "failed"
          ? rollback.error
          : new Error("Floppy eject rollback was rejected");
    } catch (rollbackError: unknown) {
      throw new AggregateError(
        [deliveryError, rollbackError],
        "Floppy eject delivery and rollback failed",
      );
    }
    throw deliveryError;
  }
}

function selectedItem(player: Player): ItemStack | undefined {
  return player
    .getComponent(EntityComponentTypes.Inventory)
    ?.container?.getItem(player.selectedSlotIndex);
}

function setSelectedItem(player: Player, item: ItemStack | undefined): void {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  if (inventory === undefined)
    throw new Error("Player inventory is unavailable");
  inventory.setItem(player.selectedSlotIndex, item);
}

function blockFromPhysicalKey(key: string): Block | undefined {
  const separator = key.lastIndexOf("|");
  if (separator < 0) return undefined;
  const [x, y, z] = key
    .slice(separator + 1)
    .split(",")
    .map(Number);
  if (![x, y, z].every(Number.isInteger)) return undefined;
  try {
    return world
      .getDimension(key.slice(0, separator))
      .getBlock({ x: x!, y: y!, z: z! });
  } catch {
    return undefined;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
