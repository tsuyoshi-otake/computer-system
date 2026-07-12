export const monitorIdentifier = "computer_system:monitor";

export function createMonitorBlock() {
  return {
    format_version: "1.26.0",
    "minecraft:block": {
      description: {
        identifier: monitorIdentifier,
        menu_category: { category: "construction" },
      },
      components: {
        "computer_system:monitor": {},
        "minecraft:destructible_by_explosion": { explosion_resistance: 6 },
        "minecraft:destructible_by_mining": { seconds_to_destroy: 1.5 },
        "minecraft:geometry": "minecraft:geometry.full_block",
        "minecraft:material_instances": {
          "*": { render_method: "opaque", texture: "black_concrete" },
        },
      },
    },
  };
}
