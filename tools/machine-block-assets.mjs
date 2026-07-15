import { encodeRgbaPng } from "./machine-textures.mjs";

export const machineBlockGeometryIds = {
  advanced_computer: "geometry.computer_system.advanced_computer",
  computer: "geometry.computer_system.computer",
  monitor: "geometry.computer_system.monitor",
  portable_computer: "geometry.computer_system.portable_computer",
};

export const machineBlockTextureKeys = {
  case: "computer_system_machine_case",
  computer_front: "computer_system_computer_front",
  advanced_computer_front: "computer_system_advanced_computer_front",
  monitor_front: "computer_system_monitor_front",
  portable_keyboard: "computer_system_portable_keyboard",
  portable_screen: "computer_system_portable_screen",
};

export const machinePlacementTraits = {
  "minecraft:placement_direction": {
    enabled_states: ["minecraft:cardinal_direction"],
  },
};

export function createCardinalDirectionPermutations() {
  return [
    cardinalDirectionPermutation("north", 0),
    cardinalDirectionPermutation("south", 180),
    cardinalDirectionPermutation("west", 90),
    cardinalDirectionPermutation("east", -90),
  ];
}

const textureSize = 16;
const faces = ["down", "east", "north", "south", "up", "west"];

export function createMachineBlockTextureAtlas() {
  return {
    resource_pack_name: "computer_system",
    texture_name: "atlas.terrain",
    padding: 8,
    num_mip_levels: 4,
    texture_data: Object.fromEntries(
      Object.values(machineBlockTextureKeys).map((key) => [
        key,
        { textures: `textures/blocks/${key}` },
      ]),
    ),
  };
}

export function createMachineBlockTextures() {
  return {
    [machineBlockTextureKeys.case]: texture(caseTexture()),
    [machineBlockTextureKeys.computer_front]: texture(
      computerFrontTexture(false),
    ),
    [machineBlockTextureKeys.advanced_computer_front]: texture(
      computerFrontTexture(true),
    ),
    [machineBlockTextureKeys.monitor_front]: texture(monitorFrontTexture()),
    [machineBlockTextureKeys.portable_keyboard]: texture(
      portableKeyboardTexture(),
    ),
    [machineBlockTextureKeys.portable_screen]: texture(portableScreenTexture()),
  };
}

export function createMachineBlockGeometry() {
  return {
    format_version: "1.19.30",
    "minecraft:geometry": [
      geometry(
        machineBlockGeometryIds.computer,
        desktopCubes("computer_front"),
      ),
      geometry(
        machineBlockGeometryIds.advanced_computer,
        desktopCubes("advanced_computer_front"),
      ),
      geometry(machineBlockGeometryIds.monitor, [
        cube([-7, 2, -5], [14, 12, 10], "case"),
        cube([-6.5, 2.5, -5.5], [13, 11, 0.5], "monitor_front"),
        cube([-2, 1, -1], [4, 1, 2], "case"),
        cube([-5, 0, -3], [10, 1, 6], "case"),
      ]),
      geometry(machineBlockGeometryIds.portable_computer, [
        cube([-7, 0, -6], [14, 2, 12], "case"),
        cube([-6.5, 2, -5.5], [13, 0.5, 11], "portable_keyboard"),
        cube([-7, 2, 4], [14, 10, 1], "case"),
        cube([-6, 3, 3.5], [12, 8, 0.5], "portable_screen"),
      ]),
    ],
  };
}

function desktopCubes(frontMaterial) {
  return [
    cube([-7.75, 0, -7.25], [15.5, 16, 14.5], "case"),
    cube([-6.75, 0.5, -7.75], [13.5, 15, 0.5], frontMaterial),
  ];
}

function cardinalDirectionPermutation(direction, yRotation) {
  return {
    condition: `query.block_state('minecraft:cardinal_direction') == '${direction}'`,
    components: {
      "minecraft:transformation": { rotation: [0, yRotation, 0] },
    },
  };
}

function geometry(identifier, cubes) {
  return {
    description: {
      identifier,
      texture_width: textureSize,
      texture_height: textureSize,
      visible_bounds_width: 2,
      visible_bounds_height: 2.5,
      visible_bounds_offset: [0, 0.75, 0],
    },
    bones: [{ name: "root", pivot: [0, 0, 0], rotation: [0, 180, 0], cubes }],
  };
}

function cube(origin, size, materialInstance) {
  return {
    origin,
    size,
    uv: Object.fromEntries(
      faces.map((face) => [
        face,
        {
          material_instance: materialInstance,
          uv: [0, 0],
          uv_size: [textureSize, textureSize],
        },
      ]),
    ),
  };
}

function caseTexture() {
  const canvas = createCanvas([211, 202, 187, 255]);
  rectangle(canvas, 0, 0, 16, 1, [237, 230, 214, 255]);
  rectangle(canvas, 0, 15, 16, 1, [151, 145, 137, 255]);
  for (let y = 2; y < 15; y += 4) {
    for (let x = (y / 2) % 3; x < 16; x += 5) {
      pixel(canvas, x, y, [199, 190, 176, 255]);
    }
  }
  return canvas;
}

function computerFrontTexture(advanced) {
  const canvas = caseTexture();
  if (advanced) {
    drive(canvas, 2, 2);
    drive(canvas, 2, 6);
  } else {
    drive(canvas, 2, 3);
  }
  rectangle(canvas, 11, advanced ? 10 : 8, 2, 2, [82, 82, 79, 255]);
  pixel(canvas, 11, advanced ? 10 : 8, [231, 224, 195, 255]);
  for (let y = 12; y <= 14; y += 2) {
    for (let x = 2; x <= 12; x += 2) {
      rectangle(canvas, x, y, 1, 1, [119, 116, 111, 255]);
    }
  }
  return canvas;
}

function drive(canvas, x, y) {
  rectangle(canvas, x, y, 11, 3, [109, 106, 101, 255]);
  rectangle(canvas, x + 1, y + 1, 8, 1, [43, 44, 43, 255]);
  pixel(canvas, x + 9, y + 1, [221, 214, 191, 255]);
}

function monitorFrontTexture() {
  const canvas = caseTexture();
  rectangle(canvas, 1, 1, 14, 12, [156, 150, 141, 255]);
  rectangle(canvas, 2, 2, 12, 10, [8, 12, 13, 255]);
  rectangle(canvas, 3, 3, 10, 8, [3, 7, 8, 255]);
  rectangle(canvas, 4, 5, 1, 1, [218, 218, 203, 255]);
  rectangle(canvas, 6, 5, 3, 1, [218, 218, 203, 255]);
  rectangle(canvas, 4, 7, 5, 1, [176, 185, 170, 255]);
  rectangle(canvas, 3, 13, 8, 1, [119, 116, 111, 255]);
  pixel(canvas, 13, 13, [79, 91, 72, 255]);
  return canvas;
}

function portableKeyboardTexture() {
  const canvas = createCanvas([202, 194, 181, 255]);
  for (let y = 2; y <= 10; y += 2) {
    for (let x = 1; x <= 14; x += 2) {
      rectangle(canvas, x, y, 1, 1, [98, 96, 93, 255]);
    }
  }
  rectangle(canvas, 3, 12, 7, 2, [149, 143, 135, 255]);
  rectangle(canvas, 11, 12, 3, 3, [173, 164, 151, 255]);
  pixel(canvas, 12, 13, [83, 81, 79, 255]);
  return canvas;
}

function portableScreenTexture() {
  const canvas = createCanvas([10, 14, 15, 255]);
  rectangle(canvas, 1, 1, 14, 14, [2, 6, 7, 255]);
  rectangle(canvas, 3, 4, 1, 1, [220, 220, 207, 255]);
  rectangle(canvas, 5, 4, 4, 1, [220, 220, 207, 255]);
  rectangle(canvas, 3, 6, 7, 1, [169, 181, 163, 255]);
  return canvas;
}

function createCanvas(color) {
  const canvas = Buffer.alloc(textureSize * textureSize * 4);
  for (let offset = 0; offset < canvas.length; offset += 4) {
    canvas.set(color, offset);
  }
  return canvas;
}

function rectangle(canvas, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      pixel(canvas, column, row, color);
    }
  }
}

function pixel(canvas, x, y, color) {
  const offset = (y * textureSize + x) * 4;
  canvas.set(color, offset);
}

function texture(rgba) {
  return encodeRgbaPng(textureSize, textureSize, rgba);
}
