import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultWebCompanionConfigPath,
  loadWebCompanionAdminConfig,
  resolveWebCompanionAdminOptions,
  saveWebCompanionAdminConfig,
  validateWebCompanionAdminConfig,
} from "../../tools/web-companion-admin-config.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("persistent Web companion administrator configuration", () => {
  it("uses a system-wide path with an explicit path override", () => {
    expect(
      defaultWebCompanionConfigPath({
        platform: "win32",
        environment: { ProgramData: "D:\\ProgramData" },
      }),
    ).toBe("D:\\ProgramData\\Computer System\\web-companion.json");
    expect(
      defaultWebCompanionConfigPath({
        platform: "linux",
        environment: {},
      }),
    ).toBe("/etc/computer-system/web-companion.json");
    expect(
      defaultWebCompanionConfigPath({
        platform: "linux",
        environment: { WEB_COMPANION_CONFIG_FILE: "" },
      }),
    ).toBeUndefined();
  });

  it("saves, replaces, and loads a validated configuration", async () => {
    const directory = await makeTemporaryDirectory();
    const configPath = path.join(directory, "web-companion.json");
    await saveWebCompanionAdminConfig(configPath, {
      port: "80",
      publicOrigin: "http://terminal.example.test",
    });
    await saveWebCompanionAdminConfig(configPath, {
      port: 8_080,
      publicOrigin: "https://terminal.example.test",
    });

    expect(await loadWebCompanionAdminConfig(configPath)).toEqual({
      version: 1,
      port: 8_080,
      publicOrigin: "https://terminal.example.test",
    });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      version: 1,
      port: 8_080,
      publicOrigin: "https://terminal.example.test",
    });
  });

  it("rejects unknown fields, invalid ports, and URL paths", () => {
    expect(() =>
      validateWebCompanionAdminConfig({ version: 1, bind: "0.0.0.0" }),
    ).toThrow(/Unknown/u);
    expect(() =>
      validateWebCompanionAdminConfig({ version: 1, port: 0 }),
    ).toThrow(/between 1 and 65534/u);
    expect(() =>
      validateWebCompanionAdminConfig({
        version: 1,
        publicOrigin: "https://example.test/terminal",
      }),
    ).toThrow(/absolute HTTP\(S\) origin/u);
  });

  it("gives environment variables precedence over persisted values", () => {
    expect(
      resolveWebCompanionAdminOptions(
        {
          WEB_COMPANION_PORT: "19",
          WEB_COMPANION_PUBLIC_ORIGIN: "https://override.example.test",
        },
        {
          version: 1,
          port: 80,
          publicOrigin: "https://persisted.example.test",
        },
      ),
    ).toEqual({
      port: "19",
      publicOrigin: "https://override.example.test",
    });
  });

  it("supports set, show, and reset through the administrator CLI", async () => {
    const directory = await makeTemporaryDirectory();
    const configPath = path.join(directory, "admin", "web-companion.json");
    const setResult = runCli([
      "set",
      "--port",
      "80",
      "--url",
      "http://10.255.10.90",
      "--config-file",
      configPath,
    ]);
    expect(setResult.status).toBe(0);
    expect(JSON.parse(setResult.stdout)).toMatchObject({
      path: configPath,
      configuration: {
        version: 1,
        port: 80,
        publicOrigin: "http://10.255.10.90",
      },
      restartRequired: true,
    });

    const showResult = runCli(["show", "--config-file", configPath]);
    expect(showResult.status).toBe(0);
    expect(JSON.parse(showResult.stdout).configuration.port).toBe(80);

    const resetResult = runCli(["reset", "--config-file", configPath]);
    expect(resetResult.status).toBe(0);
    expect(JSON.parse(resetResult.stdout).removed).toBe(true);
    expect(await loadWebCompanionAdminConfig(configPath)).toEqual({});
  });
});

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cs-web-config-"));
  temporaryDirectories.push(directory);
  return directory;
}

function runCli(arguments_) {
  return spawnSync(
    process.execPath,
    [
      path.resolve(
        import.meta.dirname,
        "../../tools/configure-web-companion.mjs",
      ),
      ...arguments_,
    ],
    {
      cwd: path.resolve(import.meta.dirname, "../.."),
      encoding: "utf8",
      windowsHide: true,
    },
  );
}
