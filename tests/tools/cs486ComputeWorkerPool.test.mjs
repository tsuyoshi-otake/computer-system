import { existsSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import {
  cs486ComputeEngineNames,
  cs486ComputeEngineWasmVariant,
  defaultCs486ComputeEngine,
} from "../../tools/cs486-compute-engine.mjs";
import {
  Cs486ComputeWorkerPool,
  createCs486ComputeWorkerPool,
  cs486ComputeWorkerPoolLimits,
  stableWorkerIndexForComputer,
} from "../../tools/cs486-compute-worker-pool.mjs";
import {
  cs486ComputeEngineNames as typedCs486ComputeEngineNames,
  defaultCs486ComputeEngineName,
} from "../../tools/cs486-compute-worker-cpu-engine.js";
import {
  readCs486WasmArtifactBytes,
  resolveCs486WasmArtifactPath,
} from "../../tools/cs486-wasm-batch-executor-loader.mjs";

// The Rust artifact is a gated Issue #106 build output. `npm run validate` must
// stay green without cargo, so the engine-parity suite skips when it is absent;
// every fail-loud assertion below runs unconditionally.
const rustArtifactPresent = existsSync(resolveCs486WasmArtifactPath("rust"));

const loopingExecutable = Object.freeze({
  dataBytes: 0,
  format: "cs486-executable",
  instructions: Object.freeze([
    {
      destination: "eax",
      op: "mov",
      source: { kind: "immediate", value: 1 },
    },
    {
      destination: "ebx",
      op: "add",
      source: { kind: "register", register: "eax" },
    },
    { op: "jmp", target: 1 },
  ]),
  version: 2,
});

const haltingExecutable = Object.freeze({
  dataBytes: 0,
  format: "cs486-executable",
  instructions: Object.freeze([
    {
      destination: "eax",
      op: "mov",
      source: { kind: "immediate", value: 42 },
    },
    { op: "halt" },
  ]),
  version: 2,
});

const pools = new Set();

afterEach(async () => {
  await Promise.allSettled([...pools].map((pool) => pool.close()));
  pools.clear();
});

async function createPool(workerCount, options = {}) {
  const pool = await createCs486ComputeWorkerPool({ ...options, workerCount });
  pools.add(pool);
  return pool;
}

function createCommand({
  computerId,
  processId,
  requestId,
  executable = loopingExecutable,
  collectMicroarchitectureStats = false,
}) {
  return {
    command: "create",
    computerId,
    executable,
    options: {
      collectMicroarchitectureStats,
      cpuModel: "cs486dx2",
      memoryBytes: 65_536,
    },
    processId,
    protocolVersion: 1,
    requestId,
  };
}

function sliceCommand({
  computerId,
  processId,
  requestId,
  tick,
  cpuCycleBudget = 10_000,
  instructionBudget = 1_000,
}) {
  return {
    command: "slice",
    computerId,
    cpuCycleBudget,
    instructionBudget,
    processId,
    protocolVersion: 1,
    requestId,
    tick,
  };
}

function comparableResponse(response) {
  const comparable = { ...response };
  delete comparable.requestId;
  delete comparable.workerCount;
  delete comparable.workerIndex;
  return comparable;
}

function observeSettlement(promise) {
  return promise.then(
    (value) => ({ status: "fulfilled", value }),
    (reason) => ({ reason, status: "rejected" }),
  );
}

describe("production CS486 compute worker pool", () => {
  it("uses exact deterministic one-based FNV-1a Computer affinity", () => {
    function expected(computerId, workerCount) {
      let hash = 0x81_1c_9d_c5;
      for (let index = 0; index < computerId.length; index += 1) {
        hash ^= computerId.charCodeAt(index);
        hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
      }
      return (hash % workerCount) + 1;
    }

    for (const computerId of ["computer-01", "c-abcdef", "portable-9"])
      for (const workerCount of [1, 2, 7, 16])
        expect(stableWorkerIndexForComputer(computerId, workerCount)).toBe(
          expected(computerId, workerCount),
        );
    expect(() => stableWorkerIndexForComputer("", 2)).toThrow(
      /bounded ASCII identifier/u,
    );
    expect(() => stableWorkerIndexForComputer("computer", 17)).toThrow(
      /between 1 and 16/u,
    );
  });

  it("retains deterministic process results across one and two workers", async () => {
    const oneWorker = await createPool(1);
    const twoWorkers = await createPool(2);
    const computerIds = ["computer-01", "computer-02"];

    for (const [index, computerId] of computerIds.entries()) {
      const processId = `process-${String(index + 1)}`;
      const collectMicroarchitectureStats = index === 1;
      const oneCreate = await oneWorker.request(
        createCommand({
          collectMicroarchitectureStats,
          computerId,
          processId,
          requestId: `one-create-${String(index)}`,
        }),
      );
      const twoCreate = await twoWorkers.request(
        createCommand({
          collectMicroarchitectureStats,
          computerId,
          processId,
          requestId: `two-create-${String(index)}`,
        }),
      );
      expect(comparableResponse(twoCreate)).toEqual(
        comparableResponse(oneCreate),
      );

      for (let tick = 1; tick <= 3; tick += 1) {
        const oneSlice = await oneWorker.request(
          sliceCommand({
            computerId,
            processId,
            requestId: `one-slice-${String(index)}-${String(tick)}`,
            tick,
          }),
        );
        const twoSlice = await twoWorkers.request(
          sliceCommand({
            computerId,
            processId,
            requestId: `two-slice-${String(index)}-${String(tick)}`,
            tick,
          }),
        );
        expect(comparableResponse(twoSlice)).toEqual(
          comparableResponse(oneSlice),
        );
        expect(twoSlice).toMatchObject({
          result: {
            cpuCycles: expect.any(Number),
            executedInstructions: 1_000,
            state: { kind: "ready" },
          },
          view: {
            hasPendingCpuCycles: false,
            memoryLimitBytes: 65_536,
            microarchitectureStatsEnabled: collectMicroarchitectureStats,
            output: "",
            state: { kind: "ready" },
          },
          workerCount: 2,
          workerIndex: stableWorkerIndexForComputer(computerId, 2),
        });
        if (collectMicroarchitectureStats)
          expect(
            twoSlice.view.microarchitectureStats.instructionFetches,
          ).toBeGreaterThan(0);
        else
          expect(twoSlice.view.microarchitectureStats).toEqual({
            busTransfers: 0,
            instructionFetches: 0,
            l1Hits: 0,
            l1Misses: 0,
            l2Hits: 0,
            l2Misses: 0,
            pipelineFlushes: 0,
            unalignedAccesses: 0,
          });
        expect(() => JSON.stringify(twoSlice)).not.toThrow();
      }
    }

    expect(twoWorkers.status()).toMatchObject({
      failed: false,
      ownedProcessCount: 2,
      pendingRequestCount: 0,
      state: "ready",
      workerCount: 2,
    });
  });

  it("finalizes terminate/fail controls and drains debt before idempotent disposal", async () => {
    const pool = await createPool(1);
    await pool.createProcess(
      createCommand({
        computerId: "computer-control",
        processId: "process-control",
        requestId: "create-control",
      }),
    );
    const partial = await pool.runSlice(
      sliceCommand({
        computerId: "computer-control",
        cpuCycleBudget: 1,
        instructionBudget: 1,
        processId: "process-control",
        requestId: "slice-control",
        tick: 1,
      }),
    );
    expect(partial.view.hasPendingCpuCycles).toBe(true);

    const terminated = await pool.terminateProcess({
      computerId: "computer-control",
      processId: "process-control",
      reason: "session closed",
      requestId: "terminate-control",
    });
    expect(terminated.view).toMatchObject({
      hasPendingCpuCycles: true,
      state: { kind: "terminated", reason: "session closed" },
    });
    await expect(
      pool.disposeProcess({
        computerId: "computer-control",
        processId: "process-control",
        requestId: "dispose-with-debt",
      }),
    ).rejects.toMatchObject({ code: "PROCESS_HAS_PENDING_CYCLES" });

    const drained = await pool.runSlice(
      sliceCommand({
        computerId: "computer-control",
        cpuCycleBudget: 100,
        instructionBudget: 1,
        processId: "process-control",
        requestId: "drain-control",
        tick: 2,
      }),
    );
    expect(drained).toMatchObject({
      result: {
        executedInstructions: 0,
        state: { kind: "terminated", reason: "session closed" },
      },
      view: { hasPendingCpuCycles: false },
    });
    await expect(
      pool.disposeProcess({
        computerId: "computer-control",
        processId: "process-control",
        requestId: "dispose-control",
      }),
    ).resolves.toMatchObject({ disposed: true });
    await expect(
      pool.disposeProcess({
        computerId: "computer-control",
        processId: "process-control",
        requestId: "dispose-control-again",
      }),
    ).resolves.toMatchObject({ disposed: true });
    await expect(
      pool.runSlice(
        sliceCommand({
          computerId: "computer-control",
          processId: "process-control",
          requestId: "slice-missing",
          tick: 3,
        }),
      ),
    ).rejects.toMatchObject({ code: "PROCESS_NOT_FOUND" });

    await pool.createProcess(
      createCommand({
        computerId: "computer-fail",
        processId: "process-fail",
        requestId: "create-fail",
      }),
    );
    const failed = await pool.failProcess({
      computerId: "computer-fail",
      error: { message: "connection lost", typeName: "TransportError" },
      processId: "process-fail",
      requestId: "fail-control",
    });
    expect(failed.view.state).toEqual({
      error: { message: "connection lost", typeName: "TransportError" },
      kind: "crashed",
    });
    expect(() => JSON.stringify(failed)).not.toThrow();
  });

  it("rejects malformed, duplicate, non-monotonic, and capacity-plus-one work", async () => {
    await expect(
      Cs486ComputeWorkerPool.create({ workerCount: 0 }),
    ).rejects.toThrow(/between 1 and 16/u);
    await expect(
      Cs486ComputeWorkerPool.create({ workerCount: 17 }),
    ).rejects.toThrow(/between 1 and 16/u);

    const pool = await createPool(1);
    await pool.request(
      createCommand({
        computerId: "computer-bounds",
        processId: "process-bounds",
        requestId: "create-bounds",
      }),
    );
    await expect(
      pool.request(
        createCommand({
          computerId: "computer-bounds",
          processId: "process-bounds",
          requestId: "create-duplicate",
        }),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_PROCESS" });
    await expect(
      pool.request(
        sliceCommand({
          computerId: "computer-bounds",
          instructionBudget:
            cs486ComputeWorkerPoolLimits.maximumInstructionsPerSlice + 1,
          processId: "process-bounds",
          requestId: "slice-too-large",
          tick: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      pool.request(
        sliceCommand({
          computerId: "computer-bounds",
          cpuCycleBudget:
            cs486ComputeWorkerPoolLimits.maximumCpuCyclesPerSlice + 1,
          processId: "process-bounds",
          requestId: "cycles-too-large",
          tick: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await pool.request(
      sliceCommand({
        computerId: "computer-bounds",
        processId: "process-bounds",
        requestId: "slice-tick-two",
        tick: 2,
      }),
    );
    await expect(
      pool.request(
        sliceCommand({
          computerId: "computer-bounds",
          processId: "process-bounds",
          requestId: "slice-tick-one",
          tick: 1,
        }),
      ),
    ).rejects.toMatchObject({ code: "NON_MONOTONIC_TICK" });
    await expect(
      pool.request(
        createCommand({
          computerId: "computer-invalid",
          executable: {
            format: "native-executable",
            instructions: [],
            version: 2,
          },
          processId: "process-invalid",
          requestId: "invalid-executable",
        }),
      ),
    ).rejects.toMatchObject({ code: "PROCESS_OPERATION_FAILED" });
    await expect(
      pool.request({
        ...createCommand({
          computerId: "computer-invalid",
          processId: "process-invalid-memory",
          requestId: "invalid-memory",
        }),
        options: {
          cpuModel: "cs486dx",
          memoryBytes: 65_535,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      pool.request({
        ...createCommand({
          computerId: "computer-invalid",
          processId: "process-invalid-cpu",
          requestId: "invalid-cpu",
        }),
        options: {
          cpuModel: "native-x86",
          memoryBytes: 65_536,
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    for (let index = 1; index < 128; index += 1)
      await pool.request(
        createCommand({
          computerId: `capacity-computer-${String(index)}`,
          processId: `capacity-process-${String(index)}`,
          requestId: `capacity-${String(index)}`,
        }),
      );
    expect(pool.status().ownedProcessCount).toBe(128);
    await expect(
      pool.request(
        createCommand({
          computerId: "capacity-computer-overflow",
          processId: "capacity-process-overflow",
          requestId: "capacity-overflow",
        }),
      ),
    ).rejects.toMatchObject({ code: "PROCESS_CAPACITY_EXCEEDED" });
  });

  it("uses a rejecting syscall handler without escaping the worker protocol", async () => {
    const pool = await createPool(1);
    await pool.createProcess(
      createCommand({
        computerId: "computer-syscall",
        executable: {
          dataBytes: 0,
          format: "cs486-executable",
          instructions: [{ name: "host.exec", op: "syscall" }],
          version: 2,
        },
        processId: "process-syscall",
        requestId: "create-syscall",
      }),
    );
    const response = await pool.runSlice(
      sliceCommand({
        computerId: "computer-syscall",
        processId: "process-syscall",
        requestId: "slice-syscall",
        tick: 1,
      }),
    );
    expect(response.view.state).toEqual({
      error: {
        message: "CS486 compute worker rejects syscall host.exec",
        typeName: "UnsupportedOperationError",
      },
      kind: "crashed",
    });
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it("rejects every pending request on worker exit and closes idempotently", async () => {
    const pool = await createPool(1);
    await pool.request(
      createCommand({
        computerId: "computer-crash",
        processId: "process-crash",
        requestId: "create-crash",
      }),
    );

    const requests = Array.from({ length: 64 }, (_, index) =>
      observeSettlement(
        pool.request(
          sliceCommand({
            computerId: "computer-crash",
            cpuCycleBudget:
              cs486ComputeWorkerPoolLimits.maximumCpuCyclesPerSlice,
            instructionBudget:
              cs486ComputeWorkerPoolLimits.maximumInstructionsPerSlice,
            processId: "process-crash",
            requestId: `crash-${String(index)}`,
            tick: index + 1,
          }),
        ),
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const pendingBeforeExit = pool.status().pendingRequestCount;
    expect(pendingBeforeExit).toBeGreaterThan(0);
    await pool.workers[0].worker.terminate();
    const settled = await Promise.all(requests);
    expect(
      settled.filter((result) => result.status === "rejected"),
    ).toHaveLength(pendingBeforeExit);
    expect(pool.status()).toMatchObject({
      failed: true,
      pendingRequestCount: 0,
      state: "failed",
      workers: [{ failed: true, pendingRequestCount: 0, workerIndex: 1 }],
    });
    await expect(
      pool.runSlice(
        sliceCommand({
          computerId: "computer-crash",
          processId: "process-crash",
          requestId: "no-fallback",
          tick: 100,
        }),
      ),
    ).rejects.toMatchObject({
      code: expect.stringMatching(/^WORKER_/u),
      workerIndex: 1,
    });

    const closeOne = pool.close();
    const closeTwo = pool.close();
    expect(closeTwo).toBe(closeOne);
    await closeOne;
    expect(pool.status()).toMatchObject({
      ownedProcessCount: 0,
      pendingRequestCount: 0,
      state: "closed",
    });
    await expect(
      pool.request(
        createCommand({
          computerId: "computer-closed",
          processId: "process-closed",
          requestId: "closed",
        }),
      ),
    ).rejects.toMatchObject({ code: "POOL_CLOSED" });

    const closePool = await createPool(1);
    await closePool.request(
      createCommand({
        computerId: "computer-close",
        processId: "process-close",
        requestId: "create-close",
      }),
    );
    const closeRequests = Array.from({ length: 257 }, (_, index) =>
      observeSettlement(
        closePool.request(
          sliceCommand({
            computerId: "computer-close",
            cpuCycleBudget:
              cs486ComputeWorkerPoolLimits.maximumCpuCyclesPerSlice,
            instructionBudget:
              cs486ComputeWorkerPoolLimits.maximumInstructionsPerSlice,
            processId: "process-close",
            requestId: `close-${String(index)}`,
            tick: index + 1,
          }),
        ),
      ),
    );
    await Promise.resolve();
    expect(closePool.status().pendingRequestCount).toBe(256);
    const closePendingOne = closePool.close();
    const closePendingTwo = closePool.close();
    expect(closePendingTwo).toBe(closePendingOne);
    await closePendingOne;
    const closeSettled = await Promise.all(closeRequests);
    expect(
      closeSettled.filter((result) => result.status === "rejected"),
    ).toHaveLength(257);
    expect(
      closeSettled.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason?.code === "WORKER_PENDING_CAPACITY_EXCEEDED",
      ),
    ).toHaveLength(1);
    expect(closePool.status()).toMatchObject({
      ownedProcessCount: 0,
      pendingRequestCount: 0,
      state: "closed",
    });
  });

  it("orders an immediate create/dispose pair on one worker", async () => {
    const pool = await createPool(1);
    const create = pool.request(
      createCommand({
        computerId: "computer-fifo",
        executable: haltingExecutable,
        processId: "process-fifo",
        requestId: "create-fifo",
      }),
    );
    const dispose = pool.disposeProcess({
      computerId: "computer-fifo",
      processId: "process-fifo",
      requestId: "dispose-fifo",
    });
    await expect(create).resolves.toMatchObject({ command: "create" });
    await expect(dispose).resolves.toMatchObject({
      command: "dispose",
      disposed: true,
    });
    expect(pool.status().ownedProcessCount).toBe(0);
  });
});

describe("CS486 compute engine selection", () => {
  it("keeps the .mjs and TypeScript engine registries identical", () => {
    // The pool, admin config, and CLI are `.mjs` while the worker engine is
    // typed `.ts`, and tsconfig has no `allowJs`, so the list is deliberately
    // declared twice. This test is the only thing keeping the twins honest: a
    // name added to one side alone must fail here, not silently produce a
    // configuration the worker rejects at startup.
    expect([...cs486ComputeEngineNames]).toEqual([
      ...typedCs486ComputeEngineNames,
    ]);
    expect(defaultCs486ComputeEngine).toBe(defaultCs486ComputeEngineName);
    expect(cs486ComputeEngineWasmVariant("typescript")).toBeNull();
    expect(cs486ComputeEngineWasmVariant("wasm-rust")).toBe("rust");
    expect(() => cs486ComputeEngineWasmVariant("wasm-unknown")).toThrow(
      /unknown CS486 compute engine wasm-unknown/u,
    );
  });

  it("defaults to the TypeScript engine and reports the engine each worker loaded", async () => {
    const pool = await createPool(2);
    expect(pool.status()).toMatchObject({
      cpuEngine: "typescript",
      state: "ready",
      workers: [{ cpuEngine: "typescript" }, { cpuEngine: "typescript" }],
    });
  });

  it("rejects an unknown engine before any worker thread is spawned", async () => {
    await expect(
      createCs486ComputeWorkerPool({
        cpuEngine: "wasm-unknown",
        workerCount: 1,
      }),
    ).rejects.toThrow(/unknown CS486 compute engine wasm-unknown/u);
  });

  it("fails pool creation when a wasm engine artifact will not compile", async () => {
    // Fail-loud is the whole contract: the operator asked for wasm, so a broken
    // artifact must take the pool - and therefore managed startup - down rather
    // than quietly serving guest results from the TypeScript interpreter.
    const pool = createCs486ComputeWorkerPool({
      cpuEngine: "wasm-rust",
      wasmModuleBytes: new Uint8Array([0, 1, 2, 3]),
      workerCount: 1,
    });
    await expect(pool).rejects.toThrow();
  });
});

describe.skipIf(!rustArtifactPresent)(
  "CS486 wasm-rust compute engine (requires the built Rust artifact)",
  () => {
    it("produces the same slice results as the TypeScript engine", async () => {
      const wasmModuleBytes = await readCs486WasmArtifactBytes("rust");
      const typescriptPool = await createPool(1);
      const wasmPool = await createPool(1, {
        cpuEngine: "wasm-rust",
        wasmModuleBytes,
      });
      expect(wasmPool.status()).toMatchObject({
        cpuEngine: "wasm-rust",
        state: "ready",
        workers: [{ cpuEngine: "wasm-rust" }],
      });

      for (const pool of [typescriptPool, wasmPool])
        await pool.createProcess(
          createCommand({
            computerId: "computer-engine",
            processId: "process-engine",
            requestId: "create-engine",
          }),
        );
      for (let tick = 1; tick <= 3; tick += 1) {
        const typescriptSlice = await typescriptPool.runSlice(
          sliceCommand({
            computerId: "computer-engine",
            processId: "process-engine",
            requestId: `ts-${String(tick)}`,
            tick,
          }),
        );
        const wasmSlice = await wasmPool.runSlice(
          sliceCommand({
            computerId: "computer-engine",
            processId: "process-engine",
            requestId: `wasm-${String(tick)}`,
            tick,
          }),
        );
        expect(comparableResponse(wasmSlice)).toEqual(
          comparableResponse(typescriptSlice),
        );
      }
    });

    it("reports the identical syscall rejection through the wire protocol", async () => {
      const pool = await createPool(1, {
        cpuEngine: "wasm-rust",
        wasmModuleBytes: await readCs486WasmArtifactBytes("rust"),
      });
      await pool.createProcess(
        createCommand({
          computerId: "computer-wasm-syscall",
          executable: {
            dataBytes: 0,
            format: "cs486-executable",
            instructions: [{ name: "host.exec", op: "syscall" }],
            version: 2,
          },
          processId: "process-wasm-syscall",
          requestId: "create-wasm-syscall",
        }),
      );
      const response = await pool.runSlice(
        sliceCommand({
          computerId: "computer-wasm-syscall",
          processId: "process-wasm-syscall",
          requestId: "slice-wasm-syscall",
          tick: 1,
        }),
      );
      expect(response.view.state).toEqual({
        error: {
          message: "CS486 compute worker rejects syscall host.exec",
          typeName: "UnsupportedOperationError",
        },
        kind: "crashed",
      });
    });
  },
);
