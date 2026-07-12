import { describe, expect, it } from "vitest";

import {
  createRedstoneProbeBlock,
  redstoneFaces,
  redstoneProbeIdentifier,
} from "../../tools/redstone-probe-block.mjs";

describe("redstone probe block generator", () => {
  it("generates every independent digital face mask", () => {
    for (let mask = 0; mask < 64; mask += 1) {
      const block = createRedstoneProbeBlock(mask)["minecraft:block"];
      const producer = block.components["minecraft:redstone_producer"];
      const expectedFaces = redstoneFaces.filter(
        (_face, bit) => (mask & (1 << bit)) !== 0,
      );

      expect(block.description.identifier).toBe(redstoneProbeIdentifier(mask));
      expect(producer?.connected_faces ?? []).toEqual(expectedFaces);
      expect(producer?.power ?? 0).toBe(mask === 0 ? 0 : 15);
      expect(block.description).not.toHaveProperty("states");
      expect(block).not.toHaveProperty("permutations");
    }
  });
});
