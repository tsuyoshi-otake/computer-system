import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

import { parseBehaviorPackConfig } from "./behavior-pack-config.mjs";

import {
  computerBlockIdentifier,
  computerFamilies,
  createComputerBlock,
} from "./computer-block.mjs";
import {
  computerItemFamilies,
  computerItemIdentifier,
  createComputerItem,
} from "./computer-item.mjs";

import {
  createRedstoneInterfaceBlock,
  redstoneInterfaceIdentifier,
} from "./redstone-interface-block.mjs";
import {
  createRedstoneProbeBlock,
  redstoneProbeIdentifier,
} from "./redstone-probe-block.mjs";
import { createPortableComputerItem } from "./portable-computer-item.mjs";
import {
  createPortableComputerBlock,
  portableComputerBlockIdentifier,
} from "./portable-computer-block.mjs";
import { createFloppyItem } from "./floppy-item.mjs";
import {
  createMachineBlockGeometry,
  createMachineBlockTextureAtlas,
  createMachineBlockTextures,
} from "./machine-block-assets.mjs";
import {
  createMachineItemTexture,
  createMachineItemTextureAtlas,
  machineTextureSources,
} from "./machine-textures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolveOutputRoot(process.env.COMPUTER_SYSTEM_PACK_OUTPUT);
const acceptanceFixtureBuild = parseAcceptanceFixtureBuild(
  process.env.COMPUTER_SYSTEM_ACCEPTANCE_FIXTURE,
);
const managedBdsBuild = parseManagedBdsBuild(
  process.env.COMPUTER_SYSTEM_MANAGED_BDS,
);
const behaviorPackConfig = parseBehaviorPackConfig(
  JSON.parse(
    await readFile(
      path.join(root, "packs", "behavior", "config", "computer-system.json"),
      "utf8",
    ),
  ),
);
const behaviorOutput = path.join(outputRoot, "behavior_pack");
const resourceOutput = path.join(outputRoot, "resource_pack");

await rm(outputRoot, { force: true, recursive: true });
await mkdir(path.join(behaviorOutput, "scripts"), { recursive: true });

await Promise.all([
  cp(path.join(root, "packs", "behavior"), behaviorOutput, {
    recursive: true,
  }),
  cp(path.join(root, "packs", "resource"), resourceOutput, {
    recursive: true,
  }),
]);

if (managedBdsBuild) {
  await addManagedBdsDependencies(path.join(behaviorOutput, "manifest.json"));
}

const generatedBlocksDirectory = path.join(behaviorOutput, "blocks");
const generatedItemsDirectory = path.join(behaviorOutput, "items");
await mkdir(generatedBlocksDirectory, { recursive: true });
await mkdir(generatedItemsDirectory, { recursive: true });
await mkdir(path.join(resourceOutput, "ui"), { recursive: true });
await mkdir(path.join(resourceOutput, "textures", "items"), {
  recursive: true,
});
await mkdir(path.join(resourceOutput, "textures", "blocks"), {
  recursive: true,
});
await mkdir(path.join(resourceOutput, "models", "blocks"), {
  recursive: true,
});
await writeFile(
  path.join(
    generatedBlocksDirectory,
    `${portableComputerBlockIdentifier.split(":")[1]}.json`,
  ),
  `${JSON.stringify(createPortableComputerBlock(), null, 2)}\n`,
  "utf8",
);
await Promise.all(
  computerFamilies.flatMap((family) =>
    Array.from({ length: 64 }, async (_, mask) => {
      const identifier = computerBlockIdentifier(family, mask).split(":")[1];
      await writeFile(
        path.join(generatedBlocksDirectory, `${identifier}.json`),
        `${JSON.stringify(createComputerBlock(family, mask), null, 2)}\n`,
        "utf8",
      );
    }),
  ),
);
await Promise.all(
  computerItemFamilies.map(async (family) => {
    const identifier = computerItemIdentifier(family).split(":")[1];
    await writeFile(
      path.join(generatedItemsDirectory, `${identifier}.json`),
      `${JSON.stringify(createComputerItem(family), null, 2)}\n`,
      "utf8",
    );
  }),
);
await writeFile(
  path.join(generatedItemsDirectory, "portable_computer.json"),
  `${JSON.stringify(createPortableComputerItem(), null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(generatedItemsDirectory, "floppy_disk.json"),
  `${JSON.stringify(createFloppyItem(), null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resourceOutput, "textures", "item_texture.json"),
  `${JSON.stringify(createMachineItemTextureAtlas(), null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resourceOutput, "textures", "terrain_texture.json"),
  `${JSON.stringify(createMachineBlockTextureAtlas(), null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(resourceOutput, "models", "blocks", "computer_system.geo.json"),
  `${JSON.stringify(createMachineBlockGeometry(), null, 2)}\n`,
  "utf8",
);
await Promise.all(
  Object.entries(createMachineBlockTextures()).map(
    async ([textureKey, contents]) => {
      await writeFile(
        path.join(resourceOutput, "textures", "blocks", `${textureKey}.png`),
        contents,
      );
    },
  ),
);
await writeFile(
  path.join(resourceOutput, "textures", "items", "floppy_disk.png"),
  await readFile(path.join(root, "tools", "assets", "floppy-disk.png")),
);
await Promise.all(
  Object.values(machineTextureSources).map(async (filename) => {
    const source = await readFile(
      path.join(root, "web", "assets", "machines", filename),
    );
    await writeFile(
      path.join(resourceOutput, "textures", "items", filename),
      createMachineItemTexture(source),
    );
  }),
);
await Promise.all(
  Array.from({ length: 64 }, async (_, mask) => {
    const identifier = redstoneProbeIdentifier(mask).split(":")[1];
    await writeFile(
      path.join(generatedBlocksDirectory, `${identifier}.json`),
      `${JSON.stringify(createRedstoneProbeBlock(mask), null, 2)}\n`,
      "utf8",
    );
  }),
);
await Promise.all(
  Array.from({ length: 16 }, async (_, power) => {
    const identifier = redstoneInterfaceIdentifier(power).split(":")[1];
    await writeFile(
      path.join(generatedBlocksDirectory, `${identifier}.json`),
      `${JSON.stringify(createRedstoneInterfaceBlock(power), null, 2)}\n`,
      "utf8",
    );
  }),
);

await build({
  bundle: true,
  define: {
    __CS_ACCEPTANCE_FIXTURE__: JSON.stringify(acceptanceFixtureBuild),
    __CS_COLLECT_MICROARCHITECTURE_STATS_BY_DEFAULT__: JSON.stringify(
      behaviorPackConfig.collectMicroarchitectureStatsByDefault,
    ),
    __CS_GUEST_REALTIME_DIVISOR__: JSON.stringify(
      behaviorPackConfig.guestRealtimeDivisor,
    ),
  },
  entryPoints: [
    path.join(
      root,
      "src",
      "bedrock",
      managedBdsBuild ? "managedMain.ts" : "main.ts",
    ),
  ],
  external: [
    "@minecraft/server",
    "@minecraft/server-ui",
    ...(managedBdsBuild
      ? ["@minecraft/server-admin", "@minecraft/server-net"]
      : []),
  ],
  format: "esm",
  jsx: "automatic",
  jsxImportSource: "@bedrock-core/ui",
  logLevel: "info",
  outfile: path.join(behaviorOutput, "scripts", "main.js"),
  platform: "neutral",
  sourcemap: true,
  target: "es2022",
});

for (const manifestPath of [
  path.join(behaviorOutput, "manifest.json"),
  path.join(resourceOutput, "manifest.json"),
]) {
  JSON.parse(await readFile(manifestPath, "utf8"));
}

console.log(`Built feasibility packs in ${outputRoot}`);

function resolveOutputRoot(value) {
  if (value === undefined) return path.join(root, "dist");
  if (!path.isAbsolute(value)) {
    throw new Error("COMPUTER_SYSTEM_PACK_OUTPUT must be an absolute path.");
  }
  const resolved = path.resolve(value);
  const temporaryRoot = path.resolve(os.homedir(), "tmp");
  const relative = path.relative(temporaryRoot, resolved);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      "COMPUTER_SYSTEM_PACK_OUTPUT must be a child of the user tmp directory.",
    );
  }
  return resolved;
}

function parseAcceptanceFixtureBuild(value) {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("COMPUTER_SYSTEM_ACCEPTANCE_FIXTURE must be 0 or 1.");
}

function parseManagedBdsBuild(value) {
  if (value === undefined || value === "0") return false;
  if (value === "1") return true;
  throw new Error("COMPUTER_SYSTEM_MANAGED_BDS must be 0 or 1.");
}

async function addManagedBdsDependencies(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!Array.isArray(manifest.dependencies)) {
    throw new Error("Behavior-pack manifest dependencies must be an array.");
  }
  const managedDependencies = [
    {
      module_name: "@minecraft/server-admin",
      version: "1.0.0-beta",
    },
    {
      module_name: "@minecraft/server-net",
      version: "1.0.0-beta",
    },
  ];
  for (const dependency of managedDependencies) {
    if (
      manifest.dependencies.some(
        (candidate) => candidate?.module_name === dependency.module_name,
      )
    ) {
      throw new Error(
        `Authored behavior-pack manifest must not declare managed-only dependency ${dependency.module_name}.`,
      );
    }
    manifest.dependencies.push(dependency);
  }
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}
