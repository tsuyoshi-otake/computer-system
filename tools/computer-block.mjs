import {
  createCardinalDirectionPermutations,
  machineBlockGeometryIds,
  machinePlacementTraits,
  machineBlockTextureKeys,
} from "./machine-block-assets.mjs";

export const computerFamilies = ["computer", "advanced_computer"];
export const computerRedstoneFaces = [
  "down",
  "east",
  "north",
  "south",
  "up",
  "west",
];

export function computerBlockIdentifier(family, mask) {
  requireFamily(family);
  requireMask(mask);
  return `computer_system:${family}_${String(mask).padStart(2, "0")}`;
}

export function createComputerBlock(family, mask) {
  requireFamily(family);
  requireMask(mask);
  const connectedFaces = computerRedstoneFaces.filter(
    (_face, bit) => (mask & (1 << bit)) !== 0,
  );
  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: computerBlockIdentifier(family, mask),
        menu_category: { category: "none" },
        traits: machinePlacementTraits,
      },
      components: {
        "computer_system:computer": { family },
        "minecraft:destructible_by_explosion": { explosion_resistance: 6 },
        "minecraft:destructible_by_mining": { seconds_to_destroy: 1.5 },
        "minecraft:geometry": machineBlockGeometryIds[family],
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
          computer_front: {
            render_method: "opaque",
            texture: machineBlockTextureKeys.computer_front,
          },
          advanced_computer_front: {
            render_method: "opaque",
            texture: machineBlockTextureKeys.advanced_computer_front,
          },
        },
        "minecraft:redstone_conductivity": { redstone_conductor: false },
        "minecraft:redstone_consumer": { min_power: 0 },
        ...(connectedFaces.length === 0
          ? {}
          : {
              "minecraft:redstone_producer": {
                connected_faces: connectedFaces,
                power: 15,
                transform_relative: false,
              },
            }),
      },
      permutations: createCardinalDirectionPermutations(),
    },
  };
}

function requireFamily(family) {
  if (!computerFamilies.includes(family)) {
    throw new RangeError(`Unknown computer family: ${family}`);
  }
}

function requireMask(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 63) {
    throw new RangeError(`Computer output mask must be from 0 to 63: ${mask}`);
  }
}
