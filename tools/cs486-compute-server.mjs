import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

import WebSocket, { WebSocketServer } from "ws";

import { cs486ComputeWorkerPoolLimits } from "./cs486-compute-worker-pool.mjs";

export const CS486_COMPUTE_ADDRESS = "127.0.0.1";
export const CS486_COMPUTE_PATH = "/internal/cs486/v1";
export const CS486_COMPUTE_PROTOCOL_VERSION = 1;

const maximumPayloadBytes = 1024 * 1024;
const maximumPendingRequests = 256;
const maximumRequestIdCharacters = 128;
const maximumRequestIdBytes = 256;
const maximumActorIdentifierCharacters = 64;
const maximumErrorMessageCharacters = 500;
const maximumRecentRequestIds = 256;
const maximumCleanupDrainSlices = 4;
const maximumConcurrentActorCleanups = 8;
const maximumTrackedActors =
  cs486ComputeWorkerPoolLimits.maximumWorkerCount *
  cs486ComputeWorkerPoolLimits.maximumProcessesPerWorker;
const stopGraceMs = 50;
const terminalProcessStates = new Set(["completed", "crashed", "terminated"]);
const supportedCommands = new Set([
  "create",
  "slice",
  "dispose",
  "terminate",
  "fail",
]);

export class Cs486ComputeServer {
  #authorizationDigest;
  #cleanupCompleted = 0;
  #cleanupFailed = 0;
  #connectionCleanups = new Set();
  #connections = new Map();
  #httpServer;
  #lastError = null;
  #pool;
  #poolRequest;
  #port;
  #nextCleanupRequestId = 1;
  #startPromise;
  #state = "idle";
  #stopPromise;
  #upgradeReserved = false;
  #webSocketServer;

  constructor(options = {}) {
    if (!isObject(options)) {
      throw new TypeError("Compute server options must be an object.");
    }
    if (options.host !== undefined && options.host !== CS486_COMPUTE_ADDRESS) {
      throw new RangeError(
        `Compute server address is fixed to ${CS486_COMPUTE_ADDRESS}.`,
      );
    }
    if (options.path !== undefined && options.path !== CS486_COMPUTE_PATH) {
      throw new RangeError(
        `Compute server path is fixed to ${CS486_COMPUTE_PATH}.`,
      );
    }
    this.#pool = validatePool(options.pool);
    this.#poolRequest = createPoolRequester(this.#pool);
    this.#authorizationDigest = digestToken(
      normalizeAuthorizationToken(options.token),
    );
    this.#port = validatePort(options.port ?? 0);
  }

  async start() {
    if (this.#state === "running") return this.status();
    if (this.#startPromise !== undefined) return this.#startPromise;
    if (this.#stopPromise !== undefined) await this.#stopPromise;

    const startPromise = this.#performStart();
    this.#startPromise = startPromise;
    try {
      return await startPromise;
    } finally {
      if (this.#startPromise === startPromise) {
        this.#startPromise = undefined;
      }
    }
  }

  async stop() {
    if (
      this.#state === "idle" &&
      this.#startPromise === undefined &&
      this.#stopPromise === undefined
    ) {
      return this.status();
    }
    if (this.#stopPromise !== undefined) return this.#stopPromise;

    const stopPromise = this.#performStop();
    this.#stopPromise = stopPromise;
    try {
      return await stopPromise;
    } finally {
      if (this.#stopPromise === stopPromise) {
        this.#stopPromise = undefined;
      }
    }
  }

  status() {
    const address = this.#httpServer?.address();
    return {
      state: this.#state,
      running: this.#state === "running",
      address: CS486_COMPUTE_ADDRESS,
      port:
        typeof address === "object" && address !== null
          ? address.port
          : this.#port,
      path: CS486_COMPUTE_PATH,
      connections: this.#connections.size,
      cleanup: {
        active: this.#connectionCleanups.size,
        completed: this.#cleanupCompleted,
        failed: this.#cleanupFailed,
      },
      pool: readPoolStatus(this.#pool),
      lastError: this.#lastError,
    };
  }

  async #performStart() {
    this.#state = "starting";
    this.#lastError = null;
    const webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: maximumPayloadBytes,
      perMessageDeflate: false,
      clientTracking: false,
    });
    const httpServer = createServer((_request, response) => {
      response.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Length": "0",
      });
      response.end();
    });
    this.#webSocketServer = webSocketServer;
    this.#httpServer = httpServer;

    webSocketServer.on("error", () => {
      this.#recordServerError("websocket_server_error");
      this.#closeConnections(1011, "Compute transport failed.");
    });
    httpServer.on("clientError", (_error, socket) => {
      rejectUpgrade(socket, 400, "Bad Request");
    });
    httpServer.on("upgrade", (request, socket, head) => {
      this.#handleUpgrade(request, socket, head);
    });

    try {
      await listen(httpServer, this.#port);
    } catch (error) {
      this.#state = "idle";
      this.#httpServer = undefined;
      this.#webSocketServer = undefined;
      await closeWebSocketServer(webSocketServer);
      await closeHttpServer(httpServer);
      throw new Error("CS486 compute server failed to start.", {
        cause: error,
      });
    }

    httpServer.on("error", () => {
      this.#recordServerError("http_server_error");
      this.#closeConnections(1011, "Compute transport failed.");
    });
    this.#state = "running";
    return this.status();
  }

  async #performStop() {
    if (this.#startPromise !== undefined) {
      try {
        await this.#startPromise;
      } catch {
        this.#state = "idle";
        return this.status();
      }
    }
    if (this.#state === "idle") return this.status();

    this.#state = "stopping";
    this.#upgradeReserved = false;
    const webSocketServer = this.#webSocketServer;
    const httpServer = this.#httpServer;

    for (const context of this.#connections.values()) {
      context.closed = true;
      this.#beginConnectionCleanup(context, "compute_server_stopped");
    }
    await closeTrackedConnections(this.#connections);
    await this.#awaitConnectionCleanups();
    if (webSocketServer !== undefined) {
      await closeWebSocketServer(webSocketServer);
    }
    if (httpServer !== undefined) {
      await closeHttpServer(httpServer);
    }

    this.#connections.clear();
    this.#webSocketServer = undefined;
    this.#httpServer = undefined;
    this.#state = "idle";
    return this.status();
  }

  #handleUpgrade(request, socket, head) {
    if (this.#state !== "running") {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }
    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (request.url !== CS486_COMPUTE_PATH) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    if (hasBrowserHeaders(request.headers)) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (!this.#authenticate(request.headers.authorization)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    if (this.#upgradeReserved || this.#connections.size >= 1) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    const webSocketServer = this.#webSocketServer;
    if (webSocketServer === undefined) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    this.#upgradeReserved = true;
    try {
      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.#upgradeReserved = false;
        if (this.#state !== "running" || this.#connections.size >= 1) {
          webSocket.close(1013, "Compute connection unavailable.");
          return;
        }
        this.#registerConnection(webSocket);
      });
    } catch {
      this.#upgradeReserved = false;
      this.#recordServerError("upgrade_handler_error");
      rejectUpgrade(socket, 400, "Bad Request");
    }
  }

  #authenticate(authorization) {
    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    ) {
      return false;
    }
    const presentedToken = authorization.slice("Bearer ".length);
    if (
      presentedToken.length === 0 ||
      presentedToken.length > 256 ||
      /\s/u.test(presentedToken)
    ) {
      return false;
    }
    const presentedDigest = digestToken(presentedToken);
    return timingSafeEqual(this.#authorizationDigest, presentedDigest);
  }

  #registerConnection(webSocket) {
    const context = {
      actors: new Map(),
      cleanupPromise: undefined,
      closed: false,
      handlers: new Set(),
      nextActorSequence: 1,
      pending: 0,
      pendingRequestIds: new Set(),
      recentRequestIds: new Set(),
      recentRequestIdQueue: [],
    };
    this.#connections.set(webSocket, context);

    webSocket.on("message", (data, isBinary) => {
      const handler = this.#handleMessage(webSocket, context, data, isBinary);
      context.handlers.add(handler);
      void handler
        .catch(() => {
          this.#sendError(
            webSocket,
            null,
            "handler_error",
            "Compute request handler failed.",
          );
        })
        .finally(() => {
          context.handlers.delete(handler);
        });
    });
    webSocket.on("error", () => {
      // Peer framing and payload errors are finalized by ws through "close".
    });
    webSocket.once("close", () => {
      this.#connections.delete(webSocket);
      context.closed = true;
      this.#beginConnectionCleanup(
        context,
        this.#state === "stopping"
          ? "compute_server_stopped"
          : "compute_connection_closed",
      );
    });
  }

  async #handleMessage(webSocket, context, data, isBinary) {
    if (isBinary) {
      this.#sendError(
        webSocket,
        null,
        "invalid_request",
        "Compute requests must be JSON text.",
      );
      return;
    }

    let value;
    try {
      value = JSON.parse(rawDataToText(data));
    } catch {
      this.#sendError(
        webSocket,
        null,
        "invalid_json",
        "Compute request is not valid JSON.",
      );
      return;
    }

    const validation = validateRequest(value);
    if (!validation.ok) {
      this.#sendError(
        webSocket,
        validation.requestId,
        validation.code,
        validation.message,
      );
      return;
    }
    const requestIdKey = serializeRequestId(validation.requestId);
    if (
      context.pendingRequestIds.has(requestIdKey) ||
      context.recentRequestIds.has(requestIdKey)
    ) {
      this.#sendError(
        webSocket,
        validation.requestId,
        "duplicate_request",
        "Compute requestId was already admitted on this connection.",
      );
      return;
    }
    if (context.pending >= maximumPendingRequests) {
      this.#sendError(
        webSocket,
        validation.requestId,
        "capacity_exceeded",
        "Compute connection has too many pending requests.",
      );
      return;
    }
    if (this.#state !== "running") {
      this.#sendError(
        webSocket,
        validation.requestId,
        "server_stopping",
        "Compute server is stopping.",
      );
      return;
    }

    const poolCommand = toPoolCommand(validation.requestId, validation.command);
    const actorOperation = beginActorOperation(context, poolCommand);
    if (actorOperation.rejected) {
      this.#sendError(
        webSocket,
        validation.requestId,
        "actor_capacity_exceeded",
        "Compute connection owns too many process actors.",
      );
      return;
    }

    context.pending += 1;
    context.pendingRequestIds.add(requestIdKey);
    try {
      let result;
      try {
        result = await this.#poolRequest(poolCommand);
        completeActorOperation(actorOperation);
      } catch (error) {
        failActorOperation(actorOperation, error);
        this.#sendError(
          webSocket,
          validation.requestId,
          "pool_error",
          "Compute pool request failed.",
        );
        return;
      }
      this.#sendSuccess(webSocket, validation.requestId, result);
    } finally {
      context.pending -= 1;
      context.pendingRequestIds.delete(requestIdKey);
      rememberRequestId(context, requestIdKey);
      finishActorOperation(context, actorOperation);
    }
  }

  #beginConnectionCleanup(context, reason) {
    if (context.cleanupPromise !== undefined) return context.cleanupPromise;
    const cleanupPromise = this.#cleanupConnection(context, reason).catch(
      () => {
        this.#cleanupFailed += 1;
        this.#recordServerError("connection_cleanup_error");
      },
    );
    context.cleanupPromise = cleanupPromise;
    this.#connectionCleanups.add(cleanupPromise);
    void cleanupPromise.then(() => {
      this.#connectionCleanups.delete(cleanupPromise);
    });
    return cleanupPromise;
  }

  async #cleanupConnection(context, reason) {
    while (context.handlers.size > 0) {
      const handlers = [...context.handlers];
      await Promise.allSettled(handlers);
      for (const handler of handlers) context.handlers.delete(handler);
    }

    const actors = [...context.actors.values()].filter(actorIsOwned);
    await runBounded(actors, maximumConcurrentActorCleanups, async (actor) => {
      try {
        await this.#cleanupActor(actor, reason);
      } catch {
        actor.cleanupState = "cleanup_failed";
        this.#cleanupFailed += 1;
        this.#recordServerError("actor_cleanup_failed");
      }
    });
    context.actors.clear();
  }

  async #cleanupActor(actor, reason) {
    actor.cleanupState = "terminating";
    let pendingCycles = false;
    let mayDrainWithoutReplay = false;
    try {
      const response = await this.#requestActorCleanup(actor, "terminate", {
        reason,
      });
      pendingCycles = responseHasPendingCycles(response);
      mayDrainWithoutReplay = responseHasTerminalState(response);
    } catch (error) {
      if (isProcessNotFound(error)) {
        this.#finalizeActorCleanup(actor, "not_found");
        return;
      }
    }

    if (pendingCycles && mayDrainWithoutReplay) {
      actor.cleanupState = "draining";
      for (
        let attempt = 0;
        attempt < maximumCleanupDrainSlices && pendingCycles;
        attempt += 1
      ) {
        try {
          const response = await this.#requestActorCleanup(actor, "slice", {
            cpuCycleBudget:
              cs486ComputeWorkerPoolLimits.maximumCpuCyclesPerSlice,
            instructionBudget:
              cs486ComputeWorkerPoolLimits.maximumInstructionsPerSlice,
            tick: actor.latestTick,
          });
          if (responseExecutedInstructions(response) > 0) {
            this.#recordServerError("actor_cleanup_replay_detected");
            break;
          }
          if (!responseHasTerminalState(response)) break;
          pendingCycles = responseHasPendingCycles(response);
        } catch (error) {
          if (isProcessNotFound(error)) {
            this.#finalizeActorCleanup(actor, "not_found");
            return;
          }
          break;
        }
      }
    }

    actor.cleanupState = "disposing";
    try {
      await this.#requestActorCleanup(actor, "dispose");
      this.#finalizeActorCleanup(actor, "disposed");
    } catch (error) {
      if (isProcessNotFound(error)) {
        this.#finalizeActorCleanup(actor, "not_found");
        return;
      }
      actor.cleanupState = "cleanup_failed";
      this.#cleanupFailed += 1;
      this.#recordServerError("actor_cleanup_failed");
    }
  }

  #requestActorCleanup(actor, command, fields = {}) {
    return this.#poolRequest({
      ...fields,
      command,
      computerId: actor.computerId,
      processId: actor.processId,
      protocolVersion: CS486_COMPUTE_PROTOCOL_VERSION,
      requestId: this.#allocateCleanupRequestId(),
    });
  }

  #allocateCleanupRequestId() {
    const requestId = `cleanup-${String(this.#nextCleanupRequestId).padStart(
      12,
      "0",
    )}`;
    this.#nextCleanupRequestId =
      this.#nextCleanupRequestId >= Number.MAX_SAFE_INTEGER
        ? 1
        : this.#nextCleanupRequestId + 1;
    return requestId;
  }

  #finalizeActorCleanup(actor, state) {
    actor.cleanupState = state;
    this.#cleanupCompleted += 1;
  }

  async #awaitConnectionCleanups() {
    while (this.#connectionCleanups.size > 0) {
      const cleanups = [...this.#connectionCleanups];
      await Promise.allSettled(cleanups);
      for (const cleanup of cleanups) {
        this.#connectionCleanups.delete(cleanup);
      }
    }
  }

  #sendSuccess(webSocket, requestId, result) {
    const response = {
      protocolVersion: CS486_COMPUTE_PROTOCOL_VERSION,
      requestId,
      ok: true,
      result: result ?? null,
    };
    let serialized;
    try {
      serialized = JSON.stringify(response);
    } catch {
      this.#sendError(
        webSocket,
        requestId,
        "invalid_pool_result",
        "Compute pool returned an invalid result.",
      );
      return;
    }
    if (Buffer.byteLength(serialized) > maximumPayloadBytes) {
      this.#sendError(
        webSocket,
        requestId,
        "result_too_large",
        "Compute pool result exceeds the transport limit.",
      );
      return;
    }
    this.#sendSerialized(webSocket, serialized);
  }

  #sendError(webSocket, requestId, code, message) {
    const boundedMessage = String(message).slice(
      0,
      maximumErrorMessageCharacters,
    );
    this.#sendSerialized(
      webSocket,
      JSON.stringify({
        protocolVersion: CS486_COMPUTE_PROTOCOL_VERSION,
        requestId,
        ok: false,
        error: {
          code,
          message: boundedMessage,
        },
      }),
    );
  }

  #sendSerialized(webSocket, serialized) {
    if (webSocket.readyState !== WebSocket.OPEN) return;
    try {
      webSocket.send(serialized, (error) => {
        if (error !== undefined && error !== null) {
          this.#recordServerError("response_send_error");
        }
      });
    } catch {
      this.#recordServerError("response_send_error");
      webSocket.terminate();
    }
  }

  #closeConnections(code, reason) {
    for (const webSocket of this.#connections.keys()) {
      if (
        webSocket.readyState === WebSocket.OPEN ||
        webSocket.readyState === WebSocket.CONNECTING
      ) {
        try {
          webSocket.close(code, reason);
        } catch {
          webSocket.terminate();
        }
      }
    }
  }

  #recordServerError(code) {
    this.#lastError = {
      code,
      message: "CS486 compute transport error.",
    };
  }
}

export function createCs486ComputeServer(options) {
  return new Cs486ComputeServer(options);
}

export function isLoopbackAddress(address) {
  if (typeof address !== "string") return false;
  const normalized = address.toLowerCase().split("%", 1)[0];
  if (normalized === "::1") return true;
  if (normalized.startsWith("::ffff:")) {
    return isIpv4Loopback(normalized.slice("::ffff:".length));
  }
  return isIpv4Loopback(normalized);
}

function validateRequest(value) {
  if (!isObject(value)) {
    return invalidRequest(
      null,
      "invalid_request",
      "Compute request must be a JSON object.",
    );
  }
  const requestId = isValidRequestId(value.requestId) ? value.requestId : null;
  if (value.protocolVersion !== CS486_COMPUTE_PROTOCOL_VERSION) {
    return invalidRequest(
      requestId,
      "unsupported_protocol",
      "Compute protocolVersion must be 1.",
    );
  }
  if (requestId === null) {
    return invalidRequest(
      null,
      "invalid_request_id",
      "Compute requestId is invalid or exceeds its limit.",
    );
  }
  if (!isObject(value.command)) {
    return invalidRequest(
      requestId,
      "invalid_command",
      "Compute command must be a JSON object.",
    );
  }
  if (
    typeof value.command.type !== "string" ||
    !supportedCommands.has(value.command.type)
  ) {
    return invalidRequest(
      requestId,
      "unsupported_command",
      "Compute command type must be create, slice, dispose, terminate, or fail.",
    );
  }
  return {
    ok: true,
    requestId,
    command: value.command,
  };
}

function invalidRequest(requestId, code, message) {
  return {
    ok: false,
    requestId,
    code,
    message,
  };
}

function isValidRequestId(value) {
  if (typeof value !== "string") return false;
  return (
    value.length >= 1 &&
    value.length <= maximumRequestIdCharacters &&
    Buffer.byteLength(value) <= maximumRequestIdBytes &&
    !hasControlCharacter(value)
  );
}

function hasControlCharacter(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function normalizeAuthorizationToken(token) {
  if (Buffer.isBuffer(token) || token instanceof Uint8Array) {
    const bytes = Buffer.from(token);
    if (bytes.length !== 32) {
      throw new RangeError("Compute server token must contain 256 bits.");
    }
    return bytes.toString("base64url");
  }
  if (typeof token !== "string" || token.length === 0) {
    throw new TypeError("Compute server token must encode 256 bits.");
  }

  const rawBytes = Buffer.from(token, "utf8");
  const isRaw256BitToken = rawBytes.length === 32;
  const isHex256BitToken = /^[0-9a-fA-F]{64}$/u.test(token);
  const isBase64Url256BitToken =
    /^[A-Za-z0-9_-]{43}$/u.test(token) &&
    Buffer.from(token, "base64url").length === 32 &&
    Buffer.from(token, "base64url").toString("base64url") === token;
  const isBase64256BitToken =
    /^[A-Za-z0-9+/]{43}=$/u.test(token) &&
    Buffer.from(token, "base64").length === 32 &&
    Buffer.from(token, "base64").toString("base64") === token;
  if (
    !isRaw256BitToken &&
    !isHex256BitToken &&
    !isBase64Url256BitToken &&
    !isBase64256BitToken
  ) {
    throw new RangeError("Compute server token must encode exactly 256 bits.");
  }
  return token;
}

function digestToken(token) {
  return createHash("sha256").update(token, "utf8").digest();
}

function validatePool(pool) {
  if (!isObject(pool)) {
    throw new TypeError("Compute server requires a worker pool.");
  }
  if (typeof pool.request === "function") return pool;
  if (
    typeof pool.createProcess !== "function" ||
    typeof pool.runSlice !== "function" ||
    typeof pool.disposeProcess !== "function"
  ) {
    throw new TypeError(
      "Compute pool must expose request or createProcess/runSlice/disposeProcess.",
    );
  }
  return pool;
}

function createPoolRequester(pool) {
  if (typeof pool.request === "function") {
    return (command) => pool.request(command);
  }
  return (command) => {
    switch (command.command) {
      case "create":
        return pool.createProcess(command);
      case "slice":
        return pool.runSlice(command);
      case "dispose":
        return pool.disposeProcess(command);
      case "terminate":
        return invokePoolControl(pool, "terminateProcess", command);
      case "fail":
        return invokePoolControl(pool, "failProcess", command);
      default:
        throw new Error("Unsupported compute pool command.");
    }
  };
}

function toPoolCommand(requestId, command) {
  const payload = { ...command };
  delete payload.type;
  delete payload.protocolVersion;
  delete payload.requestId;
  delete payload.command;
  return {
    ...payload,
    protocolVersion: CS486_COMPUTE_PROTOCOL_VERSION,
    requestId,
    command: command.type,
  };
}

function beginActorOperation(context, command) {
  const identity = actorIdentity(command);
  if (identity === undefined) {
    return {
      actor: undefined,
      command: command.command,
      rejected: false,
      sequence: 0,
      tick: command.tick,
    };
  }

  const key = serializeActorKey(identity.computerId, identity.processId);
  let actor = context.actors.get(key);
  if (actor === undefined && command.command === "create") {
    if (context.actors.size >= maximumTrackedActors) {
      return { rejected: true };
    }
    actor = {
      cleanupState: "owned",
      computerId: identity.computerId,
      lastCreateSequence: 0,
      lastDisposeSequence: 0,
      latestTick: 0,
      latestTickSequence: 0,
      pendingOperations: 0,
      processId: identity.processId,
    };
    context.actors.set(key, actor);
  }
  if (actor === undefined) {
    return {
      actor: undefined,
      command: command.command,
      rejected: false,
      sequence: 0,
      tick: command.tick,
    };
  }

  const sequence = context.nextActorSequence;
  context.nextActorSequence += 1;
  actor.pendingOperations += 1;
  return {
    actor,
    command: command.command,
    rejected: false,
    sequence,
    tick: command.tick,
  };
}

function completeActorOperation(operation) {
  const actor = operation.actor;
  if (actor === undefined) return;
  switch (operation.command) {
    case "create":
      if (operation.sequence > actor.lastCreateSequence) {
        actor.lastCreateSequence = operation.sequence;
      }
      if (operation.sequence > actor.latestTickSequence) {
        actor.latestTick = 0;
        actor.latestTickSequence = operation.sequence;
      }
      break;
    case "slice":
      if (
        Number.isSafeInteger(operation.tick) &&
        operation.tick >= 0 &&
        operation.sequence > actor.latestTickSequence
      ) {
        actor.latestTick = operation.tick;
        actor.latestTickSequence = operation.sequence;
      }
      break;
    case "dispose":
      if (operation.sequence > actor.lastDisposeSequence) {
        actor.lastDisposeSequence = operation.sequence;
      }
      break;
    default:
      break;
  }
}

function failActorOperation(operation, error) {
  if (
    operation.actor !== undefined &&
    operation.command === "dispose" &&
    isProcessNotFound(error) &&
    operation.sequence > operation.actor.lastDisposeSequence
  ) {
    operation.actor.lastDisposeSequence = operation.sequence;
  }
}

function finishActorOperation(context, operation) {
  const actor = operation.actor;
  if (actor === undefined) return;
  actor.pendingOperations -= 1;
  if (actor.pendingOperations > 0 || actorIsOwned(actor)) return;
  const key = serializeActorKey(actor.computerId, actor.processId);
  if (context.actors.get(key) === actor) context.actors.delete(key);
}

function actorIsOwned(actor) {
  return actor.lastCreateSequence > actor.lastDisposeSequence;
}

function actorIdentity(command) {
  if (
    !isActorIdentifier(command.computerId) ||
    !isActorIdentifier(command.processId)
  ) {
    return undefined;
  }
  return {
    computerId: command.computerId,
    processId: command.processId,
  };
}

function isActorIdentifier(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= maximumActorIdentifierCharacters &&
    /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u.test(value)
  );
}

function serializeActorKey(computerId, processId) {
  return `${String(computerId.length)}:${computerId}:${processId}`;
}

function responseHasPendingCycles(response) {
  return (
    isObject(response) &&
    isObject(response.view) &&
    response.view.hasPendingCpuCycles === true
  );
}

function responseHasTerminalState(response) {
  return (
    isObject(response) &&
    isObject(response.view) &&
    isObject(response.view.state) &&
    terminalProcessStates.has(response.view.state.kind)
  );
}

function responseExecutedInstructions(response) {
  if (
    isObject(response) &&
    isObject(response.result) &&
    Number.isSafeInteger(response.result.executedInstructions)
  ) {
    return response.result.executedInstructions;
  }
  return 0;
}

function isProcessNotFound(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    error.code === "PROCESS_NOT_FOUND"
  );
}

async function runBounded(items, concurrency, operation) {
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await operation(items[index]);
      }
    },
  );
  await Promise.all(runners);
}

function invokePoolControl(pool, method, command) {
  if (typeof pool[method] === "function") {
    return pool[method](command);
  }
  if (typeof pool.controlProcess === "function") {
    return pool.controlProcess(command);
  }
  throw new Error("Compute pool does not support this control command.");
}

function serializeRequestId(requestId) {
  return `${typeof requestId}:${String(requestId)}`;
}

function rememberRequestId(context, requestIdKey) {
  context.recentRequestIds.add(requestIdKey);
  context.recentRequestIdQueue.push(requestIdKey);
  if (context.recentRequestIdQueue.length <= maximumRecentRequestIds) return;
  const evicted = context.recentRequestIdQueue.shift();
  context.recentRequestIds.delete(evicted);
}

function readPoolStatus(pool) {
  if (typeof pool.status !== "function") return null;
  try {
    const status = pool.status();
    if (
      status !== null &&
      typeof status === "object" &&
      typeof status.then === "function"
    ) {
      return { state: "unavailable" };
    }
    return status ?? null;
  } catch {
    return { state: "error" };
  }
}

function validatePort(port) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError("Compute server port must be 0 through 65535.");
  }
  return port;
}

function hasBrowserHeaders(headers) {
  return [
    "origin",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-user",
  ].some((name) => headers[name] !== undefined);
}

function isIpv4Loopback(address) {
  const octets = address.split(".");
  if (octets.length !== 4) return false;
  if (
    octets.some(
      (octet) => !/^(?:0|[1-9][0-9]{0,2})$/u.test(octet) || Number(octet) > 255,
    )
  ) {
    return false;
  }
  return Number(octets[0]) === 127;
}

function rejectUpgrade(socket, statusCode, statusText) {
  if (socket.destroyed) return;
  try {
    socket.end(
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        "Connection: close\r\n" +
        "Cache-Control: no-store\r\n" +
        "Content-Length: 0\r\n\r\n",
    );
  } catch {
    socket.destroy();
  }
}

function rawDataToText(data) {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };
    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(port, CS486_COMPUTE_ADDRESS);
  });
}

function closeTrackedConnections(connections) {
  return Promise.all(
    [...connections.keys()].map(
      (webSocket) =>
        new Promise((resolve) => {
          if (webSocket.readyState === WebSocket.CLOSED) {
            resolve();
            return;
          }
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(() => {
            webSocket.terminate();
            finish();
          }, stopGraceMs);
          webSocket.once("close", finish);
          try {
            webSocket.close(1001, "Compute server stopped.");
          } catch {
            webSocket.terminate();
            finish();
          }
        }),
    ),
  );
}

function closeWebSocketServer(server) {
  return new Promise((resolve) => {
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function closeHttpServer(server) {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    try {
      server.close(() => resolve());
      server.closeAllConnections();
    } catch {
      resolve();
    }
  });
}
