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
  it("ships one-hundredth realtime as the validated default", () => {
    expect(parseBehaviorPackConfig(authoredConfig)).toEqual({
      guestRealtimeDivisor: 100,
      version: 1,
    });
    expect(buildSource).toContain("__CS_GUEST_REALTIME_DIVISOR__");
    expect(hostSource).toContain(
      "guestRealtimeDivisor: behaviorPackConfig.guestRealtimeDivisor",
    );
  });

  it("accepts bounded integer divisors and rejects malformed configuration", () => {
    expect(
      parseBehaviorPackConfig({ version: 1, guestRealtimeDivisor: 1 }),
    ).toMatchObject({ guestRealtimeDivisor: 1 });
    expect(
      parseBehaviorPackConfig({ version: 1, guestRealtimeDivisor: 10_000 }),
    ).toMatchObject({ guestRealtimeDivisor: 10_000 });
    for (const guestRealtimeDivisor of [0, 1.5, 10_001, "100"]) {
      expect(() =>
        parseBehaviorPackConfig({ version: 1, guestRealtimeDivisor }),
      ).toThrow(/guestRealtimeDivisor/u);
    }
    expect(() =>
      parseBehaviorPackConfig({
        version: 1,
        guestRealtimeDivisor: 100,
        unexpected: true,
      }),
    ).toThrow(/Unknown Behavior Pack configuration field/u);
  });
});
