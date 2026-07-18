import readline from "node:readline";

import { BdsDebugSession } from "./bds-debug-session.mjs";
import {
  defaultWebCompanionConfigPath,
  loadWebCompanionAdminConfig,
  resolveWebCompanionAdminOptions,
} from "./web-companion-admin-config.mjs";
import {
  parseBooleanFlag,
  parseOptionalBooleanFlag,
  WebCompanionServer,
} from "./web-companion-server.mjs";

const protocolVersion = "2025-11-25";
const maximumMcpWebSessions = 32;
const serverInfo = {
  name: "computer-system-bds",
  title: "Computer System Bedrock Debug Server",
  version: "0.1.0",
};
const session = new BdsDebugSession();
const adminConfigPath = defaultWebCompanionConfigPath();
const persistedAdminConfig = await loadWebCompanionAdminConfig(adminConfigPath);
const adminOptions = resolveWebCompanionAdminOptions(
  process.env,
  persistedAdminConfig,
);
const webCompanion = new WebCompanionServer({
  bds: session,
  host: process.env.WEB_COMPANION_HOST ?? "0.0.0.0",
  port: adminOptions.port,
  publicHost: process.env.WEB_COMPANION_PUBLIC_HOST,
  publicOrigin: adminOptions.publicOrigin,
  allowedOrigins: process.env.WEB_COMPANION_ALLOWED_ORIGINS,
  autoOpenBrowser: parseOptionalBooleanFlag(
    process.env.WEB_COMPANION_AUTO_OPEN ?? "1",
    "WEB_COMPANION_AUTO_OPEN",
  ),
  debugIgnoreRange: parseBooleanFlag(
    process.env.WEB_COMPANION_DEBUG_IGNORE_RANGE,
    "WEB_COMPANION_DEBUG_IGNORE_RANGE",
  ),
});
await webCompanion.start();
let initialized = false;
let shuttingDown = false;
const mcpWebSessions = new Map();

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
            "computer",
            "headless",
            "help",
            "monitor",
            "portable",
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
      "Execute one bounded non-TUI command inside a specific sandboxed Computer and return its stdout, stderr, exit code, and selected hardware model CPU cycles. Multiline input is accepted only for bounded python -c source. This never invokes the host shell or arbitrary BDS administration commands.",
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
    name: "bds_list_computers",
    title: "List placed Computers",
    description:
      "Return one bounded O(K) page of exact identities for Computers currently placed in the managed world. This does not power on or mutate a Computer.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        cursor: {
          type: "integer",
          minimum: 0,
          maximum: 9_999_999_999,
        },
        limit: { type: "integer", minimum: 1, maximum: 64 },
        timeoutMs: {
          type: "integer",
          minimum: 1,
          maximum: 120_000,
        },
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
    name: "bds_open_web_terminal",
    title: "Open and verify Web Terminal",
    description:
      "Activate one exact Computer through the server-authorized MCP debug principal, open its one-use handoff in the companion host's default browser, and wait until that exact browser session becomes the writer. No connected Bedrock player or one-use URL is required.",
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
        browserTimeoutMs: {
          type: "integer",
          minimum: 1,
          maximum: 30_000,
        },
      },
      required: ["computerId"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "bds_get_tui_screen",
    title: "Read MCP Web Terminal TUI",
    description:
      "Return the latest validated text surface for the exact MCP debug-owned writer/session opened by bds_open_web_terminal. Includes rows, geometry, cursor, snapshot version, and optional 16-color cell grids; rejects secret input and never returns a bearer token, one-use URL, or connection code.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        computerId: {
          type: "string",
          pattern: "^c-[0-9a-hjkmnp-tv-z]{6}$",
        },
        includeColors: { type: "boolean" },
      },
      required: ["computerId"],
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "bds_wait_for_tui_screen",
    title: "Wait for MCP Web Terminal TUI",
    description:
      "Wait without polling for the exact MCP debug-owned writer/session to publish a validated text surface. A literal contains match is recommended for screen verification; afterVersion tracks bounded snapshot envelopes and may also advance for lifecycle metadata. Optional colors preserve exact 0-15 cell palettes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        computerId: {
          type: "string",
          pattern: "^c-[0-9a-hjkmnp-tv-z]{6}$",
        },
        contains: {
          type: "string",
          minLength: 1,
          maxLength: 500,
        },
        afterVersion: { type: "integer", minimum: 0 },
        timeoutMs: {
          type: "integer",
          minimum: 1,
          maximum: 120_000,
        },
        includeColors: { type: "boolean" },
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
  {
    name: "bds_send_tui_input",
    title: "Send MCP Web Terminal TUI input",
    description:
      "Send one bounded line, key batch, or interrupt through the exact MCP debug-owned writer/session and the existing correlated Web Terminal admission path. Secret prompts are rejected at both companion and Bedrock boundaries; normal Player input is unchanged.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        computerId: {
          type: "string",
          pattern: "^c-[0-9a-hjkmnp-tv-z]{6}$",
        },
        kind: { type: "string", enum: ["line", "keys", "interrupt"] },
        value: {
          anyOf: [
            { type: "string", maxLength: 128 },
            {
              type: "array",
              minItems: 1,
              maxItems: 32,
              items: { type: "string", minLength: 1, maxLength: 32 },
            },
          ],
        },
      },
      required: ["computerId", "kind"],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "bds_issue_web_handoff",
    title: "Issue Web Terminal handoff",
    description:
      "Issue and return a one-use Web Terminal URL for one exact Computer ID through the server-authorized MCP debug principal. No connected Bedrock player is required.",
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
      readOnlyHint: false,
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
            "Call bds_start before commands. Use bds_list_computers to resolve an exact placed Computer identity, then bds_open_web_terminal to activate its server-authorized debug principal and register the exact default-browser writer session. Use bds_get_tui_screen, bds_send_tui_input, and bds_wait_for_tui_screen to inspect and drive non-secret text surfaces entirely through MCP. Use bds_wait_for_log or bds_get_logs for supporting evidence, bds_issue_web_handoff only when the caller must own the one-use URL, and bds_stop when debugging is complete.",
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
      if (!session.getStatus().running) mcpWebSessions.clear();
      await session.start({ resetWorld: args.resetWorld ?? false });
      return toolSuccess(status());
    case "bds_stop":
      requireKeys(args, []);
      try {
        await session.stop();
      } finally {
        mcpWebSessions.clear();
      }
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
    case "bds_list_computers":
      requireKeys(args, ["cursor", "limit", "timeoutMs"]);
      return toolSuccess(await session.listComputers(args));
    case "bds_open_web_terminal": {
      requireKeys(args, ["computerId", "timeoutMs", "browserTimeoutMs"]);
      requireString(args.computerId, "computerId");
      const handoff = await requestWebHandoff(args);
      const connection = await webCompanion.openHandoffInBrowser(handoff, {
        timeoutMs: args.browserTimeoutMs ?? 10_000,
      });
      rememberMcpWebSession(handoff.computerId, handoff.sessionId);
      return toolSuccess({
        computerId: handoff.computerId,
        sessionId: handoff.sessionId,
        expiresAt: handoff.expiresAt,
        browserOpened: true,
        connection,
      });
    }
    case "bds_get_tui_screen": {
      requireKeys(args, ["computerId", "includeColors"]);
      requireString(args.computerId, "computerId");
      return toolSuccess(
        webCompanion.captureTuiScreen({
          ...requireMcpWebSession(args.computerId),
          includeColors: args.includeColors,
        }),
      );
    }
    case "bds_wait_for_tui_screen": {
      requireKeys(args, [
        "computerId",
        "contains",
        "afterVersion",
        "timeoutMs",
        "includeColors",
      ]);
      requireString(args.computerId, "computerId");
      return toolSuccess(
        await webCompanion.waitForTuiScreen({
          ...requireMcpWebSession(args.computerId),
          contains: args.contains,
          afterVersion: args.afterVersion,
          timeoutMs: args.timeoutMs,
          includeColors: args.includeColors,
        }),
      );
    }
    case "bds_send_tui_input": {
      requireKeys(args, ["computerId", "kind", "value"]);
      requireString(args.computerId, "computerId");
      requireString(args.kind, "kind");
      return toolSuccess(
        await webCompanion.sendTuiInput({
          ...requireMcpWebSession(args.computerId),
          kind: args.kind,
          value: args.value,
        }),
      );
    }
    case "bds_issue_web_handoff":
      requireKeys(args, ["computerId", "timeoutMs"]);
      requireString(args.computerId, "computerId");
      return toolSuccess(await requestWebHandoff(args));
    case "bds_wait_for_web_handoff":
      requireKeys(args, ["computerId", "timeoutMs"]);
      requireString(args.computerId, "computerId");
      return toolSuccess(
        await webCompanion.waitForHandoff({ ...args, principalKind: "debug" }),
      );
    default:
      throw new Error(`Unknown tool: ${String(name)}`);
  }
}

async function requestWebHandoff(args) {
  const request = {
    computerId: args.computerId,
    principalKind: "debug",
    timeoutMs: args.timeoutMs,
  };
  const waiting = webCompanion.waitForHandoff(request);
  try {
    await session.requestWebHandoff(request);
    return await waiting;
  } catch (error) {
    webCompanion.rejectPendingHandoff(
      request.computerId,
      `Web handoff request failed: ${errorMessage(error)}`,
    );
    await waiting.catch(() => undefined);
    throw error;
  }
}

function rememberMcpWebSession(computerId, sessionId) {
  if (!mcpWebSessions.has(computerId)) {
    while (mcpWebSessions.size >= maximumMcpWebSessions) {
      const oldestComputerId = mcpWebSessions.keys().next().value;
      if (oldestComputerId === undefined) break;
      mcpWebSessions.delete(oldestComputerId);
    }
  }
  mcpWebSessions.set(computerId, sessionId);
}

function requireMcpWebSession(computerId) {
  const sessionId = mcpWebSessions.get(computerId);
  if (sessionId === undefined) {
    throw new Error(
      `No MCP debug-owned Web Terminal writer is registered for ${computerId}. Call bds_open_web_terminal first.`,
    );
  }
  return { computerId, sessionId };
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
    mcpWebSessions.clear();
    process.exit(0);
  }
}
