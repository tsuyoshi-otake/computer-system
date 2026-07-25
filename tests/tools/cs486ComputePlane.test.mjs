import { describe, expect, it } from "vitest";

import { startCs486ComputePlane } from "../../tools/cs486-compute-plane.mjs";

const token = Buffer.alloc(32, 5).toString("base64url");

describe("CS486 compute plane", () => {
  it("starts the pool before the listener and publishes the exact loopback endpoint", async () => {
    const events = [];
    const plane = await startCs486ComputePlane(createOptions({ events }));

    expect(events).toEqual(["pool:create:2:wasm-rust", "listener:start"]);
    expect(plane.count).toBe(2);
    expect(plane.endpoint).toBe("ws://127.0.0.1:29481/internal/cs486/v1");
    expect(plane.token).toBe(token);
    expect(plane.status()).toMatchObject({
      address: "127.0.0.1",
      path: "/internal/cs486/v1",
      running: true,
    });

    await plane.stop();
    expect(events).toEqual([
      "pool:create:2:wasm-rust",
      "listener:start",
      "listener:stop",
      "pool:close",
    ]);
  });

  it("stops the listener and every worker exactly once", async () => {
    const events = [];
    const plane = await startCs486ComputePlane(createOptions({ events }));

    await Promise.all([plane.stop(), plane.stop()]);
    await plane.stop();

    expect(events.filter((event) => event === "listener:stop")).toHaveLength(1);
    expect(events.filter((event) => event === "pool:close")).toHaveLength(1);
    expect(plane.status()).toBeNull();
  });

  it("keeps the secret out of the reported status", async () => {
    const events = [];
    const plane = await startCs486ComputePlane(createOptions({ events }));
    try {
      expect(JSON.stringify(plane.status())).not.toContain(token);
    } finally {
      await plane.stop();
    }
  });

  it("admits nothing when the selected engine cannot load", async () => {
    const events = [];
    await expect(
      startCs486ComputePlane(
        createOptions({
          events,
          poolCreateError: new Error(
            'missing cs486 wasm artifact; run "npm run build:cs486-wasm" first',
          ),
        }),
      ),
    ).rejects.toThrow(/missing cs486 wasm artifact/u);
    // No listener, and no second pool created with a substituted engine.
    expect(events).toEqual(["pool:create:2:wasm-rust"]);
  });

  it("closes the pool when the listener fails to start", async () => {
    const events = [];
    await expect(
      startCs486ComputePlane(
        createOptions({
          events,
          listenerStartError: new Error("EADDRINUSE"),
        }),
      ),
    ).rejects.toThrow("EADDRINUSE");
    expect(events).toEqual([
      "pool:create:2:wasm-rust",
      "listener:start",
      "listener:stop",
      "pool:close",
    ]);
  });

  it("rejects a listener that is not the exact authenticated loopback endpoint", async () => {
    for (const listenerStatus of [
      {
        address: "0.0.0.0",
        path: "/internal/cs486/v1",
        port: 29_481,
        running: true,
      },
      {
        address: "127.0.0.1",
        path: "/internal/cs486/v2",
        port: 29_481,
        running: true,
      },
      {
        address: "127.0.0.1",
        path: "/internal/cs486/v1",
        port: 0,
        running: true,
      },
      {
        address: "127.0.0.1",
        path: "/internal/cs486/v1",
        port: 29_481,
        running: false,
      },
    ]) {
      const events = [];
      await expect(
        startCs486ComputePlane(createOptions({ events, listenerStatus })),
      ).rejects.toThrow("CS486 compute listener returned an invalid status.");
      expect(events).toEqual([
        "pool:create:2:wasm-rust",
        "listener:start",
        "listener:stop",
        "pool:close",
      ]);
    }
  });

  it("rejects a token generator that does not return 256 bits", async () => {
    const events = [];
    await expect(
      startCs486ComputePlane(
        createOptions({ events, randomToken: () => "short-token" }),
      ),
    ).rejects.toThrow(
      "Runtime worker token generator did not return 256 bits.",
    );
    // The pool is never created, so a weak secret cannot reach a worker.
    expect(events).toEqual([]);
  });

  it("cleans up what it admitted when the caller cancels startup", async () => {
    const events = [];
    await expect(
      startCs486ComputePlane(
        createOptions({
          events,
          assertActive: () => {
            throw new Error("startup was cancelled");
          },
        }),
      ),
    ).rejects.toThrow("startup was cancelled");
    expect(events).toEqual(["pool:create:2:wasm-rust", "pool:close"]);
  });
});

function createOptions(options) {
  const events = options.events;
  const listenerStatus = options.listenerStatus ?? {
    address: "127.0.0.1",
    path: "/internal/cs486/v1",
    port: 29_481,
    running: true,
    state: "running",
  };
  return {
    assertActive: options.assertActive,
    cpuEngine: "wasm-rust",
    workerCount: 2,
    randomToken: options.randomToken ?? (() => token),
    createPool: async ({ cpuEngine, workerCount }) => {
      events.push(`pool:create:${String(workerCount)}:${String(cpuEngine)}`);
      if (options.poolCreateError !== undefined) throw options.poolCreateError;
      return {
        async close() {
          events.push("pool:close");
        },
        status() {
          return { state: "ready", workerCount };
        },
      };
    },
    createComputeServer: () => ({
      async start() {
        events.push("listener:start");
        if (options.listenerStartError !== undefined) {
          throw options.listenerStartError;
        }
        return listenerStatus;
      },
      async stop() {
        events.push("listener:stop");
      },
      status() {
        return listenerStatus;
      },
    }),
  };
}
