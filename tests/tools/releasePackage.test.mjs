import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import { packageRelease } from "../../tools/package-release.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const ownedRoots = [];

describe("release package builder", () => {
  afterEach(async () => {
    await Promise.all(
      ownedRoots
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("builds deterministic mcpack and mcaddon archives without development files", async () => {
    const fixture = await createFixture();
    const version = "0.1.0-alpha.1";
    const first = await packageRelease({ ...fixture, version });
    const firstContents = await readOutputs(first);
    const second = await packageRelease({ ...fixture, version });
    const secondContents = await readOutputs(second);

    expect(first.files).toEqual([
      "computer-system-0.1.0-alpha.1.mcaddon",
      "computer-system-behavior-0.1.0-alpha.1.mcpack",
      "computer-system-resource-0.1.0-alpha.1.mcpack",
      "SHA256SUMS.txt",
    ]);
    expect(hashes(firstContents)).toEqual(hashes(secondContents));

    const behavior = readZip(
      firstContents.get("computer-system-behavior-0.1.0-alpha.1.mcpack"),
    );
    expect([...behavior.keys()]).toEqual(["manifest.json", "scripts/main.js"]);
    expect([...behavior.keys()]).not.toEqual(
      expect.arrayContaining(["CLAUDE.md", "scripts/main.js.map"]),
    );

    const resource = readZip(
      firstContents.get("computer-system-resource-0.1.0-alpha.1.mcpack"),
    );
    expect([...resource.keys()]).toEqual([
      "manifest.json",
      "textures/pixel.png",
    ]);
    expect([...resource.keys()]).not.toContain("CLAUDE.md");

    const addon = readZip(
      firstContents.get("computer-system-0.1.0-alpha.1.mcaddon"),
    );
    expect([...addon.keys()]).toEqual([
      "computer-system-behavior-0.1.0-alpha.1.mcpack",
      "computer-system-resource-0.1.0-alpha.1.mcpack",
    ]);
    expect(
      readZip(addon.get("computer-system-behavior-0.1.0-alpha.1.mcpack")).has(
        "manifest.json",
      ),
    ).toBe(true);
    expect(
      readZip(addon.get("computer-system-resource-0.1.0-alpha.1.mcpack")).has(
        "manifest.json",
      ),
    ).toBe(true);

    const checksums = firstContents.get("SHA256SUMS.txt").toString("utf8");
    for (const name of first.files.filter(
      (name) => name !== "SHA256SUMS.txt",
    )) {
      expect(checksums).toContain(
        `${createHash("sha256")
          .update(firstContents.get(name))
          .digest("hex")}  ${name}`,
      );
    }
  });

  it("rejects unsupported files and output outside dist", async () => {
    const fixture = await createFixture();
    await writeFile(path.join(fixture.behaviorRoot, ".env"), "secret", "utf8");
    await expect(
      packageRelease({ ...fixture, version: "0.1.0-alpha.1" }),
    ).rejects.toThrow("Unsupported release file");
    await expect(
      packageRelease({
        ...fixture,
        outputRoot: path.join(root, "release-outside-dist"),
        version: "0.1.0-alpha.1",
      }),
    ).rejects.toThrow("must be a child of");
  });
});

async function createFixture() {
  const fixtureRoot = path.join(
    root,
    "dist",
    `release-test-${String(process.pid)}-${randomUUID()}`,
  );
  ownedRoots.push(fixtureRoot);
  const behaviorRoot = path.join(fixtureRoot, "behavior");
  const resourceRoot = path.join(fixtureRoot, "resource");
  const outputRoot = path.join(fixtureRoot, "release");
  await Promise.all([
    mkdir(path.join(behaviorRoot, "scripts"), { recursive: true }),
    mkdir(path.join(resourceRoot, "textures"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(path.join(behaviorRoot, "manifest.json"), "{}\n", "utf8"),
    writeFile(path.join(behaviorRoot, "CLAUDE.md"), "private\n", "utf8"),
    writeFile(path.join(behaviorRoot, "scripts", "main.js"), "export {};\n"),
    writeFile(path.join(behaviorRoot, "scripts", "main.js.map"), "{}\n"),
    writeFile(path.join(resourceRoot, "manifest.json"), "{}\n", "utf8"),
    writeFile(path.join(resourceRoot, "CLAUDE.md"), "private\n", "utf8"),
    writeFile(
      path.join(resourceRoot, "textures", "pixel.png"),
      Buffer.from([1]),
    ),
  ]);
  return { behaviorRoot, outputRoot, resourceRoot };
}

async function readOutputs(result) {
  return new Map(
    await Promise.all(
      result.files.map(async (name) => [
        name,
        await readFile(path.join(result.outputRoot, name)),
      ]),
    ),
  );
}

function hashes(contents) {
  return [...contents].map(([name, value]) => [
    name,
    createHash("sha256").update(value).digest("hex"),
  ]);
}

function readZip(archive) {
  const endSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const endOffset = archive.lastIndexOf(endSignature);
  if (endOffset < 0) throw new Error("ZIP end record is missing.");
  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("ZIP central entry is invalid.");
    }
    const compression = archive.readUInt16LE(centralOffset + 10);
    const compressedSize = archive.readUInt32LE(centralOffset + 20);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive
      .subarray(centralOffset + 46, centralOffset + 46 + nameLength)
      .toString("utf8");
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("ZIP local entry is invalid.");
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(
      dataOffset,
      dataOffset + compressedSize,
    );
    if (compression !== 8) throw new Error("Unexpected ZIP compression.");
    entries.set(name, inflateRawSync(compressed));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
