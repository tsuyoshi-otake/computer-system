import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  createFloppyItem,
  floppyItemIdentifier,
} from "../../tools/floppy-item.mjs";
import { floppyTextureKey } from "../../tools/machine-textures.mjs";

describe("Floppy Disk item generator", () => {
  it("creates one non-stackable 1.44 MB medium item", () => {
    const item = createFloppyItem()["minecraft:item"];
    expect(item.description.identifier).toBe(floppyItemIdentifier);
    expect(item.components["minecraft:max_stack_size"]).toBe(1);
    expect(item.components["minecraft:display_name"]).toEqual({
      value: "Floppy Disk (1.44 MB)",
    });
    expect(item.components["minecraft:icon"]).toBe(floppyTextureKey);
  });

  it("ships the authored transparent 256px RGBA icon", async () => {
    const icon = await readFile("tools/assets/floppy-disk.png");
    expect([...icon.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(icon.readUInt32BE(16)).toBe(256);
    expect(icon.readUInt32BE(20)).toBe(256);
    expect(icon[24]).toBe(8);
    expect(icon[25]).toBe(6);
    expect(icon.length).toBeLessThan(1_000_000);
  });
});
