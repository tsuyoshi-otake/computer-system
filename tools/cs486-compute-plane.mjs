import { randomBytes } from "node:crypto";

import {
  CS486_COMPUTE_ADDRESS,
  CS486_COMPUTE_PATH,
  createCs486ComputeServer,
} from "./cs486-compute-server.mjs";
import { createCs486ComputeWorkerPool } from "./cs486-compute-worker-pool.mjs";

/**
 * The CS486 compute plane a managed Bedrock session talks to: one fixed worker
 * pool plus the authenticated loopback listener in front of it.
 *
 * Both managed entry points start it the same way - `dev:bds:web` through
 * `BdsWebCompanionLifecycle`, MCP debugging through `bds-mcp-server.mjs` - so
 * the fail-loud engine rule, the 256-bit bearer token, and the exact
 * `ws://127.0.0.1:PORT/internal/cs486/v1` endpoint have exactly one owner.
 *
 * A failure after the pool exists closes what was already admitted before it
 * rethrows, so no caller ever has to finalize a half-started plane.
 */
export async function startCs486ComputePlane(options = {}) {
  const cpuEngine = options.cpuEngine;
  const workerCount = options.workerCount;
  const createPool =
    options.createPool ??
    ((poolOptions) => createCs486ComputeWorkerPool(poolOptions));
  const createComputeServer =
    options.createComputeServer ??
    ((serverOptions) => createCs486ComputeServer(serverOptions));
  const randomToken =
    options.randomToken ?? (() => randomBytes(32).toString("base64url"));
  const assertActive = options.assertActive ?? (() => undefined);

  const token = randomToken();
  if (!isRuntimeWorkerToken(token)) {
    throw new Error("Runtime worker token generator did not return 256 bits.");
  }

  // Pool creation is the fail-loud point for the selected engine: an engine
  // this build cannot run rejects here, which fails managed startup. No entry
  // point ever substitutes another engine behind the operator's back, because
  // the guest results would then come from an engine nobody selected.
  const pool = await createPool({ cpuEngine, workerCount });
  let compute;
  try {
    assertActive();
    compute = createComputeServer({ pool, port: 0, token });
    const computeStatus = await compute.start();
    assertActive();
    if (!isValidComputeStatus(computeStatus)) {
      throw new Error("CS486 compute listener returned an invalid status.");
    }
    return new Cs486ComputePlane({
      compute,
      count: workerCount,
      endpoint: `ws://${computeStatus.address}:${String(computeStatus.port)}${computeStatus.path}`,
      pool,
      token,
    });
  } catch (error) {
    try {
      await closePlaneResources(compute, pool);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "CS486 compute plane startup and cleanup failed.",
      );
    }
    throw error;
  }
}

class Cs486ComputePlane {
  #compute;
  #count;
  #endpoint;
  #pool;
  #stopPromise;
  #token;

  constructor(options) {
    this.#compute = options.compute;
    this.#count = options.count;
    this.#endpoint = options.endpoint;
    this.#pool = options.pool;
    this.#token = options.token;
  }

  get count() {
    return this.#count;
  }

  get endpoint() {
    return this.#endpoint;
  }

  /** The managed bearer secret. Never place it in status, logs, or errors. */
  get token() {
    return this.#token;
  }

  status() {
    return this.#compute?.status?.() ?? null;
  }

  /** Finalizes the listener and every worker thread exactly once. */
  stop() {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    const compute = this.#compute;
    const pool = this.#pool;
    this.#compute = undefined;
    this.#pool = undefined;
    this.#stopPromise = closePlaneResources(compute, pool);
    return this.#stopPromise;
  }
}

async function closePlaneResources(compute, pool) {
  const errors = [];
  for (const [resource, method] of [
    [compute, "stop"],
    [pool, "close"],
  ]) {
    if (
      resource === undefined ||
      resource === null ||
      typeof resource[method] !== "function"
    ) {
      continue;
    }
    try {
      await resource[method]();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, "CS486 compute plane shutdown failed.");
  }
}

function isRuntimeWorkerToken(token) {
  return (
    typeof token === "string" &&
    /^[A-Za-z0-9_-]{43}$/u.test(token) &&
    Buffer.from(token, "base64url").byteLength === 32 &&
    Buffer.from(token, "base64url").toString("base64url") === token
  );
}

function isValidComputeStatus(computeStatus) {
  return (
    computeStatus?.running === true &&
    computeStatus.address === CS486_COMPUTE_ADDRESS &&
    Number.isSafeInteger(computeStatus.port) &&
    computeStatus.port >= 1 &&
    computeStatus.port <= 65_535 &&
    computeStatus.path === CS486_COMPUTE_PATH
  );
}
