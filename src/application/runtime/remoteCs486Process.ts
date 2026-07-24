import type {
  CpuProcess,
  CpuProcessExecutionLocation,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../domain/runtime/cpuProcess.js";
import { isTerminalCpuProcessState } from "../../domain/runtime/cpuProcess.js";
import { VmRuntimeError } from "../../domain/runtime/errors.js";
import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import type { CpuMicroarchitectureStats } from "../../domain/cpu/memoryHierarchy.js";
import type { CpuModel } from "../../domain/cpu/models.js";

const protocolVersion = 1;
const maximumWorkerErrorMessageLength = 500;
const maximumWorkerReasonLength = 256;
const maximumWorkerOutputLength = 64_000;

export interface ObservableCs486Process extends CpuProcess {
  readonly microarchitectureStats: CpuMicroarchitectureStats;
  readonly microarchitectureStatsEnabled: boolean;
  readonly output: string;
  dispose?(): void;
}

export interface RemoteCs486ProcessCreateRequest {
  readonly collectMicroarchitectureStats: boolean;
  readonly computerId: string;
  readonly cpuModel: CpuModel;
  readonly executable: Cs486Executable;
  readonly memoryBytes: number;
  readonly runtimeId: number;
}

export interface Cs486WorkerTransport {
  readonly workerCount: number;
  request(command: Cs486WorkerCommand): Promise<Cs486WorkerCommandResult>;
}

export type Cs486WorkerCommand =
  | {
      readonly command: "create";
      readonly computerId: string;
      readonly executable: Cs486Executable;
      readonly options: {
        readonly collectMicroarchitectureStats: boolean;
        readonly cpuModel: CpuModel;
        readonly memoryBytes: number;
      };
      readonly processId: string;
      readonly protocolVersion: typeof protocolVersion;
    }
  | {
      readonly command: "slice";
      readonly computerId: string;
      readonly cpuCycleBudget: number;
      readonly instructionBudget: number;
      readonly processId: string;
      readonly protocolVersion: typeof protocolVersion;
      readonly tick: number;
    }
  | {
      readonly command: "terminate";
      readonly computerId: string;
      readonly processId: string;
      readonly protocolVersion: typeof protocolVersion;
      readonly reason: string;
    }
  | {
      readonly command: "fail";
      readonly computerId: string;
      readonly error: {
        readonly message: string;
        readonly typeName: string;
      };
      readonly processId: string;
      readonly protocolVersion: typeof protocolVersion;
    }
  | {
      readonly command: "dispose";
      readonly computerId: string;
      readonly processId: string;
      readonly protocolVersion: typeof protocolVersion;
    };

export interface Cs486WorkerProcessView {
  readonly hasPendingCpuCycles: boolean;
  readonly memoryLimitBytes: number;
  readonly memoryUsageBytes: number;
  readonly microarchitectureStats: CpuMicroarchitectureStats;
  readonly microarchitectureStatsEnabled: boolean;
  readonly output: string;
  readonly state: WorkerCpuProcessState;
  readonly workerCount: number;
  readonly workerIndex: number;
}

export type WorkerCpuProcessState =
  | { readonly kind: "ready" }
  | { readonly kind: "completed"; readonly value: number }
  | {
      readonly error: { readonly message: string; readonly typeName: string };
      readonly kind: "crashed";
    }
  | { readonly kind: "sleeping"; readonly wakeTick: number }
  | { readonly kind: "terminated"; readonly reason: string }
  | { readonly filter?: string; readonly kind: "waiting_event" };

export type Cs486WorkerCommandResult =
  | {
      readonly command: "create" | "fail" | "terminate";
      readonly view: Cs486WorkerProcessView;
    }
  | {
      readonly command: "slice";
      readonly result: {
        readonly cpuCycles: number;
        readonly executedInstructions: number;
      };
      readonly view: Cs486WorkerProcessView;
    }
  | { readonly command: "dispose"; readonly disposed: true };

export class RemoteCs486ProcessFactory {
  private nextGeneration = 1;

  constructor(private readonly transport: Cs486WorkerTransport) {
    requireWorkerCount(transport.workerCount);
  }

  get workerCount(): number {
    return this.transport.workerCount;
  }

  workerIndex(computerId: string): number {
    return stableWorkerIndexForComputer(computerId, this.workerCount);
  }

  create(request: RemoteCs486ProcessCreateRequest): ObservableCs486Process {
    if (!Number.isSafeInteger(request.runtimeId) || request.runtimeId <= 0)
      throw new RangeError("runtimeId must be a positive safe integer");
    const generation = this.nextGeneration;
    this.nextGeneration =
      generation === Number.MAX_SAFE_INTEGER ? 1 : generation + 1;
    return new RemoteCs486Process(
      this.transport,
      request,
      `p-${generation.toString(36)}-${request.runtimeId.toString(36)}`,
    );
  }
}

export class RemoteCs486Process implements ObservableCs486Process {
  readonly executionLocation: CpuProcessExecutionLocation;
  readonly schedulerResourceId: string;
  private stateValue: CpuProcessState = { kind: "ready" };
  private hasPendingCpuCyclesValue = false;
  private memoryLimitBytesValue: number;
  private memoryUsageBytesValue = 0;
  private outputValue = "";
  private microarchitectureStatsValue = emptyMicroarchitectureStats();
  private microarchitectureStatsEnabledValue: boolean;
  private created = false;
  private disposed = false;
  private disposeSent = false;
  private requestInFlight = false;
  private localTerminalIntent = false;
  private lastTick = 0;
  private unreportedResult: CpuProcessSliceResult | undefined;
  private pendingControl:
    | { readonly kind: "fail"; readonly error: VmRuntimeError }
    | { readonly kind: "terminate"; readonly reason: string }
    | undefined;

  constructor(
    private readonly transport: Cs486WorkerTransport,
    private readonly request: RemoteCs486ProcessCreateRequest,
    private readonly processId: string,
  ) {
    const workerIndex = stableWorkerIndexForComputer(
      request.computerId,
      transport.workerCount,
    );
    this.executionLocation = Object.freeze({
      backend: "worker",
      workerCount: transport.workerCount,
      workerIndex,
    });
    this.schedulerResourceId = `cs486-worker-${String(workerIndex)}`;
    this.memoryLimitBytesValue = request.memoryBytes;
    this.microarchitectureStatsEnabledValue =
      request.collectMicroarchitectureStats;
    this.requestInFlight = true;
    void this.transport
      .request({
        command: "create",
        computerId: request.computerId,
        executable: request.executable,
        options: {
          collectMicroarchitectureStats: request.collectMicroarchitectureStats,
          cpuModel: request.cpuModel,
          memoryBytes: request.memoryBytes,
        },
        processId,
        protocolVersion,
      })
      .then((response) => {
        if (response.command !== "create")
          throw new Error("CS486 worker returned a mismatched create response");
        this.created = true;
        if (!this.disposed)
          this.applyView(
            response.view,
            this.localTerminalIntent || this.pendingControl !== undefined,
          );
      })
      .catch((error: unknown) => this.crashTransport(error))
      .finally(() => {
        this.requestInFlight = false;
        this.dispatchPendingControl();
        this.dispatchDispose();
      });
  }

  get state(): CpuProcessState {
    return this.stateValue;
  }

  get hasPendingCpuCycles(): boolean {
    return (
      this.hasPendingCpuCyclesValue ||
      this.unreportedResult !== undefined ||
      (isTerminalCpuProcessState(this.stateValue) &&
        (this.requestInFlight || this.pendingControl !== undefined))
    );
  }

  get memoryLimitBytes(): number {
    return this.memoryLimitBytesValue;
  }

  get memoryUsageBytes(): number {
    return this.memoryUsageBytesValue;
  }

  get output(): string {
    return this.outputValue;
  }

  get microarchitectureStats(): CpuMicroarchitectureStats {
    return this.microarchitectureStatsValue;
  }

  get microarchitectureStatsEnabled(): boolean {
    return this.microarchitectureStatsEnabledValue;
  }

  advanceTick(tick: number): CpuProcessState {
    if (!Number.isSafeInteger(tick) || tick < this.lastTick)
      throw new RangeError("CPU process tick must advance monotonically");
    this.lastTick = tick;
    return this.stateValue;
  }

  deliverEvent(): boolean {
    return false;
  }

  runCpuSlice(
    cpuCycleBudget: number,
    instructionBudget = Number.MAX_SAFE_INTEGER,
  ): CpuProcessSliceResult {
    requirePositiveSafeInteger(cpuCycleBudget, "CPU cycle budget");
    requirePositiveSafeInteger(instructionBudget, "instruction budget");
    const completed = this.unreportedResult ?? zeroSlice(this.stateValue);
    this.unreportedResult = undefined;

    if (
      this.disposed ||
      !this.created ||
      this.requestInFlight ||
      this.pendingControl !== undefined ||
      (this.stateValue.kind !== "ready" && !this.hasPendingCpuCyclesValue)
    ) {
      return completed;
    }

    this.requestInFlight = true;
    const reservation = { cpuCycleBudget, instructionBudget };
    void this.transport
      .request({
        command: "slice",
        computerId: this.request.computerId,
        cpuCycleBudget,
        instructionBudget,
        processId: this.processId,
        protocolVersion,
        tick: this.lastTick,
      })
      .then((response) => {
        if (response.command !== "slice")
          throw new Error("CS486 worker returned a mismatched slice response");
        const result = response.result;
        requireNonNegativeSafeInteger(
          result.cpuCycles,
          "worker CPU cycle result",
        );
        requireNonNegativeSafeInteger(
          result.executedInstructions,
          "worker instruction result",
        );
        if (result.cpuCycles > reservation.cpuCycleBudget)
          throw new Error(
            "CS486 worker exceeded its reserved CPU cycle budget",
          );
        if (result.executedInstructions > reservation.instructionBudget)
          throw new Error(
            "CS486 worker exceeded its reserved instruction budget",
          );
        this.applyView(response.view, this.pendingControl !== undefined);
        this.unreportedResult = {
          cpuCycles: result.cpuCycles,
          executedInstructions: result.executedInstructions,
          state: this.stateValue,
        };
      })
      .catch((error: unknown) => this.crashTransport(error))
      .finally(() => {
        this.requestInFlight = false;
        this.dispatchPendingControl();
        this.dispatchDispose();
      });

    return {
      ...completed,
      admittedCpuCycles: cpuCycleBudget,
      admittedInstructions: instructionBudget,
    };
  }

  terminate(reason = "terminated"): CpuProcessState {
    if (isTerminalCpuProcessState(this.stateValue)) return this.stateValue;
    const boundedReason = String(reason).slice(0, maximumWorkerReasonLength);
    this.stateValue = {
      kind: "terminated",
      reason: boundedReason || "terminated",
    };
    this.localTerminalIntent = true;
    this.pendingControl = {
      kind: "terminate",
      reason: this.stateValue.reason,
    };
    this.dispatchPendingControl();
    return this.stateValue;
  }

  fail(error: VmRuntimeError): CpuProcessState {
    if (isTerminalCpuProcessState(this.stateValue)) return this.stateValue;
    this.stateValue = { kind: "crashed", error };
    this.localTerminalIntent = true;
    this.pendingControl = { kind: "fail", error };
    this.dispatchPendingControl();
    return this.stateValue;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingControl = undefined;
    this.dispatchDispose();
  }

  private dispatchDispose(): void {
    if (!this.disposed || this.disposeSent || this.requestInFlight) return;
    this.disposeSent = true;
    void this.transport
      .request({
        command: "dispose",
        computerId: this.request.computerId,
        processId: this.processId,
        protocolVersion,
      })
      .catch(() => undefined);
  }

  private dispatchPendingControl(): void {
    const control = this.pendingControl;
    if (
      control === undefined ||
      this.requestInFlight ||
      !this.created ||
      this.disposed
    )
      return;
    this.pendingControl = undefined;
    this.requestInFlight = true;
    const command: Cs486WorkerCommand =
      control.kind === "terminate"
        ? {
            command: "terminate",
            computerId: this.request.computerId,
            processId: this.processId,
            protocolVersion,
            reason: control.reason,
          }
        : {
            command: "fail",
            computerId: this.request.computerId,
            error: {
              message: control.error.message.slice(
                0,
                maximumWorkerErrorMessageLength,
              ),
              typeName: control.error.typeName.slice(0, 128),
            },
            processId: this.processId,
            protocolVersion,
          };
    void this.transport
      .request(command)
      .then((response) => {
        if (response.command !== control.kind)
          throw new Error(
            "CS486 worker returned a mismatched control response",
          );
        if (!this.disposed) this.applyView(response.view);
      })
      .catch((error: unknown) => this.crashTransport(error))
      .finally(() => {
        this.requestInFlight = false;
        this.dispatchPendingControl();
        this.dispatchDispose();
      });
  }

  private applyView(
    view: Cs486WorkerProcessView,
    preserveLocalTerminalState = false,
  ): void {
    validateWorkerView(view, this.executionLocation);
    this.hasPendingCpuCyclesValue = view.hasPendingCpuCycles;
    this.memoryLimitBytesValue = view.memoryLimitBytes;
    this.memoryUsageBytesValue = view.memoryUsageBytes;
    this.outputValue = view.output;
    this.microarchitectureStatsEnabledValue =
      view.microarchitectureStatsEnabled;
    this.microarchitectureStatsValue = Object.freeze({
      ...view.microarchitectureStats,
    });
    if (!preserveLocalTerminalState)
      this.stateValue = workerStateToCpuProcessState(view.state);
  }

  private crashTransport(error: unknown): void {
    if (this.disposed) return;
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "unknown error";
    this.pendingControl = undefined;
    this.hasPendingCpuCyclesValue = false;
    if (this.localTerminalIntent) return;
    this.stateValue = {
      kind: "crashed",
      error: new VmRuntimeError(
        "WorkerTransportError",
        message.slice(0, maximumWorkerErrorMessageLength),
      ),
    };
  }
}

export function stableWorkerIndexForComputer(
  computerId: string,
  workerCount: number,
): number {
  requireWorkerCount(workerCount);
  if (
    typeof computerId !== "string" ||
    computerId.length === 0 ||
    computerId.length > 64
  )
    throw new RangeError("computerId must contain between 1 and 64 characters");
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < computerId.length; index += 1) {
    hash ^= computerId.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93) >>> 0;
  }
  return (hash % workerCount) + 1;
}

function workerStateToCpuProcessState(
  state: WorkerCpuProcessState,
): CpuProcessState {
  switch (state.kind) {
    case "ready":
      return { kind: "ready" };
    case "completed":
      return { kind: "completed", value: state.value };
    case "crashed":
      return {
        kind: "crashed",
        error: new VmRuntimeError(state.error.typeName, state.error.message),
      };
    case "terminated":
      return { kind: "terminated", reason: state.reason };
    case "sleeping":
    case "waiting_event":
      throw new Error(
        `Isolated CS486 worker returned unsupported ${state.kind} state`,
      );
  }
}

function validateWorkerView(
  view: Cs486WorkerProcessView,
  location: CpuProcessExecutionLocation,
): void {
  if (location.backend !== "worker")
    throw new Error("CS486 worker process has no worker placement");
  if (
    view.workerIndex !== location.workerIndex ||
    view.workerCount !== location.workerCount
  )
    throw new Error("CS486 worker placement changed during process execution");
  requirePositiveSafeInteger(view.memoryLimitBytes, "worker memory limit");
  requireNonNegativeSafeInteger(view.memoryUsageBytes, "worker memory usage");
  if (view.memoryUsageBytes > view.memoryLimitBytes)
    throw new Error("CS486 worker reported memory usage above its limit");
  if (typeof view.output !== "string")
    throw new Error("CS486 worker output must be text");
  if (view.output.length > maximumWorkerOutputLength)
    throw new Error("CS486 worker output exceeds its bounded process limit");
  if (typeof view.microarchitectureStatsEnabled !== "boolean")
    throw new Error("CS486 worker stats flag must be boolean");
  const stats = view.microarchitectureStats;
  for (const value of [
    stats.busTransfers,
    stats.instructionFetches,
    stats.l1Hits,
    stats.l1Misses,
    stats.l2Hits,
    stats.l2Misses,
    stats.pipelineFlushes,
    stats.unalignedAccesses,
  ])
    requireNonNegativeSafeInteger(value, "worker microarchitecture counter");
}

function zeroSlice(state: CpuProcessState): CpuProcessSliceResult {
  return { cpuCycles: 0, executedInstructions: 0, state };
}

function emptyMicroarchitectureStats(): CpuMicroarchitectureStats {
  return Object.freeze({
    busTransfers: 0,
    instructionFetches: 0,
    l1Hits: 0,
    l1Misses: 0,
    l2Hits: 0,
    l2Misses: 0,
    pipelineFlushes: 0,
    unalignedAccesses: 0,
  });
}

function requireWorkerCount(workerCount: number): void {
  if (!Number.isSafeInteger(workerCount) || workerCount < 1 || workerCount > 16)
    throw new RangeError("workerCount must be between 1 and 16");
}

function requirePositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(`${label} must be a positive safe integer`);
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${label} must be a non-negative safe integer`);
}
