import { inflateSync } from "node:zlib";

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
      size: [15.5, 6, 14.5],
    });
    expect(desktop.bones[0].cubes[2]).toMatchObject({
      origin: [-7, 5, -6.5],
      size: [14, 11, 13],
    });
    expect(desktop.bones[0].cubes[3]).toMatchObject({
      origin: [-6, 6.25, -6.5625],
      size: [12, 9, 0.0625],
    });
    expect(Object.values(machineBlockGeometryIds)).not.toContain(
      "geometry.computer_system.monitor",
    );
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

  it("matches the integrated desktop artwork with compact 3.5-inch drives", () => {
    const textures = createMachineBlockTextures();
    const computer = textures[machineBlockTextureKeys.computer_front];
    const advanced = textures[machineBlockTextureKeys.advanced_computer_front];

    expect(pixelAt(computer, 5, 2)).toEqual([109, 106, 101, 255]);
    expect(pixelAt(computer, 6, 3)).toEqual([43, 44, 43, 255]);
    expect(pixelAt(advanced, 5, 2)).toEqual([109, 106, 101, 255]);
    expect(pixelAt(advanced, 5, 6)).toEqual([109, 106, 101, 255]);
    expect(pixelAt(computer, 1, 3)).toEqual([231, 224, 195, 255]);
    expect(pixelAt(advanced, 1, 3)).toEqual([231, 224, 195, 255]);
    expect(pixelAt(computer, 3, 4)).toEqual([79, 91, 72, 255]);
    expect(pixelAt(advanced, 3, 4)).toEqual([79, 91, 72, 255]);
    expect(pixelAt(computer, 2, 2)).toEqual([211, 202, 187, 255]);
    expect(pixelAt(advanced, 2, 6)).toEqual([211, 202, 187, 255]);
    expect(pixelAt(computer, 11, 8)).toEqual([211, 202, 187, 255]);
    expect(pixelAt(advanced, 11, 10)).toEqual([211, 202, 187, 255]);
  });
});

function pixelAt(texture, x, y) {
  const compressed = [];
  let offset = 8;
  while (offset < texture.length) {
    const length = texture.readUInt32BE(offset);
    const type = texture.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      compressed.push(texture.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const scanlines = inflateSync(Buffer.concat(compressed));
  const pixel = y * (16 * 4 + 1) + 1 + x * 4;
  return [...scanlines.subarray(pixel, pixel + 4)];
}
