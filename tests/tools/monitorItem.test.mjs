import { describe, expect, it } from "vitest";

import { machineTextureKeys } from "../../tools/machine-textures.mjs";
import { monitorIdentifier } from "../../tools/monitor-block.mjs";
import {
  createMonitorItem,
  monitorDisplayName,
} from "../../tools/monitor-item.mjs";

describe("monitor item generator", () => {
  it("places the Monitor block with its authored inventory texture", () => {
    const item = createMonitorItem()["minecraft:item"];

    expect(item.description.identifier).toBe(monitorIdentifier);
    expect(item.components["minecraft:block_placer"]).toEqual({
      block: monitorIdentifier,
      replace_block_item: true,
    });
    expect(item.components["minecraft:display_name"]).toEqual({
      value: monitorDisplayName,
    });
    expect(item.components["minecraft:icon"]).toBe(machineTextureKeys.monitor);
  });
});
