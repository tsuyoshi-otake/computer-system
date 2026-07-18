import { EventEmitter } from "node:events";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createCoalescedEventWriter } from "./web-companion-server.mjs";
import { WebSessionStore } from "./web-session-store.mjs";

export const webTerminalRoutingSessionCounts = Object.freeze([1, 5, 32]);
export const webTerminalRoutingScenarios = Object.freeze([
  "unchanged_surface",
  "one_changed_cell",
  "one_changed_row",
  "full_screen_change",
  "audio_only_delivery",
  "mixed_range",
  "out_of_range_resume",
  "blocked_ndjson_consumer",
  "terminal_boundary_reset",
]);

const snapshotMarker = "CS_WEB_TERMINAL ";
const accessMarker = "CS_WEB_ACCESS ";
const width = 80;
const height = 25;
const fixedNow = 1_784_371_200_000;
const computerId = "c-000030";
const frameMetadata = JSON.stringify({
  label: "Portable CS-DOS",
  lifecycle: "running",
  secretInput: false,
  storage: {
    capacityBytes: 20 * 1_048_576,
    diskProfileId: "portable-ide-20m",
    fdd: { mediaPresent: false, pendingRequests: 0, state: "absent" },
    hdd: { mediaPresent: true, pendingRequests: 0, state: "idle" },
  },
});

export function runWebTerminalRoutingBenchmark(options) {
  const capturedAt = requireIsoTimestamp(options?.capturedAt);
  const baselineCommit = requireCommit(options?.baselineCommit);
  const environment = options?.environment ?? currentEnvironment();
  const scenarios = [];
  for (const scenario of webTerminalRoutingScenarios) {
    for (const sessionCount of webTerminalRoutingSessionCounts) {
      scenarios.push(measureScenario(scenario, sessionCount));
    }
  }
  const report = {
    schema: 1,
    benchmark: "web-terminal-routing-v1",
    capturedAt,
    provenance: {
      baselineCommit,
      baselineWorktree: options?.baselineWorktree ?? "clean",
      productionRoutingChanged: false,
      harnessState:
        "benchmark-only harness and immutable artifact were uncommitted during capture",
    },
    environment,
    fixture: {
      computerId,
      surface: {
        schema: 1,
        width,
        height,
        cells: width * height,
        colors: "16-color foreground/background grids",
      },
      sessionCounts: [...webTerminalRoutingSessionCounts],
      scenarios: [...webTerminalRoutingScenarios],
      blockedChanges: 100,
      blockedAudioEventsPerSession: 100,
    },
    scheduler: {
      periodicIntervalTicks: 5,
      periodicSessionsPerPass: 2,
      eagerIntervalTicks: 1,
      eagerSessionsPerPass: 4,
      eagerMaximumAttempts: 3,
      periodicMaximumWaitTicks: Object.fromEntries(
        webTerminalRoutingSessionCounts.map((count) => [
          String(count),
          5 * Math.ceil(count / 2),
        ]),
      ),
      eagerMaximumWaitTicks: Object.fromEntries(
        webTerminalRoutingSessionCounts.map((count) => [
          String(count),
          Math.ceil(count / 4),
        ]),
      ),
    },
    counterSemantics: {
      terminalSnapshotCalls:
        "Production-equivalent calls that construct the shared TerminalBuffer snapshot.",
      sharedFrameBuilds:
        "Computer-scoped shared frame objects built after cache invalidation.",
      perSessionEnvelopeSerializations:
        "JSON.stringify calls for the current full CS_WEB_TERMINAL session envelope.",
      fullSurfaceTraversals:
        "Per-session envelope serializations that traverse the full text/color surface.",
      bdsMarkerBytes:
        "UTF-8 bytes in CS_WEB_TERMINAL and CS_WEB_ACCESS markers, excluding logger newline bytes.",
      companionNdjsonBytes:
        "UTF-8 bytes actually written by the production coalesced writer, including NDJSON newlines.",
      mcpSnapshotVersionAdvances:
        "WebSessionStore terminalVersion increments; this remains session scoped.",
    },
    scenarios,
    liveEvidence: {
      bds: {
        status: "not_captured",
        tickMilliseconds: { p50: null, p95: null, p99: null, max: null },
        emergencyDeferrals: null,
        reason:
          "The preserved BDS was already running, but this Codex session did not expose the configured bds_* tools.",
      },
      chrome: {
        status: "not_captured",
        enterToVisibleMilliseconds: null,
        mainThreadRenderMilliseconds: null,
        reason:
          "Chrome had no writer-owned Computer Web Terminal tab; no replacement session was guessed or created.",
      },
    },
  };
  report.decisionGate = decisionGate(report);
  return report;
}

function measureScenario(scenario, sessionCount) {
  const harness = createHarness(sessionCount);
  const counters = emptyCounters();
  for (const tracker of harness.trackers) tracker.reset();

  switch (scenario) {
    case "unchanged_surface":
      routeFrame(harness, counters, {
        revision: 1,
        surface: harness.baselineSurface,
        terminalIdentity: harness.baselineTerminal,
      });
      break;
    case "one_changed_cell":
      routeFrame(harness, counters, {
        revision: 2,
        surface: changeCell(harness.baselineSurface, 1, 1, "@"),
        terminalIdentity: harness.baselineTerminal,
      });
      break;
    case "one_changed_row":
      routeFrame(harness, counters, {
        revision: 2,
        surface: changeRow(harness.baselineSurface, 13, "R"),
        terminalIdentity: harness.baselineTerminal,
      });
      break;
    case "full_screen_change":
      routeFrame(harness, counters, {
        revision: 2,
        surface: fullScreen("X", 14, 1),
        terminalIdentity: harness.baselineTerminal,
      });
      break;
    case "audio_only_delivery":
      routeFrame(harness, counters, {
        audioForSession: (index) =>
          audioBatch((index % 3) + 1, 32, 200 + index),
        revision: 1,
        surface: harness.baselineSurface,
        terminalIdentity: harness.baselineTerminal,
      });
      break;
    case "mixed_range":
      for (const [index, session] of harness.sessions.entries()) {
        if (index % 2 === 1) {
          transitionAccess(harness, counters, session, "out_of_range");
        }
      }
      routeFrame(harness, counters, {
        revision: 2,
        surface: changeCell(harness.baselineSurface, 1, 1, "M"),
        terminalIdentity: harness.baselineTerminal,
      });
      break;
    case "out_of_range_resume": {
      const resumedSurface = changeCell(harness.baselineSurface, 1, 1, "S");
      for (const session of harness.sessions) {
        transitionAccess(harness, counters, session, "out_of_range");
      }
      routeFrame(harness, counters, {
        revision: 2,
        surface: resumedSurface,
        terminalIdentity: harness.baselineTerminal,
      });
      for (const session of harness.sessions) {
        transitionAccess(harness, counters, session, "in_range");
      }
      routeFrame(harness, counters, {
        force: true,
        revision: 2,
        surface: resumedSurface,
        terminalIdentity: harness.baselineTerminal,
      });
      break;
    }
    case "blocked_ndjson_consumer":
      harness.trackers[0].blockNextWrite();
      for (let change = 1; change <= 100; change += 1) {
        routeFrame(harness, counters, {
          audioForSession: () => audioBatch(1, change, 300 + change),
          revision: change + 1,
          surface: changeCell(
            harness.baselineSurface,
            ((change - 1) % width) + 1,
            (Math.floor((change - 1) / width) % height) + 1,
            change % 2 === 0 ? "B" : "b",
          ),
          terminalIdentity: harness.baselineTerminal,
        });
      }
      harness.trackers[0].drain();
      break;
    case "terminal_boundary_reset":
      for (const boundary of ["replacement", "resize", "power_cycle"]) {
        routeFrame(harness, counters, {
          boundary,
          force: true,
          revision: 0,
          surface: fullScreen(
            boundary === "replacement"
              ? "T"
              : boundary === "resize"
                ? "Z"
                : "P",
            7,
            0,
          ),
          terminalIdentity: { boundary },
        });
      }
      break;
    default:
      throw new Error(`Unsupported routing benchmark scenario ${scenario}`);
  }

  const written = aggregateTrackers(harness.trackers);
  const versions = harness.sessions.map(
    ({ sessionId }) =>
      harness.store.activeSession(sessionId)?.terminalVersion ?? 0,
  );
  return {
    scenario,
    sessionCount,
    periodicMaximumWaitTicks: 5 * Math.ceil(sessionCount / 2),
    eagerMaximumWaitTicks: Math.ceil(sessionCount / 4),
    ...counters,
    companionNdjsonBytes: written.bytes,
    ndjsonWriteCalls: written.writeCalls,
    ndjsonTerminalEventsWritten: written.terminalEvents,
    ndjsonAccessEventsWritten: written.accessEvents,
    ndjsonAudioEventsWritten: written.audioEvents,
    blockedWriteSignals: written.blockedSignals,
    coalescedTerminalEvents: counters.deliveries - written.terminalEvents,
    mcpSnapshotVersionAdvances:
      versions.reduce((sum, value) => sum + value, 0) - sessionCount,
    snapshotVersionMinimum: Math.min(...versions),
    snapshotVersionMaximum: Math.max(...versions),
    epochIdentifiersPresent: false,
  };
}

function createHarness(sessionCount) {
  let randomCounter = 0;
  const store = new WebSessionStore({
    clock: () => fixedNow,
    maxSessions: 32,
    random: (bytes) => {
      const value = Buffer.alloc(bytes);
      randomCounter += 1;
      value.writeUInt32BE(randomCounter, bytes - 4);
      return value;
    },
  });
  const trackers = [];
  const sessions = [];
  for (let index = 0; index < sessionCount; index += 1) {
    const issued = store.issue({
      requestId: `r1-${(index + 1).toString(36)}`,
      playerId: `player-${String(index + 1)}`,
      computerId,
    });
    const { session, token } = store.consumeHandoff(issued.handoffCode);
    const tracker = createResponseTracker();
    store.subscribe(token, createCoalescedEventWriter(tracker.response));
    trackers.push(tracker);
    sessions.push({
      access: "in_range",
      audioCursor: 0,
      lastMetadata: undefined,
      lastRevision: undefined,
      lastTerminal: undefined,
      sessionId: session.sessionId,
    });
  }
  const baselineSurface = fullScreen(" ", 7, 0);
  const harness = {
    baselineSurface,
    baselineTerminal: { identity: "baseline" },
    cache: undefined,
    sessions,
    store,
    trackers,
  };
  routeFrame(harness, emptyCounters(), {
    force: true,
    revision: 1,
    surface: baselineSurface,
    terminalIdentity: harness.baselineTerminal,
  });
  return harness;
}

function routeFrame(harness, counters, options) {
  for (const [index, session] of harness.sessions.entries()) {
    if (session.access === "out_of_range") {
      counters.rangeSuppressedDeliveries += 1;
      continue;
    }
    const audio =
      options.audioForSession?.(index) ?? audioBatch(0, session.audioCursor, 0);
    const metadata = `${String(audio.latestSequence)}:${frameMetadata}`;
    if (
      options.force !== true &&
      audio.events.length === 0 &&
      session.lastTerminal === options.terminalIdentity &&
      session.lastRevision === options.revision &&
      session.lastMetadata === metadata
    ) {
      counters.unchangedSkips += 1;
      continue;
    }
    const frame = sharedFrame(harness, counters, options);
    const payload = {
      sessionId: session.sessionId,
      ...frame.payload,
      audio,
    };
    const serialized = JSON.stringify(payload);
    counters.perSessionEnvelopeSerializations += 1;
    counters.fullSurfaceTraversals += 1;
    counters.perSessionEnvelopeJsonBytes += Buffer.byteLength(serialized);
    counters.bdsTerminalMarkerBytes += Buffer.byteLength(
      `${snapshotMarker}${serialized}`,
    );
    counters.deliveries += 1;
    counters.audioEventsDelivered += audio.events.length;
    if (!harness.store.updateTerminal(session.sessionId, payload)) {
      throw new Error("Benchmark session disappeared during terminal delivery");
    }
    session.lastTerminal = options.terminalIdentity;
    session.lastRevision = options.revision;
    session.lastMetadata = metadata;
    session.audioCursor = audio.latestSequence;
  }
  counters.bdsMarkerBytes =
    counters.bdsTerminalMarkerBytes + counters.bdsAccessMarkerBytes;
}

function sharedFrame(harness, counters, options) {
  const cached = harness.cache;
  if (
    cached !== undefined &&
    cached.terminalIdentity === options.terminalIdentity &&
    cached.revision === options.revision &&
    cached.metadata === frameMetadata
  ) {
    counters.sharedFrameCacheHits += 1;
    return cached;
  }
  const frame = {
    metadata: frameMetadata,
    payload: {
      computerId,
      label: "Portable CS-DOS",
      lifecycle: "running",
      storage: JSON.parse(frameMetadata).storage,
      terminal: {
        ...cloneSurface(options.surface),
        secretInput: false,
      },
    },
    revision: options.revision,
    terminalIdentity: options.terminalIdentity,
  };
  harness.cache = frame;
  counters.terminalSnapshotCalls += 1;
  counters.sharedFrameBuilds += 1;
  counters.sharedPayloadJsonBytes += Buffer.byteLength(
    JSON.stringify(frame.payload),
  );
  return frame;
}

function transitionAccess(harness, counters, session, access) {
  if (session.access === access) return;
  session.access = access;
  const serialized = JSON.stringify({ sessionId: session.sessionId, access });
  counters.accessTransitions += 1;
  counters.bdsAccessMarkerBytes += Buffer.byteLength(
    `${accessMarker}${serialized}`,
  );
  counters.bdsMarkerBytes =
    counters.bdsTerminalMarkerBytes + counters.bdsAccessMarkerBytes;
  if (!harness.store.updateAccess(session.sessionId, access)) {
    throw new Error("Benchmark session disappeared during access delivery");
  }
  if (access === "out_of_range") session.audioCursor = 0;
}

function createResponseTracker() {
  const response = new EventEmitter();
  const metrics = {
    accessEvents: 0,
    audioEvents: 0,
    blockedSignals: 0,
    bytes: 0,
    terminalEvents: 0,
    writeCalls: 0,
  };
  let blockNext = false;
  response.write = (value) => {
    metrics.writeCalls += 1;
    metrics.bytes += Buffer.byteLength(value);
    const event = JSON.parse(value);
    if (event.type === "terminal") {
      metrics.terminalEvents += 1;
      metrics.audioEvents += event.terminal?.audio?.events?.length ?? 0;
    } else if (event.type === "access") {
      metrics.accessEvents += 1;
    }
    if (blockNext) {
      blockNext = false;
      metrics.blockedSignals += 1;
      return false;
    }
    return true;
  };
  response.end = () => undefined;
  return {
    response,
    blockNextWrite() {
      blockNext = true;
    },
    drain() {
      response.emit("drain");
    },
    reset() {
      for (const key of Object.keys(metrics)) metrics[key] = 0;
      blockNext = false;
    },
    snapshot() {
      return { ...metrics };
    },
  };
}

function aggregateTrackers(trackers) {
  const total = {
    accessEvents: 0,
    audioEvents: 0,
    blockedSignals: 0,
    bytes: 0,
    terminalEvents: 0,
    writeCalls: 0,
  };
  for (const tracker of trackers) {
    const current = tracker.snapshot();
    for (const key of Object.keys(total)) total[key] += current[key];
  }
  return total;
}

function emptyCounters() {
  return {
    accessTransitions: 0,
    audioEventsDelivered: 0,
    bdsAccessMarkerBytes: 0,
    bdsMarkerBytes: 0,
    bdsTerminalMarkerBytes: 0,
    deliveries: 0,
    fullSurfaceTraversals: 0,
    perSessionEnvelopeJsonBytes: 0,
    perSessionEnvelopeSerializations: 0,
    rangeSuppressedDeliveries: 0,
    sharedFrameBuilds: 0,
    sharedFrameCacheHits: 0,
    sharedPayloadJsonBytes: 0,
    terminalSnapshotCalls: 0,
    unchangedSkips: 0,
  };
}

function fullScreen(character, foreground, background) {
  const row = character.repeat(width);
  return {
    schema: 1,
    width,
    height,
    rows: Array.from({ length: height }, () => row),
    foreground: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => foreground),
    ),
    background: Array.from({ length: height }, () =>
      Array.from({ length: width }, () => background),
    ),
    cursor: { x: 1, y: 1, blink: true },
  };
}

function changeCell(surface, x, y, character) {
  const changed = cloneSurface(surface);
  const characters = [...changed.rows[y - 1]];
  characters[x - 1] = character;
  changed.rows[y - 1] = characters.join("");
  return changed;
}

function changeRow(surface, y, character) {
  const changed = cloneSurface(surface);
  changed.rows[y - 1] = character.repeat(width);
  return changed;
}

function cloneSurface(surface) {
  return {
    schema: surface.schema,
    width: surface.width,
    height: surface.height,
    rows: [...surface.rows],
    foreground: surface.foreground.map((row) => [...row]),
    background: surface.background.map((row) => [...row]),
    cursor: { ...surface.cursor },
  };
}

function audioBatch(count, latestSequence, tick) {
  return {
    events: Array.from({ length: count }, (_, index) => ({
      kind: index % 2 === 0 ? "read" : "seek",
      sequence: latestSequence - count + index + 1,
      tick,
    })),
    latestSequence,
  };
}

function decisionGate(report) {
  const full1 = findScenario(report, "full_screen_change", 1);
  const full5 = findScenario(report, "full_screen_change", 5);
  const full32 = findScenario(report, "full_screen_change", 32);
  return {
    status: "deferred_pending_live_bds_and_chrome_evidence",
    numericSignals: {
      fiveSessionMarkerBytesVsOne:
        full5.bdsTerminalMarkerBytes / full1.bdsTerminalMarkerBytes,
      thirtyTwoSessionMarkerBytesVsOne:
        full32.bdsTerminalMarkerBytes / full1.bdsTerminalMarkerBytes,
      fiveSessionFullSurfaceTraversals: full5.fullSurfaceTraversals,
      thirtyTwoSessionFullSurfaceTraversals: full32.fullSurfaceTraversals,
      thirtyTwoSessionPeriodicMaximumWaitTicks: full32.periodicMaximumWaitTicks,
      thirtyTwoSessionCompanionNdjsonBytes: full32.companionNdjsonBytes,
    },
    reason:
      "Deterministic bytes and call counts prove linear per-session full-envelope work, but the Issue requires BDS tick and Chrome main-thread timing before selecting the dominant wall-time branch.",
    requiredBeforeSelection: [
      "preserved-world exact-session MCP preflight",
      "BDS tick p50/p95/p99/max and emergency deferrals",
      "real Chrome Enter-to-visible and main-thread render timing",
    ],
  };
}

function findScenario(report, scenario, sessionCount) {
  const result = report.scenarios.find(
    (entry) =>
      entry.scenario === scenario && entry.sessionCount === sessionCount,
  );
  if (result === undefined) {
    throw new Error(
      `Missing benchmark result ${scenario}/${String(sessionCount)}`,
    );
  }
  return result;
}

function currentEnvironment() {
  const behavior = JSON.parse(
    readFileSync(
      new URL("../packs/behavior/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const resource = JSON.parse(
    readFileSync(
      new URL("../packs/resource/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const cpus = os.cpus();
  return {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    osRelease: os.release(),
    cpuModel: cpus[0]?.model ?? "unknown",
    logicalCpuCount: cpus.length,
    totalMemoryBytes: os.totalmem(),
    behaviorPackVersion: behavior.header.version.join("."),
    resourcePackVersion: resource.header.version.join("."),
    bds: "not captured",
    browser: "not captured",
  };
}

function requireCommit(value) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error("baselineCommit must be a full lowercase Git hash");
  }
  return value;
}

function requireIsoTimestamp(value) {
  if (
    typeof value !== "string" ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error("capturedAt must be a canonical ISO timestamp");
  }
  return value;
}

function option(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index < 0 || arguments_[index + 1] === undefined) {
    throw new Error(`Missing required ${name} value`);
  }
  return arguments_[index + 1];
}

function optionalOption(arguments_, name) {
  const index = arguments_.indexOf(name);
  if (index < 0) return undefined;
  if (arguments_[index + 1] === undefined) {
    throw new Error(`Missing required ${name} value`);
  }
  return arguments_[index + 1];
}

function writeImmutableReport(output, serialized) {
  const outputRoot = fileURLToPath(
    new URL("../docs/benchmarks/web-terminal-routing/", import.meta.url),
  );
  const resolvedOutput = path.resolve(output);
  const relativeOutput = path.relative(outputRoot, resolvedOutput);
  if (
    relativeOutput.startsWith("..") ||
    path.isAbsolute(relativeOutput) ||
    path.extname(resolvedOutput) !== ".json"
  ) {
    throw new Error(
      "Benchmark output must be a JSON file under docs/benchmarks/web-terminal-routing",
    );
  }
  writeFileSync(resolvedOutput, serialized, {
    encoding: "utf8",
    flag: "wx",
  });
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  const arguments_ = process.argv.slice(2);
  const report = runWebTerminalRoutingBenchmark({
    baselineCommit: option(arguments_, "--commit"),
    capturedAt: option(arguments_, "--captured-at"),
    baselineWorktree: option(arguments_, "--baseline-worktree"),
  });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  const output = optionalOption(arguments_, "--output");
  if (output === undefined) {
    process.stdout.write(serialized);
  } else {
    writeImmutableReport(output, serialized);
  }
}
