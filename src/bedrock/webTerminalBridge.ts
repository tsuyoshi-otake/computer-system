import { system, world, type Player } from "@minecraft/server";

import type { ComputerRecord } from "../domain/computer/computer.js";
import {
  WebTerminalAccessRegistry,
  type WebTerminalAccessMode,
} from "../application/terminal/webTerminalAccess.js";
import { computerHost } from "./computerHost.js";
import { openComputerTerminal } from "./computerTerminal.js";

const requestMarker = "CS_WEB_SESSION_REQUEST ";
const snapshotMarker = "CS_WEB_TERMINAL ";
const finalMarker = "CS_WEB_SESSION_FINAL ";
const requestLifetimeTicks = 200;
const sessionLifetimeTicks = 36_000;
const maxPendingRequests = 32;
const maxActiveSessions = 32;
const maxSnapshotsPerPass = 2;

interface PendingRequest {
  readonly computerId: string;
  readonly expiresAtTick: number;
  readonly player: Player;
  readonly requestId: string;
}

interface ActiveSession {
  readonly computerId: string;
  readonly expiresAtTick: number;
  readonly playerId: string;
  readonly sessionId: string;
  lastSnapshot?: string;
}

const pendingRequests = new Map<string, PendingRequest>();
const activeSessions = new Map<string, ActiveSession>();
const terminalAccess = new WebTerminalAccessRegistry(maxActiveSessions);
let nextRequest = 1;
let snapshotCursor = 0;
let started = false;

export function requestWebComputerTerminal(
  player: Player,
  record: ComputerRecord,
): void {
  pruneExpiredRequests();
  if (pendingRequests.size >= maxPendingRequests) {
    player.sendMessage(
      "Browser terminal is busy. Opening the in-game terminal instead.",
    );
    openFallback(player, record);
    return;
  }

  if (record.lifecycle.state.kind === "off") {
    computerHost.runtime.powerOn(record.computerId);
  }
  const requestId = `r${system.currentTick.toString(36)}-${nextRequest.toString(36)}`;
  nextRequest = nextRequest === Number.MAX_SAFE_INTEGER ? 1 : nextRequest + 1;
  const request: PendingRequest = {
    computerId: record.computerId,
    expiresAtTick: system.currentTick + requestLifetimeTicks,
    player,
    requestId,
  };
  pendingRequests.set(requestId, request);
  player.sendMessage("Preparing a secure browser terminal link…");
  console.warn(
    `${requestMarker}${JSON.stringify({
      requestId,
      playerId: player.id,
      computerId: record.computerId,
    })}`,
  );

  system.runTimeout((): void => {
    const pending = pendingRequests.get(requestId);
    if (pending === undefined || pending.expiresAtTick > system.currentTick) {
      return;
    }
    pendingRequests.delete(requestId);
    if (!pending.player.isValid) return;
    pending.player.sendMessage(
      "Browser companion did not respond. Opening the in-game terminal.",
    );
    openFallback(pending.player, record);
  }, requestLifetimeTicks + 1);
}

export function handleWebTerminalScriptEvent(
  id: string,
  message: string,
): boolean {
  switch (id) {
    case "computer_system:web-response":
      handleResponse(message);
      return true;
    case "computer_system:web-input":
      handleInput(message);
      return true;
    case "computer_system:web-interrupt":
      handleInterrupt(message);
      return true;
    case "computer_system:web-take-control":
      handleTakeControl(message);
      return true;
    case "computer_system:web-close":
      handleClose(message);
      return true;
    default:
      return false;
  }
}

export function startWebTerminalBridge(): void {
  if (started) return;
  started = true;
  system.runInterval(emitChangedSnapshots, 5);
  system.runInterval(pruneExpiredSessions, 100);
  world.afterEvents.playerLeave.subscribe(({ playerId }): void => {
    for (const session of [...activeSessions.values()]) {
      if (session.playerId === playerId)
        finalizeSession(session, "disconnected");
    }
    for (const request of [...pendingRequests.values()]) {
      if (request.player.id === playerId)
        pendingRequests.delete(request.requestId);
    }
  });
}

function handleResponse(message: string): void {
  const match =
    /^(r[a-z0-9]+-[a-z0-9]+) ([A-Za-z0-9_-]{12,32}) (writer|viewer) (https?:\/\/[^\s]{1,180})$/u.exec(
      message,
    );
  if (match === null) return;
  const [, requestId = "", sessionId = "", mode = "", url = ""] = match;
  const request = pendingRequests.get(requestId);
  if (request === undefined) {
    rejectSession(sessionId, "request_missing");
    return;
  }
  pendingRequests.delete(requestId);
  if (!request.player.isValid || request.expiresAtTick <= system.currentTick) {
    rejectSession(sessionId, "request_expired");
    return;
  }

  pruneExpiredSessions();
  if (activeSessions.size >= maxActiveSessions) {
    request.player.sendMessage(
      "Browser terminal capacity was reached. Opening the in-game terminal.",
    );
    const record = computerHost.get(request.computerId);
    if (record !== undefined) openFallback(request.player, record);
    rejectSession(sessionId, "capacity");
    return;
  }

  const session: ActiveSession = {
    computerId: request.computerId,
    expiresAtTick: system.currentTick + sessionLifetimeTicks,
    playerId: request.player.id,
    sessionId,
  };
  try {
    terminalAccess.attach(
      sessionId,
      request.computerId,
      mode as WebTerminalAccessMode,
    );
  } catch {
    request.player.sendMessage(
      "Browser terminal session could not be attached. Opening the in-game terminal.",
    );
    const record = computerHost.get(request.computerId);
    if (record !== undefined) openFallback(request.player, record);
    rejectSession(sessionId, "attach_failed");
    return;
  }
  activeSessions.set(sessionId, session);
  request.player.sendMessage(
    "Open Computer System Web Terminal (valid for 60s):",
  );
  request.player.sendMessage(url);
  emitSnapshot(session, true);
}

function handleInput(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32}) line ([^\s]{0,180})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session === undefined || !terminalAccess.canWrite(session.sessionId))
    return;
  let line: string;
  try {
    line = decodeURIComponent(match[2] ?? "");
  } catch {
    return;
  }
  if (line.includes("\0") || /[\r\n]/u.test(line) || line.length > 128) return;
  computerHost.runtime.queueEvent(session.computerId, "terminal_line", line);
}

function handleInterrupt(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session !== undefined && terminalAccess.canWrite(session.sessionId)) {
    computerHost.runtime.terminate(session.computerId);
  }
}

function handleTakeControl(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session !== undefined) terminalAccess.takeControl(session.sessionId);
}

function handleClose(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session !== undefined) finalizeSession(session, "browser_closed");
}

function requireActiveSession(sessionId: string): ActiveSession | undefined {
  const session = activeSessions.get(sessionId);
  if (session === undefined) return undefined;
  if (session.expiresAtTick <= system.currentTick) {
    finalizeSession(session, "expired");
    return undefined;
  }
  return session;
}

function emitChangedSnapshots(): void {
  const sessions = [...activeSessions.values()];
  if (sessions.length === 0) {
    snapshotCursor = 0;
    return;
  }
  const count = Math.min(maxSnapshotsPerPass, sessions.length);
  for (let offset = 0; offset < count; offset += 1) {
    const index = (snapshotCursor + offset) % sessions.length;
    const session = sessions[index];
    if (session !== undefined) emitSnapshot(session, false);
  }
  snapshotCursor = (snapshotCursor + count) % sessions.length;
}

function emitSnapshot(session: ActiveSession, force: boolean): void {
  const record = computerHost.get(session.computerId);
  if (record === undefined) {
    finalizeSession(session, "computer_missing");
    return;
  }
  const serialized = JSON.stringify({
    sessionId: session.sessionId,
    computerId: session.computerId,
    label: record.label ?? record.computerId,
    lifecycle: record.lifecycle.state.kind,
    terminal: record.terminal.snapshot(),
  });
  if (!force && session.lastSnapshot === serialized) return;
  session.lastSnapshot = serialized;
  console.warn(`${snapshotMarker}${serialized}`);
}

function pruneExpiredRequests(): void {
  for (const request of pendingRequests.values()) {
    if (request.expiresAtTick <= system.currentTick) {
      pendingRequests.delete(request.requestId);
    }
  }
}

function pruneExpiredSessions(): void {
  for (const session of activeSessions.values()) {
    if (session.expiresAtTick <= system.currentTick) {
      finalizeSession(session, "expired");
    }
  }
}

function finalizeSession(session: ActiveSession, reason: string): void {
  if (!activeSessions.delete(session.sessionId)) return;
  const detached = terminalAccess.detach(session.sessionId);
  if (detached.outcome === "detached" && detached.wasLast) {
    computerHost.runtime.queueEvent(
      session.computerId,
      "terminal_closed",
      reason,
      "web",
    );
  }
  console.warn(
    `${finalMarker}${JSON.stringify({ sessionId: session.sessionId, reason })}`,
  );
}

function rejectSession(sessionId: string, reason: string): void {
  console.warn(`${finalMarker}${JSON.stringify({ sessionId, reason })}`);
}

function openFallback(player: Player, record: ComputerRecord): void {
  void openComputerTerminal(player, record).catch((error: unknown) => {
    if (player.isValid) {
      player.sendMessage(
        `In-game terminal failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}
