import { describe, expect, it } from "vitest";

import { resolveMcpRuntimeWorkerCount } from "../../tools/mcp-runtime-workers.mjs";

describe("MCP runtime worker selection", () => {
  it("keeps the in-engine CS486 CPU by default", () => {
    expect(resolveMcpRuntimeWorkerCount({}, {})).toBeUndefined();
    expect(
      resolveMcpRuntimeWorkerCount({}, { cpuEngine: "typescript" }),
    ).toBeUndefined();
    expect(
      resolveMcpRuntimeWorkerCount(
        { BDS_MCP_RUNTIME_WORKERS: "" },
        { cpuEngine: "typescript" },
      ),
    ).toBeUndefined();
    expect(
      resolveMcpRuntimeWorkerCount(
        { BDS_MCP_RUNTIME_WORKERS: "0" },
        { cpuEngine: "typescript" },
      ),
    ).toBeUndefined();
  });

  it("admits an explicit worker count inside the managed range", () => {
    for (const [configured, expected] of [
      ["1", 1],
      ["2", 2],
      ["16", 16],
    ]) {
      expect(
        resolveMcpRuntimeWorkerCount(
          { BDS_MCP_RUNTIME_WORKERS: configured },
          { cpuEngine: "wasm-rust" },
        ),
      ).toBe(expected);
    }
  });

  it("rejects a malformed or out-of-range worker count", () => {
    for (const configured of [
      "17",
      "64",
      "-1",
      "1.5",
      " 2",
      "2 ",
      "two",
      "0x2",
      "9007199254740993",
    ]) {
      expect(() =>
        resolveMcpRuntimeWorkerCount(
          { BDS_MCP_RUNTIME_WORKERS: configured },
          {},
        ),
      ).toThrow(/BDS_MCP_RUNTIME_WORKERS must be 0 .* between 1 and 16\./u);
    }
  });

  it("refuses a selected engine that the session shape could never run", () => {
    for (const environment of [
      {},
      { BDS_MCP_RUNTIME_WORKERS: "" },
      { BDS_MCP_RUNTIME_WORKERS: "0" },
    ]) {
      expect(() =>
        resolveMcpRuntimeWorkerCount(environment, { cpuEngine: "wasm-rust" }),
      ).toThrow(/BDS_MCP_RUNTIME_WORKERS/u);
      expect(() =>
        resolveMcpRuntimeWorkerCount(environment, { cpuEngine: "wasm-rust" }),
      ).toThrow(/wasm-rust/u);
    }
  });
});
