export const pocketComputerIdentifier = "computer_system:pocket_computer";

export function createPocketComputerItem() {
  return {
    format_version: "1.21.90",
    "minecraft:item": {
      description: {
        identifier: pocketComputerIdentifier,
        menu_category: { category: "items" },
      },
      components: {
        "computer_system:pocket_computer": {},
        "minecraft:display_name": { value: "Pocket Computer" },
        "minecraft:durability": { max_durability: 1 },
        "minecraft:icon": "clock",
        "minecraft:max_stack_size": 1,
      },
    },
  };
}
