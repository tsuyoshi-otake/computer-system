import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDefaultBrowser } from "./default-browser-opener.mjs";
import { WebSessionError, WebSessionStore } from "./web-session-store.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requestMarker = "CS_WEB_SESSION_REQUEST ";
const snapshotMarker = "CS_WEB_TERMINAL ";
const completionMarker = "CS_WEB_COMPLETION ";
const finalMarker = "CS_WEB_SESSION_FINAL ";
const maximumOperationWaitersPerComputer = 8;
const maximumBrowserLaunchWaiters = 4;
const defaultBrowserLaunchTimeoutMs = 5_000;
const completionTimeoutMs = 2_000;
const maximumPendingCompletions = 32;
const assetTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

export class WebCompanionServer {
  constructor(options = {}) {
    this.bds = options.bds;
    this.host = options.host ?? "127.0.0.1";
    this.port = parsePort(options.port ?? 19_144);
    this.publicHost = options.publicHost ?? this.host;
    this.publicOrigin = normalizePublicOrigin(options.publicOrigin);
    this.browserAutoOpenEnabled = options.autoOpenBrowser === true;
    this.browserOpener = options.browserOpener ?? openDefaultBrowser;
    this.browserLaunchTimeoutMs = positiveInteger(
      options.browserLaunchTimeoutMs ?? defaultBrowserLaunchTimeoutMs,
      "Browser launch timeout",
    );
    this.writeDiagnostic =
      options.writeDiagnostic ??
      ((line) => {
        process.stderr.write(`${line}\n`);
      });
    this.assetRoot = options.assetRoot ?? path.join(projectRoot, "web");
    this.store = options.store ?? new WebSessionStore(options.sessionOptions);
    this.server = undefined;
    this.unsubscribeLog = undefined;
    this.unsubscribeState = undefined;
    this.cleanupTimer = undefined;
    this.started = false;
    this.origin = undefined;
    this.operationDepths = new Map();
    this.operationTails = new Map();
    this.browserLaunchDepth = 0;
    this.browserLaunchTail = Promise.resolve();
    this.pendingCompletions = new Map();
    this.nextCompletion = 1;
    this.browserLaunch = {
      enabled: this.browserAutoOpenEnabled,
      eligible: false,
      state: this.browserAutoOpenEnabled ? "blocked" : "disabled",
      reason: this.browserAutoOpenEnabled ? "not_started" : null,
      attempts: 0,
      opened: 0,
      failed: 0,
      lastError: null,
    };
  }

  async start() {
    if (this.started) return this.status();
    validateHost(this.host, this.publicHost, this.publicOrigin);
    await stat(path.join(this.assetRoot, "index.html"));
    const server = createServer((request, response) => {
      void this.handleRequest(request, response).catch((error) => {
        this.writeError(response, error);
      });
    });
    this.server = server;
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(this.port, this.host, () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address();
    const actualPort =
      typeof address === "object" && address !== null
        ? address.port
        : this.port;
    this.origin =
      this.publicOrigin ??
      `http://${formatHost(this.publicHost)}:${String(actualPort)}`;
    this.configureBrowserAutoOpen();
    this.started = true;
    this.cleanupTimer = setInterval(() => this.store.expire(), 30_000);
    this.cleanupTimer.unref();
    if (this.bds !== undefined) this.attachBds(this.bds);
    return this.status();
  }

  async stop() {
    if (!this.started) return this.status();
    this.started = false;
    this.unsubscribeLog?.();
    this.unsubscribeLog = undefined;
    this.unsubscribeState?.();
    this.unsubscribeState = undefined;
    if (this.cleanupTimer !== undefined) clearInterval(this.cleanupTimer);
    this.cleanupTimer = undefined;
    await this.browserLaunchTail.catch(() => undefined);
    if (this.bds !== undefined) {
      await Promise.allSettled(
        this.store
          .activeSessions()
          .map((session) =>
            this.bds.runWebRelay(
              `scriptevent computer_system:web-close ${session.sessionId}`,
            ),
          ),
      );
    }
    this.store.closeAll("companion_stopped");
    this.failPendingCompletions("Web companion stopped.");
    const server = this.server;
    this.server = undefined;
    if (server !== undefined) {
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
    return this.status();
  }

  status() {
    return {
      state: this.started ? "running" : "idle",
      running: this.started,
      address: this.host,
      port: this.server?.address()?.port ?? this.port,
      origin: this.origin ?? null,
      activeSessions: this.store.activeCount(),
      browserAutoOpen: { ...this.browserLaunch },
    };
  }

  attachBds(bds) {
    this.unsubscribeLog?.();
    this.unsubscribeState?.();
    this.unsubscribeLog = bds.onLog((entry) => {
      void this.handleBdsLog(entry).catch((error) => {
        process.stderr.write(`Web companion bridge error: ${message(error)}\n`);
      });
    });
    this.unsubscribeState = bds.onState((state) => {
      if (state === "idle" || state === "failed") {
        this.store.closeAll(state === "failed" ? "bds_failed" : "bds_stopped");
        this.failPendingCompletions("BDS stopped before completion finished.");
      }
    });
  }

  async handleBdsLog(entry) {
    const request = markerPayload(entry.line, requestMarker);
    if (request !== undefined) {
      const identity = JSON.parse(request);
      const issued = this.store.issue(identity);
      const handoffUrl = `${this.origin}/p/${issued.handoffCode}`;
      try {
        await this.bds.runWebRelay(
          `scriptevent computer_system:web-response ${identity.requestId} ${issued.sessionId} ${issued.mode} ${handoffUrl}`,
        );
      } catch (error) {
        this.store.close(issued.sessionId, "relay_failed");
        throw error;
      }
      await this.queueBrowserLaunch(handoffUrl);
      return;
    }

    const snapshot = markerPayload(entry.line, snapshotMarker);
    if (snapshot !== undefined) {
      const payload = JSON.parse(snapshot);
      if (typeof payload.sessionId === "string") {
        this.store.updateTerminal(payload.sessionId, payload);
      }
      return;
    }

    const completion = markerPayload(entry.line, completionMarker);
    if (completion !== undefined) {
      const payload = JSON.parse(completion);
      const pending = this.pendingCompletions.get(payload.requestId);
      if (
        pending !== undefined &&
        pending.sessionId === payload.sessionId &&
        typeof payload.value === "string" &&
        Number.isSafeInteger(payload.cursor) &&
        Array.isArray(payload.candidates)
      ) {
        clearTimeout(pending.timer);
        this.pendingCompletions.delete(payload.requestId);
        pending.resolve({
          candidates: payload.candidates
            .filter((value) => typeof value === "string")
            .slice(0, 64),
          cursor: payload.cursor,
          value: payload.value,
        });
      }
      return;
    }

    const final = markerPayload(entry.line, finalMarker);
    if (final !== undefined) {
      const payload = JSON.parse(final);
      if (typeof payload.sessionId === "string") {
        this.store.close(payload.sessionId, payload.reason ?? "bedrock_closed");
      }
    }
  }

  configureBrowserAutoOpen() {
    if (!this.browserAutoOpenEnabled) return;
    const origin = new URL(this.origin);
    if (!isLoopbackHost(this.host)) {
      this.browserLaunch = {
        ...this.browserLaunch,
        eligible: false,
        state: "blocked",
        reason: "listener_not_loopback",
      };
      return;
    }
    if (!isLoopbackHost(origin.hostname)) {
      this.browserLaunch = {
        ...this.browserLaunch,
        eligible: false,
        state: "blocked",
        reason: "origin_not_loopback",
      };
      return;
    }
    this.browserLaunch = {
      ...this.browserLaunch,
      eligible: true,
      state: "ready",
      reason: null,
    };
  }

  async queueBrowserLaunch(url) {
    if (!this.browserLaunch.enabled || !this.browserLaunch.eligible) return;
    if (this.browserLaunchDepth >= maximumBrowserLaunchWaiters) {
      this.browserLaunch = {
        ...this.browserLaunch,
        state: "failed",
        failed: this.browserLaunch.failed + 1,
        lastError: "Browser launch queue capacity was reached.",
      };
      this.writeDiagnostic(
        "Web companion browser launch skipped: queue capacity reached.",
      );
      return;
    }

    this.browserLaunchDepth += 1;
    this.browserLaunch = {
      ...this.browserLaunch,
      attempts: this.browserLaunch.attempts + 1,
    };
    const operation = this.browserLaunchTail.then(
      () => this.launchBrowser(url),
      () => this.launchBrowser(url),
    );
    this.browserLaunchTail = operation.catch(() => undefined);
    try {
      await operation;
    } finally {
      this.browserLaunchDepth -= 1;
    }
  }

  async launchBrowser(url) {
    this.browserLaunch = {
      ...this.browserLaunch,
      state: "opening",
      lastError: null,
    };
    try {
      await withTimeout(
        Promise.resolve().then(() => this.browserOpener(url)),
        this.browserLaunchTimeoutMs,
        "Default browser launch timed out.",
      );
      this.browserLaunch = {
        ...this.browserLaunch,
        state: "opened",
        opened: this.browserLaunch.opened + 1,
        lastError: null,
      };
    } catch (error) {
      const detail = message(error);
      this.browserLaunch = {
        ...this.browserLaunch,
        state: "failed",
        failed: this.browserLaunch.failed + 1,
        lastError: detail,
      };
      this.writeDiagnostic(`Web companion browser launch failed: ${detail}`);
    }
  }

  async handleRequest(request, response) {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", this.origin ?? "http://127.0.0.1");
    if (request.method === "GET" && url.pathname.startsWith("/p/")) {
      const code = url.pathname.slice(3);
      const consumed = this.store.consumeHandoff(code);
      response.writeHead(302, {
        Location: `/#${consumed.token}`,
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      const session = this.store.authenticate(bearerToken(request));
      writeJson(response, 200, this.store.publicSession(session));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      this.streamEvents(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/input") {
      requireSameOrigin(request, this.origin);
      const session = this.store.authenticate(bearerToken(request));
      const body = await readJson(request, 4_096);
      await this.relayInput(session, body);
      writeJson(response, 202, { outcome: "accepted" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/complete") {
      requireSameOrigin(request, this.origin);
      const session = this.store.authenticate(bearerToken(request));
      const body = await readJson(request, 4_096);
      const completion = await this.completeInput(session, body);
      writeJson(response, 200, completion);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/resize") {
      requireSameOrigin(request, this.origin);
      const session = this.store.authenticate(bearerToken(request));
      const body = await readJson(request, 4_096);
      await this.resizeTerminal(session, body);
      writeJson(response, 202, { outcome: "accepted" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/take-control") {
      requireSameOrigin(request, this.origin);
      const session = this.store.authenticate(bearerToken(request));
      const controlled = await this.takeControl(session);
      writeJson(response, 200, { outcome: "writer", session: controlled });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/close") {
      requireSameOrigin(request, this.origin);
      const session = this.store.authenticate(bearerToken(request));
      await this.closeSession(session);
      writeJson(response, 200, { outcome: "closed" });
      return;
    }
    if (request.method === "GET") {
      await this.serveAsset(url.pathname, response);
      return;
    }
    throw new WebSessionError("route", "Route not found.", 404);
  }

  streamEvents(request, response) {
    const token = bearerToken(request);
    let blocked = false;
    let latest;
    const writeEvent = (event) => {
      if (blocked) {
        latest = event;
        return;
      }
      blocked = !response.write(`${JSON.stringify(event)}\n`);
      if (blocked) {
        response.once("drain", () => {
          blocked = false;
          if (latest !== undefined) {
            const pending = latest;
            latest = undefined;
            writeEvent(pending);
          }
        });
      }
    };
    const subscription = this.store.subscribe(token, writeEvent);
    response.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    writeEvent({ type: "state", session: subscription.session });
    const keepAlive = setInterval(
      () => writeEvent({ type: "keepalive" }),
      15_000,
    );
    keepAlive.unref();
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      clearInterval(keepAlive);
      subscription.unsubscribe();
    };
    request.once("close", finalize);
    response.once("close", finalize);
  }

  async relayInput(session, body) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      if (!this.store.isWriter(active.sessionId)) {
        throw new WebSessionError(
          "read_only",
          "This browser terminal is view only. Take control before typing.",
          409,
        );
      }
      if (body?.kind === "interrupt") {
        await this.bds.runWebRelay(
          `scriptevent computer_system:web-interrupt ${active.sessionId}`,
        );
        return;
      }
      if (body?.kind === "keys") {
        if (
          !Array.isArray(body.value) ||
          body.value.length === 0 ||
          body.value.length > 32 ||
          body.value.some(
            (key) =>
              typeof key !== "string" || key.length === 0 || key.length > 32,
          )
        ) {
          throw new WebSessionError("input", "Invalid terminal key batch.");
        }
        const encodedKeys = encodeURIComponent(JSON.stringify(body.value));
        if (encodedKeys.length > 180) {
          throw new WebSessionError(
            "input",
            "Encoded terminal keys are too long.",
          );
        }
        await this.bds.runWebRelay(
          `scriptevent computer_system:web-input ${active.sessionId} keys ${encodedKeys}`,
        );
        return;
      }
      if (body?.kind !== "line" || typeof body.value !== "string") {
        throw new WebSessionError("input", "Input must be a terminal line.");
      }
      if (
        body.value.includes("\0") ||
        /[\r\n]/u.test(body.value) ||
        body.value.length > 128
      ) {
        throw new WebSessionError(
          "input",
          "Terminal input must be one line of at most 128 characters.",
        );
      }
      const encoded = encodeURIComponent(body.value);
      if (encoded.length > 180) {
        throw new WebSessionError(
          "input",
          "Encoded terminal input is too long for the BDS relay.",
        );
      }
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-input ${active.sessionId} line ${encoded}`,
      );
    });
  }

  async completeInput(session, body) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      if (!this.store.isWriter(active.sessionId)) {
        throw new WebSessionError(
          "read_only",
          "This browser terminal is view only. Take control before completing input.",
          409,
        );
      }
      if (
        typeof body?.value !== "string" ||
        body.value.includes("\0") ||
        /[\r\n]/u.test(body.value) ||
        body.value.length > 128 ||
        !Number.isSafeInteger(body.cursor) ||
        body.cursor < 0 ||
        body.cursor > body.value.length
      ) {
        throw new WebSessionError("input", "Invalid completion request.");
      }
      if (this.pendingCompletions.size >= maximumPendingCompletions) {
        throw new WebSessionError(
          "busy",
          "Too many terminal completions are pending.",
          503,
        );
      }
      const encoded = encodeURIComponent(body.value);
      if (encoded.length > 128) {
        throw new WebSessionError(
          "input",
          "Encoded completion input is too long for the BDS relay.",
        );
      }
      const requestId = `c${this.nextCompletion.toString(36).padStart(5, "0")}`;
      this.nextCompletion =
        this.nextCompletion === Number.MAX_SAFE_INTEGER
          ? 1
          : this.nextCompletion + 1;
      let resolveCompletion;
      let rejectCompletion;
      const completion = new Promise((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
      });
      const timer = setTimeout(() => {
        this.pendingCompletions.delete(requestId);
        rejectCompletion(
          new WebSessionError("timeout", "Terminal completion timed out.", 504),
        );
      }, completionTimeoutMs);
      timer.unref();
      this.pendingCompletions.set(requestId, {
        reject: rejectCompletion,
        resolve: resolveCompletion,
        sessionId: active.sessionId,
        timer,
      });
      try {
        await this.bds.runWebRelay(
          `scriptevent computer_system:web-complete ${active.sessionId} ${requestId} ${String(body.cursor)} v${encoded}`,
        );
      } catch (error) {
        clearTimeout(timer);
        this.pendingCompletions.delete(requestId);
        throw error;
      }
      return completion;
    });
  }

  async resizeTerminal(session, body) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      if (!this.store.isWriter(active.sessionId)) {
        throw new WebSessionError(
          "read_only",
          "This browser terminal is view only. Take control before resizing.",
          409,
        );
      }
      if (
        !Number.isSafeInteger(body?.width) ||
        !Number.isSafeInteger(body?.height) ||
        body.width < 51 ||
        body.width > 160 ||
        body.height < 19 ||
        body.height > 60
      ) {
        throw new WebSessionError("input", "Invalid terminal dimensions.");
      }
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-resize ${active.sessionId} ${String(body.width)} ${String(body.height)}`,
      );
    });
  }

  failPendingCompletions(detail) {
    for (const pending of this.pendingCompletions.values()) {
      clearTimeout(pending.timer);
      pending.reject(new WebSessionError("closed", detail, 503));
    }
    this.pendingCompletions.clear();
  }

  async takeControl(session) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      if (this.store.isWriter(active.sessionId)) {
        return this.store.publicSession(active);
      }
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-take-control ${active.sessionId}`,
      );
      return this.store.takeControl(active.sessionId);
    });
  }

  async closeSession(session) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-close ${active.sessionId}`,
      );
      this.store.close(active.sessionId, "browser_closed");
    });
  }

  async serializeComputerOperation(computerId, task) {
    const depth = (this.operationDepths.get(computerId) ?? 0) + 1;
    if (depth > maximumOperationWaitersPerComputer) {
      throw new WebSessionError(
        "computer_busy",
        "Too many terminal operations are waiting for this computer.",
        429,
      );
    }
    this.operationDepths.set(computerId, depth);
    const previous = this.operationTails.get(computerId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.operationTails.set(computerId, current);
    try {
      return await current;
    } finally {
      const remaining = (this.operationDepths.get(computerId) ?? 1) - 1;
      if (remaining === 0) this.operationDepths.delete(computerId);
      else this.operationDepths.set(computerId, remaining);
      if (this.operationTails.get(computerId) === current) {
        this.operationTails.delete(computerId);
      }
    }
  }

  async serveAsset(pathname, response) {
    const relative = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!/^[A-Za-z0-9._/-]+$/u.test(relative) || relative.includes("..")) {
      throw new WebSessionError("asset", "Asset not found.", 404);
    }
    const target = path.resolve(this.assetRoot, relative);
    if (!target.startsWith(`${path.resolve(this.assetRoot)}${path.sep}`)) {
      throw new WebSessionError("asset", "Asset not found.", 404);
    }
    const metadata = await stat(target).catch(() => undefined);
    if (metadata?.isFile() !== true) {
      throw new WebSessionError("asset", "Asset not found.", 404);
    }
    response.writeHead(200, {
      "Content-Type":
        assetTypes.get(path.extname(target)) ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    createReadStream(target).pipe(response);
  }

  writeError(response, error) {
    if (response.headersSent) {
      response.destroy();
      return;
    }
    const status = error instanceof WebSessionError ? error.status : 500;
    writeJson(response, status, {
      error: status >= 500 ? "Internal companion error." : message(error),
    });
  }
}

export function parsePort(value) {
  const text = String(value);
  if (!/^\d+$/u.test(text))
    throw new RangeError("WEB_COMPANION_PORT must be a valid port.");
  const port = Number.parseInt(text, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65_534) {
    throw new RangeError("WEB_COMPANION_PORT must be a valid port.");
  }
  return port;
}

export function parseBooleanFlag(value, name) {
  if (value === undefined || value === "" || value === "0" || value === "false")
    return false;
  if (value === "1" || value === "true") return true;
  throw new Error(`${name} must be 1, 0, true, or false.`);
}

function markerPayload(line, marker) {
  const index = line.indexOf(marker);
  return index === -1 ? undefined : line.slice(index + marker.length).trim();
}

function bearerToken(request) {
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(
    request.headers.authorization ?? "",
  );
  if (match === null) {
    throw new WebSessionError(
      "unauthorized",
      "A valid browser terminal token is required.",
      401,
    );
  }
  return match[1];
}

function requireSameOrigin(request, origin) {
  if (request.headers.origin !== origin) {
    throw new WebSessionError(
      "origin",
      "Cross-origin browser requests are not allowed.",
      403,
    );
  }
}

async function readJson(request, maximumBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      throw new WebSessionError("body", "Request body is too large.", 413);
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new WebSessionError("json", "Request body must be valid JSON.");
  }
}

function writeJson(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function setSecurityHeaders(response) {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
}

function validateHost(host, publicHost, publicOrigin) {
  if (
    host === "0.0.0.0" &&
    publicOrigin === undefined &&
    (publicHost === host || publicHost.length === 0)
  ) {
    throw new Error(
      "WEB_COMPANION_PUBLIC_ORIGIN or WEB_COMPANION_PUBLIC_HOST is required when binding to 0.0.0.0.",
    );
  }
}

function normalizePublicOrigin(value) {
  if (value === undefined) return undefined;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      "WEB_COMPANION_PUBLIC_ORIGIN must be an absolute HTTP(S) origin.",
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.pathname !== "/" ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "WEB_COMPANION_PUBLIC_ORIGIN must be an absolute HTTP(S) origin.",
    );
  }
  return parsed.origin;
}

function formatHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function isLoopbackHost(host) {
  const normalized = host.toLowerCase().replace(/^\[|\]$/gu, "");
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
  return value;
}

function withTimeout(operation, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(timeoutMessage)),
      timeoutMs,
    );
    operation.then(
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

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
