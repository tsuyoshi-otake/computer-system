import { describe, expect, it, vi } from "vitest";

import {
  Cs486WorkerSocketTransport,
  type Cs486WorkerTextSocket,
} from "../../src/application/runtime/cs486WorkerSocketTransport.js";
import type { Cs486WorkerCommand } from "../../src/application/runtime/remoteCs486Process.js";

describe("Cs486WorkerSocketTransport", () => {
  it("uses one persistent connection and correlates out-of-order results", async () => {
    const socket = new ControlledSocket();
    const timers = new ControlledTimeouts();
    const connect = vi.fn(() => Promise.resolve(socket));
    const transport = createTransport(connect, timers);
    const first = transport.request(createCommand("computer-a", "p-1"));
    const second = transport.request(createCommand("computer-b", "p-2"));

    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    expect(connect).toHaveBeenCalledTimes(1);
    const firstWire = parseWireRequest(socket.sent[0]);
    const secondWire = parseWireRequest(socket.sent[1]);
    expect(firstWire.command.type).toBe("create");
    expect(firstWire.command).not.toHaveProperty("protocolVersion");

    socket.emitMessage(
      successEnvelope(secondWire, workerResult(secondWire, { workerIndex: 2 })),
    );
    socket.emitMessage(
      successEnvelope(firstWire, workerResult(firstWire, { workerIndex: 1 })),
    );

    await expect(first).resolves.toMatchObject({
      command: "create",
      view: { workerCount: 2, workerIndex: 1 },
    });
    await expect(second).resolves.toMatchObject({
      command: "create",
      view: { workerCount: 2, workerIndex: 2 },
    });
    expect(timers.size).toBe(0);
  });

  it("invalidates all commands with an unknown outcome on timeout and never replays them", async () => {
    const firstSocket = new ControlledSocket();
    const secondSocket = new ControlledSocket();
    const sockets = [firstSocket, secondSocket];
    const timers = new ControlledTimeouts();
    const connect = vi.fn(() => {
      const socket = sockets.shift();
      return socket === undefined
        ? Promise.reject(new Error("no controlled socket"))
        : Promise.resolve(socket);
    });
    const transport = createTransport(connect, timers);
    const first = transport.request(createCommand("computer-a", "p-1"));
    const second = transport.request(createCommand("computer-b", "p-2"));
    const firstRejection = expect(first).rejects.toThrow(/timed out/u);
    const secondRejection = expect(second).rejects.toThrow(/timed out/u);

    await vi.waitFor(() => expect(firstSocket.sent).toHaveLength(2));
    timers.fireFirst();
    await firstRejection;
    await secondRejection;
    expect(firstSocket.closeCalls).toBe(1);
    expect(firstSocket.sent).toHaveLength(2);

    const third = transport.request(createCommand("computer-c", "p-3"));
    await vi.waitFor(() => expect(secondSocket.sent).toHaveLength(1));
    expect(connect).toHaveBeenCalledTimes(2);
    const thirdWire = parseWireRequest(secondSocket.sent[0]);
    secondSocket.emitMessage(
      successEnvelope(thirdWire, workerResult(thirdWire, { workerIndex: 1 })),
    );
    await expect(third).resolves.toMatchObject({ command: "create" });
    expect(firstSocket.sent).toHaveLength(2);
  });

  it("rejects malformed correlation without leaking other pending commands", async () => {
    const socket = new ControlledSocket();
    const timers = new ControlledTimeouts();
    const transport = createTransport(() => Promise.resolve(socket), timers);
    const first = transport.request(createCommand("computer-a", "p-1"));
    const second = transport.request(createCommand("computer-b", "p-2"));
    const firstRejection = expect(first).rejects.toThrow(
      /unknown correlation id/u,
    );
    const secondRejection = expect(second).rejects.toThrow(
      /unknown correlation id/u,
    );

    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    socket.emitMessage(
      JSON.stringify({
        ok: true,
        protocolVersion: 1,
        requestId: "not-pending",
        result: {},
      }),
    );

    await firstRejection;
    await secondRejection;
    expect(socket.closeCalls).toBe(1);
    expect(timers.size).toBe(0);
  });

  it("keeps a valid server rejection isolated to its correlated command", async () => {
    const socket = new ControlledSocket();
    const timers = new ControlledTimeouts();
    const transport = createTransport(() => Promise.resolve(socket), timers);
    const rejected = transport.request(createCommand("computer-a", "p-1"));
    const accepted = transport.request(createCommand("computer-b", "p-2"));
    const rejection = expect(rejected).rejects.toThrow(
      /capacity_exceeded.*busy/u,
    );

    await vi.waitFor(() => expect(socket.sent).toHaveLength(2));
    const rejectedWire = parseWireRequest(socket.sent[0]);
    const acceptedWire = parseWireRequest(socket.sent[1]);
    socket.emitMessage(
      JSON.stringify({
        error: { code: "capacity_exceeded", message: "worker busy" },
        ok: false,
        protocolVersion: 1,
        requestId: rejectedWire?.requestId,
      }),
    );
    socket.emitMessage(
      successEnvelope(
        acceptedWire,
        workerResult(acceptedWire, { workerIndex: 2 }),
      ),
    );

    await rejection;
    await expect(accepted).resolves.toMatchObject({ command: "create" });
    expect(socket.closeCalls).toBe(0);
  });

  it("bounds pending admission before starting additional connections", async () => {
    const socket = new ControlledSocket();
    const timers = new ControlledTimeouts();
    const connect = vi.fn(() => Promise.resolve(socket));
    const transport = createTransport(connect, timers, {
      maximumPendingRequests: 1,
    });
    const admitted = transport.request(createCommand("computer-a", "p-1"));
    const rejected = transport.request(createCommand("computer-b", "p-2"));

    await expect(rejected).rejects.toThrow(/pending capacity/u);
    await vi.waitFor(() => expect(socket.sent).toHaveLength(1));
    expect(connect).toHaveBeenCalledTimes(1);
    const wire = parseWireRequest(socket.sent[0]);
    socket.emitMessage(
      successEnvelope(wire, workerResult(wire, { workerIndex: 1 })),
    );
    await expect(admitted).resolves.toMatchObject({ command: "create" });
  });
});

function createTransport(
  connect: () => Promise<Cs486WorkerTextSocket>,
  timers: ControlledTimeouts,
  overrides: { readonly maximumPendingRequests?: number } = {},
): Cs486WorkerSocketTransport {
  return new Cs486WorkerSocketTransport({
    cancelTimeout: (handle) => timers.cancel(handle),
    connect,
    maximumPendingRequests: overrides.maximumPendingRequests,
    requestTimeoutTicks: 20,
    scheduleTimeout: (listener, ticks) => timers.schedule(listener, ticks),
    workerCount: 2,
  });
}

class ControlledSocket implements Cs486WorkerTextSocket {
  isOpen = true;
  readonly sent: string[] = [];
  closeCalls = 0;
  private readonly closeListeners: Array<() => void> = [];
  private readonly messageListeners: Array<(payload: string) => void> = [];

  close(): void {
    this.closeCalls += 1;
    if (!this.isOpen) return;
    this.isOpen = false;
    for (const listener of this.closeListeners) listener();
  }

  send(payload: string): void {
    if (!this.isOpen) throw new Error("socket closed");
    this.sent.push(payload);
  }

  subscribeClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }

  subscribeMessage(listener: (payload: string) => void): void {
    this.messageListeners.push(listener);
  }

  emitMessage(payload: string): void {
    for (const listener of this.messageListeners) listener(payload);
  }
}

class ControlledTimeouts {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, () => void>();

  get size(): number {
    return this.callbacks.size;
  }

  schedule(listener: () => void, ticks: number): number {
    if (ticks < 1) throw new RangeError("controlled timeout must be positive");
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, listener);
    return handle;
  }

  cancel(handle: unknown): void {
    if (typeof handle === "number") this.callbacks.delete(handle);
  }

  fireFirst(): void {
    const entry = this.callbacks.entries().next().value;
    if (entry === undefined) throw new Error("no timeout scheduled");
    this.callbacks.delete(entry[0]);
    entry[1]();
  }
}

interface WireRequest {
  readonly command: Record<string, unknown> & {
    readonly computerId: string;
    readonly processId: string;
    readonly type: string;
  };
  readonly protocolVersion: 1;
  readonly requestId: string;
}

function parseWireRequest(payload: string | undefined): WireRequest {
  if (payload === undefined) throw new Error("missing controlled payload");
  return JSON.parse(payload) as WireRequest;
}

function createCommand(
  computerId: string,
  processId: string,
): Cs486WorkerCommand {
  return {
    command: "create",
    computerId,
    executable: {
      format: "cs486-executable",
      instructions: [],
      version: 1,
    },
    options: {
      collectMicroarchitectureStats: false,
      cpuModel: "cs386sx",
      memoryBytes: 1024 * 1024,
    },
    processId,
    protocolVersion: 1,
  };
}

function successEnvelope(request: WireRequest, result: unknown): string {
  return JSON.stringify({
    ok: true,
    protocolVersion: 1,
    requestId: request.requestId,
    result,
  });
}

function workerResult(
  request: WireRequest,
  placement: { readonly workerIndex: number },
): unknown {
  return {
    command: request.command.type,
    computerId: request.command.computerId,
    processId: request.command.processId,
    protocolVersion: 1,
    requestId: request.requestId,
    view: {
      hasPendingCpuCycles: false,
      memoryLimitBytes: 1024 * 1024,
      memoryUsageBytes: 0,
      microarchitectureStats: {
        busTransfers: 0,
        instructionFetches: 0,
        l1Hits: 0,
        l1Misses: 0,
        l2Hits: 0,
        l2Misses: 0,
        pipelineFlushes: 0,
        unalignedAccesses: 0,
      },
      microarchitectureStatsEnabled: false,
      output: "",
      state: { kind: "ready" },
    },
    workerCount: 2,
    workerIndex: placement.workerIndex,
  } satisfies Record<string, unknown>;
}
