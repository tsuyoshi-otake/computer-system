import { describe, expect, it } from "vitest";

import {
  createRedstoneInterfaceBlock,
  redstoneInterfaceIdentifier,
} from "../../tools/redstone-interface-block.mjs";

describe("redstone interface block generator", () => {
  it("generates every analog power without experimental block states", () => {
    for (let power = 0; power < 16; power += 1) {
      const block = createRedstoneInterfaceBlock(power)["minecraft:block"];
      const producer = block.components["minecraft:redstone_producer"];

      expect(block.description.identifier).toBe(
        redstoneInterfaceIdentifier(power),
      );
      expect(producer?.connected_faces ?? []).toEqual(
        power === 0 ? [] : ["east"],
      );
      expect(producer?.power ?? 0).toBe(power);
      expect(block.description).not.toHaveProperty("states");
      expect(block).not.toHaveProperty("permutations");
    }
  });
});
