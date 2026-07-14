import { machineTextureKeys } from "./machine-textures.mjs";

export const computerItemFamilies = ["computer", "advanced_computer"];
export const computerItemDisplayNames = {
  computer: "Desktop Computer System",
  advanced_computer: "Advanced Desktop Computer System",
};

export function computerItemIdentifier(family) {
  requireFamily(family);
  return `computer_system:${family}_item`;
}

export function createComputerItem(family) {
  requireFamily(family);
  return {
    format_version: "1.21.90",
    "minecraft:item": {
      description: {
        identifier: computerItemIdentifier(family),
        menu_category: { category: "items" },
      },
      components: {
        "computer_system:computer_item": { family },
        "minecraft:display_name": {
          value: computerItemDisplayNames[family],
        },
        "minecraft:icon": machineTextureKeys[family],
        "minecraft:max_stack_size": 1,
      },
    },
  };
}

function requireFamily(family) {
  if (!computerItemFamilies.includes(family)) {
    throw new RangeError(`Unknown computer item family: ${family}`);
  }
}
