import { readFile } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  createMachineItemTexture,
  createMachineItemTextureAtlas,
  floppyTextureKey,
  machineTextureKeys,
  machineTextureSources,
} from "../../tools/machine-textures.mjs";

const sourceDirectory = path.resolve("web/assets/machines");

describe("authored machine textures", () => {
  it("maps every machine family into the shared item atlas", () => {
    expect(createMachineItemTextureAtlas()).toEqual({
      resource_pack_name: "computer_system",
      texture_name: "atlas.items",
      texture_data: {
        ...Object.fromEntries(
          Object.entries(machineTextureKeys).map(([family, key]) => [
            key,
            {
              textures: `textures/items/${machineTextureSources[family].replace(/\.png$/u, "")}`,
            },
          ]),
        ),
        [floppyTextureKey]: { textures: "textures/items/floppy_disk" },
      },
    });
  });

  it.each(Object.entries(machineTextureSources))(
    "converts the bounded %s illustration into a transparent 256px item icon",
    async (_family, filename) => {
      const source = await readFile(path.join(sourceDirectory, filename));
      const texture = createMachineItemTexture(source);

      expect([...texture.subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      expect(texture.readUInt32BE(16)).toBe(256);
      expect(texture.readUInt32BE(20)).toBe(256);
      expect(texture[24]).toBe(8);
      expect(texture[25]).toBe(6);

      const pixels = inflateRgbaPixels(texture);
      expect(pixels[4]).toBe(0);
      expect(hasOpaquePixel(pixels, 256, 256)).toBe(true);
    },
  );

  it("rejects untrusted or unsupported source data explicitly", () => {
    expect(() => createMachineItemTexture(Buffer.from("not a png"))).toThrow(
      "not a PNG",
    );
  });
});

function inflateRgbaPixels(texture) {
  const chunks = [];
  let offset = 8;
  while (offset < texture.length) {
    const length = texture.readUInt32BE(offset);
    const type = texture.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      chunks.push(texture.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  return inflateSync(Buffer.concat(chunks));
}

function hasOpaquePixel(scanlines, width, height) {
  const stride = width * 4 + 1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (scanlines[y * stride + 1 + x * 4 + 3] === 255) return true;
    }
  }
  return false;
}
