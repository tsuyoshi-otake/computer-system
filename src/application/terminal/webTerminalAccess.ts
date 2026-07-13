import { requireComputerId } from "../../domain/computer/identity.js";

export type WebTerminalAccessMode = "viewer" | "writer";

export interface WebTerminalAccessSession {
  readonly computerId: string;
  readonly mode: WebTerminalAccessMode;
  readonly sessionId: string;
}

export type WebTerminalAttachResult = {
  readonly demotedSessionId?: string;
  readonly session: WebTerminalAccessSession;
};

export type WebTerminalTakeoverResult =
  | { readonly outcome: "missing" }
  | {
      readonly demotedSessionId?: string;
      readonly outcome: "transferred" | "unchanged";
      readonly session: WebTerminalAccessSession;
    };

export type WebTerminalDetachResult =
  | { readonly outcome: "missing" }
  | {
      readonly outcome: "detached";
      readonly session: WebTerminalAccessSession;
      readonly wasLast: boolean;
    };

export class WebTerminalAccessRegistry {
  private readonly sessions = new Map<string, WebTerminalAccessSession>();
  private readonly sessionsByComputer = new Map<string, Set<string>>();
  private readonly writersByComputer = new Map<string, string>();

  constructor(private readonly maximumSessions = 32) {
    if (!Number.isSafeInteger(maximumSessions) || maximumSessions <= 0) {
      throw new RangeError("Web terminal session capacity must be positive");
    }
  }

  attach(
    sessionId: string,
    computerId: string,
    mode: WebTerminalAccessMode,
  ): WebTerminalAttachResult {
    validateSessionId(sessionId);
    requireComputerId(computerId);
    if (this.sessions.has(sessionId)) {
      throw new Error(`Web terminal session ${sessionId} is already attached`);
    }
    if (this.sessions.size >= this.maximumSessions) {
      throw new Error("Web terminal session capacity has been reached");
    }

    const attached =
      this.sessionsByComputer.get(computerId) ?? new Set<string>();
    attached.add(sessionId);
    this.sessionsByComputer.set(computerId, attached);
    const session = { sessionId, computerId, mode };
    this.sessions.set(sessionId, session);
    const demotedSessionId =
      mode === "writer" ? this.replaceWriter(computerId, sessionId) : undefined;
    return { session, demotedSessionId };
  }

  get(sessionId: string): WebTerminalAccessSession | undefined {
    return this.sessions.get(sessionId);
  }

  canWrite(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    return (
      session !== undefined &&
      this.writersByComputer.get(session.computerId) === sessionId
    );
  }

  takeControl(sessionId: string): WebTerminalTakeoverResult {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return { outcome: "missing" };
    if (this.writersByComputer.get(session.computerId) === sessionId) {
      return { outcome: "unchanged", session };
    }
    const demotedSessionId = this.replaceWriter(session.computerId, sessionId);
    return {
      outcome: "transferred",
      session: this.sessions.get(sessionId)!,
      demotedSessionId,
    };
  }

  detach(sessionId: string): WebTerminalDetachResult {
    const session = this.sessions.get(sessionId);
    if (session === undefined) return { outcome: "missing" };
    this.sessions.delete(sessionId);
    if (this.writersByComputer.get(session.computerId) === sessionId) {
      this.writersByComputer.delete(session.computerId);
    }
    const attached = this.sessionsByComputer.get(session.computerId);
    attached?.delete(sessionId);
    const wasLast = attached === undefined || attached.size === 0;
    if (wasLast) this.sessionsByComputer.delete(session.computerId);
    return { outcome: "detached", session, wasLast };
  }

  private replaceWriter(
    computerId: string,
    sessionId: string,
  ): string | undefined {
    const previousId = this.writersByComputer.get(computerId);
    if (previousId !== undefined && previousId !== sessionId) {
      const previous = this.sessions.get(previousId);
      if (previous !== undefined) {
        this.sessions.set(previousId, { ...previous, mode: "viewer" });
      }
    }
    const session = this.sessions.get(sessionId)!;
    this.sessions.set(sessionId, { ...session, mode: "writer" });
    this.writersByComputer.set(computerId, sessionId);
    return previousId === sessionId ? undefined : previousId;
  }
}

function validateSessionId(sessionId: string): void {
  if (!/^[A-Za-z0-9_-]{12,32}$/u.test(sessionId)) {
    throw new Error("Invalid Web terminal session ID");
  }
}
