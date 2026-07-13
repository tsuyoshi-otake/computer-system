import { randomBytes } from "node:crypto";

const tokenPattern = /^[A-Za-z0-9_-]+$/u;

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
    this.handoffTtlMs = positiveInteger(options.handoffTtlMs ?? 60_000);
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
    this.handoffs = new Map();
  }

  issue(identity) {
    validateIdentity(identity);
    this.expire();
    if (this.activeCount() >= this.maxSessions) {
      throw new WebSessionError(
        "capacity",
        "Browser terminal capacity has been reached.",
        503,
      );
    }
    const now = this.clock();
    const session = {
      sessionId: this.uniqueValue(12, this.sessionsById),
      token: this.uniqueValue(32, this.sessionsByToken),
      handoffCode: this.uniqueValue(12, this.handoffs),
      requestId: identity.requestId,
      playerId: identity.playerId,
      computerId: identity.computerId,
      state: "issued",
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      handoffExpiresAt: now + this.handoffTtlMs,
      terminal: null,
      listeners: new Set(),
      finalReason: null,
    };
    this.sessionsById.set(session.sessionId, session);
    this.sessionsByToken.set(session.token, session);
    this.handoffs.set(session.handoffCode, session);
    return this.publicSession(session, { handoffCode: session.handoffCode });
  }

  consumeHandoff(code) {
    if (typeof code !== "string" || !tokenPattern.test(code)) {
      throw unauthorized();
    }
    const session = this.handoffs.get(code);
    this.handoffs.delete(code);
    if (session === undefined) throw unauthorized();
    if (
      session.state === "closed" ||
      session.state === "expired" ||
      session.handoffExpiresAt <= this.clock()
    ) {
      this.finalize(session, "expired", "handoff_expired");
      throw new WebSessionError("expired", "The link has expired.", 410);
    }
    return { token: session.token, session: this.publicSession(session) };
  }

  authenticate(token) {
    if (typeof token !== "string" || !tokenPattern.test(token)) {
      throw unauthorized();
    }
    const session = this.sessionsByToken.get(token);
    if (session === undefined) throw unauthorized();
    if (session.expiresAt <= this.clock()) {
      this.finalize(session, "expired", "session_expired");
    }
    if (session.state === "expired" || session.state === "closed") {
      throw new WebSessionError(
        "gone",
        "The browser terminal session is no longer active.",
        410,
      );
    }
    return session;
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

  updateTerminal(sessionId, payload) {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined || !isActive(session)) return false;
    session.terminal = payload;
    this.emit(session, {
      type: "terminal",
      terminal: payload,
      session: this.publicSession(session),
    });
    return true;
  }

  close(sessionId, reason = "closed") {
    const session = this.sessionsById.get(sessionId);
    if (session === undefined || !isActive(session)) return false;
    this.finalize(session, "closed", reason);
    return true;
  }

  closeAll(reason = "companion_stopped") {
    for (const session of this.sessionsById.values()) {
      if (isActive(session)) this.finalize(session, "closed", reason);
    }
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
      if (isActive(session) && session.expiresAt <= now) {
        this.finalize(session, "expired", "session_expired");
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
      state: session.state,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      terminal: session.terminal,
      finalReason: session.finalReason,
      ...extra,
    };
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
  }

  finalize(session, state, reason) {
    if (!isActive(session)) return;
    session.state = state;
    session.finalReason = reason;
    session.finalizedAt = this.clock();
    this.handoffs.delete(session.handoffCode);
    this.emit(session, { type: "state", session: this.publicSession(session) });
    session.listeners.clear();
  }
}

function isActive(session) {
  return session.state === "issued" || session.state === "connected";
}

function validateIdentity(identity) {
  if (
    identity === null ||
    typeof identity !== "object" ||
    !/^r[a-z0-9]+-[a-z0-9]+$/u.test(identity.requestId ?? "") ||
    !/^computer-[1-9][0-9]*$/u.test(identity.computerId ?? "") ||
    typeof identity.playerId !== "string" ||
    identity.playerId.length === 0 ||
    identity.playerId.length > 128
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
