import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const ownershipMarkers = new Map([
  [".github/workflows/CLAUDE.md", "`pages: read`"],
  ["docs/benchmarks/CLAUDE.md", "modeled guest cost"],
  ["packs/resource/ui/core-ui/CLAUDE.md", "protocol-v0007"],
  ["site/manual/CLAUDE.md", "`popstate`"],
  [
    "src/adapters/storage/CLAUDE.md",
    "current and previous complete generations",
  ],
  ["src/application/computer/CLAUDE.md", "one Dynamic Property"],
  ["src/application/editor/CLAUDE.md", "Save/Discard/Cancel"],
  ["src/application/io/CLAUDE.md", "O(1) deque"],
  ["src/application/os/CLAUDE.md", "`/etc/passwd`"],
  ["src/application/runtime/CLAUDE.md", "`pythonCs486.ts`"],
  ["src/application/terminal/CLAUDE.md", "one writer per Computer"],
  ["src/application/toolchain/CLAUDE.md", "`CS486OBJ`"],
  ["src/bedrock/probes/CLAUDE.md", "`linux_authentication/PASS`"],
  ["src/domain/cpu/CLAUDE.md", "`CpuMemoryHierarchy`"],
  ["src/domain/filesystem/CLAUDE.md", "disguised Promises"],
  ["src/domain/storage/CLAUDE.md", "3,600 RPM"],
  ["tests/tools/CLAUDE.md", "recursively validates"],
  ["tools/CLAUDE.md", "`BDS_MCP_WORKDIR`"],
  ["web/CLAUDE.md", "`manual.js` is the only authored source"],
  ["web/assets/machines/CLAUDE.md", "isometric plates"],
]);

describe("scoped Claude guidance", () => {
  it("keeps every instruction file focused and below the recommended size", async () => {
    const guidancePaths = await discoverGuidance();

    expect(guidancePaths.length).toBeGreaterThan(70);
    for (const relativePath of guidancePaths) {
      const guidance = await read(relativePath);

      expect(guidance, relativePath).toMatch(/^# /u);
      expect(lineCount(guidance), relativePath).toBeLessThanOrEqual(200);
      expect(guidance, relativePath).not.toMatch(/^\s*@.*CLAUDE\.md\s*$/gmu);
    }
  });

  it("indexes each scope from its nearest ancestor instead of flattening the root", async () => {
    const guidancePaths = await discoverGuidance();
    const guidanceSet = new Set(guidancePaths);
    const expectedByParent = new Map(
      guidancePaths.map((relativePath) => [relativePath, []]),
    );

    for (const relativePath of guidancePaths) {
      if (relativePath === "CLAUDE.md") continue;

      const childDirectory = path.posix.dirname(relativePath);
      const parentPath = nearestAncestorGuidance(childDirectory, guidanceSet);
      const parentDirectory =
        parentPath === "CLAUDE.md" ? "" : path.posix.dirname(parentPath);
      const scope = path.posix.relative(parentDirectory, childDirectory);
      const target = path.posix.relative(parentDirectory, relativePath);
      expectedByParent.get(parentPath).push(`${scope}/|${target}`);
    }

    for (const [parentPath, expected] of expectedByParent) {
      const { entries, guidanceLinkCount } = declaredChildScopes(
        await read(parentPath),
      );
      expect(guidanceLinkCount, `${parentPath} child-scope links`).toBe(
        entries.length,
      );
      expect(
        new Set(entries).size,
        `${parentPath} duplicate child scopes`,
      ).toBe(entries.length);
      expect(entries.sort(), parentPath).toEqual(expected.sort());
    }
  });

  it("recognizes only formal child-scope table rows", () => {
    const parsed = declaredChildScopes(`
## Child scopes

| Child scope | Responsibility |
| --- | --- |
| [\`computer/\`](computer/CLAUDE.md) | Aggregate owner |

Do not use \`orphan/\` as an ownership scope.
`);

    expect(parsed.entries).toEqual(["computer/|computer/CLAUDE.md"]);
    expect(parsed.guidanceLinkCount).toBe(1);
  });

  it("excludes only intentional generated or dependency directories", () => {
    expect(shouldExcludeDirectory(".git")).toBe(true);
    expect(shouldExcludeDirectory("dist")).toBe(true);
    expect(shouldExcludeDirectory("packages/ui/node_modules")).toBe(true);
    expect(
      shouldExcludeDirectory("vendor/bedrock-core-ui-0.9.2/compiled"),
    ).toBe(true);
    expect(shouldExcludeDirectory("src/toolchain/compiled")).toBe(false);
    expect(shouldExcludeDirectory("packages/docs/dist")).toBe(false);
  });

  it("keeps high-risk contracts in the directory that owns their implementation", async () => {
    for (const [relativePath, marker] of ownershipMarkers) {
      expect(await read(relativePath), relativePath).toContain(marker);
    }
  });
});

async function discoverGuidance() {
  const found = [];
  await walk("", found);
  return found.sort();
}

async function walk(relativeDirectory, found) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const relativePath = normalize(path.join(relativeDirectory, entry.name));
    if (entry.isSymbolicLink()) {
      if (shouldExcludeDirectory(relativePath)) continue;
      const target = await stat(path.join(root, relativePath));
      if (target.isDirectory() || entry.name === "CLAUDE.md") {
        throw new Error(`Symlink can hide scoped guidance: ${relativePath}`);
      }
      continue;
    }
    if (entry.isDirectory()) {
      if (!shouldExcludeDirectory(relativePath))
        await walk(relativePath, found);
      continue;
    }
    if (entry.isFile() && entry.name === "CLAUDE.md") found.push(relativePath);
  }
}

function declaredChildScopes(guidance) {
  const heading = /^## Child scopes\s*$/mu.exec(guidance);
  if (heading === null) return { entries: [], guidanceLinkCount: 0 };

  const remainder = guidance.slice(heading.index + heading[0].length);
  const nextHeading = /\n## /u.exec(remainder);
  const section =
    nextHeading === null ? remainder : remainder.slice(0, nextHeading.index);
  const entries = [
    ...section.matchAll(
      /^\|\s*\[`([^`]+\/)`\]\(([^)\s]+\/CLAUDE\.md)\)\s*\|[^|\r\n]+\|\s*$/gmu,
    ),
  ].map((match) => `${match[1]}|${match[2]}`);
  const guidanceLinkCount = [...section.matchAll(/\]\([^)\r\n]*CLAUDE\.md\)/gu)]
    .length;
  return { entries, guidanceLinkCount };
}

function shouldExcludeDirectory(relativePath) {
  const normalized = normalize(relativePath);
  return (
    normalized === ".git" ||
    normalized === "dist" ||
    normalized.split("/").includes("node_modules") ||
    normalized === "vendor/bedrock-core-ui-0.9.2/compiled"
  );
}

function nearestAncestorGuidance(childDirectory, guidanceSet) {
  let ancestor = path.posix.dirname(childDirectory);
  while (true) {
    const candidate = ancestor === "." ? "CLAUDE.md" : `${ancestor}/CLAUDE.md`;
    if (guidanceSet.has(candidate)) return candidate;
    if (ancestor === ".")
      throw new Error(`No ancestor CLAUDE.md for ${childDirectory}`);
    ancestor = path.posix.dirname(ancestor);
  }
}

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function lineCount(value) {
  return value.replace(/\r\n/gu, "\n").replace(/\n$/u, "").split("\n").length;
}

function normalize(value) {
  return value.replaceAll("\\", "/");
}
