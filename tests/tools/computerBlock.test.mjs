import { describe, expect, it } from "vitest";

import {
  computerBlockIdentifier,
  computerFamilies,
  computerRedstoneFaces,
  createComputerBlock,
} from "../../tools/computer-block.mjs";
import {
  createCardinalDirectionPermutations,
  createMachineBlockGeometry,
  machineBlockGeometryIds,
  machinePlacementTraits,
  machineBlockTextureKeys,
} from "../../tools/machine-block-assets.mjs";

describe("computer block generator", () => {
  it("keeps Bedrock placement headings stable and flips only the Resource Pack geometry", () => {
    expect(createCardinalDirectionPermutations()).toEqual([
      permutation("north", 0),
      permutation("south", 180),
      permutation("west", 90),
      permutation("east", -90),
    ]);
    const geometries = createMachineBlockGeometry()["minecraft:geometry"];
    expect(geometries).toHaveLength(3);
    for (const geometry of geometries) {
      expect(geometry.bones).toHaveLength(1);
      expect(geometry.bones[0].rotation).toEqual([0, 180, 0]);
    }
  });

  it("generates two families with every independent digital output mask", () => {
    for (const family of computerFamilies) {
      for (let mask = 0; mask < 64; mask += 1) {
        const block = createComputerBlock(family, mask)["minecraft:block"];
        const producer = block.components["minecraft:redstone_producer"];
        const consumer = block.components["minecraft:redstone_consumer"];
        expect(block.description.identifier).toBe(
          computerBlockIdentifier(family, mask),
        );
        expect(producer?.connected_faces ?? []).toEqual(
          computerRedstoneFaces.filter(
            (_face, bit) => (mask & (1 << bit)) !== 0,
          ),
        );
        expect(consumer).toBeUndefined();
        expect(block.components["computer_system:computer"]).toEqual({
          family,
        });
        expect(block.description.menu_category.category).toBe("none");
        expect(block.description.traits).toEqual(machinePlacementTraits);
        expect(block.permutations).toEqual(
          createCardinalDirectionPermutations(),
        );
        expect(block.components["minecraft:geometry"]).toBe(
          machineBlockGeometryIds[family],
        );
        const front =
          family === "advanced_computer"
            ? "advanced_computer_front"
            : "computer_front";
        expect(
          block.components["minecraft:material_instances"][front].texture,
        ).toBe(machineBlockTextureKeys[front]);
        expect(
          block.components["minecraft:material_instances"].desktop_screen,
        ).toEqual({
          render_method: "opaque",
          texture: machineBlockTextureKeys.desktop_screen,
        });
      }
    }
  });

  it("rejects invalid masks and families", () => {
    expect(() => createComputerBlock("computer", 64)).toThrow(/0 to 63/u);
    expect(() => createComputerBlock("unknown", 0)).toThrow(/family/u);
  });
});

function permutation(direction, rotation) {
  return {
    condition: `query.block_state('minecraft:cardinal_direction') == '${direction}'`,
    components: {
      "minecraft:transformation": { rotation: [0, rotation, 0] },
    },
  };
}
