import { describe, expect, it } from "vitest";

import {
  RemoteCs486ProcessFactory,
  stableWorkerIndexForComputer,
  type Cs486WorkerCommand,
  type Cs486WorkerCommandResult,
  type Cs486WorkerProcessView,
  type Cs486WorkerTransport,
} from "../../src/application/runtime/remoteCs486Process.js";
import type { Cs486Executable } from "../../src/domain/cpu/cs486.js";

const executable: Cs486Executable = {
  format: "cs486-executable",
  instructions: [],
  version: 2,
};

describe("remote CS486 process", (): void => {
  it("keeps CS386SX execution on the Computer's stable worker", async (): Promise<void> => {
    const transport = new ControlledTransport(2);
    const factory = new RemoteCs486ProcessFactory(transport);
    const process = factory.create({
      collectMicroarchitectureStats: false,
      computerId: "c-portable-386",
      cpuModel: "cs386sx",
      executable,
      memoryBytes: 2 * 1_048_576,
      runtimeId: 41,
    });
    const workerIndex = stableWorkerIndexForComputer("c-portable-386", 2);

    expect(process.executionLocation).toEqual({
      backend: "worker",
      workerCount: 2,
      workerIndex,
    });
    expect(process.schedulerResourceId).toBe(`cs486-worker-${workerIndex}`);
    expect(transport.commands[0]).toMatchObject({
      command: "create",
      computerId: "c-portable-386",
      options: { cpuModel: "cs386sx", memoryBytes: 2 * 1_048_576 },
    });

    transport.resolveNext({
      command: "create",
      view: workerView(workerIndex, 2),
    });
    await settlePromises();
    process.advanceTick(1);

    expect(process.runCpuSlice(1_000, 160)).toEqual({
      admittedCpuCycles: 1_000,
      admittedInstructions: 160,
      cpuCycles: 0,
      executedInstructions: 0,
      state: { kind: "ready" },
    });
    expect(transport.commands[1]).toMatchObject({
      command: "slice",
      computerId: "c-portable-386",
      cpuCycleBudget: 1_000,
      instructionBudget: 160,
      tick: 1,
    });

    transport.resolveNext({
      command: "slice",
      result: { cpuCycles: 750, executedInstructions: 120 },
      view: workerView(workerIndex, 2, {
        output: "386-ok",
        state: { kind: "completed", value: 7 },
      }),
    });
    await settlePromises();

    expect(process.runCpuSlice(1_000, 160)).toEqual({
      cpuCycles: 750,
      executedInstructions: 120,
      state: { kind: "completed", value: 7 },
    });
    expect(process.output).toBe("386-ok");
    expect(transport.commands).toHaveLength(2);
  });

  it("serializes terminate behind an in-flight slice and preserves local finalization", async (): Promise<void> => {
    const transport = new ControlledTransport(2);
    const process = new RemoteCs486ProcessFactory(transport).create({
      collectMicroarchitectureStats: true,
      computerId: "c-000002",
      cpuModel: "cs486dx",
      executable,
      memoryBytes: 4_096,
      runtimeId: 2,
    });
    const workerIndex = stableWorkerIndexForComputer("c-000002", 2);
    transport.resolveNext({
      command: "create",
      view: workerView(workerIndex, 2),
    });
    await settlePromises();

    process.advanceTick(3);
    process.runCpuSlice(500, 50);
    expect(process.terminate("operator stop")).toEqual({
      kind: "terminated",
      reason: "operator stop",
    });
    expect(transport.commands.map(({ command }) => command)).toEqual([
      "create",
      "slice",
    ]);

    transport.resolveNext({
      command: "slice",
      result: { cpuCycles: 400, executedInstructions: 40 },
      view: workerView(workerIndex, 2),
    });
    await settlePromises();
    expect(transport.commands[2]).toMatchObject({
      command: "terminate",
      reason: "operator stop",
    });
    expect(process.state).toEqual({
      kind: "terminated",
      reason: "operator stop",
    });

    transport.resolveNext({
      command: "terminate",
      view: workerView(workerIndex, 2, {
        state: { kind: "terminated", reason: "operator stop" },
      }),
    });
    await settlePromises();
    expect(process.runCpuSlice(500, 50)).toMatchObject({
      cpuCycles: 400,
      executedInstructions: 40,
      state: { kind: "terminated", reason: "operator stop" },
    });
  });

  it("turns an invalid worker settlement into an explicit process crash", async (): Promise<void> => {
    const transport = new ControlledTransport(2);
    const process = new RemoteCs486ProcessFactory(transport).create({
      collectMicroarchitectureStats: false,
      computerId: "c-000003",
      cpuModel: "cs486dx2",
      executable,
      memoryBytes: 4_096,
      runtimeId: 3,
    });
    const workerIndex = stableWorkerIndexForComputer("c-000003", 2);
    transport.resolveNext({
      command: "create",
      view: workerView(workerIndex, 2),
    });
    await settlePromises();

    process.advanceTick(1);
    process.runCpuSlice(100, 10);
    transport.resolveNext({
      command: "slice",
      result: { cpuCycles: 101, executedInstructions: 10 },
      view: workerView(workerIndex, 2),
    });
    await settlePromises();

    expect(process.state.kind).toBe("crashed");
    if (process.state.kind !== "crashed")
      throw new Error("remote process did not crash");
    expect(process.state.error.typeName).toBe("WorkerTransportError");
    expect(process.state.error.message).toMatch(/reserved CPU cycle budget/u);
  });

  it("disposes a process exactly once even before create acknowledgement", async (): Promise<void> => {
    const transport = new ControlledTransport(2);
    const process = new RemoteCs486ProcessFactory(transport).create({
      collectMicroarchitectureStats: false,
      computerId: "c-000004",
      cpuModel: "cs386sx",
      executable,
      memoryBytes: 4_096,
      runtimeId: 4,
    });
    const workerIndex = stableWorkerIndexForComputer("c-000004", 2);

    process.dispose?.();
    process.dispose?.();
    transport.resolveNext({
      command: "create",
      view: workerView(workerIndex, 2),
    });
    await settlePromises();

    expect(transport.commands.map(({ command }) => command)).toEqual([
      "create",
      "dispose",
    ]);
  });
});

class ControlledTransport implements Cs486WorkerTransport {
  readonly commands: Cs486WorkerCommand[] = [];
  private readonly pending: {
    readonly reject: (error: unknown) => void;
    readonly resolve: (result: Cs486WorkerCommandResult) => void;
  }[] = [];

  constructor(readonly workerCount: number) {}

  request(command: Cs486WorkerCommand): Promise<Cs486WorkerCommandResult> {
    this.commands.push(command);
    return new Promise((resolve, reject) => {
      this.pending.push({ reject, resolve });
    });
  }

  resolveNext(result: Cs486WorkerCommandResult): void {
    const pending = this.pending.shift();
    if (pending === undefined) throw new Error("no pending worker request");
    pending.resolve(result);
  }
}

function workerView(
  workerIndex: number,
  workerCount: number,
  overrides: Partial<Cs486WorkerProcessView> = {},
): Cs486WorkerProcessView {
  return {
    hasPendingCpuCycles: false,
    memoryLimitBytes: 4_096,
    memoryUsageBytes: 128,
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
    workerCount,
    workerIndex,
    ...overrides,
  };
}

async function settlePromises(): Promise<void> {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}
