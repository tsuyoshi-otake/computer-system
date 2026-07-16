import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const scopedGuidance = [
  ".github/CLAUDE.md",
  "docs/CLAUDE.md",
  "packs/CLAUDE.md",
  "site/CLAUDE.md",
  "src/CLAUDE.md",
  "src/adapters/storage/CLAUDE.md",
  "src/application/computer/CLAUDE.md",
  "src/application/display/CLAUDE.md",
  "src/application/editor/CLAUDE.md",
  "src/application/io/CLAUDE.md",
  "src/application/os/CLAUDE.md",
  "src/application/runtime/CLAUDE.md",
  "src/application/terminal/CLAUDE.md",
  "src/application/toolchain/CLAUDE.md",
  "src/bedrock/CLAUDE.md",
  "src/domain/CLAUDE.md",
  "src/phase0/CLAUDE.md",
  "tests/CLAUDE.md",
  "tools/CLAUDE.md",
  "vendor/bedrock-core-ui-0.9.2/CLAUDE.md",
  "web/CLAUDE.md",
];

const ownershipMarkers = new Map([
  [".github/CLAUDE.md", "`pages: read`"],
  ["site/CLAUDE.md", "cannot connect to BDS"],
  ["src/adapters/storage/CLAUDE.md", "one Dynamic Property"],
  ["src/application/editor/CLAUDE.md", "Save/Discard/Cancel"],
  ["src/application/io/CLAUDE.md", "O(1) deque"],
  ["src/application/os/CLAUDE.md", "`/etc/passwd`"],
  ["src/application/runtime/CLAUDE.md", "`pythonCs486.ts`"],
  ["src/application/terminal/CLAUDE.md", "one writer per Computer"],
  ["src/application/toolchain/CLAUDE.md", "`CS486OBJ`"],
  ["tools/CLAUDE.md", "`BDS_MCP_WORKDIR`"],
  ["web/CLAUDE.md", "`manual.js` is the only authored source"],
]);

describe("scoped Claude guidance", () => {
  it("keeps the root index concise and lazily scopes subsystem instructions", async () => {
    const rootGuidance = await read("CLAUDE.md");

    expect(lineCount(rootGuidance)).toBeLessThanOrEqual(200);
    expect(rootGuidance).not.toMatch(/^\s*@.*CLAUDE\.md\s*$/gmu);

    for (const relativePath of scopedGuidance) {
      const scope = `${path.dirname(relativePath).replaceAll("\\", "/")}/`;
      expect(rootGuidance).toContain(`\`${scope}\``);
    }
  });

  it("keeps every scoped instruction file focused and below the recommended size", async () => {
    for (const relativePath of scopedGuidance) {
      const guidance = await read(relativePath);

      expect(guidance, relativePath).toMatch(/^# /u);
      expect(lineCount(guidance), relativePath).toBeLessThanOrEqual(200);
    }
  });

  it("keeps high-risk contracts in the directory that owns their implementation", async () => {
    for (const [relativePath, marker] of ownershipMarkers) {
      expect(await read(relativePath), relativePath).toContain(marker);
    }
  });
});

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

function lineCount(value) {
  return value.replace(/\r\n/gu, "\n").replace(/\n$/u, "").split("\n").length;
}
