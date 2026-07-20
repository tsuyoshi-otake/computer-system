import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock headless authentication coverage", () => {
  it("publishes the isolated CS-Linux authentication result in the suite", async () => {
    const [source, smoke] = await Promise.all([
      readFile(path.join(root, "src/bedrock/probes/headlessProbe.ts"), "utf8"),
      readFile(path.join(root, "tools/bds-mcp-smoke.mjs"), "utf8"),
    ]);

    expect(source).toContain("runLinuxAuthenticationProbe");
    expect(source).toContain(
      'emit(runId, "linux_authentication", "PASS", { ...authentication })',
    );
    expect(source).toContain(
      'emitFailure(runId, "linux_authentication", error)',
    );
    expect(source).toContain("runLinuxMakeProbe");
    expect(source).toContain('emit(runId, "linux_make", "PASS", { ...make })');
    expect(source).toContain('emitFailure(runId, "linux_make", error)');
    expect(smoke).toContain("requireLinuxAuthenticationRecord(probeLogs)");
    expect(smoke).toContain('record.probe !== "linux_authentication"');
    expect(smoke).toContain('record.details?.authenticatedUser !== "cs"');
    expect(smoke).toContain("record.details?.passwordMasked !== true");
    expect(smoke).toContain("requireLinuxMakeRecord(probeLogs)");
    expect(smoke).toContain('record.probe !== "linux_make"');
  });
});
