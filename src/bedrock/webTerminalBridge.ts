import { system, world, type Block, type Player } from "@minecraft/server";

import type { ComputerRecord } from "../domain/computer/computer.js";
import type { RuntimeCommandResult } from "../application/computer/computerRuntime.js";
import { TerminalSnapshotScheduler } from "../application/terminal/terminalSnapshotScheduler.js";
import { FloppyAudioEventBroker } from "../application/terminal/floppyAudioEvents.js";
import {
  WebTerminalAccessRegistry,
  type WebTerminalAccessMode,
} from "../application/terminal/webTerminalAccess.js";
import { computerHost, setFloppyActivityHandler } from "./computerHost.js";
import { selectComputerTerminal } from "./computerTerminal.js";

const requestMarker = "CS_WEB_SESSION_REQUEST ";
const snapshotMarker = "CS_WEB_TERMINAL ";
const accessMarker = "CS_WEB_ACCESS ";
const completionMarker = "CS_WEB_COMPLETION ";
const powerMarker = "CS_WEB_POWER ";
const finalMarker = "CS_WEB_SESSION_FINAL ";
const requestLifetimeTicks = 200;
const sessionLifetimeTicks = 36_000;
const maxPendingRequests = 32;
const maxActiveSessions = 32;
const maxSnapshotsPerPass = 2;
const maxEagerSnapshotsPerPass = 4;
const maxEagerSnapshotAttempts = 3;

interface PendingRequest {
  readonly accessPoint?: WebTerminalAccessPoint;
  readonly computerId: string;
  readonly expiresAtTick: number;
  readonly player: Player;
  readonly requestId: string;
}

interface ActiveSession {
  readonly accessPoint?: WebTerminalAccessPoint;
  readonly computerId: string;
  readonly expiresAtTick: number;
  readonly playerId: string;
  readonly player: Player;
  readonly rangeCheckDisabledForDebug: boolean;
  readonly sessionId: string;
  access: "in_range" | "out_of_range";
  audioCursor: number;
  lastSnapshot?: string;
  mouseButtons: number;
  mouseSequence: number;
  mouseX: number;
  mouseY: number;
  pendingMouseMove?: string;
}

interface WebTerminalAccessPoint {
  readonly dimensionId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const pendingRequests = new Map<string, PendingRequest>();
const activeSessions = new Map<string, ActiveSession>();
const sessionsByComputer = new Map<string, Set<string>>();
const floppyAudio = new FloppyAudioEventBroker(256);
const terminalAccess = new WebTerminalAccessRegistry(maxActiveSessions);
const snapshotScheduler = new TerminalSnapshotScheduler({
  maximumEagerAttempts: maxEagerSnapshotAttempts,
  maximumEagerPerPass: maxEagerSnapshotsPerPass,
  maximumPeriodicPerPass: maxSnapshotsPerPass,
});
let nextRequest = 1;
let started = false;

export function requestWebComputerTerminal(
  player: Player,
  record: ComputerRecord,
  accessBlock?: Block,
): void {
  pruneExpiredRequests();
  if (pendingRequests.size >= maxPendingRequests) {
    player.sendMessage(
      "Web Terminal is busy. Try again after another request finishes.",
    );
    return;
  }

  selectComputerTerminal(player.id, record.computerId);
  if (record.lifecycle.state.kind === "off") {
    computerHost.runtime.powerOn(record.computerId);
  }
  const requestId = `r${system.currentTick.toString(36)}-${nextRequest.toString(36)}`;
  nextRequest = nextRequest === Number.MAX_SAFE_INTEGER ? 1 : nextRequest + 1;
  const request: PendingRequest = {
    accessPoint:
      accessBlock === undefined
        ? undefined
        : {
            dimensionId: accessBlock.dimension.id,
            x: accessBlock.x + 0.5,
            y: accessBlock.y + 0.5,
            z: accessBlock.z + 0.5,
          },
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
      "Web Terminal companion did not respond. Check that the companion is running, then try again.",
    );
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
    case "computer_system:web-complete":
      handleCompletion(message);
      return true;
    case "computer_system:web-resize":
      handleResize(message);
      return true;
    case "computer_system:web-interrupt":
      handleInterrupt(message);
      return true;
    case "computer_system:web-take-control":
      handleTakeControl(message);
      return true;
    case "computer_system:web-power":
      handlePower(message);
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
  setFloppyActivityHandler((computerId, activity): void => {
    const event = floppyAudio.record(computerId, activity, system.currentTick);
    if (event === undefined) return;
    for (const sessionId of sessionsByComputer.get(computerId) ?? [])
      snapshotScheduler.requestEager(sessionId);
  });
  system.runInterval(emitEagerSnapshots, 1);
  system.runInterval(flushPendingMouseMoves, 1);
  system.runInterval(emitChangedSnapshots, 5);
  system.runInterval(pruneExpiredSessions, 100);
  world.afterEvents.playerLeave.subscribe(({ playerId }): void => {
    disconnectWebTerminalPlayer(playerId, "disconnected");
  });
}

export function disconnectWebTerminalPlayer(
  playerId: string,
  reason = "disconnected",
  computerId?: string,
): void {
  for (const session of [...activeSessions.values()]) {
    if (
      session.playerId === playerId &&
      (computerId === undefined || session.computerId === computerId)
    ) {
      finalizeSession(session, reason);
    }
  }
  for (const request of [...pendingRequests.values()]) {
    if (
      request.player.id === playerId &&
      (computerId === undefined || request.computerId === computerId)
    ) {
      pendingRequests.delete(request.requestId);
    }
  }
}

function handleResponse(message: string): void {
  const match =
    /^(r[a-z0-9]+-[a-z0-9]+) ([A-Za-z0-9_-]{12,32}) (writer|viewer)(?: (debug))? (https?:\/\/[^\s]{1,180})$/u.exec(
      message,
    );
  if (match === null) return;
  const [
    ,
    requestId = "",
    sessionId = "",
    mode = "",
    debugMarker = "",
    url = "",
  ] = match;
  const rangeCheckDisabledForDebug = debugMarker === "debug";
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
  if (
    !isWithinAccessRange(
      request.player,
      request.accessPoint,
      rangeCheckDisabledForDebug,
    )
  ) {
    request.player.sendMessage(
      "Web Terminal access expired: stay within 3 blocks of the Computer.",
    );
    rejectSession(sessionId, "out_of_range");
    return;
  }

  pruneExpiredSessions();
  if (activeSessions.size >= maxActiveSessions) {
    request.player.sendMessage(
      "Web Terminal capacity was reached. Close another session and try again.",
    );
    rejectSession(sessionId, "capacity");
    return;
  }

  const session: ActiveSession = {
    accessPoint: request.accessPoint,
    computerId: request.computerId,
    expiresAtTick: system.currentTick + sessionLifetimeTicks,
    playerId: request.player.id,
    player: request.player,
    rangeCheckDisabledForDebug,
    sessionId,
    access: "in_range",
    audioCursor: floppyAudio.latestSequence(request.computerId),
    mouseButtons: 0,
    mouseSequence: -1,
    mouseX: 1,
    mouseY: 1,
  };
  try {
    snapshotScheduler.attach(sessionId);
    const attached = terminalAccess.attach(
      sessionId,
      request.computerId,
      mode as WebTerminalAccessMode,
    );
    if (attached.demotedSessionId !== undefined) {
      releaseMouseButtons(activeSessions.get(attached.demotedSessionId));
    }
  } catch {
    snapshotScheduler.detach(sessionId);
    request.player.sendMessage(
      "Web Terminal session could not be attached. Try again.",
    );
    rejectSession(sessionId, "attach_failed");
    return;
  }
  activeSessions.set(sessionId, session);
  let computerSessions = sessionsByComputer.get(session.computerId);
  if (computerSessions === undefined) {
    computerSessions = new Set();
    sessionsByComputer.set(session.computerId, computerSessions);
  }
  computerSessions.add(sessionId);
  request.player.sendMessage(
    "Open Computer System Web Terminal (valid for 2 minutes):",
  );
  const shortHandoff = /^(https?:\/\/[^/\s]+)\/p\/([0-9]{4})$/u.exec(url);
  if (shortHandoff === null) {
    request.player.sendMessage(url);
  } else {
    request.player.sendMessage(`${shortHandoff[1]}/`);
    request.player.sendMessage(`Connection code: ${shortHandoff[2]}`);
  }
  emitSnapshot(session, true);
}

function handleInput(message: string): void {
  const match =
    /^([A-Za-z0-9_-]{12,32}) (line|keys|mouse) ([^\s]{0,180})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session === undefined || !terminalAccess.canWrite(session.sessionId))
    return;
  let value: string;
  try {
    value = decodeURIComponent(match[3] ?? "");
  } catch {
    return;
  }
  if (match[2] === "mouse") {
    const event = parseTerminalMouseEvent(value);
    if (event === undefined || event.sequence <= session.mouseSequence) return;
    session.mouseSequence = event.sequence;
    session.mouseX = event.x;
    session.mouseY = event.y;
    if (event.action === "move") {
      session.pendingMouseMove = value;
      return;
    }
    flushPendingMouseMove(session);
    const mask = 1 << event.button;
    if (event.action === "down") {
      if ((session.mouseButtons & mask) !== 0) return;
      session.mouseButtons |= mask;
    } else {
      if ((session.mouseButtons & mask) === 0) return;
      session.mouseButtons &= ~mask;
    }
    computerHost.runtime.queueEvent(
      session.computerId,
      "terminal_mouse",
      value,
    );
  } else if (match[2] === "keys") {
    if (!isTerminalKeyBatch(value)) return;
    computerHost.runtime.queueEvent(session.computerId, "terminal_keys", value);
  } else {
    if (value.includes("\0") || /[\r\n]/u.test(value) || value.length > 128)
      return;
    computerHost.runtime.queueEvent(session.computerId, "terminal_line", value);
  }
  snapshotScheduler.requestEager(session.sessionId);
}

function parseTerminalMouseEvent(value: string):
  | {
      readonly action: "down" | "move" | "up";
      readonly button: 0 | 1 | 2;
      readonly sequence: number;
      readonly x: number;
      readonly y: number;
    }
  | undefined {
  try {
    const event: unknown = JSON.parse(value);
    if (typeof event !== "object" || event === null) return undefined;
    const candidate = event as Record<string, unknown>;
    if (
      (candidate.action !== "down" &&
        candidate.action !== "move" &&
        candidate.action !== "up") ||
      (candidate.button !== 0 &&
        candidate.button !== 1 &&
        candidate.button !== 2) ||
      !Number.isSafeInteger(candidate.sequence) ||
      (candidate.sequence as number) < 0 ||
      !Number.isSafeInteger(candidate.x) ||
      (candidate.x as number) < 1 ||
      (candidate.x as number) > 80 ||
      !Number.isSafeInteger(candidate.y) ||
      (candidate.y as number) < 1 ||
      (candidate.y as number) > 25
    ) {
      return undefined;
    }
    return candidate as ReturnType<typeof parseTerminalMouseEvent>;
  } catch {
    return undefined;
  }
}

function handleCompletion(message: string): void {
  const match =
    /^([A-Za-z0-9_-]{12,32}) ([A-Za-z0-9_-]{6,20}) ([0-9]{1,3}) v([^\s]{0,128})$/u.exec(
      message,
    );
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session === undefined || !terminalAccess.canWrite(session.sessionId))
    return;
  let value: string;
  try {
    value = decodeURIComponent(match[4] ?? "");
  } catch {
    return;
  }
  const cursor = Number(match[3]);
  if (
    value.includes("\0") ||
    /[\r\n]/u.test(value) ||
    value.length > 128 ||
    !Number.isSafeInteger(cursor) ||
    cursor < 0 ||
    cursor > value.length
  ) {
    return;
  }
  const completion = computerHost.runtime.completeShellInput(
    session.computerId,
    value,
    cursor,
  ) ?? { candidates: [], cursor, value };
  console.warn(
    `${completionMarker}${JSON.stringify({
      ...completion,
      requestId: match[2],
      sessionId: session.sessionId,
    })}`,
  );
}

function handleResize(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32}) ([0-9]{2,3}) ([0-9]{2,3})$/u.exec(
    message,
  );
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session === undefined || !terminalAccess.canWrite(session.sessionId))
    return;
  const width = Number(match[2]);
  const height = Number(match[3]);
  if (width !== 80 || height !== 25) return;
  if (computerHost.runtime.resizeTerminal(session.computerId, width, height)) {
    snapshotScheduler.requestEager(session.sessionId);
  }
}

function isTerminalKeyBatch(value: string): boolean {
  try {
    const keys: unknown = JSON.parse(value);
    return (
      Array.isArray(keys) &&
      keys.length > 0 &&
      keys.length <= 32 &&
      keys.every((key) => typeof key === "string" && key.length <= 32)
    );
  } catch {
    return false;
  }
}

function handleInterrupt(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session !== undefined && terminalAccess.canWrite(session.sessionId)) {
    computerHost.runtime.interrupt(session.computerId);
    snapshotScheduler.requestEager(session.sessionId);
  }
}

function handleTakeControl(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session !== undefined) {
    const takeover = terminalAccess.takeControl(session.sessionId);
    if (
      takeover.outcome === "transferred" &&
      takeover.demotedSessionId !== undefined
    ) {
      releaseMouseButtons(activeSessions.get(takeover.demotedSessionId));
    }
  }
}

function handlePower(message: string): void {
  const match =
    /^([A-Za-z0-9_-]{12,32}) ([A-Za-z0-9_-]{6,20}) (power_on|safe_boot|shutdown)$/u.exec(
      message,
    );
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session === undefined || !terminalAccess.canWrite(session.sessionId))
    return;
  const requestId = match[2] ?? "";
  const action = match[3];
  const record = computerHost.get(session.computerId);
  let result: RuntimeCommandResult;
  if (record === undefined) {
    result = { outcome: "missing", computerId: session.computerId };
  } else {
    result =
      action === "power_on"
        ? computerHost.runtime.powerOn(session.computerId)
        : action === "safe_boot"
          ? computerHost.runtime.safeBoot(session.computerId)
          : computerHost.runtime.shutdown(
              session.computerId,
              "web_terminal_power_button",
            );
  }
  console.warn(
    `${powerMarker}${JSON.stringify({
      ...serializableRuntimeResult(result),
      action,
      lifecycle: record?.lifecycle.state.kind ?? "missing",
      requestId,
      sessionId: session.sessionId,
    })}`,
  );
  snapshotScheduler.requestEager(session.sessionId);
}

function handleClose(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32})$/u.exec(message);
  if (match === null) return;
  const session = activeSessions.get(match[1] ?? "");
  if (session !== undefined) finalizeSession(session, "browser_closed");
}

function serializableRuntimeResult(
  result: RuntimeCommandResult,
): Record<string, unknown> {
  return result.outcome === "failed"
    ? { outcome: result.outcome, error: result.error.message }
    : result;
}

function requireActiveSession(sessionId: string): ActiveSession | undefined {
  const session = activeSessions.get(sessionId);
  if (session === undefined) return undefined;
  if (session.expiresAtTick <= system.currentTick) {
    finalizeSession(session, "expired");
    return undefined;
  }
  if (
    !isWithinAccessRange(
      session.player,
      session.accessPoint,
      session.rangeCheckDisabledForDebug,
    )
  ) {
    setSessionAccess(session, "out_of_range");
    return undefined;
  }
  if (setSessionAccess(session, "in_range")) {
    snapshotScheduler.requestEager(session.sessionId);
  }
  return session;
}

function setSessionAccess(
  session: ActiveSession,
  access: "in_range" | "out_of_range",
): boolean {
  if (session.access === access) return false;
  session.access = access;
  if (access === "out_of_range") {
    releaseMouseButtons(session);
    session.audioCursor = floppyAudio.latestSequence(session.computerId);
  }
  if (session.player.isValid) {
    session.player.sendMessage(
      access === "in_range"
        ? "Web Terminal reconnected: Computer is within 3 blocks."
        : "Web Terminal paused: move within 3 blocks of the Computer to reconnect.",
    );
  }
  console.warn(
    `${accessMarker}${JSON.stringify({ sessionId: session.sessionId, access })}`,
  );
  return true;
}

function isWithinAccessRange(
  player: Player,
  accessPoint: WebTerminalAccessPoint | undefined,
  rangeCheckDisabledForDebug = false,
): boolean {
  if (rangeCheckDisabledForDebug) return true;
  if (accessPoint === undefined) return true;
  if (!player.isValid || player.dimension.id !== accessPoint.dimensionId)
    return false;
  const x = player.location.x - accessPoint.x;
  const y = player.location.y - accessPoint.y;
  const z = player.location.z - accessPoint.z;
  return x * x + y * y + z * z <= 9;
}

function emitChangedSnapshots(): void {
  for (const sessionId of snapshotScheduler.takePeriodicBatch()) {
    const session = activeSessions.get(sessionId);
    if (session !== undefined) emitSnapshot(session, false);
  }
}

function emitEagerSnapshots(): void {
  for (const sessionId of snapshotScheduler.takeEagerBatch()) {
    const session = requireActiveSession(sessionId);
    if (session === undefined) {
      snapshotScheduler.completeEager(sessionId, false);
      continue;
    }
    snapshotScheduler.completeEager(sessionId, emitSnapshot(session, false));
  }
}

function flushPendingMouseMoves(): void {
  for (const session of activeSessions.values()) flushPendingMouseMove(session);
}

function flushPendingMouseMove(session: ActiveSession): void {
  const pending = session.pendingMouseMove;
  if (pending === undefined) return;
  session.pendingMouseMove = undefined;
  if (!terminalAccess.canWrite(session.sessionId)) return;
  computerHost.runtime.queueEvent(
    session.computerId,
    "terminal_mouse",
    pending,
  );
  snapshotScheduler.requestEager(session.sessionId);
}

function releaseMouseButtons(session: ActiveSession | undefined): void {
  if (session === undefined) return;
  flushPendingMouseMove(session);
  for (let button = 0; button <= 2; button += 1) {
    const mask = 1 << button;
    if ((session.mouseButtons & mask) === 0) continue;
    session.mouseSequence += 1;
    computerHost.runtime.queueEvent(
      session.computerId,
      "terminal_mouse",
      JSON.stringify({
        action: "up",
        button,
        sequence: session.mouseSequence,
        x: session.mouseX,
        y: session.mouseY,
      }),
    );
  }
  session.mouseButtons = 0;
}

function emitSnapshot(session: ActiveSession, force: boolean): boolean {
  if (
    !isWithinAccessRange(
      session.player,
      session.accessPoint,
      session.rangeCheckDisabledForDebug,
    )
  ) {
    setSessionAccess(session, "out_of_range");
    return false;
  }
  const resumed = setSessionAccess(session, "in_range");
  const record = computerHost.get(session.computerId);
  if (record === undefined) {
    finalizeSession(session, "computer_missing");
    return false;
  }
  const audio = floppyAudio.eventsAfter(
    session.computerId,
    session.audioCursor,
  );
  const snapshot = {
    sessionId: session.sessionId,
    computerId: session.computerId,
    label: record.label ?? record.computerId,
    lifecycle: record.lifecycle.state.kind,
    storage: computerHost.storageStatus(record.computerId),
    terminal: {
      ...record.terminal.snapshot(),
      secretInput: computerHost.runtime.isShellSecretInput(record.computerId),
    },
  };
  const comparison = JSON.stringify({
    ...snapshot,
    audio: { events: [], latestSequence: audio.latestSequence },
  });
  if (
    !force &&
    !resumed &&
    audio.events.length === 0 &&
    session.lastSnapshot === comparison
  ) {
    return false;
  }
  const serialized = JSON.stringify({ ...snapshot, audio });
  session.lastSnapshot = comparison;
  console.warn(`${snapshotMarker}${serialized}`);
  session.audioCursor = audio.latestSequence;
  return true;
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
  releaseMouseButtons(session);
  if (!activeSessions.delete(session.sessionId)) return;
  const computerSessions = sessionsByComputer.get(session.computerId);
  computerSessions?.delete(session.sessionId);
  if (computerSessions?.size === 0)
    sessionsByComputer.delete(session.computerId);
  snapshotScheduler.detach(session.sessionId);
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
