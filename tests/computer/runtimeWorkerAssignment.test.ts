import { describe, expect, it, vi } from "vitest";

import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
} from "../../src/application/computer/computerRuntime.js";
import {
  RemoteCs486ProcessFactory,
  stableWorkerIndexForComputer,
  type Cs486WorkerCommand,
  type Cs486WorkerCommandResult,
  type Cs486WorkerProcessView,
  type Cs486WorkerTransport,
  type ObservableCs486Process,
} from "../../src/application/runtime/remoteCs486Process.js";
import type {
  DosGuestMemoryManager,
  DosGuestProcessGrant,
} from "../../src/application/os/dosGuestMemoryManager.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import type {
  CpuProcess,
  CpuProcessState,
} from "../../src/domain/runtime/cpuProcess.js";

const rawExecutable = Object.freeze({
  dataBytes: 0,
  format: "cs486-executable" as const,
  instructions: Object.freeze([
    {
      destination: "eax" as const,
      op: "mov" as const,
      source: { kind: "immediate" as const, value: 7 },
    },
    { op: "halt" as const },
  ]),
  version: 2 as const,
});

describe("ComputerRuntime worker assignment", (): void => {
  it("runs a portable raw ABI executable on its stable CS386SX worker", async (): Promise<void> => {
    const transport = new CompletingWorkerTransport(3);
    const runtime = new ComputerRuntime({
      remoteCs486ProcessFactory: new RemoteCs486ProcessFactory(transport),
    });
    const record = portableRecord("c-000901");
    startRuntime(runtime, record);
    installRawExecutable(record, "RAW.CSX");
    const baselineMemory = runtime.guestMemoryStatus(record.computerId);
    const completions: DebugShellCommandCompletion[] = [];

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "C:\\RAW.CSX",
      (result) => completions.push(result),
    );

    const workerIndex = stableWorkerIndexForComputer(record.computerId, 3);
    expect(record.hardware).toEqual({
      clockHz: 16_000_000,
      cpuModel: "cs386sx",
      memoryBytes: 2_097_152,
    });
    expect(runtime.executionStatus(record.computerId)).toEqual({
      activeBackend: "worker",
      assignedWorkerIndex: workerIndex,
      workerCount: 3,
    });
    expect(transport.commands[0]).toMatchObject({
      command: "create",
      computerId: record.computerId,
      executable: rawExecutable,
      options: {
        collectMicroarchitectureStats: false,
        cpuModel: "cs386sx",
      },
    });

    await runUntilCompleted(runtime, completions);

    expect(completions).toEqual([
      {
        cpuCycles: 48,
        exitCode: 0,
        outcome: "completed",
        stderr: "",
        stdout: "cs386sx raw ABI\n",
      },
    ]);
    expect(transport.commands).toEqual([
      expect.objectContaining({ command: "create" }),
      expect.objectContaining({
        command: "slice",
        cpuCycleBudget: 800_000,
        instructionBudget: 800_000,
      }),
      expect.objectContaining({ command: "dispose" }),
    ]);
    const slice = transport.commands[1];
    expect(slice?.command).toBe("slice");
    if (slice?.command !== "slice")
      throw new Error("worker slice command was not dispatched");
    expect(Number.isSafeInteger(slice.tick)).toBe(true);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );
    expect(runtime.executionStatus(record.computerId)).toEqual({
      activeBackend: "idle",
      assignedWorkerIndex: workerIndex,
      workerCount: 3,
    });
  });

  it("finalizes remote process, PID, and memory exactly once when scheduler admission fails", async (): Promise<void> => {
    const transport = new CompletingWorkerTransport(2);
    const factory = new RemoteCs486ProcessFactory(transport);
    const runtime = new ComputerRuntime({
      remoteCs486ProcessFactory: factory,
    });
    const record = portableRecord("c-000902");
    startRuntime(runtime, record);
    installRawExecutable(record, "REJECT.CSX");
    const baselineMemory = runtime.guestMemoryStatus(record.computerId);
    const baselinePids =
      record.osRuntimeSnapshot?.processes.map(
        (process) => (process as { pid: number }).pid,
      ) ?? [];
    const internals = runtime as unknown as RuntimeInternals;
    const memoryManager = internals.entries.get(
      record.computerId,
    )?.dosGuestMemoryManager;
    if (memoryManager === undefined)
      throw new Error("portable DOS memory manager was not initialized");

    let memoryReleaseCalls = 0;
    const originalGrantProcess = memoryManager.grantProcess.bind(memoryManager);
    const grantProcess = vi
      .spyOn(memoryManager, "grantProcess")
      .mockImplementation((request) =>
        observedGrant(originalGrantProcess(request), () => {
          memoryReleaseCalls += 1;
        }),
      );

    let rejectedProcess: DisposableObservableProcess | undefined;
    const terminateReasons: (string | undefined)[] = [];
    let disposeCalls = 0;
    const originalCreate = factory.create.bind(factory);
    const create = vi.spyOn(factory, "create").mockImplementation((request) => {
      const process = originalCreate(request);
      if (process.dispose === undefined)
        throw new Error("remote process has no disposal owner");
      rejectedProcess = process as DisposableObservableProcess;
      const terminate = rejectedProcess.terminate.bind(rejectedProcess);
      const dispose = rejectedProcess.dispose.bind(rejectedProcess);
      rejectedProcess.terminate = (reason?: string): CpuProcessState => {
        terminateReasons.push(reason);
        return terminate(reason);
      };
      rejectedProcess.dispose = (): void => {
        disposeCalls += 1;
        dispose();
      };
      return process;
    });
    const completeOsProcess = vi.spyOn(internals, "completeOsProcess");
    const schedulerAdd = vi
      .spyOn(internals.scheduler, "add")
      .mockImplementationOnce((): never => {
        throw new Error("injected scheduler admission failure");
      });
    const completions: DebugShellCommandCompletion[] = [];

    runtime.enqueueDebugShellCommand(
      record.computerId,
      "C:\\REJECT.CSX",
      (result) => completions.push(result),
    );

    expect(schedulerAdd).toHaveBeenCalledTimes(1);
    schedulerAdd.mockRestore();
    create.mockRestore();
    await settlePromises();

    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      error: { message: "injected scheduler admission failure" },
      outcome: "failed",
    });
    if (rejectedProcess === undefined)
      throw new Error("remote process was not created");
    expect(terminateReasons).toEqual(["debug process admission failed"]);
    expect(disposeCalls).toBe(1);
    expect(transport.commands.map(({ command }) => command)).toEqual([
      "create",
      "dispose",
    ]);

    expect(grantProcess).toHaveBeenCalledTimes(1);
    expect(memoryReleaseCalls).toBe(1);
    expect(completeOsProcess).toHaveBeenCalledTimes(1);
    const rejectedPid = completeOsProcess.mock.calls[0]?.[1];
    expect(rejectedPid).toEqual(expect.any(Number));
    expect(
      record.osRuntimeSnapshot?.processes.some(
        (process) => (process as { pid: number }).pid === rejectedPid,
      ),
    ).toBe(false);
    expect(
      record.osRuntimeSnapshot?.processes.map(
        (process) => (process as { pid: number }).pid,
      ),
    ).toEqual(baselinePids);
    expect(runtime.guestMemoryStatus(record.computerId)).toEqual(
      baselineMemory,
    );

    await settlePromises();
    expect(terminateReasons).toEqual(["debug process admission failed"]);
    expect(disposeCalls).toBe(1);
    expect(memoryReleaseCalls).toBe(1);
    expect(completeOsProcess).toHaveBeenCalledTimes(1);

    grantProcess.mockRestore();
    completeOsProcess.mockRestore();
  });
});

class CompletingWorkerTransport implements Cs486WorkerTransport {
  readonly commands: Cs486WorkerCommand[] = [];
  private readonly actors = new Map<
    string,
    {
      readonly collectMicroarchitectureStats: boolean;
      readonly computerId: string;
      readonly cpuModel: "cs386sx" | "cs486dx" | "cs486dx2";
      readonly memoryBytes: number;
    }
  >();

  constructor(readonly workerCount: number) {}

  request(command: Cs486WorkerCommand): Promise<Cs486WorkerCommandResult> {
    this.commands.push(command);
    switch (command.command) {
      case "create": {
        const actor = {
          collectMicroarchitectureStats:
            command.options.collectMicroarchitectureStats,
          computerId: command.computerId,
          cpuModel: command.options.cpuModel,
          memoryBytes: command.options.memoryBytes,
        };
        this.actors.set(command.processId, actor);
        return Promise.resolve({
          command: "create",
          view: this.view(actor),
        });
      }
      case "slice": {
        const actor = this.requireActor(command.processId);
        return Promise.resolve({
          command: "slice",
          result: { cpuCycles: 48, executedInstructions: 2 },
          view: this.view(actor, {
            output: `${actor.cpuModel} raw ABI\n`,
            state: { kind: "completed", value: 7 },
          }),
        });
      }
      case "terminate": {
        const actor = this.requireActor(command.processId);
        return Promise.resolve({
          command: "terminate",
          view: this.view(actor, {
            state: { kind: "terminated", reason: command.reason },
          }),
        });
      }
      case "fail": {
        const actor = this.requireActor(command.processId);
        return Promise.resolve({
          command: "fail",
          view: this.view(actor, {
            state: { error: command.error, kind: "crashed" },
          }),
        });
      }
      case "dispose":
        this.actors.delete(command.processId);
        return Promise.resolve({ command: "dispose", disposed: true });
    }
  }

  private requireActor(processId: string): {
    readonly collectMicroarchitectureStats: boolean;
    readonly computerId: string;
    readonly cpuModel: "cs386sx" | "cs486dx" | "cs486dx2";
    readonly memoryBytes: number;
  } {
    const actor = this.actors.get(processId);
    if (actor === undefined) throw new Error(`unknown process ${processId}`);
    return actor;
  }

  private view(
    actor: {
      readonly collectMicroarchitectureStats: boolean;
      readonly computerId: string;
      readonly memoryBytes: number;
    },
    overrides: Partial<Cs486WorkerProcessView> = {},
  ): Cs486WorkerProcessView {
    return {
      hasPendingCpuCycles: false,
      memoryLimitBytes: actor.memoryBytes,
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
      microarchitectureStatsEnabled: actor.collectMicroarchitectureStats,
      output: "",
      state: { kind: "ready" },
      workerCount: this.workerCount,
      workerIndex: stableWorkerIndexForComputer(
        actor.computerId,
        this.workerCount,
      ),
      ...overrides,
    };
  }
}

interface RuntimeInternals {
  readonly entries: Map<
    string,
    { readonly dosGuestMemoryManager?: DosGuestMemoryManager }
  >;
  readonly scheduler: {
    add(id: number, process: CpuProcess, cpuCyclesPerTick?: number): void;
  };
  completeOsProcess(
    entry: unknown,
    pid: number,
    exitCode: number,
    cpuCycles?: number,
  ): void;
}

type DisposableObservableProcess = ObservableCs486Process & {
  dispose(): void;
};

function portableRecord(computerId: string): ComputerRecord {
  return new ComputerRecord(computerId, "standard", {
    displayProfileId: "portable-vga-256k",
    hardware: portableComputerHardware,
    osProfile: "dos",
  });
}

function startRuntime(runtime: ComputerRuntime, record: ComputerRecord): void {
  runtime.register(record);
  expect(runtime.powerOn(record.computerId)).toMatchObject({
    outcome: "accepted",
  });
  for (let tick = 0; tick < 1_000; tick += 1) {
    if (
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    )
      return;
    runtime.runTick();
  }
  throw new Error("portable runtime did not complete CSBIOS");
}

function installRawExecutable(record: ComputerRecord, name: string): void {
  record.filesystem.writeFile(
    `/drives/c/${name.toLowerCase()}`,
    `CS486\n${JSON.stringify(rawExecutable)}`,
  );
}

async function runUntilCompleted(
  runtime: ComputerRuntime,
  completions: readonly DebugShellCommandCompletion[],
): Promise<void> {
  for (let tick = 0; tick < 20; tick += 1) {
    await settlePromises();
    runtime.runTick();
    await settlePromises();
    if (completions.length > 0) return;
  }
  throw new Error("remote raw ABI execution did not complete");
}

async function settlePromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function observedGrant(
  grant: DosGuestProcessGrant,
  onRelease: () => void,
): DosGuestProcessGrant {
  return {
    get allocations(): DosGuestProcessGrant["allocations"] {
      return grant.allocations;
    },
    get memoryBytes(): number {
      return grant.memoryBytes;
    },
    get physicalReservationBytes(): number {
      return grant.physicalReservationBytes;
    },
    get released(): boolean {
      return grant.released;
    },
    get residentBytes(): number {
      return grant.residentBytes;
    },
    release(): void {
      onRelease();
      grant.release();
    },
  };
}
