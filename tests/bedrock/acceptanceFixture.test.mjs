import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const bridgeSource = await readFile(
  new URL("../../src/bedrock/debugAcceptanceFixtureBridge.ts", import.meta.url),
  "utf8",
);
const hostSource = await readFile(
  new URL("../../src/bedrock/computerHost.ts", import.meta.url),
  "utf8",
);
const buildSource = await readFile(
  new URL("../../tools/build.mjs", import.meta.url),
  "utf8",
);

describe("MCP acceptance fixture boundary", () => {
  it("keeps production login enabled unless the compile-time fixture is active", () => {
    expect(hostSource).toContain("requireLinuxLogin: !acceptanceFixtureBuild");
    expect(buildSource).toContain(
      "__CS_ACCEPTANCE_FIXTURE__: JSON.stringify(acceptanceFixtureBuild)",
    );
    expect(buildSource).toContain(
      'if (value === undefined || value === "0") return false',
    );
  });

  it("requires a server source and an empty player set before provisioning", () => {
    expect(bridgeSource).toContain("sourceType !== ScriptEventSource.Server");
    expect(bridgeSource).toContain("world.getAllPlayers().length !== 0");
    expect(bridgeSource).toContain('error: "fixture_disabled"');
    expect(bridgeSource).toContain('error: "players_connected"');
  });

  it("never introduces credential, token, or URL fields into the fixture response", () => {
    expect(bridgeSource).not.toMatch(/password|bearer|token|https?:\/\//iu);
    expect(bridgeSource).toContain(
      'status: "completed", computerId: placed.computerId',
    );
  });
});
