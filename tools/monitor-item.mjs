import { machineTextureKeys } from "./machine-textures.mjs";
import { monitorIdentifier } from "./monitor-block.mjs";

export const monitorDisplayName = "Monitor";

export function createMonitorItem() {
  return {
    format_version: "1.21.90",
    "minecraft:item": {
      description: {
        identifier: monitorIdentifier,
        menu_category: { category: "items" },
      },
      components: {
        "minecraft:block_placer": {
          block: monitorIdentifier,
          replace_block_item: true,
        },
        "minecraft:display_name": { value: monitorDisplayName },
        "minecraft:icon": machineTextureKeys.monitor,
      },
    },
  };
}
