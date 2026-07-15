import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
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
const allowedPlayerProbes = new Set([
  "compete",
  "computer",
  "help",
  "monitor",
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

export function isDiagnosticLine(line) {
  if (line.includes(workMonitorLogPrefix)) return false;
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
    /^scriptevent computer_system:web-(?:interrupt|close|take-control) [A-Za-z0-9_-]{12,32}$/u.test(
      command,
    ) ||
    /^scriptevent computer_system:web-input [A-Za-z0-9_-]{12,32} (?:line|keys) [^\s]{0,180}$/u.test(
      command,
    ) ||
    /^scriptevent computer_system:web-complete [A-Za-z0-9_-]{12,32} [A-Za-z0-9_-]{6,20} [0-9]{1,3} v[^\s]{0,128}$/u.test(
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
      logCursor: this.logCursor,
      diagnostics: this.logLines.filter((entry) => entry.diagnostic).length,
      lastError: this.lastError ?? null,
      workMonitor: this.workMonitor ?? null,
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

  async #start({ resetWorld = false } = {}) {
    if (typeof resetWorld !== "boolean") {
      throw new Error("resetWorld must be a boolean.");
    }
    if (this.state === "running") return this.getStatus();
    this.#setState("starting");
    this.lastError = undefined;

    try {
      await this.#validateRoots();
      await this.#runBuild();
      const runtimeCreated = await this.#prepareRuntime(resetWorld);
      await this.#configureServer();

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
      this.#setState("running");
      return this.getStatus();
    } catch (error) {
      this.lastError = errorMessage(error);
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
    if (this.state === "idle") return this.getStatus();
    const handle = this.handle;
    if (handle === undefined) {
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
      this.#setState("idle");
      return this.getStatus();
    } catch (error) {
      this.handle = undefined;
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

  async #runBuild() {
    const handle = this.#spawnChild(
      process.execPath,
      [path.join(this.projectRoot, "tools", "build.mjs")],
      this.projectRoot,
      "build",
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
        path.join(this.projectRoot, "dist", "behavior_pack", "manifest.json"),
        "utf8",
      ),
    );
    const resourceManifest = JSON.parse(
      await readFile(
        path.join(this.projectRoot, "dist", "resource_pack", "manifest.json"),
        "utf8",
      ),
    );
    const packs = [
      {
        kind: "behavior",
        manifest: behaviorManifest,
        source: path.join(this.projectRoot, "dist", "behavior_pack"),
      },
      {
        kind: "resource",
        manifest: resourceManifest,
        source: path.join(this.projectRoot, "dist", "resource_pack"),
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
