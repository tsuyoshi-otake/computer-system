import { EventEmitter } from "node:events";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCoalescedEventWriter,
  formatHttpOrigin,
  isPublishedAddressLocal,
  normalizePublicOrigin,
  parseOptionalBooleanFlag,
  selectLanIpv4,
  WebCompanionServer,
} from "../../tools/web-companion-server.mjs";

const servers = [];
const browserInteractionHeaders = {
  "X-Computer-System-Interaction-Schema": "2",
};

function newTestWebCompanionServer(options = {}) {
  return new WebCompanionServer({ autoOpenBrowser: false, ...options });
}

function localNetworkInterfaces() {
  return {
    "Wi-Fi": [{ address: "10.255.10.90", family: "IPv4", internal: false }],
    Loopback: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("Web companion HTTP server", () => {
  it("omits standard ports without mislabeling a plain HTTP listener as HTTPS", () => {
    expect(formatHttpOrigin("10.255.10.90", 80)).toBe("http://10.255.10.90");
    expect(formatHttpOrigin("10.255.10.90", 443)).toBe(
      "http://10.255.10.90:443",
    );
    expect(normalizePublicOrigin("http://10.255.10.90:80")).toBe(
      "http://10.255.10.90",
    );
    expect(normalizePublicOrigin("https://terminal.example.test:443")).toBe(
      "https://terminal.example.test",
    );
  });

  it("coalesces blocked streams without letting keepalive overwrite terminal state", () => {
    const response = new EventEmitter();
    const writes = [];
    let firstWrite = true;
    response.write = (value) => {
      writes.push(JSON.parse(value));
      if (firstWrite) {
        firstWrite = false;
        return false;
      }
      return true;
    };
    response.end = () => undefined;
    const writeEvent = createCoalescedEventWriter(response);

    writeEvent({ type: "state", session: { mode: "writer" } });
    writeEvent({ type: "terminal", terminal: { sequence: 1 } });
    writeEvent({ type: "keepalive" });
    writeEvent({ type: "terminal", terminal: { sequence: 2 } });

    expect(writes).toEqual([{ type: "state", session: { mode: "writer" } }]);
    response.emit("drain");
    expect(writes).toEqual([
      { type: "state", session: { mode: "writer" } },
      { type: "terminal", terminal: { sequence: 2 } },
    ]);
  });

  it("preserves control state and gives terminal replacement an explicit end", () => {
    const response = new EventEmitter();
    const writes = [];
    let firstWrite = true;
    let ended = 0;
    response.write = (value) => {
      writes.push(JSON.parse(value));
      if (firstWrite) {
        firstWrite = false;
        return false;
      }
      return true;
    };
    response.end = () => {
      ended += 1;
    };
    const writeEvent = createCoalescedEventWriter(response);

    writeEvent({ type: "keepalive" });
    writeEvent({ type: "state", session: { access: "out_of_range" } });
    writeEvent({ type: "terminal", terminal: { sequence: 3 } });
    writeEvent({ type: "replaced" });
    writeEvent({ type: "terminal", terminal: { sequence: 4 } });
    response.emit("drain");

    expect(writes).toEqual([{ type: "keepalive" }, { type: "replaced" }]);
    expect(ended).toBe(1);
  });

  it("serves manual PNG illustrations with an image content type", async () => {
    const server = newTestWebCompanionServer({
      bds: new FakeBds(),
      port: 0,
      assetRoot: path.resolve(import.meta.dirname, "../../web"),
    });
    servers.push(server);
    const status = await server.start();

    for (const asset of [
      "desktop-computer-system.png",
      "portable-computer-system.png",
    ]) {
      const response = await fetch(`${status.origin}/assets/manual/${asset}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(1_000);
    }
  });

  it("serves the DOS VGA font with its WOFF content type", async () => {
    const server = newTestWebCompanionServer({
      bds: new FakeBds(),
      port: 0,
      assetRoot: path.resolve(import.meta.dirname, "../../web"),
    });
    servers.push(server);
    const status = await server.start();

    const response = await fetch(
      `${status.origin}/fonts/WebPlus_IBM_VGA_9x16.woff`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("font/woff");
    const font = Buffer.from(await response.arrayBuffer());
    expect(font.subarray(0, 4).toString("ascii")).toBe("wOFF");
    expect(font.byteLength).toBeGreaterThan(20_000);
  });

  it("keeps browser opening disabled when explicitly disabled", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = newTestWebCompanionServer({
      bds,
      host: "0.0.0.0",
      publicHost: "10.255.10.90",
      networkInterfaces: localNetworkInterfaces(),
      port: 0,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);

    expect(launches).toEqual([]);
    expect(bds.commands[0]).not.toContain(" debug ");
    expect(server.status().rangeEnforcement).toBe("three_blocks");
    expect(server.status().browserAutoOpen).toMatchObject({
      enabled: false,
      eligible: false,
      policy: "disabled",
      reason: "explicitly_disabled",
      state: "disabled",
      attempts: 0,
    });
  });

  it("automatically opens a locally published LAN handoff through loopback", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = new WebCompanionServer({
      bds,
      host: "0.0.0.0",
      publicHost: "10.255.10.90",
      networkInterfaces: localNetworkInterfaces(),
      port: 0,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => launches.length === 1);

    expect(new URL(launches[0]).hostname).toBe("127.0.0.1");
    expect(bds.commands[0]).toContain("http://10.255.10.90:");
    expect(server.status().browserAutoOpen).toMatchObject({
      enabled: true,
      eligible: true,
      policy: "local_address",
      reason: null,
      state: "opened",
      attempts: 1,
      opened: 1,
    });
  });

  it("does not launch or exchange a handoff before Bedrock reports ready", async () => {
    const bds = new FakeBds({ autoReady: false });
    const launches = [];
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      autoOpenBrowser: true,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    const status = await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    expect(launches).toEqual([]);
    const waiting = await fetch(`${status.origin}/api/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(waiting.status).toBe(409);
    expect(await waiting.json()).toMatchObject({ code: "not_ready" });

    const sessionId = bds.commands[0].split(" ")[3];
    bds.log(`CS_WEB_SESSION_READY ${JSON.stringify({ sessionId })}`);
    await until(() => launches.length === 1);
    expect((await exchangeHandoffUrl(launches[0])).response.status).toBe(200);
  });

  it("times out an unacknowledged Bedrock activation exactly once", async () => {
    const bds = new FakeBds({ autoReady: false });
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      bedrockActivationTimeoutMs: 20,
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() =>
      bds.commands.some((command) =>
        command.includes("computer_system:web-close"),
      ),
    );
    expect(
      bds.commands.filter((command) =>
        command.includes("computer_system:web-close"),
      ),
    ).toHaveLength(1);
    expect(server.store.activeSessions()).toEqual([]);
  });

  it("keeps the replacement handoff when the superseded final arrives late", async () => {
    const bds = new FakeBds({ autoReady: false });
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      bedrockActivationTimeoutMs: 2_000,
    });
    servers.push(server);
    const status = await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const firstSessionId = bds.commands[0].split(" ")[3];
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-2","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 3);
    const secondResponse = bds.commands.find((command) =>
      command.includes("computer_system:web-response r1-2"),
    );
    const secondSessionId = secondResponse.split(" ")[3];
    bds.log(
      `CS_WEB_SESSION_FINAL ${JSON.stringify({
        sessionId: firstSessionId,
        reason: "late_final",
      })}`,
    );
    bds.log(
      `CS_WEB_SESSION_READY ${JSON.stringify({
        sessionId: secondSessionId,
      })}`,
    );
    const exchanged = await fetch(`${status.origin}/api/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(exchanged.status).toBe(200);
  });

  it("does not automatically open a non-local published address", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = new WebCompanionServer({
      bds,
      host: "0.0.0.0",
      publicHost: "192.0.2.44",
      networkInterfaces: localNetworkInterfaces(),
      port: 0,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);

    expect(launches).toEqual([]);
    expect(server.status().browserAutoOpen).toMatchObject({
      enabled: false,
      eligible: false,
      policy: "local_address",
      reason: "published_address_not_local",
      state: "disabled",
      attempts: 0,
    });
  });

  it("does not infer automatic opening from a custom public origin", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = new WebCompanionServer({
      bds,
      host: "0.0.0.0",
      publicHost: "10.255.10.90",
      publicOrigin: "https://10.255.10.90",
      networkInterfaces: localNetworkInterfaces(),
      port: 0,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);

    expect(launches).toEqual([]);
    expect(bds.commands[0]).toContain("https://10.255.10.90/p/");
    expect(server.status().browserAutoOpen).toMatchObject({
      enabled: false,
      reason: "public_origin_configured",
      state: "disabled",
    });
  });

  it("parses the browser auto-open override as a tri-state flag", () => {
    expect(parseOptionalBooleanFlag(undefined, "FLAG")).toBeUndefined();
    expect(parseOptionalBooleanFlag("1", "FLAG")).toBe(true);
    expect(parseOptionalBooleanFlag("true", "FLAG")).toBe(true);
    expect(parseOptionalBooleanFlag("0", "FLAG")).toBe(false);
    expect(parseOptionalBooleanFlag("false", "FLAG")).toBe(false);
    expect(parseOptionalBooleanFlag("", "FLAG")).toBe(false);
  });

  it("matches only literal addresses assigned to the companion host", () => {
    const interfaces = localNetworkInterfaces();
    expect(isPublishedAddressLocal("10.255.10.90", interfaces)).toBe(true);
    expect(isPublishedAddressLocal("127.0.0.1", interfaces)).toBe(true);
    expect(isPublishedAddressLocal("192.0.2.44", interfaces)).toBe(false);
    expect(isPublishedAddressLocal("localhost", interfaces)).toBe(false);
    expect(isPublishedAddressLocal("terminal.example.test", interfaces)).toBe(
      false,
    );
  });

  it("disables only the Bedrock range check when explicitly enabled for debug", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      debugIgnoreRange: true,
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);

    expect(bds.commands[0]).toMatch(
      /^scriptevent computer_system:web-response r1-1 [A-Za-z0-9_-]+ viewer debug http:\/\//u,
    );
    expect(server.status().rangeEnforcement).toBe("disabled_for_debug");
  });

  it("opens each loopback handoff once when explicitly enabled", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      autoOpenBrowser: true,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => launches.length === 1);
    const handoffUrl = bds.commands[0].split(" ").at(-1);

    expect(launches).toEqual([handoffUrl]);
    expect(server.status().browserAutoOpen).toMatchObject({
      enabled: true,
      eligible: true,
      state: "opened",
      attempts: 1,
      opened: 1,
      failed: 0,
    });
  });

  it("delivers a computer-scoped handoff to MCP without racing browser auto-open", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = new WebCompanionServer({
      bds,
      host: "0.0.0.0",
      publicHost: "10.255.10.90",
      networkInterfaces: localNetworkInterfaces(),
      port: 0,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    await server.start();

    const waiting = server.waitForHandoff({
      computerId: "c-000001",
      timeoutMs: 1_000,
    });
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    const handoff = await waiting;

    expect(handoff).toMatchObject({
      computerId: "c-000001",
      mode: "viewer",
    });
    expect(handoff.url).toBe(bds.commands[0].split(" ").at(-1));
    expect(handoff.expiresAt).toBeGreaterThan(Date.now());
    expect(launches).toEqual([]);
  });

  it("does not let a simultaneous Player handoff satisfy a debug-principal MCP wait", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    await server.start();

    const waiting = server.waitForHandoff({
      computerId: "c-000001",
      principalKind: "debug",
      timeoutMs: 1_000,
    });
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","principalKind":"player","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(server.pendingHandoffs.has("c-000001")).toBe(true);

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-2","playerId":"mcp-debug","principalKind":"debug","computerId":"c-000001"}',
    );
    await expect(waiting).resolves.toMatchObject({
      computerId: "c-000001",
      principalKind: "debug",
    });
    expect(server.pendingHandoffs.size).toBe(0);
  });

  it("opens an MCP-claimed handoff and observes the exact browser writer", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      autoOpenBrowser: true,
      browserOpener: async (url) => {
        launches.push(url);
        await exchangeHandoffUrl(url);
      },
    });
    servers.push(server);
    await server.start();

    const waiting = server.waitForHandoff({
      computerId: "c-000001",
      timeoutMs: 1_000,
    });
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    const handoff = await waiting;
    await expect(
      server.openHandoffInBrowser(handoff, { timeoutMs: 1_000 }),
    ).resolves.toMatchObject({
      computerId: "c-000001",
      mode: "writer",
      state: "issued",
    });
    expect(launches).toHaveLength(1);
    expect(server.store.activeSession(handoff.sessionId)).toMatchObject({
      computerId: "c-000001",
      mode: "writer",
    });
  });

  it("captures, waits for, and drives the exact debug-owned TUI writer", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    await server.start();
    const handoff = await connectDebugWriter(server, bds);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(tuiSnapshot(handoff.sessionId))}`,
    );
    await until(
      () =>
        server.store.activeSession(handoff.sessionId)?.terminalVersion === 1,
    );
    expect(
      server.store.activeSession(handoff.sessionId)?.terminal?.terminal,
    ).toMatchObject({ replacementEpoch: 0, terminalRevision: 0 });
    const captured = server.captureTuiScreen({
      computerId: "c-000001",
      sessionId: handoff.sessionId,
      includeColors: true,
    });
    expect(captured).toMatchObject({
      schema: 1,
      computerId: "c-000001",
      sessionId: handoff.sessionId,
      principalKind: "debug",
      mode: "writer",
      access: "in_range",
      snapshotVersion: 1,
      surface: {
        kind: "text",
        schema: 1,
        width: 8,
        height: 2,
        rows: ["EDIT    ", "File    "],
        cursor: { x: 2, y: 1, blink: true },
      },
    });
    expect(captured.surface.foreground).toEqual([
      [7, 7, 7, 7, 7, 7, 7, 7],
      [7, 7, 7, 7, 7, 7, 7, 7],
    ]);
    expect(captured.surface.background).toEqual([
      [1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1],
    ]);
    for (const forbidden of [
      "token",
      "url",
      "connectionCode",
      "playerId",
      "audio",
      "storage",
    ]) {
      expect(captured).not.toHaveProperty(forbidden);
    }

    await expect(
      server.sendTuiInput({
        computerId: "c-000001",
        sessionId: handoff.sessionId,
        kind: "keys",
        value: ["Alt+f"],
      }),
    ).resolves.toEqual({ outcome: "accepted" });
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ [A-Za-z0-9_-]{6,20} 1 keys /u,
    );

    const waiting = server.waitForTuiScreen({
      computerId: "c-000001",
      sessionId: handoff.sessionId,
      contains: "Options",
      afterVersion: captured.snapshotVersion,
      timeoutMs: 1_000,
    });
    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(handoff.sessionId, {
          rows: ["EDIT    ", "Options "],
        }),
      )}`,
    );
    await expect(waiting).resolves.toMatchObject({
      snapshotVersion: 2,
      surface: { rows: ["EDIT    ", "Options "] },
    });
    expect(server.pendingTuiWaits.size).toBe(0);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(handoff.sessionId, { secretInput: true }),
      )}`,
    );
    expect(() =>
      server.captureTuiScreen({
        computerId: "c-000001",
        sessionId: handoff.sessionId,
      }),
    ).toThrow(/secret input/u);
    await expect(
      server.sendTuiInput({
        computerId: "c-000001",
        sessionId: handoff.sessionId,
        kind: "line",
        value: "must-not-enter-a-secret-prompt",
      }),
    ).rejects.toThrow(/non-secret terminal frame/u);
  });

  it("rejects Player-owned TUI sessions from the MCP inspection boundary", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","principalKind":"player","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const sessionId = bds.commands[0].split(" ")[3];
    await consumeResponse(bds.commands[0]);
    bds.log(`CS_WEB_TERMINAL ${JSON.stringify(tuiSnapshot(sessionId))}`);

    expect(() =>
      server.captureTuiScreen({ computerId: "c-000001", sessionId }),
    ).toThrow(/not owned by the MCP debug principal/u);
  });

  it("finalizes one event-driven TUI wait on writer closure and bounds wait capacity", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    await server.start();
    const handoff = await connectDebugWriter(server, bds);
    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(tuiSnapshot(handoff.sessionId))}`,
    );

    const waiting = server.waitForTuiScreen({
      computerId: "c-000001",
      sessionId: handoff.sessionId,
      contains: "never-present",
      timeoutMs: 1_000,
    });
    expect(() =>
      server.waitForTuiScreen({
        computerId: "c-000001",
        sessionId: handoff.sessionId,
        contains: "duplicate",
        timeoutMs: 1_000,
      }),
    ).toThrow(/already active/u);
    bds.state("idle");
    await expect(waiting).rejects.toThrow(/no longer active|BDS stopped/u);
    expect(server.pendingTuiWaits.size).toBe(0);

    const replacement = await connectDebugWriter(server, bds);
    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(tuiSnapshot(replacement.sessionId))}`,
    );
    for (let index = 0; index < 8; index += 1) {
      server.pendingTuiWaits.set(`occupied-${String(index)}`, {});
    }
    expect(() =>
      server.waitForTuiScreen({
        computerId: "c-000001",
        sessionId: replacement.sessionId,
        contains: "capacity",
      }),
    ).toThrow(/capacity/u);
    server.pendingTuiWaits.clear();

    await expect(
      server.waitForTuiScreen({
        computerId: "c-000001",
        sessionId: replacement.sessionId,
        contains: "still-never-present",
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/Timed out after 10 ms/u);
    expect(server.pendingTuiWaits.size).toBe(0);
    expect(() =>
      server.waitForTuiScreen({
        computerId: "c-000001",
        sessionId: replacement.sessionId,
        contains: "x".repeat(501),
      }),
    ).toThrow(/1 to 500/u);
  });

  it("rejects malformed TUI geometry, colors, and cursors instead of truncating", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    await server.start();
    const handoff = await connectDebugWriter(server, bds);
    const identity = {
      computerId: "c-000001",
      sessionId: handoff.sessionId,
    };

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(handoff.sessionId, {
          width: 201,
          rows: ["x".repeat(201), "y".repeat(201)],
        }),
      )}`,
    );
    expect(() => server.captureTuiScreen(identity)).toThrow(/text surface/u);

    const invalidForeground = [
      [16, 7, 7, 7, 7, 7, 7, 7],
      [7, 7, 7, 7, 7, 7, 7, 7],
    ];
    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(handoff.sessionId, {
          foreground: invalidForeground,
        }),
      )}`,
    );
    expect(() => server.captureTuiScreen(identity)).toThrow(/foreground/u);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(handoff.sessionId, {
          cursor: { x: 10, y: 1, blink: true },
        }),
      )}`,
    );
    expect(() => server.captureTuiScreen(identity)).toThrow(/cursor/u);
  });

  it("fails MCP browser opening explicitly when host auto-open is disabled", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      autoOpenBrowser: false,
    });
    servers.push(server);
    await server.start();

    const waiting = server.waitForHandoff({
      computerId: "c-000001",
      timeoutMs: 1_000,
    });
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    const handoff = await waiting;
    await expect(
      server.openHandoffInBrowser(handoff, { timeoutMs: 100 }),
    ).rejects.toThrow(/explicitly_disabled/u);
  });

  it("bounds and finalizes computer-scoped handoff waits", async () => {
    const server = newTestWebCompanionServer({ bds: new FakeBds(), port: 0 });
    servers.push(server);
    await server.start();

    await expect(
      server.waitForHandoff({ computerId: "c-000001", timeoutMs: 10 }),
    ).rejects.toThrow("Timed out after 10 ms");
    expect(() =>
      server.waitForHandoff({ computerId: "invalid", timeoutMs: 10 }),
    ).toThrow("c-xxxxxx");
  });

  it("explicitly finalizes a handoff wait when its Bedrock request fails", async () => {
    const server = newTestWebCompanionServer({ bds: new FakeBds(), port: 0 });
    servers.push(server);
    await server.start();

    const waiting = server.waitForHandoff({
      computerId: "c-000001",
      timeoutMs: 1_000,
    });
    expect(server.rejectPendingHandoff("c-000001", "request failed")).toBe(
      true,
    );
    await expect(waiting).rejects.toThrow("request failed");
    expect(server.rejectPendingHandoff("c-000001", "late failure")).toBe(false);
  });

  it("opens a LAN handoff through loopback on the companion host", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = newTestWebCompanionServer({
      bds,
      host: "127.0.0.1",
      port: 0,
      publicHost: "192.0.2.1",
      autoOpenBrowser: true,
      browserOpener: async (url) => launches.push(url),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    await until(() => launches.length === 1);

    expect(launches).toHaveLength(1);
    expect(launches[0]).toMatch(/^http:\/\/127\.0\.0\.1:/u);
    expect(bds.commands[0]).toContain("http://192.0.2.1:");
    const localOrigin = new URL(launches[0]).origin;
    const { token } = await exchangeHandoffUrl(launches[0]);
    await publishShellTerminal(server, bds, token);
    const input = await post(localOrigin, "/api/input", token, {
      kind: "line",
      value: "local-auto-open",
    });
    expect(input.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(/ line local-auto-open$/u);
    expect(server.status().browserAutoOpen).toMatchObject({
      enabled: true,
      eligible: true,
      state: "opened",
      attempts: 1,
    });
  });

  it("accepts an explicit custom HTTPS origin without allowing arbitrary origins", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({
      bds,
      host: "127.0.0.1",
      port: 0,
      publicOrigin: "https://terminal.example.com",
    });
    servers.push(server);
    const status = await server.start();
    const localOrigin = `http://127.0.0.1:${String(status.port)}`;
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);

    const accepted = await fetch(`${localOrigin}/api/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(accepted.status).toBe(200);

    const rejected = await fetch(`${localOrigin}/api/close`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: "{}",
    });
    expect(rejected.status).toBe(403);
  });

  it("accepts any request Origin only when wildcard mode is explicit", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({
      allowedOrigins: "*",
      bds,
      host: "127.0.0.1",
      port: 0,
    });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);

    const response = await fetch(`${status.origin}/api/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://arbitrary.example",
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(response.status).toBe(200);
  });

  it("selects a physical LAN IPv4 address ahead of virtual adapters", () => {
    expect(
      selectLanIpv4({
        CloudflareWARP: [
          { address: "172.16.0.2", family: "IPv4", internal: false },
        ],
        "Wi-Fi 2": [
          { address: "10.255.10.90", family: "IPv4", internal: false },
        ],
        "vEthernet (WSL)": [
          { address: "172.28.0.1", family: "IPv4", internal: false },
        ],
      }),
    ).toBe("10.255.10.90");
  });

  it("rate-limits four-digit connection-code guessing per client", async () => {
    const server = newTestWebCompanionServer({ bds: new FakeBds(), port: 0 });
    servers.push(server);
    const status = await server.start();

    for (let attempt = 0; attempt < 9; attempt += 1) {
      expect(
        (
          await fetch(`${status.origin}/p/9999`, {
            redirect: "manual",
          })
        ).status,
      ).toBe(302);
    }
    const attempt = () =>
      fetch(`${status.origin}/api/handoff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: status.origin,
        },
        body: JSON.stringify({ code: "9999" }),
      });
    for (let invalid = 0; invalid < 8; invalid += 1) {
      expect((await attempt()).status).toBe(401);
    }
    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("exchanges a four-digit code without leaving the stable entry page", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);

    const response = await fetch(`${status.origin}/api/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).token).toMatch(/^[A-Za-z0-9_-]{20,}$/u);
  });

  it("keeps the chat handoff usable when browser opening fails", async () => {
    const bds = new FakeBds();
    const diagnostics = [];
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      autoOpenBrowser: true,
      browserOpener: async () => {
        throw new Error("browser unavailable");
      },
      writeDiagnostic: (line) => diagnostics.push(line),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => server.status().browserAutoOpen.failed === 1);
    const handoffUrl = bds.commands[0].split(" ").at(-1);

    expect((await fetch(handoffUrl, { redirect: "manual" })).status).toBe(302);
    expect(server.status().browserAutoOpen).toMatchObject({
      state: "failed",
      attempts: 1,
      opened: 0,
      failed: 1,
      lastError: "browser unavailable",
    });
    expect(diagnostics).toEqual([
      "Web companion browser launch failed: browser unavailable",
    ]);
  });

  it("issues a one-use handoff and relays authenticated terminal input", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      assetRoot: path.resolve(import.meta.dirname, "../../web"),
    });
    servers.push(server);
    const status = await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const responseCommand = bds.commands[0];
    expect(responseCommand.split(" ").at(-2)).toBe("viewer");
    const handoffUrl = responseCommand.split(" ").at(-1);
    const handoff = await fetch(handoffUrl, { redirect: "manual" });
    expect(handoff.status).toBe(302);
    const location = handoff.headers.get("location");
    expect(location).toBe("/?computer=0001&handoff=1");
    const redirect = new URL(location, status.origin);
    expect([...redirect.searchParams]).toEqual([
      ["computer", "0001"],
      ["handoff", "1"],
    ]);
    expect(redirect.hash).toBe("");
    expect((await fetch(handoffUrl, { redirect: "manual" })).status).toBe(302);
    const { token } = await exchangeHandoffUrl(handoffUrl);
    const sessionId = server.store.activeSessions()[0].sessionId;
    const reused = await fetch(`${status.origin}/api/handoff`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(reused.status).toBe(401);

    expect((await fetch(`${status.origin}/api/session`)).status).toBe(401);
    const incompatibleSession = await fetch(`${status.origin}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(incompatibleSession.status).toBe(426);
    expect(await incompatibleSession.json()).toMatchObject({
      code: "interaction_protocol_mismatch",
    });
    const sessionResponse = await fetch(`${status.origin}/api/session`, {
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
      },
    });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({
      computerId: "c-000001",
      mode: "writer",
      state: "issued",
    });

    const commandCountBeforeReadyRejection = bds.commands.length;
    const notReady = await fetch(status.origin + "/api/input", {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ kind: "line", value: "echo premature" }),
    });
    expect(notReady.status).toBe(409);
    expect(await notReady.json()).toMatchObject({ code: "terminal_not_ready" });
    expect(bds.commands).toHaveLength(commandCountBeforeReadyRejection);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(sessionId, { interaction: shellInteraction() }),
      )}`,
    );

    const commandCountBeforeModeRejection = bds.commands.length;
    const staleGeneration = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        interactionGeneration: 0,
        kind: "line",
        value: "stale",
      }),
    });
    expect(staleGeneration.status).toBe(409);
    expect(await staleGeneration.json()).toMatchObject({
      code: "input_mode_changed",
    });
    expect(bds.commands).toHaveLength(commandCountBeforeModeRejection);

    const wrongMode = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        interactionGeneration: 1,
        kind: "keys",
        value: ["F1"],
      }),
    });
    expect(wrongMode.status).toBe(409);
    expect(await wrongMode.json()).toMatchObject({
      code: "input_mode_changed",
    });
    expect(bds.commands).toHaveLength(commandCountBeforeModeRejection);

    const idleInterrupt = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ interactionGeneration: 1, kind: "interrupt" }),
    });
    expect(idleInterrupt.status).toBe(409);
    expect(await idleInterrupt.json()).toMatchObject({
      code: "input_mode_changed",
    });
    expect(bds.commands).toHaveLength(commandCountBeforeModeRejection);

    const abortLine = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ interactionGeneration: 1, kind: "abort-line" }),
    });
    expect(abortLine.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      new RegExp(
        `^scriptevent computer_system:web-input ${sessionId} [A-Za-z0-9_-]{6,20} 1 abort-line $`,
        "u",
      ),
    );

    const input = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        interactionGeneration: 1,
        kind: "line",
        value: "hello world",
      }),
    });
    expect(input.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ [A-Za-z0-9_-]{6,20} 1 line hello%20world$/u,
    );

    const unavailableEof = await post(status.origin, "/api/input", token, {
      interactionGeneration: 1,
      kind: "eof",
    });
    expect(unavailableEof.status).toBe(409);
    expect(await unavailableEof.json()).toMatchObject({
      code: "input_mode_changed",
    });

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(sessionId, {
          interaction: {
            ...shellInteraction(),
            context: "python-repl",
            eof: true,
            history: false,
          },
        }),
      )}`,
    );
    const eof = await post(status.origin, "/api/input", token, {
      interactionGeneration: 1,
      kind: "eof",
    });
    expect(eof.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ [A-Za-z0-9_-]{6,20} 1 eof$/u,
    );
    const eofValue = await post(status.origin, "/api/input", token, {
      interactionGeneration: 1,
      kind: "eof",
      value: "forbidden",
    });
    expect(eofValue.status).toBe(400);
    expect(bds.commands.at(-1)).toMatch(/ 1 eof$/u);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(sessionId, {
          interaction: {
            ...shellInteraction(),
            context: "dos-prompt",
            ctrlCAction: "cancel",
            history: false,
            inputMode: "keys",
            hints: [{ key: "Choice", label: "Select" }],
          },
        }),
      )}`,
    );
    const choiceKey = await post(status.origin, "/api/input", token, {
      interactionGeneration: 1,
      kind: "keys",
      value: ["N"],
    });
    expect(choiceKey.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ [A-Za-z0-9_-]{6,20} 1 keys %5B%22N%22%5D$/u,
    );

    bds.log(`CS_WEB_TERMINAL ${JSON.stringify(tuiSnapshot(sessionId))}`);

    const keys = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        interactionGeneration: 1,
        kind: "keys",
        value: ["i", "x", "Escape"],
      }),
    });
    expect(keys.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ [A-Za-z0-9_-]{6,20} 1 keys %5B%22i%22%2C%22x%22%2C%22Escape%22%5D$/u,
    );

    const commandAfterKeys = bds.commands.at(-1);
    const editorAbort = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ interactionGeneration: 1, kind: "abort-line" }),
    });
    expect(editorAbort.status).toBe(409);
    expect(await editorAbort.json()).toMatchObject({
      code: "input_mode_changed",
    });
    expect(bds.commands.at(-1)).toBe(commandAfterKeys);

    const mouse = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        interactionGeneration: 1,
        kind: "mouse",
        value: { action: "down", button: 0, sequence: 1, x: 12, y: 4 },
      }),
    });
    expect(mouse.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ [A-Za-z0-9_-]{6,20} 1 mouse /u,
    );

    const invalidMouse = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        interactionGeneration: 1,
        kind: "mouse",
        value: { action: "move", button: 0, sequence: 2, x: 81, y: 4 },
      }),
    });
    expect(invalidMouse.status).toBe(400);

    const invalidResize = await fetch(`${status.origin}/api/resize`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ width: 120, height: 40 }),
    });
    expect(invalidResize.status).toBe(400);

    const resize = await fetch(`${status.origin}/api/resize`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ width: 80, height: 25 }),
    });
    expect(resize.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-resize [A-Za-z0-9_-]+ 80 25$/u,
    );

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(sessionId, { interaction: shellInteraction() }),
      )}`,
    );

    const completionRequest = fetch(`${status.origin}/api/complete`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        cursor: 3,
        interactionGeneration: 1,
        value: "who",
      }),
    });
    await until(() => bds.commands.at(-1)?.includes("web-complete"));
    const completionCommand = bds.commands.at(-1).split(" ");
    bds.log(
      `CS_WEB_COMPLETION ${JSON.stringify({
        cursor: 7,
        outcome: "applied",
        requestId: completionCommand[3],
        sessionId: completionCommand[2],
        truncated: false,
        value: "whoami ",
      })}`,
    );
    const completion = await completionRequest;
    expect(completion.status).toBe(200);
    expect(await completion.json()).toEqual({
      cursor: 7,
      outcome: "applied",
      truncated: false,
      value: "whoami ",
    });

    const invalidKeys = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({
        interactionGeneration: 1,
        kind: "keys",
        value: Array(33).fill("x"),
      }),
    });
    expect(invalidKeys.status).toBe(400);
  });

  it.each([
    {
      label: "missing interaction",
      mutate: (snapshot) => delete snapshot.terminal.interaction,
    },
    {
      label: "missing terminal revision metadata",
      mutate: (snapshot) => delete snapshot.terminal.terminalRevision,
    },
    {
      label: "negative replacement epoch",
      mutate: (snapshot) => {
        snapshot.terminal.replacementEpoch = -1;
      },
    },
    {
      label: "unknown cursor shape",
      mutate: (snapshot) => {
        snapshot.terminal.interaction.cursorShape = "beam";
      },
    },
    {
      label: "history outside line mode",
      mutate: (snapshot) => {
        snapshot.terminal.interaction.history = true;
      },
    },
  ])("closes the exact session for $label", async ({ mutate }) => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      assetRoot: path.resolve(import.meta.dirname, "../../web"),
    });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    await exchangeHandoffUrl(bds.commands[0].split(" ").at(-1));
    const sessionId = server.store.activeSessions()[0].sessionId;
    const incompatible = tuiSnapshot(sessionId);
    mutate(incompatible);
    bds.log(`CS_WEB_TERMINAL ${JSON.stringify(incompatible)}`);

    await until(() => server.store.activeSessions().length === 0);
    expect(
      bds.commands.filter(
        (command) =>
          command === `scriptevent computer_system:web-close ${sessionId}`,
      ),
    ).toHaveLength(1);
  });

  it("keeps the exact session open for a CS ABI foreground snapshot", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const { token } = await exchangeHandoffUrl(
      bds.commands[0].split(" ").at(-1),
    );
    const sessionId = server.store.activeSessions()[0].sessionId;
    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(sessionId, { interaction: csAbiInteraction() }),
      )}`,
    );

    await until(
      () =>
        server.store.authenticate(token).terminal?.terminal?.interaction
          ?.context === "cs-abi",
    );
    expect(server.store.activeSessions()).toHaveLength(1);
  });

  it("returns input success only after the matching Bedrock admission marker", async () => {
    const bds = new FakeBds({ autoInputAck: false });
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);
    await publishShellTerminal(server, bds, connected.token);

    const pending = post(status.origin, "/api/input", connected.token, {
      kind: "line",
      value: "correlated",
    });
    await until(() =>
      bds.commands.some((command) =>
        command.includes("computer_system:web-input"),
      ),
    );
    const command = bds.commands.find((value) =>
      value.includes("computer_system:web-input"),
    );
    const [, , sessionId, requestId] = command.split(" ");
    expect(server.pendingInputs.size).toBe(1);
    bds.log(
      `CS_WEB_INPUT ${JSON.stringify({
        outcome: "accepted",
        requestId,
        sessionId: "wrong-session",
      })}`,
    );
    expect(server.pendingInputs.size).toBe(1);

    bds.log(
      `CS_WEB_INPUT ${JSON.stringify({
        outcome: "accepted",
        requestId,
        sessionId,
      })}`,
    );
    const response = await pending;
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ outcome: "accepted" });
    expect(server.pendingInputs.size).toBe(0);
  });

  it("maps every rejected Bedrock input admission to an explicit HTTP result", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);
    await publishShellTerminal(server, bds, connected.token);

    const cases = [
      {
        error: undefined,
        outcome: "ignored",
        reason: "not_running",
        status: 409,
        code: "input_ignored",
      },
      {
        error: undefined,
        outcome: "missing",
        reason: undefined,
        status: 410,
        code: "input_missing",
      },
      {
        error: "runtime failed",
        outcome: "failed",
        reason: undefined,
        status: 503,
        code: "input_failed",
      },
      {
        error: "event limit exceeded",
        outcome: "failed",
        reason: undefined,
        status: 429,
        code: "input_busy",
      },
    ];
    for (const testCase of cases) {
      bds.inputError = testCase.error;
      bds.inputOutcome = testCase.outcome;
      bds.inputReason = testCase.reason;
      const response = await post(
        status.origin,
        "/api/input",
        connected.token,
        {
          kind: "line",
          value: "bounded",
        },
      );
      expect(response.status).toBe(testCase.status);
      expect(await response.json()).toMatchObject({ code: testCase.code });
      if (testCase.status === 429) {
        expect(response.headers.get("retry-after")).toBe("1");
      }
      expect(server.pendingInputs.size).toBe(0);
    }
  });

  it("times out input admission, cleans it once, and ignores a late marker", async () => {
    const bds = new FakeBds({ autoInputAck: false });
    const server = newTestWebCompanionServer({
      bds,
      inputTimeoutMs: 20,
      port: 0,
    });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);
    await publishShellTerminal(server, bds, connected.token);

    const response = await post(status.origin, "/api/input", connected.token, {
      kind: "line",
      value: "timeout",
    });
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: "input_timeout" });
    expect(server.pendingInputs.size).toBe(0);

    const command = bds.commands.find((value) =>
      value.includes("computer_system:web-input"),
    );
    const [, , sessionId, requestId] = command.split(" ");
    bds.log(
      `CS_WEB_INPUT ${JSON.stringify({
        outcome: "accepted",
        requestId,
        sessionId,
      })}`,
    );
    expect(server.pendingInputs.size).toBe(0);
  });

  it("bounds pending input admissions at capacity plus one and finalizes them on BDS failure", async () => {
    const bds = new FakeBds({ autoInputAck: false });
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    await server.start();

    const pending = Array.from({ length: 32 }, (_, index) =>
      server
        .requestInputAdmission("abcdefghijkl", "line", `value-${String(index)}`)
        .then(
          () => undefined,
          (error) => error,
        ),
    );
    expect(server.pendingInputs.size).toBe(32);
    const overflow = await server
      .requestInputAdmission("abcdefghijkl", "line", "overflow")
      .then(
        () => undefined,
        (error) => error,
      );
    expect(overflow).toMatchObject({
      code: "input_busy",
      retryAfterSeconds: 1,
      status: 429,
    });
    expect(server.pendingInputs.size).toBe(32);

    bds.state("failed");
    const results = await Promise.all(pending);
    expect(results.every((error) => error?.code === "closed")).toBe(true);
    expect(server.pendingInputs.size).toBe(0);

    const [, , sessionId, requestId] = bds.commands[0].split(" ");
    bds.log(
      `CS_WEB_INPUT ${JSON.stringify({
        outcome: "accepted",
        requestId,
        sessionId,
      })}`,
    );
    expect(server.pendingInputs.size).toBe(0);
  });

  it("finalizes a pending input when the BDS relay itself fails", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);
    await publishShellTerminal(server, bds, connected.token);
    const relay = bds.runWebRelay.bind(bds);
    bds.runWebRelay = async (command) => {
      if (command.includes("computer_system:web-input")) {
        bds.commands.push(command);
        throw new Error("relay unavailable");
      }
      return relay(command);
    };

    const response = await post(status.origin, "/api/input", connected.token, {
      kind: "line",
      value: "relay-failure",
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "companion_unavailable",
      error: "The terminal input relay is temporarily unavailable.",
    });
    expect(server.pendingInputs.size).toBe(0);
  });

  it("accepts snapshots only for issued sessions and blocks cross-origin writes", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const sessionId = bds.commands[0].split(" ")[3];
    const handoffUrl = bds.commands[0].split(" ").at(-1);
    const { token } = await exchangeHandoffUrl(handoffUrl);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify(
        tuiSnapshot(sessionId, {
          interaction: shellInteraction(),
          label: "Portable One",
        }),
      )}`,
    );
    await until(async () => {
      const response = await fetch(`${status.origin}/api/session`, {
        headers: {
          ...browserInteractionHeaders,
          Authorization: `Bearer ${token}`,
        },
      });
      return (await response.json()).terminal !== null;
    });
    const session = await fetch(`${status.origin}/api/session`, {
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
      },
    }).then((response) => response.json());
    expect(session.terminal).toMatchObject({ label: "Portable One" });

    const rejected = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        ...browserInteractionHeaders,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: JSON.stringify({ kind: "line", value: "help" }),
    });
    expect(rejected.status).toBe(403);
  });

  it("relays bounded writer-only power requests and waits for Bedrock finalization", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);

    const pending = post(status.origin, "/api/power", connected.token, {
      action: "shutdown",
    });
    await until(() =>
      bds.commands.at(-1)?.includes("computer_system:web-power"),
    );
    const [, , sessionId, requestId, action] = bds.commands.at(-1).split(" ");
    expect(action).toBe("shutdown");
    bds.log(
      `CS_WEB_POWER ${JSON.stringify({
        action,
        lifecycle: "stopping",
        outcome: "accepted",
        requestId,
        sessionId,
      })}`,
    );
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      lifecycle: "stopping",
      outcome: "accepted",
    });

    const safeBootPending = post(status.origin, "/api/power", connected.token, {
      action: "safe_boot",
    });
    await until(() => bds.commands.at(-1)?.endsWith(" safe_boot"));
    const [, , safeSessionId, safeRequestId, safeAction] = bds.commands
      .at(-1)
      .split(" ");
    bds.log(
      `CS_WEB_POWER ${JSON.stringify({
        action: safeAction,
        lifecycle: "booting",
        outcome: "accepted",
        requestId: safeRequestId,
        sessionId: safeSessionId,
      })}`,
    );
    expect(await safeBootPending.then((result) => result.json())).toMatchObject(
      {
        action: "safe_boot",
        lifecycle: "booting",
        outcome: "accepted",
      },
    );

    expect(
      (
        await post(status.origin, "/api/power", connected.token, {
          action: "reset",
        })
      ).status,
    ).toBe(400);
    server.store.updateAccess(sessionId, "out_of_range");
    expect(
      (
        await post(status.origin, "/api/power", connected.token, {
          action: "power_on",
        })
      ).status,
    ).toBe(409);
  });

  it("relays writer-only floppy eject and waits for an explicit terminal outcome", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);

    const pending = post(
      status.origin,
      "/api/floppy/eject",
      connected.token,
      {},
    );
    await until(() =>
      bds.commands.at(-1)?.includes("computer_system:web-floppy-eject"),
    );
    const [, , sessionId, requestId] = bds.commands.at(-1).split(" ");
    bds.log(
      `CS_WEB_FLOPPY_EJECT ${JSON.stringify({
        outcome: "ejected",
        requestId,
        sessionId,
      })}`,
    );
    expect(await pending.then((response) => response.json())).toMatchObject({
      outcome: "ejected",
    });

    const empty = post(status.origin, "/api/floppy/eject", connected.token, {});
    await until(() => bds.commands.at(-1)?.endsWith(" e00002"));
    const [, , emptySessionId, emptyRequestId] = bds.commands.at(-1).split(" ");
    bds.log(
      `CS_WEB_FLOPPY_EJECT ${JSON.stringify({
        outcome: "empty",
        requestId: emptyRequestId,
        sessionId: emptySessionId,
      })}`,
    );
    expect(await empty.then((response) => response.json())).toMatchObject({
      outcome: "empty",
    });

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-2","playerId":"player-2","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 5);
    await consumeResponse(bds.commands[4]);
    expect(
      (await post(status.origin, "/api/floppy/eject", connected.token, {}))
        .status,
    ).toBe(409);
  });

  it("gives the newest browser control and rejects the demoted writer", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();

    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const first = await consumeResponse(bds.commands[0]);
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-2","playerId":"player-2","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 3);
    expect(bds.commands[2].split(" ").at(-2)).toBe("viewer");
    const second = await consumeResponse(bds.commands[2]);
    await publishShellTerminal(server, bds, second.token);

    const rejected = await post(status.origin, "/api/input", second.token, {
      kind: "line",
      value: "new-writer",
    });
    expect(rejected.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(/ line new-writer$/u);

    expect(
      (
        await post(status.origin, "/api/input", first.token, {
          kind: "line",
          value: "old-writer",
        })
      ).status,
    ).toBe(409);
  });

  it("still reconnects an in-range code whose activation was already spent", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);
    await publishShellTerminal(server, bds, connected.token);
    const session = server.store.activeSessions()[0];
    expect(session.access).toBe("in_range");

    // A browser holding no token types the permanent four-digit number. The
    // activation is already spent, so the one-use exchange has nothing left to
    // give, but the session that number owns is still in range and reconnectable.
    const spent = await fetch(`${status.origin}/api/handoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: status.origin },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(spent.status).toBe(401);
    expect(await spent.json()).toMatchObject({ code: "unauthorized" });

    const reconnected = await fetch(`${status.origin}/api/reconnect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: status.origin },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(reconnected.status).toBe(200);
    const replacement = await reconnected.json();
    expect(replacement.token).not.toBe(connected.token);
    expect(replacement.session).toMatchObject({
      access: "in_range",
      connectionCode: "0001",
      sessionId: session.sessionId,
    });
    expect(
      (
        await fetch(`${status.origin}/api/session`, {
          headers: {
            Authorization: `Bearer ${connected.token}`,
            "x-computer-system-interaction-schema": "2",
          },
        })
      ).status,
    ).toBe(401);
  });

  it("reconnects a remembered code only after proximity resumes", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);
    await publishShellTerminal(server, bds, connected.token);
    const session = server.store.activeSessions()[0];
    server.store.updateAccess(session.sessionId, "out_of_range");

    expect(
      (
        await post(status.origin, "/api/input", connected.token, {
          kind: "line",
          value: "must-not-relay",
        })
      ).status,
    ).toBe(409);
    expect(bds.commands).toHaveLength(2);
    const waiting = await fetch(`${status.origin}/api/reconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(waiting.status).toBe(409);

    server.store.updateAccess(session.sessionId, "in_range");
    const resumed = await fetch(`${status.origin}/api/reconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(resumed.status).toBe(200);
    const replacement = await resumed.json();
    expect(replacement.token).not.toBe(connected.token);
    await publishShellTerminal(server, bds, replacement.token);
    expect(
      (
        await post(status.origin, "/api/input", replacement.token, {
          kind: "line",
          value: "resumed",
        })
      ).status,
    ).toBe(202);
    expect(bds.commands.at(-1)).toMatch(/ line resumed$/u);
  });

  it("allows an existing out-of-range session to reconnect in explicit debug mode", async () => {
    const bds = new FakeBds();
    const server = newTestWebCompanionServer({
      bds,
      port: 0,
      debugIgnoreRange: true,
    });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const connected = await consumeResponse(bds.commands[0]);
    await publishShellTerminal(server, bds, connected.token);
    const session = server.store.activeSessions()[0];
    server.store.updateAccess(session.sessionId, "out_of_range");

    expect(
      (
        await post(status.origin, "/api/input", connected.token, {
          kind: "line",
          value: "debug-input",
        })
      ).status,
    ).toBe(202);
    const resumed = await fetch(`${status.origin}/api/reconnect`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ code: "0001" }),
    });
    expect(resumed.status).toBe(200);
    expect((await resumed.json()).session.access).toBe("in_range");
  });

  it("serializes and bounds terminal operations per computer", async () => {
    const server = newTestWebCompanionServer();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const order = [];
    const queued = Array.from({ length: 8 }, (_, index) =>
      server.serializeComputerOperation("c-000001", async () => {
        order.push(`start-${String(index)}`);
        if (index === 0) await gate;
        order.push(`end-${String(index)}`);
        return index;
      }),
    );
    await until(() => order.length === 1);
    expect(order).toEqual(["start-0"]);
    await expect(
      server.serializeComputerOperation("c-000001", async () => 9),
    ).rejects.toMatchObject({ code: "computer_busy", status: 429 });

    release();
    await expect(Promise.all(queued)).resolves.toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(order).toEqual([
      "start-0",
      "end-0",
      "start-1",
      "end-1",
      "start-2",
      "end-2",
      "start-3",
      "end-3",
      "start-4",
      "end-4",
      "start-5",
      "end-5",
      "start-6",
      "end-6",
      "start-7",
      "end-7",
    ]);
  });
});

class FakeBds {
  constructor({
    autoInputAck = true,
    autoReady = true,
    inputError,
    inputOutcome = "accepted",
    inputReason,
  } = {}) {
    this.events = new EventEmitter();
    this.commands = [];
    this.autoInputAck = autoInputAck;
    this.autoReady = autoReady;
    this.inputError = inputError;
    this.inputOutcome = inputOutcome;
    this.inputReason = inputReason;
  }

  onLog(listener) {
    this.events.on("log", listener);
    return () => this.events.off("log", listener);
  }

  onState(listener) {
    this.events.on("state", listener);
    return () => this.events.off("state", listener);
  }

  async runWebRelay(command) {
    this.commands.push(command);
    const response =
      /^scriptevent computer_system:web-response [^ ]+ ([A-Za-z0-9_-]+)/u.exec(
        command,
      );
    if (response !== null && this.autoReady) {
      queueMicrotask(() => {
        this.log(
          "CS_WEB_SESSION_READY " + JSON.stringify({ sessionId: response[1] }),
        );
      });
    }
    const input =
      /^scriptevent computer_system:web-input ([A-Za-z0-9_-]+) ([A-Za-z0-9_-]{6,20}) [0-9]{1,16} (?:eof$|(?:abort-line|cancel|interrupt|line|keys|mouse) )/u.exec(
        command,
      );
    if (input !== null && this.autoInputAck) {
      queueMicrotask(() => {
        this.log(
          "CS_WEB_INPUT " +
            JSON.stringify({
              ...(this.inputError === undefined
                ? {}
                : { error: this.inputError }),
              outcome: this.inputOutcome,
              ...(this.inputReason === undefined
                ? {}
                : { reason: this.inputReason }),
              requestId: input[2],
              sessionId: input[1],
            }),
        );
      });
    }
    return { command };
  }

  log(line) {
    this.events.emit("log", { line });
  }

  state(value) {
    this.events.emit("state", value);
  }
}

async function until(predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for test condition.");
}

async function consumeResponse(command) {
  return exchangeHandoffUrl(command.split(" ").at(-1));
}

async function publishShellTerminal(server, bds, token) {
  const session = server.store.authenticate(token);
  bds.log(
    `CS_WEB_TERMINAL ${JSON.stringify(
      tuiSnapshot(session.sessionId, { interaction: shellInteraction() }),
    )}`,
  );
  await until(
    () =>
      server.store.authenticate(token).terminal?.terminal?.interaction
        ?.inputMode === "line",
  );
}

async function connectDebugWriter(server, bds, computerId = "c-000001") {
  const waiting = server.waitForHandoff({
    computerId,
    principalKind: "debug",
    timeoutMs: 1_000,
  });
  bds.log(
    `CS_WEB_SESSION_REQUEST ${JSON.stringify({
      requestId: "r1-1",
      playerId: "mcp-debug",
      principalKind: "debug",
      computerId,
    })}`,
  );
  const handoff = await waiting;
  await exchangeHandoffUrl(handoff.url);
  return handoff;
}

function tuiSnapshot(sessionId, options = {}) {
  const rows = options.rows ?? ["EDIT    ", "File    "];
  const width = options.width ?? 8;
  const height = options.height ?? rows.length;
  const colorRow = Array.from({ length: width }, () => 7);
  const backgroundRow = Array.from({ length: width }, () => 1);
  const secretInput = options.secretInput ?? false;
  const interaction =
    options.interaction ??
    (secretInput
      ? {
          schema: 2,
          inputMode: "line",
          cursorShape: "block",
          pointer: "none",
          presentation: "terminal",
          eof: false,
          secretInput: true,
          context: "secret",
          ctrlCAction: "cancel",
          history: false,
          hints: [{ key: "Enter", label: "Continue" }],
          interactionGeneration: 1,
        }
      : {
          schema: 2,
          inputMode: "keys",
          cursorShape: "block",
          pointer: "cell",
          presentation: "dos-tui",
          eof: false,
          secretInput: false,
          context: "edit",
          ctrlCAction: "terminal-key",
          history: false,
          hints: [{ key: "F10", label: "Menu" }],
          interactionGeneration: 1,
        });
  return {
    sessionId,
    computerId: options.computerId ?? "c-000001",
    label: options.label ?? "Debug Computer",
    lifecycle: "running",
    terminal: {
      schema: 1,
      width,
      height,
      rows,
      foreground:
        options.foreground ??
        Array.from({ length: height }, () => [...colorRow]),
      background:
        options.background ??
        Array.from({ length: height }, () => [...backgroundRow]),
      cursor: options.cursor ?? { x: 2, y: 1, blink: true },
      interaction,
      replacementEpoch: options.replacementEpoch ?? 0,
      terminalRevision: options.terminalRevision ?? 0,
    },
  };
}

function shellInteraction() {
  return {
    schema: 2,
    inputMode: "line",
    cursorShape: "block",
    pointer: "none",
    presentation: "terminal",
    eof: false,
    secretInput: false,
    context: "shell",
    ctrlCAction: "abort-line",
    history: true,
    hints: [
      { key: "Enter", label: "Run" },
      { key: "Tab", label: "Complete" },
    ],
    interactionGeneration: 1,
  };
}

function csAbiInteraction() {
  return {
    schema: 2,
    inputMode: "keys",
    cursorShape: "block",
    pointer: "none",
    presentation: "terminal",
    eof: false,
    secretInput: false,
    context: "cs-abi",
    ctrlCAction: "interrupt",
    history: false,
    hints: [{ key: "Ctrl+C", label: "Interrupt" }],
    interactionGeneration: 1,
  };
}

async function exchangeHandoffUrl(url) {
  const entry = await fetch(url, {
    redirect: "manual",
  });
  const location = entry.headers.get("location");
  const destination = new URL(location, url);
  const code = destination.searchParams.get("computer");
  const response = await fetch(new URL("/api/handoff", url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: new URL(url).origin,
    },
    body: JSON.stringify({ code }),
  });
  const body = await response.json();
  return {
    entry,
    response,
    token: body.token,
  };
}

function post(origin, pathname, token, body) {
  const requestBody =
    (pathname === "/api/input" || pathname === "/api/complete") &&
    body.interactionGeneration === undefined
      ? { ...body, interactionGeneration: 1 }
      : body;
  return fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      ...browserInteractionHeaders,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(requestBody),
  });
}
