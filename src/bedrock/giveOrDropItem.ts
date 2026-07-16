import {
  EntityComponentTypes,
  type ItemStack,
  type Player,
} from "@minecraft/server";

/** One bounded inventory insertion with an explicit world-drop fallback. */
export function giveOrDropItem(player: Player, item: ItemStack): void {
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const remainder = inventory === undefined ? item : inventory.addItem(item);
  if (remainder !== undefined)
    player.dimension.spawnItem(remainder, player.location);
}
