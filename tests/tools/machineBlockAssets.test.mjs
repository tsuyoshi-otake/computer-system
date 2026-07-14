import { describe, expect, it } from "vitest";

import {
  createMachineBlockGeometry,
  createMachineBlockTextureAtlas,
  createMachineBlockTextures,
  machineBlockGeometryIds,
  machineBlockTextureKeys,
} from "../../tools/machine-block-assets.mjs";

describe("machine block visual assets", () => {
  it("defines bounded custom geometry for every placeable machine", () => {
    const geometries = createMachineBlockGeometry()["minecraft:geometry"];

    expect(
      geometries.map(({ description }) => description.identifier).sort(),
    ).toEqual(Object.values(machineBlockGeometryIds).sort());
    for (const geometry of geometries) {
      expect(geometry.bones).toHaveLength(1);
      expect(geometry.bones[0].cubes.length).toBeGreaterThan(1);
      expect(geometry.bones[0].cubes.length).toBeLessThanOrEqual(4);
    }
    const desktop = geometries.find(
      ({ description }) =>
        description.identifier === machineBlockGeometryIds.computer,
    );
    expect(desktop.bones[0].cubes[0]).toMatchObject({
      origin: [-7.75, 0, -7.25],
      size: [15.5, 16, 14.5],
    });
  });

  it("generates a complete terrain atlas and opaque 16px pixel-art textures", () => {
    const textures = createMachineBlockTextures();
    const atlas = createMachineBlockTextureAtlas();

    expect(Object.keys(textures)).toEqual(
      Object.values(machineBlockTextureKeys),
    );
    expect(Object.keys(atlas.texture_data)).toEqual(
      Object.values(machineBlockTextureKeys),
    );
    for (const texture of Object.values(textures)) {
      expect([...texture.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      expect(texture.readUInt32BE(16)).toBe(16);
      expect(texture.readUInt32BE(20)).toBe(16);
      expect(texture[24]).toBe(8);
      expect(texture[25]).toBe(6);
    }
  });
});
