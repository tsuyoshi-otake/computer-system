import { system, world, type Block, type Player } from "@minecraft/server";

import type { ComputerRecord } from "../domain/computer/computer.js";
import type {
  ComputerExecutionStatus,
  RuntimeCommandResult,
} from "../application/computer/computerRuntime.js";
import type { ShellTerminalCompletionResponse } from "../application/os/shellTypes.js";
import type { TerminalInteractionDescriptor } from "../application/terminal/terminalInteraction.js";
import { TerminalSnapshotScheduler } from "../application/terminal/terminalSnapshotScheduler.js";
import { FloppyAudioEventBroker } from "../application/terminal/floppyAudioEvents.js";
import {
  WebTerminalRequestAdmission,
  type WebTerminalRequestSource,
} from "../application/terminal/webTerminalRequestAdmission.js";
import {
  isInitialWebTerminalAccessAllowed,
  nextWebTerminalRangeAccess,
} from "../application/terminal/webTerminalRange.js";
import {
  WebTerminalAccessRegistry,
  type WebTerminalAccessMode,
} from "../application/terminal/webTerminalAccess.js";
import { computerHost, setFloppyActivityHandler } from "./computerHost.js";
import { selectComputerTerminal } from "./computerTerminal.js";
import { ejectFloppyToPlayer } from "./floppyComponent.js";

const requestMarker = "CS_WEB_SESSION_REQUEST ";
const readyMarker = "CS_WEB_SESSION_READY ";
const snapshotMarker = "CS_WEB_TERMINAL ";
const accessMarker = "CS_WEB_ACCESS ";
const completionMarker = "CS_WEB_COMPLETION ";
const inputMarker = "CS_WEB_INPUT ";
const powerMarker = "CS_WEB_POWER ";
const ejectMarker = "CS_WEB_FLOPPY_EJECT ";
const finalMarker = "CS_WEB_SESSION_FINAL ";
const requestLifetimeTicks = 200;
const sessionLifetimeTicks = 36_000;
const maxPendingRequests = 32;
const maxActiveSessions = 32;
const maxSnapshotsPerPass = 2;
const maxEagerSnapshotsPerPass = 4;
const maxEagerSnapshotAttempts = 3;

interface WebTerminalPrincipal {
  readonly id: string;
  readonly kind: "debug" | "player";
  readonly player?: Player;
}

interface PendingRequest {
  readonly accessPoint?: WebTerminalAccessPoint;
  readonly computerId: string;
  readonly expiresAtTick: number;
  readonly principal: WebTerminalPrincipal;
  readonly requestId: string;
}

interface ActiveSession {
  readonly accessPoint?: WebTerminalAccessPoint;
  readonly computerId: string;
  readonly expiresAtTick: number;
  readonly principal: WebTerminalPrincipal;
  readonly rangeCheckDisabledForDebug: boolean;
  readonly sessionId: string;
  access: "in_range" | "out_of_range";
  audioCursor: number;
  lastSnapshotMetadata?: string;
  lastTerminal?: ComputerRecord["terminal"];
  lastTerminalRevision?: number;
  mouseButtons: number;
  mouseSequence: number;
  mouseX: number;
  mouseY: number;
  pendingMouseMove?: PendingMouseMove;
}

interface SharedSnapshotFrame {
  readonly metadata: string;
  readonly payload: {
    readonly computerId: string;
    readonly displayState: ComputerRecord["display"]["state"]["kind"];
    readonly execution: ComputerExecutionStatus;
    readonly label: string;
    readonly lifecycle: string;
    readonly storage: ReturnType<typeof computerHost.storageStatus>;
    readonly terminal: ReturnType<ComputerRecord["terminal"]["snapshot"]> & {
      readonly interaction: TerminalInteractionDescriptor;
    };
  };
  readonly terminal: ComputerRecord["terminal"];
  readonly terminalRevision: number;
}

interface PendingMouseMove {
  readonly event: TerminalMouseEvent;
  readonly requestId: string;
  readonly value: string;
}

interface TerminalMouseEvent {
  readonly action: "down" | "move" | "up";
  readonly button: 0 | 1 | 2;
  readonly sequence: number;
  readonly x: number;
  readonly y: number;
}

type WebInputResult =
  | RuntimeCommandResult
  | {
      readonly outcome: "ignored";
      readonly reason:
        | "duplicate_mouse_button"
        | "mouse_move_superseded"
        | "read_only"
        | "secret_input"
        | "input_mode_changed"
        | "stale_mouse_event";
    }
  | { readonly outcome: "missing"; readonly resource: "session" };

type WebInputFailureCode =
  | "input_queue_failed"
  | "invalid_encoding"
  | "invalid_key_batch"
  | "invalid_line"
  | "invalid_mouse_event"
  | "malformed_input";

interface WebTerminalAccessPoint {
  readonly dimensionId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

const pendingRequests = new Map<string, PendingRequest>();
const activeSessions = new Map<string, ActiveSession>();
const sharedSnapshotFrames = new Map<string, SharedSnapshotFrame>();
const sessionsByComputer = new Map<string, Set<string>>();
const floppyAudio = new FloppyAudioEventBroker(256);
const terminalAccess = new WebTerminalAccessRegistry(maxActiveSessions);
const requestAdmission = new WebTerminalRequestAdmission(
  maxPendingRequests,
  10,
);
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
  source: WebTerminalRequestSource = "interaction",
): void {
  requestWebComputerTerminalForPrincipal(
    { id: player.id, kind: "player", player },
    record,
    accessBlock,
    source,
  );
}

export function requestDebugWebComputerTerminal(record: ComputerRecord): void {
  requestWebComputerTerminalForPrincipal(
    { id: "mcp-debug", kind: "debug" },
    record,
    undefined,
    "debug",
  );
}

function requestWebComputerTerminalForPrincipal(
  principal: WebTerminalPrincipal,
  record: ComputerRecord,
  accessBlock: Block | undefined,
  source: WebTerminalRequestSource,
): void {
  pruneExpiredRequests();
  const requestId = `r${system.currentTick.toString(36)}-${nextRequest.toString(36)}`;
  nextRequest = nextRequest === Number.MAX_SAFE_INTEGER ? 1 : nextRequest + 1;
  const admission = requestAdmission.admit({
    computerId: record.computerId,
    currentTick: system.currentTick,
    playerId: principal.id,
    requestId,
    source,
  });
  if (admission.outcome === "duplicate") return;
  if (admission.outcome === "capacity") {
    sendPrincipalMessage(
      principal,
      "Web Terminal is busy. Try again after another request finishes.",
    );
    return;
  }

  try {
    if (principal.player !== undefined) {
      selectComputerTerminal(principal.player.id, record.computerId);
    }
    if (record.lifecycle.state.kind === "off") {
      computerHost.runtime.powerOn(record.computerId);
    }
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
      principal,
      requestId,
    };
    pendingRequests.set(requestId, request);
    sendPrincipalMessage(
      principal,
      "Preparing a secure browser terminal link...",
    );
    console.warn(
      `${requestMarker}${JSON.stringify({
        requestId,
        playerId: principal.id,
        principalKind: principal.kind,
        computerId: record.computerId,
      })}`,
    );
  } catch {
    pendingRequests.delete(requestId);
    requestAdmission.finalize(requestId, "failed", system.currentTick);
    sendPrincipalMessage(
      principal,
      "Web Terminal request could not be started.",
    );
    return;
  }

  system.runTimeout((): void => {
    const pending = pendingRequests.get(requestId);
    if (pending === undefined || pending.expiresAtTick > system.currentTick) {
      return;
    }
    finalizePendingRequest(pending, "failed");
    sendPrincipalMessage(
      pending.principal,
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
    case "computer_system:web-reject":
      handleRejection(message);
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
    case "computer_system:web-take-control":
      handleTakeControl(message);
      return true;
    case "computer_system:web-power":
      handlePower(message);
      return true;
    case "computer_system:web-floppy-eject":
      handleFloppyEject(message);
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
      session.principal.kind === "player" &&
      session.principal.id === playerId &&
      (computerId === undefined || session.computerId === computerId)
    ) {
      finalizeSession(session, reason);
    }
  }
  for (const request of [...pendingRequests.values()]) {
    if (
      request.principal.kind === "player" &&
      request.principal.id === playerId &&
      (computerId === undefined || request.computerId === computerId)
    ) {
      finalizePendingRequest(request, "failed");
    }
  }
}

function handleRejection(message: string): void {
  const match = /^(r[a-z0-9]+-[a-z0-9]+) ([a-z][a-z_]{0,31})$/u.exec(message);
  if (match === null) return;
  const request = pendingRequests.get(match[1] ?? "");
  if (request === undefined) return;
  finalizePendingRequest(request, "failed");
  sendPrincipalMessage(
    request.principal,
    match[2] === "capacity"
      ? "Web Terminal is busy. Try again after another session closes."
      : "Web Terminal request was rejected by the companion. Try again.",
  );
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
  const request = pendingRequests.get(requestId);
  if (request === undefined) {
    rejectSession(sessionId, "request_missing");
    return;
  }
  if (
    !isPrincipalAvailable(request.principal) ||
    request.expiresAtTick <= system.currentTick
  ) {
    finalizePendingRequest(request, "failed");
    rejectSession(sessionId, "request_expired");
    return;
  }
  const rangeCheckDisabledForDebug =
    request.principal.kind === "debug" || debugMarker === "debug";
  if (
    !isInitialAccessAllowed(
      request.principal,
      request.accessPoint,
      rangeCheckDisabledForDebug,
    )
  ) {
    sendPrincipalMessage(
      request.principal,
      "Web Terminal access expired: stay within 3 blocks of the Computer.",
    );
    finalizePendingRequest(request, "failed");
    rejectSession(sessionId, "out_of_range");
    return;
  }

  pruneExpiredSessions();
  if (activeSessions.size >= maxActiveSessions) {
    sendPrincipalMessage(
      request.principal,
      "Web Terminal capacity was reached. Close another session and try again.",
    );
    finalizePendingRequest(request, "failed");
    rejectSession(sessionId, "capacity");
    return;
  }

  const session: ActiveSession = {
    accessPoint: request.accessPoint,
    computerId: request.computerId,
    expiresAtTick: system.currentTick + sessionLifetimeTicks,
    principal: request.principal,
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
    sendPrincipalMessage(
      request.principal,
      "Web Terminal session could not be attached. Try again.",
    );
    finalizePendingRequest(request, "failed");
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
  finalizePendingRequest(request, "accepted");
  console.warn(`${readyMarker}${JSON.stringify({ sessionId })}`);
  const shortHandoff = /^(https?:\/\/[^/\s]+)\/p\/([0-9]{4})$/u.exec(url);
  if (shortHandoff === null) {
    sendPrincipalMessage(
      request.principal,
      `Web Terminal ready for 2 minutes: ${url}`,
    );
  } else {
    sendPrincipalMessage(
      request.principal,
      `Web Terminal ready for 2 minutes: ${shortHandoff[1]}/ - Connection code: ${shortHandoff[2]}`,
    );
  }
  emitSnapshot(session, true);
}

function handleInput(message: string): void {
  const correlation =
    /^([A-Za-z0-9_-]{12,32}) ([A-Za-z0-9_-]{6,20})(?: |$)/u.exec(message);
  if (correlation === null) return;
  const sessionId = correlation[1] ?? "";
  const requestId = correlation[2] ?? "";
  const match =
    /^([A-Za-z0-9_-]{12,32}) ([A-Za-z0-9_-]{6,20}) ([0-9]{1,16}) (abort-line|cancel|interrupt|line|keys|mouse) ([^\s]{0,180})$/u.exec(
      message,
    );
  if (match === null) {
    finalizeInputRequest(
      sessionId,
      requestId,
      failedInputResult("malformed_input"),
    );
    return;
  }
  const session = requireActiveSession(sessionId);
  if (session === undefined) {
    finalizeInputRequest(sessionId, requestId, {
      outcome: "missing",
      resource: "session",
    });
    return;
  }
  if (!terminalAccess.canWrite(session.sessionId)) {
    finalizeInputRequest(sessionId, requestId, {
      outcome: "ignored",
      reason: "read_only",
    });
    return;
  }
  const interaction = computerHost.runtime.terminalInteraction(
    session.computerId,
  );
  const interactionGeneration = Number(match[3]);
  if (
    !Number.isSafeInteger(interactionGeneration) ||
    interactionGeneration !== interaction.interactionGeneration
  ) {
    finalizeInputRequest(sessionId, requestId, {
      outcome: "ignored",
      reason: "input_mode_changed",
    });
    return;
  }
  if (session.principal.kind === "debug" && interaction.secretInput) {
    finalizeInputRequest(sessionId, requestId, {
      outcome: "ignored",
      reason: "secret_input",
    });
    return;
  }
  let value: string;
  try {
    value = decodeURIComponent(match[5] ?? "");
  } catch {
    finalizeInputRequest(
      sessionId,
      requestId,
      failedInputResult("invalid_encoding"),
    );
    return;
  }
  const kind = match[4];
  if (kind === "abort-line" || kind === "cancel" || kind === "interrupt") {
    if (interaction.ctrlCAction !== kind) {
      finalizeInputRequest(sessionId, requestId, {
        outcome: "ignored",
        reason: "input_mode_changed",
      });
      return;
    }
    const result =
      kind === "interrupt"
        ? computerHost.runtime.interrupt(session.computerId)
        : kind === "cancel"
          ? computerHost.runtime.cancelTerminalInteraction(session.computerId)
          : computerHost.runtime.abortLine(session.computerId);
    finalizeInputRequest(sessionId, requestId, safeInputQueueResult(result));
    return;
  }
  if (kind === "mouse") {
    const event = parseTerminalMouseEvent(value);
    if (event === undefined) {
      finalizeInputRequest(
        sessionId,
        requestId,
        failedInputResult("invalid_mouse_event"),
      );
      return;
    }
    if (interaction.pointer !== "cell") {
      finalizeInputRequest(sessionId, requestId, {
        outcome: "ignored",
        reason: "input_mode_changed",
      });
      return;
    }
    const newestSequence = Math.max(
      session.mouseSequence,
      session.pendingMouseMove?.event.sequence ?? -1,
    );
    if (event.sequence <= newestSequence) {
      finalizeInputRequest(sessionId, requestId, {
        outcome: "ignored",
        reason: "stale_mouse_event",
      });
      return;
    }
    if (event.action === "move") {
      const superseded = session.pendingMouseMove;
      if (superseded !== undefined) {
        finalizeInputRequest(sessionId, superseded.requestId, {
          outcome: "ignored",
          reason: "mouse_move_superseded",
        });
      }
      session.pendingMouseMove = { event, requestId, value };
      return;
    }
    flushPendingMouseMove(session);
    const mask = 1 << event.button;
    if (event.action === "down") {
      if ((session.mouseButtons & mask) !== 0) {
        finalizeInputRequest(sessionId, requestId, {
          outcome: "ignored",
          reason: "duplicate_mouse_button",
        });
        return;
      }
    } else if ((session.mouseButtons & mask) === 0) {
      finalizeInputRequest(sessionId, requestId, {
        outcome: "ignored",
        reason: "duplicate_mouse_button",
      });
      return;
    }
    const result = safeInputQueueResult(
      computerHost.runtime.queueEvent(
        session.computerId,
        "terminal_mouse",
        value,
      ),
    );
    if (result.outcome === "accepted") {
      session.mouseSequence = event.sequence;
      session.mouseX = event.x;
      session.mouseY = event.y;
      session.mouseButtons =
        event.action === "down"
          ? session.mouseButtons | mask
          : session.mouseButtons & ~mask;
    }
    finalizeInputRequest(sessionId, requestId, result);
  } else if (kind === "keys") {
    if (!isTerminalKeyBatch(value)) {
      finalizeInputRequest(
        sessionId,
        requestId,
        failedInputResult("invalid_key_batch"),
      );
      return;
    }
    if (interaction.inputMode !== "keys") {
      finalizeInputRequest(sessionId, requestId, {
        outcome: "ignored",
        reason: "input_mode_changed",
      });
      return;
    }
    const result = safeInputQueueResult(
      computerHost.runtime.queueEvent(
        session.computerId,
        "terminal_keys",
        value,
      ),
    );
    finalizeInputRequest(sessionId, requestId, result);
  } else {
    if (value.includes("\0") || /[\r\n]/u.test(value) || value.length > 128) {
      finalizeInputRequest(
        sessionId,
        requestId,
        failedInputResult("invalid_line"),
      );
      return;
    }
    if (interaction.inputMode !== "line") {
      finalizeInputRequest(sessionId, requestId, {
        outcome: "ignored",
        reason: "input_mode_changed",
      });
      return;
    }
    const result = safeInputQueueResult(
      computerHost.runtime.queueEvent(
        session.computerId,
        "terminal_line",
        value,
      ),
    );
    finalizeInputRequest(sessionId, requestId, result);
  }
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
    /^([A-Za-z0-9_-]{12,32}) ([A-Za-z0-9_-]{6,20}) ([0-9]{1,16}) ([0-9]{1,3}) v([^\s]{0,128})$/u.exec(
      message,
    );
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session === undefined || !terminalAccess.canWrite(session.sessionId))
    return;
  let value: string;
  try {
    value = decodeURIComponent(match[5] ?? "");
  } catch {
    return;
  }
  const interactionGeneration = Number(match[3]);
  const cursor = Number(match[4]);
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
  const interaction = computerHost.runtime.terminalInteraction(
    session.computerId,
  );
  if (
    !Number.isSafeInteger(interactionGeneration) ||
    interactionGeneration !== interaction.interactionGeneration
  ) {
    console.warn(
      `${completionMarker}${JSON.stringify({
        ...emptyCompletion(value, cursor),
        requestId: match[2],
        sessionId: session.sessionId,
      })}`,
    );
    return;
  }
  const completion =
    interaction.inputMode === "line" && !interaction.secretInput
      ? (computerHost.runtime.completeShellInput(
          session.computerId,
          value,
          cursor,
        ) ?? emptyCompletion(value, cursor))
      : emptyCompletion(value, cursor);
  if (completion.outcome === "listed") {
    for (const attachedSessionId of sessionsByComputer.get(
      session.computerId,
    ) ?? []) {
      snapshotScheduler.requestEager(attachedSessionId);
    }
  }
  console.warn(
    `${completionMarker}${JSON.stringify({
      ...completion,
      requestId: match[2],
      sessionId: session.sessionId,
    })}`,
  );
}

function emptyCompletion(
  value: string,
  cursor: number,
): ShellTerminalCompletionResponse {
  return {
    cursor,
    outcome: "none",
    truncated: false,
    value,
  };
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

function handleFloppyEject(message: string): void {
  const match = /^([A-Za-z0-9_-]{12,32}) ([A-Za-z0-9_-]{6,20})$/u.exec(message);
  if (match === null) return;
  const session = requireActiveSession(match[1] ?? "");
  if (session === undefined || !terminalAccess.canWrite(session.sessionId))
    return;
  const requestId = match[2] ?? "";
  const record = computerHost.get(session.computerId);
  const player = session.principal.player;
  let result:
    | { readonly outcome: "ejected" | "empty" | "missing" }
    | { readonly error: string; readonly outcome: "failed" };
  if (record === undefined) {
    result = { outcome: "missing" };
  } else if (player === undefined) {
    result = {
      error: "floppy_eject_requires_player",
      outcome: "failed",
    };
  } else {
    try {
      result = {
        outcome: ejectFloppyToPlayer(session.computerId, player),
      };
    } catch (error: unknown) {
      result = {
        error: error instanceof Error ? error.message : String(error),
        outcome: "failed",
      };
    }
  }
  console.warn(
    `${ejectMarker}${JSON.stringify({
      ...result,
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
  result: WebInputResult,
): Record<string, unknown> {
  return result.outcome === "failed"
    ? { outcome: result.outcome, error: result.error.message }
    : result;
}

function failedInputResult(error: WebInputFailureCode): RuntimeCommandResult {
  return { outcome: "failed", error: new Error(error) };
}

function safeInputQueueResult(
  result: RuntimeCommandResult,
): RuntimeCommandResult {
  return result.outcome === "failed"
    ? failedInputResult("input_queue_failed")
    : result;
}

function finalizeInputRequest(
  sessionId: string,
  requestId: string,
  result: WebInputResult,
): void {
  console.warn(
    `${inputMarker}${JSON.stringify({
      sessionId,
      requestId,
      ...serializableRuntimeResult(result),
    })}`,
  );
  if (result.outcome === "accepted") {
    snapshotScheduler.requestEager(sessionId);
  }
}

function requireActiveSession(sessionId: string): ActiveSession | undefined {
  const session = activeSessions.get(sessionId);
  if (session === undefined) return undefined;
  if (session.expiresAtTick <= system.currentTick) {
    finalizeSession(session, "expired");
    return undefined;
  }
  if (nextAccessForSession(session) === "out_of_range") {
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
  console.warn(
    `${accessMarker}${JSON.stringify({ sessionId: session.sessionId, access })}`,
  );
  return true;
}

function isPrincipalAvailable(principal: WebTerminalPrincipal): boolean {
  return principal.kind === "debug" || principal.player?.isValid === true;
}

function sendPrincipalMessage(
  principal: WebTerminalPrincipal,
  message: string,
): void {
  if (principal.player?.isValid) principal.player.sendMessage(message);
}

function isInitialAccessAllowed(
  principal: WebTerminalPrincipal,
  accessPoint: WebTerminalAccessPoint | undefined,
  rangeCheckDisabledForDebug = false,
): boolean {
  if (principal.kind === "debug") return accessPoint === undefined;
  const player = principal.player;
  if (player === undefined || !player.isValid) return false;
  return isInitialWebTerminalAccessAllowed(
    accessOptions(player, accessPoint, rangeCheckDisabledForDebug),
  );
}

function nextAccessForSession(
  session: ActiveSession,
): "in_range" | "out_of_range" {
  if (session.principal.kind === "debug") return "in_range";
  const player = session.principal.player;
  if (player === undefined || !player.isValid) return "out_of_range";
  return nextWebTerminalRangeAccess({
    currentAccess: session.access,
    ...accessOptions(
      player,
      session.accessPoint,
      session.rangeCheckDisabledForDebug,
    ),
  });
}

function accessOptions(
  player: Player,
  accessPoint: WebTerminalAccessPoint | undefined,
  rangeCheckDisabledForDebug: boolean,
): {
  readonly rangeCheckDisabledForDebug: boolean;
  readonly sameDimension: boolean;
  readonly squaredDistance: number;
} {
  if (accessPoint === undefined) {
    return {
      rangeCheckDisabledForDebug: true,
      sameDimension: true,
      squaredDistance: 0,
    };
  }
  const sameDimension = player.dimension.id === accessPoint.dimensionId;
  if (!sameDimension) {
    return {
      rangeCheckDisabledForDebug,
      sameDimension: false,
      squaredDistance: 0,
    };
  }
  const x = player.location.x - accessPoint.x;
  const y = player.location.y - accessPoint.y;
  const z = player.location.z - accessPoint.z;
  return {
    rangeCheckDisabledForDebug,
    sameDimension: true,
    squaredDistance: x * x + y * y + z * z,
  };
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
  if (!terminalAccess.canWrite(session.sessionId)) {
    finalizeInputRequest(session.sessionId, pending.requestId, {
      outcome: "ignored",
      reason: "read_only",
    });
    return;
  }
  const result = safeInputQueueResult(
    computerHost.runtime.queueEvent(
      session.computerId,
      "terminal_mouse",
      pending.value,
    ),
  );
  if (result.outcome === "accepted") {
    session.mouseSequence = pending.event.sequence;
    session.mouseX = pending.event.x;
    session.mouseY = pending.event.y;
  }
  finalizeInputRequest(session.sessionId, pending.requestId, result);
}

function releaseMouseButtons(
  session: ActiveSession | undefined,
  discardPendingMove = false,
): void {
  if (session === undefined) return;
  if (discardPendingMove && session.pendingMouseMove !== undefined) {
    const pending = session.pendingMouseMove;
    session.pendingMouseMove = undefined;
    finalizeInputRequest(session.sessionId, pending.requestId, {
      outcome: "ignored",
      reason: "input_mode_changed",
    });
  } else {
    flushPendingMouseMove(session);
  }
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
  if (nextAccessForSession(session) === "out_of_range") {
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
  const label = record.label ?? record.computerId;
  const displayState = record.display.state.kind;
  const lifecycle = record.lifecycle.state.kind;
  const storage = computerHost.storageStatus(record.computerId);
  const execution: ComputerExecutionStatus =
    computerHost.runtime.executionStatus(record.computerId) ?? {
      activeBackend: "idle",
      workerCount: 0,
    };
  const interaction = computerHost.runtime.terminalInteraction(
    record.computerId,
  );
  if (interaction.pointer !== "cell") releaseMouseButtons(session, true);
  const terminalRevision = record.terminal.revision;
  const frameMetadata = JSON.stringify({
    displayState,
    execution,
    interaction,
    label,
    lifecycle,
    storage,
  });
  const metadata = `${String(audio.latestSequence)}:${frameMetadata}`;
  if (
    !force &&
    !resumed &&
    audio.events.length === 0 &&
    session.lastTerminal === record.terminal &&
    session.lastTerminalRevision === terminalRevision &&
    session.lastSnapshotMetadata === metadata
  ) {
    return false;
  }
  const frame = getSharedSnapshotFrame(
    record,
    displayState,
    execution,
    label,
    lifecycle,
    storage,
    interaction,
    terminalRevision,
    frameMetadata,
  );
  const serialized = JSON.stringify({
    sessionId: session.sessionId,
    ...frame.payload,
    audio,
  });
  console.warn(`${snapshotMarker}${serialized}`);
  session.lastTerminal = record.terminal;
  session.lastTerminalRevision = terminalRevision;
  session.lastSnapshotMetadata = metadata;
  session.audioCursor = audio.latestSequence;
  return true;
}

function getSharedSnapshotFrame(
  record: ComputerRecord,
  displayState: ComputerRecord["display"]["state"]["kind"],
  execution: ComputerExecutionStatus,
  label: string,
  lifecycle: string,
  storage: ReturnType<typeof computerHost.storageStatus>,
  interaction: TerminalInteractionDescriptor,
  terminalRevision: number,
  metadata: string,
): SharedSnapshotFrame {
  const cached = sharedSnapshotFrames.get(record.computerId);
  if (
    cached !== undefined &&
    cached.terminal === record.terminal &&
    cached.terminalRevision === terminalRevision &&
    cached.metadata === metadata
  ) {
    return cached;
  }
  const frame: SharedSnapshotFrame = {
    metadata,
    payload: {
      computerId: record.computerId,
      displayState,
      execution,
      label,
      lifecycle,
      storage,
      terminal: {
        ...record.terminal.snapshot(),
        interaction,
      },
    },
    terminal: record.terminal,
    terminalRevision,
  };
  sharedSnapshotFrames.set(record.computerId, frame);
  return frame;
}

function pruneExpiredRequests(): void {
  requestAdmission.prune(system.currentTick);
  for (const request of [...pendingRequests.values()]) {
    if (request.expiresAtTick <= system.currentTick) {
      finalizePendingRequest(request, "failed");
      sendPrincipalMessage(
        request.principal,
        "Web Terminal request expired before the companion responded.",
      );
    }
  }
}

function finalizePendingRequest(
  request: PendingRequest,
  outcome: "accepted" | "failed",
): boolean {
  if (!pendingRequests.delete(request.requestId)) return false;
  requestAdmission.finalize(request.requestId, outcome, system.currentTick);
  return true;
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
  if (computerSessions?.size === 0) {
    sessionsByComputer.delete(session.computerId);
    sharedSnapshotFrames.delete(session.computerId);
  }
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
