import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  runWebTerminalRoutingBenchmark,
  webTerminalRoutingScenarios,
  webTerminalRoutingSessionCounts,
} from "../../tools/benchmark-web-terminal-routing.mjs";

describe("Web Terminal routing benchmark", () => {
  const artifact = JSON.parse(
    readFileSync(
      new URL(
        "../../docs/benchmarks/web-terminal-routing/2026-07-18-current-route.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const report = runWebTerminalRoutingBenchmark({
    baselineCommit: "9a06d2d7cc7523b8b4300dedf741413307e91e11",
    capturedAt: "2026-07-18T08:50:00.000Z",
    baselineWorktree: "clean",
    environment: { fixture: true },
  });

  it("covers every frozen scenario at 1, 5, and 32 sessions", () => {
    expect(report.scenarios).toHaveLength(
      webTerminalRoutingScenarios.length *
        webTerminalRoutingSessionCounts.length,
    );
    expect(
      report.scenarios.map(({ scenario, sessionCount }) => [
        scenario,
        sessionCount,
      ]),
    ).toEqual(
      webTerminalRoutingScenarios.flatMap((scenario) =>
        webTerminalRoutingSessionCounts.map((sessionCount) => [
          scenario,
          sessionCount,
        ]),
      ),
    );
  });

  it("freezes current full-envelope and scheduler scaling", () => {
    const full = result("full_screen_change", 32);
    expect(full).toMatchObject({
      deliveries: 32,
      eagerMaximumWaitTicks: 8,
      fullSurfaceTraversals: 32,
      mcpSnapshotVersionAdvances: 32,
      perSessionEnvelopeSerializations: 32,
      periodicMaximumWaitTicks: 80,
      sharedFrameBuilds: 1,
      terminalSnapshotCalls: 1,
    });
    expect(report.decisionGate.numericSignals).toMatchObject({
      fiveSessionMarkerBytesVsOne: 5,
      thirtyTwoSessionMarkerBytesVsOne: 32,
      fiveSessionFullSurfaceTraversals: 5,
      thirtyTwoSessionFullSurfaceTraversals: 32,
    });
  });

  it("separates unchanged, audio, range, resume, and boundary counters", () => {
    expect(result("unchanged_surface", 5)).toMatchObject({
      deliveries: 0,
      terminalSnapshotCalls: 0,
      unchangedSkips: 5,
    });
    expect(result("audio_only_delivery", 32)).toMatchObject({
      deliveries: 32,
      fullSurfaceTraversals: 32,
      terminalSnapshotCalls: 0,
    });
    expect(result("mixed_range", 32)).toMatchObject({
      accessTransitions: 16,
      deliveries: 16,
      rangeSuppressedDeliveries: 16,
    });
    expect(result("out_of_range_resume", 32)).toMatchObject({
      accessTransitions: 64,
      deliveries: 32,
      rangeSuppressedDeliveries: 32,
    });
    expect(result("terminal_boundary_reset", 32)).toMatchObject({
      deliveries: 96,
      epochIdentifiersPresent: false,
      sharedFrameBuilds: 3,
      terminalSnapshotCalls: 3,
    });
  });

  it("uses the production coalesced writer for blocked consumers", () => {
    expect(result("blocked_ndjson_consumer", 32)).toMatchObject({
      audioEventsDelivered: 3_200,
      blockedWriteSignals: 1,
      coalescedTerminalEvents: 98,
      deliveries: 3_200,
      mcpSnapshotVersionAdvances: 3_200,
      ndjsonAudioEventsWritten: 3_102,
      ndjsonTerminalEventsWritten: 3_102,
    });
  });

  it("replays every deterministic counter in the committed artifact", () => {
    expect(
      runWebTerminalRoutingBenchmark({
        baselineCommit: artifact.provenance.baselineCommit,
        capturedAt: artifact.capturedAt,
        baselineWorktree: artifact.provenance.baselineWorktree,
        environment: artifact.environment,
      }),
    ).toEqual(artifact);
  });

  function result(scenario, sessionCount) {
    const found = report.scenarios.find(
      (entry) =>
        entry.scenario === scenario && entry.sessionCount === sessionCount,
    );
    expect(found).toBeDefined();
    return found;
  }
});
