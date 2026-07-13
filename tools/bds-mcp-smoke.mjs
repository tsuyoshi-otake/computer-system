import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
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
    clientInfo: { name: "computer-system-smoke", version: "1.0.0" },
  });
  notify("notifications/initialized", {});
  const started = await call("bds_start", { resetWorld: true });
  const probe = await call("bds_run_probe", {
    probe: "headless",
    target: "server",
  });
  const terminal = await call("bds_wait_for_log", {
    contains: '"phase":"complete"',
    afterCursor: probe.afterCursor,
    timeoutMs: 120_000,
  });
  const diagnostics = await call("bds_get_logs", {
    afterCursor: probe.afterCursor,
    diagnosticsOnly: true,
    limit: 200,
  });
  const probeLogs = await call("bds_get_logs", {
    afterCursor: probe.afterCursor,
    diagnosticsOnly: false,
    limit: 2_000,
  });
  const stopped = await call("bds_stop", {});
  if (started.state !== "running") {
    throw new Error(`Expected running, received ${String(started.state)}.`);
  }
  if (!terminal.line.includes('"probe":"suite"')) {
    throw new Error(`Expected suite record, received ${terminal.line}`);
  }
  if (!terminal.line.includes('"status":"PASS"')) {
    const records = probeLogs
      .filter((entry) => entry.line.includes("CS_PROBE_RESULT "))
      .map((entry) => entry.line)
      .join("\n");
    throw new Error(
      `Headless suite did not pass: ${terminal.line}\nProbe records:\n${records}`,
    );
  }
  if (stopped.state !== "idle") {
    throw new Error(`Expected idle, received ${String(stopped.state)}.`);
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        status: "PASS",
        endpoint: `${started.address}:${String(started.port)}`,
        terminal: JSON.parse(
          terminal.line.slice(terminal.line.indexOf("CS_PROBE_RESULT ") + 16),
        ),
        diagnostics: diagnostics.length,
        finalState: stopped.state,
      },
      null,
      2,
    )}\n`,
  );
} finally {
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
