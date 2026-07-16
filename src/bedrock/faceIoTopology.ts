import type { Block } from "@minecraft/server";

import {
  machineFaceForWorldDirection,
  machineFaces,
  oppositeWorldDirection,
  worldDirectionForMachineFace,
  type MachineCardinalDirection,
  type MachineWorldDirection,
} from "../domain/computer/machineFace.js";
import { computerHost } from "./computerHost.js";
import { identityService } from "./computerRegistry.js";

const cardinalDirectionState = "minecraft:cardinal_direction";

export function refreshFaceIoTopology(block: Block): void {
  computerHost.observeExternalWork(
    { lane: "topology", deterministicUnits: machineFaces.length },
    () => refreshFaceIoTopologyBounded(block),
  );
}

function refreshFaceIoTopologyBounded(block: Block): void {
  const localObservation = identityService().atPhysicalKey(blockKey(block));
  const localDirection = machineDirection(block);
  if (localObservation === undefined) return;
  if (
    localDirection === undefined ||
    computerHost.get(localObservation.computerId) === undefined
  ) {
    computerHost.serial.disconnectComputer(
      localObservation.computerId,
      "local_topology_unavailable",
    );
    computerHost.peripherals.clearComputer(localObservation.computerId);
    return;
  }

  for (const face of machineFaces) {
    const worldDirection = worldDirectionForMachineFace(face, localDirection);
    const neighbor = adjacent(block, worldDirection);
    if (neighbor === undefined || !isComputerSystemBlock(neighbor.typeId)) {
      computerHost.serial.disconnect(
        { computerId: localObservation.computerId, face },
        neighbor === undefined ? "neighbor_chunk_unavailable" : "no_neighbor",
      );
      continue;
    }
    const neighborObservation = identityService().atPhysicalKey(
      blockKey(neighbor),
    );
    const neighborDirection = machineDirection(neighbor);
    if (
      neighborObservation === undefined ||
      neighborDirection === undefined ||
      computerHost.get(neighborObservation.computerId) === undefined
    ) {
      computerHost.serial.disconnect(
        { computerId: localObservation.computerId, face },
        "neighbor_unavailable",
      );
      continue;
    }
    const neighborFace = machineFaceForWorldDirection(
      oppositeWorldDirection(worldDirection),
      neighborDirection,
    );
    computerHost.serial.connect(
      { computerId: localObservation.computerId, face },
      { computerId: neighborObservation.computerId, face: neighborFace },
    );
  }
}

export function isComputerSystemBlock(typeId: string): boolean {
  return (
    typeId === "computer_system:portable_computer_block" ||
    typeId.startsWith("computer_system:computer_") ||
    typeId.startsWith("computer_system:advanced_computer_")
  );
}

function machineDirection(block: Block): MachineCardinalDirection | undefined {
  const value = block.permutation.getState(cardinalDirectionState);
  return value === "east" ||
    value === "north" ||
    value === "south" ||
    value === "west"
    ? value
    : undefined;
}

function adjacent(
  block: Block,
  direction: MachineWorldDirection,
): Block | undefined {
  switch (direction) {
    case "down":
      return block.below();
    case "east":
      return block.east();
    case "north":
      return block.north();
    case "south":
      return block.south();
    case "up":
      return block.above();
    case "west":
      return block.west();
  }
}

function blockKey(block: Block): string {
  return `${block.dimension.id}|${block.x},${block.y},${block.z}`;
}
