import type {
  Cs486WorkerCommand,
  Cs486WorkerCommandResult,
  Cs486WorkerProcessView,
  Cs486WorkerTransport,
} from "./remoteCs486Process.js";

const protocolVersion = 1;
const defaultMaximumPendingRequests = 256;
const defaultMaximumPayloadBytes = 1024 * 1024;
const defaultRequestTimeoutTicks = 200;
const maximumErrorMessageLength = 500;

export interface Cs486WorkerTextSocket {
  readonly isOpen: boolean;
  close(): void;
  send(payload: string): void;
  subscribeClose(listener: () => void): void;
  subscribeMessage(listener: (payload: string) => void): void;
}

export interface Cs486WorkerSocketTransportOptions {
  readonly cancelTimeout: (handle: unknown) => void;
  readonly connect: () => Promise<Cs486WorkerTextSocket>;
  readonly maximumPayloadBytes?: number;
  readonly maximumPendingRequests?: number;
  readonly requestTimeoutTicks?: number;
  readonly scheduleTimeout: (
    listener: () => void,
    timeoutTicks: number,
  ) => unknown;
  readonly workerCount: number;
}

interface Connection {
  readonly generation: number;
  readonly socket: Cs486WorkerTextSocket;
}

interface PendingRequest {
  connectionGeneration?: number;
  readonly command: Cs486WorkerCommand;
  readonly reject: (error: Error) => void;
  readonly resolve: (result: Cs486WorkerCommandResult) => void;
  timeoutHandle?: unknown;
}

interface WorkerResponseEnvelope {
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
  readonly ok: boolean;
  readonly protocolVersion: 1;
  readonly requestId: string;
  readonly result?: unknown;
}

/**
 * Persistent, correlation-safe transport for the managed BDS loopback worker
 * service. A command is never replayed after it may have reached a worker.
 */
export class Cs486WorkerSocketTransport implements Cs486WorkerTransport {
  readonly workerCount: number;
  private readonly cancelTimeout: (handle: unknown) => void;
  private readonly connectSocket: () => Promise<Cs486WorkerTextSocket>;
  private readonly maximumPayloadBytes: number;
  private readonly maximumPendingRequests: number;
  private readonly requestTimeoutTicks: number;
  private readonly scheduleTimeout: (
    listener: () => void,
    timeoutTicks: number,
  ) => unknown;
  private readonly pending = new Map<string, PendingRequest>();
  private connection: Connection | undefined;
  private connectionPromise: Promise<Connection> | undefined;
  private nextConnectionGeneration = 1;
  private nextRequestSequence = 1;
  private closed = false;

  constructor(options: Cs486WorkerSocketTransportOptions) {
    requireWorkerCount(options.workerCount);
    this.workerCount = options.workerCount;
    this.connectSocket = options.connect;
    this.scheduleTimeout = options.scheduleTimeout;
    this.cancelTimeout = options.cancelTimeout;
    this.maximumPendingRequests = requirePositiveBoundedInteger(
      options.maximumPendingRequests ?? defaultMaximumPendingRequests,
      "maximumPendingRequests",
      defaultMaximumPendingRequests,
    );
    this.maximumPayloadBytes = requirePositiveBoundedInteger(
      options.maximumPayloadBytes ?? defaultMaximumPayloadBytes,
      "maximumPayloadBytes",
      defaultMaximumPayloadBytes,
    );
    this.requestTimeoutTicks = requirePositiveBoundedInteger(
      options.requestTimeoutTicks ?? defaultRequestTimeoutTicks,
      "requestTimeoutTicks",
      20 * 60 * 10,
    );
  }

  request(command: Cs486WorkerCommand): Promise<Cs486WorkerCommandResult> {
    if (this.closed)
      return Promise.reject(
        new Error("CS486 worker transport is permanently closed"),
      );
    if (command.protocolVersion !== protocolVersion)
      return Promise.reject(
        new Error("CS486 worker command uses an unsupported protocol"),
      );
    if (this.pending.size >= this.maximumPendingRequests)
      return Promise.reject(
        new Error("CS486 worker transport pending capacity is exhausted"),
      );

    const requestId = this.allocateRequestId();
    return new Promise<Cs486WorkerCommandResult>((resolve, reject) => {
      const pending: PendingRequest = { command, reject, resolve };
      this.pending.set(requestId, pending);
      try {
        pending.timeoutHandle = this.scheduleTimeout(
          () => this.handleTimeout(requestId, pending),
          this.requestTimeoutTicks,
        );
      } catch (error: unknown) {
        this.pending.delete(requestId);
        reject(transportError("could not schedule a request timeout", error));
        return;
      }
      void this.connectAndSend(requestId, pending);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const connection = this.connection;
    this.connection = undefined;
    this.connectionPromise = undefined;
    if (connection !== undefined) safeClose(connection.socket);
    this.rejectAll(
      new Error("CS486 worker transport closed before requests completed"),
    );
  }

  private async connectAndSend(
    requestId: string,
    pending: PendingRequest,
  ): Promise<void> {
    try {
      const connection = await this.ensureConnection();
      if (this.pending.get(requestId) !== pending) return;
      if (!connection.socket.isOpen)
        throw new Error("CS486 worker socket closed before command admission");

      const payload = serializeRequest(requestId, pending.command);
      if (utf8ByteLength(payload) > this.maximumPayloadBytes)
        throw new Error("CS486 worker command exceeds the transport limit");

      pending.connectionGeneration = connection.generation;
      connection.socket.send(payload);
    } catch (error: unknown) {
      if (this.pending.get(requestId) !== pending) return;
      const failure = transportError("could not send a worker command", error);
      const generation = pending.connectionGeneration;
      if (
        generation !== undefined &&
        this.connection?.generation === generation
      ) {
        this.failConnection(this.connection, failure);
      } else {
        this.finishRejected(requestId, pending, failure);
      }
    }
  }

  private ensureConnection(): Promise<Connection> {
    if (this.closed)
      return Promise.reject(
        new Error("CS486 worker transport is permanently closed"),
      );
    if (this.connection?.socket.isOpen === true)
      return Promise.resolve(this.connection);
    if (this.connectionPromise !== undefined) return this.connectionPromise;

    const generation = this.allocateConnectionGeneration();
    const connectionPromise = this.connectSocket()
      .then((socket) => {
        if (this.closed) {
          safeClose(socket);
          throw new Error("CS486 worker transport closed during connection");
        }
        if (!socket.isOpen) {
          safeClose(socket);
          throw new Error("CS486 worker socket was not open after connection");
        }
        const connection = { generation, socket };
        socket.subscribeMessage((payload) =>
          this.handleMessage(connection, payload),
        );
        socket.subscribeClose(() => this.handleClose(connection));
        this.connection = connection;
        return connection;
      })
      .finally(() => {
        if (this.connectionPromise === connectionPromise)
          this.connectionPromise = undefined;
      });
    this.connectionPromise = connectionPromise;
    return connectionPromise;
  }

  private handleMessage(connection: Connection, payload: string): void {
    if (this.connection !== connection || this.closed) return;
    try {
      if (
        payload.length > this.maximumPayloadBytes ||
        utf8ByteLength(payload) > this.maximumPayloadBytes
      )
        throw new Error("CS486 worker response exceeds the transport limit");
      const envelope = parseResponseEnvelope(payload);
      const pending = this.pending.get(envelope.requestId);
      if (
        pending === undefined ||
        pending.connectionGeneration !== connection.generation
      )
        throw new Error("CS486 worker returned an unknown correlation id");

      if (!envelope.ok) {
        this.finishRejected(
          envelope.requestId,
          pending,
          new Error(
            `CS486 worker request failed (${envelope.error?.code ?? "unknown"}): ${
              envelope.error?.message ?? "unknown error"
            }`,
          ),
        );
        return;
      }
      const result = normalizeWorkerResult(
        envelope.result,
        envelope.requestId,
        pending.command,
        this.workerCount,
      );
      this.finishResolved(envelope.requestId, pending, result);
    } catch (error: unknown) {
      this.failConnection(
        connection,
        transportError("received an invalid worker response", error),
      );
    }
  }

  private handleClose(connection: Connection): void {
    if (this.connection !== connection) return;
    this.connection = undefined;
    this.rejectGeneration(
      connection.generation,
      new Error("CS486 worker socket closed before requests completed"),
    );
  }

  private handleTimeout(requestId: string, pending: PendingRequest): void {
    if (this.pending.get(requestId) !== pending) return;
    const error = new Error("CS486 worker request timed out");
    const generation = pending.connectionGeneration;
    if (
      generation !== undefined &&
      this.connection?.generation === generation
    ) {
      this.failConnection(this.connection, error);
      return;
    }
    this.finishRejected(requestId, pending, error);
  }

  private failConnection(connection: Connection, error: Error): void {
    if (this.connection === connection) this.connection = undefined;
    safeClose(connection.socket);
    this.rejectGeneration(connection.generation, error);
  }

  private rejectGeneration(generation: number, error: Error): void {
    for (const [requestId, pending] of this.pending)
      if (pending.connectionGeneration === generation)
        this.finishRejected(requestId, pending, error);
  }

  private rejectAll(error: Error): void {
    for (const [requestId, pending] of this.pending)
      this.finishRejected(requestId, pending, error);
  }

  private finishResolved(
    requestId: string,
    pending: PendingRequest,
    result: Cs486WorkerCommandResult,
  ): void {
    if (this.pending.get(requestId) !== pending) return;
    this.pending.delete(requestId);
    this.cancelPendingTimeout(pending);
    pending.resolve(result);
  }

  private finishRejected(
    requestId: string,
    pending: PendingRequest,
    error: Error,
  ): void {
    if (this.pending.get(requestId) !== pending) return;
    this.pending.delete(requestId);
    this.cancelPendingTimeout(pending);
    pending.reject(error);
  }

  private cancelPendingTimeout(pending: PendingRequest): void {
    if (pending.timeoutHandle === undefined) return;
    try {
      this.cancelTimeout(pending.timeoutHandle);
    } catch {
      // The request already has an explicit terminal owner and result.
    }
    pending.timeoutHandle = undefined;
  }

  private allocateRequestId(): string {
    for (let attempts = 0; attempts <= this.pending.size; attempts += 1) {
      const sequence = this.nextRequestSequence;
      this.nextRequestSequence =
        sequence === Number.MAX_SAFE_INTEGER ? 1 : sequence + 1;
      const requestId = `bds-${sequence.toString(36)}`;
      if (!this.pending.has(requestId)) return requestId;
    }
    throw new Error("CS486 worker request id space is exhausted");
  }

  private allocateConnectionGeneration(): number {
    const generation = this.nextConnectionGeneration;
    this.nextConnectionGeneration =
      generation === Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
    return generation;
  }
}

function serializeRequest(
  requestId: string,
  command: Cs486WorkerCommand,
): string {
  const commandName = command.command;
  const fields: Record<string, unknown> = { ...command };
  delete fields.command;
  delete fields.protocolVersion;
  return JSON.stringify({
    command: {
      ...fields,
      type: commandName,
    },
    protocolVersion,
    requestId,
  });
}

function parseResponseEnvelope(payload: string): WorkerResponseEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    throw new Error("CS486 worker response is not valid JSON");
  }
  if (
    !isRecord(value) ||
    value.protocolVersion !== protocolVersion ||
    typeof value.requestId !== "string" ||
    value.requestId.length < 1 ||
    value.requestId.length > 128 ||
    typeof value.ok !== "boolean"
  )
    throw new Error("CS486 worker response envelope is invalid");
  if (value.ok) {
    if (!("result" in value))
      throw new Error("CS486 worker success response has no result");
    return {
      ok: true,
      protocolVersion,
      requestId: value.requestId,
      result: value.result,
    };
  }
  if (
    !isRecord(value.error) ||
    typeof value.error.code !== "string" ||
    value.error.code.length < 1 ||
    value.error.code.length > 128 ||
    typeof value.error.message !== "string" ||
    value.error.message.length > maximumErrorMessageLength
  )
    throw new Error("CS486 worker error response is invalid");
  return {
    error: {
      code: value.error.code,
      message: value.error.message,
    },
    ok: false,
    protocolVersion,
    requestId: value.requestId,
  };
}

function normalizeWorkerResult(
  value: unknown,
  requestId: string,
  command: Cs486WorkerCommand,
  workerCount: number,
): Cs486WorkerCommandResult {
  if (
    !isRecord(value) ||
    value.protocolVersion !== protocolVersion ||
    value.requestId !== requestId ||
    value.command !== command.command ||
    value.computerId !== command.computerId ||
    value.processId !== command.processId ||
    value.workerCount !== workerCount ||
    !Number.isSafeInteger(value.workerIndex) ||
    (value.workerIndex as number) < 1 ||
    (value.workerIndex as number) > workerCount
  )
    throw new Error("CS486 worker result identity or placement is invalid");

  if (command.command === "dispose") {
    if (value.disposed !== true)
      throw new Error("CS486 worker did not confirm process disposal");
    return { command: "dispose", disposed: true };
  }

  if (!isRecord(value.view))
    throw new Error("CS486 worker result has no process view");
  const view = {
    ...value.view,
    workerCount,
    workerIndex: value.workerIndex as number,
  } as unknown as Cs486WorkerProcessView;
  if (command.command === "slice") {
    if (
      !isRecord(value.result) ||
      !Number.isSafeInteger(value.result.cpuCycles) ||
      !Number.isSafeInteger(value.result.executedInstructions)
    )
      throw new Error("CS486 worker slice result is invalid");
    return {
      command: "slice",
      result: {
        cpuCycles: value.result.cpuCycles as number,
        executedInstructions: value.result.executedInstructions as number,
      },
      view,
    };
  }
  return { command: command.command, view };
}

function requireWorkerCount(workerCount: number): void {
  if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 16)
    throw new RangeError("workerCount must be between 1 and 16");
}

function requirePositiveBoundedInteger(
  value: number,
  label: string,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new RangeError(`${label} must be between 1 and ${String(maximum)}`);
  return value;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function safeClose(socket: Cs486WorkerTextSocket): void {
  try {
    if (socket.isOpen) socket.close();
  } catch {
    // Closing is best-effort after every pending request has a final rejection.
  }
}

function transportError(message: string, cause: unknown): Error {
  const causeMessage =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "unknown error";
  return new Error(
    `CS486 worker transport ${message}: ${causeMessage}`.slice(
      0,
      maximumErrorMessageLength,
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
