import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import {
  createFloppyItem,
  floppyItemIdentifier,
} from "../../tools/floppy-item.mjs";
import { floppyTextureKey } from "../../tools/machine-textures.mjs";

describe("Floppy Disk item generator", () => {
  it("creates one non-stackable 1.44 MB medium item", () => {
    const item = createFloppyItem()["minecraft:item"];
    expect(item.description.identifier).toBe(floppyItemIdentifier);
    expect(item.components["minecraft:max_stack_size"]).toBe(1);
    expect(item.components["minecraft:display_name"]).toEqual({
      value: "Floppy Disk (1.44 MB)",
    });
    expect(item.components["minecraft:icon"]).toBe(floppyTextureKey);
  });

  it("ships the authored transparent 256px RGBA icon", async () => {
    const icon = await readFile("tools/assets/floppy-disk.png");
    expect([...icon.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(icon.readUInt32BE(16)).toBe(256);
    expect(icon.readUInt32BE(20)).toBe(256);
    expect(icon[24]).toBe(8);
    expect(icon[25]).toBe(6);
    expect(icon.length).toBeLessThan(1_000_000);
    const pixels = decodeRgbaPng(icon, 256, 256);
    expect(alphaAt(pixels, 256, 0, 0)).toBe(0);
    expect(alphaAt(pixels, 256, 255, 255)).toBe(0);
    expect(alphaAt(pixels, 256, 128, 128)).toBe(255);
  });
});

function decodeRgbaPng(texture, width, height) {
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
  const filtered = inflateSync(Buffer.concat(compressed));
  const rowBytes = width * 4;
  const pixels = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const filter = filtered[y * (rowBytes + 1)];
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = filtered[y * (rowBytes + 1) + x + 1];
      const left = x >= 4 ? pixels[y * rowBytes + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * rowBytes + x] : 0;
      const upLeft = y > 0 && x >= 4 ? pixels[(y - 1) * rowBytes + x - 4] : 0;
      pixels[y * rowBytes + x] =
        filter === 0
          ? encoded
          : filter === 1
            ? encoded + left
            : filter === 2
              ? encoded + up
              : filter === 3
                ? encoded + Math.floor((left + up) / 2)
                : encoded + paeth(left, up, upLeft);
    }
  }
  return pixels;
}

function alphaAt(pixels, width, x, y) {
  return pixels[(y * width + x) * 4 + 3];
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}
