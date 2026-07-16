import { machineTextureKeys } from "./machine-textures.mjs";

export const portableComputerIdentifier = "computer_system:portable_computer";
export const portableComputerTextureKey = machineTextureKeys.portable_computer;
export const portableComputerDisplayName = "Portable Computer System";

export function createPortableComputerItem() {
  return {
    format_version: "1.21.90",
    "minecraft:item": {
      description: {
        identifier: portableComputerIdentifier,
        menu_category: { category: "items" },
      },
      components: {
        "computer_system:portable_computer": {},
        "minecraft:display_name": { value: portableComputerDisplayName },
        "minecraft:icon": portableComputerTextureKey,
        "minecraft:interact_button": "Open Terminal",
        "minecraft:max_stack_size": 1,
      },
    },
  };
}
