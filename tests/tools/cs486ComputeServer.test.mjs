import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import {
  CS486_COMPUTE_ADDRESS,
  CS486_COMPUTE_PATH,
  Cs486ComputeServer,
  createCs486ComputeServer,
  isLoopbackAddress,
} from "../../tools/cs486-compute-server.mjs";

const token = randomBytes(32).toString("hex");
const servers = new Set();
const clients = new Set();

afterEach(async () => {
  await Promise.allSettled([...servers].map((server) => server.stop()));
  servers.clear();
  for (const client of clients) {
    if (client.readyState !== WebSocket.CLOSED) client.terminate();
  }
  clients.clear();
});

describe("CS486 loopback compute server", () => {
  it("requires a 256-bit token, fixed endpoint, and reports pool status", async () => {
    const pool = createPool();
    expect(() => new Cs486ComputeServer({ pool, token: "too-short" })).toThrow(
      /256 bits/u,
    );
    expect(
      () =>
        new Cs486ComputeServer({
          pool,
          token,
          host: "0.0.0.0",
        }),
    ).toThrow(/fixed to 127\.0\.0\.1/u);
    expect(
      () =>
        new Cs486ComputeServer({
          pool,
          token,
          path: "/another-path",
        }),
    ).toThrow(/fixed to/u);

    const server = trackServer(
      createCs486ComputeServer({ pool, token: Buffer.alloc(32, 7), port: 0 }),
    );
    const idle = server.status();
    expect(idle).toMatchObject({
      state: "idle",
      running: false,
      address: CS486_COMPUTE_ADDRESS,
      port: 0,
      path: CS486_COMPUTE_PATH,
      connections: 0,
      pool: { state: "ready", workers: 2 },
      lastError: null,
    });

    const [first, second] = await Promise.all([server.start(), server.start()]);
    expect(first).toMatchObject({
      state: "running",
      address: "127.0.0.1",
      path: "/internal/cs486/v1",
    });
    expect(first.port).toBeGreaterThan(0);
    expect(second.port).toBe(first.port);
  });

  it("rejects missing or incorrect authentication, non-exact paths, and browser origins", async () => {
    const server = await startServer();
    const status = server.status();

    const missing = await rejectedConnection(status, {
      authorizationToken: null,
    });
    const wrong = await rejectedConnection(status, {
      authorizationToken: "b".repeat(64),
    });
    const queryPath = await rejectedConnection(status, {
      path: `${CS486_COMPUTE_PATH}?debug=1`,
    });
    const browserOrigin = await rejectedConnection(status, {
      headers: { Origin: "https://example.test" },
    });
    const browserFetch = await rejectedConnection(status, {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });

    for (const error of [
      missing,
      wrong,
      queryPath,
      browserOrigin,
      browserFetch,
    ]) {
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain(token);
    }
    expect(server.status().connections).toBe(0);

    const client = await connect(status);
    expect(client.readyState).toBe(WebSocket.OPEN);
    expect(server.status().connections).toBe(1);
  });

  it("recognizes only numeric loopback peer addresses", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("127.255.10.4")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);

    expect(isLoopbackAddress("0.0.0.0")).toBe(false);
    expect(isLoopbackAddress("192.168.1.2")).toBe(false);
    expect(isLoopbackAddress("::2")).toBe(false);
    expect(isLoopbackAddress("localhost")).toBe(false);
    expect(isLoopbackAddress("127.0.0.1.example")).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
  });

  it("turns listener startup failure into an idle terminal state", async () => {
    const owner = await startServer();
    const conflicting = trackServer(
      new Cs486ComputeServer({
        pool: createPool(),
        token,
        port: owner.status().port,
      }),
    );

    await expect(conflicting.start()).rejects.toThrow(
      "CS486 compute server failed to start.",
    );
    expect(conflicting.status()).toMatchObject({
      state: "idle",
      running: false,
      connections: 0,
    });
    await expect(conflicting.stop()).resolves.toMatchObject({ state: "idle" });
  });

  it("correlates out-of-order results and dispatches lifecycle controls", async () => {
    const deferred = new Map();
    const pool = createPool({
      request: vi.fn((command) => {
        if (command.command === "create" || command.command === "slice") {
          return new Promise((resolve) =>
            deferred.set(command.command, resolve),
          );
        }
        return Promise.resolve({ handled: command.command });
      }),
    });
    const server = await startServer(pool);
    const client = await connect(server.status());
    const responsesPromise = collectMessages(client, 5);

    for (const type of ["create", "slice", "dispose", "terminate", "fail"]) {
      sendRequest(client, {
        protocolVersion: 1,
        requestId: `request-${type}`,
        command: { type, processId: "p-1" },
      });
    }

    await vi.waitFor(() => {
      expect(pool.request).toHaveBeenCalledTimes(5);
    });
    expect(pool.request).toHaveBeenCalledWith({
      protocolVersion: 1,
      requestId: "request-create",
      command: "create",
      processId: "p-1",
    });
    deferred.get("slice")({ handled: "slice" });
    deferred.get("create")({ handled: "create" });

    const responses = await responsesPromise;
    expect(responses.map((response) => response.requestId).sort()).toEqual(
      [
        "request-create",
        "request-slice",
        "request-dispose",
        "request-terminate",
        "request-fail",
      ].sort(),
    );
    for (const response of responses) {
      expect(response).toEqual({
        protocolVersion: 1,
        requestId: response.requestId,
        ok: true,
        result: {
          handled: response.requestId.replace("request-", ""),
        },
      });
    }
  });

  it("adapts create, slice, dispose, terminate, and fail methods", async () => {
    const pool = {
      status: () => ({ state: "ready" }),
      createProcess: vi.fn(async () => ({ method: "createProcess" })),
      runSlice: vi.fn(async () => ({ method: "runSlice" })),
      disposeProcess: vi.fn(async () => ({ method: "disposeProcess" })),
      terminateProcess: vi.fn(async () => ({ method: "terminateProcess" })),
      failProcess: vi.fn(async () => ({ method: "failProcess" })),
    };
    const server = await startServer(pool);
    const client = await connect(server.status());
    const responsesPromise = collectMessages(client, 5);

    for (const type of ["create", "slice", "dispose", "terminate", "fail"]) {
      sendRequest(client, {
        protocolVersion: 1,
        requestId: type,
        command: { type },
      });
    }

    const responses = await responsesPromise;
    const results = new Map(
      responses.map((response) => [response.requestId, response.result.method]),
    );
    expect(Object.fromEntries(results)).toEqual({
      create: "createProcess",
      slice: "runSlice",
      dispose: "disposeProcess",
      terminate: "terminateProcess",
      fail: "failProcess",
    });
  });

  it("returns bounded correlated errors for malformed input and remains usable", async () => {
    const pool = createPool();
    const server = await startServer(pool);
    const client = await connect(server.status());
    const responsesPromise = collectMessages(client, 8);

    client.send("{");
    client.send("[]");
    sendRequest(client, {
      protocolVersion: 2,
      requestId: "wrong-version",
      command: { type: "create" },
    });
    sendRequest(client, {
      protocolVersion: 1,
      requestId: "x".repeat(129),
      command: { type: "create" },
    });
    sendRequest(client, {
      protocolVersion: 1,
      requestId: "unknown-command",
      command: { type: "launch" },
    });
    client.send(Buffer.from('{"protocolVersion":1}'));
    sendRequest(client, {
      protocolVersion: 1,
      requestId: 7,
      command: { type: "create" },
    });
    sendRequest(client, {
      protocolVersion: 1,
      requestId: "valid-after-errors",
      command: { type: "create" },
    });

    const responses = await responsesPromise;
    expect(responses.map(errorCode)).toEqual([
      "invalid_json",
      "invalid_request",
      "unsupported_protocol",
      "invalid_request_id",
      "unsupported_command",
      "invalid_request",
      "invalid_request_id",
      null,
    ]);
    expect(
      responses.find((response) => response.requestId === "wrong-version"),
    ).toMatchObject({
      protocolVersion: 1,
      requestId: "wrong-version",
      ok: false,
    });
    expect(responses.at(-1)).toEqual({
      protocolVersion: 1,
      requestId: "valid-after-errors",
      ok: true,
      result: { handled: "create" },
    });
    for (const response of responses.filter((value) => value.ok === false)) {
      expect(response.error.message.length).toBeLessThanOrEqual(500);
    }
  });

  it("rejects duplicate and capacity-plus-one requests without duplicate dispatch", async () => {
    const resolvers = [];
    const pool = createPool({
      request: vi.fn(
        (command) =>
          new Promise((resolve) => resolvers.push({ command, resolve })),
      ),
    });
    const server = await startServer(pool);
    const client = await connect(server.status());
    const duplicatePromise = waitForMessage(
      client,
      (message) => errorCode(message) === "duplicate_request",
    );

    const duplicate = {
      protocolVersion: 1,
      requestId: "duplicate",
      command: { type: "create" },
    };
    sendRequest(client, duplicate);
    sendRequest(client, duplicate);
    expect(await duplicatePromise).toMatchObject({
      requestId: "duplicate",
      ok: false,
      error: { code: "duplicate_request" },
    });

    const capacityPromise = waitForMessage(
      client,
      (message) => errorCode(message) === "capacity_exceeded",
    );
    for (let index = 1; index <= 256; index += 1) {
      sendRequest(client, {
        protocolVersion: 1,
        requestId: `capacity-${index}`,
        command: { type: "slice" },
      });
    }
    expect(await capacityPromise).toMatchObject({
      requestId: "capacity-256",
      ok: false,
      error: { code: "capacity_exceeded" },
    });
    expect(pool.request).toHaveBeenCalledTimes(256);

    for (const pending of resolvers) {
      pending.resolve({ handled: pending.command.command });
    }
  });

  it("closes an oversized payload and rejects a second active BDS connection", async () => {
    const server = await startServer();
    const first = await connect(server.status());
    const secondError = await rejectedConnection(server.status());
    expect(secondError.message).not.toContain(token);
    expect(server.status().connections).toBe(1);

    await closeClient(first);
    await vi.waitFor(() => {
      expect(server.status().connections).toBe(0);
    });

    const oversized = await connect(server.status());
    const closed = waitForClose(oversized);
    oversized.send("x".repeat(1024 * 1024 + 1));
    expect(await closed).toMatchObject({ code: 1009 });
    await vi.waitFor(() => {
      expect(server.status().connections).toBe(0);
    });
  });

  it("turns dispose-before-create and worker failures into secret-free terminal responses", async () => {
    const secretLog = `worker log contains ${token}`;
    const pool = createPool({
      request: vi.fn(async (command) => {
        throw new Error(`${command.command}: ${secretLog}`);
      }),
    });
    const server = await startServer(pool);
    const client = await connect(server.status());
    const responsesPromise = collectMessages(client, 2);

    sendRequest(client, {
      protocolVersion: 1,
      requestId: "dispose-before-create",
      command: { type: "dispose", processId: "missing" },
    });
    sendRequest(client, {
      protocolVersion: 1,
      requestId: "worker-failed",
      command: { type: "fail", processId: "p-1" },
    });

    const responses = await responsesPromise;
    for (const response of responses) {
      expect(response).toMatchObject({
        protocolVersion: 1,
        requestId: expect.any(String),
        ok: false,
        error: {
          code: "pool_error",
          message: "Compute pool request failed.",
        },
      });
      expect(JSON.stringify(response)).not.toContain(token);
      expect(JSON.stringify(response)).not.toContain(secretLog);
    }
  });

  it("waits for pending create and slice ownership before cleaning a closed connection", async () => {
    const pendingCreate = createDeferred();
    const pendingSlice = createDeferred();
    const pool = createPool({
      request: vi.fn((command) => {
        if (command.requestId === "pending-create") {
          return pendingCreate.promise;
        }
        if (command.requestId === "pending-slice") {
          return pendingSlice.promise;
        }
        if (command.command === "terminate") {
          return Promise.resolve(
            processResponse(command, {
              pendingCycles: false,
              stateKind: "terminated",
            }),
          );
        }
        if (command.command === "dispose") {
          return Promise.resolve({ disposed: true });
        }
        throw new Error("Unexpected cleanup command.");
      }),
    });
    const server = await startServer(pool);
    const client = await connect(server.status());

    sendActorRequest(client, "pending-create", "create", {
      computerId: "computer-a",
      processId: "process-a",
    });
    sendActorRequest(client, "pending-slice", "slice", {
      computerId: "computer-a",
      processId: "process-a",
      tick: 9,
    });
    await vi.waitFor(() => {
      expect(pool.request).toHaveBeenCalledTimes(2);
    });
    await closeClient(client);

    pendingCreate.resolve(
      processResponse(pool.request.mock.calls[0][0], {
        pendingCycles: false,
        stateKind: "ready",
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(pool.request.mock.calls.map(([command]) => command.command)).toEqual(
      ["create", "slice"],
    );

    pendingSlice.resolve(
      processResponse(pool.request.mock.calls[1][0], {
        pendingCycles: false,
        stateKind: "ready",
      }),
    );
    await vi.waitFor(() => {
      expect(
        pool.request.mock.calls.map(([command]) => command.command),
      ).toEqual(["create", "slice", "terminate", "dispose"]);
    });
    expect(server.status().cleanup).toEqual({
      active: 0,
      completed: 1,
      failed: 0,
    });
  });

  it("terminates before draining pending cycles with canonical maximum budgets and no replay", async () => {
    const pool = createPool({
      request: vi.fn(async (command) => {
        if (command.command === "create") {
          return processResponse(command, {
            pendingCycles: false,
            stateKind: "ready",
          });
        }
        if (
          command.command === "slice" &&
          command.requestId === "client-slice"
        ) {
          return processResponse(command, {
            executedInstructions: 1,
            pendingCycles: true,
            stateKind: "ready",
          });
        }
        if (command.command === "terminate") {
          return processResponse(command, {
            pendingCycles: true,
            stateKind: "terminated",
          });
        }
        if (command.command === "slice") {
          return processResponse(command, {
            executedInstructions: 0,
            pendingCycles: false,
            stateKind: "terminated",
          });
        }
        if (command.command === "dispose") return { disposed: true };
        throw new Error("Unexpected pool command.");
      }),
    });
    const server = await startServer(pool);
    const client = await connect(server.status());

    const createResponse = waitForMessage(
      client,
      (message) => message.requestId === "client-create",
    );
    sendActorRequest(client, "client-create", "create", {
      computerId: "computer-b",
      processId: "process-b",
    });
    await createResponse;
    const sliceResponse = waitForMessage(
      client,
      (message) => message.requestId === "client-slice",
    );
    sendActorRequest(client, "client-slice", "slice", {
      computerId: "computer-b",
      processId: "process-b",
      tick: 42,
    });
    await sliceResponse;
    await closeClient(client);

    await vi.waitFor(() => {
      expect(server.status().cleanup.completed).toBe(1);
    });
    const cleanupCommands = pool.request.mock.calls
      .map(([command]) => command)
      .filter((command) => command.requestId.startsWith("cleanup-"));
    expect(cleanupCommands.map((command) => command.command)).toEqual([
      "terminate",
      "slice",
      "dispose",
    ]);
    expect(cleanupCommands[1]).toMatchObject({
      command: "slice",
      computerId: "computer-b",
      cpuCycleBudget: 100_000_000,
      instructionBudget: 1_650_000,
      processId: "process-b",
      protocolVersion: 1,
      tick: 42,
    });
    expect(JSON.stringify(cleanupCommands)).not.toContain(token);
    expect(server.status().cleanup.failed).toBe(0);
  });

  it("makes stop await termination and exact idempotent disposal", async () => {
    const pendingTerminate = createDeferred();
    const pendingDispose = createDeferred();
    const pool = createPool({
      request: vi.fn((command) => {
        if (command.command === "create") {
          return Promise.resolve(
            processResponse(command, {
              pendingCycles: false,
              stateKind: "ready",
            }),
          );
        }
        if (command.command === "terminate") {
          return pendingTerminate.promise;
        }
        if (command.command === "dispose") return pendingDispose.promise;
        throw new Error("Unexpected pool command.");
      }),
    });
    const server = await startServer(pool);
    const client = await connect(server.status());
    const created = waitForMessage(
      client,
      (message) => message.requestId === "stop-create",
    );
    sendActorRequest(client, "stop-create", "create", {
      computerId: "computer-stop",
      processId: "process-stop",
    });
    await created;

    let stopSettled = false;
    const stopPromise = server.stop();
    void stopPromise.then(() => {
      stopSettled = true;
    });
    await vi.waitFor(() => {
      expect(
        pool.request.mock.calls.some(
          ([command]) => command.command === "terminate",
        ),
      ).toBe(true);
    });
    expect(stopSettled).toBe(false);

    const terminateCommand = pool.request.mock.calls.find(
      ([command]) => command.command === "terminate",
    )[0];
    pendingTerminate.resolve(
      processResponse(terminateCommand, {
        pendingCycles: false,
        stateKind: "terminated",
      }),
    );
    await vi.waitFor(() => {
      expect(
        pool.request.mock.calls.some(
          ([command]) => command.command === "dispose",
        ),
      ).toBe(true);
    });
    expect(stopSettled).toBe(false);

    pendingDispose.resolve({ disposed: true });
    await expect(stopPromise).resolves.toMatchObject({
      cleanup: { active: 0, completed: 1, failed: 0 },
      connections: 0,
      state: "idle",
    });
    expect(
      pool.request.mock.calls.filter(
        ([command]) => command.command === "terminate",
      ),
    ).toHaveLength(1);
    expect(
      pool.request.mock.calls.filter(
        ([command]) => command.command === "dispose",
      ),
    ).toHaveLength(1);
  });

  it("keeps a new connection outside the prior connection's actor cleanup", async () => {
    const firstTerminate = createDeferred();
    const pool = createPool({
      request: vi.fn((command) => {
        if (
          command.command === "terminate" &&
          command.processId === "process-first"
        ) {
          return firstTerminate.promise;
        }
        if (command.command === "terminate") {
          return Promise.resolve(
            processResponse(command, {
              pendingCycles: false,
              stateKind: "terminated",
            }),
          );
        }
        if (command.command === "dispose") {
          return Promise.resolve({ disposed: true });
        }
        return Promise.resolve(
          processResponse(command, {
            pendingCycles: false,
            stateKind: "ready",
          }),
        );
      }),
    });
    const server = await startServer(pool);
    const first = await connect(server.status());
    const firstCreated = waitForMessage(
      first,
      (message) => message.requestId === "first-create",
    );
    sendActorRequest(first, "first-create", "create", {
      computerId: "computer-first",
      processId: "process-first",
    });
    await firstCreated;
    await closeClient(first);
    await vi.waitFor(() => {
      expect(
        pool.request.mock.calls.some(
          ([command]) =>
            command.command === "terminate" &&
            command.processId === "process-first",
        ),
      ).toBe(true);
    });

    const second = await connect(server.status());
    const secondCreated = waitForMessage(
      second,
      (message) => message.requestId === "second-create",
    );
    sendActorRequest(second, "second-create", "create", {
      computerId: "computer-second",
      processId: "process-second",
    });
    await secondCreated;

    const firstTerminateCommand = pool.request.mock.calls.find(
      ([command]) =>
        command.command === "terminate" &&
        command.processId === "process-first",
    )[0];
    firstTerminate.resolve(
      processResponse(firstTerminateCommand, {
        pendingCycles: false,
        stateKind: "terminated",
      }),
    );
    await vi.waitFor(() => {
      expect(server.status().cleanup.completed).toBe(1);
    });
    expect(
      pool.request.mock.calls.filter(
        ([command]) =>
          command.requestId.startsWith("cleanup-") &&
          command.processId === "process-second",
      ),
    ).toHaveLength(0);
    expect(second.readyState).toBe(WebSocket.OPEN);

    const secondSlice = waitForMessage(
      second,
      (message) => message.requestId === "second-slice",
    );
    sendActorRequest(second, "second-slice", "slice", {
      computerId: "computer-second",
      processId: "process-second",
      tick: 3,
    });
    await expect(secondSlice).resolves.toMatchObject({
      ok: true,
      requestId: "second-slice",
    });
  });

  it("treats PROCESS_NOT_FOUND during cleanup as already finalized", async () => {
    const pool = createPool({
      request: vi.fn(async (command) => {
        if (command.command === "create") {
          return processResponse(command, {
            pendingCycles: false,
            stateKind: "ready",
          });
        }
        if (command.command === "terminate") {
          const error = new Error("Process disappeared.");
          error.code = "PROCESS_NOT_FOUND";
          throw error;
        }
        throw new Error("Cleanup continued after PROCESS_NOT_FOUND.");
      }),
    });
    const server = await startServer(pool);
    const client = await connect(server.status());
    const created = waitForMessage(
      client,
      (message) => message.requestId === "not-found-create",
    );
    sendActorRequest(client, "not-found-create", "create", {
      computerId: "computer-gone",
      processId: "process-gone",
    });
    await created;
    await closeClient(client);

    await vi.waitFor(() => {
      expect(server.status().cleanup.completed).toBe(1);
    });
    expect(pool.request.mock.calls.map(([command]) => command.command)).toEqual(
      ["create", "terminate"],
    );
    expect(server.status().cleanup.failed).toBe(0);
  });

  it("stops idempotently, closes active connections, and can restart", async () => {
    const server = await startServer();
    const firstPort = server.status().port;
    const client = await connect(server.status());
    const closed = waitForClose(client);

    const [firstStop, secondStop] = await Promise.all([
      server.stop(),
      server.stop(),
    ]);
    expect(firstStop).toMatchObject({
      state: "idle",
      running: false,
      connections: 0,
    });
    expect(secondStop).toEqual(firstStop);
    expect((await closed).code).toBe(1001);
    expect((await server.stop()).state).toBe("idle");

    const restarted = await server.start();
    expect(restarted.state).toBe("running");
    expect(restarted.port).toBeGreaterThan(0);
    expect(firstPort).toBeGreaterThan(0);
    const restartedClient = await connect(restarted);
    expect(restartedClient.readyState).toBe(WebSocket.OPEN);
  });
});

function createPool(overrides = {}) {
  return {
    status: () => ({ state: "ready", workers: 2 }),
    request: vi.fn(async (command) => ({ handled: command.command })),
    ...overrides,
  };
}

function trackServer(server) {
  servers.add(server);
  return server;
}

async function startServer(pool = createPool()) {
  const server = trackServer(new Cs486ComputeServer({ pool, token, port: 0 }));
  await server.start();
  return server;
}

function createClient(
  status,
  { authorizationToken = token, path = CS486_COMPUTE_PATH, headers = {} } = {},
) {
  const requestHeaders = { ...headers };
  if (authorizationToken !== null) {
    requestHeaders.Authorization = `Bearer ${authorizationToken}`;
  }
  const client = new WebSocket(`ws://${status.address}:${status.port}${path}`, {
    headers: requestHeaders,
  });
  clients.add(client);
  client.once("close", () => clients.delete(client));
  return client;
}

async function connect(status, options) {
  const client = createClient(status, options);
  return new Promise((resolve, reject) => {
    client.once("open", () => resolve(client));
    client.once("error", reject);
  });
}

async function rejectedConnection(status, options) {
  const client = createClient(status, options);
  return new Promise((resolve, reject) => {
    client.once("open", () => {
      reject(new Error("Rejected WebSocket connection unexpectedly opened."));
    });
    client.once("error", resolve);
    client.once("close", () => {
      reject(new Error("Rejected WebSocket connection closed without error."));
    });
  });
}

function sendRequest(client, value) {
  client.send(JSON.stringify(value));
}

function sendActorRequest(client, requestId, type, fields) {
  sendRequest(client, {
    command: { ...fields, type },
    protocolVersion: 1,
    requestId,
  });
}

function processResponse(
  command,
  { executedInstructions = 0, pendingCycles, stateKind },
) {
  return {
    command: command.command,
    computerId: command.computerId,
    processId: command.processId,
    protocolVersion: 1,
    requestId: command.requestId,
    result: {
      cpuCycles: 0,
      executedInstructions,
      state: { kind: stateKind },
    },
    view: {
      hasPendingCpuCycles: pendingCycles,
      state: { kind: stateKind },
    },
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function collectMessages(client, count) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const handleMessage = (data) => {
      try {
        messages.push(JSON.parse(data.toString()));
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      if (messages.length === count) {
        cleanup();
        resolve(messages);
      }
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before every response arrived."));
    };
    const cleanup = () => {
      client.off("message", handleMessage);
      client.off("error", handleError);
      client.off("close", handleClose);
    };
    client.on("message", handleMessage);
    client.once("error", handleError);
    client.once("close", handleClose);
  });
}

function waitForMessage(client, predicate) {
  return new Promise((resolve, reject) => {
    const handleMessage = (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (!predicate(message)) return;
        cleanup();
        resolve(message);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before the expected response."));
    };
    const cleanup = () => {
      client.off("message", handleMessage);
      client.off("error", handleError);
      client.off("close", handleClose);
    };
    client.on("message", handleMessage);
    client.once("error", handleError);
    client.once("close", handleClose);
  });
}

function waitForClose(client) {
  return new Promise((resolve) => {
    client.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function closeClient(client) {
  if (client.readyState === WebSocket.CLOSED) return;
  const closed = waitForClose(client);
  client.close(1000, "Test complete.");
  await closed;
}

function errorCode(response) {
  return response.ok === false ? response.error.code : null;
}
