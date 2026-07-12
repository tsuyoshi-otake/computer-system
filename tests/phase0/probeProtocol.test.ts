import { describe, expect, it } from "vitest";

import {
  formatProbeRecord,
  probeLogPrefix,
} from "../../src/phase0/probeProtocol.js";

describe("probe protocol", (): void => {
  it("formats one machine-readable JSON Lines record", (): void => {
    const line = formatProbeRecord({
      runId: "headless-42",
      probe: "runtime",
      status: "PASS",
      details: { computers: 20, ticks: 40 },
    });

    expect(line.startsWith(probeLogPrefix)).toBe(true);
    expect(JSON.parse(line.slice(probeLogPrefix.length))).toEqual({
      runId: "headless-42",
      probe: "runtime",
      status: "PASS",
      details: { computers: 20, ticks: 40 },
    });
    expect(line).not.toContain("\n");
  });
});
