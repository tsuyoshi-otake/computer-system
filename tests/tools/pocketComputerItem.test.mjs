import { describe, expect, it } from "vitest";

import {
  createPocketComputerItem,
  createPocketComputerTexture,
  createPocketComputerTextureAtlas,
  pocketComputerIdentifier,
  pocketComputerTextureKey,
} from "../../tools/pocket-computer-item.mjs";

describe("pocket computer item", () => {
  it("is non-stackable and attaches the stable custom item component", () => {
    const item = createPocketComputerItem()["minecraft:item"];
    expect(item.description.identifier).toBe(pocketComputerIdentifier);
    expect(item.components["minecraft:max_stack_size"]).toBe(1);
    expect(item.components).not.toHaveProperty("minecraft:food");
    expect(item.components["minecraft:icon"]).toBe(pocketComputerTextureKey);
    expect(item.components["minecraft:interact_button"]).toBe("Open Terminal");
    expect(item.components).not.toHaveProperty("minecraft:use_animation");
    expect(item.components).not.toHaveProperty("minecraft:use_modifiers");
    expect(item.components["computer_system:pocket_computer"]).toEqual({});
  });

  it("generates a dedicated item atlas entry and valid 16x16 PNG", () => {
    expect(createPocketComputerTextureAtlas()).toMatchObject({
      texture_name: "atlas.items",
      texture_data: {
        [pocketComputerTextureKey]: {
          textures: "textures/items/pocket_computer",
        },
      },
    });
    const texture = createPocketComputerTexture();
    expect([...texture.subarray(0, 8)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10,
    ]);
    expect(texture.readUInt32BE(16)).toBe(16);
    expect(texture.readUInt32BE(20)).toBe(16);
  });
});
