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
  type BlockComponentRedstoneUpdateEvent,
  type BlockComponentRegistry,
  type CustomComponentParameters,
  type ItemComponentRegistry,
  type ItemComponentUseOnEvent,
} from "@minecraft/server";

import { scheduleOwnedFinalization } from "../application/computer/deferredFinalization.js";
import type { ComputerFamily } from "../domain/computer/identity.js";
import { redstoneSides } from "../domain/redstone/redstoneState.js";
import { computerHost } from "./computerHost.js";
import {
  computerStorageReady,
  computerIdentityProperty,
  ensureComputer,
  ensurePortableComputer,
  identityService,
  notifyComputerStorageUnavailable,
  recoverStaleComputerPosition,
} from "./computerRegistry.js";
import { selectComputerTerminal } from "./computerTerminal.js";
import { requestWebComputerTerminal } from "./webTerminalBridge.js";
import {
  placeMachineFacingPlayer,
  replaceMachinePreservingDirection,
} from "./machinePlacement.js";
import {
  isComputerSystemBlock,
  refreshFaceIoTopology,
} from "./faceIoTopology.js";
import {
  ejectFloppyForBreak,
  handleFloppyInteraction,
} from "./floppyComponent.js";
import { giveOrDropItem } from "./giveOrDropItem.js";

export { computerIdentityProperty } from "./computerRegistry.js";
export const desktopComputerDisplayName = "Desktop Computer System";
const blockComponentId = "computer_system:computer";
const itemComponentId = "computer_system:computer_item";
const breakingBlocks = new Set<string>();
const pendingPlacements = new Map<string, ComputerFamily>();
const pendingBreaks = new Map<string, Player | undefined>();
const maximumPendingPlacements = 128;
const maximumPendingBreaks = 4_096;
const pendingPlacementBatchSize = 4;
let outputCursor = 0;

export function registerComputerComponents(
  blocks: BlockComponentRegistry,
  items: ItemComponentRegistry,
): void {
  blocks.registerCustomComponent(blockComponentId, {
    onPlace: ({ block }, parameters): void => {
      const family = familyParameter(parameters);
      if (!computerStorageReady()) {
        queuePendingPlacement(block, family);
        return;
      }
      placeComputerBlock(block, family);
    },
    onPlayerBreak: handleBreak,
    onPlayerInteract: handleInteraction,
    onRedstoneUpdate: handleRedstoneUpdate,
  });
  items.registerCustomComponent(itemComponentId, { onUseOn: handleItemUseOn });
}

export function startComputerComponents(): void {
  identityService();
  system.runInterval((): void => {
    drainPendingBreaks();
    drainPendingPlacements();
    syncComputerOutputs();
  }, 1);
}

function placeComputerBlock(block: Block, family: ComputerFamily): void {
  const physicalKey = blockKey(block);
  if (breakingBlocks.has(physicalKey)) return;
  const observation = identityService().atPhysicalKey(physicalKey);
  const result =
    observation === undefined
      ? identityService().place(physicalKey, family)
      : { outcome: "placed" as const, ...observation, generation: 0 };
  if (result.outcome === "placed") {
    ensureComputer(result.computerId, family);
    system.run((): void => refreshFaceIoTopology(block));
  }
}

function queuePendingPlacement(block: Block, family: ComputerFamily): void {
  const physicalKey = blockKey(block);
  if (
    !pendingPlacements.has(physicalKey) &&
    pendingPlacements.size >= maximumPendingPlacements
  ) {
    console.warn(
      `Computer placement rejected while storage migration is busy: ${physicalKey}`,
    );
    system.run((): void => {
      const residual = blockFromKey(physicalKey);
      if (residual !== undefined && isComputerBlock(residual.typeId)) {
        residual.setType("minecraft:air");
      }
    });
    return;
  }
  pendingPlacements.set(physicalKey, family);
}

function drainPendingPlacements(): void {
  let processed = 0;
  for (const [physicalKey, family] of pendingPlacements) {
    if (processed >= pendingPlacementBatchSize) break;
    pendingPlacements.delete(physicalKey);
    processed += 1;
    const block = blockFromKey(physicalKey);
    if (block !== undefined && isComputerBlock(block.typeId)) {
      placeComputerBlock(block, family);
    }
  }
}

export function giveNewComputerItem(
  player: Player,
  family: ComputerFamily = "standard",
): void {
  giveComputerItem(player, undefined, family);
}

function handleItemUseOn(
  event: ItemComponentUseOnEvent,
  parameters: CustomComponentParameters,
): void {
  if (!(event.source instanceof Player)) return;
  if (notifyComputerStorageUnavailable(event.source)) return;
  const target = adjacent(event.block, event.blockFace);
  if (target === undefined || !target.isAir) return;
  const family = familyParameter(parameters);
  const carried = event.itemStack.getDynamicProperty(computerIdentityProperty);
  if (carried !== undefined && typeof carried !== "string") {
    event.source.sendMessage("Computer item identity is invalid.");
    return;
  }
  const physicalKey = blockKey(target);
  if (!recoverStaleComputerPosition(event.source, physicalKey, carried)) return;
  const result = identityService().place(physicalKey, family, carried);
  if (result.outcome === "duplicate") {
    event.source.sendMessage("Duplicate computer identity rejected.");
    return;
  }
  try {
    ensureComputer(result.computerId, family);
    placeMachineFacingPlayer(target, blockType(family, 0), event.source);
    const inventory = event.source.getComponent(
      EntityComponentTypes.Inventory,
    )?.container;
    inventory?.setItem(event.source.selectedSlotIndex, undefined);
  } catch (error: unknown) {
    identityService().rollbackPlacement(
      blockKey(target),
      result.computerId,
      carried !== undefined,
    );
    event.source.sendMessage(
      `Computer placement failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function handleBreak(event: BlockComponentPlayerBreakEvent): void {
  const physicalKey = blockKey(event.block);
  if (!computerStorageReady()) {
    if (event.player !== undefined) {
      notifyComputerStorageUnavailable(event.player);
    }
    queuePendingBreak(physicalKey, event.player);
    return;
  }
  breakComputerBlock(physicalKey, event.player);
}

function breakComputerBlock(
  physicalKey: string,
  player: Player | undefined,
): void {
  const result = identityService().break(physicalKey);
  if (result.outcome !== "placed") return;
  ejectFloppyForBreak(result.computerId, player, blockFromKey(physicalKey));
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
        if (residual !== undefined && isComputerBlock(residual.typeId)) {
          residual.setType("minecraft:air");
        }
      },
      (): void => {
        if (player?.isValid)
          giveComputerItem(player, result.computerId, result.family);
      },
    ],
    onFailure: (phase, error): void => {
      const message = `Computer break ${phase} failed: ${errorMessage(error)}`;
      console.warn(message);
      if (player?.isValid) player.sendMessage(message);
    },
  });
}

function queuePendingBreak(
  physicalKey: string,
  player: Player | undefined,
): void {
  if (
    !pendingBreaks.has(physicalKey) &&
    pendingBreaks.size >= maximumPendingBreaks
  ) {
    const message = `Computer break recovery queue is full: ${physicalKey}`;
    console.warn(message);
    if (player?.isValid) player.sendMessage(message);
    return;
  }
  pendingBreaks.set(physicalKey, player);
}

function drainPendingBreaks(): void {
  let processed = 0;
  for (const [physicalKey, player] of pendingBreaks) {
    if (processed >= pendingPlacementBatchSize) break;
    pendingBreaks.delete(physicalKey);
    processed += 1;
    breakComputerBlock(physicalKey, player);
  }
}

function handleInteraction(event: BlockComponentPlayerInteractEvent): void {
  if (event.player === undefined) return;
  if (notifyComputerStorageUnavailable(event.player)) return;
  const observation = identityService().atPhysicalKey(blockKey(event.block));
  if (observation === undefined) {
    event.player.sendMessage("Computer identity is unavailable.");
    return;
  }
  const player = event.player;
  const record = ensureComputer(observation.computerId, observation.family);
  if (handleFloppyInteraction(event, record)) return;
  selectComputerTerminal(player.id, observation.computerId);
  system.run((): void => {
    if (!player.isValid) return;
    try {
      requestWebComputerTerminal(player, record, event.block);
    } catch (error: unknown) {
      if (player.isValid) {
        player.sendMessage(`Computer terminal failed: ${errorMessage(error)}`);
      }
    }
  });
}

function handleRedstoneUpdate(event: BlockComponentRedstoneUpdateEvent): void {
  if (!computerStorageReady()) return;
  computerHost.observeExternalWork(
    { lane: "redstone_input", deterministicUnits: redstoneSides.length },
    () => handleRedstoneUpdateBounded(event),
  );
}

function handleRedstoneUpdateBounded(
  event: BlockComponentRedstoneUpdateEvent,
): void {
  const observation = identityService().atPhysicalKey(blockKey(event.block));
  if (observation === undefined) return;
  const record = ensureComputer(observation.computerId, observation.family);
  sampleRedstoneInputs(event.block, record);
}

function sampleRedstoneInputs(
  computerBlock: Block,
  record: ReturnType<typeof ensureComputer>,
): void {
  adjacentBlocks(computerBlock).forEach((block, index) => {
    const side = redstoneSides[index]!;
    const power = block?.getRedstonePower() ?? 0;
    const change = record.redstone.setInput(side, power);
    if (change.changed) {
      computerHost.runtime.queueEvent(
        record.computerId,
        "redstone",
        side,
        power,
      );
    }
  });
}

function syncComputerOutputs(): void {
  const batch = identityService().blockObservationBatch(outputCursor, 4);
  outputCursor = batch.nextCursor;
  for (const observation of batch.observations) {
    const block = blockFromKey(observation.physicalKey);
    let record = computerHost.get(observation.computerId);
    if (block !== undefined && record === undefined) {
      record =
        block.typeId === "computer_system:portable_computer_block"
          ? ensurePortableComputer(observation.computerId, observation.family)
          : ensureComputer(observation.computerId, observation.family);
    }
    if (
      block === undefined ||
      record === undefined ||
      !isComputerSystemBlock(block.typeId)
    ) {
      computerHost.serial.disconnectComputer(
        observation.computerId,
        "topology_unavailable",
      );
      continue;
    }
    refreshFaceIoTopology(block);
    if (!isComputerBlock(block.typeId)) continue;
    computerHost.observeExternalWork(
      {
        lane: "redstone_input",
        deterministicUnits: redstoneSides.length,
        computerId: observation.computerId,
      },
      () => sampleRedstoneInputs(block, record),
    );
    computerHost.observeExternalWork(
      {
        lane: "redstone_output",
        deterministicUnits: 1,
        computerId: observation.computerId,
      },
      () => {
        const expected = blockType(
          observation.family,
          record.redstone.outputMask,
        );
        if (block.typeId !== expected)
          replaceMachinePreservingDirection(block, expected);
      },
    );
  }
}

function giveComputerItem(
  player: Player,
  computerId: string | undefined,
  family: ComputerFamily,
): void {
  const item = new ItemStack(
    `computer_system:${family === "advanced" ? "advanced_computer" : "computer"}_item`,
    1,
  );
  if (computerId !== undefined) {
    item.setDynamicProperty(computerIdentityProperty, computerId);
  }
  giveOrDropItem(player, item);
}

function familyParameter(
  parameters: CustomComponentParameters,
): ComputerFamily {
  const value = parameters.params as { family?: unknown } | undefined;
  if (value?.family === "advanced_computer") return "advanced";
  if (value?.family === "computer") return "standard";
  throw new Error("Computer component family is invalid.");
}

function blockType(family: ComputerFamily, mask: number): string {
  const name = family === "advanced" ? "advanced_computer" : "computer";
  return `computer_system:${name}_${String(mask).padStart(2, "0")}`;
}

function isComputerBlock(typeId: string): boolean {
  return (
    typeId.startsWith("computer_system:computer_") ||
    typeId.startsWith("computer_system:advanced_computer_")
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function adjacentBlocks(block: Block): readonly (Block | undefined)[] {
  return [
    block.below(),
    block.east(),
    block.north(),
    block.south(),
    block.above(),
    block.west(),
  ];
}
