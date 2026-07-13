import { EventEmitter } from "node:events";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { WebCompanionServer } from "../../tools/web-companion-server.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("Web companion HTTP server", () => {
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
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"computer-1"}',
    );
    await until(() => bds.commands.length === 1);
    const responseCommand = bds.commands[0];
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
      computerId: "computer-1",
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
  });

  it("accepts snapshots only for issued sessions and blocks cross-origin writes", async () => {
    const bds = new FakeBds();
    const server = new WebCompanionServer({ bds, port: 0 });
    servers.push(server);
    const status = await server.start();
    bds.log(
      'CS_WEB_SESSION_REQUEST {"requestId":"r1-1","playerId":"player-1","computerId":"computer-1"}',
    );
    await until(() => bds.commands.length === 1);
    const [sessionId] = bds.commands[0]
      .match(/[A-Za-z0-9_-]{12,32}/gu)
      .slice(-2);
    const handoffUrl = bds.commands[0].split(" ").at(-1);
    const handoff = await fetch(handoffUrl, { redirect: "manual" });
    const token = handoff.headers.get("location").slice(2);

    bds.log(
      `CS_WEB_TERMINAL ${JSON.stringify({
        sessionId,
        computerId: "computer-1",
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
