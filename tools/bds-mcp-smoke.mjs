import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preserveWorld = process.argv.includes("--preserve-world");
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
  const beforeStart = await call("bds_status", {});
  const started = await call("bds_start", { resetWorld: !preserveWorld });
  const storageMigration = await call("bds_wait_for_log", {
    contains: 'CS_STORAGE_MIGRATION {"state":"complete"',
    afterCursor: beforeStart.logCursor,
    timeoutMs: 120_000,
  });
  const probe = await call("bds_run_probe", {
    probe: "headless",
    target: "server",
  });
  let terminal;
  try {
    const outcome = await Promise.race([
      call("bds_wait_for_log", {
        contains: '"phase":"complete"',
        afterCursor: probe.afterCursor,
        timeoutMs: 120_000,
      }).then((entry) => ({ entry, kind: "complete" })),
      call("bds_wait_for_log", {
        contains: "Unhandled critical exception",
        afterCursor: probe.afterCursor,
        timeoutMs: 120_000,
      }).then((entry) => ({ entry, kind: "watchdog" })),
    ]);
    if (outcome.kind === "watchdog") {
      throw new Error(
        `BDS watchdog terminated the probe: ${outcome.entry.line}`,
      );
    }
    terminal = outcome.entry;
  } catch (error) {
    throw await describeProbeWaitFailure(error, probe.afterCursor);
  }
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
  const authentication = requireLinuxAuthenticationRecord(probeLogs);
  const make = requireLinuxMakeRecord(probeLogs);
  const git = requireLinuxGitRecord(probeLogs);
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
        storageMigrationCursor: storageMigration.cursor,
        terminal: JSON.parse(
          terminal.line.slice(terminal.line.indexOf("CS_PROBE_RESULT ") + 16),
        ),
        authentication: authentication.details,
        make: make.details,
        git: git.details,
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

function requireLinuxAuthenticationRecord(logs) {
  const marker = "CS_PROBE_RESULT ";
  const entry = logs.find((candidate) =>
    candidate.line.includes('"probe":"linux_authentication"'),
  );
  if (entry === undefined) {
    throw new Error(
      "Headless suite omitted the CS-Linux authentication probe.",
    );
  }
  const markerIndex = entry.line.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("CS-Linux authentication probe record was malformed.");
  }
  const record = JSON.parse(entry.line.slice(markerIndex + marker.length));
  if (
    record.probe !== "linux_authentication" ||
    record.status !== "PASS" ||
    record.details?.authenticatedUser !== "cs" ||
    record.details?.laterLoginRequired !== true ||
    record.details?.passwordMasked !== true ||
    record.details?.preLoginRejected !== true ||
    record.details?.setupCompleted !== true ||
    !Number.isInteger(record.details?.ticks) ||
    record.details.ticks < 8 ||
    record.details.ticks > 256
  ) {
    throw new Error(
      `CS-Linux authentication probe did not pass its contract: ${JSON.stringify(record)}`,
    );
  }
  return record;
}

function requireLinuxMakeRecord(logs) {
  const marker = "CS_PROBE_RESULT ";
  const entry = logs.find((candidate) =>
    candidate.line.includes('"probe":"linux_make"'),
  );
  if (entry === undefined) {
    throw new Error("Headless suite omitted the CS-Linux make probe.");
  }
  const markerIndex = entry.line.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("CS-Linux make probe record was malformed.");
  }
  const record = JSON.parse(entry.line.slice(markerIndex + marker.length));
  if (
    record.probe !== "linux_make" ||
    record.status !== "PASS" ||
    record.details?.built !== true ||
    record.details?.failureStopped !== true ||
    record.details?.finalized !== true ||
    record.details?.missingStateRecovered !== true ||
    record.details?.noOp !== true ||
    record.details?.rebuilt !== true ||
    record.details?.stateV2 !== true ||
    !Number.isInteger(record.details?.ticks) ||
    record.details.ticks < 1 ||
    record.details.ticks > 512
  ) {
    throw new Error(
      `CS-Linux make probe did not pass its contract: ${JSON.stringify(record)}`,
    );
  }
  return record;
}

function requireLinuxGitRecord(logs) {
  const marker = "CS_PROBE_RESULT ";
  const entry = logs.find((candidate) =>
    candidate.line.includes('"probe":"linux_git"'),
  );
  if (entry === undefined) {
    throw new Error("Headless suite omitted the CS-Linux Git probe.");
  }
  const markerIndex = entry.line.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("CS-Linux Git probe record was malformed.");
  }
  const record = JSON.parse(entry.line.slice(markerIndex + marker.length));
  if (
    record.probe !== "linux_git" ||
    record.status !== "PASS" ||
    record.details?.committed !== true ||
    record.details?.finalized !== true ||
    record.details?.ignored !== true ||
    record.details?.initialized !== true ||
    record.details?.merged !== true ||
    record.details?.remoteUnavailable !== true ||
    record.details?.switched !== true ||
    !Number.isInteger(record.details?.ticks) ||
    record.details.ticks < 1 ||
    record.details.ticks > 512
  ) {
    throw new Error(
      `CS-Linux Git probe did not pass its contract: ${JSON.stringify(record)}`,
    );
  }
  return record;
}

async function describeProbeWaitFailure(error, afterCursor) {
  const lines = [
    error instanceof Error ? error.message : String(error),
    `Probe cursor: ${String(afterCursor)}`,
  ];
  try {
    const status = await call("bds_status", {});
    lines.push(`BDS status: ${JSON.stringify(status)}`);
  } catch (statusError) {
    lines.push(
      `BDS status unavailable: ${statusError instanceof Error ? statusError.message : String(statusError)}`,
    );
  }
  try {
    const logs = await call("bds_get_logs", {
      afterCursor,
      diagnosticsOnly: false,
      limit: 2_000,
    });
    const records = logs
      .filter(
        (entry) =>
          entry.diagnostic === true || entry.line.includes("CS_PROBE_RESULT "),
      )
      .slice(-80)
      .map((entry) => entry.line.slice(0, 2_000));
    lines.push(
      records.length === 0
        ? "No diagnostic or probe records followed the probe cursor."
        : `Recent diagnostic/probe records:\n${records.join("\n")}`,
    );
  } catch (logsError) {
    lines.push(
      `BDS logs unavailable: ${logsError instanceof Error ? logsError.message : String(logsError)}`,
    );
  }
  return new Error(lines.join("\n"), { cause: error });
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
