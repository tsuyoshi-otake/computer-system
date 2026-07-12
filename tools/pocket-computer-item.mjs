import { deflateSync } from "node:zlib";

export const pocketComputerIdentifier = "computer_system:pocket_computer";
export const pocketComputerTextureKey = pocketComputerIdentifier;

export function createPocketComputerItem() {
  return {
    format_version: "1.21.90",
    "minecraft:item": {
      description: {
        identifier: pocketComputerIdentifier,
        menu_category: { category: "items" },
      },
      components: {
        "computer_system:pocket_computer": {},
        "minecraft:display_name": { value: "Pocket Computer" },
        "minecraft:food": {
          can_always_eat: true,
          nutrition: 0,
          saturation_modifier: 0,
        },
        "minecraft:icon": pocketComputerTextureKey,
        "minecraft:max_stack_size": 1,
        "minecraft:use_animation": "drink",
        "minecraft:use_modifiers": {
          use_duration: 0.05,
          movement_modifier: 1,
        },
      },
    },
  };
}

export function createPocketComputerTextureAtlas() {
  return {
    resource_pack_name: "computer_system",
    texture_name: "atlas.items",
    texture_data: {
      [pocketComputerTextureKey]: {
        textures: "textures/items/pocket_computer",
      },
    },
  };
}

export function createPocketComputerTexture() {
  const rows = [
    "................",
    "...DDDDDDDDDD...",
    "..DYYYYYYYYYYD..",
    ".DYKKKKKKKKKKYD.",
    ".DYKGGGGGGGGKYD.",
    ".DYKGKKKKKKGKYD.",
    ".DYKGKKKKKKGKYD.",
    ".DYKGKKKKKKGKYD.",
    ".DYKGGGGGGGGKYD.",
    ".DYKKKKKKKKKKYD.",
    ".DYYYYYYYYYYYYD.",
    "..DDDDDDDDDDDD..",
    "....D......D....",
    "...DD......DD...",
    "................",
    "................",
  ];
  const palette = {
    ".": [0, 0, 0, 0],
    D: [55, 58, 64, 255],
    G: [87, 166, 78, 255],
    K: [17, 17, 17, 255],
    Y: [242, 178, 51, 255],
  };
  const scanlines = rows.map((row) =>
    Buffer.concat([
      Buffer.from([0]),
      ...[...row].map((pixel) => Buffer.from(palette[pixel])),
    ]),
  );
  const header = Buffer.alloc(13);
  header.writeUInt32BE(16, 0);
  header.writeUInt32BE(16, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.concat(scanlines))),
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
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}
