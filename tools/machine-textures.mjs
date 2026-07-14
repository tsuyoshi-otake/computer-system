import { deflateSync, inflateSync } from "node:zlib";

export const machineTextureSources = {
  advanced_computer: "cs-advanced-computer.png",
  computer: "cs-computer.png",
  monitor: "cs-monitor.png",
  portable_computer: "cs-portable-computer.png",
};

export const machineTextureKeys = {
  advanced_computer: "computer_system:advanced_computer",
  computer: "computer_system:computer",
  monitor: "computer_system:monitor",
  portable_computer: "computer_system:portable_computer",
};

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const outputSize = 256;
const outputPadding = 8;
const maximumSourceDimension = 4_096;

export function createMachineItemTextureAtlas() {
  return {
    resource_pack_name: "computer_system",
    texture_name: "atlas.items",
    texture_data: Object.fromEntries(
      Object.entries(machineTextureKeys).map(([family, key]) => [
        key,
        {
          textures: `textures/items/${machineTextureSources[family].replace(/\.png$/u, "")}`,
        },
      ]),
    ),
  };
}

/**
 * Converts one bounded 4-bit indexed source illustration into a transparent
 * 256x256 RGBA item icon. White is the source canvas, and nearest-neighbor
 * sampling preserves the authored pixel-art edges.
 */
export function createMachineItemTexture(source) {
  const indexed = decodeIndexedPng(source);
  const bounds = visibleBounds(indexed);
  const contentWidth = bounds.maxX - bounds.minX + 1;
  const contentHeight = bounds.maxY - bounds.minY + 1;
  const scale = Math.min(
    (outputSize - outputPadding * 2) / contentWidth,
    (outputSize - outputPadding * 2) / contentHeight,
  );
  const renderedWidth = Math.max(1, Math.floor(contentWidth * scale));
  const renderedHeight = Math.max(1, Math.floor(contentHeight * scale));
  const offsetX = Math.floor((outputSize - renderedWidth) / 2);
  const offsetY = Math.floor((outputSize - renderedHeight) / 2);
  const rgba = Buffer.alloc(outputSize * outputSize * 4);

  for (let y = 0; y < renderedHeight; y += 1) {
    const sourceY =
      bounds.minY +
      Math.min(
        Math.floor((y * contentHeight) / renderedHeight),
        contentHeight - 1,
      );
    for (let x = 0; x < renderedWidth; x += 1) {
      const sourceX =
        bounds.minX +
        Math.min(
          Math.floor((x * contentWidth) / renderedWidth),
          contentWidth - 1,
        );
      const paletteIndex = pixelIndex(indexed, sourceX, sourceY);
      const color = paletteColor(indexed, paletteIndex);
      if (isCanvasWhite(color)) continue;
      const destination = ((offsetY + y) * outputSize + offsetX + x) * 4;
      rgba[destination] = color.red;
      rgba[destination + 1] = color.green;
      rgba[destination + 2] = color.blue;
      rgba[destination + 3] = color.alpha;
    }
  }

  return encodeRgbaPng(outputSize, outputSize, rgba);
}

function decodeIndexedPng(source) {
  if (!Buffer.isBuffer(source) || !source.subarray(0, 8).equals(pngSignature)) {
    throw new Error("Machine texture source is not a PNG file.");
  }

  let offset = 8;
  let height;
  let palette;
  let transparency;
  let width;
  const compressed = [];
  while (offset < source.length) {
    if (offset + 12 > source.length) throw new Error("PNG chunk is truncated.");
    const length = source.readUInt32BE(offset);
    const type = source.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > source.length)
      throw new Error("PNG chunk exceeds source size.");
    const data = source.subarray(dataStart, dataEnd);
    const expectedCrc = source.readUInt32BE(dataEnd);
    const actualCrc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
    if (actualCrc !== expectedCrc)
      throw new Error(`PNG ${type} checksum is invalid.`);

    if (type === "IHDR") {
      if (length !== 13) throw new Error("PNG IHDR size is invalid.");
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (
        width <= 0 ||
        height <= 0 ||
        width > maximumSourceDimension ||
        height > maximumSourceDimension ||
        data[8] !== 4 ||
        data[9] !== 3 ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        throw new Error(
          "Machine texture must be a non-interlaced 4-bit indexed PNG up to 4096x4096.",
        );
      }
    } else if (type === "PLTE") {
      if (length === 0 || length % 3 !== 0 || length > 16 * 3) {
        throw new Error("Machine texture palette is invalid.");
      }
      palette = Buffer.from(data);
    } else if (type === "tRNS") {
      transparency = Buffer.from(data);
    } else if (type === "IDAT") {
      compressed.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (width === undefined || height === undefined || palette === undefined) {
    throw new Error("Machine texture is missing required PNG chunks.");
  }
  const rowBytes = Math.ceil(width / 2);
  const inflated = inflateSync(Buffer.concat(compressed), {
    maxOutputLength: (rowBytes + 1) * height,
  });
  if (inflated.length !== (rowBytes + 1) * height) {
    throw new Error("Machine texture pixel data has an unexpected size.");
  }

  return {
    height,
    palette,
    pixels: unfilter(inflated, rowBytes, height),
    rowBytes,
    transparency: transparency ?? Buffer.alloc(0),
    width,
  };
}

function unfilter(source, rowBytes, height) {
  const pixels = Buffer.alloc(rowBytes * height);
  let sourceOffset = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = source[sourceOffset++];
    if (filter === undefined || filter > 4)
      throw new Error("Unsupported PNG row filter.");
    const rowOffset = y * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const encoded = source[sourceOffset++];
      if (encoded === undefined) throw new Error("PNG scanline is truncated.");
      const left = x === 0 ? 0 : pixels[rowOffset + x - 1];
      const up = y === 0 ? 0 : pixels[rowOffset - rowBytes + x];
      const upLeft =
        y === 0 || x === 0 ? 0 : pixels[rowOffset - rowBytes + x - 1];
      const prediction =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upLeft);
      pixels[rowOffset + x] = (encoded + prediction) & 0xff;
    }
  }
  return pixels;
}

function visibleBounds(indexed) {
  const bounds = {
    maxX: -1,
    maxY: -1,
    minX: indexed.width,
    minY: indexed.height,
  };
  for (let y = 0; y < indexed.height; y += 1) {
    for (let x = 0; x < indexed.width; x += 1) {
      if (isCanvasWhite(paletteColor(indexed, pixelIndex(indexed, x, y))))
        continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) {
    throw new Error("Machine texture contains no visible pixels.");
  }
  return bounds;
}

function pixelIndex(indexed, x, y) {
  const packed = indexed.pixels[y * indexed.rowBytes + Math.floor(x / 2)];
  return x % 2 === 0 ? packed >>> 4 : packed & 0x0f;
}

function paletteColor(indexed, index) {
  const offset = index * 3;
  const red = indexed.palette[offset];
  const green = indexed.palette[offset + 1];
  const blue = indexed.palette[offset + 2];
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error("Machine texture references a missing palette color.");
  }
  return {
    alpha: indexed.transparency[index] ?? 255,
    blue,
    green,
    red,
  };
}

function isCanvasWhite(color) {
  return (
    color.alpha === 0 ||
    (color.red === 255 && color.green === 255 && color.blue === 255)
  );
}

export function encodeRgbaPng(width, height, rgba) {
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    rgba.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    pngSignature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, contents) {
  const typeBytes = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(contents.length + 12);
  chunk.writeUInt32BE(contents.length, 0);
  typeBytes.copy(chunk, 4);
  contents.copy(chunk, 8);
  chunk.writeUInt32BE(
    crc32(Buffer.concat([typeBytes, contents])),
    contents.length + 8,
  );
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}
