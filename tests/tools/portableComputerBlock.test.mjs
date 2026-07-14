import { describe, expect, it } from "vitest";

import {
  createCardinalDirectionPermutations,
  machineBlockGeometryIds,
  machinePlacementTraits,
  machineBlockTextureKeys,
} from "../../tools/machine-block-assets.mjs";
import {
  createPortableComputerBlock,
  portableComputerBlockIdentifier,
} from "../../tools/portable-computer-block.mjs";

describe("portable computer block", () => {
  it("uses the open-laptop geometry and identity-carrying adapter component", () => {
    const block = createPortableComputerBlock()["minecraft:block"];

    expect(block.description.identifier).toBe(portableComputerBlockIdentifier);
    expect(block.description.traits).toEqual(machinePlacementTraits);
    expect(block.permutations).toEqual(createCardinalDirectionPermutations());
    expect(block.components["computer_system:portable_computer_block"]).toEqual(
      {},
    );
    expect(block.components["minecraft:geometry"]).toBe(
      machineBlockGeometryIds.portable_computer,
    );
    expect(
      block.components["minecraft:material_instances"].portable_keyboard
        .texture,
    ).toBe(machineBlockTextureKeys.portable_keyboard);
    expect(
      block.components["minecraft:material_instances"].portable_screen.texture,
    ).toBe(machineBlockTextureKeys.portable_screen);
  });
});
