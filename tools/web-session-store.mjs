import { randomBytes } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]+$/u;
const handoffPattern = /^[0-9]{4}$/u;

export class WebSessionError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "WebSessionError";
    this.code = code;
    this.status = status;
  }
}

export class WebSessionStore {
  constructor(options = {}) {
    this.clock = options.clock ?? Date.now;
    this.random = options.random ?? randomBytes;
    this.handoffTtlMs = positiveInteger(options.handoffTtlMs ?? 120_000);
    this.sessionTtlMs = positiveInteger(options.sessionTtlMs ?? 30 * 60_000);
    this.maxSessions = positiveInteger(options.maxSessions ?? 32);
    this.maxConnectionsPerSession = positiveInteger(
      options.maxConnectionsPerSession ?? 2,
    );
    this.finalizedRetentionMs = positiveInteger(
      options.finalizedRetentionMs ?? 5 * 60_000,
    );
    this.sessionsById = new Map();
    this.sessionsByToken = new Map();
    this.sessionsByComputer = new Map();
    this.sessionsByCode = new Map();
    this.writersByComputer = new Map();
    this.handoffs = new Map();
    this.bedrockClosures = [];
  }

  issue(identity) {
    const prepared = this.prepare(identity);
    return this.accept(prepared.sessionId, "writer");
  }

  prepare(identity) {
    validateIdentity(identity);
    this.expire();
    const now = this.clock();
    const handoffCode = permanentComputerCode(identity.computerId);
    const codeOwner = this.sessionsByCode.get(handoffCode);
    if (
      codeOwner !== undefined &&
      isActive(codeOwner) &&
      codeOwner.computerId !== identity.computerId
    ) {
      throw new WebSessionError(
        "code_collision",
        "Another active Computer has the same four-digit code.",
        409,
      );
    }
    const conflicting = this.handoffs.get(handoffCode);
    if (conflicting !== undefined) {
      if (conflicting.computerId !== identity.computerId) {
        throw new WebSessionError(
          "code_collision",
          "Another Computer with the same four-digit code is awaiting connection.",
          409,
        );
      }
    }
    const replacing =
      conflicting !== undefined && isActive(conflicting) ? 1 : 0;
    if (this.activeCount() - replacing >= this.maxSessions) {
      throw new WebSessionError(
        "capacity",
        "Browser terminal capacity has been reached.",
        503,
      );
    }
    const sessionId = this.uniqueValue(12, this.sessionsById);
    const token = this.uniqueValue(32, this.sessionsByToken);
    const session = {
      sessionId,
      token,
      handoffCode,
      requestId: identity.requestId,
      playerId: identity.playerId,
      principalKind: identity.principalKind === "debug" ? "debug" : "player",
      computerId: identity.computerId,
      mode: "viewer",
      access: "in_range",
      state: "pending",
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      handoffExpiresAt: now + this.handoffTtlMs,
      terminal: null,
      terminalVersion: 0,
      listeners: new Set(),
      observers: new Set(),
      finalReason: null,
    };
    if (conflicting !== undefined) {
      this.finalize(conflicting, "closed", "handoff_superseded", true);
    }
    const attached = this.sessionsByComputer.get(identity.computerId);
    this.sessionsById.set(session.sessionId, session);
    this.sessionsByToken.set(session.token, session);
    if (attached === undefined) {
      this.sessionsByComputer.set(
        identity.computerId,
        new Set([session.sessionId]),
      );
    } else {
      attached.add(session.sessionId);
    }
    this.handoffs.set(session.handoffCode, session);
    return {
      ...this.publicSession(session),
      handoffCode: session.handoffCode,
      handoffExpiresAt: session.handoffExpiresAt,
    };
  }

  accept(sessionId, mode = "viewer") {
    if (mode !== "viewer" && mode !== "writer") {
      throw new WebSessionError("mode", "Invalid browser terminal mode.");
    }
    const session = this.sessionsById.get(sessionId);
    if (session === undefined || !isActive(session)) {
      throw new WebSessionError(
        "gone",
        "The browser terminal session is no longer active.",
        410,
      );
    }
    if (session.state === "pending") {
      if (this.handoffs.get(session.handoffCode) !== session) {
        throw new WebSessionError(
          "superseded",
          "The browser terminal request was superseded.",
          409,
        );
      }
      session.state = "issued";
    }
    const accepted =
      mode === "writer"
        ? this.takeControl(session.sessionId)
        : this.publicSession(session);
    return {
      ...accepted,
      handoffCode: session.handoffCode,
      handoffExpiresAt: session.handoffExpiresAt,
    };
  }

  consumeHandoff(code) {
    if (typeof code !== "string" || !handoffPattern.test(code)) {
      throw unauthorized();
    }
    const session = this.handoffs.get(code);
    if (session === undefined) throw unauthorized();
    if (session.state === "pending") {
      throw new WebSessionError(
        "not_ready",
        "The browser terminal is not ready yet.",
        409,
      );
    }
    if (
      session.state === "closed" ||
      session.state === "expired" ||
      session.handoffExpiresAt <= this.clock()
    ) {
      this.finalize(session, "expired", "handoff_expired", true);
      throw new WebSessionError("expired", "The link has expired.", 410);
    }
    if (this.handoffs.get(code) !== session) throw unauthorized();
    this.handoffs.delete(code);
    return { token: session.token, session: this.publicSession(session) };
  }

  authenticate(token) {
    if (typeof token !== "string" || !tokenPattern.test(token)) {
      throw unauthorized();
    }
    const session = this.sessionsByToken.get(token);
    if (session === undefined) throw unauthorized();
    if (session.expiresAt <= this.clock()) {
      this.finalize(session, "expired", "session_expired", true);
    }
    if (session.state === "pending") throw unauthorized();
    if (session.state === "expired" || session.state === "closed") {
      throw new WebSessionError(
        "gone",
        "The browser terminal session is no longer active.",
        410,
      );
    }
    return session;
  }

  reconnect(code, { ignoreRange = false } = {}) {
    if (typeof code !== "string" || !handoffPattern.test(code)) {
      throw unauthorized();
    }
    const handoff = this.handoffs.get(code);
    if (handoff !== undefined && isActive(handoff)) {
      throw new WebSessionError(
        handoff.state === "pending" ? "not_ready" : "handoff_required",
        handoff.state === "pending"
          ? "The browser terminal is not ready yet."
          : "Open the new browser terminal link before reconnecting.",
        409,
      );
    }
    const session = this.sessionsByCode.get(code);
    if (session === undefined || !isActive(session)) throw unauthorized();
    if (ignoreRange) this.updateAccess(session.sessionId, "in_range");
    if (session.access !== "in_range") {
      throw new WebSessionError(
        "out_of_range",
        "Move within 3 blocks of the Computer to reconnect.",
        409,
      );
    }
    const nextToken = this.uniqueValue(32, this.sessionsByToken);
    this.emit(session, {
      type: "replaced",
      session: this.publicSession(session),
    });
    session.listeners.clear();
    this.sessionsByToken.delete(session.token);
    session.token = nextToken;
    this.sessionsByToken.set(nextToken, session);
    return { token: nextToken, session: this.publicSession(session) };
  }

  subscribe(token, listener) {
    const session = this.authenticate(token);
    if (session.listeners.size >= this.maxConnectionsPerSession) {
      throw new WebSessionError(
        "connections",
        "Too many browser connections are open for this terminal.",
        429,
      );
    }
    session.listeners.add(listener);
    session.state = "connected";
    let active = true;
    return {
      session: this.publicSession(session),
      unsubscribe: () => {
        if (!active) return;
        active = false;
        session.listeners.delete(listener);
      },
    };
  }

  observe(sessionId, listener) {
    if (typeof listener !== "function") {
      throw new TypeError("A terminal session observer must be a function.");
    }
    const session = this.sessionsById.get(sessionId);
    if (session === undefined || !isActive(session)) {
      throw new WebSessionError(
        "gone",
        "The browser terminal session is no longer active.",
        410,
      );
    }
    session.observers.add(listener);
    let active = true;
    return {
      session: this.publicSession(session),
      unsubscribe: () => {
        if (!active) return;
        active = false;
        session.observers.delete(listener);
      },
    };
  }

  updateTerminal(sessionId, payload) {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined || !isActive(session)) return false;
    session.terminalVersion += 1;
    session.terminal = payload;
    this.emit(session, {
      type: "terminal",
      terminal: payload,
      session: this.publicSession(session),
    });
    return true;
  }

  updateAccess(sessionId, access) {
    const session = this.sessionsById.get(sessionId);
    if (
      session === undefined ||
      !isActive(session) ||
      (access !== "in_range" && access !== "out_of_range")
    ) {
      return false;
    }
    if (session.access === access) return true;
    session.access = access;
    this.emit(session, {
      type: "access",
      session: this.publicSession(session),
    });
    return true;
  }

  isWriter(sessionId) {
    const session = this.sessionsById.get(sessionId);
    return (
      session !== undefined && isActive(session) && session.mode === "writer"
    );
  }

  isInRange(sessionId) {
    const session = this.sessionsById.get(sessionId);
    return (
      session !== undefined &&
      isActive(session) &&
      session.access === "in_range"
    );
  }

  isHandoffCurrent(sessionId) {
    const session = this.sessionsById.get(sessionId);
    return (
      session !== undefined &&
      (session.state === "issued" || session.state === "connected") &&
      this.handoffs.get(session.handoffCode) === session
    );
  }

  restoreHandoff(sessionId) {
    const session = this.sessionsById.get(sessionId);
    if (
      session === undefined ||
      !isActive(session) ||
      session.state === "pending" ||
      session.handoffExpiresAt <= this.clock() ||
      this.handoffs.has(session.handoffCode)
    ) {
      return false;
    }
    this.handoffs.set(session.handoffCode, session);
    return true;
  }

  takeControl(sessionId) {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined || !isActive(session)) {
      throw new WebSessionError(
        "gone",
        "The browser terminal session is no longer active.",
        410,
      );
    }
    if (session.state === "pending") {
      throw new WebSessionError(
        "not_ready",
        "The browser terminal is not ready yet.",
        409,
      );
    }
    const previousId = this.writersByComputer.get(session.computerId);
    if (previousId === sessionId) return this.publicSession(session);
    const previous =
      previousId === undefined ? undefined : this.sessionsById.get(previousId);
    if (previous !== undefined && isActive(previous)) {
      previous.mode = "viewer";
      this.emit(previous, {
        type: "state",
        session: this.publicSession(previous),
      });
    }
    session.mode = "writer";
    this.writersByComputer.set(session.computerId, sessionId);
    this.sessionsByCode.set(session.handoffCode, session);
    this.emit(session, { type: "state", session: this.publicSession(session) });
    return this.publicSession(session);
  }

  close(sessionId, reason = "closed", { relayToBedrock = false } = {}) {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined || !isActive(session)) return false;
    this.finalize(session, "closed", reason, relayToBedrock);
    return true;
  }

  closeAll(reason = "companion_stopped") {
    for (const session of this.sessionsById.values()) {
      if (isActive(session)) this.finalize(session, "closed", reason);
    }
  }

  drainBedrockClosures() {
    return this.bedrockClosures.splice(0);
  }

  activeSessions() {
    return [...this.sessionsById.values()]
      .filter(isActive)
      .map((session) => this.publicSession(session));
  }

  expire() {
    const now = this.clock();
    let count = 0;
    for (const session of this.sessionsById.values()) {
      if (
        isActive(session) &&
        this.handoffs.get(session.handoffCode) === session &&
        session.handoffExpiresAt <= now
      ) {
        this.finalize(session, "expired", "handoff_expired", true);
        count += 1;
      } else if (isActive(session) && session.expiresAt <= now) {
        this.finalize(session, "expired", "session_expired", true);
        count += 1;
      }
      if (
        !isActive(session) &&
        session.finalizedAt + this.finalizedRetentionMs <= now
      ) {
        this.sessionsById.delete(session.sessionId);
        this.sessionsByToken.delete(session.token);
      }
    }
    return count;
  }

  publicSession(session, extra = {}) {
    return {
      sessionId: session.sessionId,
      requestId: session.requestId,
      computerId: session.computerId,
      principalKind: session.principalKind,
      mode: session.mode,
      access: session.access,
      connectionCode: session.handoffCode,
      state: session.state,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      terminal: session.terminal,
      terminalVersion: session.terminalVersion,
      finalReason: session.finalReason,
      ...extra,
    };
  }

  activeSession(sessionId) {
    const session = this.sessionsById.get(sessionId);
    return session !== undefined && isActive(session)
      ? this.publicSession(session)
      : undefined;
  }

  activeCount() {
    let count = 0;
    for (const session of this.sessionsById.values()) {
      if (isActive(session)) count += 1;
    }
    return count;
  }

  uniqueValue(bytes, index) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const value = this.random(bytes).toString("base64url");
      if (!index.has(value)) return value;
    }
    throw new WebSessionError(
      "entropy",
      "Unable to allocate a unique browser session identifier.",
      503,
    );
  }

  emit(session, event) {
    for (const listener of [...session.listeners]) {
      try {
        listener(event);
      } catch {
        session.listeners.delete(listener);
      }
    }
    for (const observer of [...session.observers]) {
      try {
        observer(event);
      } catch {
        session.observers.delete(observer);
      }
    }
  }

  finalize(session, state, reason, relayToBedrock = false) {
    if (!isActive(session)) return;
    const attached = this.sessionsByComputer.get(session.computerId);
    attached?.delete(session.sessionId);
    if (attached?.size === 0)
      this.sessionsByComputer.delete(session.computerId);
    if (this.writersByComputer.get(session.computerId) === session.sessionId) {
      this.writersByComputer.delete(session.computerId);
    }
    if (this.sessionsByCode.get(session.handoffCode) === session) {
      this.sessionsByCode.delete(session.handoffCode);
    }
    session.state = state;
    session.finalReason = reason;
    session.finalizedAt = this.clock();
    if (this.handoffs.get(session.handoffCode) === session) {
      this.handoffs.delete(session.handoffCode);
    }
    if (relayToBedrock) {
      this.bedrockClosures.push({
        computerId: session.computerId,
        reason,
        sessionId: session.sessionId,
      });
    }
    this.emit(session, { type: "state", session: this.publicSession(session) });
    session.listeners.clear();
    session.observers.clear();
  }
}

function isActive(session) {
  return (
    session.state === "pending" ||
    session.state === "issued" ||
    session.state === "connected"
  );
}

function validateIdentity(identity) {
  if (
    identity === null ||
    typeof identity !== "object" ||
    !/^r[a-z0-9]+-[a-z0-9]+$/u.test(identity.requestId ?? "") ||
    !/^(?:c-[0-9a-hjkmnp-tv-z]{6}|computer-[1-9][0-9]*)$/u.test(
      identity.computerId ?? "",
    ) ||
    typeof identity.playerId !== "string" ||
    identity.playerId.length === 0 ||
    identity.playerId.length > 128 ||
    (identity.principalKind !== undefined &&
      identity.principalKind !== "player" &&
      identity.principalKind !== "debug") ||
    (identity.principalKind === "debug" && identity.playerId !== "mcp-debug") ||
    (identity.principalKind !== "debug" && identity.playerId === "mcp-debug")
  ) {
    throw new WebSessionError("identity", "Invalid browser session identity.");
  }
}

function positiveInteger(value) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError("Web session limits must be positive integers.");
  }
  return value;
}

function unauthorized() {
  return new WebSessionError(
    "unauthorized",
    "A valid browser terminal token is required.",
    401,
  );
}

export function permanentComputerCode(computerId) {
  if (/^computer-[1-9][0-9]*$/u.test(computerId)) {
    const numeric = Number.parseInt(computerId.slice(9), 10);
    if (!Number.isSafeInteger(numeric)) {
      throw new WebSessionError(
        "identity",
        "Invalid browser session identity.",
      );
    }
    return (numeric % 10_000).toString().padStart(4, "0");
  }
  if (!/^c-[0-9a-hjkmnp-tv-z]{6}$/u.test(computerId)) {
    throw new WebSessionError("identity", "Invalid browser session identity.");
  }
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let numeric = 0;
  for (const character of computerId.slice(2)) {
    numeric = numeric * 32 + alphabet.indexOf(character);
  }
  return (numeric % 10_000).toString().padStart(4, "0");
}
