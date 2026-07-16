import {
  createCardinalDirectionPermutations,
  machineBlockGeometryIds,
  machinePlacementTraits,
  machineBlockTextureKeys,
} from "./machine-block-assets.mjs";

export const monitorIdentifier = "computer_system:monitor";

export function createMonitorBlock() {
  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: monitorIdentifier,
        menu_category: { category: "construction" },
        traits: machinePlacementTraits,
      },
      components: {
        "computer_system:monitor": {},
        "minecraft:destructible_by_explosion": { explosion_resistance: 6 },
        "minecraft:destructible_by_mining": { seconds_to_destroy: 1.5 },
        "minecraft:geometry": machineBlockGeometryIds.monitor,
        "minecraft:material_instances": {
          "*": {
            render_method: "opaque",
            texture: machineBlockTextureKeys.case,
          },
          case: {
            render_method: "opaque",
            texture: machineBlockTextureKeys.case,
          },
          monitor_front: {
            render_method: "opaque",
            texture: machineBlockTextureKeys.monitor_front,
          },
        },
      },
      permutations: createCardinalDirectionPermutations(),
    },
  };
}
