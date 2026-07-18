import { spawn } from "node:child_process";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const clients = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("BDS MCP stdio server", () => {
  it("negotiates MCP and exposes the bounded debug tools", async () => {
    const client = createClient();
    clients.push(client);
    const initialize = await client.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    });
    expect(initialize.protocolVersion).toBe("2025-11-25");
    expect(initialize.capabilities).toEqual({ tools: { listChanged: false } });
    client.notify("notifications/initialized", {});

    const listed = await client.request("tools/list", {});
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "bds_status",
      "bds_start",
      "bds_stop",
      "bds_run_probe",
      "bds_run_command",
      "bds_execute_computer_command",
      "bds_get_logs",
      "bds_wait_for_log",
      "bds_list_computers",
      "bds_open_web_terminal",
      "bds_get_tui_screen",
      "bds_wait_for_tui_screen",
      "bds_send_tui_input",
      "bds_issue_web_handoff",
      "bds_wait_for_web_handoff",
    ]);
    expect(
      listed.tools.find((tool) => tool.name === "bds_stop")?.annotations,
    ).toMatchObject({ destructiveHint: true });
    const openTool = listed.tools.find(
      (tool) => tool.name === "bds_open_web_terminal",
    );
    expect(openTool?.description).toContain(
      "server-authorized MCP debug principal",
    );
    expect(openTool?.description).toContain("No connected Bedrock player");
    const captureTool = listed.tools.find(
      (tool) => tool.name === "bds_get_tui_screen",
    );
    expect(captureTool).toMatchObject({
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: {
        additionalProperties: false,
        required: ["computerId"],
      },
    });
    expect(captureTool?.description).toContain("exact MCP debug-owned writer");
    expect(captureTool?.description).toContain("optional 16-color cell grids");
    const waitTool = listed.tools.find(
      (tool) => tool.name === "bds_wait_for_tui_screen",
    );
    expect(waitTool?.inputSchema.properties.contains.maxLength).toBe(500);
    expect(waitTool?.inputSchema.properties.timeoutMs.maximum).toBe(120_000);
    expect(waitTool?.annotations).toMatchObject({
      readOnlyHint: true,
      idempotentHint: false,
    });
    const inputTool = listed.tools.find(
      (tool) => tool.name === "bds_send_tui_input",
    );
    expect(inputTool?.inputSchema.properties.kind.enum).toEqual([
      "line",
      "keys",
      "interrupt",
    ]);
    expect(inputTool?.description).toContain("Secret prompts are rejected");
  });

  it("returns structured status and rejects arbitrary console commands", async () => {
    const client = createClient();
    clients.push(client);
    await client.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "vitest", version: "1.0.0" },
    });
    client.notify("notifications/initialized", {});

    const status = await client.request("tools/call", {
      name: "bds_status",
      arguments: {},
    });
    expect(status.isError).toBe(false);
    expect(status.structuredContent.result).toMatchObject({
      state: "idle",
      running: false,
      ready: false,
    });

    const rejected = await client.request("tools/call", {
      name: "bds_run_command",
      arguments: { command: "op @a" },
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.structuredContent.error).toMatch(/Command rejected/u);

    const noWriter = await client.request("tools/call", {
      name: "bds_get_tui_screen",
      arguments: { computerId: "c-000001" },
    });
    expect(noWriter.isError).toBe(true);
    expect(noWriter.structuredContent.error).toMatch(
      /Call bds_open_web_terminal first/u,
    );
  });
});

function createClient() {
  const child = spawn(
    process.execPath,
    [path.join(root, "tools", "bds-mcp-server.mjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        BDS_HOME: "C:/not-accessed-by-status",
        BDS_MCP_PORT: "19151",
        WEB_COMPANION_PORT: "0",
        WEB_COMPANION_CONFIG_FILE: "",
      },
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

  return {
    request(method, params) {
      const id = nextId;
      nextId += 1;
      const response = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
      return response;
    },
    notify(method, params) {
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`,
      );
    },
    async close() {
      if (child.exitCode !== null) return;
      child.stdin.end();
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          child.kill();
          resolve();
        }, 3_000);
        child.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    },
  };
}
