import { floppyTextureKey } from "./machine-textures.mjs";

export const floppyItemIdentifier = "computer_system:floppy_disk";

export function createFloppyItem() {
  return {
    format_version: "1.21.90",
    "minecraft:item": {
      description: {
        identifier: floppyItemIdentifier,
        menu_category: { category: "items" },
      },
      components: {
        "minecraft:display_name": { value: "Floppy Disk (1.44 MB)" },
        "minecraft:icon": floppyTextureKey,
        "minecraft:max_stack_size": 1,
      },
    },
  };
}
