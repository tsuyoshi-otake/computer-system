export function createRedstoneInterfaceBlock(power) {
  if (!Number.isInteger(power) || power < 0 || power > 15) {
    throw new RangeError(
      `Redstone Interface power must be an integer from 0 to 15: ${power}`,
    );
  }

  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: redstoneInterfaceIdentifier(power),
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
        ...(power === 0
          ? {}
          : {
              "minecraft:redstone_producer": {
                connected_faces: ["east"],
                power,
                transform_relative: false,
              },
            }),
      },
    },
  };
}

export function redstoneInterfaceIdentifier(power) {
  return `computer_system:redstone_interface_${String(power).padStart(2, "0")}`;
}
