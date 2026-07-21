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
    expect(source).toContain('emit(runId, "linux_git", "PASS", { ...git })');
    expect(source).toContain('emitFailure(runId, "linux_git", error)');
    expect(smoke).toContain("requireLinuxAuthenticationRecord(probeLogs)");
    expect(smoke).toContain('record.probe !== "linux_authentication"');
    expect(smoke).toContain('record.details?.authenticatedUser !== "cs"');
    expect(smoke).toContain("record.details?.passwordMasked !== true");
    expect(smoke).toContain("requireLinuxMakeRecord(probeLogs)");
    expect(smoke).toContain('record.probe !== "linux_make"');
    expect(smoke).toContain('record.probe !== "linux_git"');
    expect(smoke).toContain('const beforeStart = await call("bds_status", {})');
    expect(smoke).toContain(
      'contains: \'CS_STORAGE_MIGRATION {"state":"complete"\'',
    );
    expect(smoke.indexOf('await call("bds_start"')).toBeLessThan(
      smoke.indexOf('await call("bds_wait_for_log"'),
    );
    expect(smoke.indexOf('await call("bds_wait_for_log"')).toBeLessThan(
      smoke.indexOf('await call("bds_run_probe"'),
    );
  });
});
