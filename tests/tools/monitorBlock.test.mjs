import { describe, expect, it } from "vitest";

import {
  createMonitorBlock,
  monitorIdentifier,
} from "../../tools/monitor-block.mjs";
import {
  createCardinalDirectionPermutations,
  machineBlockGeometryIds,
  machinePlacementTraits,
  machineBlockTextureKeys,
} from "../../tools/machine-block-assets.mjs";

describe("monitor block", () => {
  it("uses a current direct custom-component key", () => {
    const block = createMonitorBlock()["minecraft:block"];
    expect(block.description.identifier).toBe(monitorIdentifier);
    expect(block.description.traits).toEqual(machinePlacementTraits);
    expect(block.permutations).toEqual(createCardinalDirectionPermutations());
    expect(block.components["computer_system:monitor"]).toEqual({});
    expect(block.components["minecraft:geometry"]).toBe(
      machineBlockGeometryIds.monitor,
    );
    expect(
      block.components["minecraft:material_instances"].monitor_front.texture,
    ).toBe(machineBlockTextureKeys.monitor_front);
  });
});
