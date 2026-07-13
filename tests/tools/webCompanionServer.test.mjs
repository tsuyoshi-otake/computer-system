import { EventEmitter } from "node:events";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WebCompanionServer } from "../../tools/web-companion-server.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("Web companion HTTP server", () => {
  it("keeps browser opening disabled by default", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = new WebCompanionServer({
      bds,
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
      state: "disabled",
      attempts: 0,
    });
  });

  it("opens each loopback handoff once when explicitly enabled", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = new WebCompanionServer({
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
      port: 0,
      autoOpenBrowser: true,
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
      mode: "writer",
    });
    expect(handoff.url).toBe(bds.commands[0].split(" ").at(-1));
    expect(handoff.expiresAt).toBeGreaterThan(Date.now());
    expect(launches).toEqual([]);
  });

  it("bounds and finalizes computer-scoped handoff waits", async () => {
    const server = new WebCompanionServer({ bds: new FakeBds(), port: 0 });
    servers.push(server);
    await server.start();

    await expect(
      server.waitForHandoff({ computerId: "c-000001", timeoutMs: 10 }),
    ).rejects.toThrow("Timed out after 10 ms");
    expect(() =>
      server.waitForHandoff({ computerId: "invalid", timeoutMs: 10 }),
    ).toThrow("c-xxxxxx");
  });

  it("blocks non-loopback browser opening while preserving the handoff", async () => {
    const bds = new FakeBds();
    const launches = [];
    const server = new WebCompanionServer({
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

    expect(launches).toEqual([]);
    expect(bds.commands[0]).toContain("http://192.0.2.1:");
    expect(server.status().browserAutoOpen).toMatchObject({
      enabled: true,
      eligible: false,
      state: "blocked",
      reason: "origin_not_loopback",
      attempts: 0,
    });
  });

  it("keeps the chat handoff usable when browser opening fails", async () => {
    const bds = new FakeBds();
    const diagnostics = [];
    const server = new WebCompanionServer({
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
    const server = new WebCompanionServer({
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
    expect(responseCommand.split(" ").at(-2)).toBe("writer");
    const handoffUrl = responseCommand.split(" ").at(-1);
    const handoff = await fetch(handoffUrl, { redirect: "manual" });
    expect(handoff.status).toBe(302);
    const location = handoff.headers.get("location");
    expect(location).toMatch(/^\/#[-_A-Za-z0-9]+$/u);
    const token = location.slice(2);
    expect((await fetch(handoffUrl, { redirect: "manual" })).status).toBe(401);

    expect((await fetch(`${status.origin}/api/session`)).status).toBe(401);
    const sessionResponse = await fetch(`${status.origin}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({
      computerId: "c-000001",
      mode: "writer",
      state: "issued",
    });

    const input = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ kind: "line", value: "hello world" }),
    });
    expect(input.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ line hello%20world$/u,
    );

    const keys = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ kind: "keys", value: ["i", "x", "Escape"] }),
    });
    expect(keys.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-input [A-Za-z0-9_-]+ keys %5B%22i%22%2C%22x%22%2C%22Escape%22%5D$/u,
    );

    const resize = await fetch(`${status.origin}/api/resize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ width: 120, height: 40 }),
    });
    expect(resize.status).toBe(202);
    expect(bds.commands.at(-1)).toMatch(
      /^scriptevent computer_system:web-resize [A-Za-z0-9_-]+ 120 40$/u,
    );

    const completionRequest = fetch(`${status.origin}/api/complete`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ value: "who", cursor: 3 }),
    });
    await until(() => bds.commands.at(-1)?.includes("web-complete"));
    const completionCommand = bds.commands.at(-1).split(" ");
    bds.log(
      `CS_WEB_COMPLETION ${JSON.stringify({
        candidates: ["whoami"],
        cursor: 7,
        requestId: completionCommand[3],
        sessionId: completionCommand[2],
        value: "whoami ",
      })}`,
    );
    const completion = await completionRequest;
    expect(completion.status).toBe(200);
    expect(await completion.json()).toEqual({
      candidates: ["whoami"],
      cursor: 7,
      value: "whoami ",
    });

    const invalidKeys = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: status.origin,
      },
      body: JSON.stringify({ kind: "keys", value: Array(33).fill("x") }),
    });
    expect(invalidKeys.status).toBe(400);
  });

  it("accepts snapshots only for issued sessions and blocks cross-origin writes", async () => {
    const bds = new FakeBds();
    const server = new WebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"c-000001"}',
    );
    await until(() => bds.commands.length === 1);
    const sessionId = bds.commands[0].split(" ")[3];
    const handoffUrl = bds.commands[0].split(" ").at(-1);
    const handoff = await fetch(handoffUrl, { redirect: "manual" });
    const token = handoff.headers.get("location").slice(2);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify({
        sessionId,
        computerId: "c-000001",
        label: "Pocket One",
        lifecycle: "running",
        terminal: { width: 51, height: 19, rows: [] },
      })}`,
    );
    await until(async () => {
      const response = await fetch(`${status.origin}/api/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return (await response.json()).terminal !== null;
    });
    const session = await fetch(`${status.origin}/api/session`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => response.json());
    expect(session.terminal).toMatchObject({ label: "Pocket One" });

    const rejected = await fetch(`${status.origin}/api/input`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
      },
      body: JSON.stringify({ kind: "line", value: "help" }),
    });
    expect(rejected.status).toBe(403);
  });

  it("rejects viewer input and transfers one writer lease at a time", async () => {
    const bds = new FakeBds();
    const server = new WebCompanionServer({ bds, port: 0 });
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
    await until(() => bds.commands.length === 2);
    expect(bds.commands[1].split(" ").at(-2)).toBe("viewer");
    const second = await consumeResponse(bds.commands[1]);

    const rejected = await post(status.origin, "/api/input", second.token, {
      kind: "line",
      value: "blocked",
    });
    expect(rejected.status).toBe(409);
    expect(bds.commands).toHaveLength(2);

    const takeover = await post(
      status.origin,
      "/api/take-control",
      second.token,
      {},
    );
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toMatchObject({
      outcome: "writer",
      session: { mode: "writer" },
    });
    expect(bds.commands[2]).toMatch(
      /^scriptevent computer_system:web-take-control [A-Za-z0-9_-]+$/u,
    );

    expect(
      (
        await post(status.origin, "/api/input", first.token, {
          kind: "line",
          value: "old-writer",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post(status.origin, "/api/input", second.token, {
          kind: "line",
          value: "new-writer",
        })
      ).status,
    ).toBe(202);
    expect(bds.commands.at(-1)).toMatch(/ line new-writer$/u);
  });

  it("serializes and bounds terminal operations per computer", async () => {
    const server = new WebCompanionServer();
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
  constructor() {
    this.events = new EventEmitter();
    this.commands = [];
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
    return { command };
  }

  log(line) {
    this.events.emit("log", { line });
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
  const response = await fetch(command.split(" ").at(-1), {
    redirect: "manual",
  });
  return {
    token: response.headers.get("location").slice(2),
  };
}

function post(origin, pathname, token, body) {
  return fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
}
