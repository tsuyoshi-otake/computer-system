import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");

describe("Bedrock WorkMonitor adapters", () => {
  it("accounts bounded redstone and topology callbacks", async () => {
    const component = await source("src/bedrock/computerComponent.ts");
    const topology = await source("src/bedrock/faceIoTopology.ts");
    expect(component).toContain('lane: "redstone_input"');
    expect(component).toContain('lane: "redstone_output"');
    expect(component).toContain('lane: "redstone_input"');
    expect(component).toContain("sampleRedstoneInputs(block, record)");
    expect(topology).toContain('lane: "topology"');
    expect(topology).toContain("deterministicUnits: machineFaces.length");
  });

  it("publishes fixed-cardinality aggregate metrics for MCP status", async () => {
    const host = await source("src/bedrock/computerHost.ts");
    const session = await source("tools/bds-debug-session.mjs");
    expect(host).toContain("CS_WORK_MONITOR ");
    expect(session).toContain("workMonitor: this.workMonitor ?? null");
    expect(session).toContain("const workMonitorLanes = [");
  });
});

async function source(relative) {
  return readFile(path.join(root, relative), "utf8");
}
