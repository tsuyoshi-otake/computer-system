import readline from "node:readline";

import { BdsDebugSession } from "./bds-debug-session.mjs";
import {
  parseBooleanFlag,
  WebCompanionServer,
} from "./web-companion-server.mjs";

const protocolVersion = "2025-11-25";
const serverInfo = {
  name: "computer-system-bds",
  title: "Computer System Bedrock Debug Server",
  version: "0.1.0",
};
const session = new BdsDebugSession();
const webCompanion = new WebCompanionServer({
  bds: session,
  host: process.env.WEB_COMPANION_HOST ?? "127.0.0.1",
  port: process.env.WEB_COMPANION_PORT ?? "19144",
  publicHost: process.env.WEB_COMPANION_PUBLIC_HOST,
  publicOrigin: process.env.WEB_COMPANION_PUBLIC_ORIGIN,
  autoOpenBrowser: parseBooleanFlag(
    process.env.WEB_COMPANION_AUTO_OPEN,
    "WEB_COMPANION_AUTO_OPEN",
  ),
});
await webCompanion.start();
let initialized = false;
let shuttingDown = false;

const tools = [
  {
    name: "bds_status",
    title: "BDS status",
    description:
      "Return the managed Bedrock Dedicated Server state, endpoint, log cursor, and diagnostic count.",
    inputSchema: emptyObjectSchema(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "bds_start",
    title: "Start BDS debug server",
    description:
      "Build the current packs, prepare an isolated BDS runtime outside BDS_HOME, install the packs, and start the debug server.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        resetWorld: {
          type: "boolean",
          description:
            "Recreate only the managed MCP debug runtime and world. Defaults to false.",
        },
      },
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "bds_stop",
    title: "Stop BDS debug server",
    description:
      "Gracefully stop the managed Bedrock Dedicated Server and wait for finalization.",
    inputSchema: emptyObjectSchema(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "bds_run_probe",
    title: "Run Computer System probe",
    description:
      "Run an allowlisted Computer System script-event probe. Player probes execute as every connected player; headless executes from the server.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        probe: {
          type: "string",
          enum: [
            "compete",
            "headless",
            "help",
            "monitor",
            "pocket",
            "runtime",
            "speaker",
            "status",
            "storage",
            "stream",
            "ui",
          ],
        },
        target: {
          type: "string",
          enum: ["all_players", "server"],
          description:
            "Use server only for headless; all other probes require all_players.",
        },
      },
      required: ["probe", "target"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "bds_run_command",
    title: "Run allowlisted BDS command",
    description:
      "Send one allowlisted command to BDS. Only list and Computer System probe commands are accepted; newlines and arbitrary administration commands are rejected.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        command: { type: "string", minLength: 1, maxLength: 240 },
      },
      required: ["command"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "bds_execute_computer_command",
    title: "Execute Computer shell command",
    description:
      "Execute one bounded non-TUI command inside a specific sandboxed Computer and return its stdout, stderr, exit code, and modeled 486DX CPU cycles. This never invokes the host shell or arbitrary BDS administration commands.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        computerId: {
          type: "string",
          pattern: "^c-[0-9a-hjkmnp-tv-z]{6}$",
        },
        command: { type: "string", minLength: 1, maxLength: 128 },
        timeoutMs: {
          type: "integer",
          minimum: 1,
          maximum: 30_000,
        },
      },
      required: ["computerId", "command"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "bds_get_logs",
    title: "Read BDS logs",
    description:
      "Read bounded BDS/build logs after a cursor, optionally returning only Script/JSON/UI diagnostics.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        afterCursor: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1, maximum: 2_000 },
        diagnosticsOnly: { type: "boolean" },
      },
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "bds_wait_for_log",
    title: "Wait for BDS log",
    description:
      "Wait for a literal text fragment in a later BDS log line with a bounded timeout.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        contains: { type: "string", minLength: 1, maxLength: 500 },
        afterCursor: { type: "integer", minimum: 0 },
        timeoutMs: { type: "integer", minimum: 1, maximum: 120_000 },
      },
      required: ["contains"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "bds_wait_for_web_handoff",
    title: "Wait for Web Terminal handoff",
    description:
      "Wait for the next one-use Web Terminal handoff for one Computer ID. A matching MCP waiter receives the URL instead of browser auto-open, and the URL is never written to BDS logs.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        computerId: {
          type: "string",
          pattern: "^c-[0-9a-hjkmnp-tv-z]{6}$",
        },
        timeoutMs: {
          type: "integer",
          minimum: 1,
          maximum: 120_000,
        },
      },
      required: ["computerId"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

const input = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
});

input.on("line", (line) => {
  if (line.length > 1_000_000) {
    writeError(null, -32600, "JSON-RPC message exceeds 1 MB.");
    return;
  }
  void handleLine(line);
});
input.on("close", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

async function handleLine(line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    writeError(null, -32700, "Parse error");
    return;
  }
  if (
    message === null ||
    typeof message !== "object" ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  ) {
    writeError(message?.id ?? null, -32600, "Invalid Request");
    return;
  }
  if (!("id" in message)) {
    if (message.method === "notifications/initialized") initialized = true;
    return;
  }

  try {
    switch (message.method) {
      case "initialize": {
        const requestedVersion = message.params?.protocolVersion;
        writeResult(message.id, {
          protocolVersion:
            requestedVersion === protocolVersion
              ? requestedVersion
              : protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
          instructions:
            "Call bds_start before commands. Use bds_run_probe for Computer System probes, then bds_wait_for_log or bds_get_logs. Use bds_stop when debugging is complete.",
        });
        return;
      }
      case "ping":
        writeResult(message.id, {});
        return;
      case "tools/list":
        requireInitialized();
        writeResult(message.id, { tools });
        return;
      case "tools/call":
        requireInitialized();
        writeResult(
          message.id,
          await callTool(message.params?.name, message.params?.arguments ?? {}),
        );
        return;
      default:
        writeError(message.id, -32601, "Method not found");
    }
  } catch (error) {
    if (message.method === "tools/call") {
      writeResult(message.id, toolError(error));
    } else {
      writeError(message.id, -32603, errorMessage(error));
    }
  }
}

async function callTool(name, args) {
  requireObject(args);
  switch (name) {
    case "bds_status":
      requireKeys(args, []);
      return toolSuccess(status());
    case "bds_start":
      requireKeys(args, ["resetWorld"]);
      await session.start({ resetWorld: args.resetWorld ?? false });
      return toolSuccess(status());
    case "bds_stop":
      requireKeys(args, []);
      await session.stop();
      return toolSuccess(status());
    case "bds_run_probe":
      requireKeys(args, ["probe", "target"]);
      requireString(args.probe, "probe");
      requireString(args.target, "target");
      return toolSuccess(await session.runProbe(args.probe, args.target));
    case "bds_run_command":
      requireKeys(args, ["command"]);
      requireString(args.command, "command");
      return toolSuccess(await session.runCommand(args.command));
    case "bds_execute_computer_command":
      requireKeys(args, ["computerId", "command", "timeoutMs"]);
      requireString(args.computerId, "computerId");
      requireString(args.command, "command");
      return toolSuccess(await session.executeComputerCommand(args));
    case "bds_get_logs":
      requireKeys(args, ["afterCursor", "limit", "diagnosticsOnly"]);
      return toolSuccess(session.getLogs(args));
    case "bds_wait_for_log":
      requireKeys(args, ["contains", "afterCursor", "timeoutMs"]);
      requireString(args.contains, "contains");
      return toolSuccess(await session.waitForLog(args));
    case "bds_wait_for_web_handoff":
      requireKeys(args, ["computerId", "timeoutMs"]);
      requireString(args.computerId, "computerId");
      return toolSuccess(await webCompanion.waitForHandoff(args));
    default:
      throw new Error(`Unknown tool: ${String(name)}`);
  }
}

function toolSuccess(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value },
    isError: false,
  };
}

function status() {
  return { ...session.getStatus(), web: webCompanion.status() };
}

function toolError(error) {
  const message = errorMessage(error);
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message },
    isError: true,
  };
}

function writeResult(id, result) {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function writeError(id, code, message) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message } });
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function emptyObjectSchema() {
  return { type: "object", additionalProperties: false };
}

function requireInitialized() {
  if (!initialized)
    throw new Error("MCP client has not initialized the server.");
}

function requireObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool arguments must be an object.");
  }
}

function requireKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new Error(`Unexpected arguments: ${unexpected.join(", ")}`);
  }
}

function requireString(value, name) {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await webCompanion.stop();
    await session.stop();
  } catch (error) {
    process.stderr.write(`BDS MCP shutdown error: ${errorMessage(error)}\n`);
  } finally {
    process.exit(0);
  }
}
