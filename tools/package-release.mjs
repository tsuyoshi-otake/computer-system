import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(root, "dist");
const maximumArchiveBytes = 100 * 1024 * 1024;
const maximumArchiveEntries = 4_096;
const allowedPackExtensions = new Set([".js", ".json", ".lang", ".png"]);
const excludedReleaseFiles = new Set(["CLAUDE.md"]);
const versionPattern =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export async function packageRelease({
  behaviorRoot = path.join(distRoot, "behavior_pack"),
  outputRoot = path.join(distRoot, "release"),
  resourceRoot = path.join(distRoot, "resource_pack"),
  version,
} = {}) {
  const releaseVersion = version ?? (await readProjectVersion());
  if (!versionPattern.test(releaseVersion)) {
    throw new Error(`Invalid release version: ${String(releaseVersion)}`);
  }

  const safeOutputRoot = requireDistChild(outputRoot, "Release output");
  const safeBehaviorRoot = requireDistChild(behaviorRoot, "Behavior Pack");
  const safeResourceRoot = requireDistChild(resourceRoot, "Resource Pack");
  await rm(safeOutputRoot, { force: true, recursive: true });
  await mkdir(safeOutputRoot, { recursive: true });

  const [behaviorEntries, resourceEntries] = await Promise.all([
    collectPackEntries(safeBehaviorRoot),
    collectPackEntries(safeResourceRoot),
  ]);
  requireManifest(behaviorEntries, "Behavior Pack");
  requireManifest(resourceEntries, "Resource Pack");

  const behaviorName = `computer-system-behavior-${releaseVersion}.mcpack`;
  const resourceName = `computer-system-resource-${releaseVersion}.mcpack`;
  const addonName = `computer-system-${releaseVersion}.mcaddon`;
  const behaviorArchive = createZip(behaviorEntries);
  const resourceArchive = createZip(resourceEntries);
  const addonArchive = createZip([
    { contents: behaviorArchive, name: behaviorName },
    { contents: resourceArchive, name: resourceName },
  ]);

  const archives = [
    [addonName, addonArchive],
    [behaviorName, behaviorArchive],
    [resourceName, resourceArchive],
  ];
  for (const [name, contents] of archives) {
    await writeFile(path.join(safeOutputRoot, name), contents);
  }

  const checksumName = "SHA256SUMS.txt";
  const checksums = archives
    .map(
      ([name, contents]) =>
        `${createHash("sha256").update(contents).digest("hex")}  ${name}`,
    )
    .sort()
    .join("\n");
  await writeFile(
    path.join(safeOutputRoot, checksumName),
    `${checksums}\n`,
    "utf8",
  );

  return {
    behaviorEntries: behaviorEntries.map(({ name }) => name),
    files: [...archives.map(([name]) => name), checksumName],
    outputRoot: safeOutputRoot,
    resourceEntries: resourceEntries.map(({ name }) => name),
    version: releaseVersion,
  };
}

export function createZip(entries) {
  if (entries.length === 0 || entries.length > maximumArchiveEntries) {
    throw new Error(
      `ZIP entry count must be between 1 and ${String(maximumArchiveEntries)}.`,
    );
  }

  const normalizedEntries = entries
    .map(({ contents, name }) => ({
      contents: Buffer.from(contents),
      name: normalizeArchivePath(name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const names = new Set();
  let uncompressedBytes = 0;
  for (const entry of normalizedEntries) {
    if (names.has(entry.name)) {
      throw new Error(`Duplicate ZIP entry: ${entry.name}`);
    }
    names.add(entry.name);
    uncompressedBytes += entry.contents.length;
  }
  if (uncompressedBytes > maximumArchiveBytes) {
    throw new Error(`ZIP input exceeds ${String(maximumArchiveBytes)} bytes.`);
  }

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;
  for (const entry of normalizedEntries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.contents, { level: 9 });
    const checksum = crc32(entry.contents);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.contents.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.contents.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralParts.push(central, name);
    localOffset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalizedEntries.length, 8);
  end.writeUInt16LE(normalizedEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

async function collectPackEntries(packRoot) {
  const entries = [];
  await visit("");
  if (entries.length > maximumArchiveEntries) {
    throw new Error(
      `Pack contains more than ${String(maximumArchiveEntries)} files.`,
    );
  }
  return entries.sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );

  async function visit(relativeDirectory) {
    const directory = path.join(packRoot, relativeDirectory);
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const relativePath = path.join(relativeDirectory, child.name);
      if (child.isSymbolicLink()) {
        throw new Error(
          `Release packs cannot contain symlinks: ${relativePath}`,
        );
      }
      if (child.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (!child.isFile()) {
        throw new Error(`Unsupported release entry: ${relativePath}`);
      }
      if (excludedReleaseFiles.has(child.name) || child.name.endsWith(".map")) {
        continue;
      }
      if (
        child.name.startsWith(".") ||
        !allowedPackExtensions.has(path.extname(child.name).toLowerCase())
      ) {
        throw new Error(`Unsupported release file: ${relativePath}`);
      }
      entries.push({
        contents: await readFile(path.join(packRoot, relativePath)),
        name: relativePath.replaceAll(path.sep, "/"),
      });
    }
  }
}

function requireManifest(entries, label) {
  if (!entries.some(({ name }) => name === "manifest.json")) {
    throw new Error(`${label} is missing manifest.json.`);
  }
}

function requireDistChild(value, label) {
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${distRoot}${path.sep}`)) {
    throw new Error(`${label} must be a child of ${distRoot}.`);
  }
  return resolved;
}

function normalizeArchivePath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 512 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value
      .split("/")
      .some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`Invalid ZIP entry path: ${String(value)}`);
  }
  return value;
}

function crc32(contents) {
  let value = 0xffffffff;
  for (const byte of contents) {
    value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

async function readProjectVersion() {
  const packageJson = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  return packageJson.version;
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await packageRelease();
  console.log(
    `Packaged Computer System ${result.version} in ${result.outputRoot}`,
  );
}
