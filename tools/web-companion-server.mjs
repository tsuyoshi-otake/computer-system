import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDefaultBrowser } from "./default-browser-opener.mjs";
import { WebSessionError, WebSessionStore } from "./web-session-store.mjs";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const requestMarker = "CS_WEB_SESSION_REQUEST ";
const readyMarker = "CS_WEB_SESSION_READY ";
const snapshotMarker = "CS_WEB_TERMINAL ";
const accessMarker = "CS_WEB_ACCESS ";
const inputMarker = "CS_WEB_INPUT ";
const completionMarker = "CS_WEB_COMPLETION ";
const powerMarker = "CS_WEB_POWER ";
const ejectMarker = "CS_WEB_FLOPPY_EJECT ";
const finalMarker = "CS_WEB_SESSION_FINAL ";
const maximumOperationWaitersPerComputer = 8;
const maximumBrowserLaunchWaiters = 4;
const maximumPendingActivations = 32;
const defaultBrowserLaunchTimeoutMs = 5_000;
const defaultBedrockActivationTimeoutMs = 5_000;
const defaultInputTimeoutMs = 2_000;
const maximumPendingInputs = 32;
const completionTimeoutMs = 2_000;
const maximumPendingCompletions = 32;
const maximumCompletionTextLength = 128;
const completionOutcomes = new Set(["applied", "listed", "none"]);
const powerTimeoutMs = 5_000;
const maximumPendingPowerRequests = 32;
const ejectTimeoutMs = 5_000;
const maximumPendingEjectRequests = 32;
const maximumHandoffWaitMs = 120_000;
const maximumPendingTuiWaits = 8;
const maximumTuiWaitMs = 120_000;
const maximumTuiWidth = 200;
const maximumTuiHeight = 100;
const maximumTuiContainsLength = 500;
const browserInteractionSchema = "2";
const browserInteractionSchemaHeader = "x-computer-system-interaction-schema";
const maximumHandoffFailuresPerWindow = 8;
const maximumHandoffFailureClients = 256;
const handoffFailureWindowMs = 60_000;
const computerIdPattern = /^c-[0-9a-hjkmnp-tv-z]{6}$/u;
const assetTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
]);

export class WebCompanionServer {
  constructor(options = {}) {
    this.bds = options.bds;
    this.host = options.host ?? "127.0.0.1";
    this.port = parsePort(options.port ?? 80);
    this.networkInterfaces = options.networkInterfaces ?? networkInterfaces();
    this.publicHost =
      options.publicHost ??
      (this.host === "0.0.0.0"
        ? selectLanIpv4(this.networkInterfaces)
        : this.host);
    this.publicOrigin = normalizePublicOrigin(options.publicOrigin);
    this.configuredOrigins = normalizeAllowedOrigins(options.allowedOrigins);
    this.browserAutoOpenPreference = options.autoOpenBrowser;
    this.debugIgnoreRange = options.debugIgnoreRange === true;
    this.browserOpener = options.browserOpener ?? openDefaultBrowser;
    this.browserLaunchTimeoutMs = positiveInteger(
      options.browserLaunchTimeoutMs ?? defaultBrowserLaunchTimeoutMs,
      "Browser launch timeout",
    );
    this.bedrockActivationTimeoutMs = positiveInteger(
      options.bedrockActivationTimeoutMs ?? defaultBedrockActivationTimeoutMs,
      "Bedrock activation timeout",
    );
    this.inputTimeoutMs = positiveInteger(
      options.inputTimeoutMs ?? defaultInputTimeoutMs,
      "Terminal input timeout",
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
    this.browserOrigin = undefined;
    this.allowedOrigins = new Set();
    this.handoffFailures = new Map();
    this.operationDepths = new Map();
    this.operationTails = new Map();
    this.browserLaunchDepth = 0;
    this.browserConnectionWaiters = 0;
    this.browserLaunchTail = Promise.resolve();
    this.pendingInputs = new Map();
    this.pendingCompletions = new Map();
    this.pendingPowerRequests = new Map();
    this.pendingEjectRequests = new Map();
    this.pendingHandoffs = new Map();
    this.pendingTuiWaits = new Map();
    this.pendingActivations = new Map();
    this.nextInput = 1;
    this.nextCompletion = 1;
    this.nextPowerRequest = 1;
    this.nextEjectRequest = 1;
    this.browserLaunch = {
      enabled: this.browserAutoOpenPreference === true,
      eligible: false,
      policy:
        this.browserAutoOpenPreference === undefined
          ? "local_address"
          : this.browserAutoOpenPreference
            ? "enabled"
            : "disabled",
      state: this.browserAutoOpenPreference === false ? "disabled" : "blocked",
      reason:
        this.browserAutoOpenPreference === false
          ? "explicitly_disabled"
          : "not_started",
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
      this.publicOrigin ?? formatHttpOrigin(this.publicHost, actualPort);
    this.browserOrigin =
      isLoopbackHost(this.host) || this.host === "0.0.0.0"
        ? formatHttpOrigin("127.0.0.1", actualPort)
        : undefined;
    this.allowedOrigins = new Set(
      [...this.configuredOrigins, this.origin, this.browserOrigin].filter(
        (origin) => typeof origin === "string",
      ),
    );
    this.configureBrowserAutoOpen();
    this.started = true;
    this.cleanupTimer = setInterval(() => {
      void this.cleanupSessions();
    }, 30_000);
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
    this.failPendingInputs("Web companion stopped.");
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
    this.failPendingActivations("companion_stopped");
    this.failPendingCompletions("Web companion stopped.");
    this.failPendingHandoffs("Web companion stopped.");
    this.failPendingTuiWaits("Web companion stopped.");
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
      rangeEnforcement: this.debugIgnoreRange
        ? "disabled_for_debug"
        : "three_blocks",
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
        this.failPendingActivations(
          state === "failed" ? "bds_failed" : "bds_stopped",
        );
        this.store.closeAll(state === "failed" ? "bds_failed" : "bds_stopped");
        this.failPendingInputs(
          "BDS stopped before terminal input was admitted.",
        );
        this.failPendingCompletions("BDS stopped before completion finished.");
        this.failPendingPowerRequests(
          "BDS stopped before the power request finished.",
        );
        this.failPendingEjectRequests(
          "BDS stopped before the floppy eject request finished.",
        );
        this.failPendingHandoffs("BDS stopped before a handoff was issued.");
        this.failPendingTuiWaits(
          "BDS stopped before TUI verification finished.",
        );
      }
    });
  }

  async handleBdsLog(entry) {
    const request = markerPayload(entry.line, requestMarker);
    if (request !== undefined) {
      const identity = JSON.parse(request);
      await this.issueHandoff(identity);
      return;
    }

    const ready = markerPayload(entry.line, readyMarker);
    if (ready !== undefined) {
      const payload = JSON.parse(ready);
      if (typeof payload.sessionId === "string") {
        await this.completeActivation(payload.sessionId);
      }
      return;
    }

    const snapshot = markerPayload(entry.line, snapshotMarker);
    if (snapshot !== undefined) {
      const payload = JSON.parse(snapshot);
      if (typeof payload.sessionId === "string") {
        try {
          requirePublishedTerminalInteraction(payload);
          this.store.updateTerminal(payload.sessionId, payload);
        } catch {
          this.store.close(payload.sessionId, "interaction_protocol_mismatch", {
            relayToBedrock: true,
          });
          await this.flushBedrockClosures();
        }
      }
      return;
    }

    const input = markerPayload(entry.line, inputMarker);
    if (input !== undefined) {
      const payload = JSON.parse(input);
      const pending =
        payload !== null && typeof payload === "object"
          ? this.pendingInputs.get(payload.requestId)
          : undefined;
      if (
        pending !== undefined &&
        pending.sessionId === payload.sessionId &&
        (payload.outcome === "accepted" ||
          payload.outcome === "failed" ||
          payload.outcome === "ignored" ||
          payload.outcome === "missing")
      ) {
        this.finalizePendingInput(payload.requestId, pending, () => {
          pending.resolve(payload);
        });
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
        payload.value.length <= maximumCompletionTextLength &&
        !/[\0\r\n]/u.test(payload.value) &&
        Number.isSafeInteger(payload.cursor) &&
        payload.cursor >= 0 &&
        payload.cursor <= payload.value.length &&
        completionOutcomes.has(payload.outcome) &&
        typeof payload.truncated === "boolean" &&
        (payload.outcome === "applied" ||
          (payload.value === pending.value &&
            payload.cursor === pending.cursor))
      ) {
        clearTimeout(pending.timer);
        this.pendingCompletions.delete(payload.requestId);
        pending.resolve({
          cursor: payload.cursor,
          outcome: payload.outcome,
          truncated: payload.truncated,
          value: payload.value,
        });
      }
      return;
    }

    const power = markerPayload(entry.line, powerMarker);
    if (power !== undefined) {
      const payload = JSON.parse(power);
      const pending = this.pendingPowerRequests.get(payload.requestId);
      if (
        pending !== undefined &&
        pending.sessionId === payload.sessionId &&
        (payload.outcome === "accepted" ||
          payload.outcome === "failed" ||
          payload.outcome === "ignored" ||
          payload.outcome === "missing")
      ) {
        clearTimeout(pending.timer);
        this.pendingPowerRequests.delete(payload.requestId);
        pending.resolve(payload);
      }
      return;
    }

    const eject = markerPayload(entry.line, ejectMarker);
    if (eject !== undefined) {
      const payload = JSON.parse(eject);
      const pending = this.pendingEjectRequests.get(payload.requestId);
      if (
        pending !== undefined &&
        pending.sessionId === payload.sessionId &&
        (payload.outcome === "ejected" ||
          payload.outcome === "empty" ||
          payload.outcome === "failed" ||
          payload.outcome === "missing")
      ) {
        clearTimeout(pending.timer);
        this.pendingEjectRequests.delete(payload.requestId);
        pending.resolve(payload);
      }
      return;
    }

    const access = markerPayload(entry.line, accessMarker);
    if (access !== undefined) {
      const payload = JSON.parse(access);
      if (typeof payload.sessionId === "string") {
        this.store.updateAccess(payload.sessionId, payload.access);
      }
      return;
    }

    const final = markerPayload(entry.line, finalMarker);
    if (final !== undefined) {
      const payload = JSON.parse(final);
      if (typeof payload.sessionId === "string") {
        const activation = this.cancelActivation(payload.sessionId);
        if (activation !== undefined) {
          this.rejectPendingHandoff(
            activation.computerId,
            payload.reason ?? "bedrock_closed",
          );
        }
        this.store.close(payload.sessionId, payload.reason ?? "bedrock_closed");
      }
    }
  }

  async issueHandoff(identity) {
    let issued;
    try {
      if (
        typeof identity?.computerId !== "string" ||
        !computerIdPattern.test(identity.computerId)
      ) {
        throw new WebSessionError(
          "identity",
          "Invalid browser session identity.",
        );
      }
      await this.serializeComputerOperation(identity.computerId, async () => {
        if (this.pendingActivations.size >= maximumPendingActivations) {
          throw new WebSessionError(
            "capacity",
            "Browser terminal activation capacity has been reached.",
            503,
          );
        }
        issued = this.store.prepare(identity);
        const handoffUrl = `${this.origin}/p/${issued.handoffCode}`;
        const timer = setTimeout(() => {
          void this.failActivation(issued.sessionId, "activation_timeout");
        }, this.bedrockActivationTimeoutMs);
        this.pendingActivations.set(issued.sessionId, {
          computerId: identity.computerId,
          handoffUrl,
          issued,
          timer,
        });
        const debugMarker = this.debugIgnoreRange ? " debug" : "";
        try {
          await this.flushBedrockClosures();
          await this.bds.runWebRelay(
            `scriptevent computer_system:web-response ${identity.requestId} ${issued.sessionId} viewer${debugMarker} ${handoffUrl}`,
          );
        } catch (error) {
          this.cancelActivation(issued.sessionId);
          this.store.close(issued.sessionId, "relay_failed", {
            relayToBedrock: true,
          });
          await this.flushBedrockClosures();
          throw error;
        }
      });
    } catch (error) {
      const reason =
        typeof error?.code === "string" &&
        /^[a-z][a-z_]{0,31}$/u.test(error.code)
          ? error.code
          : "companion_error";
      await this.rejectBedrockRequest(identity?.requestId, reason);
      this.writeDiagnostic(`Web companion handoff rejected: ${reason}.`);
    }
  }

  async completeActivation(sessionId) {
    const activation = this.cancelActivation(sessionId);
    if (activation === undefined) return false;
    let accepted;
    try {
      accepted = this.store.accept(sessionId, "viewer");
    } catch (error) {
      this.store.close(sessionId, "activation_accept_failed", {
        relayToBedrock: true,
      });
      this.rejectPendingHandoff(activation.computerId, message(error));
      await this.flushBedrockClosures();
      return false;
    }
    const handoff = {
      computerId: activation.computerId,
      expiresAt: accepted.handoffExpiresAt,
      mode: accepted.mode,
      principalKind: accepted.principalKind,
      sessionId: accepted.sessionId,
      url: activation.handoffUrl,
    };
    const claimedByMcp = this.resolvePendingHandoff(
      activation.computerId,
      handoff,
    );
    if (!claimedByMcp) {
      await this.queueBrowserLaunch(activation.handoffUrl, sessionId);
    }
    return true;
  }

  async failActivation(sessionId, reason) {
    const activation = this.cancelActivation(sessionId);
    if (activation === undefined) return false;
    this.store.close(sessionId, reason, { relayToBedrock: true });
    this.rejectPendingHandoff(
      activation.computerId,
      `Web Terminal activation failed: ${reason}.`,
    );
    await this.flushBedrockClosures();
    return true;
  }

  cancelActivation(sessionId) {
    const activation = this.pendingActivations.get(sessionId);
    if (activation === undefined) return undefined;
    this.pendingActivations.delete(sessionId);
    clearTimeout(activation.timer);
    return activation;
  }

  async rejectBedrockRequest(requestId, reason) {
    if (
      typeof requestId !== "string" ||
      !/^r[a-z0-9]+-[a-z0-9]+$/u.test(requestId) ||
      this.bds === undefined
    ) {
      return;
    }
    await this.bds
      .runWebRelay(
        `scriptevent computer_system:web-reject ${requestId} ${reason}`,
      )
      .catch(() => undefined);
  }

  waitForHandoff(options = {}) {
    const computerId = options.computerId;
    if (typeof computerId !== "string" || !computerIdPattern.test(computerId)) {
      throw new Error("computerId must use the c-xxxxxx identity format.");
    }
    if (!this.started) throw new Error("Web companion is not running.");
    const principalKind = options.principalKind;
    if (
      principalKind !== undefined &&
      principalKind !== "debug" &&
      principalKind !== "player"
    ) {
      throw new Error("Handoff principalKind must be debug or player.");
    }
    if (this.pendingHandoffs.has(computerId)) {
      throw new Error(`A handoff wait is already active for ${computerId}.`);
    }
    const timeoutMs = Math.min(
      positiveInteger(options.timeoutMs ?? 30_000, "Handoff timeout"),
      maximumHandoffWaitMs,
    );
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingHandoffs.delete(computerId);
        reject(
          new Error(
            `Timed out after ${String(timeoutMs)} ms waiting for a Web Terminal handoff for ${computerId}.`,
          ),
        );
      }, timeoutMs);
      this.pendingHandoffs.set(computerId, {
        principalKind,
        reject,
        resolve,
        timer,
      });
    });
  }

  resolvePendingHandoff(computerId, handoff) {
    const pending = this.pendingHandoffs.get(computerId);
    if (pending === undefined) return false;
    if (
      pending.principalKind !== undefined &&
      pending.principalKind !== handoff.principalKind
    ) {
      return false;
    }
    this.pendingHandoffs.delete(computerId);
    clearTimeout(pending.timer);
    pending.resolve(handoff);
    return true;
  }

  rejectPendingHandoff(computerId, reason) {
    const pending = this.pendingHandoffs.get(computerId);
    if (pending === undefined) return false;
    this.pendingHandoffs.delete(computerId);
    clearTimeout(pending.timer);
    pending.reject(new Error(reason));
    return true;
  }

  failPendingHandoffs(reason) {
    for (const pending of this.pendingHandoffs.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pendingHandoffs.clear();
  }

  failPendingActivations(reason) {
    for (const [sessionId, activation] of this.pendingActivations) {
      clearTimeout(activation.timer);
      this.store.close(sessionId, reason);
      this.rejectPendingHandoff(activation.computerId, reason);
    }
    this.pendingActivations.clear();
  }

  async cleanupSessions() {
    this.store.expire();
    await this.flushBedrockClosures();
  }

  async flushBedrockClosures() {
    const closures = this.store.drainBedrockClosures();
    if (closures.length === 0) return;
    for (const closure of closures) {
      const activation = this.cancelActivation(closure.sessionId);
      if (activation !== undefined) {
        this.rejectPendingHandoff(activation.computerId, closure.reason);
      }
    }
    if (this.bds === undefined || !this.started) return;
    await Promise.allSettled(
      closures.map((closure) =>
        this.bds.runWebRelay(
          `scriptevent computer_system:web-close ${closure.sessionId}`,
        ),
      ),
    );
  }

  configureBrowserAutoOpen() {
    const automaticallyEligible =
      this.browserAutoOpenPreference === undefined &&
      this.publicOrigin === undefined &&
      isPublishedAddressLocal(this.publicHost, this.networkInterfaces);
    const enabled =
      this.browserAutoOpenPreference === true || automaticallyEligible;
    if (!enabled) {
      this.browserLaunch = {
        ...this.browserLaunch,
        enabled: false,
        eligible: false,
        state: "disabled",
        reason:
          this.browserAutoOpenPreference === false
            ? "explicitly_disabled"
            : this.publicOrigin !== undefined
              ? "public_origin_configured"
              : "published_address_not_local",
      };
      return;
    }
    if (this.browserOrigin === undefined) {
      this.browserLaunch = {
        ...this.browserLaunch,
        enabled: true,
        eligible: false,
        state: "blocked",
        reason: "listener_not_locally_reachable",
      };
      return;
    }
    this.browserLaunch = {
      ...this.browserLaunch,
      enabled: true,
      eligible: true,
      state: "ready",
      reason: null,
    };
  }

  async queueBrowserLaunch(url, sessionId) {
    if (!this.browserLaunch.enabled || !this.browserLaunch.eligible)
      return false;
    if (!this.store.isHandoffCurrent(sessionId)) return false;
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
      return false;
    }

    this.browserLaunchDepth += 1;
    this.browserLaunch = {
      ...this.browserLaunch,
      attempts: this.browserLaunch.attempts + 1,
    };
    const published = new URL(url);
    const localUrl = new URL(
      `${published.pathname}${published.search}${published.hash}`,
      this.browserOrigin,
    ).toString();
    const launchIfCurrent = () => {
      if (!this.started || !this.store.isHandoffCurrent(sessionId))
        return false;
      return this.launchBrowser(localUrl);
    };
    const operation = this.browserLaunchTail.then(
      launchIfCurrent,
      launchIfCurrent,
    );
    this.browserLaunchTail = operation.catch(() => undefined);
    try {
      return await operation;
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
      return true;
    } catch (error) {
      const detail = message(error);
      this.browserLaunch = {
        ...this.browserLaunch,
        state: "failed",
        failed: this.browserLaunch.failed + 1,
        lastError: detail,
      };
      this.writeDiagnostic(`Web companion browser launch failed: ${detail}`);
      return false;
    }
  }

  async openHandoffInBrowser(handoff, options = {}) {
    if (
      handoff === null ||
      typeof handoff !== "object" ||
      typeof handoff.sessionId !== "string" ||
      typeof handoff.computerId !== "string" ||
      typeof handoff.url !== "string"
    ) {
      throw new Error("A valid Web Terminal handoff is required.");
    }
    if (this.browserConnectionWaiters >= 4) {
      throw new Error("Browser connection wait capacity has been reached.");
    }
    const timeoutMs = Math.min(
      positiveInteger(
        options.timeoutMs ?? 30_000,
        "Browser connection timeout",
      ),
      maximumHandoffWaitMs,
    );
    this.browserConnectionWaiters += 1;
    try {
      const launched = await this.queueBrowserLaunch(
        handoff.url,
        handoff.sessionId,
      );
      if (!launched) {
        throw new Error(
          this.browserLaunch.lastError ??
            this.browserLaunch.reason ??
            "Default browser launch was not admitted.",
        );
      }
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!this.started) {
          throw new Error(
            "Web companion stopped before the browser connected.",
          );
        }
        const session = this.store.activeSession(handoff.sessionId);
        if (session === undefined) {
          throw new Error(
            "Web Terminal session ended before the browser connected.",
          );
        }
        if (session.mode === "writer") {
          return {
            computerId: session.computerId,
            mode: session.mode,
            access: session.access,
            state: session.state,
            terminalReady: session.terminal !== null,
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        "Timed out after " +
          String(timeoutMs) +
          " ms waiting for the default browser to connect.",
      );
    } finally {
      this.browserConnectionWaiters -= 1;
    }
  }

  async sendTuiInput(options = {}) {
    const identity = requireTuiSessionIdentity(options);
    if (
      options.kind !== "line" &&
      options.kind !== "keys" &&
      options.kind !== "interrupt" &&
      options.kind !== "abort-line"
    ) {
      throw new Error(
        "TUI input kind must be line, keys, interrupt, or abort-line.",
      );
    }
    if (
      (options.kind === "interrupt" || options.kind === "abort-line") &&
      options.value !== undefined
    ) {
      throw new Error("TUI control input must not include a value.");
    }
    return this.serializeComputerOperation(identity.computerId, async () => {
      const session = this.requireTuiSession(identity);
      const interaction = requireSessionTerminalInteraction(session);
      if (interaction.secretInput) {
        throw new Error(
          "MCP TUI input is unavailable until a non-secret terminal frame is active.",
        );
      }
      return this.relayValidatedInput(session, {
        interactionGeneration: interaction.interactionGeneration,
        kind: options.kind,
        value: options.value,
      });
    });
  }

  captureTuiScreen(options = {}) {
    const identity = requireTuiSessionIdentity(options);
    const includeColors = optionalBoolean(
      options.includeColors,
      "includeColors",
    );
    const session = this.requireTuiSession(identity);
    const screen = serializeTuiScreen(session, includeColors);
    if (screen === undefined) {
      throw new Error(
        `The Web Terminal writer for ${identity.computerId} has not published a TUI frame yet.`,
      );
    }
    return screen;
  }

  waitForTuiScreen(options = {}) {
    const identity = requireTuiSessionIdentity(options);
    const includeColors = optionalBoolean(
      options.includeColors,
      "includeColors",
    );
    const contains = optionalTuiContains(options.contains);
    const afterVersion = optionalTuiVersion(options.afterVersion);
    const timeoutMs = Math.min(
      positiveInteger(options.timeoutMs ?? 10_000, "TUI wait timeout"),
      maximumTuiWaitMs,
    );
    if (!this.started) throw new Error("Web companion is not running.");
    this.requireTuiSession(identity);
    if (this.pendingTuiWaits.has(identity.sessionId)) {
      throw new Error(
        `A TUI wait is already active for ${identity.computerId}.`,
      );
    }
    if (this.pendingTuiWaits.size >= maximumPendingTuiWaits) {
      throw new Error("TUI verification wait capacity has been reached.");
    }

    return new Promise((resolve, reject) => {
      let pending;
      const observation = this.store.observe(identity.sessionId, () => {
        this.evaluatePendingTuiWait(identity.sessionId, pending);
      });
      const timer = setTimeout(() => {
        this.finalizePendingTuiWait(identity.sessionId, pending, () => {
          reject(
            new Error(
              `Timed out after ${String(timeoutMs)} ms waiting for the TUI screen for ${identity.computerId}.`,
            ),
          );
        });
      }, timeoutMs);
      timer.unref();
      pending = {
        afterVersion,
        contains,
        identity,
        includeColors,
        observation,
        reject,
        resolve,
        timer,
      };
      this.pendingTuiWaits.set(identity.sessionId, pending);
      this.evaluatePendingTuiWait(identity.sessionId, pending);
    });
  }

  requireTuiSession(identity) {
    if (!this.started) throw new Error("Web companion is not running.");
    const session = this.store.activeSession(identity.sessionId);
    if (session === undefined || session.computerId !== identity.computerId) {
      throw new Error(
        `The MCP Web Terminal session for ${identity.computerId} is no longer active.`,
      );
    }
    if (session.principalKind !== "debug") {
      throw new Error(
        `The Web Terminal writer for ${identity.computerId} is not owned by the MCP debug principal.`,
      );
    }
    if (session.mode !== "writer" || !this.store.isWriter(identity.sessionId)) {
      throw new Error(
        `The MCP Web Terminal session for ${identity.computerId} is no longer the active writer.`,
      );
    }
    if (session.access !== "in_range") {
      throw new Error(
        `The MCP Web Terminal session for ${identity.computerId} is not accessible.`,
      );
    }
    return session;
  }

  evaluatePendingTuiWait(sessionId, pending) {
    if (
      pending === undefined ||
      this.pendingTuiWaits.get(sessionId) !== pending
    ) {
      return;
    }
    try {
      const session = this.requireTuiSession(pending.identity);
      const screen = serializeTuiScreen(session, pending.includeColors);
      if (screen === undefined || !matchesTuiWait(screen, pending)) return;
      this.finalizePendingTuiWait(sessionId, pending, () => {
        pending.resolve(screen);
      });
    } catch (error) {
      this.finalizePendingTuiWait(sessionId, pending, () => {
        pending.reject(error);
      });
    }
  }

  finalizePendingTuiWait(sessionId, pending, finalize) {
    if (this.pendingTuiWaits.get(sessionId) !== pending) return false;
    this.pendingTuiWaits.delete(sessionId);
    clearTimeout(pending.timer);
    pending.observation.unsubscribe();
    finalize();
    return true;
  }

  failPendingTuiWaits(reason) {
    for (const [sessionId, pending] of this.pendingTuiWaits) {
      this.finalizePendingTuiWait(sessionId, pending, () => {
        pending.reject(new Error(reason));
      });
    }
  }

  async handleRequest(request, response) {
    setSecurityHeaders(response);
    const url = new URL(request.url ?? "/", this.origin ?? "http://127.0.0.1");
    if (request.method === "GET" && url.pathname.startsWith("/p/")) {
      const match = /^\/p\/([0-9]{4})$/u.exec(url.pathname);
      if (match === null) {
        throw new WebSessionError(
          "unauthorized",
          "A valid browser terminal link is required.",
          401,
        );
      }
      const code = match[1];
      response.writeHead(302, {
        Location: `/?computer=${encodeURIComponent(code)}&handoff=1`,
        "Cache-Control": "no-store",
      });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/handoff") {
      requireSameOrigin(request, this.allowedOrigins);
      const body = await readJson(request, 1_024);
      const consumed = await this.consumeHandoffCode(request, body?.code);
      writeJson(response, 200, { code: body.code, token: consumed.token });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/reconnect") {
      requireSameOrigin(request, this.allowedOrigins);
      const body = await readJson(request, 1_024);
      const reconnected = this.reconnectCode(request, body?.code);
      writeJson(response, 200, reconnected);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/session") {
      const session = this.authenticateBrowserSession(request);
      writeJson(response, 200, this.store.publicSession(session));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events") {
      const session = this.authenticateBrowserSession(request);
      this.streamEvents(request, response, session);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/input") {
      requireSameOrigin(request, this.allowedOrigins);
      const session = this.authenticateBrowserSession(request);
      const body = await readJson(request, 4_096);
      const result = await this.relayInput(session, body);
      writeJson(response, 202, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/complete") {
      requireSameOrigin(request, this.allowedOrigins);
      const session = this.authenticateBrowserSession(request);
      const body = await readJson(request, 4_096);
      const completion = await this.completeInput(session, body);
      writeJson(response, 200, completion);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/resize") {
      requireSameOrigin(request, this.allowedOrigins);
      const session = this.authenticateBrowserSession(request);
      const body = await readJson(request, 4_096);
      await this.resizeTerminal(session, body);
      writeJson(response, 202, { outcome: "accepted" });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/take-control") {
      requireSameOrigin(request, this.allowedOrigins);
      const session = this.authenticateBrowserSession(request);
      const controlled = await this.takeControl(session);
      writeJson(response, 200, { outcome: "writer", session: controlled });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/power") {
      requireSameOrigin(request, this.allowedOrigins);
      const session = this.authenticateBrowserSession(request);
      const body = await readJson(request, 1_024);
      const result = await this.requestPower(session, body);
      writeJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/floppy/eject") {
      requireSameOrigin(request, this.allowedOrigins);
      const session = this.authenticateBrowserSession(request);
      const result = await this.requestFloppyEject(session);
      writeJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/close") {
      requireSameOrigin(request, this.allowedOrigins);
      const session = this.authenticateBrowserSession(request);
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

  authenticateBrowserSession(request) {
    const session = this.store.authenticate(bearerToken(request));
    requireBrowserInteractionSchema(request);
    return session;
  }

  streamEvents(request, response, session) {
    const writeEvent = createCoalescedEventWriter(response);
    const subscription = this.store.subscribe(session.token, writeEvent);
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
      return this.relayValidatedInput(active, body);
    });
  }

  async relayValidatedInput(active, body) {
    this.requireInRange(active);
    if (!this.store.isWriter(active.sessionId)) {
      throw new WebSessionError(
        "read_only",
        "This browser terminal is view only. Take control before typing.",
        409,
      );
    }
    const interaction = requireSessionTerminalInteraction(active);
    requireInteractionGeneration(interaction, body?.interactionGeneration);
    if (
      body?.kind === "interrupt" ||
      body?.kind === "cancel" ||
      body?.kind === "abort-line"
    ) {
      requireInteractionInput(interaction, body.kind);
      return this.requestInputAdmission(
        active.sessionId,
        interaction.interactionGeneration,
        body.kind,
        "",
      );
    }
    if (body?.kind === "eof") {
      if (Object.hasOwn(body, "value")) {
        throw new WebSessionError(
          "input",
          "Terminal EOF does not take a value.",
        );
      }
      requireInteractionInput(interaction, "eof");
      return this.requestInputAdmission(
        active.sessionId,
        interaction.interactionGeneration,
        "eof",
      );
    }
    if (body?.kind === "mouse") {
      const value = body.value;
      if (
        value === null ||
        typeof value !== "object" ||
        !["down", "move", "up"].includes(value.action) ||
        ![0, 1, 2].includes(value.button) ||
        !Number.isSafeInteger(value.sequence) ||
        value.sequence < 0 ||
        !Number.isSafeInteger(value.x) ||
        value.x < 1 ||
        value.x > 80 ||
        !Number.isSafeInteger(value.y) ||
        value.y < 1 ||
        value.y > 25
      ) {
        throw new WebSessionError("input", "Invalid terminal mouse event.");
      }
      const encodedMouse = encodeURIComponent(
        JSON.stringify({
          action: value.action,
          button: value.button,
          sequence: value.sequence,
          x: value.x,
          y: value.y,
        }),
      );
      if (encodedMouse.length > 180) {
        throw new WebSessionError(
          "input",
          "Encoded terminal mouse event is too long.",
        );
      }
      requireInteractionInput(interaction, "mouse");
      return this.requestInputAdmission(
        active.sessionId,
        interaction.interactionGeneration,
        "mouse",
        encodedMouse,
      );
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
      requireInteractionInput(interaction, "keys");
      return this.requestInputAdmission(
        active.sessionId,
        interaction.interactionGeneration,
        "keys",
        encodedKeys,
      );
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
    requireInteractionInput(interaction, "line");
    return this.requestInputAdmission(
      active.sessionId,
      interaction.interactionGeneration,
      "line",
      encoded,
    );
  }

  async requestInputAdmission(
    sessionId,
    interactionGeneration,
    kind,
    encoded = "",
  ) {
    if (this.pendingInputs.size >= maximumPendingInputs) {
      throw retryableInputBusy(
        "Too many terminal input admissions are pending.",
      );
    }
    const requestId = this.allocateInputRequestId();
    let resolveAdmission;
    let rejectAdmission;
    const completion = new Promise((resolve, reject) => {
      resolveAdmission = resolve;
      rejectAdmission = reject;
    });
    let pending;
    const timer = setTimeout(() => {
      this.finalizePendingInput(requestId, pending, () => {
        rejectAdmission(
          new WebSessionError(
            "input_timeout",
            "Terminal input admission timed out.",
            504,
          ),
        );
      });
    }, this.inputTimeoutMs);
    timer.unref();
    pending = {
      reject: rejectAdmission,
      resolve: resolveAdmission,
      sessionId,
      timer,
    };
    this.pendingInputs.set(requestId, pending);
    try {
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-input ${sessionId} ${requestId} ${String(interactionGeneration)} ${kind}${
          kind === "eof" ? "" : ` ${encoded}`
        }`,
      );
    } catch (error) {
      const relayError =
        error instanceof WebSessionError
          ? error
          : new WebSessionError(
              "companion_unavailable",
              "The terminal input relay is temporarily unavailable.",
              503,
            );
      this.finalizePendingInput(requestId, pending, () => {
        rejectAdmission(relayError);
      });
    }
    return requireAcceptedInput(await completion);
  }

  allocateInputRequestId() {
    for (let attempt = 0; attempt <= maximumPendingInputs; attempt += 1) {
      const requestId = `i${this.nextInput.toString(36).padStart(5, "0")}`;
      this.nextInput =
        this.nextInput === Number.MAX_SAFE_INTEGER ? 1 : this.nextInput + 1;
      if (!this.pendingInputs.has(requestId)) return requestId;
    }
    throw retryableInputBusy("Terminal input request IDs are busy.");
  }

  finalizePendingInput(requestId, pending, finalize) {
    if (this.pendingInputs.get(requestId) !== pending) return false;
    clearTimeout(pending.timer);
    this.pendingInputs.delete(requestId);
    finalize();
    return true;
  }

  failPendingInputs(detail) {
    for (const [requestId, pending] of this.pendingInputs) {
      this.finalizePendingInput(requestId, pending, () => {
        pending.reject(new WebSessionError("closed", detail, 503));
      });
    }
  }

  async completeInput(session, body) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      this.requireInRange(active);
      if (!this.store.isWriter(active.sessionId)) {
        throw new WebSessionError(
          "read_only",
          "This browser terminal is view only. Take control before completing input.",
          409,
        );
      }
      const interaction = requireSessionTerminalInteraction(active);
      requireInteractionGeneration(interaction, body?.interactionGeneration);
      requireInteractionInput(interaction, "line");
      if (interaction?.secretInput === true) {
        throw new WebSessionError(
          "secret_input",
          "Completion is unavailable while secret input is active.",
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
        cursor: body.cursor,
        reject: rejectCompletion,
        resolve: resolveCompletion,
        sessionId: active.sessionId,
        timer,
        value: body.value,
      });
      try {
        await this.bds.runWebRelay(
          `scriptevent computer_system:web-complete ${active.sessionId} ${requestId} ${String(interaction.interactionGeneration)} ${String(body.cursor)} v${encoded}`,
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
      this.requireInRange(active);
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
        body.width !== 80 ||
        body.height !== 25
      ) {
        throw new WebSessionError(
          "input",
          "Web Terminal text mode is fixed at 80x25.",
        );
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
      this.requireInRange(active);
      if (this.store.isWriter(active.sessionId)) {
        return this.store.publicSession(active);
      }
      await this.bds.runWebRelay(
        `scriptevent computer_system:web-take-control ${active.sessionId}`,
      );
      return this.store.takeControl(active.sessionId);
    });
  }

  async requestPower(session, body) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      this.requireInRange(active);
      if (!this.store.isWriter(active.sessionId)) {
        throw new WebSessionError(
          "read_only",
          "This browser terminal is view only. Take control before using power.",
          409,
        );
      }
      if (
        body?.action !== "power_on" &&
        body?.action !== "safe_boot" &&
        body?.action !== "shutdown"
      ) {
        throw new WebSessionError("input", "Invalid power action.");
      }
      if (this.pendingPowerRequests.size >= maximumPendingPowerRequests) {
        throw new WebSessionError(
          "busy",
          "Too many Web Terminal power requests are pending.",
          503,
        );
      }
      const requestId = `p${this.nextPowerRequest.toString(36).padStart(5, "0")}`;
      this.nextPowerRequest =
        this.nextPowerRequest === Number.MAX_SAFE_INTEGER
          ? 1
          : this.nextPowerRequest + 1;
      let resolvePower;
      let rejectPower;
      const completion = new Promise((resolve, reject) => {
        resolvePower = resolve;
        rejectPower = reject;
      });
      const timer = setTimeout(() => {
        this.pendingPowerRequests.delete(requestId);
        rejectPower(
          new WebSessionError(
            "timeout",
            "Computer power request timed out.",
            504,
          ),
        );
      }, powerTimeoutMs);
      timer.unref();
      this.pendingPowerRequests.set(requestId, {
        reject: rejectPower,
        resolve: resolvePower,
        sessionId: active.sessionId,
        timer,
      });
      try {
        await this.bds.runWebRelay(
          `scriptevent computer_system:web-power ${active.sessionId} ${requestId} ${body.action}`,
        );
      } catch (error) {
        clearTimeout(timer);
        this.pendingPowerRequests.delete(requestId);
        throw error;
      }
      return completion;
    });
  }

  failPendingPowerRequests(detail) {
    for (const pending of this.pendingPowerRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new WebSessionError("closed", detail, 503));
    }
    this.pendingPowerRequests.clear();
  }

  async requestFloppyEject(session) {
    return this.serializeComputerOperation(session.computerId, async () => {
      const active = this.store.authenticate(session.token);
      this.requireInRange(active);
      if (!this.store.isWriter(active.sessionId)) {
        throw new WebSessionError(
          "read_only",
          "This browser terminal is view only. Take control before ejecting a floppy disk.",
          409,
        );
      }
      if (this.pendingEjectRequests.size >= maximumPendingEjectRequests) {
        throw new WebSessionError(
          "busy",
          "Too many Web Terminal floppy eject requests are pending.",
          503,
        );
      }
      const requestId = `e${this.nextEjectRequest.toString(36).padStart(5, "0")}`;
      this.nextEjectRequest =
        this.nextEjectRequest === Number.MAX_SAFE_INTEGER
          ? 1
          : this.nextEjectRequest + 1;
      let resolveEject;
      let rejectEject;
      const completion = new Promise((resolve, reject) => {
        resolveEject = resolve;
        rejectEject = reject;
      });
      const timer = setTimeout(() => {
        this.pendingEjectRequests.delete(requestId);
        rejectEject(
          new WebSessionError(
            "timeout",
            "Floppy eject request timed out.",
            504,
          ),
        );
      }, ejectTimeoutMs);
      timer.unref();
      this.pendingEjectRequests.set(requestId, {
        reject: rejectEject,
        resolve: resolveEject,
        sessionId: active.sessionId,
        timer,
      });
      try {
        await this.bds.runWebRelay(
          `scriptevent computer_system:web-floppy-eject ${active.sessionId} ${requestId}`,
        );
      } catch (error) {
        clearTimeout(timer);
        this.pendingEjectRequests.delete(requestId);
        throw error;
      }
      return completion;
    });
  }

  failPendingEjectRequests(detail) {
    for (const pending of this.pendingEjectRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(new WebSessionError("closed", detail, 503));
    }
    this.pendingEjectRequests.clear();
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

  requireHandoffAttemptAllowed(client) {
    this.pruneHandoffFailures();
    const failures = this.handoffFailures.get(client);
    if (
      failures !== undefined &&
      failures.count >= maximumHandoffFailuresPerWindow
    ) {
      const error = new WebSessionError(
        "handoff_rate_limit",
        "Too many invalid connection-code attempts. Try again later.",
        429,
      );
      error.retryAfterSeconds = Math.max(
        1,
        Math.ceil((failures.expiresAt - Date.now()) / 1_000),
      );
      throw error;
    }
  }

  async consumeHandoffCode(request, code) {
    const client = request.socket.remoteAddress ?? "unknown";
    this.requireHandoffAttemptAllowed(client);
    let consumed;
    try {
      consumed = this.store.consumeHandoff(code);
      const session = this.store.authenticate(consumed.token);
      const controlled = await this.takeControl(session);
      this.handoffFailures.delete(client);
      return { token: consumed.token, session: controlled };
    } catch (error) {
      if (consumed !== undefined) {
        this.store.restoreHandoff(consumed.session.sessionId);
      }
      if (
        error?.code !== "not_ready" &&
        error?.code !== "out_of_range" &&
        error?.code !== "handoff_required"
      ) {
        this.recordHandoffFailure(client);
      }
      throw error;
    }
  }

  reconnectCode(request, code) {
    const client = request.socket.remoteAddress ?? "unknown";
    this.requireHandoffAttemptAllowed(client);
    try {
      const reconnected = this.store.reconnect(code, {
        ignoreRange: this.debugIgnoreRange,
      });
      this.handoffFailures.delete(client);
      return reconnected;
    } catch (error) {
      if (
        error?.code !== "not_ready" &&
        error?.code !== "out_of_range" &&
        error?.code !== "handoff_required"
      ) {
        this.recordHandoffFailure(client);
      }
      throw error;
    }
  }

  requireInRange(session) {
    if (this.debugIgnoreRange) return;
    if (!this.store.isInRange(session.sessionId)) {
      throw new WebSessionError(
        "out_of_range",
        "Move within 3 blocks of the Computer to continue.",
        409,
      );
    }
  }

  recordHandoffFailure(client) {
    const now = Date.now();
    const existing = this.handoffFailures.get(client);
    if (existing === undefined || existing.expiresAt <= now) {
      if (this.handoffFailures.size >= maximumHandoffFailureClients) {
        this.pruneHandoffFailures(true);
      }
      this.handoffFailures.set(client, {
        count: 1,
        expiresAt: now + handoffFailureWindowMs,
      });
      return;
    }
    existing.count += 1;
  }

  pruneHandoffFailures(removeOldest = false) {
    const now = Date.now();
    for (const [client, failures] of this.handoffFailures) {
      if (failures.expiresAt <= now) this.handoffFailures.delete(client);
    }
    if (
      !removeOldest ||
      this.handoffFailures.size < maximumHandoffFailureClients
    ) {
      return;
    }
    const oldest = [...this.handoffFailures.entries()].sort(
      (left, right) => left[1].expiresAt - right[1].expiresAt,
    )[0];
    if (oldest !== undefined) this.handoffFailures.delete(oldest[0]);
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
    if (
      status === 429 &&
      Number.isSafeInteger(error?.retryAfterSeconds) &&
      error.retryAfterSeconds > 0
    ) {
      response.setHeader("Retry-After", String(error.retryAfterSeconds));
    }
    writeJson(response, status, {
      code: error instanceof WebSessionError ? error.code : "internal",
      error:
        error instanceof WebSessionError
          ? message(error)
          : "Internal companion error.",
    });
  }
}

export function createCoalescedEventWriter(response) {
  let blocked = false;
  let controlPending;
  let drainPending = false;
  let ended = false;
  let finalPending;
  let keepalivePending = false;
  let order = 0;
  let terminalPending;

  const enqueue = (event) => {
    if (event.type === "replaced") {
      finalPending = event;
      controlPending = undefined;
      terminalPending = undefined;
      keepalivePending = false;
      return;
    }
    if (finalPending !== undefined) return;
    if (event.type === "terminal") {
      terminalPending = { event, order: (order += 1) };
      keepalivePending = false;
      return;
    }
    if (event.type === "keepalive") {
      if (controlPending === undefined && terminalPending === undefined) {
        keepalivePending = true;
      }
      return;
    }
    controlPending = { event, order: (order += 1) };
    keepalivePending = false;
  };

  const takePending = () => {
    if (finalPending !== undefined) {
      const event = finalPending;
      finalPending = undefined;
      return event;
    }
    if (
      controlPending !== undefined &&
      (terminalPending === undefined ||
        controlPending.order < terminalPending.order)
    ) {
      const { event } = controlPending;
      controlPending = undefined;
      return event;
    }
    if (terminalPending !== undefined) {
      const { event } = terminalPending;
      terminalPending = undefined;
      return event;
    }
    if (keepalivePending) {
      keepalivePending = false;
      return { type: "keepalive" };
    }
    return undefined;
  };

  const onDrain = () => {
    drainPending = false;
    blocked = false;
    flush();
  };

  const writeNow = (event) => {
    const accepted = response.write(`${JSON.stringify(event)}\n`);
    if (event.type === "replaced") {
      ended = true;
      response.end();
      return;
    }
    if (!accepted) {
      blocked = true;
      if (!drainPending) {
        drainPending = true;
        response.once("drain", onDrain);
      }
    }
  };

  const flush = () => {
    while (!blocked && !ended) {
      const event = takePending();
      if (event === undefined) return;
      writeNow(event);
    }
  };

  return (event) => {
    if (ended) return;
    if (blocked) {
      enqueue(event);
      return;
    }
    writeNow(event);
  };
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

export function parseOptionalBooleanFlag(value, name) {
  if (value === undefined) return undefined;
  return parseBooleanFlag(value, name);
}

function requireBrowserInteractionSchema(request) {
  if (
    request.headers[browserInteractionSchemaHeader] === browserInteractionSchema
  )
    return;
  throw new WebSessionError(
    "interaction_protocol_mismatch",
    "This browser uses an incompatible Web Terminal interaction schema. Reload the page after restarting the companion.",
    426,
  );
}

function requireSessionTerminalInteraction(session) {
  const interaction = optionalSessionTerminalInteraction(session);
  if (interaction === undefined) {
    throw new WebSessionError(
      "terminal_not_ready",
      "The Computer has not published an interaction-ready terminal frame.",
      409,
    );
  }
  return interaction;
}

function optionalSessionTerminalInteraction(session) {
  if (session.terminal === null || session.terminal === undefined)
    return undefined;
  try {
    return requirePublishedTerminalInteraction(session.terminal);
  } catch {
    throw new WebSessionError(
      "interaction_protocol_mismatch",
      "The Computer published an incompatible terminal interaction schema.",
      426,
    );
  }
}

function requirePublishedTerminalInteraction(payload) {
  const terminal = payload?.terminal;
  if (
    terminal === null ||
    typeof terminal !== "object" ||
    Array.isArray(terminal) ||
    !Number.isSafeInteger(terminal.terminalRevision) ||
    terminal.terminalRevision < 0 ||
    !Number.isSafeInteger(terminal.replacementEpoch) ||
    terminal.replacementEpoch < 0
  ) {
    throw new Error("Invalid terminal frame revision metadata.");
  }
  const interaction = payload?.terminal?.interaction;
  if (
    interaction === null ||
    typeof interaction !== "object" ||
    Array.isArray(interaction) ||
    interaction.schema !== 2 ||
    !["keys", "line", "none"].includes(interaction.inputMode) ||
    !["block", "underline"].includes(interaction.cursorShape) ||
    !["cell", "none"].includes(interaction.pointer) ||
    !["dos-tui", "terminal"].includes(interaction.presentation) ||
    ![
      "busy",
      "cs-abi",
      "csasm",
      "edit",
      "less",
      "login",
      "more",
      "perl-source",
      "pwb",
      "python-repl",
      "qbasic",
      "secret",
      "shell",
      "unavailable",
      "vi-command",
      "vi-insert",
      "vi-normal",
      "vi-output",
    ].includes(interaction.context) ||
    typeof interaction.eof !== "boolean" ||
    typeof interaction.secretInput !== "boolean" ||
    !["abort-line", "cancel", "interrupt", "none", "terminal-key"].includes(
      interaction.ctrlCAction,
    ) ||
    !Number.isSafeInteger(interaction.interactionGeneration) ||
    interaction.interactionGeneration < 0 ||
    typeof interaction.history !== "boolean" ||
    (interaction.helpTopicId !== undefined &&
      !boundedInteractionText(interaction.helpTopicId, 64)) ||
    !Array.isArray(interaction.hints) ||
    interaction.hints.length > 5 ||
    interaction.hints.some(
      (hint) =>
        hint === null ||
        typeof hint !== "object" ||
        Array.isArray(hint) ||
        !boundedInteractionText(hint.key, 32) ||
        !boundedInteractionText(hint.label, 64),
    ) ||
    (interaction.pointer === "cell" &&
      (interaction.inputMode !== "keys" ||
        interaction.presentation !== "dos-tui")) ||
    (interaction.history &&
      (interaction.inputMode !== "line" || interaction.secretInput)) ||
    (interaction.secretInput &&
      interaction.inputMode !== "line" &&
      interaction.inputMode !== "none") ||
    (interaction.eof &&
      interaction.context !== "perl-source" &&
      interaction.context !== "python-repl") ||
    (interaction.ctrlCAction === "abort-line" &&
      (interaction.inputMode !== "line" || interaction.secretInput)) ||
    (interaction.ctrlCAction === "cancel" &&
      interaction.inputMode !== "line" &&
      interaction.inputMode !== "keys") ||
    (interaction.ctrlCAction === "terminal-key" &&
      interaction.inputMode !== "keys")
  ) {
    throw new Error("Invalid terminal interaction schema.");
  }
  return interaction;
}

function boundedInteractionText(value, maximumLength) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[\0\r\n]/u.test(value)
  );
}

function requireInteractionInput(interaction, kind) {
  const allowed =
    kind === "interrupt"
      ? interaction.ctrlCAction === "interrupt"
      : kind === "cancel"
        ? interaction.ctrlCAction === "cancel"
        : kind === "abort-line"
          ? interaction.ctrlCAction === "abort-line"
          : kind === "eof"
            ? interaction.eof === true
            : kind === "mouse"
              ? interaction.pointer === "cell"
              : kind === "keys"
                ? interaction.inputMode === "keys"
                : interaction.inputMode === "line";
  if (allowed) return;
  throw new WebSessionError(
    "input_mode_changed",
    "The terminal input mode changed before this input was admitted.",
    409,
  );
}

function requireInteractionGeneration(interaction, generation) {
  if (
    Number.isSafeInteger(generation) &&
    generation === interaction.interactionGeneration
  ) {
    return;
  }
  throw new WebSessionError(
    "input_mode_changed",
    "The terminal interaction changed before this input was admitted.",
    409,
  );
}

function retryableInputBusy(detail) {
  const error = new WebSessionError("input_busy", detail, 429);
  error.retryAfterSeconds = 1;
  return error;
}

function requireAcceptedInput(result) {
  if (result.outcome === "accepted") return { outcome: "accepted" };
  if (result.outcome === "missing") {
    throw new WebSessionError(
      "input_missing",
      "The Computer is no longer available.",
      410,
    );
  }
  if (result.outcome === "ignored") {
    const reason =
      result.reason === "not_running"
        ? "The Computer is not running."
        : result.reason === "stopping"
          ? "The Computer is stopping."
          : result.reason === "secret_input"
            ? "MCP debug input is disabled while secret input is active."
            : "The Computer ignored terminal input.";
    throw new WebSessionError("input_ignored", reason, 409);
  }
  const failure = `${String(result.reason ?? "")} ${String(result.error ?? "")}`;
  if (
    /event (?:queue )?limit exceeded|queue (?:is )?full|capacity/iu.test(
      failure,
    )
  ) {
    throw retryableInputBusy("The terminal input queue is full. Retry later.");
  }
  throw new WebSessionError(
    "input_failed",
    "The Computer could not admit terminal input.",
    503,
  );
}

function requireTuiSessionIdentity(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
    throw new TypeError("TUI session options must be an object.");
  }
  if (
    typeof options.computerId !== "string" ||
    !computerIdPattern.test(options.computerId)
  ) {
    throw new Error("computerId must use the c-xxxxxx identity format.");
  }
  if (
    typeof options.sessionId !== "string" ||
    !/^[A-Za-z0-9_-]{12,32}$/u.test(options.sessionId)
  ) {
    throw new Error("An exact active Web Terminal session is required.");
  }
  return {
    computerId: options.computerId,
    sessionId: options.sessionId,
  };
}

function optionalBoolean(value, name) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be boolean.`);
  }
  return value;
}

function optionalTuiContains(value) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximumTuiContainsLength ||
    value.includes("\0")
  ) {
    throw new Error(
      `contains must contain 1 to ${String(maximumTuiContainsLength)} literal characters.`,
    );
  }
  return value;
}

function optionalTuiVersion(value) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("afterVersion must be a non-negative integer.");
  }
  return value;
}

function serializeTuiScreen(session, includeColors) {
  const payload = session.terminal;
  if (payload === null) return undefined;
  if (
    payload === null ||
    typeof payload !== "object" ||
    payload.sessionId !== session.sessionId ||
    payload.computerId !== session.computerId ||
    typeof payload.label !== "string" ||
    typeof payload.lifecycle !== "string" ||
    !Number.isSafeInteger(session.terminalVersion) ||
    session.terminalVersion < 1
  ) {
    throw new Error("The Web Terminal published an invalid TUI envelope.");
  }
  const terminal = payload.terminal;
  if (
    terminal === null ||
    typeof terminal !== "object" ||
    terminal.schema !== 1 ||
    !Number.isSafeInteger(terminal.width) ||
    terminal.width < 1 ||
    terminal.width > maximumTuiWidth ||
    !Number.isSafeInteger(terminal.height) ||
    terminal.height < 1 ||
    terminal.height > maximumTuiHeight ||
    !Array.isArray(terminal.rows) ||
    terminal.rows.length !== terminal.height ||
    !Array.isArray(terminal.foreground) ||
    terminal.foreground.length !== terminal.height ||
    !Array.isArray(terminal.background) ||
    terminal.background.length !== terminal.height ||
    requirePublishedTerminalInteraction(payload).schema !== 2
  ) {
    throw new Error("The Web Terminal published an invalid text surface.");
  }
  if (payload.terminal.interaction.secretInput) {
    throw new Error(
      "TUI inspection is unavailable while secret input is active.",
    );
  }
  const rows = terminal.rows.map((row) => {
    if (typeof row !== "string" || [...row].length !== terminal.width) {
      throw new Error("The Web Terminal published an invalid text row.");
    }
    return row;
  });
  validateTuiColors(terminal.foreground, terminal.width, "foreground");
  validateTuiColors(terminal.background, terminal.width, "background");
  const cursor = terminal.cursor;
  if (
    cursor === null ||
    typeof cursor !== "object" ||
    !Number.isSafeInteger(cursor.x) ||
    cursor.x < 1 ||
    cursor.x > terminal.width + 1 ||
    !Number.isSafeInteger(cursor.y) ||
    cursor.y < 1 ||
    cursor.y > terminal.height ||
    typeof cursor.blink !== "boolean"
  ) {
    throw new Error("The Web Terminal published an invalid text cursor.");
  }
  const surface = {
    kind: "text",
    schema: 1,
    width: terminal.width,
    height: terminal.height,
    rows,
    cursor: { blink: cursor.blink, x: cursor.x, y: cursor.y },
    secretInput: false,
  };
  if (includeColors) {
    surface.foreground = terminal.foreground.map((row) => [...row]);
    surface.background = terminal.background.map((row) => [...row]);
  }
  return {
    schema: 1,
    computerId: session.computerId,
    sessionId: session.sessionId,
    principalKind: session.principalKind,
    mode: session.mode,
    access: session.access,
    state: session.state,
    label: payload.label,
    lifecycle: payload.lifecycle,
    snapshotVersion: session.terminalVersion,
    surface,
  };
}

function validateTuiColors(grid, width, name) {
  for (const row of grid) {
    if (
      !Array.isArray(row) ||
      row.length !== width ||
      row.some(
        (color) => !Number.isSafeInteger(color) || color < 0 || color > 15,
      )
    ) {
      throw new Error(`The Web Terminal published an invalid ${name} row.`);
    }
  }
}

function matchesTuiWait(screen, pending) {
  if (
    pending.afterVersion !== undefined &&
    screen.snapshotVersion <= pending.afterVersion
  ) {
    return false;
  }
  if (pending.contains === undefined) return true;
  if (pending.contains.includes("\n")) {
    return screen.surface.rows.join("\n").includes(pending.contains);
  }
  return screen.surface.rows.some((row) => row.includes(pending.contains));
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

function requireSameOrigin(request, allowedOrigins) {
  if (!allowedOrigins.has("*") && !allowedOrigins.has(request.headers.origin)) {
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

export function selectLanIpv4(interfaces) {
  const candidates = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (
        address.internal ||
        (address.family !== "IPv4" && address.family !== 4) ||
        address.address.startsWith("169.254.")
      ) {
        continue;
      }
      const virtual =
        /cloudflare|docker|hyper-v|loopback|tunnel|vethernet|vmware|wsl/iu.test(
          name,
        );
      const physical = /ethernet|wi-?fi|wireless|wlan/iu.test(name);
      candidates.push({
        address: address.address,
        score: virtual ? 20 : physical ? 0 : 10,
      });
    }
  }
  candidates.sort(
    (left, right) =>
      left.score - right.score || left.address.localeCompare(right.address),
  );
  const selected = candidates[0]?.address;
  if (selected === undefined) {
    throw new Error(
      "No LAN IPv4 address is available. Set WEB_COMPANION_PUBLIC_HOST explicitly.",
    );
  }
  return selected;
}

export function isPublishedAddressLocal(publishedAddress, interfaces) {
  const published = canonicalIpAddress(publishedAddress);
  if (published === undefined || published === "0.0.0.0" || published === "::")
    return false;
  if (published.startsWith("127.") || published === "::1") return true;
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (canonicalIpAddress(address.address) === published) return true;
    }
  }
  return false;
}

function canonicalIpAddress(value) {
  const unwrapped = String(value)
    .toLowerCase()
    .replace(/^\[|\]$/gu, "")
    .split("%", 1)[0];
  const family = isIP(unwrapped);
  if (family === 0) return undefined;
  if (family === 4) return unwrapped;
  return new URL(`http://[${unwrapped}]/`).hostname.slice(1, -1);
}

export function normalizePublicOrigin(value) {
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

export function formatHttpOrigin(host, port) {
  const suffix = port === 80 ? "" : `:${String(port)}`;
  return `http://${formatHost(host)}${suffix}`;
}

function normalizeAllowedOrigins(value) {
  if (value === undefined || value === null || value === "") return new Set();
  if (typeof value !== "string") {
    throw new TypeError("WEB_COMPANION_ALLOWED_ORIGINS must be a string.");
  }
  const origins = new Set();
  for (const candidate of value.split(",").map((entry) => entry.trim())) {
    if (candidate.length === 0) continue;
    if (candidate === "*") return new Set(["*"]);
    origins.add(normalizePublicOrigin(candidate));
  }
  return origins;
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
