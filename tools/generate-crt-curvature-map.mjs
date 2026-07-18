import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

import { curvatureDisplacementChannels } from "../web/terminal-presentation.js";

export const crtCurvatureMapSize = 96;
export const crtCurvatureMapPath = fileURLToPath(
  new URL("../web/crt-curvature-map.png", import.meta.url),
);

export function buildCrtCurvatureMapPng(size = crtCurvatureMapSize) {
  if (!Number.isSafeInteger(size) || size < 2 || size > 256) {
    throw new RangeError("CRT curvature map size must be from 2 through 256");
  }
  const rowBytes = size * 4 + 1;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const channels = curvatureDisplacementChannels({
        x: (x + 0.5) / size,
        y: (y + 0.5) / size,
      });
      const pixelOffset = rowOffset + 1 + x * 4;
      raw[pixelOffset] = channelByte(channels.red);
      raw[pixelOffset + 1] = channelByte(channels.green);
      raw[pixelOffset + 2] = channelByte(channels.blue);
      raw[pixelOffset + 3] = 255;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function main() {
  await writeFile(crtCurvatureMapPath, buildCrtCurvatureMapPng());
}

function channelByte(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, checksum]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
