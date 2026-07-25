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
        platform: "win32",
        environment: {
          WEB_COMPANION_CONFIG_FILE: "D:\\Config\\web-companion.json",
        },
      }),
    ).toBe("D:\\Config\\web-companion.json");
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
      cpuEngine: "wasm-rust",
      port: 8_080,
      publicOrigin: "https://terminal.example.test",
      runtimeWorkerCount: 4,
    });

    expect(await loadWebCompanionAdminConfig(configPath)).toEqual({
      version: 3,
      cpuEngine: "wasm-rust",
      port: 8_080,
      publicOrigin: "https://terminal.example.test",
      runtimeWorkerCount: 4,
    });
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      version: 3,
      cpuEngine: "wasm-rust",
      port: 8_080,
      publicOrigin: "https://terminal.example.test",
      runtimeWorkerCount: 4,
    });
  });

  it("migrates version 1 in memory and rejects invalid worker counts", () => {
    expect(
      validateWebCompanionAdminConfig({
        version: 1,
        port: 80,
      }),
    ).toEqual({ version: 3, port: 80 });
    expect(() =>
      validateWebCompanionAdminConfig({
        version: 1,
        runtimeWorkerCount: 2,
      }),
    ).toThrow(/version 1/u);
    expect(() =>
      validateWebCompanionAdminConfig({
        version: 2,
        runtimeWorkerCount: 0,
      }),
    ).toThrow(/between 1 and 16/u);
    expect(() =>
      validateWebCompanionAdminConfig({
        version: 2,
        runtimeWorkerCount: 17,
      }),
    ).toThrow(/between 1 and 16/u);
  });

  it("gates cpuEngine on version 3 and rejects unknown engines", () => {
    // An older companion honours neither key, so a file that predates the field
    // must not be allowed to declare it and be silently ignored.
    expect(() =>
      validateWebCompanionAdminConfig({
        version: 2,
        cpuEngine: "wasm-rust",
      }),
    ).toThrow(/version 2 cannot declare cpuEngine/u);
    expect(() =>
      validateWebCompanionAdminConfig({
        version: 3,
        cpuEngine: "wasm-unknown",
      }),
    ).toThrow(/must be one of: typescript, wasm-rust/u);
    expect(() => validateWebCompanionAdminConfig({ version: 4 })).toThrow(
      /must be one of: 1, 2, 3/u,
    );
    expect(
      validateWebCompanionAdminConfig({ version: 3, cpuEngine: "typescript" }),
    ).toEqual({ version: 3, cpuEngine: "typescript" });
  });

  it("rejects unknown fields, invalid ports, and URL paths", () => {
    expect(() =>
      validateWebCompanionAdminConfig({ version: 2, bind: "0.0.0.0" }),
    ).toThrow(/Unknown/u);
    expect(() =>
      validateWebCompanionAdminConfig({ version: 2, port: 0 }),
    ).toThrow(/between 1 and 65534/u);
    expect(() =>
      validateWebCompanionAdminConfig({
        version: 2,
        publicOrigin: "https://example.test/terminal",
      }),
    ).toThrow(/absolute HTTP\(S\) origin/u);
  });

  it("gives environment variables precedence over persisted values", () => {
    expect(resolveWebCompanionAdminOptions({}, {})).toEqual({
      cpuEngine: "typescript",
      port: "80",
      publicOrigin: undefined,
      runtimeWorkerCount: 2,
    });
    expect(
      resolveWebCompanionAdminOptions(
        {},
        { version: 3, cpuEngine: "wasm-rust" },
      ).cpuEngine,
    ).toBe("wasm-rust");
    expect(
      resolveWebCompanionAdminOptions(
        {
          WEB_COMPANION_CPU_ENGINE: "typescript",
          WEB_COMPANION_PORT: "19",
          WEB_COMPANION_PUBLIC_ORIGIN: "https://override.example.test",
          WEB_COMPANION_RUNTIME_WORKERS: "6",
        },
        {
          version: 3,
          cpuEngine: "wasm-rust",
          port: 80,
          publicOrigin: "https://persisted.example.test",
          runtimeWorkerCount: 4,
        },
      ),
    ).toEqual({
      cpuEngine: "typescript",
      port: "19",
      publicOrigin: "https://override.example.test",
      runtimeWorkerCount: 6,
    });
    expect(() =>
      resolveWebCompanionAdminOptions({ WEB_COMPANION_CPU_ENGINE: "rust" }, {}),
    ).toThrow(/CS486 compute engine must be one of: typescript, wasm-rust/u);
  });

  it("supports set, show, and reset through the administrator CLI", async () => {
    const directory = await makeTemporaryDirectory();
    const configPath = path.join(directory, "admin", "web-companion.json");
    const setResult = runCli([
      "set",
      "--port",
      "80",
      "--url",
      "http://10.255.10.90:80",
      "--runtime-workers",
      "2",
      "--cpu-engine",
      "wasm-rust",
      "--config-file",
      configPath,
    ]);
    expect(setResult.status).toBe(0);
    expect(JSON.parse(setResult.stdout)).toMatchObject({
      path: configPath,
      configuration: {
        version: 3,
        cpuEngine: "wasm-rust",
        port: 80,
        publicOrigin: "http://10.255.10.90",
        runtimeWorkerCount: 2,
      },
      restartRequired: true,
    });

    const showResult = runCli(["show", "--config-file", configPath]);
    expect(showResult.status).toBe(0);
    expect(JSON.parse(showResult.stdout).configuration.port).toBe(80);

    const rejectedResult = runCli([
      "set",
      "--cpu-engine",
      "wasm-unknown",
      "--config-file",
      configPath,
    ]);
    expect(rejectedResult.status).toBe(1);
    expect(rejectedResult.stderr).toMatch(
      /must be one of: typescript, wasm-rust/u,
    );
    expect((await loadWebCompanionAdminConfig(configPath)).cpuEngine).toBe(
      "wasm-rust",
    );

    const clearResult = runCli([
      "set",
      "--clear-cpu-engine",
      "--config-file",
      configPath,
    ]);
    expect(clearResult.status).toBe(0);
    expect(
      JSON.parse(clearResult.stdout).configuration.cpuEngine,
    ).toBeUndefined();

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
