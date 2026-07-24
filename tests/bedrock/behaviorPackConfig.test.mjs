import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseBehaviorPackConfig } from "../../tools/behavior-pack-config.mjs";

const authoredConfig = JSON.parse(
  await readFile(
    new URL(
      "../../packs/behavior/config/computer-system.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const hostSource = await readFile(
  new URL("../../src/bedrock/computerHost.ts", import.meta.url),
  "utf8",
);
const buildSource = await readFile(
  new URL("../../tools/build.mjs", import.meta.url),
  "utf8",
);

describe("Behavior Pack CPU-rate configuration", () => {
  it("ships one-half realtime as the validated default", () => {
    expect(parseBehaviorPackConfig(authoredConfig)).toEqual({
      collectMicroarchitectureStatsByDefault: false,
      guestRealtimeDivisor: 2,
      version: 2,
    });
    expect(buildSource).toContain(
      "__CS_COLLECT_MICROARCHITECTURE_STATS_BY_DEFAULT__",
    );
    expect(buildSource).toContain("__CS_GUEST_REALTIME_DIVISOR__");
    expect(hostSource).toMatch(
      /collectMicroarchitectureStatsByDefault:\r?\n\s+behaviorPackConfig\.collectMicroarchitectureStatsByDefault,/u,
    );
    expect(hostSource).toContain(
      "guestRealtimeDivisor: behaviorPackConfig.guestRealtimeDivisor",
    );
  });

  it("accepts bounded integer divisors and rejects malformed configuration", () => {
    expect(
      parseBehaviorPackConfig({
        collectMicroarchitectureStatsByDefault: false,
        guestRealtimeDivisor: 1,
        version: 2,
      }),
    ).toMatchObject({ guestRealtimeDivisor: 1 });
    expect(
      parseBehaviorPackConfig({
        collectMicroarchitectureStatsByDefault: false,
        guestRealtimeDivisor: 10_000,
        version: 2,
      }),
    ).toMatchObject({ guestRealtimeDivisor: 10_000 });
    for (const guestRealtimeDivisor of [0, 1.5, 10_001, "100"]) {
      expect(() =>
        parseBehaviorPackConfig({
          collectMicroarchitectureStatsByDefault: false,
          guestRealtimeDivisor,
          version: 2,
        }),
      ).toThrow(/guestRealtimeDivisor/u);
    }
    for (const collectMicroarchitectureStatsByDefault of [true, false]) {
      expect(
        parseBehaviorPackConfig({
          collectMicroarchitectureStatsByDefault,
          guestRealtimeDivisor: 50,
          version: 2,
        }),
      ).toMatchObject({ collectMicroarchitectureStatsByDefault });
    }
    for (const collectMicroarchitectureStatsByDefault of [
      undefined,
      0,
      "false",
      null,
    ]) {
      expect(() =>
        parseBehaviorPackConfig({
          collectMicroarchitectureStatsByDefault,
          guestRealtimeDivisor: 50,
          version: 2,
        }),
      ).toThrow(/collectMicroarchitectureStatsByDefault/u);
    }
    for (const version of [undefined, 0, 1, 3, "2"]) {
      expect(() =>
        parseBehaviorPackConfig({
          collectMicroarchitectureStatsByDefault: false,
          guestRealtimeDivisor: 50,
          version,
        }),
      ).toThrow(/configuration version must be 2/u);
    }
    expect(() =>
      parseBehaviorPackConfig({
        collectMicroarchitectureStatsByDefault: false,
        guestRealtimeDivisor: 100,
        unexpected: true,
        version: 2,
      }),
    ).toThrow(/Unknown Behavior Pack configuration field/u);
  });
});
