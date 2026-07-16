import {
  createCardinalDirectionPermutations,
  machineBlockGeometryIds,
  machinePlacementTraits,
  machineBlockTextureKeys,
} from "./machine-block-assets.mjs";

export const portableComputerBlockIdentifier =
  "computer_system:portable_computer_block";

export function createPortableComputerBlock() {
  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: portableComputerBlockIdentifier,
        menu_category: { category: "none" },
        traits: machinePlacementTraits,
      },
      components: {
        "computer_system:portable_computer_block": {},
        "minecraft:destructible_by_explosion": { explosion_resistance: 3 },
        "minecraft:destructible_by_mining": { seconds_to_destroy: 0.75 },
        "minecraft:geometry": machineBlockGeometryIds.portable_computer,
        "minecraft:loot": "loot_tables/blocks/computer_empty.json",
        "minecraft:material_instances": {
          "*": {
            render_method: "opaque",
            texture: machineBlockTextureKeys.case,
          },
          case: {
            render_method: "opaque",
            texture: machineBlockTextureKeys.case,
          },
          portable_keyboard: {
            render_method: "opaque",
            texture: machineBlockTextureKeys.portable_keyboard,
          },
          portable_screen: {
            render_method: "opaque",
            texture: machineBlockTextureKeys.portable_screen,
          },
        },
      },
      permutations: createCardinalDirectionPermutations(),
    },
  };
}
