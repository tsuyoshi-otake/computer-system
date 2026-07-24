import { randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { BdsDebugSession } from "./bds-debug-session.mjs";
import {
  CS486_COMPUTE_PATH,
  createCs486ComputeServer,
} from "./cs486-compute-server.mjs";
import { createCs486ComputeWorkerPool } from "./cs486-compute-worker-pool.mjs";
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

export class BdsWebCompanionLifecycle {
  #adminConfigPath;
  #adminOptions;
  #bds;
  #cleanupPromise;
  #compute;
  #createBds;
  #createComputeServer;
  #createPool;
  #createWeb;
  #environment;
  #lastError = null;
  #loadAdminConfig;
  #persistedAdminConfig;
  #pool;
  #randomToken;
  #startPromise;
  #state = "idle";
  #stopLogForwarding;
  #stopRequested = false;
  #web;

  constructor(options = {}) {
    this.#environment = options.environment ?? process.env;
    this.#adminConfigPath =
      options.adminConfigPath ??
      defaultWebCompanionConfigPath({ environment: this.#environment });
    this.#loadAdminConfig =
      options.loadAdminConfig ?? loadWebCompanionAdminConfig;
    this.#createPool =
      options.createPool ??
      ((poolOptions) => createCs486ComputeWorkerPool(poolOptions));
    this.#createComputeServer =
      options.createComputeServer ??
      ((serverOptions) => createCs486ComputeServer(serverOptions));
    this.#createBds =
      options.createBds ?? ((bdsOptions) => new BdsDebugSession(bdsOptions));
    this.#createWeb =
      options.createWeb ?? ((webOptions) => new WebCompanionServer(webOptions));
    this.#randomToken =
      options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  }

  async start() {
    if (this.#state === "running") return this.status();
    if (this.#startPromise !== undefined) return this.#startPromise;
    if (this.#state !== "idle") {
      throw new Error(
        `Cannot start BDS Web companion from state ${this.#state}.`,
      );
    }
    this.#state = "starting";
    this.#lastError = null;
    const startPromise = this.#performStart();
    this.#startPromise = startPromise;
    try {
      return await startPromise;
    } catch (error) {
      this.#lastError = message(error);
      this.#state = "failed";
      try {
        await this.#cleanup();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "BDS Web companion startup and cleanup failed.",
        );
      }
      throw error;
    } finally {
      if (this.#startPromise === startPromise) this.#startPromise = undefined;
    }
  }

  async stop() {
    this.#stopRequested = true;
    if (this.#startPromise !== undefined) {
      await this.#startPromise.catch(() => undefined);
    }
    await this.#cleanup();
    if (this.#state !== "failed") this.#state = "idle";
    return this.status();
  }

  status() {
    return {
      state: this.#state,
      running: this.#state === "running",
      minecraft: this.#bds?.getStatus?.() ?? null,
      web: this.#web?.status?.() ?? null,
      compute: this.#compute?.status?.() ?? null,
      runtimeWorkerCount: this.#adminOptions?.runtimeWorkerCount ?? null,
      webConfiguration:
        this.#adminOptions === undefined
          ? null
          : {
              path: this.#adminConfigPath ?? null,
              persisted: this.#persistedAdminConfig,
              environmentOverrides: {
                port: this.#environment.WEB_COMPANION_PORT !== undefined,
                publicOrigin:
                  this.#environment.WEB_COMPANION_PUBLIC_ORIGIN !== undefined,
                runtimeWorkerCount:
                  this.#environment.WEB_COMPANION_RUNTIME_WORKERS !== undefined,
              },
            },
      lastError: this.#lastError,
    };
  }

  async #performStart() {
    this.#persistedAdminConfig = await this.#loadAdminConfig(
      this.#adminConfigPath,
    );
    this.#adminOptions = resolveWebCompanionAdminOptions(
      this.#environment,
      this.#persistedAdminConfig,
    );
    this.#assertStillStarting();

    const token = this.#randomToken();
    if (
      typeof token !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/u.test(token) ||
      Buffer.from(token, "base64url").byteLength !== 32 ||
      Buffer.from(token, "base64url").toString("base64url") !== token
    ) {
      throw new Error(
        "Runtime worker token generator did not return 256 bits.",
      );
    }
    this.#pool = await this.#createPool({
      workerCount: this.#adminOptions.runtimeWorkerCount,
    });
    this.#assertStillStarting();

    this.#compute = this.#createComputeServer({
      pool: this.#pool,
      port: 0,
      token,
    });
    const computeStatus = await this.#compute.start();
    this.#assertStillStarting();
    if (
      computeStatus?.running !== true ||
      computeStatus.address !== "127.0.0.1" ||
      !Number.isSafeInteger(computeStatus.port) ||
      computeStatus.port < 1 ||
      computeStatus.port > 65_535 ||
      computeStatus.path !== CS486_COMPUTE_PATH
    ) {
      throw new Error("CS486 compute listener returned an invalid status.");
    }
    const endpoint = `ws://${computeStatus.address}:${String(computeStatus.port)}${computeStatus.path}`;

    this.#bds = this.#createBds({
      environment: this.#environment,
      runtimeWorkers: {
        count: this.#adminOptions.runtimeWorkerCount,
        endpoint,
        token,
      },
    });
    this.#stopLogForwarding = this.#bds.onLog((entry) => {
      if (
        entry.line.includes("CS_STORAGE_MIGRATION") ||
        entry.line.includes("Computer System storage migration")
      ) {
        process.stdout.write(`${entry.line}\n`);
      }
    });
    this.#web = this.#createWeb({
      bds: this.#bds,
      host: this.#environment.WEB_COMPANION_HOST ?? "0.0.0.0",
      port: this.#adminOptions.port,
      publicHost: this.#environment.WEB_COMPANION_PUBLIC_HOST,
      publicOrigin: this.#adminOptions.publicOrigin,
      allowedOrigins: this.#environment.WEB_COMPANION_ALLOWED_ORIGINS,
      autoOpenBrowser: parseOptionalBooleanFlag(
        this.#environment.WEB_COMPANION_AUTO_OPEN ?? "1",
        "WEB_COMPANION_AUTO_OPEN",
      ),
      debugIgnoreRange: parseBooleanFlag(
        this.#environment.WEB_COMPANION_DEBUG_IGNORE_RANGE,
        "WEB_COMPANION_DEBUG_IGNORE_RANGE",
      ),
    });
    await this.#web.start();
    this.#assertStillStarting();
    await this.#bds.start({ resetWorld: false });
    this.#assertStillStarting();
    this.#state = "running";
    return this.status();
  }

  #assertStillStarting() {
    if (this.#stopRequested) {
      throw new Error("BDS Web companion startup was cancelled.");
    }
  }

  #cleanup() {
    if (this.#cleanupPromise !== undefined) return this.#cleanupPromise;
    const cleanupPromise = this.#performCleanup();
    this.#cleanupPromise = cleanupPromise;
    return cleanupPromise;
  }

  async #performCleanup() {
    const errors = [];
    for (const [resource, method] of [
      [this.#bds, "stop"],
      [this.#web, "stop"],
      [this.#compute, "stop"],
      [this.#pool, "close"],
    ]) {
      if (resource === undefined || typeof resource[method] !== "function") {
        continue;
      }
      try {
        await resource[method]();
      } catch (error) {
        errors.push(error);
      }
    }
    if (this.#stopLogForwarding !== undefined) {
      try {
        this.#stopLogForwarding();
      } catch (error) {
        errors.push(error);
      }
      this.#stopLogForwarding = undefined;
    }
    this.#bds = undefined;
    this.#web = undefined;
    this.#compute = undefined;
    this.#pool = undefined;
    if (errors.length > 0) {
      this.#lastError = "BDS Web companion shutdown failed.";
      this.#state = "failed";
      throw new AggregateError(errors, this.#lastError);
    }
  }
}

export async function runBdsWebCompanion() {
  const lifecycle = new BdsWebCompanionLifecycle();
  let requestedExitCode = 0;
  let exitPromise;
  const shutdown = (exitCode) => {
    requestedExitCode = Math.max(requestedExitCode, exitCode);
    if (exitPromise !== undefined) return exitPromise;
    exitPromise = lifecycle
      .stop()
      .catch((error) => {
        requestedExitCode = 1;
        process.stderr.write(
          `BDS Web companion shutdown failed: ${message(error)}\n`,
        );
      })
      .finally(() => {
        process.exit(requestedExitCode);
      });
    return exitPromise;
  };

  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));

  try {
    const status = await lifecycle.start();
    process.stdout.write(
      `${JSON.stringify({ state: "running", ...status })}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `Unable to start BDS Web companion: ${message(error)}\n`,
    );
    await shutdown(1);
  }
}

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

function isEntrypoint() {
  const entry = process.argv[1];
  return (
    typeof entry === "string" &&
    import.meta.url === pathToFileURL(path.resolve(entry)).href
  );
}

if (isEntrypoint()) {
  await runBdsWebCompanion();
}
