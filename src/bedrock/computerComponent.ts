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
  computerIdentityProperty,
  ensureComputer,
  ensurePortableComputer,
  identityService,
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

export { computerIdentityProperty } from "./computerRegistry.js";
export const desktopComputerDisplayName = "Desktop Computer System";
const blockComponentId = "computer_system:computer";
const itemComponentId = "computer_system:computer_item";
const breakingBlocks = new Set<string>();
let outputCursor = 0;

export function registerComputerComponents(
  blocks: BlockComponentRegistry,
  items: ItemComponentRegistry,
): void {
  blocks.registerCustomComponent(blockComponentId, {
    onPlace: ({ block }, parameters): void => {
      const family = familyParameter(parameters);
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
    },
    onPlayerBreak: handleBreak,
    onPlayerInteract: handleInteraction,
    onRedstoneUpdate: handleRedstoneUpdate,
  });
  items.registerCustomComponent(itemComponentId, { onUseOn: handleItemUseOn });
}

export function startComputerComponents(): void {
  identityService();
  system.runInterval(syncComputerOutputs, 1);
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
  const target = adjacent(event.block, event.blockFace);
  if (target === undefined || !target.isAir) return;
  const family = familyParameter(parameters);
  const carried = event.itemStack.getDynamicProperty(computerIdentityProperty);
  if (carried !== undefined && typeof carried !== "string") {
    event.source.sendMessage("Computer item identity is invalid.");
    return;
  }
  const result = identityService().place(blockKey(target), family, carried);
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
  const result = identityService().break(physicalKey);
  if (result.outcome !== "placed") return;
  computerHost.serial.disconnectComputer(result.computerId, "block_broken");
  computerHost.peripherals.clearComputer(result.computerId);
  const player = event.player;
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

function handleInteraction(event: BlockComponentPlayerInteractEvent): void {
  if (event.player === undefined) return;
  const observation = identityService().atPhysicalKey(blockKey(event.block));
  if (observation === undefined) {
    event.player.sendMessage("Computer identity is unavailable.");
    return;
  }
  const player = event.player;
  selectComputerTerminal(player.id, observation.computerId);
  if (!hasAdjacentMonitor(event.block)) {
    player.sendMessage(
      "Computer selected. Place a Monitor next to it to open Web Terminal.",
    );
    return;
  }
  system.run((): void => {
    if (!player.isValid) return;
    try {
      const record = ensureComputer(observation.computerId, observation.family);
      requestWebComputerTerminal(player, record, event.block);
    } catch (error: unknown) {
      if (player.isValid) {
        player.sendMessage(`Computer terminal failed: ${errorMessage(error)}`);
      }
    }
  });
}

export function adjacentDesktopComputers(
  block: Block,
): readonly ReturnType<typeof ensureComputer>[] {
  const records = new Map<string, ReturnType<typeof ensureComputer>>();
  for (const adjacentBlock of adjacentBlocks(block)) {
    if (adjacentBlock === undefined || !isComputerBlock(adjacentBlock.typeId))
      continue;
    const observation = identityService().atPhysicalKey(
      blockKey(adjacentBlock),
    );
    if (observation === undefined) continue;
    records.set(
      observation.computerId,
      ensureComputer(observation.computerId, observation.family),
    );
  }
  return [...records.values()];
}

function handleRedstoneUpdate(event: BlockComponentRedstoneUpdateEvent): void {
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
  adjacentBlocks(event.block).forEach((block, index) => {
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
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const remainder = inventory === undefined ? item : inventory.addItem(item);
  if (remainder !== undefined)
    player.dimension.spawnItem(remainder, player.location);
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

function hasAdjacentMonitor(block: Block): boolean {
  return adjacentBlocks(block).some(
    (candidate) => candidate?.typeId === "computer_system:monitor",
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
