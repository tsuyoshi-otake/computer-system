import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..", "..");

describe("managed BDS build profile", () => {
  it("adds Beta networking only to the managed output and leaves the authored pack stable", async () => {
    const temporaryParent = path.join(os.homedir(), "tmp");
    await mkdir(temporaryParent, { recursive: true });
    const testRoot = await mkdtemp(
      path.join(temporaryParent, "computer-system-managed-build-"),
    );
    const normalOutput = path.join(testRoot, "normal");
    const managedOutput = path.join(testRoot, "managed");
    try {
      await Promise.all([
        runBuild(normalOutput, false),
        runBuild(managedOutput, true),
      ]);
      const [authored, normal, managed, normalBundle, managedBundle] =
        await Promise.all([
          readJson(
            path.join(projectRoot, "packs", "behavior", "manifest.json"),
          ),
          readJson(path.join(normalOutput, "behavior_pack", "manifest.json")),
          readJson(path.join(managedOutput, "behavior_pack", "manifest.json")),
          readFile(
            path.join(normalOutput, "behavior_pack", "scripts", "main.js"),
            "utf8",
          ),
          readFile(
            path.join(managedOutput, "behavior_pack", "scripts", "main.js"),
            "utf8",
          ),
        ]);

      for (const manifest of [authored, normal]) {
        expect(
          moduleDependency(manifest, "@minecraft/server-admin"),
        ).toBeUndefined();
        expect(
          moduleDependency(manifest, "@minecraft/server-net"),
        ).toBeUndefined();
      }
      expect(moduleDependency(managed, "@minecraft/server-admin")).toEqual({
        module_name: "@minecraft/server-admin",
        version: "1.0.0-beta",
      });
      expect(moduleDependency(managed, "@minecraft/server-net")).toEqual({
        module_name: "@minecraft/server-net",
        version: "1.0.0-beta",
      });
      expect(normalBundle).not.toContain("@minecraft/server-net");
      expect(managedBundle).toContain("@minecraft/server-net");
      expect(managedBundle).toContain("@minecraft/server-admin");
    } finally {
      await rm(testRoot, { force: true, recursive: true });
    }
  }, 120_000);
});

async function runBuild(outputRoot, managed) {
  await execFileAsync(
    process.execPath,
    [path.join(projectRoot, "tools", "build.mjs")],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        COMPUTER_SYSTEM_ACCEPTANCE_FIXTURE: "0",
        COMPUTER_SYSTEM_MANAGED_BDS: managed ? "1" : "0",
        COMPUTER_SYSTEM_PACK_OUTPUT: outputRoot,
        COMPUTER_SYSTEM_RUNTIME_WORKERS: managed ? "2" : undefined,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 110_000,
      windowsHide: true,
    },
  );
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

function moduleDependency(manifest, moduleName) {
  return manifest.dependencies.find(
    (dependency) => dependency.module_name === moduleName,
  );
}
