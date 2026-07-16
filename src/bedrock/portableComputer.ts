import {
  Direction,
  EntityComponentTypes,
  ItemStack,
  Player,
  system,
  world,
  type Block,
  type BlockComponentPlayerBreakEvent,
  type BlockComponentPlayerInteractEvent,
  type BlockComponentRegistry,
  type ItemComponentRegistry,
  type ItemComponentUseOnEvent,
} from "@minecraft/server";

import { scheduleOwnedFinalization } from "../application/computer/deferredFinalization.js";
import { PortableSessionLifecycle } from "../phase0/portableSessionLifecycle.js";
import type { ComputerIdentityObservation } from "../domain/computer/identity.js";
import { computerHost } from "./computerHost.js";
import {
  clearComputerStorageNotice,
  computerStorageReady,
  computerIdentityProperty,
  createPortableComputer,
  ensurePortableComputer,
  identityService,
  notifyComputerStorageUnavailable,
  recoverStaleComputerPosition,
} from "./computerRegistry.js";
import { disconnectComputerTerminalPlayer } from "./computerTerminal.js";
import {
  disconnectWebTerminalPlayer,
  requestWebComputerTerminal,
} from "./webTerminalBridge.js";
import { placeMachineFacingPlayer } from "./machinePlacement.js";
import { refreshFaceIoTopology } from "./faceIoTopology.js";

export const portableComputerTypeId = "computer_system:portable_computer";
export const portableIdentityProperty = computerIdentityProperty;
export const portableComputerDisplayName = "Portable Computer System";
const componentId = "computer_system:portable_computer";
const blockComponentId = "computer_system:portable_computer_block";
export const portableComputerBlockTypeId =
  "computer_system:portable_computer_block";
const lifecycle = new PortableSessionLifecycle();
const breakingBlocks = new Set<string>();
const pendingPlacements = new Set<string>();
const pendingBreaks = new Map<string, Player | undefined>();
const maximumPendingPlacements = 128;
const maximumPendingBreaks = 4_096;
const pendingPlacementBatchSize = 4;
const maximumDroppedItemsToInspect = 128;
const maximumInventorySlotsToInspect = 128;

export function registerPortableComputerComponent(
  items: ItemComponentRegistry,
  blocks: BlockComponentRegistry,
): void {
  items.registerCustomComponent(componentId, {
    onUse: ({ itemStack, source }): void => {
      if (notifyComputerStorageUnavailable(source)) return;
      const resolved = resolvePortableComputer(source, itemStack);
      if (resolved === undefined) return;
      const { identity, observation } = resolved;

      const transition = acquirePortableSession(source, identity);
      if (transition.outcome === "duplicate") {
        source.sendMessage(
          `Duplicate ${portableComputerDisplayName} identity rejected.`,
        );
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
              `${portableComputerDisplayName} failed: ${errorMessage(error)}`,
            );
        }
      });
    },
    onUseOn: handlePortableItemUseOn,
  });
  blocks.registerCustomComponent(blockComponentId, {
    onPlace: handlePortableBlockPlace,
    onPlayerBreak: handlePortableBlockBreak,
    onPlayerInteract: handlePortableBlockInteraction,
  });
}

function handlePortableItemUseOn(event: ItemComponentUseOnEvent): void {
  if (!(event.source instanceof Player)) return;
  if (notifyComputerStorageUnavailable(event.source)) return;
  const target = adjacent(event.block, event.blockFace);
  if (target === undefined || !target.isAir) return;
  const resolved = resolvePortableComputer(event.source, event.itemStack);
  if (resolved === undefined) return;
  const { identity, observation } = resolved;
  const physicalKey = blockKey(target);
  if (!recoverStaleComputerPosition(event.source, physicalKey, identity))
    return;
  const placed = identityService().place(
    physicalKey,
    observation.family,
    identity,
  );
  if (placed.outcome === "duplicate") {
    event.source.sendMessage(
      `Duplicate ${portableComputerDisplayName} identity rejected.`,
    );
    return;
  }
  try {
    ensurePortableComputer(placed.computerId, placed.family);
    placeMachineFacingPlayer(target, portableComputerBlockTypeId, event.source);
    const inventory = event.source.getComponent(
      EntityComponentTypes.Inventory,
    )?.container;
    inventory?.setItem(event.source.selectedSlotIndex, undefined);
    lifecycle.observe({
      instanceId: identity,
      location: "transferred",
      ownerId: event.source.id,
    });
    disconnectComputerTerminalPlayer(event.source.id, identity);
    disconnectWebTerminalPlayer(event.source.id, "transferred", identity);
    event.source.sendMessage(
      `${portableComputerDisplayName} placed (${placed.computerId}).`,
    );
  } catch (error: unknown) {
    identityService().rollbackPlacement(physicalKey, identity, true);
    event.source.sendMessage(
      `${portableComputerDisplayName} placement failed: ${errorMessage(error)}`,
    );
  }
}

function handlePortableBlockPlace({ block }: { readonly block: Block }): void {
  if (!computerStorageReady()) {
    queuePendingPortablePlacement(block);
    return;
  }
  placePortableBlock(block);
}

function placePortableBlock(block: Block): void {
  const physicalKey = blockKey(block);
  if (breakingBlocks.has(physicalKey)) return;
  const existing = identityService().atPhysicalKey(physicalKey);
  const placed =
    existing === undefined
      ? identityService().place(physicalKey, "advanced")
      : { outcome: "placed" as const, ...existing, generation: 0 };
  if (placed.outcome === "placed") {
    ensurePortableComputer(placed.computerId, placed.family);
    system.run((): void => refreshFaceIoTopology(block));
  }
}

function handlePortableBlockInteraction(
  event: BlockComponentPlayerInteractEvent,
): void {
  const player = event.player;
  if (player === undefined) return;
  if (notifyComputerStorageUnavailable(player)) return;
  const observation = identityService().atPhysicalKey(blockKey(event.block));
  if (observation === undefined) {
    player.sendMessage(
      `${portableComputerDisplayName} identity is unavailable.`,
    );
    return;
  }
  system.run((): void => {
    if (!player.isValid) return;
    try {
      requestWebComputerTerminal(
        player,
        ensurePortableComputer(observation.computerId, observation.family),
        event.block,
      );
    } catch (error: unknown) {
      if (player.isValid)
        player.sendMessage(
          `${portableComputerDisplayName} terminal failed: ${errorMessage(error)}`,
        );
    }
  });
}

function handlePortableBlockBreak(event: BlockComponentPlayerBreakEvent): void {
  const physicalKey = blockKey(event.block);
  if (!computerStorageReady()) {
    if (event.player !== undefined) {
      notifyComputerStorageUnavailable(event.player);
    }
    queuePendingPortableBreak(physicalKey, event.player);
    return;
  }
  breakPortableBlock(physicalKey, event.player);
}

function breakPortableBlock(
  physicalKey: string,
  player: Player | undefined,
): void {
  const result = identityService().break(physicalKey);
  if (result.outcome !== "placed") return;
  computerHost.serial.disconnectComputer(result.computerId, "block_broken");
  computerHost.peripherals.clearComputer(result.computerId);
  scheduleOwnedFinalization(breakingBlocks, physicalKey, {
    prepare: [
      (): void => {
        computerHost.runtime.shutdown(result.computerId, "block_broken");
      },
      (): void => {
        computerHost.flush(result.computerId);
      },
    ],
    schedule: (callback): void => {
      system.run(callback);
    },
    finalize: [
      (): void => {
        const residual = blockFromKey(physicalKey);
        if (residual?.typeId === portableComputerBlockTypeId)
          residual.setType("minecraft:air");
      },
      (): void => {
        if (player?.isValid)
          givePortableComputerItem(player, result.computerId);
      },
    ],
    onFailure: (phase, error): void => {
      const message = `${portableComputerDisplayName} break ${phase} failed: ${errorMessage(error)}`;
      console.warn(message);
      if (player?.isValid) player.sendMessage(message);
    },
  });
}

function resolvePortableComputer(
  player: Player,
  itemStack: ItemStack | undefined,
):
  | {
      readonly identity: string;
      readonly observation: ComputerIdentityObservation;
    }
  | undefined {
  const identity = itemStack?.getDynamicProperty(portableIdentityProperty);
  if (typeof identity === "string") {
    const observation = identityService().observation(identity);
    if (observation === undefined) {
      player.sendMessage(
        `This ${portableComputerDisplayName} identity is unavailable.`,
      );
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
    selectedItem?.typeId !== portableComputerTypeId
  ) {
    player.sendMessage(
      `${portableComputerDisplayName} initialization could not find the held item.`,
    );
    return undefined;
  }

  try {
    const record = createPortableComputer("advanced");
    selectedItem.setDynamicProperty(
      portableIdentityProperty,
      record.computerId,
    );
    inventory.setItem(player.selectedSlotIndex, selectedItem);
    const observation = identityService().observation(record.computerId);
    if (observation === undefined)
      throw new Error(
        `${portableComputerDisplayName} identity was not persisted.`,
      );
    player.sendMessage(
      `${portableComputerDisplayName} initialized (${record.computerId}).`,
    );
    return {
      identity: record.computerId,
      observation,
    };
  } catch (error: unknown) {
    player.sendMessage(
      `${portableComputerDisplayName} initialization failed: ${errorMessage(error)}`,
    );
    return undefined;
  }
}

export function startPortableComputerLifecycle(): void {
  system.runInterval((): void => {
    drainPendingPortableBreaks();
    drainPendingPortablePlacements();
  }, 1);
  world.afterEvents.playerLeave.subscribe(({ playerId }): void => {
    clearComputerStorageNotice(playerId);
    lifecycle.disconnect(playerId);
    disconnectComputerTerminalPlayer(playerId);
  });

  world.afterEvents.entityItemDrop.subscribe(({ items }): void => {
    // GDK 26.33 can surface a single native Entity even though the stable
    // declaration exposes Entity[]. Normalize both shapes at this adapter
    // boundary so joining/dropping never terminates the event callback.
    const droppedEntities = Array.isArray(items) ? items : [items];
    const count = Math.min(
      droppedEntities.length,
      maximumDroppedItemsToInspect,
    );
    for (let index = 0; index < count; index += 1) {
      const entity = droppedEntities[index];
      if (entity === undefined) continue;
      const stack = entity.getComponent(EntityComponentTypes.Item)?.itemStack;
      observeDropped(stack);
    }
  });
}

function queuePendingPortableBreak(
  physicalKey: string,
  player: Player | undefined,
): void {
  if (
    !pendingBreaks.has(physicalKey) &&
    pendingBreaks.size >= maximumPendingBreaks
  ) {
    const message = `Portable Computer break recovery queue is full: ${physicalKey}`;
    console.warn(message);
    if (player?.isValid) player.sendMessage(message);
    return;
  }
  pendingBreaks.set(physicalKey, player);
}

function drainPendingPortableBreaks(): void {
  let processed = 0;
  for (const [physicalKey, player] of pendingBreaks) {
    if (processed >= pendingPlacementBatchSize) break;
    pendingBreaks.delete(physicalKey);
    processed += 1;
    breakPortableBlock(physicalKey, player);
  }
}

function queuePendingPortablePlacement(block: Block): void {
  const physicalKey = blockKey(block);
  if (
    !pendingPlacements.has(physicalKey) &&
    pendingPlacements.size >= maximumPendingPlacements
  ) {
    console.warn(
      `Portable Computer placement rejected while storage migration is busy: ${physicalKey}`,
    );
    system.run((): void => {
      const residual = blockFromKey(physicalKey);
      if (residual?.typeId === portableComputerBlockTypeId) {
        residual.setType("minecraft:air");
      }
    });
    return;
  }
  pendingPlacements.add(physicalKey);
}

function drainPendingPortablePlacements(): void {
  let processed = 0;
  for (const physicalKey of pendingPlacements) {
    if (processed >= pendingPlacementBatchSize) break;
    pendingPlacements.delete(physicalKey);
    processed += 1;
    const block = blockFromKey(physicalKey);
    if (block?.typeId === portableComputerBlockTypeId) {
      placePortableBlock(block);
    }
  }
}

export function givePortableComputer(player: Player): string {
  const record = createPortableComputer("advanced");
  givePortableComputerItem(player, record.computerId);
  return record.computerId;
}

function givePortableComputerItem(player: Player, computerId: string): void {
  const item = new ItemStack(portableComputerTypeId, 1);
  item.setDynamicProperty(portableIdentityProperty, computerId);
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
      portableComputerTypeId
    )
      throw new Error(
        `${portableComputerDisplayName} did not reach the selected slot.`,
      );
  } else {
    remainder = inventory === undefined ? item : inventory.addItem(item);
  }
  if (remainder !== undefined)
    player.dimension.spawnItem(remainder, player.location);
}

function acquirePortableSession(
  player: Player,
  identity: string,
): ReturnType<PortableSessionLifecycle["use"]> {
  const observation = {
    instanceId: identity,
    location: "held" as const,
    ownerId: player.id,
  };
  const initial = lifecycle.use(observation);
  if (initial.outcome !== "duplicate") return initial;

  const previous = lifecycle.get(identity);
  if (
    previous?.ownerId === undefined ||
    playerOwnsPortableIdentity(previous.ownerId, identity)
  ) {
    return initial;
  }

  const closed = lifecycle.observe({
    instanceId: identity,
    location: "transferred",
    ownerId: previous.ownerId,
  });
  if (closed.outcome !== "closed") {
    throw new Error(
      "Portable session transfer did not close the former owner.",
    );
  }
  disconnectComputerTerminalPlayer(previous.ownerId, identity);
  disconnectWebTerminalPlayer(previous.ownerId, "transferred", identity);
  return lifecycle.use(observation);
}

function playerOwnsPortableIdentity(
  playerId: string,
  identity: string,
): boolean {
  const owner = world.getAllPlayers().find((player) => player.id === playerId);
  const inventory = owner?.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  if (inventory === undefined) return false;
  const slots = Math.min(inventory.size, maximumInventorySlotsToInspect);
  for (let slot = 0; slot < slots; slot += 1) {
    const item = inventory.getItem(slot);
    if (
      item?.typeId === portableComputerTypeId &&
      item.getDynamicProperty(portableIdentityProperty) === identity
    ) {
      return true;
    }
  }
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function observeDropped(stack: ItemStack | undefined): void {
  if (stack?.typeId !== portableComputerTypeId) {
    return;
  }
  const identity = stack.getDynamicProperty(portableIdentityProperty);
  if (typeof identity === "string") {
    lifecycle.observe({ instanceId: identity, location: "dropped" });
  }
}

function adjacent(block: Block, direction: Direction): Block | undefined {
  switch (direction) {
    case Direction.Down:
      return block.below();
    case Direction.East:
      return block.east();
    case Direction.North:
      return block.north();
    case Direction.South:
      return block.south();
    case Direction.Up:
      return block.above();
    case Direction.West:
      return block.west();
  }
}

function blockKey(block: Block): string {
  return `${block.dimension.id}|${block.x},${block.y},${block.z}`;
}

function blockFromKey(key: string): Block | undefined {
  const separator = key.lastIndexOf("|");
  if (separator < 0) return undefined;
  const coordinates = key
    .slice(separator + 1)
    .split(",")
    .map(Number);
  if (
    coordinates.length !== 3 ||
    coordinates.some((value) => !Number.isInteger(value))
  )
    return undefined;
  try {
    return world.getDimension(key.slice(0, separator)).getBlock({
      x: coordinates[0]!,
      y: coordinates[1]!,
      z: coordinates[2]!,
    });
  } catch {
    return undefined;
  }
}
