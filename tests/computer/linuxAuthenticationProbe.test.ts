import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runLinuxAuthenticationProbe } from "../../src/application/computer/linuxAuthenticationProbe.js";

describe("CS-Linux authentication headless probe", (): void => {
  it("proves setup, masked input, later login, and MCP identity", async (): Promise<void> => {
    vi.stubGlobal("structuredClone", undefined);
    let result: ReturnType<typeof runLinuxAuthenticationProbe>;
    try {
      result = runLinuxAuthenticationProbe();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(result).toMatchObject({
      authenticatedUser: "cs",
      laterLoginRequired: true,
      passwordMasked: true,
      preLoginRejected: true,
      setupCompleted: true,
    });
    expect(result.ticks).toBeGreaterThanOrEqual(8);
    expect(result.ticks).toBeLessThanOrEqual(256);

    const source = await readFile(
      path.resolve(
        import.meta.dirname,
        "../../src/application/computer/linuxAuthenticationProbe.ts",
      ),
      "utf8",
    );
    const password = /const probePassword = "([^"]+)";/u.exec(source)?.[1];
    expect(password).toBeTypeOf("string");
    expect(JSON.stringify(result).includes(password ?? "")).toBe(false);
  });
});
