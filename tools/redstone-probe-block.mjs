export const redstoneFaces = ["down", "east", "north", "south", "up", "west"];

export function createRedstoneProbeBlock(mask) {
  if (!Number.isInteger(mask) || mask < 0 || mask > 63) {
    throw new RangeError(
      `Redstone output mask must be an integer from 0 to 63: ${mask}`,
    );
  }

  const producer =
    mask === 0
      ? {
          "minecraft:redstone_consumer": {
            min_power: 0,
          },
          "minecraft:custom_components": ["computer_system:redstone_probe"],
        }
      : {
          "minecraft:redstone_producer": {
            connected_faces: redstoneFaces.filter(
              (_face, bit) => (mask & (1 << bit)) !== 0,
            ),
            power: 15,
            transform_relative: false,
          },
        };

  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: redstoneProbeIdentifier(mask),
        menu_category: { category: "none" },
      },
      components: {
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": {
          "*": { render_method: "opaque", texture: "stone" },
        },
        "minecraft:redstone_conductivity": {
          redstone_conductor: false,
        },
        ...producer,
      },
    },
  };
}

export function redstoneProbeIdentifier(mask) {
  return `computer_system:redstone_probe_${String(mask).padStart(2, "0")}`;
}
