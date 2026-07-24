import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

import { permanentComputerCode } from "./web-session-store.mjs";
import {
  access,
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const executableName =
  process.platform === "win32" ? "bedrock_server.exe" : "bedrock_server";
const defaultDistributionRoot = path.join(
  os.homedir(),
  "tmp",
  "computer-system-bds",
  "runtime",
);
const defaultWorkRoot = path.join(
  os.homedir(),
  "tmp",
  "computer-system-bds",
  "mcp-runtime",
);
const defaultWorldName = "ComputerSystemMcpDebug";
export const acceptanceFixtureWorldName = "ComputerSystemAcceptance";
const allowedPlayerProbes = new Set([
  "compete",
  "computer",
  "help",
  "portable",
  "runtime",
  "speaker",
  "status",
  "storage",
  "stream",
  "ui",
  "ui-custom",
  "ui-nano",
]);
const allowedServerProbes = new Set(["headless"]);
const workMonitorLogPrefix = "CS_WORK_MONITOR ";
export const managedBdsScriptModuleId = "c0de9c03-90ec-452b-be20-773a58b38b54";
export const managedRuntimeWorkerPermissionLimits = Object.freeze({
  maxBodyBytes: 1024 * 1024,
  maxConcurrentRequests: 1,
  maxMessageSize: 1024 * 1024,
  maxWebSocketConnections: 1,
});
const managedRuntimeWorkerPath = "/internal/cs486/v1";
const managedRuntimeWorkerReadyMarker = "CS_RUNTIME_WORKER_READY ";
const maximumManagedRuntimeWorkers = 16;
const supportedLevelDatVersion = 10;
const maximumNbtDepth = 64;
const nbtTag = Object.freeze({
  end: 0,
  byte: 1,
  short: 2,
  int: 3,
  long: 4,
  float: 5,
  double: 6,
  byteArray: 7,
  string: 8,
  list: 9,
  compound: 10,
  intArray: 11,
  longArray: 12,
});
const workMonitorLanes = [
  "control",
  "event_delivery",
  "guest_cpu",
  "guest_compile",
  "mcp_debug",
  "rs232",
  "i2c",
  "spi",
  "redstone_input",
  "redstone_output",
  "topology",
  "terminal",
  "block_io",
  "persistence",
];

export function parseBdsPort(value) {
  const text = value ?? "19142";
  if (!/^\d+$/u.test(text)) {
    throw new Error("BDS_MCP_PORT must be an integer between 1 and 65534.");
  }
  const port = Number.parseInt(text, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_534) {
    throw new Error("BDS_MCP_PORT must be an integer between 1 and 65534.");
  }
  return port;
}

export function normalizeManagedRuntimeWorkers(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("runtimeWorkers must be an object.");
  }
  const allowedKeys = new Set(["count", "endpoint", "token"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown runtimeWorkers field: ${key}`);
    }
  }
  if (
    !Number.isSafeInteger(value.count) ||
    value.count < 1 ||
    value.count > maximumManagedRuntimeWorkers
  ) {
    throw new RangeError(
      `runtimeWorkers.count must be between 1 and ${String(maximumManagedRuntimeWorkers)}.`,
    );
  }
  if (typeof value.endpoint !== "string") {
    throw new TypeError("runtimeWorkers.endpoint must be a string.");
  }
  let endpoint;
  try {
    endpoint = new URL(value.endpoint);
  } catch {
    throw new Error(
      "runtimeWorkers.endpoint must be a valid loopback WebSocket URL.",
    );
  }
  if (
    endpoint.protocol !== "ws:" ||
    endpoint.hostname !== "127.0.0.1" ||
    endpoint.port === "" ||
    endpoint.pathname !== managedRuntimeWorkerPath ||
    endpoint.username !== "" ||
    endpoint.password !== "" ||
    endpoint.search !== "" ||
    endpoint.hash !== ""
  ) {
    throw new Error(
      `runtimeWorkers.endpoint must be ws://127.0.0.1:<port>${managedRuntimeWorkerPath}.`,
    );
  }
  const port = Number.parseInt(endpoint.port, 10);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "runtimeWorkers.endpoint port must be between 1 and 65535.",
    );
  }
  if (
    typeof value.token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value.token) ||
    Buffer.from(value.token, "base64url").byteLength !== 32 ||
    Buffer.from(value.token, "base64url").toString("base64url") !== value.token
  ) {
    throw new Error("runtimeWorkers.token must be a 256-bit base64url token.");
  }
  return Object.freeze({
    count: value.count,
    endpoint: endpoint.href,
    token: value.token,
  });
}

export function createManagedRuntimeWorkerConfigFiles(value) {
  const runtimeWorkers = normalizeManagedRuntimeWorkers(value);
  if (runtimeWorkers === undefined) {
    throw new TypeError("runtimeWorkers configuration is required.");
  }
  return {
    "permissions.json": {
      allowed_modules: [
        "@minecraft/server",
        "@minecraft/server-ui",
        "@minecraft/server-admin",
        "@minecraft/server-net",
      ],
      module_permissions: {
        "@minecraft/server-net": {
          allowed_uris: [runtimeWorkers.endpoint],
          force_tls: false,
          max_body_bytes: managedRuntimeWorkerPermissionLimits.maxBodyBytes,
          max_concurrent_requests:
            managedRuntimeWorkerPermissionLimits.maxConcurrentRequests,
          max_message_size: managedRuntimeWorkerPermissionLimits.maxMessageSize,
          max_websocket_connections:
            managedRuntimeWorkerPermissionLimits.maxWebSocketConnections,
        },
      },
    },
    "variables.json": {
      cs486ComputeEndpoint: runtimeWorkers.endpoint,
      cs486RuntimeWorkerCount: runtimeWorkers.count,
    },
    "secrets.json": {
      cs486ComputeToken: `Bearer ${runtimeWorkers.token}`,
    },
  };
}

export async function writeManagedRuntimeWorkerConfig(workRoot, value) {
  if (typeof workRoot !== "string" || !path.isAbsolute(workRoot)) {
    throw new TypeError("Managed BDS work root must be an absolute path.");
  }
  const files = createManagedRuntimeWorkerConfigFiles(value);
  const configRoot = path.join(
    path.resolve(workRoot),
    "config",
    managedBdsScriptModuleId,
  );
  await mkdir(configRoot, { recursive: true, mode: 0o700 });
  await chmod(configRoot, 0o700).catch(() => undefined);
  const staged = [];
  try {
    for (const [filename, contents] of Object.entries(files)) {
      const targetPath = path.join(configRoot, filename);
      const temporaryPath = path.join(
        configRoot,
        `.${filename}.${String(process.pid)}.${randomUUID()}.tmp`,
      );
      await writeFile(temporaryPath, `${JSON.stringify(contents, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      staged.push({ targetPath, temporaryPath });
    }
    for (const { targetPath, temporaryPath } of staged) {
      await rename(temporaryPath, targetPath);
      await chmod(targetPath, 0o600).catch(() => undefined);
    }
  } catch (error) {
    await Promise.all(
      staged.map(({ temporaryPath }) =>
        rm(temporaryPath, { force: true }).catch(() => undefined),
      ),
    );
    throw new Error(
      "Unable to write managed BDS runtime worker configuration.",
      {
        cause: error,
      },
    );
  }
  return configRoot;
}

export function patchDisposableBetaApisLevelDat(source) {
  if (!Buffer.isBuffer(source) || source.byteLength < 10) {
    throw new Error("Disposable acceptance level.dat is truncated.");
  }
  if (source.readUInt32LE(0) !== supportedLevelDatVersion) {
    throw new Error(
      `Disposable acceptance level.dat version must be ${String(supportedLevelDatVersion)}.`,
    );
  }
  const payloadBytes = source.readUInt32LE(4);
  if (payloadBytes !== source.byteLength - 8) {
    throw new Error(
      "Disposable acceptance level.dat has an invalid payload length.",
    );
  }
  const payload = Buffer.from(source.subarray(8));
  if (payload[0] !== nbtTag.compound) {
    throw new Error("Disposable acceptance level.dat root must be a compound.");
  }
  const rootName = readNbtName(payload, 1);
  const root = scanNbtCompound(payload, rootName.endOffset, 0);
  if (root.endOffset !== payload.byteLength) {
    throw new Error(
      "Disposable acceptance level.dat contains trailing NBT data.",
    );
  }
  const experiments = root.entries.find(
    (entry) => entry.name === "experiments",
  );
  if (experiments === undefined || experiments.type !== nbtTag.compound) {
    throw new Error(
      "Disposable acceptance level.dat has no experiments compound.",
    );
  }
  const experimentEntries = scanNbtCompound(
    payload,
    experiments.payloadOffset,
    1,
  );
  const updated = Buffer.from(payload);
  const requiredTags = [
    "gametest",
    "experiments_ever_used",
    "saved_with_toggled_experiments",
  ];
  const additions = [];
  let changed = false;
  for (const name of requiredTags) {
    const entry = experimentEntries.entries.find(
      (candidate) => candidate.name === name,
    );
    if (entry === undefined) {
      additions.push(encodeNbtByteTag(name, 1));
      changed = true;
      continue;
    }
    if (entry.type !== nbtTag.byte) {
      throw new Error(
        `Disposable acceptance level.dat experiment ${name} must be a byte.`,
      );
    }
    if (updated[entry.payloadOffset] !== 1) {
      updated[entry.payloadOffset] = 1;
      changed = true;
    }
  }
  if (!changed) return source;

  const inserted =
    additions.length === 0
      ? updated
      : Buffer.concat([
          updated.subarray(0, experimentEntries.endTagOffset),
          ...additions,
          updated.subarray(experimentEntries.endTagOffset),
        ]);
  const result = Buffer.allocUnsafe(inserted.byteLength + 8);
  result.writeUInt32LE(source.readUInt32LE(0), 0);
  result.writeUInt32LE(inserted.byteLength, 4);
  inserted.copy(result, 8);
  validatePatchedBetaApisLevelDat(result);
  return result;
}

export async function enableDisposableAcceptanceBetaApis(worldRoot) {
  const resolvedWorldRoot = path.resolve(worldRoot);
  const temporaryRoot = path.resolve(os.homedir(), "tmp");
  if (
    path.basename(resolvedWorldRoot) !== acceptanceFixtureWorldName ||
    !isWithin(resolvedWorldRoot, temporaryRoot)
  ) {
    throw new Error(
      "Beta APIs may be enabled automatically only for the disposable acceptance world under the user tmp directory.",
    );
  }
  const levelDatPath = path.join(resolvedWorldRoot, "level.dat");
  const source = await readFile(levelDatPath);
  const patched = patchDisposableBetaApisLevelDat(source);
  if (patched === source) return false;

  const temporaryPath = path.join(
    resolvedWorldRoot,
    `.level.dat.${String(process.pid)}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryPath, patched, { flag: "wx", mode: 0o600 });
    await rename(temporaryPath, levelDatPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw new Error(
      "Unable to enable Beta APIs for the disposable acceptance world.",
      { cause: error },
    );
  }
  return true;
}

export function isDiagnosticLine(line) {
  if (line.includes(workMonitorLogPrefix)) return false;
  if (
    /requesting dependency on beta APIs .*Beta APIs experiment is not enabled/iu.test(
      line,
    )
  ) {
    return true;
  }
  for (const marker of [
    "CS_DEBUG_ACCEPTANCE_FIXTURE ",
    "CS_DEBUG_COMMAND ",
    "CS_DEBUG_COMPUTER_LIST ",
    "CS_DEBUG_WEB_REQUEST ",
  ]) {
    const markerIndex = line.indexOf(marker);
    if (markerIndex < 0) continue;
    try {
      JSON.parse(line.slice(markerIndex + marker.length));
      return false;
    } catch {
      return true;
    }
  }
  return /\[(?:Blocks|Item|Items|Json|Scripting|UI)\].*(?:error|warning)|(?:exception|stack trace|syntax error)/iu.test(
    line,
  );
}

export function parseWorkMonitorLine(line) {
  const marker = line.indexOf(workMonitorLogPrefix);
  if (marker < 0) return undefined;
  try {
    const value = JSON.parse(line.slice(marker + workMonitorLogPrefix.length));
    if (
      typeof value !== "object" ||
      value === null ||
      !Number.isSafeInteger(value.completedTicks) ||
      typeof value.tickHostMicroseconds !== "object" ||
      value.tickHostMicroseconds === null ||
      typeof value.lanes !== "object" ||
      value.lanes === null ||
      !isFiniteMetric(value.tickHostMicroseconds.p50) ||
      !isFiniteMetric(value.tickHostMicroseconds.p95) ||
      !isFiniteMetric(value.tickHostMicroseconds.p99)
    ) {
      return undefined;
    }
    const lanes = {};
    for (const lane of workMonitorLanes) {
      const metrics = value.lanes[lane];
      if (typeof metrics !== "object" || metrics === null) continue;
      lanes[lane] = Object.fromEntries(
        [
          "admitted",
          "deferred",
          "failed",
          "hostMicroseconds",
          "maximumAtomicHostMicroseconds",
          "overruns",
          "units",
        ]
          .filter((key) => isFiniteMetric(metrics[key]))
          .map((key) => [key, metrics[key]]),
      );
    }
    return {
      completedTicks: value.completedTicks,
      emergencyLimitDeferrals: finiteMetricOrZero(
        value.emergencyLimitDeferrals,
      ),
      softLimitDeferrals: finiteMetricOrZero(value.softLimitDeferrals),
      tickHostMicroseconds: {
        p50: value.tickHostMicroseconds.p50,
        p95: value.tickHostMicroseconds.p95,
        p99: value.tickHostMicroseconds.p99,
      },
      lanes,
    };
  } catch {
    return undefined;
  }
}

function isFiniteMetric(value) {
  return Number.isFinite(value) && value >= 0;
}

function finiteMetricOrZero(value) {
  return isFiniteMetric(value) ? value : 0;
}

export function isAllowedBdsCommand(command) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    command.length > 240 ||
    /[\r\n\0]/u.test(command)
  ) {
    return false;
  }
  if (command === "list") return true;
  if (
    /^scriptevent computer_system:debug-acceptance-fixture a[a-z0-9]+-[a-z0-9]+$/u.test(
      command,
    )
  )
    return true;
  if (
    /^scriptevent computer_system:debug-command d[a-z0-9]+-[a-z0-9]+ c-[0-9a-hjkmnp-tv-z]{6} v[^\s]{1,180}$/u.test(
      command,
    )
  )
    return true;
  if (
    /^scriptevent computer_system:debug-web-request w[a-z0-9]+-[a-z0-9]+ c-[0-9a-hjkmnp-tv-z]{6}$/u.test(
      command,
    )
  )
    return true;
  if (
    /^scriptevent computer_system:debug-computer-list l[a-z0-9]+-[a-z0-9]+ [0-9]{1,10} (?:[1-9]|[1-5][0-9]|6[0-4])$/u.test(
      command,
    )
  )
    return true;

  const serverProbe = /^scriptevent computer_system:probe ([a-z-]+)$/u.exec(
    command,
  );
  if (serverProbe !== null) {
    return allowedServerProbes.has(serverProbe[1]);
  }

  const playerProbe =
    /^execute as @a at @s run scriptevent computer_system:probe ([a-z-]+)$/u.exec(
      command,
    );
  return playerProbe !== null && allowedPlayerProbes.has(playerProbe[1] ?? "");
}

export function validateAcceptanceFixtureStart(options) {
  const acceptanceFixture = options.acceptanceFixture ?? false;
  if (typeof acceptanceFixture !== "boolean") {
    throw new Error("acceptanceFixture must be a boolean.");
  }
  if (!acceptanceFixture) return;
  if (options.resetWorld !== true) {
    throw new Error("The acceptance fixture requires resetWorld: true.");
  }
  if (!options.explicitWorkRoot) {
    throw new Error(
      "The acceptance fixture requires an explicit BDS_MCP_WORKDIR.",
    );
  }
  if (options.worldName !== acceptanceFixtureWorldName) {
    throw new Error(
      `The acceptance fixture requires BDS_MCP_WORLD=${acceptanceFixtureWorldName}.`,
    );
  }
  const temporaryRoot = path.resolve(
    options.temporaryRoot ?? path.join(os.homedir(), "tmp"),
  );
  const workRoot = path.resolve(options.workRoot);
  if (!isWithin(workRoot, temporaryRoot)) {
    throw new Error(
      "The acceptance fixture work directory must be a child of the user tmp directory.",
    );
  }
}

export function isAllowedWebRelayCommand(command) {
  if (
    typeof command !== "string" ||
    command.length === 0 ||
    command.length > 400 ||
    /[\r\n\0]/u.test(command)
  ) {
    return false;
  }
  if (
    /^scriptevent computer_system:web-response r[a-z0-9]+-[a-z0-9]+ [A-Za-z0-9_-]{12,32} (?:writer|viewer)(?: debug)? https?:\/\/[A-Za-z0-9.:[\]-]+(?::\d{1,5})?\/p\/[0-9]{4}$/u.test(
      command,
    )
  ) {
    return true;
  }
  return (
    /^scriptevent computer_system:web-(?:close|take-control) [A-Za-z0-9_-]{12,32}$/u.test(
      command,
    ) ||
    /^scriptevent computer_system:web-power [A-Za-z0-9_-]{12,32} [A-Za-z0-9_-]{6,20} (?:power_on|safe_boot|shutdown)$/u.test(
      command,
    ) ||
    /^scriptevent computer_system:web-floppy-eject [A-Za-z0-9_-]{12,32} [A-Za-z0-9_-]{6,20}$/u.test(
      command,
    ) ||
    /^scriptevent computer_system:web-input [A-Za-z0-9_-]{12,32} [A-Za-z0-9_-]{6,20} [0-9]{1,16} (?:abort-line|cancel|interrupt|line|keys|mouse) [^\s]{0,180}$/u.test(
      command,
    ) ||
    /^scriptevent computer_system:web-complete [A-Za-z0-9_-]{12,32} [A-Za-z0-9_-]{6,20} [0-9]{1,16} [0-9]{1,3} v[^\s]{0,128}$/u.test(
      command,
    ) ||
    /^scriptevent computer_system:web-resize [A-Za-z0-9_-]{12,32} [0-9]{2,3} [0-9]{2,3}$/u.test(
      command,
    )
  );
}

export class BdsDebugSession {
  constructor(options = {}) {
    this.environment = options.environment ?? process.env;
    this.projectRoot = options.projectRoot ?? projectRoot;
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.maxLogLines = options.maxLogLines ?? 2_000;
    this.state = "idle";
    this.lastError = undefined;
    this.handle = undefined;
    this.logCursor = 0;
    this.logLines = [];
    this.events = new EventEmitter();
    this.transition = Promise.resolve();
    this.commandTail = Promise.resolve();
    this.nextDebugRequest = 1;
    this.pendingDebugCommands = 0;
    this.nextWebRequest = 1;
    this.pendingWebRequests = 0;
    this.nextComputerListRequest = 1;
    this.pendingComputerListRequests = 0;
    this.nextAcceptanceFixtureRequest = 1;
    this.pendingAcceptanceFixtureRequests = 0;
    this.acceptanceFixture = false;
    this.workMonitor = undefined;
    this.serverPort = parseBdsPort(this.environment.BDS_MCP_PORT);
    this.worldName = this.environment.BDS_MCP_WORLD ?? defaultWorldName;
    this.sourceRoot = path.resolve(
      this.environment.BDS_HOME ?? defaultDistributionRoot,
    );
    this.workRoot = path.resolve(
      this.environment.BDS_MCP_WORKDIR ?? defaultWorkRoot,
    );
    this.managedWorkRoot = this.environment.BDS_MCP_WORKDIR === undefined;
    this.packOutputRoot = path.join(this.projectRoot, "dist");
    this.runtimeWorkers = normalizeManagedRuntimeWorkers(
      options.runtimeWorkers,
    );
  }

  getStatus() {
    return {
      state: this.state,
      running: this.state === "running",
      ready: this.handle?.ready === true,
      pid: this.handle?.child.pid ?? null,
      address: "127.0.0.1",
      port: this.serverPort,
      world: this.worldName,
      sourceRoot: this.sourceRoot,
      workRoot: this.workRoot,
      acceptanceFixture: this.acceptanceFixture,
      logCursor: this.logCursor,
      diagnostics: this.logLines.filter((entry) => entry.diagnostic).length,
      lastError: this.lastError ?? null,
      workMonitor: this.workMonitor ?? null,
      runtimeWorkers:
        this.runtimeWorkers === undefined
          ? null
          : {
              count: this.runtimeWorkers.count,
              endpoint: this.runtimeWorkers.endpoint,
            },
    };
  }

  onLog(listener) {
    this.events.on("log", listener);
    return () => this.events.off("log", listener);
  }

  onState(listener) {
    this.events.on("state", listener);
    return () => this.events.off("state", listener);
  }

  start(options = {}) {
    return this.#exclusive(() => this.#start(options));
  }

  stop() {
    return this.#exclusive(() => this.#stop());
  }

  async runProbe(probe, target = "all_players") {
    if (probe === "headless") {
      if (target !== "server") {
        throw new Error("The headless probe must target the server.");
      }
      return this.runCommand("scriptevent computer_system:probe headless");
    }
    if (!allowedPlayerProbes.has(probe)) {
      throw new Error(`Unsupported player probe: ${String(probe)}`);
    }
    if (target !== "all_players") {
      throw new Error("Player probes must target all_players.");
    }
    return this.runCommand(
      `execute as @a at @s run scriptevent computer_system:probe ${probe}`,
    );
  }

  runCommand(command) {
    if (!isAllowedBdsCommand(command)) {
      throw new Error(
        "Command rejected. Allowed commands are list and Computer System probe commands.",
      );
    }
    if (this.state !== "running" || this.handle?.ready !== true) {
      throw new Error("Bedrock Dedicated Server is not running and ready.");
    }

    const cursor = this.logCursor;
    const operation = this.commandTail.then(
      () => this.#writeCommand(this.handle, command),
      () => this.#writeCommand(this.handle, command),
    );
    this.commandTail = operation.catch(() => undefined);
    return operation.then(() => ({ command, afterCursor: cursor }));
  }

  async provisionAcceptanceFixture(options = {}) {
    if (!this.acceptanceFixture) {
      throw new Error("The MCP acceptance fixture is not active.");
    }
    if (this.pendingAcceptanceFixtureRequests >= 2) {
      throw new Error("Acceptance fixture capacity has been reached.");
    }
    const timeoutMs = Math.min(
      asPositiveInteger(options.timeoutMs ?? 10_000),
      30_000,
    );
    const requestId = `a${Date.now().toString(36)}-${this.nextAcceptanceFixtureRequest.toString(36)}`;
    this.nextAcceptanceFixtureRequest =
      this.nextAcceptanceFixtureRequest === Number.MAX_SAFE_INTEGER
        ? 1
        : this.nextAcceptanceFixtureRequest + 1;
    this.pendingAcceptanceFixtureRequests += 1;
    try {
      const sent = await this.runCommand(
        `scriptevent computer_system:debug-acceptance-fixture ${requestId}`,
      );
      const entry = await this.waitForLog({
        contains: `"requestId":"${requestId}"`,
        afterCursor: sent.afterCursor,
        timeoutMs,
      });
      const marker = "CS_DEBUG_ACCEPTANCE_FIXTURE ";
      const markerIndex = entry.line.indexOf(marker);
      if (markerIndex < 0) {
        throw new Error("Malformed acceptance fixture response.");
      }
      const response = JSON.parse(
        entry.line.slice(markerIndex + marker.length),
      );
      if (response.requestId !== requestId) {
        throw new Error("Mismatched acceptance fixture response.");
      }
      if (
        response.status === "completed" &&
        !/^c-[0-9a-hjkmnp-tv-z]{6}$/u.test(response.computerId)
      ) {
        throw new Error("Malformed acceptance fixture Computer identity.");
      }
      return response;
    } finally {
      this.pendingAcceptanceFixtureRequests -= 1;
    }
  }

  runWebRelay(command) {
    if (!isAllowedWebRelayCommand(command)) {
      throw new Error("Web relay command rejected.");
    }
    if (this.state !== "running" || this.handle?.ready !== true) {
      throw new Error("Bedrock Dedicated Server is not running and ready.");
    }
    const operation = this.commandTail.then(
      () => this.#writeCommand(this.handle, command),
      () => this.#writeCommand(this.handle, command),
    );
    this.commandTail = operation.catch(() => undefined);
    return operation.then(() => ({ command }));
  }

  async executeComputerCommand(options = {}) {
    const computerId = options.computerId;
    const command = options.command;
    if (
      typeof computerId !== "string" ||
      !/^c-[0-9a-hjkmnp-tv-z]{6}$/u.test(computerId)
    ) {
      throw new Error("computerId must use the c-xxxxxx identity format.");
    }
    if (
      typeof command !== "string" ||
      command.length === 0 ||
      command.length > 128 ||
      /\0/u.test(command) ||
      (/[\r\n]/u.test(command) &&
        !/^(?:micropython|python)\s+-c\s+[\s\S]+$/u.test(command))
    ) {
      throw new Error(
        "command must contain 1 to 128 characters; only python -c may contain line breaks.",
      );
    }
    if (this.pendingDebugCommands >= 8) {
      throw new Error("Computer command debug capacity has been reached.");
    }
    const encoded = encodeURIComponent(command);
    if (encoded.length > 180 || /\s/u.test(encoded)) {
      throw new Error("Encoded command exceeds the 180-character relay limit.");
    }
    const timeoutMs = Math.min(
      asPositiveInteger(options.timeoutMs ?? 10_000),
      30_000,
    );
    const requestId = `d${Date.now().toString(36)}-${this.nextDebugRequest.toString(36)}`;
    this.nextDebugRequest =
      this.nextDebugRequest === Number.MAX_SAFE_INTEGER
        ? 1
        : this.nextDebugRequest + 1;
    this.pendingDebugCommands += 1;
    try {
      const sent = await this.runCommand(
        `scriptevent computer_system:debug-command ${requestId} ${computerId} v${encoded}`,
      );
      const entry = await this.waitForLog({
        contains: `"requestId":"${requestId}"`,
        afterCursor: sent.afterCursor,
        timeoutMs,
      });
      const marker = "CS_DEBUG_COMMAND ";
      const markerIndex = entry.line.indexOf(marker);
      if (markerIndex < 0) throw new Error("Malformed debug command response.");
      const response = JSON.parse(
        entry.line.slice(markerIndex + marker.length),
      );
      if (
        response.requestId !== requestId ||
        response.computerId !== computerId
      ) {
        throw new Error("Mismatched debug command response.");
      }
      return response;
    } finally {
      this.pendingDebugCommands -= 1;
    }
  }

  async requestWebHandoff(options = {}) {
    const computerId = options.computerId;
    if (
      typeof computerId !== "string" ||
      !/^c-[0-9a-hjkmnp-tv-z]{6}$/u.test(computerId)
    ) {
      throw new Error("computerId must use the c-xxxxxx identity format.");
    }
    if (this.pendingWebRequests >= 4) {
      throw new Error("Web handoff debug capacity has been reached.");
    }
    const timeoutMs = Math.min(
      asPositiveInteger(options.timeoutMs ?? 30_000),
      120_000,
    );
    const requestId = `w${Date.now().toString(36)}-${this.nextWebRequest.toString(36)}`;
    this.nextWebRequest =
      this.nextWebRequest === Number.MAX_SAFE_INTEGER
        ? 1
        : this.nextWebRequest + 1;
    this.pendingWebRequests += 1;
    try {
      const sent = await this.runCommand(
        `scriptevent computer_system:debug-web-request ${requestId} ${computerId}`,
      );
      const entry = await this.waitForLog({
        contains: `"requestId":"${requestId}"`,
        afterCursor: sent.afterCursor,
        timeoutMs,
      });
      const marker = "CS_DEBUG_WEB_REQUEST ";
      const markerIndex = entry.line.indexOf(marker);
      if (markerIndex < 0) throw new Error("Malformed Web handoff response.");
      const response = JSON.parse(
        entry.line.slice(markerIndex + marker.length),
      );
      if (
        response.requestId !== requestId ||
        response.computerId !== computerId
      ) {
        throw new Error("Mismatched Web handoff response.");
      }
      if (response.status !== "requested") {
        throw new Error(
          typeof response.error === "string"
            ? response.error
            : "Bedrock rejected the Web handoff request.",
        );
      }
      return response;
    } finally {
      this.pendingWebRequests -= 1;
    }
  }

  async listComputers(options = {}) {
    const cursor = asNonNegativeInteger(options.cursor ?? 0);
    const limit = asPositiveInteger(options.limit ?? 32);
    if (limit > 64) {
      throw new Error("Computer list limit must be between 1 and 64.");
    }
    if (cursor > 9_999_999_999) {
      throw new Error("Computer list cursor exceeds the supported range.");
    }
    if (this.pendingComputerListRequests >= 4) {
      throw new Error("Computer list debug capacity has been reached.");
    }
    const timeoutMs = Math.min(
      asPositiveInteger(options.timeoutMs ?? 10_000),
      120_000,
    );
    const requestId =
      "l" +
      Date.now().toString(36) +
      "-" +
      this.nextComputerListRequest.toString(36);
    this.nextComputerListRequest =
      this.nextComputerListRequest === Number.MAX_SAFE_INTEGER
        ? 1
        : this.nextComputerListRequest + 1;
    this.pendingComputerListRequests += 1;
    try {
      const sent = await this.runCommand(
        "scriptevent computer_system:debug-computer-list " +
          requestId +
          " " +
          cursor.toString() +
          " " +
          limit.toString(),
      );
      const entry = await this.waitForLog({
        contains: '"requestId":"' + requestId + '"',
        afterCursor: sent.afterCursor,
        timeoutMs,
      });
      const marker = "CS_DEBUG_COMPUTER_LIST ";
      const markerIndex = entry.line.indexOf(marker);
      if (markerIndex < 0) throw new Error("Malformed Computer list response.");
      const response = JSON.parse(
        entry.line.slice(markerIndex + marker.length),
      );
      if (response.requestId !== requestId) {
        throw new Error("Mismatched Computer list response.");
      }
      if (response.status !== "completed") {
        throw new Error(
          typeof response.error === "string"
            ? response.error
            : "Bedrock rejected the Computer list request.",
        );
      }
      if (
        response.cursor !== cursor ||
        !Number.isSafeInteger(response.total) ||
        response.total < 0 ||
        !Array.isArray(response.computers) ||
        response.computers.length > limit ||
        !response.computers.every(isComputerListEntry) ||
        !(
          response.nextCursor === null ||
          (Number.isSafeInteger(response.nextCursor) &&
            response.nextCursor > cursor &&
            response.nextCursor <= response.total)
        )
      ) {
        throw new Error("Invalid Computer list response.");
      }
      return {
        ...response,
        computers: response.computers.map((computer) => ({
          ...computer,
          connectionCode: permanentComputerCode(computer.computerId),
        })),
      };
    } finally {
      this.pendingComputerListRequests -= 1;
    }
  }

  getLogs(options = {}) {
    const afterCursor = asNonNegativeInteger(options.afterCursor ?? 0);
    const limit = Math.min(
      asPositiveInteger(options.limit ?? 200),
      this.maxLogLines,
    );
    return this.logLines
      .filter(
        (entry) =>
          entry.cursor > afterCursor &&
          (options.diagnosticsOnly !== true || entry.diagnostic),
      )
      .slice(0, limit);
  }

  waitForLog(options) {
    const contains = options.contains;
    if (
      typeof contains !== "string" ||
      contains.length === 0 ||
      contains.length > 500
    ) {
      throw new Error("contains must be between 1 and 500 characters.");
    }
    const afterCursor = asNonNegativeInteger(options.afterCursor ?? 0);
    const timeoutMs = Math.min(
      asPositiveInteger(options.timeoutMs ?? 10_000),
      120_000,
    );
    const existing = this.logLines.find(
      (entry) => entry.cursor > afterCursor && entry.line.includes(contains),
    );
    if (existing !== undefined) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const onLog = (entry) => {
        if (entry.cursor > afterCursor && entry.line.includes(contains)) {
          clearTimeout(timeout);
          this.events.off("log", onLog);
          resolve(entry);
        }
      };
      const timeout = setTimeout(() => {
        this.events.off("log", onLog);
        reject(
          new Error(
            `Timed out after ${String(timeoutMs)} ms waiting for log text: ${contains}`,
          ),
        );
      }, timeoutMs);
      this.events.on("log", onLog);
    });
  }

  #exclusive(operation) {
    const result = this.transition.then(operation, operation);
    this.transition = result.catch(() => undefined);
    return result;
  }

  async #start({ resetWorld = false, acceptanceFixture = false } = {}) {
    if (typeof resetWorld !== "boolean") {
      throw new Error("resetWorld must be a boolean.");
    }
    validateAcceptanceFixtureStart({
      acceptanceFixture,
      resetWorld,
      explicitWorkRoot: !this.managedWorkRoot,
      worldName: this.worldName,
      workRoot: this.workRoot,
    });
    if (this.state === "running") {
      if (this.acceptanceFixture !== acceptanceFixture) {
        throw new Error(
          "The running BDS mode does not match the requested acceptance fixture mode.",
        );
      }
      return this.getStatus();
    }
    this.#setState("starting");
    this.lastError = undefined;

    try {
      await this.#validateRoots();
      let runtimeCreated;
      if (acceptanceFixture) {
        runtimeCreated = await this.#prepareRuntime(resetWorld);
        this.packOutputRoot = path.join(
          this.workRoot,
          ".computer-system-acceptance-packs",
        );
        await this.#runBuild(true);
      } else {
        this.packOutputRoot = path.join(this.projectRoot, "dist");
        await this.#runBuild(false);
        runtimeCreated = await this.#prepareRuntime(resetWorld);
      }
      await this.#configureServer();
      if (this.runtimeWorkers !== undefined) {
        await writeManagedRuntimeWorkerConfig(
          this.workRoot,
          this.runtimeWorkers,
        );
      }

      if (runtimeCreated || !(await exists(this.#worldRoot()))) {
        const generator = this.#spawnServer("generation");
        this.handle = generator;
        try {
          await withTimeout(
            generator.readyPromise,
            90_000,
            "BDS world generation startup",
          );
          await this.#writeCommand(generator, "stop");
          await withTimeout(
            generator.closedPromise,
            20_000,
            "BDS world generation shutdown",
          );
        } finally {
          if (!generator.closed) {
            generator.child.kill();
            await withTimeout(
              generator.closedPromise,
              5_000,
              "BDS world generation cleanup",
            ).catch(() => undefined);
          }
          if (this.handle === generator) this.handle = undefined;
        }
      }

      if (acceptanceFixture && this.runtimeWorkers !== undefined) {
        await enableDisposableAcceptanceBetaApis(this.#worldRoot());
      }
      await this.#installWorldPacks();
      const handle = this.#spawnServer("debug");
      this.handle = handle;
      await withTimeout(handle.readyPromise, 90_000, "BDS debug startup");
      // BDS announces transport readiness before world Script API startup has
      // finished. Match the proven probe runner grace period so the first MCP
      // command cannot race component registration and world initialization.
      await delay(1_000);
      if (handle.closed) {
        throw new Error(
          "BDS exited during the Script API startup grace period.",
        );
      }
      await this.#verifyManagedRuntimeWorkerBootstrap();
      this.#setState("running");
      this.acceptanceFixture = acceptanceFixture;
      return this.getStatus();
    } catch (error) {
      this.lastError = errorMessage(error);
      this.acceptanceFixture = false;
      this.#setState("failed");
      const activeHandle = this.handle;
      if (activeHandle !== undefined) {
        if (!activeHandle.closed) activeHandle.child.kill();
        await withTimeout(
          activeHandle.closedPromise,
          5_000,
          "BDS failed-start cleanup",
        ).catch(() => undefined);
        if (this.handle === activeHandle) this.handle = undefined;
      }
      throw error;
    }
  }

  async #stop() {
    if (this.state === "idle") {
      this.acceptanceFixture = false;
      return this.getStatus();
    }
    const handle = this.handle;
    if (handle === undefined) {
      this.acceptanceFixture = false;
      this.#setState("idle");
      return this.getStatus();
    }

    this.#setState("stopping");
    try {
      if (!handle.closed && !handle.child.stdin.destroyed) {
        await this.#writeCommand(handle, "stop");
      }
      try {
        await withTimeout(
          handle.closedPromise,
          20_000,
          "BDS graceful shutdown",
        );
      } catch (error) {
        handle.child.kill();
        await withTimeout(handle.closedPromise, 5_000, "BDS forced shutdown");
        throw error;
      }
      this.handle = undefined;
      this.acceptanceFixture = false;
      this.#setState("idle");
      return this.getStatus();
    } catch (error) {
      this.handle = undefined;
      this.acceptanceFixture = false;
      this.#setState("failed");
      this.lastError = errorMessage(error);
      throw error;
    }
  }

  async #validateRoots() {
    if (
      this.workRoot === this.sourceRoot ||
      isWithin(this.workRoot, this.sourceRoot)
    ) {
      throw new Error("BDS_MCP_WORKDIR must not be inside BDS_HOME.");
    }
    await access(path.join(this.sourceRoot, executableName));
  }

  async #verifyManagedRuntimeWorkerBootstrap() {
    if (this.runtimeWorkers === undefined) return;
    const readyMarker = `${managedRuntimeWorkerReadyMarker}${JSON.stringify({
      workerCount: this.runtimeWorkers.count,
    })}`;
    const betaApiFailure = () =>
      this.logLines.find((entry) =>
        /requesting dependency on beta APIs .*Beta APIs experiment is not enabled/iu.test(
          entry.line,
        ),
      );
    if (betaApiFailure() !== undefined) {
      throw new Error(
        "Managed runtime workers require the irreversible Beta APIs experiment; it is not enabled for this world.",
      );
    }
    try {
      await this.waitForLog({
        contains: readyMarker,
        afterCursor: 0,
        timeoutMs: 10_000,
      });
    } catch (error) {
      if (betaApiFailure() !== undefined) {
        throw new Error(
          "Managed runtime workers require the irreversible Beta APIs experiment; it is not enabled for this world.",
        );
      }
      throw new Error(
        "Managed runtime worker bootstrap did not reach an observable ready state.",
        { cause: error },
      );
    }
  }

  async #runBuild(acceptanceFixture) {
    const handle = this.#spawnChild(
      process.execPath,
      [path.join(this.projectRoot, "tools", "build.mjs")],
      this.projectRoot,
      "build",
      {
        ...this.environment,
        COMPUTER_SYSTEM_ACCEPTANCE_FIXTURE: acceptanceFixture ? "1" : "0",
        COMPUTER_SYSTEM_MANAGED_BDS:
          this.runtimeWorkers === undefined ? "0" : "1",
        COMPUTER_SYSTEM_RUNTIME_WORKERS:
          this.runtimeWorkers === undefined
            ? undefined
            : String(this.runtimeWorkers.count),
        ...(acceptanceFixture
          ? { COMPUTER_SYSTEM_PACK_OUTPUT: this.packOutputRoot }
          : { COMPUTER_SYSTEM_PACK_OUTPUT: undefined }),
      },
    );
    let result;
    try {
      result = await withTimeout(
        handle.closedPromise,
        120_000,
        "resource-pack build",
      );
    } finally {
      if (!handle.closed) {
        handle.child.kill();
        await withTimeout(
          handle.closedPromise,
          5_000,
          "resource-pack build cleanup",
        ).catch(() => undefined);
      }
    }
    if (result.code !== 0) {
      throw new Error(
        `Resource-pack build exited with code ${String(result.code)}.`,
      );
    }
  }

  async #prepareRuntime(resetWorld) {
    const executable = path.join(this.workRoot, executableName);
    const runtimeExists = await exists(executable);
    if (!resetWorld && runtimeExists) return false;

    if (!this.managedWorkRoot) {
      await mkdir(this.workRoot, { recursive: true });
      const entries = await readdir(this.workRoot);
      if (entries.length !== 0) {
        throw new Error(
          `Refusing to reset non-empty BDS_MCP_WORKDIR: ${this.workRoot}`,
        );
      }
    } else {
      if (this.workRoot !== defaultWorkRoot) {
        throw new Error(
          `Refusing to reset unexpected managed path: ${this.workRoot}`,
        );
      }
      await rm(this.workRoot, { force: true, recursive: true });
      await mkdir(this.workRoot, { recursive: true });
    }
    await cp(this.sourceRoot, this.workRoot, { recursive: true });
    await rm(this.#worldRoot(), { force: true, recursive: true });
    return true;
  }

  async #configureServer() {
    const propertiesPath = path.join(this.workRoot, "server.properties");
    let properties = await readFile(propertiesPath, "utf8");
    const overrides = {
      "allow-cheats": "true",
      "allow-list": "false",
      "content-log-file-enabled": "true",
      "content-log-console-output-enabled": "true",
      "default-player-permission-level": "operator",
      "force-gamemode": "true",
      gamemode: "creative",
      "level-name": this.worldName,
      "online-mode": "true",
      "server-name": "Computer System MCP Debug",
      "server-port": String(this.serverPort),
      "server-portv6": String(this.serverPort + 1),
      "texturepack-required": "true",
    };
    for (const [key, value] of Object.entries(overrides)) {
      const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, "mu");
      properties = pattern.test(properties)
        ? properties.replace(pattern, `${key}=${value}`)
        : `${properties.trimEnd()}\n${key}=${value}\n`;
    }
    await writeFile(propertiesPath, properties, "utf8");
  }

  async #installWorldPacks() {
    const worldRoot = this.#worldRoot();
    await access(worldRoot);
    const behaviorManifest = JSON.parse(
      await readFile(
        path.join(this.packOutputRoot, "behavior_pack", "manifest.json"),
        "utf8",
      ),
    );
    const resourceManifest = JSON.parse(
      await readFile(
        path.join(this.packOutputRoot, "resource_pack", "manifest.json"),
        "utf8",
      ),
    );
    const packs = [
      {
        kind: "behavior",
        manifest: behaviorManifest,
        source: path.join(this.packOutputRoot, "behavior_pack"),
      },
      {
        kind: "resource",
        manifest: resourceManifest,
        source: path.join(this.packOutputRoot, "resource_pack"),
      },
    ];
    for (const pack of packs) {
      const directory = `${pack.kind}_packs`;
      const target = path.join(worldRoot, directory, "computer_system_phase_0");
      await rm(target, { force: true, recursive: true });
      await mkdir(path.dirname(target), { recursive: true });
      await cp(pack.source, target, { recursive: true });
      await writeFile(
        path.join(worldRoot, `world_${pack.kind}_packs.json`),
        `${JSON.stringify(
          [
            {
              pack_id: pack.manifest.header.uuid,
              version: pack.manifest.header.version,
            },
          ],
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  }

  #worldRoot() {
    return path.join(this.workRoot, "worlds", this.worldName);
  }

  #spawnServer(label) {
    return this.#spawnChild(
      path.join(this.workRoot, executableName),
      [],
      this.workRoot,
      label,
      process.platform === "linux"
        ? { ...process.env, LD_LIBRARY_PATH: this.workRoot }
        : process.env,
    );
  }

  #spawnChild(command, args, cwd, label, environment = process.env) {
    const child = this.spawnProcess(command, args, {
      cwd,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const buffers = { stdout: "", stderr: "" };
    let ready = label === "build";
    let closed = false;
    let resolveReady;
    let rejectReady;
    let resolveClosed;
    const readyPromise = new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    const closedPromise = new Promise((resolve) => {
      resolveClosed = resolve;
    });
    if (ready) resolveReady();

    const handle = {
      child,
      get ready() {
        return ready;
      },
      get closed() {
        return closed;
      },
      readyPromise,
      closedPromise,
      consume: (chunk, stream) => consume(chunk, stream),
    };

    const consume = (chunk, stream) => {
      buffers[stream] += chunk.toString();
      const lines = buffers[stream].split(/\r?\n/u);
      buffers[stream] = lines.pop() ?? "";
      for (const line of lines) {
        this.#appendLog(label, stream, line);
        if (!ready && /Server started/u.test(line)) {
          ready = true;
          resolveReady();
        }
      }
    };
    child.stdout.on("data", (chunk) => consume(chunk, "stdout"));
    child.stderr.on("data", (chunk) => consume(chunk, "stderr"));
    child.on("error", (error) => {
      this.#appendLog(label, "process", errorMessage(error));
      rejectReady(error);
    });
    child.on("close", (code, signal) => {
      for (const stream of ["stdout", "stderr"]) {
        if (buffers[stream].length > 0) {
          this.#appendLog(label, stream, buffers[stream]);
        }
      }
      closed = true;
      if (!ready) {
        rejectReady(
          new Error(
            `${label} exited before readiness (code ${String(code)}, signal ${String(signal)}).`,
          ),
        );
      }
      resolveClosed({ code, signal });
      if (handle === this.handle && this.state === "running") {
        this.handle = undefined;
        this.acceptanceFixture = false;
        if (code === 0) {
          this.#setState("idle");
        } else {
          this.#setState("failed");
          this.lastError = `BDS exited unexpectedly with code ${String(code)}.`;
        }
      }
    });
    return handle;
  }

  #appendLog(source, stream, line) {
    const workMonitor = parseWorkMonitorLine(line);
    if (workMonitor !== undefined) this.workMonitor = workMonitor;
    this.logCursor += 1;
    const entry = {
      cursor: this.logCursor,
      timestamp: new Date().toISOString(),
      source,
      stream,
      diagnostic: isDiagnosticLine(line),
      line,
    };
    this.logLines.push(entry);
    if (this.logLines.length > this.maxLogLines) this.logLines.shift();
    this.events.emit("log", entry);
  }

  #setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.events.emit("state", state);
  }

  #writeCommand(handle, command) {
    if (handle.closed || handle.child.stdin.destroyed) {
      return Promise.reject(new Error("BDS command input is closed."));
    }
    return new Promise((resolve, reject) => {
      handle.child.stdin.write(`${command}\n`, (error) => {
        if (error === null || error === undefined) resolve();
        else reject(error);
      });
    });
  }
}

function isComputerListEntry(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    /^c-[0-9a-hjkmnp-tv-z]{6}$/u.test(value.computerId) &&
    (value.family === "standard" || value.family === "advanced") &&
    value.form === "block" &&
    typeof value.physicalKey === "string" &&
    value.physicalKey.length > 0 &&
    value.physicalKey.length <= 256
  );
}

function readNbtName(buffer, offset) {
  ensureNbtBytes(buffer, offset, 2);
  const byteLength = buffer.readUInt16LE(offset);
  const valueOffset = offset + 2;
  ensureNbtBytes(buffer, valueOffset, byteLength);
  return {
    endOffset: valueOffset + byteLength,
    value: buffer.toString("utf8", valueOffset, valueOffset + byteLength),
  };
}

function scanNbtCompound(buffer, startOffset, depth) {
  ensureNbtDepth(depth);
  const entries = [];
  let offset = startOffset;
  while (true) {
    ensureNbtBytes(buffer, offset, 1);
    const type = buffer[offset];
    if (type === nbtTag.end) {
      return {
        endOffset: offset + 1,
        endTagOffset: offset,
        entries,
      };
    }
    ensureKnownNbtTag(type);
    const name = readNbtName(buffer, offset + 1);
    const payloadOffset = name.endOffset;
    const endOffset = skipNbtPayload(buffer, type, payloadOffset, depth);
    entries.push({
      endOffset,
      name: name.value,
      payloadOffset,
      type,
    });
    offset = endOffset;
  }
}

function skipNbtPayload(buffer, type, offset, depth) {
  switch (type) {
    case nbtTag.byte:
      return checkedNbtEnd(buffer, offset, 1);
    case nbtTag.short:
      return checkedNbtEnd(buffer, offset, 2);
    case nbtTag.int:
    case nbtTag.float:
      return checkedNbtEnd(buffer, offset, 4);
    case nbtTag.long:
    case nbtTag.double:
      return checkedNbtEnd(buffer, offset, 8);
    case nbtTag.byteArray:
      return skipNbtArray(buffer, offset, 1);
    case nbtTag.string: {
      const name = readNbtName(buffer, offset);
      return name.endOffset;
    }
    case nbtTag.list:
      return skipNbtList(buffer, offset, depth);
    case nbtTag.compound:
      return scanNbtCompound(buffer, offset, depth + 1).endOffset;
    case nbtTag.intArray:
      return skipNbtArray(buffer, offset, 4);
    case nbtTag.longArray:
      return skipNbtArray(buffer, offset, 8);
    default:
      throw new Error(`Unsupported NBT tag type: ${String(type)}.`);
  }
}

function skipNbtArray(buffer, offset, elementBytes) {
  ensureNbtBytes(buffer, offset, 4);
  const count = buffer.readInt32LE(offset);
  if (count < 0) {
    throw new Error(
      "Disposable acceptance level.dat has a negative NBT array.",
    );
  }
  const remainingBytes = buffer.byteLength - (offset + 4);
  if (count > Math.floor(remainingBytes / elementBytes)) {
    throw new Error(
      "Disposable acceptance level.dat has an oversized NBT array.",
    );
  }
  return checkedNbtEnd(buffer, offset + 4, count * elementBytes);
}

function skipNbtList(buffer, offset, depth) {
  ensureNbtDepth(depth + 1);
  ensureNbtBytes(buffer, offset, 5);
  const elementType = buffer[offset];
  const count = buffer.readInt32LE(offset + 1);
  if (count < 0) {
    throw new Error("Disposable acceptance level.dat has a negative NBT list.");
  }
  if (elementType === nbtTag.end && count !== 0) {
    throw new Error(
      "Disposable acceptance level.dat has a non-empty end-tag list.",
    );
  }
  if (elementType !== nbtTag.end) ensureKnownNbtTag(elementType);
  const remainingBytes = buffer.byteLength - (offset + 5);
  if (count > remainingBytes) {
    throw new Error(
      "Disposable acceptance level.dat has an oversized NBT list.",
    );
  }
  let itemOffset = offset + 5;
  for (let index = 0; index < count; index += 1) {
    itemOffset = skipNbtPayload(buffer, elementType, itemOffset, depth + 1);
  }
  return itemOffset;
}

function ensureKnownNbtTag(type) {
  if (
    !Number.isInteger(type) ||
    type < nbtTag.byte ||
    type > nbtTag.longArray
  ) {
    throw new Error(`Unsupported NBT tag type: ${String(type)}.`);
  }
}

function ensureNbtDepth(depth) {
  if (!Number.isSafeInteger(depth) || depth < 0 || depth > maximumNbtDepth) {
    throw new Error(
      "Disposable acceptance level.dat exceeds the NBT depth limit.",
    );
  }
}

function ensureNbtBytes(buffer, offset, byteLength) {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(byteLength) ||
    offset < 0 ||
    byteLength < 0 ||
    offset > buffer.byteLength ||
    byteLength > buffer.byteLength - offset
  ) {
    throw new Error("Disposable acceptance level.dat is truncated.");
  }
}

function checkedNbtEnd(buffer, offset, byteLength) {
  ensureNbtBytes(buffer, offset, byteLength);
  return offset + byteLength;
}

function encodeNbtByteTag(name, value) {
  const encodedName = Buffer.from(name, "utf8");
  if (encodedName.byteLength > 0xffff) {
    throw new Error("Disposable acceptance NBT tag name is too long.");
  }
  const result = Buffer.allocUnsafe(encodedName.byteLength + 4);
  result[0] = nbtTag.byte;
  result.writeUInt16LE(encodedName.byteLength, 1);
  encodedName.copy(result, 3);
  result[result.byteLength - 1] = value;
  return result;
}

function validatePatchedBetaApisLevelDat(source) {
  if (
    source.readUInt32LE(0) !== supportedLevelDatVersion ||
    source.readUInt32LE(4) !== source.byteLength - 8
  ) {
    throw new Error("Patched disposable acceptance level.dat is invalid.");
  }
  const payload = source.subarray(8);
  if (payload[0] !== nbtTag.compound) {
    throw new Error("Patched disposable acceptance level.dat root is invalid.");
  }
  const rootName = readNbtName(payload, 1);
  const root = scanNbtCompound(payload, rootName.endOffset, 0);
  if (root.endOffset !== payload.byteLength) {
    throw new Error(
      "Patched disposable acceptance level.dat contains trailing NBT data.",
    );
  }
  const experimentCompounds = root.entries.filter(
    (entry) => entry.name === "experiments" && entry.type === nbtTag.compound,
  );
  if (experimentCompounds.length !== 1) {
    throw new Error(
      "Patched disposable acceptance level.dat must contain one experiments compound.",
    );
  }
  const experiments = scanNbtCompound(
    payload,
    experimentCompounds[0].payloadOffset,
    1,
  );
  for (const name of [
    "gametest",
    "experiments_ever_used",
    "saved_with_toggled_experiments",
  ]) {
    const matches = experiments.entries.filter(
      (entry) => entry.name === name && entry.type === nbtTag.byte,
    );
    if (matches.length !== 1 || payload[matches[0].payloadOffset] !== 1) {
      throw new Error(
        `Patched disposable acceptance level.dat has an invalid ${name} experiment flag.`,
      );
    }
  }
}

function isWithin(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function asNonNegativeInteger(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Value must be a non-negative integer.");
  }
  return value;
}

function asPositiveInteger(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error("Value must be a positive integer.");
  }
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function withTimeout(promise, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${String(timeoutMs)} ms.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
