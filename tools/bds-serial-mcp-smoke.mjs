import { spawn } from "node:child_process";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.execPath,
  [path.join(root, "tools", "bds-mcp-server.mjs")],
  {
    cwd: root,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
const pending = new Map();
let nextId = 1;
let stderr = "";
let running = false;
const output = readline.createInterface({
  input: child.stdout,
  crlfDelay: Number.POSITIVE_INFINITY,
});
output.on("line", (line) => {
  const message = JSON.parse(line);
  const waiter = pending.get(message.id);
  if (waiter === undefined) return;
  pending.delete(message.id);
  if (message.error !== undefined)
    waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});
child.on("close", (code) => {
  for (const waiter of pending.values()) {
    waiter.reject(
      new Error(
        `MCP server exited with code ${String(code)}. ${stderr}`.trim(),
      ),
    );
  }
  pending.clear();
});

try {
  await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "computer-system-serial-smoke", version: "1.0.0" },
  });
  notify("notifications/initialized", {});
  const started = await call("bds_start", { resetWorld: true });
  running = true;
  const probe = await call("bds_run_probe", {
    probe: "headless",
    target: "server",
  });
  const serialLog = await call("bds_wait_for_log", {
    contains: '"probe":"serial_matrix"',
    afterCursor: probe.afterCursor,
    timeoutMs: 120_000,
  });
  const terminalLog = await call("bds_wait_for_log", {
    contains: '"phase":"complete"',
    afterCursor: probe.afterCursor,
    timeoutMs: 120_000,
  });
  const serial = parseProbe(serialLog.line);
  const terminal = parseProbe(terminalLog.line);
  requireEqual(started.state, "running", "BDS state after start");
  requireEqual(serial.probe, "serial_matrix", "serial probe name");
  requireEqual(serial.status, "PASS", "serial probe status");
  requireEqual(serial.details.machines, 3, "serial machine count");
  requireEqual(serial.details.faces, 6, "serial face count");
  requireEqual(serial.details.links, 36, "serial link count");
  requireEqual(serial.details.transmissions, 72, "serial transmission count");
  requireEqual(terminal.status, "PASS", "headless suite status");
  const stopped = await call("bds_stop", {});
  running = false;
  requireEqual(stopped.state, "idle", "BDS state after stop");
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        endpoint: `${started.address}:${String(started.port)}`,
        serial,
        suite: terminal,
        finalState: stopped.state,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (running) {
    try {
      await call("bds_stop", {});
    } catch {
      // The MCP child shutdown below remains the final cleanup owner.
    }
  }
  if (child.exitCode === null) child.stdin.end();
}

function request(method, params) {
  const id = nextId;
  nextId += 1;
  const response = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
  );
  return response;
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
}

async function call(name, args) {
  const result = await request("tools/call", { name, arguments: args });
  if (result.isError === true) {
    throw new Error(result.structuredContent?.error ?? "MCP tool failed.");
  }
  return result.structuredContent.result;
}

function parseProbe(line) {
  const marker = "CS_PROBE_RESULT ";
  const offset = line.indexOf(marker);
  if (offset < 0) throw new Error(`Probe marker is missing: ${line}`);
  return JSON.parse(line.slice(offset + marker.length));
}

function requireEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}
