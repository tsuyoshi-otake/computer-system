import { describe, expect, it } from "vitest";

import {
  computerBlockIdentifier,
  computerFamilies,
  computerRedstoneFaces,
  createComputerBlock,
} from "../../tools/computer-block.mjs";

describe("computer block generator", () => {
  it("generates two families with every independent digital output mask", () => {
    for (const family of computerFamilies) {
      for (let mask = 0; mask < 64; mask += 1) {
        const block = createComputerBlock(family, mask)["minecraft:block"];
        const producer = block.components["minecraft:redstone_producer"];
        expect(block.description.identifier).toBe(
          computerBlockIdentifier(family, mask),
        );
        expect(producer?.connected_faces ?? []).toEqual(
          computerRedstoneFaces.filter(
            (_face, bit) => (mask & (1 << bit)) !== 0,
          ),
        );
        expect(block.components["computer_system:computer"]).toEqual({
          family,
        });
        expect(block.description.menu_category.category).toBe("none");
      }
    }
  });

  it("rejects invalid masks and families", () => {
    expect(() => createComputerBlock("computer", 64)).toThrow(/0 to 63/u);
    expect(() => createComputerBlock("unknown", 0)).toThrow(/family/u);
  });
});
