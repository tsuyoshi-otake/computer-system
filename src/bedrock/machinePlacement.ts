import { BlockPermutation, type Block, type Player } from "@minecraft/server";
import type { MachineCardinalDirection } from "../domain/computer/machineFace.js";

const cardinalDirectionState = "minecraft:cardinal_direction";

export function playerCardinalDirection(
  player: Pick<Player, "getViewDirection">,
): MachineCardinalDirection {
  const direction = player.getViewDirection();
  if (Math.abs(direction.x) > Math.abs(direction.z)) {
    return direction.x >= 0 ? "east" : "west";
  }
  return direction.z >= 0 ? "south" : "north";
}

export function placeMachineFacingPlayer(
  block: Block,
  typeId: string,
  player: Pick<Player, "getViewDirection">,
): void {
  block.setPermutation(
    BlockPermutation.resolve(typeId, {
      [cardinalDirectionState]: playerCardinalDirection(player),
    }),
  );
}

export function replaceMachinePreservingDirection(
  block: Block,
  typeId: string,
): void {
  const direction = block.permutation.getState(cardinalDirectionState);
  block.setPermutation(
    BlockPermutation.resolve(
      typeId,
      typeof direction === "string"
        ? { [cardinalDirectionState]: direction }
        : undefined,
    ),
  );
}
