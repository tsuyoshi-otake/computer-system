import { describe, expect, it } from "vitest";

import { BdsWebCompanionLifecycle } from "../../tools/bds-web-companion.mjs";

const token = Buffer.alloc(32, 3).toString("base64url");

describe("BDS Web companion lifecycle", () => {
  it("boots the real two-worker pool and loopback listener before the managed BDS adapter", async () => {
    const lifecycle = new BdsWebCompanionLifecycle({
      environment: {
        WEB_COMPANION_AUTO_OPEN: "0",
      },
      loadAdminConfig: async () => ({}),
      randomToken: () => token,
      createBds: () => ({
        async start() {
          return {
            address: "127.0.0.1",
            port: 19_142,
            world: "ComputerSystemMcpDebug",
          };
        },
        async stop() {},
        getStatus() {
          return { ready: true, running: true, state: "running" };
        },
        onLog() {
          return () => undefined;
        },
      }),
      createWeb: () => ({
        async start() {
          return { address: "127.0.0.1", port: 19_144 };
        },
        async stop() {},
        status() {
          return { running: true, state: "running" };
        },
      }),
    });
    try {
      const status = await lifecycle.start();
      expect(status.compute).toMatchObject({
        address: "127.0.0.1",
        path: "/internal/cs486/v1",
        running: true,
        pool: {
          state: "ready",
          workerCount: 2,
        },
      });
      expect(status.compute.port).toBeGreaterThan(0);
    } finally {
      await lifecycle.stop();
    }
  });

  it("starts the compute listener before BDS and cleans every resource exactly once", async () => {
    const events = [];
    let bdsOptions;
    const lifecycle = createLifecycle({
      events,
      onBdsOptions: (value) => {
        bdsOptions = value;
      },
    });

    const status = await lifecycle.start();
    expect(events).toEqual([
      "pool:create:2",
      "listener:create",
      "listener:start",
      "web:create",
      "web:start",
      "bds:start:false",
    ]);
    expect(bdsOptions.runtimeWorkers).toEqual({
      count: 2,
      endpoint: "ws://127.0.0.1:29481/internal/cs486/v1",
      token,
    });
    expect(status).toMatchObject({
      state: "running",
      running: true,
      runtimeWorkerCount: 2,
    });
    expect(JSON.stringify(status)).not.toContain(token);

    await lifecycle.stop();
    await lifecycle.stop();
    expect(events).toEqual([
      "pool:create:2",
      "listener:create",
      "listener:start",
      "web:create",
      "web:start",
      "bds:start:false",
      "bds:stop",
      "web:stop",
      "listener:stop",
      "pool:close",
      "bds:unsubscribe",
    ]);
  });

  it("hands the selected CPU engine to the pool and reports it as observed configuration", async () => {
    const events = [];
    let poolOptions;
    const lifecycle = createLifecycle({
      environment: { WEB_COMPANION_CPU_ENGINE: "wasm-rust" },
      events,
      onPoolOptions: (value) => {
        poolOptions = value;
      },
    });

    const status = await lifecycle.start();
    expect(poolOptions).toEqual({
      cpuEngine: "wasm-rust",
      workerCount: 2,
    });
    expect(status).toMatchObject({ cpuEngine: "wasm-rust" });
    expect(status.webConfiguration.environmentOverrides).toMatchObject({
      cpuEngine: true,
    });

    await lifecycle.stop();
  });

  it("fails managed startup when the selected engine cannot load, never falling back", async () => {
    const events = [];
    const lifecycle = createLifecycle({
      environment: { WEB_COMPANION_CPU_ENGINE: "wasm-rust" },
      events,
      poolCreateError: new Error(
        'missing cs486 wasm artifact; run "npm run build:cs486-wasm" first',
      ),
    });

    await expect(lifecycle.start()).rejects.toThrow(
      /missing cs486 wasm artifact/u,
    );
    // Nothing after the pool was admitted, and no second pool was created with a
    // substituted engine.
    expect(events).toEqual(["pool:create:2"]);
    expect(lifecycle.status()).toMatchObject({
      cpuEngine: "wasm-rust",
      running: false,
      state: "failed",
    });
  });

  it("cleans all admitted resources when BDS startup fails", async () => {
    const events = [];
    const lifecycle = createLifecycle({
      bdsStartError: new Error("script bootstrap failed"),
      events,
    });

    await expect(lifecycle.start()).rejects.toThrow("script bootstrap failed");
    expect(events).toEqual([
      "pool:create:2",
      "listener:create",
      "listener:start",
      "web:create",
      "web:start",
      "bds:start:false",
      "bds:stop",
      "web:stop",
      "listener:stop",
      "pool:close",
      "bds:unsubscribe",
    ]);
    expect(lifecycle.status()).toMatchObject({
      state: "failed",
      running: false,
      lastError: "script bootstrap failed",
    });
    await lifecycle.stop();
    expect(events.filter((event) => event.endsWith(":stop"))).toHaveLength(3);
    expect(events.filter((event) => event === "pool:close")).toHaveLength(1);
  });

  it("waits for an in-flight pool creation before cancelling startup and cleanup", async () => {
    const events = [];
    let resolvePool;
    const poolPromise = new Promise((resolve) => {
      resolvePool = resolve;
    });
    const lifecycle = createLifecycle({
      events,
      createPool: async ({ workerCount }) => {
        events.push(`pool:create:${String(workerCount)}`);
        return poolPromise;
      },
    });

    const startPromise = lifecycle.start();
    await Promise.resolve();
    const stopPromise = lifecycle.stop();
    resolvePool({
      async close() {
        events.push("pool:close");
      },
      status() {
        return { state: "ready", workerCount: 2 };
      },
    });

    await expect(startPromise).rejects.toThrow("startup was cancelled");
    await stopPromise;
    expect(events).toEqual(["pool:create:2", "pool:close"]);
  });
});

function createLifecycle(options) {
  const events = options.events;
  return new BdsWebCompanionLifecycle({
    adminConfigPath: undefined,
    environment: {
      WEB_COMPANION_AUTO_OPEN: "0",
      ...options.environment,
    },
    loadAdminConfig: async () => ({}),
    randomToken: () => token,
    createPool:
      options.createPool ??
      (async (poolOptions) => {
        options.onPoolOptions?.(poolOptions);
        const { workerCount } = poolOptions;
        events.push(`pool:create:${String(workerCount)}`);
        if (options.poolCreateError !== undefined)
          throw options.poolCreateError;
        return {
          async close() {
            events.push("pool:close");
          },
          status() {
            return { state: "ready", workerCount };
          },
        };
      }),
    createComputeServer: () => {
      events.push("listener:create");
      return {
        async start() {
          events.push("listener:start");
          return {
            address: "127.0.0.1",
            path: "/internal/cs486/v1",
            port: 29_481,
            running: true,
            state: "running",
          };
        },
        async stop() {
          events.push("listener:stop");
        },
        status() {
          return {
            address: "127.0.0.1",
            path: "/internal/cs486/v1",
            port: 29_481,
            running: true,
            state: "running",
          };
        },
      };
    },
    createBds: (bdsOptions) => {
      options.onBdsOptions?.(bdsOptions);
      return {
        async start({ resetWorld }) {
          events.push(`bds:start:${String(resetWorld)}`);
          if (options.bdsStartError !== undefined) {
            throw options.bdsStartError;
          }
          return {
            address: "127.0.0.1",
            port: 19_142,
            world: "ComputerSystemMcpDebug",
          };
        },
        async stop() {
          events.push("bds:stop");
        },
        getStatus() {
          return { ready: true, running: true, state: "running" };
        },
        onLog() {
          return () => events.push("bds:unsubscribe");
        },
      };
    },
    createWeb: () => {
      events.push("web:create");
      return {
        async start() {
          events.push("web:start");
          return { address: "127.0.0.1", port: 19_144 };
        },
        async stop() {
          events.push("web:stop");
        },
        status() {
          return { running: true, state: "running" };
        },
      };
    },
  });
}
