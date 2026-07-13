import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WebSessionError, WebSessionStore } from "./web-session-store.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requestMarker = "CS_WEB_SESSION_REQUEST ";
const snapshotMarker = "CS_WEB_TERMINAL ";
const finalMarker = "CS_WEB_SESSION_FINAL ";
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
    this.assetRoot = options.assetRoot ?? path.join(projectRoot, "web");
    this.store = options.store ?? new WebSessionStore(options.sessionOptions);
    this.server = undefined;
    this.unsubscribeLog = undefined;
    this.unsubscribeState = undefined;
    this.cleanupTimer = undefined;
    this.started = false;
    this.origin = undefined;
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
          `scriptevent computer_system:web-response ${identity.requestId} ${issued.sessionId} ${handoffUrl}`,
        );
      } catch (error) {
        this.store.close(issued.sessionId, "relay_failed");
        throw error;
      }
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

    const final = markerPayload(entry.line, finalMarker);
    if (final !== undefined) {
      const payload = JSON.parse(final);
      if (typeof payload.sessionId === "string") {
        this.store.close(payload.sessionId, payload.reason ?? "bedrock_closed");
      }
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
    if (request.method === "POST" && url.pathname === "/api/close") {
      requireSameOrigin(request, this.origin);
      const session = this.store.authenticate(bearerToken(request));
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-close ${session.sessionId}`,
      );
      this.store.close(session.sessionId, "browser_closed");
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
    if (body?.kind === "interrupt") {
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-interrupt ${session.sessionId}`,
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
      `scriptevent computer_system:web-input ${session.sessionId} line ${encoded}`,
    );
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

function message(error) {
  return error instanceof Error ? error.message : String(error);
}
