import {
  createAccountedNativeEnvironment,
  renderTerminalScreen,
  writeTerminalLines,
  writeTerminalPrompt,
  type BackgroundProcessStartResult,
  type ForegroundProcessStartResult,
  type JobControlStartResult,
  type AccountedNativeModuleContext,
} from "../runtime/nativeModules.js";
import { preparePythonCs486Program } from "../runtime/pythonCs486.js";
import {
  RoundRobinScheduler,
  type SchedulerLimits,
  type SchedulerWorkObserver,
} from "../runtime/scheduler.js";
import type {
  ComputerWorkLane,
  TickWorkScope,
} from "../runtime/computerWorkMonitor.js";
import type {
  CpuProcessExecutionLocation,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../domain/runtime/cpuProcess.js";
import type { CpuProcess } from "../../domain/runtime/cpuProcess.js";
import {
  Cs486Process,
  runCs486,
  type Cs486Executable,
  type Cs486RunObservation,
  type Cs486SyscallHandler,
} from "../../domain/cpu/cs486.js";
import type {
  ComputerOsProfile,
  ComputerRecord,
} from "../../domain/computer/computer.js";
import {
  GuestRamLedger,
  normalizeGuestRamOwner,
  type GuestRamOwner,
  type GuestRamSnapshot,
} from "../../domain/computer/guestRamLedger.js";
import { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { numericComputerId } from "../../domain/computer/identity.js";
import type { RuntimeValue } from "../../domain/runtime/value.js";
import { VmRuntimeError } from "../../domain/runtime/errors.js";
import { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { defaultSystemBootSource } from "../os/systemPrograms.js";
import type { ShellClockSource } from "../os/clock.js";
import type { ShellSession } from "../os/shellSession.js";
import {
  createTerminalInteractionDescriptor,
  unavailableTerminalInteraction,
  withTerminalInteractionGeneration,
  type TerminalInteractionDescriptor,
} from "../terminal/terminalInteraction.js";
import type {
  ShellCommandResult,
  ShellBackgroundRequest,
  ShellForegroundRequest,
  ShellJobControlRequest,
  ShellTerminalCompletionResponse,
} from "../os/shellTypes.js";
import {
  hardwareCpuCyclesPerTick,
  type ComputerHardwareProfile,
} from "../../domain/computer/hardware.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import { cpuCyclesToMicroseconds } from "../../domain/cpu/timing.js";
import {
  clearCsBiosForOs,
  startCsBiosBootSequence,
  type CsBiosBootSequence,
} from "./csBios.js";
import { renderLinuxRcBootChatter } from "./linuxRcBootSequence.js";
import { SerialLinkBroker } from "../io/serialLinkBroker.js";
import { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import {
  assembleCs486,
  assembleCs486Object,
  Cs486CompileError,
} from "../toolchain/cs486Assembler.js";
import {
  compileCs486Object,
  compileCs486Source,
} from "../toolchain/highLevelCompilers.js";
import type { Cs486CFrontendOptions } from "../toolchain/cs486CFrontend.js";
import type { Cs486CPreprocessorInclude } from "../toolchain/cs486CPreprocessor.js";
import { Cs486LinkError, linkCs486Objects } from "../toolchain/cs486Linker.js";
import { selectParsedCs486LinkInputs } from "../toolchain/cs486Archive.js";
import {
  concatGuestToolchainTranscripts,
  createGuestToolchainTranscript,
  emptyGuestToolchainTranscript,
  guestToolchainTranscriptFromCompileError,
  guestToolchainTranscriptFromFailure,
  guestToolchainTranscriptFromStreams,
  renderGuestToolchainTranscript,
  type GuestToolchainTranscript,
} from "../toolchain/guestToolchainTranscript.js";
import { getOsProfile, type OsProfile } from "../os/osProfile.js";
import { credentialedFilesystem } from "../os/credentialedFilesystem.js";
import {
  unrestrictedGuestFilesystem,
  type GuestFilesystem,
} from "../os/guestFilesystem.js";
import {
  createLoginCredentials,
  initialUserCredentials,
  initialUserId,
  type ProcessCredentials,
} from "../os/linuxCredentials.js";
import { openLinuxAccountDatabase } from "../os/linuxAccounts.js";
import {
  OsRuntimeState,
  type OsJournalEntry,
  type OsProcessSignal,
} from "../os/osRuntimeState.js";
import { DosRuntimeState } from "../os/dosRuntimeState.js";
import type { DosGuestMemoryManager } from "../os/dosGuestMemoryManager.js";
import type {
  LinuxGuestMemoryManager,
  LinuxGuestMemorySnapshot,
} from "../os/linuxGuestMemoryManager.js";
import {
  grantCs486ExecutableMemory,
  grantCs486MemoryRequirements,
  releaseGuestProcessMemory,
  type GuestProcessMemoryAdmission,
  type GuestProcessMemoryGrant,
} from "../runtime/guestProcessMemory.js";
import {
  FloppyDrive,
  FloppyGuestFilesystem,
  type FloppyDriveActivity,
  type FloppyDriveIo,
} from "../os/floppyDrive.js";
import type { FloppyMedia } from "../../domain/storage/floppyMedia.js";
import {
  CsAbiRuntime,
  csAbiErrno,
  prepareCsAbiStartup,
  writeTerminalText,
} from "../runtime/csAbi.js";
import {
  advanceCompileJobContinuation,
  compileJobProgress,
  createCompileJobContinuation,
  preflightCompileJob,
  type CompileJobContinuation,
  type CompileJobProgress,
} from "./compileJobPlan.js";
import type {
  RemoteCs486ProcessFactory,
  ObservableCs486Process,
} from "../runtime/remoteCs486Process.js";

export interface ComputerRuntimeOptions {
  readonly clock?: ShellClockSource;
  /** Monotonic host wall time used only for explicit performance diagnostics. */
  readonly hostElapsedMilliseconds?: () => number;
  readonly schedulerLimits?: SchedulerLimits;
  /** Wall-time slowdown relative to each persisted guest CPU clock. */
  readonly guestRealtimeDivisor?: number;
  /**
   * Enables host-only CS486 cache/bus counters for every guest process.
   * Explicit `--stats` requests enable them regardless of this default.
   */
  readonly collectMicroarchitectureStatsByDefault?: boolean;
  readonly defaultBootSource?: string;
  readonly ticksPerSecond?: number;
  readonly requireLinuxLogin?: boolean;
  readonly serial?: SerialLinkBroker;
  readonly peripherals?: PeripheralBusBroker;
  /**
   * Optional companion-backed executor for isolated machine-code processes.
   * Hosted ABI, Python, debugger, and pipeline processes remain Bedrock-local.
   */
  readonly remoteCs486ProcessFactory?: RemoteCs486ProcessFactory;
}

export interface ComputerExecutionStatus {
  readonly activeBackend: "bedrock" | "idle" | "mixed" | "worker";
  readonly assignedWorkerIndex?: number;
  readonly workerCount: number;
}

export type RuntimeCommandResult =
  | { readonly outcome: "accepted"; readonly state: string }
  | {
      readonly outcome: "ignored";
      readonly reason: "already_registered" | "not_running" | "stopping";
    }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error };

export type DebugShellCommandResult =
  | {
      readonly outcome: "completed";
      readonly exitCode: number;
      readonly stderr: string;
      readonly stdout: string;
      readonly cpuCycles: number;
    }
  | { readonly outcome: "missing"; readonly computerId: string }
  | {
      readonly outcome: "ignored";
      readonly reason: "not_running" | "stopping";
    }
  | { readonly outcome: "failed"; readonly error: Error };

export type DebugShellCommandCompletion = Extract<
  DebugShellCommandResult,
  { readonly outcome: "completed" | "failed" | "ignored" | "missing" }
>;

export type RuntimePersistenceSyncResult =
  | { readonly outcome: "saved" | "unchanged"; readonly generation?: number }
  | { readonly outcome: "failed"; readonly error: Error }
  | { readonly outcome: "missing"; readonly computerId: string };

export class ComputerRuntime {
  readonly serial: SerialLinkBroker;
  readonly peripherals: PeripheralBusBroker;
  private readonly scheduler: RoundRobinScheduler;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly runtimeOwners = new Map<number, RuntimeEntry>();
  private readonly runtimeLanes = new Map<number, ComputerWorkLane>();
  private readonly pendingCsBiosEntries = new Set<RuntimeEntry>();
  private readonly compileReady = new Set<RuntimeEntry>();
  private readonly stoppingEntries = new Set<RuntimeEntry>();
  private activeWorkScope: TickWorkScope | undefined;
  private readonly defaultBootSource: string;
  private readonly clock: ShellClockSource | undefined;
  private readonly hostElapsedMilliseconds: (() => number) | undefined;
  private readonly guestRealtimeDivisor: number;
  private readonly collectMicroarchitectureStatsByDefault: boolean;
  private readonly ticksPerSecond: number;
  private readonly requireLinuxLogin: boolean;
  private readonly remoteCs486ProcessFactory:
    RemoteCs486ProcessFactory | undefined;
  private filesystemIoRequester:
    | ((
        computerId: string,
        operation: "read" | "write",
        bytes: number,
      ) => string | undefined)
    | undefined;
  private floppyIoRequester:
    | ((
        computerId: string,
        requests: readonly FloppyDriveIo[],
      ) => string | undefined)
    | undefined;
  private floppySaver:
    ((computerId: string, media: FloppyMedia) => void) | undefined;
  private floppyGuestEjector: ((computerId: string) => void) | undefined;
  private floppyActivityObserver:
    ((computerId: string, activity: FloppyDriveActivity) => void) | undefined;
  private pendingFilesystemIoCounter:
    ((computerId: string) => number) | undefined;
  private persistenceSyncer:
    ((computerId: string) => RuntimePersistenceSyncResult) | undefined;
  private deviceStopper: ((computerId: string) => void) | undefined;
  private nextRuntimeId = 1;

  constructor(options: ComputerRuntimeOptions = {}) {
    this.serial = options.serial ?? new SerialLinkBroker();
    this.peripherals = options.peripherals ?? new PeripheralBusBroker();
    this.scheduler = new RoundRobinScheduler(options.schedulerLimits);
    this.defaultBootSource =
      options.defaultBootSource ?? defaultSystemBootSource;
    this.clock = options.clock;
    this.hostElapsedMilliseconds = options.hostElapsedMilliseconds;
    this.guestRealtimeDivisor = options.guestRealtimeDivisor ?? 1;
    if (
      !Number.isSafeInteger(this.guestRealtimeDivisor) ||
      this.guestRealtimeDivisor < 1
    ) {
      throw new RangeError("guestRealtimeDivisor must be a positive integer");
    }
    this.collectMicroarchitectureStatsByDefault =
      options.collectMicroarchitectureStatsByDefault ?? false;
    if (typeof this.collectMicroarchitectureStatsByDefault !== "boolean") {
      throw new TypeError(
        "collectMicroarchitectureStatsByDefault must be a boolean when provided",
      );
    }
    this.ticksPerSecond = options.ticksPerSecond ?? 20;
    this.requireLinuxLogin = options.requireLinuxLogin ?? false;
    this.remoteCs486ProcessFactory = options.remoteCs486ProcessFactory;
  }

  get tickNumber(): number {
    return this.scheduler.tickNumber;
  }

  configureFilesystemIo(
    requester: (
      computerId: string,
      operation: "read" | "write",
      bytes: number,
    ) => string | undefined,
  ): void {
    this.filesystemIoRequester = requester;
  }

  configureFloppy(boundaries: {
    readonly requestIo: (
      computerId: string,
      requests: readonly FloppyDriveIo[],
    ) => string | undefined;
    readonly save: (computerId: string, media: FloppyMedia) => void;
    readonly guestEject: (computerId: string) => void;
    readonly activity?: (
      computerId: string,
      activity: FloppyDriveActivity,
    ) => void;
  }): void {
    this.floppyIoRequester = boundaries.requestIo;
    this.floppySaver = boundaries.save;
    this.floppyGuestEjector = boundaries.guestEject;
    this.floppyActivityObserver = boundaries.activity;
  }

  floppyDrive(computerId: string): FloppyDrive | undefined {
    return this.entries.get(computerId)?.floppyDrive;
  }

  guestMemoryStatus(computerId: string): GuestRamSnapshot | undefined {
    return this.entries.get(computerId)?.guestRamLedger?.snapshot();
  }

  compileJobStatus(computerId: string): CompileJobProgress | undefined {
    const job = this.entries.get(computerId)?.compileJob;
    return job?.continuation === undefined
      ? undefined
      : compileJobProgress(job.continuation, job.memoryBytes);
  }

  linuxMemoryStatus(computerId: string): LinuxGuestMemorySnapshot | undefined {
    return this.entries.get(computerId)?.linuxGuestMemoryManager?.snapshot();
  }

  executionStatus(computerId: string): ComputerExecutionStatus | undefined {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return undefined;
    let bedrockActive = false;
    let workerActive = false;
    const observe = (process: CpuProcess | undefined): void => {
      if (
        process === undefined ||
        (process.state.kind !== "ready" && !process.hasPendingCpuCycles)
      )
        return;
      const location: CpuProcessExecutionLocation =
        process.executionLocation ?? { backend: "bedrock" };
      if (location.backend === "worker") workerActive = true;
      else bedrockActive = true;
    };
    observe(entry.vm);
    observe(entry.foreground?.process);
    observe(entry.debugJob?.process);
    for (const background of entry.backgroundJobs.values())
      observe(background.process);

    const activeBackend =
      bedrockActive && workerActive
        ? "mixed"
        : workerActive
          ? "worker"
          : bedrockActive
            ? "bedrock"
            : "idle";
    const factory = this.remoteCs486ProcessFactory;
    return factory === undefined
      ? { activeBackend, workerCount: 0 }
      : {
          activeBackend,
          assignedWorkerIndex: factory.workerIndex(computerId),
          workerCount: factory.workerCount,
        };
  }

  attachFloppyMedia(computerId: string, media: FloppyMedia): void {
    const entry = this.entries.get(computerId);
    if (entry === undefined) throw new Error(`Unknown Computer ${computerId}`);
    const state = activeDosRuntimeState(entry);
    if (state === undefined) return;
    state.transaction(() => {
      const current = state.driveState("A");
      if (current.mediaPresent) state.ejectMedia("A", current.mediaGeneration);
      const detached = state.driveState("A");
      state.mountMedia("A", {
        generation: Math.max(
          media.instanceGeneration,
          detached.mediaGeneration + 1,
        ),
        readOnly: media.writeProtected,
        volumeLabel: media.volumeLabel,
      });
    });
    if (state === entry.dosRuntimeState) this.syncDosRuntimeState(entry);
  }

  detachFloppyMedia(computerId: string): void {
    const entry = this.entries.get(computerId);
    if (entry === undefined) throw new Error(`Unknown Computer ${computerId}`);
    const state = activeDosRuntimeState(entry);
    if (state === undefined) return;
    const current = state.driveState("A");
    if (!current.mediaPresent) return;
    state.ejectMedia("A", current.mediaGeneration);
    if (state === entry.dosRuntimeState) this.syncDosRuntimeState(entry);
  }

  configureLifecycleBoundaries(boundaries: {
    readonly pendingFilesystemIo: (computerId: string) => number;
    readonly stopDevices: (computerId: string) => void;
    readonly syncPersistence: (
      computerId: string,
    ) => RuntimePersistenceSyncResult;
  }): void {
    this.pendingFilesystemIoCounter = boundaries.pendingFilesystemIo;
    this.deviceStopper = boundaries.stopDevices;
    this.persistenceSyncer = boundaries.syncPersistence;
  }

  canAdmitWork(computerId: string): boolean {
    const entry = this.entries.get(computerId);
    return (
      entry !== undefined &&
      entry.vm !== undefined &&
      entry.stopIntent === undefined &&
      entry.osRuntimeState.lifecycle.phase === "running"
    );
  }

  isStopping(computerId: string): boolean {
    return this.entries.get(computerId)?.stopIntent !== undefined;
  }

  register(record: ComputerRecord): RuntimeCommandResult {
    if (this.entries.has(record.computerId)) {
      return { outcome: "ignored", reason: "already_registered" };
    }
    let entry: RuntimeEntry;
    try {
      const osRuntimeState = OsRuntimeState.restore(
        record.computerId,
        record.osRuntimeSnapshot,
      );
      const dosRuntimeState =
        record.osProfile === "dos"
          ? record.dosRuntimeSnapshot === undefined
            ? DosRuntimeState.create()
            : DosRuntimeState.restore(record.dosRuntimeSnapshot)
          : undefined;
      entry = {
        backgroundJobs: new Map(),
        record,
        runtimeId: this.nextRuntimeId++,
        osRuntimeState,
        installedOsRuntimeState: osRuntimeState,
        dosRuntimeState,
        floppyDrive: new FloppyDrive({
          nowMilliseconds: (): number =>
            this.clock?.currentWallTimeMilliseconds() ??
            Math.floor(
              (this.scheduler.tickNumber * 1_000) / this.ticksPerSecond,
            ),
          onActivity: (activity): void => {
            this.floppyActivityObserver?.(record.computerId, activity);
          },
          onGuestEject: (): void => {
            if (this.floppyGuestEjector === undefined)
              throw new Error("Floppy eject boundary is unavailable");
            this.floppyGuestEjector(record.computerId);
          },
          save: (media): void => {
            if (this.floppySaver === undefined)
              throw new Error("Floppy persistence boundary is unavailable");
            this.floppySaver(record.computerId, media);
          },
        }),
        syncedOsRuntimeRevision: record.osRuntimeSnapshot?.revision,
        syncedDosRuntimeRevision: record.dosRuntimeSnapshot?.revision,
      };
      this.syncOsRuntimeState(entry);
      this.syncDosRuntimeState(entry);
    } catch (error: unknown) {
      return failure(error);
    }
    this.entries.set(record.computerId, entry);
    return { outcome: "accepted", state: record.lifecycle.state.kind };
  }

  powerOn(computerId: string): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    const transition = entry.record.lifecycle.transition({ kind: "power_on" });
    if (transition.outcome !== "changed") {
      return { outcome: "ignored", reason: "not_running" };
    }
    return this.boot(entry);
  }

  /** Explicitly retries a crashed Computer without rewriting its startup file. */
  reset(computerId: string): RuntimeCommandResult {
    return this.recover(computerId, false);
  }

  /** One-shot recovery boot that preserves but bypasses `/startup.py`. */
  safeBoot(computerId: string): RuntimeCommandResult {
    return this.recover(computerId, true);
  }

  private recover(computerId: string, safeBoot: boolean): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (
      entry.vm !== undefined ||
      entry.record.lifecycle.state.kind !== "crashed"
    ) {
      return { outcome: "ignored", reason: "not_running" };
    }
    const reset = entry.record.lifecycle.transition({ kind: "reset" });
    if (reset.outcome !== "changed")
      return { outcome: "ignored", reason: "not_running" };
    if (entry.osRuntimeState.lifecycle.phase === "faulted") {
      entry.osRuntimeState.transitionLifecycle({
        kind: "reset",
        tick: this.scheduler.tickNumber,
      });
    }
    entry.safeBootOnce = safeBoot;
    const powerOn = entry.record.lifecycle.transition({ kind: "power_on" });
    if (powerOn.outcome !== "changed")
      return { outcome: "ignored", reason: "not_running" };
    return this.boot(entry);
  }

  shutdown(computerId: string, reason = "shutdown"): RuntimeCommandResult {
    return this.requestStop(computerId, "shutdown", reason);
  }

  reboot(computerId: string): RuntimeCommandResult {
    return this.requestStop(computerId, "reboot", "reboot");
  }

  terminate(computerId: string): RuntimeCommandResult {
    return this.requestStop(computerId, "shutdown", "terminated");
  }

  interrupt(computerId: string): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.csBiosSequence !== undefined) {
      return { outcome: "ignored", reason: "not_running" };
    }
    if (entry.foreground !== undefined) {
      this.signalForegroundProcesses(entry, entry.foreground, "SIGINT");
      return { outcome: "accepted", state: "foreground_interrupted" };
    }
    if (entry.compileJob !== undefined) {
      this.completeCompileJob(
        entry,
        130,
        guestToolchainTranscriptFromFailure("^C\n"),
        1,
        "SIGINT",
      );
      return { outcome: "accepted", state: "compile_interrupted" };
    }
    if (entry.debugJob !== undefined) {
      entry.debugJob.terminationSignal = "SIGINT";
      entry.debugJob.process.terminate("interrupted");
      return { outcome: "accepted", state: "debug_interrupted" };
    }
    return { outcome: "ignored", reason: "not_running" };
  }

  abortLine(computerId: string): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    const interaction = this.terminalInteraction(computerId);
    if (
      entry.shell === undefined ||
      interaction.inputMode !== "line" ||
      interaction.secretInput
    ) {
      return { outcome: "ignored", reason: "not_running" };
    }
    writeTerminalLines(entry.record.terminal, ["^C"]);
    writeTerminalPrompt(entry.record.terminal, entry.shell.prompt());
    return { outcome: "accepted", state: "line_aborted" };
  }

  queueEvent(
    computerId: string,
    name: string,
    ...arguments_: readonly RuntimeValue[]
  ): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.vm === undefined)
      return { outcome: "ignored", reason: "not_running" };
    if (name === "terminal_closed") {
      return this.finalizeTerminalDisconnect(entry, arguments_);
    }
    if (entry.csBiosSequence !== undefined) {
      return { outcome: "ignored", reason: "not_running" };
    }
    if (entry.stopIntent !== undefined && !name.startsWith("block_io:")) {
      return { outcome: "ignored", reason: "stopping" };
    }
    const compileJob = entry.compileJob;
    if (
      compileJob?.request.task.kind === "make" &&
      compileJob.makeIoWaitEvent === name
    ) {
      compileJob.makeIoWaitEvent = undefined;
      compileJob.makeIoCompletion = {
        ...(typeof arguments_[1] === "string" ? { code: arguments_[1] } : {}),
        outcome: typeof arguments_[0] === "string" ? arguments_[0] : "failed",
      };
      this.compileReady.add(entry);
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    }
    if (
      entry.foreground?.kind === "pipeline" &&
      name === "terminal_keys" &&
      typeof arguments_[0] === "string"
    ) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(arguments_[0]);
      } catch {
        return failure(new Error("invalid terminal key batch"));
      }
      if (
        !Array.isArray(decoded) ||
        decoded.length > 32 ||
        decoded.some((key) => typeof key !== "string" || key.length > 32)
      ) {
        return failure(new Error("invalid terminal key batch"));
      }
      const result = entry.shell?.keys(decoded);
      if (result?.terminalScreen !== undefined) {
        renderTerminalScreen(entry.record.terminal, result.terminalScreen);
      } else if (result?.resetTerminal) {
        entry.record.terminal.setTextColor(0);
        entry.record.terminal.setBackgroundColor(15);
        entry.record.terminal.clear();
        entry.record.terminal.setCursorPosition(1, 1);
      }
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    }
    const csAbi = entry.foreground?.csAbi;
    if (
      csAbi !== undefined &&
      name === "terminal_keys" &&
      typeof arguments_[0] === "string"
    ) {
      const accepted = csAbi.enqueueKeyBatch(arguments_[0]);
      if (accepted === undefined) {
        return failure(new Error("CS ABI key FIFO rejected the input batch"));
      }
      const foreground = entry.foreground!;
      const processState = foreground.process.state;
      if (
        processState.kind !== "waiting_event" ||
        (processState.filter !== undefined &&
          processState.filter !== "terminal_keys")
      ) {
        return {
          outcome: "accepted",
          state: entry.record.lifecycle.state.kind,
        };
      }
      try {
        this.scheduler.queueEvent(foreground.runtimeId, name, ...arguments_);
        return {
          outcome: "accepted",
          state: entry.record.lifecycle.state.kind,
        };
      } catch (error: unknown) {
        csAbi.rollbackKeyBatch(accepted);
        return failure(error);
      }
    }
    try {
      this.scheduler.queueEvent(
        entry.foreground?.runtimeId ?? entry.runtimeId,
        name,
        ...arguments_,
      );
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    } catch (error: unknown) {
      return failure(error);
    }
  }

  runTick(scope?: TickWorkScope): void {
    this.activeWorkScope = scope;
    this.peripherals.setWorkScope(scope);
    try {
      this.advancePendingCsBiosSequences(scope);
      this.runCompileJobs(scope);
      const observer: SchedulerWorkObserver | undefined =
        scope === undefined
          ? undefined
          : {
              prepare: (_computerId, operation) =>
                scope.tryRun(
                  { lane: "event_delivery", deterministicUnits: 1 },
                  operation,
                ).outcome === "ran",
              runCpuSlice: (
                computerId,
                operation,
              ): CpuProcessSliceResult | undefined => {
                const attempt = scope.tryRun(
                  {
                    lane: this.runtimeLanes.get(computerId) ?? "guest_cpu",
                    deterministicUnits: 1,
                  },
                  operation,
                );
                return attempt.outcome === "ran" ? attempt.value : undefined;
              },
            };
      const tick = this.scheduler.runTick(observer);
      const scheduled = new Map(
        tick.computers.map((computer) => [computer.id, computer] as const),
      );
      const reboot: RuntimeEntry[] = [];
      const activeEntries = new Set<RuntimeEntry>();
      for (const computer of tick.computers) {
        const owner = this.runtimeOwners.get(computer.id);
        if (owner !== undefined) activeEntries.add(owner);
      }
      for (const entry of activeEntries) {
        entry.shell?.advanceSystemServices(tick.tick);
        const foreground = entry.foreground;
        if (foreground !== undefined) {
          const measured = scheduled.get(foreground.runtimeId);
          if (measured !== undefined) {
            foreground.cpuCycles = Math.min(
              1_000_000,
              foreground.compileCycles + measured.cpuCycles,
            );
            foreground.executedInstructions = measured.executedInstructions;
            const pids = foreground.osPids ?? [foreground.osPid];
            for (const pid of pids) {
              this.accountLiveOsProcess(
                entry,
                pid,
                Math.floor(foreground.cpuCycles / Math.max(1, pids.length)),
              );
            }
          }
          if (
            foreground.instructionLimit !== undefined &&
            foreground.executedInstructions >= foreground.instructionLimit &&
            foreground.process.state.kind === "ready"
          ) {
            foreground.limitReached = true;
            foreground.process.terminate("execution limit reached");
          }
          if (foreground.kind === "pipeline") {
            const revision = entry.shell?.activePagerRevision();
            if (
              revision !== undefined &&
              revision !== foreground.lastPagerRevision
            ) {
              const screen = entry.shell?.activePagerScreen();
              if (screen !== undefined) {
                renderTerminalScreen(entry.record.terminal, screen);
                foreground.lastPagerRevision = revision;
              }
            }
          }
          const foregroundState = foreground.process.state;
          if (
            !foreground.process.hasPendingCpuCycles &&
            (foregroundState.kind === "completed" ||
              foregroundState.kind === "crashed" ||
              foregroundState.kind === "terminated")
          ) {
            this.completeForegroundProcess(entry, foreground, foregroundState);
          }
        }
        for (const background of [...entry.backgroundJobs.values()]) {
          const measured = scheduled.get(background.runtimeId);
          if (measured !== undefined) {
            background.cpuCycles = Math.min(
              1_000_000,
              background.compileCycles + measured.cpuCycles,
            );
            background.executedInstructions = measured.executedInstructions;
            this.accountLiveOsProcess(
              entry,
              background.osPid,
              background.cpuCycles,
            );
          }
          if (
            background.instructionLimit !== undefined &&
            background.executedInstructions >= background.instructionLimit &&
            background.process.state.kind === "ready"
          ) {
            background.limitReached = true;
            background.process.terminate("execution limit reached");
          }
          const backgroundState = background.process.state;
          if (
            entry.osRuntimeState.process(background.osPid)?.state === "stopped"
          ) {
            continue;
          }
          if (
            !background.process.hasPendingCpuCycles &&
            (backgroundState.kind === "completed" ||
              backgroundState.kind === "crashed" ||
              backgroundState.kind === "terminated")
          ) {
            this.completeBackgroundProcess(entry, background, backgroundState);
          }
        }
        this.updateDebugJob(
          entry,
          scheduled.get(entry.debugJob?.runtimeId ?? -1),
        );
        if (entry.vm === undefined) continue;
        if (entry.csBiosSequence !== undefined) continue;
        const state = entry.vm.state;
        if (
          entry.vm.hasPendingCpuCycles &&
          (state.kind === "completed" ||
            state.kind === "crashed" ||
            state.kind === "terminated")
        )
          continue;
        if (state.kind === "ready") {
          this.syncReady(entry);
        } else if (state.kind === "sleeping") {
          this.syncSleep(entry, state.wakeTick);
        } else if (state.kind === "waiting_event") {
          this.syncEventWait(entry, state.filter);
        } else if (state.kind === "crashed") {
          this.faultOsRuntime(entry, state.error.message);
          entry.record.display.transition({
            kind: "fault",
            message: state.error.message.slice(0, 256) || "guest runtime fault",
          });
          entry.record.lifecycle.transition({
            kind: "crash",
            message: state.error.message,
          });
          this.detach(entry);
        } else if (state.kind === "completed") {
          if (entry.stopIntent === undefined) {
            this.requestEntryStop(entry, "shutdown", "program_completed");
          } else if (entry.stopState?.phase === "terminating") {
            const intent = entry.stopIntent;
            this.detach(entry);
            entry.record.display.transition({ kind: "power_off" });
            if (intent === "reboot") {
              entry.record.lifecycle.transition({ kind: "reboot_ready" });
              reboot.push(entry);
            } else {
              entry.record.lifecycle.transition({ kind: "stopped" });
            }
          }
        } else if (state.kind === "terminated") {
          if (
            entry.stopIntent !== undefined &&
            entry.stopState?.phase !== "terminating"
          ) {
            continue;
          }
          const intent = entry.stopIntent ?? "shutdown";
          this.detach(entry);
          entry.record.display.transition({ kind: "power_off" });
          if (intent === "reboot") {
            entry.record.lifecycle.transition({ kind: "reboot_ready" });
            reboot.push(entry);
          } else {
            entry.record.lifecycle.transition({ kind: "stopped" });
          }
        }
      }
      this.advanceStoppingEntries();
      for (const entry of reboot) this.boot(entry);
    } finally {
      this.peripherals.setWorkScope(undefined);
      this.activeWorkScope = undefined;
    }
  }

  vmState(computerId: string): CpuProcessState | undefined {
    const entry = this.entries.get(computerId);
    return entry?.foreground?.process.state ?? entry?.vm?.state;
  }

  completeShellInput(
    computerId: string,
    line: string,
    cursor: number,
  ): ShellTerminalCompletionResponse | undefined {
    const entry = this.entries.get(computerId);
    if (entry?.csBiosSequence !== undefined) return undefined;
    if (entry?.shell === undefined) return undefined;
    const completion = entry.shell.completeTerminal(line, cursor);
    if (completion.response.outcome === "listed") {
      writeTerminalLines(entry.record.terminal, [line, ...completion.lines]);
      writeTerminalPrompt(entry.record.terminal, entry.shell.prompt());
    }
    return completion.response;
  }

  terminalInteraction(computerId: string): TerminalInteractionDescriptor {
    const entry = this.entries.get(computerId);
    const own = (
      interaction: TerminalInteractionDescriptor,
    ): TerminalInteractionDescriptor =>
      entry === undefined
        ? interaction
        : this.ownTerminalInteraction(entry, interaction);
    if (entry?.csBiosSequence !== undefined) {
      return own(unavailableTerminalInteraction());
    }
    const interaction =
      entry?.shell?.terminalInteraction() ?? unavailableTerminalInteraction();
    if (entry === undefined || interaction.context === "unavailable") {
      return own(interaction);
    }
    if (
      entry.foreground?.csAbi !== undefined &&
      entry.stopIntent === undefined
    ) {
      return own(
        createTerminalInteractionDescriptor({
          context: "cs-abi",
          ctrlCAction: "interrupt",
          cursorShape: "block",
          hints: [{ key: "Ctrl+C", label: "Interrupt" }],
          history: false,
          inputMode: "keys",
          pointer: "none",
          presentation: "terminal",
          secretInput: false,
        }),
      );
    }
    if (
      entry.foreground?.kind === "pipeline" &&
      (interaction.context === "less" || interaction.context === "more") &&
      entry.stopIntent === undefined
    ) {
      return own(interaction);
    }
    const vmState = entry.vm?.state;
    const acceptsTerminalInput =
      entry.stopIntent === undefined &&
      entry.foreground === undefined &&
      entry.compileJob === undefined &&
      entry.debugJob === undefined &&
      entry.jobWait === undefined &&
      vmState?.kind === "waiting_event" &&
      vmState.filter === undefined;
    if (acceptsTerminalInput) return own(interaction);

    const interrupt =
      entry.stopIntent === undefined &&
      (entry.foreground !== undefined ||
        entry.compileJob !== undefined ||
        entry.debugJob !== undefined);
    return own(
      createTerminalInteractionDescriptor({
        context: "busy",
        ctrlCAction: interrupt ? "interrupt" : "none",
        cursorShape: interaction.cursorShape,
        ...(interaction.helpTopicId === undefined
          ? {}
          : { helpTopicId: interaction.helpTopicId }),
        hints: interrupt ? [{ key: "Ctrl+C", label: "Interrupt" }] : [],
        history: false,
        inputMode: "none",
        pointer: "none",
        presentation: interaction.presentation,
        secretInput: interaction.secretInput,
      }),
    );
  }

  cancelTerminalInteraction(computerId: string): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (
      this.terminalInteraction(computerId).ctrlCAction !== "cancel" ||
      entry.shell?.cancelTerminalInteraction() !== true
    ) {
      return { outcome: "ignored", reason: "not_running" };
    }
    writeTerminalLines(entry.record.terminal, ["^C"]);
    writeTerminalPrompt(entry.record.terminal, entry.shell.prompt());
    return { outcome: "accepted", state: "interaction_cancelled" };
  }

  private ownTerminalInteraction(
    entry: RuntimeEntry,
    interaction: TerminalInteractionDescriptor,
  ): TerminalInteractionDescriptor {
    const signature = [
      interaction.context,
      interaction.ctrlCAction,
      interaction.cursorShape,
      interaction.history ? "history" : "no-history",
      interaction.inputMode,
      interaction.pointer,
      interaction.presentation,
      interaction.secretInput ? "secret" : "plain",
    ].join("\0");
    if (entry.terminalInteractionSignature !== signature) {
      entry.terminalInteractionSignature = signature;
      entry.terminalInteractionGeneration =
        entry.terminalInteractionGeneration === undefined ||
        entry.terminalInteractionGeneration === Number.MAX_SAFE_INTEGER
          ? 1
          : entry.terminalInteractionGeneration + 1;
    }
    return withTerminalInteractionGeneration(
      interaction,
      entry.terminalInteractionGeneration ?? 1,
    );
  }

  isShellSecretInput(computerId: string): boolean {
    return this.terminalInteraction(computerId).secretInput;
  }

  executeDebugShellCommand(
    computerId: string,
    line: string,
  ): DebugShellCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.shell === undefined || entry.csBiosSequence !== undefined)
      return { outcome: "ignored", reason: "not_running" };
    if (entry.stopIntent !== undefined)
      return { outcome: "ignored", reason: "stopping" };
    if (!entry.shell.isAuthenticated()) return debugLoginRequired();
    if (entry.foreground !== undefined || entry.compileJob !== undefined) {
      return {
        outcome: "completed",
        exitCode: 2,
        stdout: "",
        stderr: "debug: a foreground process is already running\n",
        cpuCycles: 1,
      };
    }
    try {
      const trimmed = line.trim();
      const inlinePython = /^(micropython|python)\s+-c\s+([\s\S]+)$/u.exec(
        trimmed,
      );
      if (inlinePython !== null) {
        const admitted = entry.shell.admitDebugInlinePython(
          inlinePython[1] as "micropython" | "python",
        );
        if (admitted.foreground?.kind === "python") {
          const request = admitted.foreground;
          return this.executeSynchronousOsProcess(entry, request, () =>
            this.executeDebugPython(entry, request, inlinePython[2] ?? ""),
          );
        }
        return {
          outcome: "completed",
          exitCode: admitted.exitCode,
          stderr: admitted.stderr,
          stdout: admitted.stdout,
          cpuCycles: admitted.cpuCycles ?? 1,
        };
      }
      const result = entry.shell.submitDebugCommand(line);
      if (result.foreground?.kind === "compile") {
        let completion: DebugShellCommandCompletion | undefined;
        const started = this.startCompileJob(
          entry,
          result.foreground,
          (value) => {
            completion = value;
          },
        );
        if (started.outcome === "failed") {
          return {
            outcome: "completed",
            exitCode: started.exitCode,
            stderr: started.stderr,
            stdout: "",
            cpuCycles: started.cpuCycles ?? 1,
          };
        }
        const job = currentCompileJob(entry);
        if (job === undefined) throw new Error("Unable to start compile job");
        const compileCommand = job.request.command;
        try {
          let attempts = 0;
          do {
            this.executeCompileJob(entry, job);
            attempts += 1;
            if (attempts > 258) {
              throw new Error("Synchronous make step limit exceeded");
            }
          } while (
            job.request.task.kind === "make" &&
            job.makeIoWaitEvent === undefined &&
            entry.compileJob === job &&
            completion === undefined
          );
        } catch (error: unknown) {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          this.completeCompileJob(
            entry,
            1,
            compileJobErrorTranscript(
              compileCommand,
              normalized,
              getOsProfile(activeOsProfile(entry)),
              compileJobFallbackSource(job.request),
            ),
          );
        }
        if (completion !== undefined) return completion;
        return {
          outcome: "failed",
          error: new Error("Synchronous compiled execution is not supported"),
        };
      }
      if (result.foreground?.kind === "python") {
        const request = result.foreground;
        return this.executeSynchronousOsProcess(entry, request, () =>
          this.executeDebugPython(entry, request),
        );
      }
      if (result.foreground?.kind === "debugger") {
        const request = result.foreground;
        return this.executeSynchronousOsProcess(entry, request, () =>
          this.executeDebugDebugger(entry, request),
        );
      }
      if (result.foreground?.kind === "cs486") {
        const request = result.foreground;
        return this.executeSynchronousOsProcess(entry, request, () => {
          const instanceId = `sync-${String(this.nextRuntimeId++)}`;
          const grant = grantExecutableProcessMemory(
            entry,
            request.executable,
            request.command,
            instanceId,
          );
          try {
            const collectMicroarchitectureStats =
              this.shouldCollectMicroarchitectureStats(request.stats);
            const executed =
              request.hostedStartup === undefined
                ? collectMicroarchitectureStats
                  ? runCs486(request.executable, {
                      collectMicroarchitectureStats: true,
                      cpuModel: entry.record.hardware.cpuModel,
                      instructionLimit: 100_000,
                      memoryBytes: grant.memoryBytes,
                    })
                  : runCs486(request.executable, {
                      collectMicroarchitectureStats: false,
                      cpuModel: entry.record.hardware.cpuModel,
                      instructionLimit: 100_000,
                      memoryBytes: grant.memoryBytes,
                    })
                : this.runSynchronousHostedCs486(
                    entry,
                    request,
                    request.hostedStartup,
                    grant.memoryBytes,
                    collectMicroarchitectureStats,
                  );
            const cpuCycles = Math.min(
              1_000_000,
              request.compileCycles + executed.cycles,
            );
            const completion: DebugShellCommandCompletion = {
              outcome: "completed",
              exitCode: executed.state === "halted" ? 0 : 124,
              stdout: executed.output,
              stderr: request.stats
                ? `${cs486RunResultStats(executed, entry.record.hardware).join("\n")}\n`
                : executed.state === "yielded"
                  ? `${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: execution limit reached\n`
                  : "",
              cpuCycles,
            };
            entry.shell?.completeForegroundProcess(completion.exitCode);
            return completion;
          } finally {
            releaseGuestProcessMemory(grant);
          }
        });
      }
      return {
        outcome: "completed",
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        cpuCycles: result.cpuCycles ?? 1,
      };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Starts MCP-facing guest execution without running a guest loop on the
   * Script API callback stack. The completion callback is owned by this
   * runtime and is invoked exactly once after the scheduler reaches a terminal
   * state. Non-guest commands complete immediately through the same callback.
   */
  enqueueDebugShellCommand(
    computerId: string,
    line: string,
    onComplete: (result: DebugShellCommandCompletion) => void,
  ): void {
    const entry = this.entries.get(computerId);
    if (entry === undefined) {
      onComplete({ outcome: "missing", computerId });
      return;
    }
    if (entry.shell === undefined || entry.csBiosSequence !== undefined) {
      onComplete({ outcome: "ignored", reason: "not_running" });
      return;
    }
    if (entry.stopIntent !== undefined) {
      onComplete({ outcome: "ignored", reason: "stopping" });
      return;
    }
    if (!entry.shell.isAuthenticated()) {
      onComplete(debugLoginRequired());
      return;
    }
    if (
      entry.foreground !== undefined ||
      entry.compileJob !== undefined ||
      entry.debugJob !== undefined
    ) {
      onComplete({
        outcome: "completed",
        exitCode: 2,
        stdout: "",
        stderr: "debug: a foreground process is already running\n",
        cpuCycles: 1,
      });
      return;
    }
    try {
      const trimmed = line.trim();
      const inlinePython = /^(micropython|python)\s+-c\s+([\s\S]+)$/u.exec(
        trimmed,
      );
      if (inlinePython !== null) {
        const admitted = entry.shell.admitDebugInlinePython(
          inlinePython[1] as "micropython" | "python",
        );
        if (admitted.foreground?.kind === "python")
          this.enqueueDebugPython(
            entry,
            admitted.foreground,
            inlinePython[2] ?? "",
            onComplete,
          );
        else
          onComplete({
            outcome: "completed",
            exitCode: admitted.exitCode,
            stderr: admitted.stderr,
            stdout: admitted.stdout,
            cpuCycles: admitted.cpuCycles ?? 1,
          });
        return;
      }
      const result = entry.shell.submitDebugCommand(line);
      if (result.foreground?.kind === "compile") {
        const started = this.startCompileJob(
          entry,
          result.foreground,
          onComplete,
        );
        if (started.outcome === "failed") {
          onComplete({
            outcome: "completed",
            exitCode: started.exitCode,
            stderr: started.stderr,
            stdout: "",
            cpuCycles: started.cpuCycles ?? 1,
          });
        }
        return;
      }
      if (result.foreground?.kind === "python") {
        this.enqueueDebugPython(
          entry,
          result.foreground,
          undefined,
          onComplete,
        );
        return;
      }
      if (result.foreground?.kind === "debugger") {
        this.enqueueDebugDebugger(entry, result.foreground, onComplete);
        return;
      }
      if (result.foreground?.kind === "cs486") {
        this.enqueueDebugCs486(entry, result.foreground, onComplete);
        return;
      }
      onComplete({
        outcome: "completed",
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        cpuCycles: result.cpuCycles ?? 1,
      });
    } catch (error: unknown) {
      onComplete({
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private enqueueDebugPython(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "python" }>,
    inlineSource: string | undefined,
    onComplete: (result: DebugShellCommandCompletion) => void,
  ): void {
    const cpu = cpuModelSpecification(entry.record.hardware.cpuModel);
    if (!cpu.supportsMicroPython) {
      onComplete({
        outcome: "completed",
        exitCode: 127,
        stdout: "",
        stderr: `MicroPython is not available on ${cpu.runtimeName}\n`,
        cpuCycles: 1,
      });
      return;
    }
    const filesystem = guestFilesystemForEntry(
      entry,
      request.credentials,
      request.umask,
    );
    const source = inlineSource ?? filesystem.readFile(request.path);
    const terminal = new TerminalBuffer(80, 25);
    const runtimeId = this.nextRuntimeId++;
    const environment = createAccountedNativeEnvironment({
      clock: this.clock,
      computerId: numericComputerId(entry.record.computerId),
      computerName: entry.record.computerId,
      osProfile: activeOsProfile(entry),
      osRuntimeState: entry.osRuntimeState,
      dosRuntimeState: activeDosRuntimeState(entry),
      filesystem: activeFilesystem(entry),
      exposeShellModule: false,
      guestFilesystem: filesystem,
      shell: entry.shell,
      terminal,
      hardware: entry.record.hardware,
      guestRamLedger: requireGuestRamLedger(entry),
      currentTick: (): number => this.scheduler.tickNumber,
      ticksPerSecond: this.ticksPerSecond,
      serial: this.serial,
      peripherals: this.peripherals,
      runHostWork: (lane, units, operation) =>
        this.runHostWork(lane, units, entry.record.computerId, operation),
    });
    const prepared = preparePythonCs486Program({
      collectMicroarchitectureStats: this.shouldCollectMicroarchitectureStats(
        request.stats,
      ),
      cpuModel: entry.record.hardware.cpuModel,
      environment,
      filesystem,
      path: request.path,
      source,
    });
    const memoryGrant = grantCs486MemoryRequirements(
      prepared.requirements,
      guestProcessMemoryAdmission(
        entry,
        request.command,
        `runtime-${String(runtimeId)}`,
      ),
    );
    let process: Cs486Process;
    try {
      process = prepared.create(memoryGrant.memoryBytes).process;
    } catch (error: unknown) {
      releaseGuestProcessMemory(memoryGrant);
      throw error;
    }
    this.startDebugJob(
      entry,
      {
        compileCycles: 0,
        kind: "python",
        memoryGrant,
        onComplete,
        process,
        runtimeId,
        stats: true,
        terminal,
      },
      { command: request.command, credentials: request.credentials },
    );
  }

  private enqueueDebugCs486(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "cs486" }>,
    onComplete: (result: DebugShellCommandCompletion) => void,
  ): void {
    const runtimeId = this.nextRuntimeId++;
    const granted = createGrantedCs486Process(
      entry,
      request.executable,
      request.command,
      runtimeId,
      {
        collectMicroarchitectureStats: this.shouldCollectMicroarchitectureStats(
          request.stats,
        ),
        remoteFactory: this.remoteCs486ProcessFactory,
        syscallHandler: rejectCsAbiSyscallHandler,
      },
    );
    this.startDebugJob(
      entry,
      {
        compileCycles: request.compileCycles,
        instructionLimit: 100_000,
        kind: "cs486",
        memoryGrant: granted.grant,
        onComplete,
        process: granted.process,
        runtimeId,
        stats: request.stats,
      },
      { command: request.command, credentials: request.credentials },
    );
  }

  private enqueueDebugDebugger(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "debugger" }>,
    onComplete: (result: DebugShellCommandCompletion) => void,
  ): void {
    this.startDebugJob(
      entry,
      {
        compileCycles: 0,
        kind: "debugger",
        onComplete,
        process: request.start(),
        runtimeId: this.nextRuntimeId++,
        shellCompletion: request.complete,
        stats: false,
      },
      { command: request.command, credentials: request.credentials },
    );
  }

  private startDebugJob(
    entry: RuntimeEntry,
    job: Omit<DebugGuestJob, "cpuCycles" | "executedInstructions" | "osPid">,
    owner: OsGuestProcessOwner,
  ): void {
    let osPid: number | undefined;
    let scheduled = false;
    try {
      osPid =
        owner.osPid ??
        this.startOsProcess(entry, owner.command, owner.credentials);
      const active: DebugGuestJob = {
        ...job,
        cpuCycles: 0,
        executedInstructions: 0,
        osPid,
        ...(job.stats
          ? { startedHostMilliseconds: this.readHostElapsedMilliseconds() }
          : {}),
      };
      active.memoryGrant?.bindProcess(osPid);
      this.scheduler.add(
        active.runtimeId,
        active.process,
        hardwareCpuCyclesPerTick(
          entry.record.hardware.clockHz,
          this.ticksPerSecond,
          this.guestRealtimeDivisor,
        ),
      );
      scheduled = true;
      this.runtimeOwners.set(active.runtimeId, entry);
      this.runtimeLanes.set(active.runtimeId, "mcp_debug");
      entry.debugJob = active;
    } catch (error: unknown) {
      if (scheduled) this.unschedule(job.runtimeId);
      terminateAndDisposeRejectedProcess(
        job.process,
        "debug process admission failed",
      );
      releaseGuestProcessMemory(job.memoryGrant);
      if (osPid !== undefined) this.completeOsProcess(entry, osPid, 1);
      throw error;
    }
  }

  private updateDebugJob(
    entry: RuntimeEntry,
    measured:
      | {
          readonly cpuCycles: number;
          readonly executedInstructions: number;
        }
      | undefined,
  ): void {
    const job = entry.debugJob;
    if (job === undefined) return;
    if (measured !== undefined) {
      job.cpuCycles = Math.min(
        100_000_000,
        job.compileCycles + measured.cpuCycles,
      );
      job.executedInstructions = measured.executedInstructions;
    }
    const state = job.process.state;
    if (state.kind === "sleeping" || state.kind === "waiting_event") {
      job.termination = "unsupported_wait";
      job.terminationSignal = "SIGTERM";
      job.process.terminate(
        "MCP debug execution does not support waits or long-running work",
      );
    } else if (
      job.instructionLimit !== undefined &&
      job.executedInstructions >= job.instructionLimit &&
      state.kind === "ready"
    ) {
      job.termination = "instruction_limit";
      job.terminationSignal = "SIGTERM";
      job.process.terminate("execution limit reached");
    } else if (job.cpuCycles >= 100_000_000 && state.kind === "ready") {
      job.termination = "cpu_limit";
      job.terminationSignal = "SIGTERM";
      job.process.terminate("MCP debug CPU cycle limit reached");
    }
    const terminalState = job.process.state;
    if (
      !job.process.hasPendingCpuCycles &&
      (terminalState.kind === "completed" ||
        terminalState.kind === "crashed" ||
        terminalState.kind === "terminated")
    ) {
      this.completeDebugJob(entry, job, terminalState);
    }
  }

  private completeDebugJob(
    entry: RuntimeEntry,
    job: DebugGuestJob,
    state: Extract<
      CpuProcessState,
      { readonly kind: "completed" | "crashed" | "terminated" }
    >,
  ): void {
    this.unschedule(job.runtimeId);
    entry.debugJob = undefined;
    releaseGuestProcessMemory(job.memoryGrant);
    if (job.kind === "debugger") {
      let result: Extract<
        DebugShellCommandResult,
        { readonly outcome: "completed" }
      >;
      try {
        if (job.shellCompletion === undefined)
          throw new Error("debugger completion owner is missing");
        const shellResult = job.shellCompletion();
        result =
          job.termination === "cpu_limit" ||
          job.termination === "unsupported_wait"
            ? {
                outcome: "completed",
                exitCode: 2,
                stderr:
                  "MCP debug execution does not support waits or long-running work\n",
                stdout: shellResult.stdout,
                cpuCycles: Math.max(1, job.cpuCycles),
              }
            : job.termination === "instruction_limit"
              ? {
                  outcome: "completed",
                  exitCode: 124,
                  stderr: "debugger execution limit reached\n",
                  stdout: shellResult.stdout,
                  cpuCycles: Math.max(1, job.cpuCycles),
                }
              : debugCompletionFromShellResult(shellResult, job.cpuCycles);
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        result = {
          outcome: "completed",
          exitCode: 1,
          stderr: `debugger: ${normalized.name}: ${normalized.message}\n`,
          stdout: "",
          cpuCycles: Math.max(1, job.cpuCycles),
        };
      }
      this.completeOsProcess(
        entry,
        job.osPid,
        result.exitCode,
        result.cpuCycles,
        state.kind === "terminated" ? job.terminationSignal : undefined,
      );
      entry.shell?.completeForegroundProcess(result.exitCode);
      job.onComplete(result);
      return;
    }
    const stdout =
      job.kind === "python"
        ? terminalStdout(job.terminal!)
        : observableCs486Process(job.process).output;
    let result: DebugShellCommandCompletion;
    if (job.termination === "instruction_limit") {
      result = {
        outcome: "completed",
        exitCode: 124,
        stdout,
        stderr: `${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: execution limit reached\n`,
        cpuCycles: job.cpuCycles,
      };
    } else if (
      job.termination === "unsupported_wait" ||
      job.termination === "cpu_limit"
    ) {
      result = {
        outcome: "completed",
        exitCode: 2,
        stdout,
        stderr:
          "MCP debug execution does not support waits or long-running work\n",
        cpuCycles: job.cpuCycles,
      };
    } else if (state.kind === "crashed") {
      result = {
        outcome: "completed",
        exitCode: 1,
        stdout,
        stderr: `${state.error.name}: ${state.error.message}\n`,
        cpuCycles: job.cpuCycles,
      };
    } else if (state.kind === "terminated") {
      result = {
        outcome: "completed",
        exitCode: 130,
        stdout,
        stderr: "debug: execution terminated\n",
        cpuCycles: job.cpuCycles,
      };
    } else {
      result = {
        outcome: "completed",
        exitCode: 0,
        stdout,
        stderr:
          job.kind === "python"
            ? pythonStats(
                job.executedInstructions,
                job.cpuCycles,
                "completed",
                entry.record.hardware,
                this.elapsedHostMilliseconds(job.startedHostMilliseconds),
              )
            : job.stats
              ? `${cs486Stats(
                  job.executedInstructions,
                  job.cpuCycles,
                  "halted",
                  entry.record.hardware,
                  observableCs486Process(job.process),
                  this.elapsedHostMilliseconds(job.startedHostMilliseconds),
                ).join("\n")}\n`
              : "",
        cpuCycles: job.cpuCycles,
      };
    }
    this.completeOsProcess(
      entry,
      job.osPid,
      result.exitCode,
      result.cpuCycles,
      state.kind === "terminated" ? job.terminationSignal : undefined,
    );
    entry.shell?.completeForegroundProcess(result.exitCode);
    job.onComplete(result);
  }

  private executeDebugDebugger(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "debugger" }>,
  ): DebugShellCommandResult {
    let process: CpuProcess | undefined;
    try {
      process = request.start();
      let cpuCycles = 0;
      let slices = 0;
      while (!isTerminalProcessState(process.state)) {
        if (slices >= 1_024)
          throw new Error("bounded debugger execution did not terminate");
        const slice = process.runCpuSlice(1_000_000, 100_000);
        cpuCycles += slice.cpuCycles;
        slices += 1;
        if (
          slice.cpuCycles === 0 &&
          slice.executedInstructions === 0 &&
          !isTerminalProcessState(slice.state)
        )
          throw new Error("bounded debugger execution made no progress");
      }
      const completed = request.complete();
      entry.shell?.completeForegroundProcess(completed.exitCode);
      return debugCompletionFromShellResult(completed, cpuCycles);
    } catch (error: unknown) {
      try {
        process?.terminate("debugger execution failed");
      } catch {
        // The original failure remains the observable result.
      }
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      entry.shell?.completeForegroundProcess(1);
      return {
        outcome: "completed",
        exitCode: 1,
        stderr: `debugger: ${normalized.name}: ${normalized.message}\n`,
        stdout: "",
        cpuCycles: 1,
      };
    }
  }

  private executeDebugPython(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "python" }>,
    inlineSource?: string,
  ): DebugShellCommandResult {
    const cpu = cpuModelSpecification(entry.record.hardware.cpuModel);
    if (!cpu.supportsMicroPython) {
      const result: DebugShellCommandCompletion = {
        outcome: "completed",
        exitCode: 127,
        stdout: "",
        stderr: `MicroPython is not available on ${cpu.runtimeName}\n`,
        cpuCycles: 1,
      };
      entry.shell?.completeForegroundProcess(result.exitCode);
      return result;
    }
    const filesystem = guestFilesystemForEntry(
      entry,
      request.credentials,
      request.umask,
    );
    const source = inlineSource ?? filesystem.readFile(request.path);
    const terminal = new TerminalBuffer(80, 25);
    const environment = createAccountedNativeEnvironment({
      clock: this.clock,
      computerId: numericComputerId(entry.record.computerId),
      computerName: entry.record.computerId,
      osProfile: activeOsProfile(entry),
      osRuntimeState: entry.osRuntimeState,
      dosRuntimeState: activeDosRuntimeState(entry),
      filesystem: activeFilesystem(entry),
      exposeShellModule: false,
      guestFilesystem: filesystem,
      terminal,
      hardware: entry.record.hardware,
      guestRamLedger: requireGuestRamLedger(entry),
      currentTick: (): number => this.scheduler.tickNumber,
      shell: entry.shell,
      ticksPerSecond: this.ticksPerSecond,
      serial: this.serial,
      peripherals: this.peripherals,
      runHostWork: (lane, units, operation) =>
        this.runHostWork(lane, units, entry.record.computerId, operation),
    });
    const prepared = preparePythonCs486Program({
      collectMicroarchitectureStats: this.shouldCollectMicroarchitectureStats(
        request.stats,
      ),
      cpuModel: entry.record.hardware.cpuModel,
      environment,
      filesystem,
      path: request.path,
      source,
    });
    const memoryGrant = grantCs486MemoryRequirements(
      prepared.requirements,
      guestProcessMemoryAdmission(
        entry,
        request.command,
        `sync-${String(this.nextRuntimeId++)}`,
      ),
    );
    let vm: Cs486Process;
    try {
      vm = prepared.create(memoryGrant.memoryBytes).process;
    } catch (error: unknown) {
      releaseGuestProcessMemory(memoryGrant);
      throw error;
    }
    try {
      const maximumCpuCycles = 100_000_000;
      let cpuCycles = 0;
      let instructions = 0;
      while (
        (vm.state.kind === "ready" || vm.hasPendingCpuCycles) &&
        cpuCycles < maximumCpuCycles
      ) {
        const slice = vm.runCpuSlice(
          Math.min(1_000_000, maximumCpuCycles - cpuCycles),
        );
        if (slice.cpuCycles === 0) break;
        cpuCycles += slice.cpuCycles;
        instructions += slice.executedInstructions;
      }
      const output = terminal.snapshot().rows.join("\n").trimEnd();
      const stdout = output.length === 0 ? "" : `${output}\n`;
      if (vm.state.kind === "completed") {
        const result: DebugShellCommandCompletion = {
          outcome: "completed",
          exitCode: 0,
          stdout,
          stderr: pythonStats(
            instructions,
            cpuCycles,
            "completed",
            entry.record.hardware,
          ),
          cpuCycles,
        };
        entry.shell?.completeForegroundProcess(result.exitCode);
        return result;
      }
      if (vm.state.kind === "crashed") {
        const result: DebugShellCommandCompletion = {
          outcome: "completed",
          exitCode: 1,
          stdout,
          stderr: `${vm.state.error.name}: ${vm.state.error.message}\n`,
          cpuCycles,
        };
        entry.shell?.completeForegroundProcess(result.exitCode);
        return result;
      }
      vm.terminate(
        "MCP debug execution does not support waits or long-running work",
      );
      const result: DebugShellCommandCompletion = {
        outcome: "completed",
        exitCode: 2,
        stdout,
        stderr:
          cpuCycles >= maximumCpuCycles
            ? `Python/${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: CPU cycle limit ${String(maximumCpuCycles)} exceeded\n`
            : `Python/${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: waits and asynchronous work are not supported through MCP\n`,
        cpuCycles,
      };
      entry.shell?.completeForegroundProcess(result.exitCode);
      return result;
    } finally {
      releaseGuestProcessMemory(memoryGrant);
    }
  }

  resizeTerminal(computerId: string, width: number, height: number): boolean {
    const entry = this.entries.get(computerId);
    if (
      entry === undefined ||
      entry.shell === undefined ||
      entry.csBiosSequence !== undefined ||
      width !== 80 ||
      height !== 25
    ) {
      return false;
    }
    entry.record.terminal.resize(width, height);
    const screen = entry.shell.resize(width, height);
    if (screen !== undefined)
      renderTerminalScreen(entry.record.terminal, screen);
    return true;
  }

  private boot(entry: RuntimeEntry): RuntimeCommandResult {
    let bootPhase = "runtime preparation";
    try {
      const safeBoot = entry.safeBootOnce === true;
      entry.safeBootOnce = false;
      const floppyMedia = entry.floppyDrive.media;
      const floppyBoot = !safeBoot && floppyMedia?.bootable === true;
      const activeProfile: ComputerOsProfile = floppyBoot
        ? "dos"
        : entry.record.osProfile;
      entry.activeOsProfile = activeProfile;
      entry.guestRamLedger = new GuestRamLedger(
        entry.record.hardware.memoryBytes,
      );
      entry.osRuntimeState = floppyBoot
        ? OsRuntimeState.restore(entry.record.computerId, undefined)
        : entry.installedOsRuntimeState;
      entry.transientDosRuntimeState = floppyBoot
        ? DosRuntimeState.createFloppyBoot({
            generation: floppyMedia.instanceGeneration,
            readOnly: floppyMedia.writeProtected,
            volumeLabel: floppyMedia.volumeLabel,
          })
        : undefined;
      const activeDosRuntime =
        entry.transientDosRuntimeState ?? entry.dosRuntimeState;
      this.prepareOsRuntimeBoot(entry);
      entry.record.faceIo.powerOn();
      if (entry.record.display.state.kind === "faulted") {
        entry.record.display.transition({ kind: "reset" });
      } else if (entry.record.display.state.kind !== "off") {
        entry.record.display.transition({ kind: "power_off" });
      }
      const post = entry.record.display.transition({ kind: "enter_post" });
      if (post.outcome !== "changed") {
        throw new Error(`Unable to start CSBIOS POST: ${post.outcome}`);
      }
      entry.csBiosSequence = startCsBiosBootSequence(entry.record, {
        bootProfile: activeProfile,
        bootSource: floppyBoot ? "floppy" : "fixed_disk",
        floppyPresent: floppyMedia !== undefined,
        startTick: this.scheduler.tickNumber,
        ticksPerSecond: this.ticksPerSecond,
      });
      const supportsMicroPython = cpuModelSpecification(
        entry.record.hardware.cpuModel,
      ).supportsMicroPython;
      // ShellSession owns OS/account migration. The callback is replaced from
      // the authoritative database before source discovery or guest execution;
      // this initial value only lets the credentialed view be constructed.
      let startupCredentials = initialUserCredentials;
      const activeFilesystem = floppyBoot
        ? new InMemoryFilesystem()
        : entry.record.filesystem;
      entry.activeFilesystem = activeFilesystem;
      const installedFilesystem =
        activeProfile === "linux"
          ? credentialedFilesystem(
              activeFilesystem,
              () => startupCredentials,
              0o022,
            )
          : unrestrictedGuestFilesystem(activeFilesystem, 0o022);
      const startupFilesystem: GuestFilesystem = new FloppyGuestFilesystem(
        installedFilesystem,
        entry.floppyDrive,
        activeProfile,
      );
      if (
        activeDosRuntime !== undefined &&
        floppyMedia !== undefined &&
        entry.transientDosRuntimeState === undefined
      ) {
        const current = activeDosRuntime.driveState("A");
        if (current.mediaPresent)
          activeDosRuntime.ejectMedia("A", current.mediaGeneration);
        const detached = activeDosRuntime.driveState("A");
        activeDosRuntime.mountMedia("A", {
          generation: Math.max(
            floppyMedia.instanceGeneration,
            detached.mediaGeneration + 1,
          ),
          readOnly: floppyMedia.writeProtected,
          volumeLabel: floppyMedia.volumeLabel,
        });
      }
      const nativeContext: AccountedNativeModuleContext = {
        clock: this.clock,
        computerId: numericComputerId(entry.record.computerId),
        computerName: entry.record.computerId,
        osProfile: activeProfile,
        osRuntimeState: entry.osRuntimeState,
        onOsRuntimeChanged: () => this.syncOsRuntimeState(entry),
        dosRuntimeState: activeDosRuntime,
        onDosRuntimeChanged: () => {
          if (!floppyBoot) this.syncDosRuntimeState(entry);
        },
        signalProcess: (pid, signal) =>
          this.signalOsProcess(entry, pid, signal),
        filesystem: activeFilesystem,
        exposeShellModule: false,
        guestFilesystem: startupFilesystem,
        terminal: entry.record.terminal,
        hardware: entry.record.hardware,
        collectMicroarchitectureStatsByDefault:
          this.collectMicroarchitectureStatsByDefault,
        guestRamLedger: requireGuestRamLedger(entry),
        redstone: entry.record.redstone,
        currentTick: () => this.scheduler.tickNumber,
        queueEvent: (name, ...arguments_) =>
          this.scheduler.queueEvent(entry.runtimeId, name, ...arguments_),
        startTimer: (delay) =>
          this.scheduler.startTimer(entry.runtimeId, delay),
        cancelTimer: (timerId) =>
          this.scheduler.cancelTimer(entry.runtimeId, timerId),
        shutdown: () => this.requestEntryStop(entry, "shutdown", "shutdown"),
        reboot: () => this.requestEntryStop(entry, "reboot", "reboot"),
        startForegroundProcess: (request) =>
          this.startForegroundProcess(entry, request),
        startBackgroundProcess: (request) =>
          this.startBackgroundProcess(entry, request),
        startJobControl: (request) => this.startJobControl(entry, request),
        ticksPerSecond: this.ticksPerSecond,
        requireLinuxLogin: activeProfile === "linux" && this.requireLinuxLogin,
        serial: this.serial,
        peripherals: this.peripherals,
        requestFilesystemIo: (operation, bytes) =>
          this.filesystemIoRequester?.(
            entry.record.computerId,
            operation,
            bytes,
          ),
        requestFloppyIo: (requests) =>
          this.floppyIoRequester?.(entry.record.computerId, requests),
        floppyDrive: entry.floppyDrive,
        syncFilesystem: () => this.performPersistenceSync(entry, "manual"),
        runHostWork: (lane, units, operation) =>
          this.runHostWork(lane, units, entry.record.computerId, operation),
      };
      bootPhase = "native shell initialization";
      let environment = createAccountedNativeEnvironment(nativeContext);
      entry.shell = environment.shell;
      entry.dosGuestMemoryManager = environment.shell.dosMemoryManager();
      entry.linuxGuestMemoryManager = environment.shell.linuxMemoryManager();
      if (activeProfile === "linux") {
        startupCredentials = linuxStartupCredentials(entry.record);
      }
      bootPhase = "startup source selection";
      let source = this.defaultBootSource;
      let usesInternalBootProgram = true;
      if (supportsMicroPython && activeProfile === "linux") {
        if (!safeBoot && startupFilesystem.exists("/startup.py")) {
          const configuredSource = startupFilesystem.readFile("/startup.py");
          if (configuredSource.length > 0) {
            source = configuredSource;
            usesInternalBootProgram = false;
          }
        } else {
          // `/` remains root-owned. Trusted boot creates only the documented
          // service entry point; UID 1000 can then edit the existing file
          // without gaining permission to create arbitrary root-level paths.
          if (!startupFilesystem.exists("/startup.py")) {
            entry.record.filesystem.writeFile("/startup.py", "");
            entry.record.filesystem.setMetadata("/startup.py", {
              gid: startupCredentials.effectiveGroupId,
              mode: 0o644,
              uid: startupCredentials.effectiveUserId,
            });
          }
        }
      }
      if (safeBoot) {
        entry.osRuntimeState.appendBootJournal(
          this.scheduler.tickNumber,
          "safe boot selected; /startup.py preserved and bypassed",
          "notice",
        );
      }
      if (usesInternalBootProgram) {
        environment = createAccountedNativeEnvironment({
          ...nativeContext,
          exposeShellModule: true,
          shell: environment.shell,
        });
      }
      bootPhase = "Python-to-CS486 preparation";
      const preparedBootProgram = preparePythonCs486Program({
        collectMicroarchitectureStats:
          this.shouldCollectMicroarchitectureStats(),
        cpuModel: entry.record.hardware.cpuModel,
        environment,
        filesystem: startupFilesystem,
        managedRuntimeMemoryBytes: usesInternalBootProgram
          ? internalBootManagedMemoryBytes
          : userBootManagedMemoryBytes(entry.record.hardware.memoryBytes),
        ...(usesInternalBootProgram ? { managedRuntimeResidentBytes: 0 } : {}),
        path: "/startup.py",
        source,
      });
      bootPhase = "guest memory admission";
      const bootGrant = grantCs486MemoryRequirements(
        preparedBootProgram.requirements,
        guestProcessMemoryAdmission(
          entry,
          "system",
          `runtime-${String(entry.runtimeId)}`,
          "System boot process",
        ),
      );
      bootGrant.bindProcess(1);
      entry.vmMemoryGrant = bootGrant;
      bootPhase = "CS486 process creation";
      const vm = preparedBootProgram.create(bootGrant.memoryBytes).process;
      entry.vm = vm;
      entry.shell = environment.shell;
      entry.stopIntent = undefined;
      bootPhase = "scheduler admission";
      this.scheduler.add(
        entry.runtimeId,
        vm,
        hardwareCpuCyclesPerTick(
          entry.record.hardware.clockHz,
          this.ticksPerSecond,
          this.guestRealtimeDivisor,
        ),
      );
      this.scheduler.setPaused(entry.runtimeId, true);
      this.runtimeOwners.set(entry.runtimeId, entry);
      this.runtimeLanes.set(entry.runtimeId, "guest_cpu");
      this.pendingCsBiosEntries.add(entry);
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    } catch (error: unknown) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      normalized.message = `${normalized.message} [boot phase: ${bootPhase}]`;
      entry.csBiosSequence?.cancel();
      entry.csBiosSequence = undefined;
      this.pendingCsBiosEntries.delete(entry);
      this.unschedule(entry.runtimeId);
      entry.vm = undefined;
      entry.shell = undefined;
      this.faultOsRuntime(entry, normalized.message);
      entry.record.lifecycle.transition({
        kind: "crash",
        message: normalized.message,
      });
      entry.record.faceIo.powerOff("boot_failed");
      entry.record.display.transition({
        kind: "fault",
        message: normalized.message.slice(0, 256) || "CSBIOS boot failure",
      });
      this.finalizeGuestRam(entry);
      return { outcome: "failed", error: normalized };
    }
  }

  private startForegroundProcess(
    entry: RuntimeEntry,
    request: ShellForegroundRequest,
  ): ForegroundProcessStartResult {
    if (entry.stopIntent !== undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: new work is not admitted while the OS is stopping\n`,
      };
    }
    if (entry.foreground !== undefined || entry.compileJob !== undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: a foreground process is already running\n`,
      };
    }
    if (entry.vm === undefined || entry.shell === undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: shell runtime is not running\n`,
      };
    }
    if (request.kind === "compile") {
      return this.startCompileJob(entry, request);
    }
    const cpu = cpuModelSpecification(entry.record.hardware.cpuModel);
    if (request.kind === "python" && !cpu.supportsMicroPython) {
      return {
        outcome: "failed",
        exitCode: 127,
        stderr: `${request.command}: MicroPython is not available on ${cpu.runtimeName}\n`,
      };
    }
    let process: CpuProcess | undefined;
    let memoryGrant: GuestProcessMemoryGrant | undefined;
    let csAbi: CsAbiRuntime | undefined;
    let osPid: number | undefined;
    let osPids: number[] = [];
    let runtimeId: number | undefined;
    let scheduled = false;
    try {
      runtimeId = this.nextRuntimeId++;
      const completionEvent = `${foregroundCompletionEvent}:${String(runtimeId)}`;
      if (request.kind === "python") {
        const granted = this.createForegroundPythonProcess(
          entry,
          request,
          runtimeId,
        );
        process = granted.process;
        memoryGrant = granted.memoryGrant;
      } else if (request.kind === "pipeline") {
        process = request.start((stageRequest) => {
          const stageRuntimeId = this.nextRuntimeId++;
          if (stageRequest.kind === "python") {
            const granted = this.createForegroundPythonProcess(
              entry,
              stageRequest,
              stageRuntimeId,
            );
            let finalized = false;
            return {
              finalize: (): void => {
                if (finalized) return;
                finalized = true;
                releaseGuestProcessMemory(granted.memoryGrant);
              },
              process: granted.process,
            };
          }
          const granted = this.createForegroundCs486Process(
            entry,
            stageRequest,
            stageRuntimeId,
            false,
          );
          let finalized = false;
          return {
            finalize: (): void => {
              if (finalized) return;
              finalized = true;
              granted.csAbi?.finalize();
              releaseGuestProcessMemory(granted.grant);
            },
            process: granted.process,
          };
        });
      } else if (request.kind === "debugger") {
        process = request.start();
      } else {
        const granted = this.createForegroundCs486Process(
          entry,
          request,
          runtimeId,
        );
        process = granted.process;
        memoryGrant = granted.grant;
        csAbi = granted.csAbi;
      }
      if (request.kind === "pipeline") {
        let processGroupId: number | undefined;
        for (const command of request.stageCommands) {
          const stagePid = this.startOsProcess(
            entry,
            command,
            request.credentials,
            request.niceValue,
            processGroupId,
          );
          processGroupId ??= stagePid;
          osPids.push(stagePid);
        }
      } else {
        osPids = [
          this.startOsProcess(
            entry,
            request.command,
            request.credentials,
            request.niceValue,
          ),
        ];
      }
      osPid = osPids[0]!;
      memoryGrant?.bindProcess(osPid);
      const foreground: ForegroundGuestProcess = {
        command: request.command,
        compileCycles: request.kind === "cs486" ? request.compileCycles : 0,
        completionEvent,
        cpuCycles: 0,
        ...(request.kind === "debugger"
          ? { debuggerCompletion: request.complete }
          : {}),
        ...(request.kind === "pipeline"
          ? {
              pipelineCompletion: request.complete,
              pipelineStageExitCodes: request.stageExitCodes,
            }
          : {}),
        executedInstructions: 0,
        instructionLimit:
          request.kind === "cs486" && csAbi === undefined ? 100_000 : undefined,
        kind: request.kind,
        ...(memoryGrant === undefined ? {} : { memoryGrant }),
        osPid,
        osPids,
        process,
        ...(csAbi === undefined ? {} : { csAbi }),
        runtimeId,
        stats:
          request.kind === "debugger" || request.kind === "pipeline"
            ? false
            : request.stats,
        ...(request.kind !== "debugger" &&
        request.kind !== "pipeline" &&
        request.stats
          ? {
              startedHostMilliseconds: this.readHostElapsedMilliseconds(),
            }
          : {}),
      };
      this.scheduler.add(
        runtimeId,
        process,
        niceCpuCyclesPerTick(
          hardwareCpuCyclesPerTick(
            entry.record.hardware.clockHz,
            this.ticksPerSecond,
            this.guestRealtimeDivisor,
          ),
          request.niceValue,
        ),
      );
      scheduled = true;
      this.runtimeOwners.set(runtimeId, entry);
      this.runtimeLanes.set(runtimeId, "guest_cpu");
      entry.foreground = foreground;
      return { completionEvent, outcome: "started" };
    } catch (error: unknown) {
      if (scheduled && runtimeId !== undefined) this.unschedule(runtimeId);
      terminateAndDisposeRejectedProcess(
        process,
        "unable to schedule foreground execution",
      );
      csAbi?.finalize();
      releaseGuestProcessMemory(memoryGrant);
      for (const startedPid of osPids) {
        this.completeOsProcess(entry, startedPid, 1);
      }
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      return {
        outcome: "failed",
        exitCode: 1,
        stderr: `${request.command}: ${normalized.name}: ${normalized.message}\n`,
      };
    }
  }

  private startBackgroundProcess(
    entry: RuntimeEntry,
    request: ShellBackgroundRequest,
  ): BackgroundProcessStartResult {
    if (
      activeOsProfile(entry) !== "linux" ||
      entry.vm === undefined ||
      entry.shell === undefined ||
      entry.stopIntent !== undefined ||
      entry.osRuntimeState.lifecycle.phase !== "running"
    ) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: background work is not admitted while the shell is stopping\n`,
      };
    }
    const cpu = cpuModelSpecification(entry.record.hardware.cpuModel);
    if (request.kind === "python" && !cpu.supportsMicroPython) {
      return {
        outcome: "failed",
        exitCode: 127,
        stderr: `${request.command}: MicroPython is not available on ${cpu.runtimeName}\n`,
      };
    }

    const runtimeId = this.nextRuntimeId++;
    let process: CpuProcess | undefined;
    let memoryGrant: GuestProcessMemoryGrant | undefined;
    let osPid: number | undefined;
    let jobId: number | undefined;
    let scheduled = false;
    try {
      if (request.kind === "sleep") {
        process = new BackgroundSleepProcess(
          this.scheduler.tickNumber + request.sleepTicks,
        );
      } else if (request.kind === "python") {
        const granted = this.createBackgroundPythonProcess(
          entry,
          request,
          runtimeId,
        );
        process = granted.process;
        memoryGrant = granted.memoryGrant;
      } else {
        const granted = createGrantedCs486Process(
          entry,
          request.executable,
          request.command,
          runtimeId,
          {
            collectMicroarchitectureStats:
              this.shouldCollectMicroarchitectureStats(request.stats),
            remoteFactory: this.remoteCs486ProcessFactory,
            syscallHandler: rejectCsAbiSyscallHandler,
          },
        );
        process = granted.process;
        memoryGrant = granted.grant;
      }
      const parentPid =
        request.detached === true
          ? 1
          : entry.shell.processId() !== undefined &&
              entry.osRuntimeState.process(entry.shell.processId()!) !==
                undefined
            ? entry.shell.processId()!
            : 1;
      const osProcess = entry.osRuntimeState.spawnProcess({
        command: request.commandLine,
        gid: request.credentials.effectiveGroupId,
        niceValue: request.niceValue,
        parentPid,
        startTick: this.scheduler.tickNumber,
        state: "running",
        uid: request.credentials.effectiveUserId,
      });
      osPid = osProcess.pid;
      memoryGrant?.bindProcess(osPid);
      const job = entry.osRuntimeState.createJob({
        command: request.commandLine,
        pid: osPid,
        tick: this.scheduler.tickNumber,
        uid: request.credentials.effectiveUserId,
      });
      jobId = job.jobId;
      if (request.kind === "sleep") {
        entry.osRuntimeState.transitionProcess(osPid, {
          kind: "sleep",
          reason: `timer:${String(request.sleepTicks)}`,
          tick: this.scheduler.tickNumber,
        });
      }
      this.scheduler.add(
        runtimeId,
        process,
        niceCpuCyclesPerTick(
          hardwareCpuCyclesPerTick(
            entry.record.hardware.clockHz,
            this.ticksPerSecond,
            this.guestRealtimeDivisor,
          ),
          request.niceValue,
        ),
      );
      scheduled = true;
      this.runtimeOwners.set(runtimeId, entry);
      this.runtimeLanes.set(runtimeId, "guest_cpu");
      entry.backgroundJobs.set(osPid, {
        command: request.command,
        commandLine: request.commandLine,
        detached: request.detached === true,
        compileCycles: request.kind === "cs486" ? request.compileCycles : 0,
        cpuCycles: 0,
        executedInstructions: 0,
        instructionLimit: request.kind === "cs486" ? 100_000 : undefined,
        jobId,
        kind: request.kind,
        ...(memoryGrant === undefined ? {} : { memoryGrant }),
        osPid,
        process,
        runtimeId,
        stats: request.kind === "sleep" ? false : request.stats,
        ...(request.kind !== "sleep" && request.stats
          ? {
              startedHostMilliseconds: this.readHostElapsedMilliseconds(),
            }
          : {}),
      });
      entry.osRuntimeState.appendSystemJournal(
        this.scheduler.tickNumber,
        `job ${String(jobId)} process ${String(osPid)} started: ${request.commandLine}`,
      );
      this.syncOsRuntimeState(entry);
      return { jobId, outcome: "started", pid: osPid };
    } catch (error: unknown) {
      if (scheduled) this.unschedule(runtimeId);
      terminateAndDisposeRejectedProcess(
        process,
        "background admission failed",
      );
      releaseGuestProcessMemory(memoryGrant);
      this.rollbackBackgroundAdmission(entry, jobId, osPid);
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      return {
        outcome: "failed",
        exitCode: 1,
        stderr: `${request.command}: ${normalized.name}: ${normalized.message}\n`,
      };
    }
  }

  private createForegroundCs486Process(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "cs486" }>,
    runtimeId: number,
    allowRemote = true,
  ): {
    readonly csAbi?: CsAbiRuntime;
    readonly grant: GuestProcessMemoryGrant;
    readonly process: ObservableCs486Process;
  } {
    if (request.hostedStartup === undefined) {
      return createGrantedCs486Process(
        entry,
        request.executable,
        request.command,
        runtimeId,
        {
          collectMicroarchitectureStats:
            this.shouldCollectMicroarchitectureStats(request.stats),
          ...(allowRemote
            ? { remoteFactory: this.remoteCs486ProcessFactory }
            : {}),
          syscallHandler: rejectCsAbiSyscallHandler,
        },
      );
    }
    if (activeOsProfile(entry) !== "linux" || request.command !== "run") {
      throw new Error("CS ABI startup is limited to Linux foreground run");
    }
    const prepared = prepareCsAbiStartup(
      request.executable,
      request.hostedStartup,
      request.credentials,
    );
    const csAbi = new CsAbiRuntime({
      computerId: entry.record.computerId,
      credentials: request.credentials,
      currentTick: (): number => this.scheduler.tickNumber,
      currentWallTimeMilliseconds: (): number =>
        this.clock?.currentWallTimeMilliseconds() ??
        Date.UTC(2000, 0, 1) +
          (this.scheduler.tickNumber / this.ticksPerSecond) * 1_000,
      cwd: request.hostedStartup.cwd,
      filesystem: guestFilesystemForEntry(
        entry,
        request.credentials,
        request.umask,
      ),
      heapBaseBytes: prepared.heapBaseBytes,
      heapWords: prepared.heapWords,
      ...(request.standardInput === undefined
        ? {}
        : { standardInput: request.standardInput }),
      ...(request.standardIo === undefined
        ? {}
        : { standardIo: request.standardIo }),
      ...(request.routeOutput === undefined
        ? {}
        : {
            outputObserver: (descriptor: 1 | 2, text: string): void => {
              if (request.routeOutput?.(descriptor, text) === true) {
                writeTerminalText(entry.record.terminal, text);
              }
            },
          }),
      startupAddress: prepared.startupAddress,
      runHostWork: (lane, deterministicUnits, action): boolean => {
        const scope = this.activeWorkScope;
        if (scope === undefined) {
          action();
          return true;
        }
        return (
          scope.tryRun(
            {
              computerId: entry.record.computerId,
              deterministicUnits,
              lane,
            },
            action,
          ).outcome === "ran"
        );
      },
      terminal: entry.record.terminal,
    });
    let granted:
      | {
          readonly grant: GuestProcessMemoryGrant;
          readonly process: Cs486Process;
        }
      | undefined;
    try {
      const candidate = createGrantedCs486Process(
        entry,
        request.executable,
        request.command,
        runtimeId,
        {
          collectMicroarchitectureStats:
            this.shouldCollectMicroarchitectureStats(request.stats),
          syscallHandler: csAbi.syscallHandler,
        },
      );
      if (!(candidate.process instanceof Cs486Process)) {
        throw new Error("Hosted CS ABI process must execute on the Bedrock VM");
      }
      granted = { grant: candidate.grant, process: candidate.process };
      candidate.process.initializeProcessImage(prepared.image);
      return { grant: candidate.grant, process: candidate.process, csAbi };
    } catch (error: unknown) {
      csAbi.finalize();
      releaseGuestProcessMemory(granted?.grant);
      throw error;
    }
  }

  private runSynchronousHostedCs486(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "cs486" }>,
    hostedStartup: NonNullable<
      Extract<
        ShellForegroundRequest,
        { readonly kind: "cs486" }
      >["hostedStartup"]
    >,
    memoryBytes: number,
    collectMicroarchitectureStats: boolean,
  ): Cs486RunObservation {
    const prepared = prepareCsAbiStartup(
      request.executable,
      hostedStartup,
      request.credentials,
    );
    let stdout = "";
    const csAbi = new CsAbiRuntime({
      computerId: entry.record.computerId,
      credentials: request.credentials,
      currentTick: (): number => this.scheduler.tickNumber,
      currentWallTimeMilliseconds: (): number =>
        this.clock?.currentWallTimeMilliseconds() ??
        Date.UTC(2000, 0, 1) +
          (this.scheduler.tickNumber / this.ticksPerSecond) * 1_000,
      cwd: hostedStartup.cwd,
      filesystem: guestFilesystemForEntry(
        entry,
        request.credentials,
        request.umask,
      ),
      heapBaseBytes: prepared.heapBaseBytes,
      heapWords: prepared.heapWords,
      outputObserver: (descriptor, text): void => {
        const terminalOutput = request.routeOutput?.(descriptor, text) ?? true;
        if (terminalOutput && descriptor === 1) stdout += text;
        else if (terminalOutput) writeTerminalText(entry.record.terminal, text);
      },
      runHostWork: (_lane, _deterministicUnits, action): boolean => {
        action();
        return true;
      },
      startupAddress: prepared.startupAddress,
      ...(request.standardInput === undefined
        ? {}
        : { standardInput: request.standardInput }),
      ...(request.standardIo === undefined
        ? {}
        : { standardIo: request.standardIo }),
      terminal: entry.record.terminal,
    });
    let finalized = false;
    try {
      const process = new Cs486Process(request.executable, {
        collectMicroarchitectureStats,
        cpuModel: entry.record.hardware.cpuModel,
        memoryBytes,
        syscallHandler: csAbi.syscallHandler,
      });
      process.initializeProcessImage(prepared.image);
      const slice = process.runInstructionSlice(100_000);
      if (process.state.kind === "crashed") throw process.state.error;
      csAbi.finalize();
      finalized = true;
      return {
        cycles: slice.cpuCycles,
        executedInstructions: slice.executedInstructions,
        microarchitecture: process.microarchitectureStatsEnabled
          ? process.microarchitectureStats
          : null,
        output: process.output + stdout,
        registers: process.registers,
        state: process.state.kind === "completed" ? "halted" : "yielded",
      };
    } finally {
      if (!finalized) csAbi.finalize();
    }
  }

  private startJobControl(
    entry: RuntimeEntry,
    request: ShellJobControlRequest,
  ): JobControlStartResult {
    if (entry.vm === undefined || entry.shell === undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: "job control: shell runtime is not running\n",
      };
    }
    try {
      if (request.kind === "foreground") {
        if (entry.foreground !== undefined || entry.compileJob !== undefined) {
          throw new Error("a foreground process is already running");
        }
        const job = entry.osRuntimeState.job(request.jobId);
        if (job === undefined) throw new Error("job does not exist");
        const background = entry.backgroundJobs.get(job.pid);
        if (background === undefined) {
          throw new Error("job already completed");
        }
        const completionEvent = `${foregroundCompletionEvent}:job:${String(background.runtimeId)}`;
        if (job.state === "stopped") {
          this.signalOsProcess(entry, job.pid, "SIGCONT");
        }
        entry.backgroundJobs.delete(job.pid);
        entry.foreground = {
          ...background,
          completionEvent,
        };
        return { completionEvent, outcome: "started" };
      }

      if (entry.jobWait !== undefined) {
        throw new Error("another job wait is already active");
      }
      if (request.jobIds.length === 0 || request.jobIds.length > 32) {
        throw new Error("job wait must contain between 1 and 32 jobs");
      }
      const unique = new Set(request.jobIds);
      if (unique.size !== request.jobIds.length) {
        throw new Error("job wait contains a duplicate job");
      }
      const callerUid =
        entry.shell.executionContext().credentials.effectiveUserId;
      for (const jobId of request.jobIds) {
        const job = entry.osRuntimeState.job(jobId);
        if (job === undefined || job.uid !== callerUid) {
          throw new Error(`job ${String(jobId)} is not owned by this shell`);
        }
      }
      const completionEvent = `${foregroundCompletionEvent}:wait:${String(this.nextRuntimeId++)}`;
      entry.jobWait = {
        completionEvent,
        jobIds: Object.freeze([...request.jobIds]),
      };
      this.completeJobWaitIfReady(entry);
      return { completionEvent, outcome: "started" };
    } catch (error: unknown) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      return {
        outcome: "failed",
        exitCode: 1,
        stderr: `job control: ${normalized.message}\n`,
      };
    }
  }

  private rollbackBackgroundAdmission(
    entry: RuntimeEntry,
    jobId: number | undefined,
    osPid: number | undefined,
  ): void {
    try {
      if (jobId !== undefined) {
        const job = entry.osRuntimeState.job(jobId);
        if (job !== undefined && job.state !== "done") {
          entry.osRuntimeState.transitionJob(jobId, {
            expected: true,
            kind: "complete",
            status: 1,
            tick: this.scheduler.tickNumber,
          });
        }
        if (entry.osRuntimeState.job(jobId)?.state === "done")
          entry.osRuntimeState.removeJob(jobId);
      }
      if (
        osPid !== undefined &&
        entry.osRuntimeState.process(osPid)?.state !== "zombie"
      ) {
        entry.osRuntimeState.transitionProcess(osPid, {
          expected: true,
          kind: "exit",
          status: 1,
          tick: this.scheduler.tickNumber,
        });
      }
      if (
        osPid !== undefined &&
        entry.osRuntimeState.process(osPid)?.state === "zombie"
      )
        entry.osRuntimeState.reapProcess(osPid);
    } finally {
      this.syncOsRuntimeState(entry);
    }
  }

  private startCompileJob(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
    onComplete?: (result: DebugShellCommandCompletion) => void,
  ): ForegroundProcessStartResult {
    if (entry.stopIntent !== undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: new work is not admitted while the OS is stopping\n`,
      };
    }
    if (entry.compileJob !== undefined || entry.foreground !== undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: a foreground process is already running\n`,
      };
    }
    let memoryLease: GuestMemoryReservation | undefined;
    let osPid: number | undefined;
    try {
      const memoryBytes = preflightCompileJob(request.task);
      const owner = normalizeGuestRamOwner(compileMemoryOwner(request));
      memoryLease =
        activeOsProfile(entry) === "dos" &&
        entry.dosGuestMemoryManager !== undefined
          ? unboundGuestMemoryReservation(
              entry.dosGuestMemoryManager.reserveTransientResident({
                bytes: memoryBytes,
                category: owner.category,
                displayName: owner.displayName,
                moduleId: owner.moduleId,
              }),
            )
          : requireLinuxGuestMemoryManager(entry).reserveTransient({
              category: owner.category,
              displayName: owner.displayName,
              moduleId: owner.moduleId,
              residentBytes: memoryBytes,
            });
      const completionEvent = `${foregroundCompletionEvent}:compile:${String(this.nextRuntimeId++)}`;
      osPid = this.startOsProcess(
        entry,
        request.command,
        request.credentials,
        request.niceValue,
      );
      memoryLease.bindProcess(osPid);
      entry.compileJob = {
        completionEvent,
        continuation: createCompileJobContinuation(request.task),
        memoryBytes,
        memoryLease,
        onComplete,
        osPid,
        request,
      };
      this.compileReady.add(entry);
      return { completionEvent, outcome: "started" };
    } catch (error: unknown) {
      memoryLease?.release();
      if (osPid !== undefined) {
        this.completeOsProcess(entry, osPid, 1);
      }
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      return {
        outcome: "failed",
        exitCode: 1,
        stderr: `${request.command}: ${normalized.name}: ${normalized.message}\n`,
      };
    }
  }

  private runCompileJobs(scope?: TickWorkScope): void {
    const batchSize = Math.min(4, this.compileReady.size);
    for (let processed = 0; processed < batchSize; processed += 1) {
      const entry = this.compileReady.values().next().value;
      if (entry === undefined) break;
      const job = entry.compileJob;
      if (job === undefined) {
        this.compileReady.delete(entry);
        continue;
      }
      const units = compileJobUnits(job.request);
      if (scope !== undefined && units > scope.remainingUnits("guest_compile"))
        break;
      this.compileReady.delete(entry);
      let deferred = false;
      try {
        if (scope === undefined) {
          this.advanceCompileJob(entry, job);
        } else {
          const attempt = scope.tryRun(
            {
              lane: "guest_compile",
              deterministicUnits: units,
              computerId: entry.record.computerId,
            },
            () => this.advanceCompileJob(entry, job),
          );
          if (attempt.outcome === "deferred") deferred = true;
        }
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.completeCompileJob(
          entry,
          1,
          compileJobErrorTranscript(
            job.request.command,
            normalized,
            getOsProfile(activeOsProfile(entry)),
            compileJobFallbackSource(job.request),
          ),
        );
      }
      if (entry.compileJob === job && job.makeIoWaitEvent === undefined) {
        this.compileReady.add(entry);
      }
      if (deferred) break;
    }
  }

  private advanceCompileJob(entry: RuntimeEntry, job: CompileJob): void {
    if (job.continuation !== undefined) {
      while (true) {
        const result = advanceCompileJobContinuation(job.continuation);
        if (result === "blocked") return;
        if (result === "execute") break;
        if (!job.continuation.singleTickEligible) return;
      }
    }
    this.executeCompileJob(entry, job);
  }

  private executeCompileJob(entry: RuntimeEntry, job: CompileJob): void {
    const task = job.request.task;
    if (task.kind === "program-list") {
      const result = task.execute();
      if (result.foreground !== undefined) {
        if (result.foreground.kind !== "cs486") {
          throw new Error(
            "Program List produced an unsupported nested foreground request",
          );
        }
        this.releaseCompileMemory(job);
        this.startCompiledForeground(
          entry,
          result.foreground.executable,
          job.completionEvent,
          result.foreground.compileCycles,
          job.osPid,
          "run",
          result.transcript,
        );
        this.compileReady.delete(entry);
        entry.compileJob = undefined;
        return;
      }
      this.completeCompileJob(
        entry,
        result.exitCode,
        result.transcript,
        result.cpuCycles ?? 1,
      );
      return;
    }
    if (task.kind === "make") {
      if (job.makeIoWaitEvent !== undefined) return;
      const completion = job.makeIoCompletion;
      job.makeIoCompletion = undefined;
      const step = task.step(completion);
      if (step.kind === "continue") return;
      if (step.kind === "wait") {
        job.makeIoWaitEvent = step.ioWaitEvent;
        this.compileReady.delete(entry);
        return;
      }
      this.completeCompileJob(
        entry,
        step.result.exitCode,
        step.result.transcript,
        step.result.cpuCycles ?? 1,
      );
      return;
    }
    const filesystem = guestFilesystemForEntry(
      entry,
      job.request.credentials,
      job.request.umask,
    );
    if (task.kind === "link") {
      const executable = linkCs486Objects(task.objects, { entry: task.entry });
      filesystem.writeFile(
        task.outputPath,
        `CS486\n${JSON.stringify(executable)}`,
      );
      this.completeCompileJob(
        entry,
        0,
        emptyGuestToolchainTranscript(),
        compileTaskCycles(job.request),
      );
      return;
    }
    const assemblerOptions =
      task.language === "asm"
        ? {
            dialect: task.assemblerDialect ?? activeOsProfile(entry),
            include: (
              request: string,
              fromSource: string,
            ):
              | { readonly source: string; readonly sourceName: string }
              | undefined => {
              const profile = getOsProfile(
                task.assemblerDialect ?? activeOsProfile(entry),
              );
              let resolved: string;
              try {
                resolved = filesystem.normalize(
                  profile.pathDialect.resolve(
                    request,
                    guestParentPath(fromSource),
                    task.assemblerHome ?? profile.home,
                  ),
                );
              } catch {
                return undefined;
              }
              if (
                !filesystem.exists(resolved) ||
                filesystem.isDirectory(resolved) ||
                !filesystem.hasAccess(resolved, 0b100)
              ) {
                return undefined;
              }
              return {
                source: filesystem.readFile(resolved),
                sourceName: resolved,
              };
            },
            sourceName: task.sourceName,
          }
        : undefined;
    let includedSourceCharacters = 0;
    const dependencyPaths: string[] =
      task.sourceName === undefined ? [] : [task.sourceName];
    const cFamilyOptions: Cs486CFrontendOptions | undefined =
      task.language === "c" || task.language === "cpp"
        ? {
            definitions: task.cDefinitions,
            include: (request): Cs486CPreprocessorInclude | undefined => {
              const profile = getOsProfile(activeOsProfile(entry));
              const includePaths = task.cIncludePaths ?? [];
              if (includePaths.length > 16)
                throw new Error("include path count limit exceeded");
              const systemDirectory =
                profile.id === "dos" ? "/drives/c/include" : "/usr/include";
              const directories = request.quoted
                ? [
                    guestParentPath(request.fromSource),
                    ...includePaths,
                    systemDirectory,
                  ]
                : [...includePaths, systemDirectory];
              for (const directory of directories) {
                let resolved: string;
                try {
                  resolved = filesystem.normalize(
                    profile.pathDialect.resolve(
                      request.path,
                      directory,
                      profile.home,
                    ),
                  );
                } catch {
                  continue;
                }
                if (!filesystem.exists(resolved)) continue;
                if (
                  filesystem.isDirectory(resolved) ||
                  !filesystem.hasAccess(resolved, 0b100)
                ) {
                  throw new Error(
                    `${request.path}: include file is not readable`,
                  );
                }
                const source = filesystem.readFile(resolved);
                includedSourceCharacters += source.length;
                if (!dependencyPaths.includes(resolved))
                  dependencyPaths.push(resolved);
                return {
                  identity: resolved,
                  source,
                  sourceName: resolved,
                };
              }
              return undefined;
            },
            sourceName: task.sourceName,
            optimizationLevel: task.cOptimizationLevel,
            dataModel: task.cDataModel,
            undefines: task.cUndefines,
          }
        : undefined;
    const output =
      task.language === "c" || task.language === "cpp"
        ? (():
            | ReturnType<typeof compileCs486Object>
            | ReturnType<typeof linkCs486Objects> => {
            const object = compileCs486Object(
              task.language,
              task.source,
              cFamilyOptions ?? { sourceName: task.sourceName },
            );
            if (task.compileOnly) return object;
            const selection = selectParsedCs486LinkInputs([
              ...(task.linkInputsBefore ?? []),
              { kind: "object", object },
              ...(task.linkInputs ?? []),
            ]);
            return linkCs486Objects(selection.objects);
          })()
        : task.compileOnly
          ? assembleCs486Object(task.source, assemblerOptions)
          : task.language === "asm"
            ? assembleCs486(task.source, assemblerOptions)
            : compileCs486Source(
                task.language,
                task.source,
                cFamilyOptions ?? { sourceName: task.sourceName },
              );
    const compileCycles = compileTaskCycles(
      job.request,
      output,
      includedSourceCharacters,
    );
    if (task.runAfterCompile) {
      if (output.format !== "cs486-executable") {
        throw new Error("Compiled source did not produce an executable");
      }
      if (task.outputPath !== undefined) {
        filesystem.writeFile(
          task.outputPath,
          `CS486\n${JSON.stringify(output)}`,
        );
      }
      if (job.onComplete !== undefined) {
        this.releaseCompileMemory(job);
        const runtimeId = this.nextRuntimeId++;
        const granted = createGrantedCs486Process(
          entry,
          output,
          job.request.command,
          runtimeId,
          {
            collectMicroarchitectureStats:
              this.shouldCollectMicroarchitectureStats(),
            remoteFactory: this.remoteCs486ProcessFactory,
            syscallHandler: rejectCsAbiSyscallHandler,
          },
        );
        this.startDebugJob(
          entry,
          {
            compileCycles,
            instructionLimit: 100_000,
            kind: "cs486",
            memoryGrant: granted.grant,
            onComplete: job.onComplete,
            process: granted.process,
            runtimeId,
            stats: false,
          },
          {
            command: job.request.command,
            credentials: job.request.credentials,
            osPid: job.osPid,
          },
        );
      } else {
        this.releaseCompileMemory(job);
        this.startCompiledForeground(
          entry,
          output,
          job.completionEvent,
          compileCycles,
          job.osPid,
          job.request.command === "qbasic"
            ? "qbasic"
            : job.request.command === "as"
              ? "csasm"
              : job.request.command === "c" || job.request.command === "c++"
                ? "cscc"
                : "basic",
          emptyGuestToolchainTranscript(),
        );
      }
      this.compileReady.delete(entry);
      entry.compileJob = undefined;
      return;
    }
    if (task.outputPath === undefined)
      throw new Error("Compiler output is missing");
    filesystem.transaction(() => {
      filesystem.writeFile(
        task.outputPath!,
        `${output.format === "cs486-object" ? "CS486OBJ" : "CS486"}\n${JSON.stringify(output)}`,
      );
      if (task.dependencyOutputPath !== undefined) {
        filesystem.writeFile(
          task.dependencyOutputPath,
          renderCompilerDependencies(
            task.dependencyTarget ?? task.outputPath!,
            dependencyPaths,
          ),
        );
      }
    });
    this.completeCompileJob(
      entry,
      0,
      emptyGuestToolchainTranscript(),
      compileCycles,
    );
  }

  private startCompiledForeground(
    entry: RuntimeEntry,
    executable: Parameters<typeof runCs486>[0],
    completionEvent: string,
    compileCycles: number,
    osPid: number,
    command: "basic" | "csasm" | "cscc" | "qbasic" | "run",
    completionTranscriptPrefix: GuestToolchainTranscript,
  ): void {
    const runtimeId = this.nextRuntimeId++;
    const granted = createGrantedCs486Process(
      entry,
      executable,
      command,
      runtimeId,
      {
        collectMicroarchitectureStats:
          this.shouldCollectMicroarchitectureStats(),
        remoteFactory: this.remoteCs486ProcessFactory,
        syscallHandler: rejectCsAbiSyscallHandler,
      },
    );
    const process = granted.process;
    const foreground: ForegroundGuestProcess = {
      command,
      compileCycles,
      completionEvent,
      completionTranscriptPrefix,
      cpuCycles: 0,
      executedInstructions: 0,
      instructionLimit: 100_000,
      kind: "cs486",
      memoryGrant: granted.grant,
      osPid,
      process,
      runtimeId,
      stats: false,
    };
    let scheduled = false;
    try {
      granted.grant.bindProcess(osPid);
      this.scheduler.add(
        runtimeId,
        process,
        hardwareCpuCyclesPerTick(
          entry.record.hardware.clockHz,
          this.ticksPerSecond,
          this.guestRealtimeDivisor,
        ),
      );
      scheduled = true;
      this.runtimeOwners.set(runtimeId, entry);
      this.runtimeLanes.set(runtimeId, "guest_cpu");
      entry.foreground = foreground;
    } catch (error: unknown) {
      if (scheduled) this.unschedule(runtimeId);
      terminateAndDisposeRejectedProcess(
        process,
        "compiled foreground admission failed",
      );
      releaseGuestProcessMemory(granted.grant);
      this.completeOsProcess(entry, osPid, 1, compileCycles);
      throw error;
    }
  }

  private completeCompileJob(
    entry: RuntimeEntry,
    exitCode: number,
    transcript: GuestToolchainTranscript,
    cpuCycles = 1,
    signal?: OsProcessSignal,
  ): void {
    const job = this.finalizeCompileJobProcess(
      entry,
      exitCode,
      cpuCycles,
      signal,
    );
    if (job === undefined) return;
    const completionScreen = entry.shell?.completeToolchainForegroundProcess(
      exitCode,
      transcript,
    );
    const profile = getOsProfile(activeOsProfile(entry));
    const rendered = renderGuestToolchainTranscript(transcript, {
      displaySource: (source) => profile.pathDialect.display(source),
      profile: profile.id,
    });
    if (job.onComplete !== undefined) {
      job.onComplete({
        outcome: "completed",
        exitCode,
        stderr: rendered.stderr,
        stdout: rendered.stdout,
        cpuCycles,
      });
      return;
    }
    if (completionScreen !== undefined) {
      renderTerminalScreen(entry.record.terminal, completionScreen);
    } else if (rendered.orderedRows.length > 0) {
      writeTerminalLines(entry.record.terminal, rendered.orderedRows);
    }
    if (entry.vm !== undefined) {
      this.scheduler.queueEvent(entry.runtimeId, job.completionEvent, exitCode);
    }
  }

  private finalizeCompileJobProcess(
    entry: RuntimeEntry,
    exitCode: number,
    cpuCycles: number,
    signal?: OsProcessSignal,
  ): CompileJob | undefined {
    const job = entry.compileJob;
    if (job === undefined) return undefined;
    this.compileReady.delete(entry);
    entry.compileJob = undefined;
    this.releaseCompileMemory(job);
    this.completeOsProcess(entry, job.osPid, exitCode, cpuCycles, signal);
    return job;
  }

  private releaseCompileMemory(job: CompileJob): void {
    if (!job.memoryLease.released) job.memoryLease.release();
  }

  private finalizeGuestRam(entry: RuntimeEntry): void {
    const ledger = entry.guestRamLedger;
    releaseGuestProcessMemory(entry.vmMemoryGrant);
    entry.vmMemoryGrant = undefined;
    entry.dosGuestMemoryManager?.close();
    entry.dosGuestMemoryManager = undefined;
    entry.linuxGuestMemoryManager?.close();
    entry.linuxGuestMemoryManager = undefined;
    if (ledger !== undefined && ledger.usedBytes !== 0) {
      throw new Error(
        `Guest RAM finalization leaked ${String(ledger.usedBytes)} bytes`,
      );
    }
    entry.guestRamLedger = undefined;
  }

  private createForegroundPythonProcess(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "python" }>,
    runtimeId: number,
  ): {
    readonly memoryGrant: GuestProcessMemoryGrant;
    readonly process: Cs486Process;
  } {
    const filesystem = guestFilesystemForEntry(
      entry,
      request.credentials,
      request.umask,
    );
    const source = filesystem.readFile(request.path);
    const environment = createAccountedNativeEnvironment({
      clock: this.clock,
      computerId: numericComputerId(entry.record.computerId),
      computerName: entry.record.computerId,
      osProfile: activeOsProfile(entry),
      osRuntimeState: entry.osRuntimeState,
      dosRuntimeState: activeDosRuntimeState(entry),
      filesystem: activeFilesystem(entry),
      exposeShellModule: false,
      guestFilesystem: filesystem,
      terminal: entry.record.terminal,
      hardware: entry.record.hardware,
      guestRamLedger: requireGuestRamLedger(entry),
      redstone: entry.record.redstone,
      currentTick: () => this.scheduler.tickNumber,
      queueEvent: (name, ...arguments_) =>
        this.scheduler.queueEvent(runtimeId, name, ...arguments_),
      ...(request.routeOutput === undefined
        ? {}
        : { routeOutput: request.routeOutput }),
      startTimer: (delay) => this.scheduler.startTimer(runtimeId, delay),
      cancelTimer: (timerId) => this.scheduler.cancelTimer(runtimeId, timerId),
      shutdown: () => this.requestEntryStop(entry, "shutdown", "shutdown"),
      reboot: () => this.requestEntryStop(entry, "reboot", "reboot"),
      ticksPerSecond: this.ticksPerSecond,
      shell: entry.shell,
      serial: this.serial,
      peripherals: this.peripherals,
      runHostWork: (lane, units, operation) =>
        this.runHostWork(lane, units, entry.record.computerId, operation),
    });
    const prepared = preparePythonCs486Program({
      collectMicroarchitectureStats: this.shouldCollectMicroarchitectureStats(
        request.stats,
      ),
      cpuModel: entry.record.hardware.cpuModel,
      environment,
      filesystem,
      path: request.path,
      source,
    });
    const memoryGrant = grantCs486MemoryRequirements(
      prepared.requirements,
      guestProcessMemoryAdmission(
        entry,
        request.command,
        `runtime-${String(runtimeId)}`,
      ),
    );
    try {
      return {
        memoryGrant,
        process: prepared.create(memoryGrant.memoryBytes).process,
      };
    } catch (error: unknown) {
      releaseGuestProcessMemory(memoryGrant);
      throw error;
    }
  }

  private createBackgroundPythonProcess(
    entry: RuntimeEntry,
    request: Extract<ShellBackgroundRequest, { readonly kind: "python" }>,
    runtimeId: number,
  ): {
    readonly memoryGrant: GuestProcessMemoryGrant;
    readonly process: Cs486Process;
  } {
    const filesystem = guestFilesystemForEntry(
      entry,
      request.credentials,
      request.umask,
    );
    const source = filesystem.readFile(request.path);
    const environment = createAccountedNativeEnvironment({
      clock: this.clock,
      computerId: numericComputerId(entry.record.computerId),
      computerName: entry.record.computerId,
      osProfile: activeOsProfile(entry),
      osRuntimeState: entry.osRuntimeState,
      dosRuntimeState: activeDosRuntimeState(entry),
      filesystem: activeFilesystem(entry),
      exposeShellModule: false,
      guestFilesystem: filesystem,
      terminal: entry.record.terminal,
      hardware: entry.record.hardware,
      guestRamLedger: requireGuestRamLedger(entry),
      redstone: entry.record.redstone,
      currentTick: () => this.scheduler.tickNumber,
      queueEvent: (name, ...arguments_) =>
        this.scheduler.queueEvent(runtimeId, name, ...arguments_),
      startTimer: (delay) => this.scheduler.startTimer(runtimeId, delay),
      cancelTimer: (timerId) => this.scheduler.cancelTimer(runtimeId, timerId),
      ticksPerSecond: this.ticksPerSecond,
      shell: entry.shell,
      serial: this.serial,
      peripherals: this.peripherals,
      runHostWork: (lane, units, operation) =>
        this.runHostWork(lane, units, entry.record.computerId, operation),
    });
    const prepared = preparePythonCs486Program({
      collectMicroarchitectureStats: this.shouldCollectMicroarchitectureStats(
        request.stats,
      ),
      cpuModel: entry.record.hardware.cpuModel,
      environment,
      filesystem,
      path: request.path,
      source,
    });
    const memoryGrant = grantCs486MemoryRequirements(
      prepared.requirements,
      guestProcessMemoryAdmission(
        entry,
        request.command,
        `runtime-${String(runtimeId)}`,
      ),
    );
    let process: Cs486Process;
    try {
      process = prepared.create(memoryGrant.memoryBytes).process;
    } catch (error: unknown) {
      releaseGuestProcessMemory(memoryGrant);
      throw error;
    }
    return { memoryGrant, process };
  }

  private completeForegroundProcess(
    entry: RuntimeEntry,
    foreground: ForegroundGuestProcess,
    state: CpuProcessState,
  ): void {
    this.unschedule(foreground.runtimeId);
    entry.foreground = undefined;
    this.finalizeForegroundResources(foreground);
    if (entry.stopIntent !== undefined || entry.vm === undefined) {
      this.completeForegroundOsProcesses(
        entry,
        foreground,
        terminalForegroundExitCode(foreground, state),
        state.kind === "terminated" ? foreground.terminationSignal : undefined,
      );
      return;
    }

    if (foreground.kind === "pipeline") {
      let result: ShellCommandResult;
      try {
        if (foreground.pipelineCompletion === undefined) {
          throw new Error("pipeline completion owner is missing");
        }
        result = foreground.pipelineCompletion();
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        result = {
          exitCode: 1,
          stderr: `pipeline: ${normalized.name}: ${normalized.message}\n`,
          stdout: "",
        };
      }
      const stageExitCodes = foreground.pipelineStageExitCodes?.() ?? [];
      const pids = foreground.osPids ?? [foreground.osPid];
      for (let index = 0; index < pids.length; index += 1) {
        this.completeOsProcess(
          entry,
          pids[index]!,
          stageExitCodes[index] ?? result.exitCode,
          Math.floor(foreground.cpuCycles / Math.max(1, pids.length)),
          state.kind === "terminated"
            ? foreground.terminationSignal
            : undefined,
        );
      }
      writeShellCommandOutput(entry.record.terminal, result);
      if (result.terminalScreen !== undefined) {
        renderTerminalScreen(entry.record.terminal, result.terminalScreen);
      }
      entry.shell?.completeForegroundProcess(result.exitCode);
      this.scheduler.queueEvent(
        entry.runtimeId,
        foreground.completionEvent,
        result.exitCode,
      );
      return;
    }

    if (foreground.kind === "debugger") {
      let result: ShellCommandResult;
      try {
        if (foreground.debuggerCompletion === undefined)
          throw new Error("debugger completion owner is missing");
        result = foreground.debuggerCompletion();
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        result = {
          exitCode: 1,
          stderr: `debugger: ${normalized.name}: ${normalized.message}\n`,
          stdout: "",
        };
      }
      this.completeOsProcess(
        entry,
        foreground.osPid,
        result.exitCode,
        foreground.cpuCycles,
        state.kind === "terminated" ? foreground.terminationSignal : undefined,
      );
      writeShellCommandOutput(entry.record.terminal, result);
      entry.shell?.completeForegroundProcess(result.exitCode);
      this.scheduler.queueEvent(
        entry.runtimeId,
        foreground.completionEvent,
        result.exitCode,
      );
      return;
    }

    if (foreground.csAbi?.usedRawFramePresentation === true) {
      entry.record.terminal.setTextColor(0);
      entry.record.terminal.setBackgroundColor(15);
      entry.record.terminal.clear();
      entry.record.terminal.setCursorPosition(1, 1);
    }
    let exitCode: number;
    let stateName: string;
    if (foreground.limitReached === true) {
      exitCode = 124;
      stateName = "yielded";
      writeTerminalLines(entry.record.terminal, [
        `${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: execution limit reached`,
      ]);
    } else if (state.kind === "completed") {
      exitCode =
        foreground.csAbi === undefined
          ? 0
          : typeof state.value === "number" && Number.isInteger(state.value)
            ? state.value & 0xff
            : 1;
      stateName = foreground.kind === "cs486" ? "halted" : "completed";
    } else if (state.kind === "crashed") {
      exitCode = 1;
      stateName = "crashed";
      writeTerminalLines(entry.record.terminal, [
        `${state.error.name}: ${state.error.message}`,
      ]);
    } else if (state.kind === "terminated") {
      exitCode = 130;
      stateName = "terminated";
      writeTerminalLines(entry.record.terminal, ["^C"]);
    } else {
      throw new Error(`Cannot complete foreground process from ${state.kind}`);
    }
    const processOutput =
      foreground.kind === "cs486"
        ? observableCs486Process(foreground.process).output
        : "";
    let completionTranscript: GuestToolchainTranscript;
    let transcriptLimitExceeded = false;
    try {
      completionTranscript = concatGuestToolchainTranscripts([
        foreground.completionTranscriptPrefix ??
          emptyGuestToolchainTranscript(),
        guestToolchainTranscriptFromStreams(processOutput, ""),
      ]);
    } catch (error: unknown) {
      if (!(error instanceof RangeError)) throw error;
      transcriptLimitExceeded = true;
      exitCode = 1;
      stateName = "failed";
      completionTranscript = guestToolchainTranscriptFromFailure(
        "runtime: process output limit exceeded\n",
      );
    }
    const completionScreen = entry.shell?.completeToolchainForegroundProcess(
      exitCode,
      completionTranscript,
    );
    if (completionScreen === undefined) {
      if (transcriptLimitExceeded) {
        writeTerminalLines(entry.record.terminal, [
          "runtime: process output limit exceeded",
        ]);
      } else if (foreground.kind === "cs486" && processOutput.length > 0) {
        writeTerminalLines(
          entry.record.terminal,
          processOutput
            .replaceAll("\r\n", "\n")
            .replace(/\n$/u, "")
            .split("\n"),
        );
      }
    }
    if (foreground.stats) {
      writeTerminalLines(entry.record.terminal, [
        ...(foreground.kind === "python"
          ? pythonStats(
              foreground.executedInstructions,
              foreground.cpuCycles,
              stateName,
              entry.record.hardware,
              this.elapsedHostMilliseconds(foreground.startedHostMilliseconds),
            )
              .trimEnd()
              .split("\n")
          : cs486Stats(
              foreground.executedInstructions,
              foreground.cpuCycles,
              stateName,
              entry.record.hardware,
              observableCs486Process(foreground.process),
              this.elapsedHostMilliseconds(foreground.startedHostMilliseconds),
            )),
      ]);
    }
    if (foreground.jobId !== undefined) {
      this.accountLiveOsProcess(entry, foreground.osPid, foreground.cpuCycles);
      const job = entry.osRuntimeState.job(foreground.jobId);
      if (job !== undefined && job.state !== "done") {
        entry.osRuntimeState.transitionJob(foreground.jobId, {
          expected: true,
          kind: "complete",
          status: exitCode,
          tick: this.scheduler.tickNumber,
        });
      }
      if (entry.osRuntimeState.job(foreground.jobId)?.state === "done")
        entry.osRuntimeState.removeJob(foreground.jobId);
      if (entry.osRuntimeState.process(foreground.osPid)?.state === "zombie")
        entry.osRuntimeState.reapProcess(foreground.osPid);
      entry.osRuntimeState.appendSystemJournal(
        this.scheduler.tickNumber,
        `foreground job ${String(foreground.jobId)} process ${String(foreground.osPid)} completed with status ${String(exitCode)}`,
      );
      this.syncOsRuntimeState(entry);
    } else {
      this.completeOsProcess(
        entry,
        foreground.osPid,
        exitCode,
        foreground.cpuCycles,
        state.kind === "terminated" ? foreground.terminationSignal : undefined,
      );
    }
    if (completionScreen !== undefined) {
      renderTerminalScreen(entry.record.terminal, completionScreen);
    }
    this.scheduler.queueEvent(
      entry.runtimeId,
      foreground.completionEvent,
      exitCode,
    );
  }

  private finalizeForegroundResources(
    foreground: ForegroundGuestProcess,
  ): void {
    foreground.csAbi?.finalize();
    releaseGuestProcessMemory(foreground.memoryGrant);
  }

  private shouldCollectMicroarchitectureStats(requested = false): boolean {
    return requested || this.collectMicroarchitectureStatsByDefault;
  }

  private readHostElapsedMilliseconds(): number | undefined {
    try {
      const value = this.hostElapsedMilliseconds?.();
      return value !== undefined && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
    } catch {
      // Optional observability must never take ownership of process completion.
      return undefined;
    }
  }

  private elapsedHostMilliseconds(
    startedHostMilliseconds: number | undefined,
  ): number | undefined {
    if (startedHostMilliseconds === undefined) return undefined;
    const completedHostMilliseconds = this.readHostElapsedMilliseconds();
    return completedHostMilliseconds === undefined
      ? undefined
      : Math.max(0, completedHostMilliseconds - startedHostMilliseconds);
  }

  private completeBackgroundProcess(
    entry: RuntimeEntry,
    background: BackgroundGuestProcess,
    state: Extract<
      CpuProcessState,
      { readonly kind: "completed" | "crashed" | "terminated" }
    >,
  ): void {
    this.unschedule(background.runtimeId);
    entry.backgroundJobs.delete(background.osPid);
    releaseGuestProcessMemory(background.memoryGrant);

    const recordedJob = entry.osRuntimeState.job(background.jobId);
    let exitCode = recordedJob?.exitStatus;
    let stateName: string;
    if (background.limitReached === true) {
      exitCode ??= 124;
      stateName = "yielded";
      writeTerminalLines(entry.record.terminal, [
        `${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: execution limit reached`,
      ]);
    } else if (state.kind === "completed") {
      exitCode ??= 0;
      stateName = background.kind === "cs486" ? "halted" : "completed";
    } else if (state.kind === "crashed") {
      exitCode ??= 1;
      stateName = "crashed";
      writeTerminalLines(entry.record.terminal, [
        `${state.error.name}: ${state.error.message}`,
      ]);
    } else {
      exitCode ??= osSignalExitCode(background.terminationSignal ?? "SIGTERM");
      stateName = "terminated";
    }

    if (
      background.kind === "cs486" &&
      observableCs486Process(background.process).output.length > 0
    ) {
      writeTerminalLines(
        entry.record.terminal,
        observableCs486Process(background.process)
          .output.replaceAll("\r\n", "\n")
          .replace(/\n$/u, "")
          .split("\n"),
      );
    }
    if (background.stats) {
      writeTerminalLines(entry.record.terminal, [
        ...(background.kind === "python"
          ? pythonStats(
              background.executedInstructions,
              background.cpuCycles,
              stateName,
              entry.record.hardware,
              this.elapsedHostMilliseconds(background.startedHostMilliseconds),
            )
              .trimEnd()
              .split("\n")
          : cs486Stats(
              background.executedInstructions,
              background.cpuCycles,
              stateName,
              entry.record.hardware,
              observableCs486Process(background.process),
              this.elapsedHostMilliseconds(background.startedHostMilliseconds),
            )),
      ]);
    }

    const liveJob = entry.osRuntimeState.job(background.jobId);
    if (liveJob !== undefined && liveJob.state !== "done") {
      this.accountLiveOsProcess(entry, background.osPid, background.cpuCycles);
      entry.osRuntimeState.transitionJob(background.jobId, {
        expected: true,
        kind: "complete",
        status: exitCode,
        tick: this.scheduler.tickNumber,
      });
    }
    entry.osRuntimeState.appendSystemJournal(
      this.scheduler.tickNumber,
      `job ${String(background.jobId)} process ${String(background.osPid)} completed with status ${String(exitCode)}`,
    );
    if (!background.detached) {
      writeTerminalLines(entry.record.terminal, [
        `[${String(background.jobId)}] ${exitCode === 0 ? "Done" : `Exit ${String(exitCode)}`} ${background.commandLine}`,
      ]);
    }
    this.completeJobWaitIfReady(entry);
    this.syncOsRuntimeState(entry);
  }

  private completeJobWaitIfReady(entry: RuntimeEntry): void {
    const wait = entry.jobWait;
    if (wait === undefined) return;
    const jobs = wait.jobIds.map((jobId) => entry.osRuntimeState.job(jobId));
    if (jobs.some((job) => job === undefined || job.state !== "done")) return;
    if (
      jobs.some(
        (job) =>
          job !== undefined &&
          (entry.backgroundJobs.has(job.pid) ||
            (entry.foreground?.jobId === job.jobId &&
              entry.foreground.process.state.kind !== "completed" &&
              entry.foreground.process.state.kind !== "crashed" &&
              entry.foreground.process.state.kind !== "terminated")),
      )
    ) {
      return;
    }
    const exitCode = jobs.at(-1)?.exitStatus ?? 0;
    entry.jobWait = undefined;
    for (const job of jobs) {
      if (job === undefined) continue;
      if (entry.osRuntimeState.job(job.jobId)?.state === "done")
        entry.osRuntimeState.removeJob(job.jobId);
      if (entry.osRuntimeState.process(job.pid)?.state === "zombie")
        entry.osRuntimeState.reapProcess(job.pid);
    }
    entry.shell?.completeForegroundProcess(exitCode);
    if (entry.vm !== undefined) {
      try {
        this.scheduler.queueEvent(
          entry.runtimeId,
          wait.completionEvent,
          exitCode,
        );
      } catch (error: unknown) {
        entry.vm.fail(
          new VmRuntimeError(
            "RuntimeError",
            `job wait completion delivery failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    }
    this.syncOsRuntimeState(entry);
  }

  private accountLiveOsProcess(
    entry: RuntimeEntry,
    pid: number,
    totalCpuCycles: number,
  ): void {
    const process = entry.osRuntimeState.process(pid);
    if (process === undefined || process.state === "zombie") return;
    const delta = totalCpuCycles - process.cpuCycles;
    if (!Number.isSafeInteger(delta) || delta <= 0) return;
    entry.osRuntimeState.transitionProcess(pid, {
      cycles: delta,
      kind: "account_cycles",
      tick: Math.max(this.scheduler.tickNumber, process.changedTick),
    });
  }

  private signalForegroundProcesses(
    entry: RuntimeEntry,
    foreground: ForegroundGuestProcess,
    signal: OsProcessSignal,
  ): void {
    for (const pid of foreground.osPids ?? [foreground.osPid]) {
      this.signalOsProcess(entry, pid, signal);
    }
  }

  private completeForegroundOsProcesses(
    entry: RuntimeEntry,
    foreground: ForegroundGuestProcess,
    exitCode: number,
    signal?: OsProcessSignal,
  ): void {
    const pids = foreground.osPids ?? [foreground.osPid];
    const stageExitCodes = foreground.pipelineStageExitCodes?.() ?? [];
    for (let index = 0; index < pids.length; index += 1) {
      this.completeOsProcess(
        entry,
        pids[index]!,
        signal === undefined ? (stageExitCodes[index] ?? exitCode) : exitCode,
        Math.floor(foreground.cpuCycles / Math.max(1, pids.length)),
        signal,
      );
    }
  }

  private requestStop(
    computerId: string,
    intent: StopIntent,
    reason: string,
  ): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.vm === undefined)
      return { outcome: "ignored", reason: "not_running" };
    this.requestEntryStop(entry, intent, reason);
    return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
  }

  private finalizeTerminalDisconnect(
    entry: RuntimeEntry,
    arguments_: readonly RuntimeValue[],
  ): RuntimeCommandResult {
    const failures: unknown[] = [];
    let unsafeFinalization = false;
    let systemResumeQueued = false;
    try {
      const disconnectLines = entry.shell?.disconnect() ?? [];
      if (disconnectLines.length > 0)
        writeTerminalLines(entry.record.terminal, disconnectLines);
    } catch (error: unknown) {
      failures.push(error);
      unsafeFinalization = true;
    }

    try {
      this.finalizeBackgroundProcesses(entry, "SIGHUP");
    } catch (error: unknown) {
      failures.push(error);
      unsafeFinalization = true;
    }

    const compileJob = this.finalizeCompileJobProcess(entry, 130, 1, "SIGHUP");
    if (compileJob !== undefined) {
      entry.shell?.completeForegroundProcess(130);
      if (compileJob.onComplete === undefined) {
        try {
          this.scheduler.queueEvent(
            entry.runtimeId,
            compileJob.completionEvent,
            130,
          );
          systemResumeQueued = true;
        } catch (error: unknown) {
          failures.push(error);
          unsafeFinalization = true;
        }
      } else {
        try {
          compileJob.onComplete(debugTerminalDisconnected());
        } catch (error: unknown) {
          failures.push(error);
        }
      }
    }

    const foreground = entry.foreground;
    if (foreground !== undefined) {
      entry.foreground = undefined;
      this.finalizeForegroundResources(foreground);
      foreground.terminationSignal = "SIGHUP";
      try {
        foreground.process.terminate("terminal disconnected");
      } catch (error: unknown) {
        failures.push(error);
        unsafeFinalization = true;
      }
      this.unschedule(foreground.runtimeId);
      this.completeForegroundOsProcesses(entry, foreground, 130, "SIGHUP");
      entry.shell?.completeForegroundProcess(130);
      try {
        this.scheduler.queueEvent(
          entry.runtimeId,
          foreground.completionEvent,
          130,
        );
        systemResumeQueued = true;
      } catch (error: unknown) {
        failures.push(error);
        unsafeFinalization = true;
      }
    }

    const debugJob = entry.debugJob;
    if (debugJob !== undefined) {
      entry.debugJob = undefined;
      releaseGuestProcessMemory(debugJob.memoryGrant);
      debugJob.terminationSignal = "SIGHUP";
      try {
        debugJob.process.terminate("terminal disconnected");
      } catch (error: unknown) {
        failures.push(error);
        unsafeFinalization = true;
      }
      this.unschedule(debugJob.runtimeId);
      this.completeOsProcess(
        entry,
        debugJob.osPid,
        130,
        debugJob.cpuCycles,
        "SIGHUP",
      );
      try {
        debugJob.onComplete(
          debugTerminalDisconnected(Math.max(1, debugJob.cpuCycles)),
        );
      } catch (error: unknown) {
        failures.push(error);
      }
    }

    if (!systemResumeQueued) {
      try {
        this.scheduler.queueEvent(
          entry.runtimeId,
          "terminal_closed",
          ...arguments_,
        );
      } catch (error: unknown) {
        failures.push(error);
        unsafeFinalization = true;
      }
    }
    if (unsafeFinalization) {
      this.requestEntryStop(
        entry,
        "shutdown",
        "terminal_disconnect_finalization_failed",
      );
    }
    return failures.length === 0
      ? {
          outcome: "accepted",
          state: entry.record.lifecycle.state.kind,
        }
      : failure(
          new AggregateError(
            failures,
            "Terminal disconnect finalization failed",
          ),
        );
  }

  private requestEntryStop(
    entry: RuntimeEntry,
    intent: StopIntent,
    reason: string,
  ): void {
    const event =
      intent === "reboot"
        ? { kind: "reboot" as const }
        : { kind: "shutdown" as const, reason };
    const transition = entry.record.lifecycle.transition(event);
    if (transition.outcome !== "changed") return;
    entry.csBiosSequence?.cancel();
    entry.csBiosSequence = undefined;
    this.pendingCsBiosEntries.delete(entry);
    this.beginOsRuntimeStop(entry, intent, reason);
    entry.stopIntent = intent;
    entry.stopState = {
      deadlineTick: this.scheduler.tickNumber + maximumStopPhaseTicks,
      intent,
      phase: "signal",
      reason,
    };
    this.stoppingEntries.add(entry);
    entry.osRuntimeState.appendSystemJournal(
      this.scheduler.tickNumber,
      `${intent === "reboot" ? "reboot" : "shutdown"} requested: ${reason}`,
      "notice",
    );
    this.syncOsRuntimeState(entry);
  }

  private advanceStoppingEntries(): void {
    let processed = 0;
    for (const entry of this.stoppingEntries) {
      if (processed >= maximumStoppingEntriesPerTick) break;
      processed += 1;
      this.advanceStopState(entry);
    }
  }

  private advanceStopState(entry: RuntimeEntry): void {
    const stop = entry.stopState;
    if (stop === undefined) {
      this.stoppingEntries.delete(entry);
      return;
    }
    const tick = this.scheduler.tickNumber;
    try {
      switch (stop.phase) {
        case "signal":
          entry.osRuntimeState.appendSystemJournal(
            tick,
            "stopping new work admission; signalling owned processes",
          );
          if (entry.compileJob !== undefined)
            this.completeCompileJob(
              entry,
              143,
              emptyGuestToolchainTranscript(),
              1,
              "SIGTERM",
            );
          if (entry.foreground !== undefined)
            this.signalForegroundProcesses(entry, entry.foreground, "SIGTERM");
          if (entry.debugJob !== undefined)
            this.signalOsProcess(entry, entry.debugJob.osPid, "SIGTERM");
          this.finalizeBackgroundProcesses(entry, "SIGTERM");
          this.setStopPhase(entry, "drain_work");
          return;
        case "drain_work":
          if (
            entry.foreground === undefined &&
            entry.debugJob === undefined &&
            entry.compileJob === undefined &&
            entry.backgroundJobs.size === 0
          ) {
            entry.osRuntimeState.appendSystemJournal(
              tick,
              "owned process work finalized",
            );
            this.setStopPhase(entry, "drain_io");
            return;
          }
          if (tick <= stop.deadlineTick) return;
          this.forceFinalizeGuestWork(entry);
          entry.osRuntimeState.appendSystemJournal(
            tick,
            "owned process deadline exceeded; remaining work cancelled",
            "warning",
          );
          this.setStopPhase(entry, "drain_io");
          return;
        case "drain_io": {
          const pending = this.pendingFilesystemIoCounter?.(
            entry.record.computerId,
          );
          if (pending === undefined || pending === 0) {
            entry.osRuntimeState.appendSystemJournal(
              tick,
              pending === undefined
                ? "block I/O drain boundary unavailable in standalone runtime"
                : "accepted block I/O drained",
              pending === undefined ? "warning" : "info",
            );
            this.setStopPhase(entry, "sync_data");
            return;
          }
          if (!Number.isSafeInteger(pending) || pending < 0) {
            throw new Error("block I/O boundary returned an invalid count");
          }
          if (tick <= stop.deadlineTick) return;
          throw new Error(
            `block I/O drain timed out with ${String(pending)} request(s) pending`,
          );
        }
        case "sync_data":
          this.performPersistenceSync(entry, "data");
          this.setStopPhase(entry, "unmount");
          return;
        case "unmount": {
          const mounts = [...entry.osRuntimeState.mounts()].sort(
            (left, right) =>
              right.target.split("/").length - left.target.split("/").length ||
              right.target.localeCompare(left.target),
          );
          for (const mount of mounts) {
            entry.osRuntimeState.unmount(mount.target);
            entry.osRuntimeState.appendSystemJournal(
              tick,
              `unmounted ${mount.target}`,
            );
          }
          this.setStopPhase(entry, "stop_devices");
          return;
        }
        case "stop_devices":
          this.stopOsServicesAndDevices(entry);
          this.setStopPhase(entry, "sync_final");
          return;
        case "sync_final": {
          const provisionalJournalEntries: OsJournalEntry[] = [];
          try {
            // These are precommit facts, not a success claim. Their presence in
            // a cold snapshot proves that the one final boundary included them.
            provisionalJournalEntries.push(
              entry.osRuntimeState.appendSystemJournal(
                tick,
                "final sync requested",
              ),
            );
            provisionalJournalEntries.push(
              entry.osRuntimeState.appendSystemJournal(
                tick,
                `${stop.intent === "reboot" ? "reboot" : "shutdown"} phases prepared for final persistence`,
                "notice",
              ),
            );
            this.performPersistenceSync(entry, "final");
          } catch (error: unknown) {
            const primary =
              error instanceof Error ? error : new Error(String(error));
            try {
              entry.osRuntimeState.rollbackJournalEntries(
                provisionalJournalEntries,
              );
              this.syncOsRuntimeState(entry);
            } catch (rollbackError: unknown) {
              const secondary =
                rollbackError instanceof Error
                  ? rollbackError
                  : new Error(String(rollbackError));
              throw new Error(
                `${primary.message}; final precommit rollback failed: ${secondary.message}`,
                { cause: primary },
              );
            }
            throw primary;
          }
          this.setStopPhase(entry, "terminate");
          return;
        }
        case "terminate":
          entry.record.faceIo.powerOff(stop.reason);
          entry.vm?.terminate(stop.reason);
          entry.stopState = { ...stop, phase: "terminating" };
          this.stoppingEntries.delete(entry);
          return;
        case "terminating":
          this.stoppingEntries.delete(entry);
          return;
      }
    } catch (error: unknown) {
      this.failStopState(entry, stop.phase, error);
    }
  }

  private setStopPhase(entry: RuntimeEntry, phase: RuntimeStopPhase): void {
    const stop = entry.stopState;
    if (stop === undefined) return;
    entry.stopState = {
      ...stop,
      deadlineTick: this.scheduler.tickNumber + maximumStopPhaseTicks,
      phase,
    };
    this.syncOsRuntimeState(entry);
  }

  private performPersistenceSync(
    entry: RuntimeEntry,
    boundary: "data" | "final" | "manual",
  ): void {
    this.syncOsRuntimeState(entry);
    if (this.persistenceSyncer === undefined) {
      throw new Error(`${boundary} persistence sync boundary is unavailable`);
    }
    const result = this.persistenceSyncer(entry.record.computerId);
    if (result.outcome === "failed") throw result.error;
    if (result.outcome === "missing") {
      throw new Error(
        `persistence boundary lost Computer ${result.computerId}`,
      );
    }
    // A final result journal would itself need another persistence boundary.
    if (boundary === "final") return;
    entry.osRuntimeState.appendSystemJournal(
      this.scheduler.tickNumber,
      `${boundary} sync ${result.outcome}${result.generation === undefined ? "" : ` generation ${String(result.generation)}`}`,
    );
    this.syncOsRuntimeState(entry);
  }

  private stopOsServicesAndDevices(entry: RuntimeEntry): void {
    const tick = this.scheduler.tickNumber;
    this.deviceStopper?.(entry.record.computerId);
    for (const service of entry.osRuntimeState.services()) {
      if (service.state === "running" || service.state === "starting") {
        entry.osRuntimeState.transitionService(service.name, {
          kind: "stop",
          tick,
        });
      }
      if (entry.osRuntimeState.service(service.name)?.state === "stopping") {
        entry.osRuntimeState.transitionService(service.name, {
          kind: "stopped",
          tick,
        });
      }
    }
    for (const device of entry.osRuntimeState.devices()) {
      if (device.state === "available") {
        entry.osRuntimeState.setDeviceState(device.path, "offline", tick);
        entry.osRuntimeState.appendSystemJournal(
          tick,
          `device ${device.path} stopped`,
        );
      }
    }
  }

  private failStopState(
    entry: RuntimeEntry,
    phase: RuntimeStopPhase,
    error: unknown,
  ): void {
    const normalized =
      error instanceof Error ? error : new Error(String(error));
    const detail = `${phase} failed: ${normalized.message}`;
    entry.stopState = undefined;
    entry.stopIntent = undefined;
    this.stoppingEntries.delete(entry);

    const finalize = (action: () => void): void => {
      try {
        action();
      } catch {
        // The original phase failure remains authoritative. Each remaining
        // terminal owner still gets a chance to publish its faulted state.
      }
    };
    finalize(() =>
      entry.osRuntimeState.appendSystemJournal(
        this.scheduler.tickNumber,
        detail,
        "critical",
      ),
    );
    finalize(() => this.faultOsRuntime(entry, detail));
    finalize(() => {
      entry.record.lifecycle.transition({ kind: "crash", message: detail });
    });
    finalize(() => {
      if (entry.record.display.state.kind !== "faulted") {
        entry.record.display.transition({
          kind: "fault",
          message: detail.slice(0, 256),
        });
      }
    });
    finalize(() => entry.record.faceIo.powerOff("shutdown_failed"));
    finalize(() => entry.vm?.fail(new VmRuntimeError("RuntimeError", detail)));
    finalize(() => this.syncOsRuntimeState(entry));
  }

  private forceFinalizeGuestWork(entry: RuntimeEntry): void {
    if (entry.compileJob !== undefined)
      this.completeCompileJob(
        entry,
        137,
        emptyGuestToolchainTranscript(),
        1,
        "SIGKILL",
      );
    if (entry.foreground !== undefined) {
      const foreground = entry.foreground;
      entry.foreground = undefined;
      this.finalizeForegroundResources(foreground);
      foreground.terminationSignal = "SIGKILL";
      foreground.process.terminate("shutdown deadline exceeded");
      this.unschedule(foreground.runtimeId);
      this.completeForegroundOsProcesses(entry, foreground, 137, "SIGKILL");
      if (
        foreground.jobId !== undefined &&
        entry.osRuntimeState.job(foreground.jobId)?.state === "done"
      ) {
        entry.osRuntimeState.removeJob(foreground.jobId);
      }
    }
    if (entry.debugJob !== undefined) {
      const debug = entry.debugJob;
      entry.debugJob = undefined;
      releaseGuestProcessMemory(debug.memoryGrant);
      debug.terminationSignal = "SIGKILL";
      debug.process.terminate("shutdown deadline exceeded");
      this.unschedule(debug.runtimeId);
      this.completeOsProcess(
        entry,
        debug.osPid,
        137,
        debug.cpuCycles,
        "SIGKILL",
      );
      debug.onComplete({
        outcome: "failed",
        error: new Error("debug work cancelled by shutdown deadline"),
      });
    }
    this.finalizeBackgroundProcesses(entry, "SIGKILL");
  }

  private finalizeBackgroundProcesses(
    entry: RuntimeEntry,
    signal: Extract<
      OsProcessSignal,
      "SIGHUP" | "SIGINT" | "SIGKILL" | "SIGTERM"
    >,
  ): void {
    const status = osSignalExitCode(signal);
    for (const background of [...entry.backgroundJobs.values()]) {
      if (signal === "SIGHUP" && background.detached) continue;
      try {
        const process = entry.osRuntimeState.process(background.osPid);
        if (process !== undefined && process.state !== "zombie") {
          this.signalOsProcess(entry, background.osPid, signal);
        } else {
          background.terminationSignal = signal;
          background.process.terminate(signal);
        }
      } catch (error: unknown) {
        background.terminationSignal = signal;
        background.process.terminate(signal);
        entry.osRuntimeState.appendSystemJournal(
          this.scheduler.tickNumber,
          `background process ${String(background.osPid)} signal failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
      this.unschedule(background.runtimeId);
      entry.backgroundJobs.delete(background.osPid);
      releaseGuestProcessMemory(background.memoryGrant);
      const job = entry.osRuntimeState.job(background.jobId);
      if (job !== undefined && job.state !== "done") {
        entry.osRuntimeState.transitionJob(background.jobId, {
          expected: true,
          kind: "complete",
          status,
          tick: this.scheduler.tickNumber,
        });
      }
      if (entry.osRuntimeState.job(background.jobId)?.state === "done")
        entry.osRuntimeState.removeJob(background.jobId);
      if (entry.osRuntimeState.process(background.osPid)?.state === "zombie")
        entry.osRuntimeState.reapProcess(background.osPid);
    }
    entry.jobWait = undefined;
    this.syncOsRuntimeState(entry);
  }

  private executeSynchronousOsProcess(
    entry: RuntimeEntry,
    request: Exclude<ShellForegroundRequest, { readonly kind: "compile" }>,
    execute: () => DebugShellCommandResult,
  ): DebugShellCommandResult {
    const osPid = this.startOsProcess(
      entry,
      request.command,
      request.credentials,
    );
    try {
      const result = execute();
      this.completeOsProcess(
        entry,
        osPid,
        result.outcome === "completed" ? result.exitCode : 1,
        result.outcome === "completed" ? result.cpuCycles : 1,
      );
      return result;
    } catch (error: unknown) {
      this.completeOsProcess(entry, osPid, 1);
      throw error;
    }
  }

  private prepareOsRuntimeBoot(entry: RuntimeEntry): void {
    const tick = this.scheduler.tickNumber;
    if (entry.osRuntimeState.lifecycle.phase === "faulted") {
      entry.osRuntimeState.transitionLifecycle({ kind: "reset", tick });
    }
    if (entry.osRuntimeState.lifecycle.phase === "off") {
      entry.osRuntimeState.transitionLifecycle({ kind: "begin_boot", tick });
    }
    if (entry.osRuntimeState.lifecycle.phase !== "booting") {
      throw new Error(
        `OS runtime cannot boot while ${entry.osRuntimeState.lifecycle.phase}`,
      );
    }
    if (entry.osRuntimeState.process(1) === undefined) {
      entry.osRuntimeState.createInitProcess({
        command:
          activeOsProfile(entry) === "dos"
            ? entry.transientDosRuntimeState === undefined
              ? "C:\\COMMAND.COM"
              : "A:\\COMMAND.COM"
            : "/sbin/cs-init",
        gid: 0,
        startTick: tick,
        state: "running",
        uid: 0,
      });
    }
    this.syncOsRuntimeState(entry);
  }

  private beginOsRuntimeStop(
    entry: RuntimeEntry,
    intent: StopIntent,
    reason: string,
  ): void {
    const phase = entry.osRuntimeState.lifecycle.phase;
    if (phase === "off" || phase === "stopping" || phase === "rebooting") {
      return;
    }
    const tick = this.scheduler.tickNumber;
    if (intent === "reboot" && phase === "running") {
      entry.osRuntimeState.transitionLifecycle({
        kind: "begin_reboot",
        reason,
        tick,
      });
    } else {
      entry.osRuntimeState.transitionLifecycle({
        kind: "begin_shutdown",
        reason,
        tick,
      });
    }
    this.syncOsRuntimeState(entry);
  }

  private faultOsRuntime(entry: RuntimeEntry, reason: string): void {
    const phase = entry.osRuntimeState.lifecycle.phase;
    if (phase === "off" || phase === "faulted") return;
    entry.osRuntimeState.transitionLifecycle({
      kind: "fault",
      reason: reason.slice(0, 64) || "guest runtime fault",
      tick: this.scheduler.tickNumber,
    });
    this.syncOsRuntimeState(entry);
  }

  private completeOsRuntimeDetach(entry: RuntimeEntry): void {
    const tick = this.scheduler.tickNumber;
    const phase = entry.osRuntimeState.lifecycle.phase;
    if (phase === "rebooting") {
      entry.osRuntimeState.transitionLifecycle({ kind: "reboot_ready", tick });
    } else if (phase === "stopping") {
      entry.osRuntimeState.transitionLifecycle({
        kind: "shutdown_complete",
        tick,
      });
    } else if (phase === "running" || phase === "booting") {
      entry.osRuntimeState.transitionLifecycle({
        kind: "begin_shutdown",
        reason: "runtime_detached",
        tick,
      });
      entry.osRuntimeState.transitionLifecycle({
        kind: "shutdown_complete",
        tick,
      });
    }
    this.syncOsRuntimeState(entry);
  }

  private startOsProcess(
    entry: RuntimeEntry,
    command: string,
    credentials: ProcessCredentials,
    niceValue = 0,
    processGroupId?: number,
  ): number {
    const shellPid = entry.shell?.processId();
    const parentPid =
      shellPid !== undefined &&
      entry.osRuntimeState.process(shellPid) !== undefined
        ? shellPid
        : 1;
    const process = entry.osRuntimeState.spawnProcess({
      command,
      gid: credentials.effectiveGroupId,
      niceValue,
      parentPid,
      ...(processGroupId === undefined ? {} : { processGroupId }),
      startTick: this.scheduler.tickNumber,
      state: "running",
      uid: credentials.effectiveUserId,
    });
    this.syncOsRuntimeState(entry);
    return process.pid;
  }

  private completeOsProcess(
    entry: RuntimeEntry,
    pid: number,
    exitCode: number,
    cpuCycles = 0,
    signal?: OsProcessSignal,
  ): void {
    let process = entry.osRuntimeState.process(pid);
    if (process === undefined) return;
    try {
      const tick = Math.max(this.scheduler.tickNumber, process.changedTick);
      if (
        process.state !== "zombie" &&
        Number.isSafeInteger(cpuCycles) &&
        cpuCycles > process.cpuCycles
      ) {
        process = entry.osRuntimeState.transitionProcess(pid, {
          cycles: cpuCycles - process.cpuCycles,
          kind: "account_cycles",
          tick,
        });
      }
      if (process.state !== "zombie") {
        process = entry.osRuntimeState.transitionProcess(pid, {
          expected: true,
          kind: "exit",
          ...(signal === undefined ? {} : { signal }),
          status: exitCode,
          tick: Math.max(tick, process.changedTick),
        });
      }
      if (process.state === "zombie") entry.osRuntimeState.reapProcess(pid);
    } finally {
      this.syncOsRuntimeState(entry);
    }
  }

  private signalOsProcess(
    entry: RuntimeEntry,
    pid: number,
    signal: OsProcessSignal,
  ): void {
    const process = entry.osRuntimeState.process(pid);
    if (process === undefined)
      throw new Error(`process ${String(pid)}: not found`);
    const tick = Math.max(this.scheduler.tickNumber, process.changedTick);
    entry.osRuntimeState.signalProcess(pid, signal, tick);

    const background = entry.backgroundJobs.get(pid);
    if (background !== undefined) {
      if (signal === "SIGSTOP") {
        this.scheduler.setPaused(background.runtimeId, true);
      } else if (signal === "SIGCONT") {
        this.scheduler.setPaused(background.runtimeId, false);
      } else {
        background.terminationSignal = signal;
        background.process.terminate(signal);
      }
    }

    const foregroundJob =
      entry.foreground?.osPid === pid && entry.foreground.jobId !== undefined
        ? entry.foreground
        : undefined;
    if (foregroundJob !== undefined && signal === "SIGSTOP") {
      this.scheduler.setPaused(foregroundJob.runtimeId, true);
      entry.foreground = undefined;
      entry.backgroundJobs.set(pid, {
        command: foregroundJob.command as BackgroundGuestProcess["command"],
        commandLine: foregroundJob.commandLine ?? foregroundJob.command,
        compileCycles: foregroundJob.compileCycles,
        cpuCycles: foregroundJob.cpuCycles,
        detached: false,
        executedInstructions: foregroundJob.executedInstructions,
        instructionLimit: foregroundJob.instructionLimit,
        jobId: foregroundJob.jobId!,
        kind: foregroundJob.kind as BackgroundGuestProcess["kind"],
        limitReached: foregroundJob.limitReached,
        memoryGrant: foregroundJob.memoryGrant,
        osPid: foregroundJob.osPid,
        process: foregroundJob.process,
        runtimeId: foregroundJob.runtimeId,
        stats: foregroundJob.stats,
        ...(foregroundJob.startedHostMilliseconds === undefined
          ? {}
          : {
              startedHostMilliseconds: foregroundJob.startedHostMilliseconds,
            }),
        terminationSignal: foregroundJob.terminationSignal,
      });
      entry.shell?.completeForegroundProcess(148);
      if (entry.vm !== undefined) {
        this.scheduler.queueEvent(
          entry.runtimeId,
          foregroundJob.completionEvent,
          148,
        );
      }
    } else if (foregroundJob !== undefined && signal === "SIGCONT") {
      this.scheduler.setPaused(foregroundJob.runtimeId, false);
    }

    switch (signal) {
      case "SIGSTOP":
      case "SIGCONT":
        this.syncOsRuntimeState(entry);
        return;
      case "SIGHUP":
      case "SIGINT":
      case "SIGKILL":
      case "SIGTERM":
        break;
    }

    if (entry.foreground?.osPid === pid) {
      entry.foreground.terminationSignal = signal;
      entry.foreground.process.terminate(signal);
    } else if (entry.debugJob?.osPid === pid) {
      entry.debugJob.terminationSignal = signal;
      entry.debugJob.process.terminate(signal);
    } else if (entry.compileJob?.osPid === pid) {
      this.completeCompileJob(
        entry,
        osSignalExitCode(signal),
        emptyGuestToolchainTranscript(),
        1,
        signal,
      );
    }
    this.syncOsRuntimeState(entry);
  }

  private syncOsRuntimeState(entry: RuntimeEntry): void {
    if (entry.osRuntimeState !== entry.installedOsRuntimeState) return;
    if (
      entry.syncedOsRuntimeRevision === entry.osRuntimeState.revision &&
      entry.record.osRuntimeSnapshot !== undefined
    ) {
      return;
    }
    entry.record.setOsRuntimeSnapshot(
      entry.osRuntimeState.persistentSnapshot(),
    );
    entry.syncedOsRuntimeRevision = entry.osRuntimeState.revision;
  }

  private syncDosRuntimeState(entry: RuntimeEntry): void {
    const state = entry.dosRuntimeState;
    if (state === undefined) return;
    if (
      entry.syncedDosRuntimeRevision === state.revision &&
      entry.record.dosRuntimeSnapshot !== undefined
    ) {
      return;
    }
    entry.record.setDosRuntimeSnapshot(state.persistentSnapshot());
    entry.syncedDosRuntimeRevision = state.revision;
  }

  private syncReady(entry: RuntimeEntry): void {
    if (entry.record.lifecycle.state.kind !== "running") {
      entry.record.lifecycle.transition({ kind: "vm_ready" });
    }
  }

  private syncSleep(entry: RuntimeEntry, wakeTick: number): void {
    const state = entry.record.lifecycle.state;
    if (state.kind !== "sleeping" || state.wakeTick !== wakeTick) {
      entry.record.lifecycle.transition({ kind: "vm_sleep", wakeTick });
    }
  }

  private syncEventWait(entry: RuntimeEntry, filter?: string): void {
    const state = entry.record.lifecycle.state;
    if (state.kind !== "waiting_event" || state.filter !== filter) {
      entry.record.lifecycle.transition({ kind: "vm_wait_event", filter });
    }
  }

  private detach(entry: RuntimeEntry): void {
    const finalizationFailures: unknown[] = [];
    entry.record.faceIo.powerOff("runtime_detached");
    try {
      const disconnectLines = entry.shell?.disconnect() ?? [];
      if (disconnectLines.length > 0)
        writeTerminalLines(entry.record.terminal, disconnectLines);
    } catch (error: unknown) {
      finalizationFailures.push(error);
    }
    try {
      this.finalizeBackgroundProcesses(entry, "SIGTERM");
    } catch (error: unknown) {
      finalizationFailures.push(error);
    }
    const compileJob = this.finalizeCompileJobProcess(entry, 130, 1, "SIGTERM");
    if (compileJob !== undefined) {
      try {
        compileJob.onComplete?.({
          outcome: "failed",
          error: new Error("compile job ended because the runtime detached"),
        });
      } catch (error: unknown) {
        finalizationFailures.push(error);
      }
    }
    if (entry.foreground !== undefined) {
      const foreground = entry.foreground;
      this.unschedule(foreground.runtimeId);
      entry.foreground = undefined;
      this.finalizeForegroundResources(foreground);
      this.completeForegroundOsProcesses(
        entry,
        foreground,
        130,
        foreground.terminationSignal ?? "SIGTERM",
      );
      if (
        foreground.jobId !== undefined &&
        entry.osRuntimeState.job(foreground.jobId)?.state === "done"
      ) {
        entry.osRuntimeState.removeJob(foreground.jobId);
      }
    }
    if (entry.debugJob !== undefined) {
      const debugJob = entry.debugJob;
      this.unschedule(debugJob.runtimeId);
      entry.debugJob = undefined;
      releaseGuestProcessMemory(debugJob.memoryGrant);
      this.completeOsProcess(
        entry,
        debugJob.osPid,
        130,
        debugJob.cpuCycles,
        debugJob.terminationSignal ?? "SIGTERM",
      );
      try {
        debugJob.onComplete({
          outcome: "failed",
          error: new Error(
            "debug guest execution ended because the runtime detached",
          ),
        });
      } catch (error: unknown) {
        finalizationFailures.push(error);
      }
    }
    this.unschedule(entry.runtimeId);
    this.completeOsRuntimeDetach(entry);
    entry.vm = undefined;
    entry.shell = undefined;
    entry.stopIntent = undefined;
    entry.stopState = undefined;
    this.stoppingEntries.delete(entry);
    entry.csBiosSequence?.cancel();
    entry.csBiosSequence = undefined;
    this.pendingCsBiosEntries.delete(entry);
    entry.activeOsProfile = undefined;
    entry.activeFilesystem = undefined;
    entry.osRuntimeState = entry.installedOsRuntimeState;
    entry.transientDosRuntimeState = undefined;
    try {
      this.finalizeGuestRam(entry);
    } catch (error: unknown) {
      finalizationFailures.push(error);
    }
    if (finalizationFailures.length > 0) {
      writeTerminalLines(entry.record.terminal, [
        `Runtime detach completed with ${String(finalizationFailures.length)} finalization error(s)`,
      ]);
    }
  }

  private advancePendingCsBiosSequences(scope?: TickWorkScope): void {
    const batch: RuntimeEntry[] = [];
    for (const entry of this.pendingCsBiosEntries) {
      batch.push(entry);
      if (batch.length >= 64) break;
    }
    for (const entry of batch) {
      const operation = (): void => {
        this.pendingCsBiosEntries.delete(entry);
        const sequence = entry.csBiosSequence;
        if (sequence === undefined) return;
        try {
          const result = sequence.advance(this.scheduler.tickNumber);
          if (result.outcome === "waiting" || result.outcome === "advanced") {
            this.pendingCsBiosEntries.add(entry);
            return;
          }
          if (result.outcome === "cancelled") {
            throw new Error(
              "CSBIOS sequence was cancelled without a finalization owner",
            );
          }
          clearCsBiosForOs(entry.record.terminal, entry.record.display);
          const osPhaseBeforeHandoff: string =
            entry.osRuntimeState.lifecycle.phase;
          if (
            osPhaseBeforeHandoff !== "booting" &&
            osPhaseBeforeHandoff !== "running"
          ) {
            throw new Error(
              `CSBIOS cannot hand off while the OS is ${osPhaseBeforeHandoff}`,
            );
          }
          if (osPhaseBeforeHandoff === "booting") {
            entry.osRuntimeState.transitionLifecycle({
              kind: "boot_complete",
              tick: this.scheduler.tickNumber,
            });
          }
          const osHandoffPhase: string = entry.osRuntimeState.lifecycle.phase;
          if (osHandoffPhase !== "running") {
            throw new Error("CSBIOS OS handoff did not reach running");
          }
          if (entry.activeOsProfile === "linux") {
            renderLinuxRcBootChatter(entry.record, entry.osRuntimeState);
          }
          this.syncOsRuntimeState(entry);
          const lifecycle = entry.record.lifecycle.transition({
            kind: "boot_complete",
          });
          if (lifecycle.outcome !== "changed") {
            throw new Error(`CSBIOS Computer handoff was ${lifecycle.outcome}`);
          }
          this.scheduler.setPaused(entry.runtimeId, false);
          entry.csBiosSequence = undefined;
        } catch (error: unknown) {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          entry.csBiosSequence?.cancel();
          entry.csBiosSequence = undefined;
          entry.record.display.transition({
            kind: "fault",
            message:
              normalized.message.slice(0, 256) || "CSBIOS handoff failure",
          });
          entry.record.lifecycle.transition({
            kind: "crash",
            message: normalized.message,
          });
          this.detach(entry);
        }
      };
      if (scope === undefined) {
        operation();
      } else if (
        scope.tryRun(
          {
            lane: "control",
            deterministicUnits: 1,
            computerId: entry.record.computerId,
          },
          operation,
        ).outcome === "deferred"
      ) {
        break;
      }
    }
  }

  private unschedule(runtimeId: number): void {
    this.scheduler.remove(runtimeId);
    this.runtimeOwners.delete(runtimeId);
    this.runtimeLanes.delete(runtimeId);
  }

  private runHostWork<T>(
    lane: ComputerWorkLane,
    deterministicUnits: number,
    computerId: string,
    operation: () => T,
  ): T {
    if (this.activeWorkScope === undefined) return operation();
    const attempt = this.activeWorkScope.tryRun(
      { lane, deterministicUnits, computerId },
      operation,
    );
    if (attempt.outcome === "ran") return attempt.value;
    throw new VmRuntimeError(
      "BlockingIOError",
      `${lane} host work budget exhausted; retry after tick ${String(attempt.retryTick)}`,
    );
  }
}

interface RuntimeEntry {
  readonly backgroundJobs: Map<number, BackgroundGuestProcess>;
  readonly record: ComputerRecord;
  readonly runtimeId: number;
  readonly installedOsRuntimeState: OsRuntimeState;
  osRuntimeState: OsRuntimeState;
  readonly dosRuntimeState?: DosRuntimeState;
  readonly floppyDrive: FloppyDrive;
  guestRamLedger?: GuestRamLedger;
  dosGuestMemoryManager?: DosGuestMemoryManager;
  linuxGuestMemoryManager?: LinuxGuestMemoryManager;
  vmMemoryGrant?: GuestProcessMemoryGrant;
  activeFilesystem?: InMemoryFilesystem;
  activeOsProfile?: ComputerOsProfile;
  transientDosRuntimeState?: DosRuntimeState;
  syncedOsRuntimeRevision?: number;
  syncedDosRuntimeRevision?: number;
  vm?: CpuProcess;
  shell?: ShellSession;
  stopIntent?: StopIntent;
  stopState?: RuntimeStopState;
  csBiosSequence?: CsBiosBootSequence;
  safeBootOnce?: boolean;
  foreground?: ForegroundGuestProcess;
  debugJob?: DebugGuestJob;
  compileJob?: CompileJob;
  jobWait?: BackgroundJobWait;
  terminalInteractionGeneration?: number;
  terminalInteractionSignature?: string;
}

type RuntimeStopPhase =
  | "signal"
  | "drain_work"
  | "drain_io"
  | "sync_data"
  | "unmount"
  | "stop_devices"
  | "sync_final"
  | "terminate"
  | "terminating";

interface RuntimeStopState {
  readonly deadlineTick: number;
  readonly intent: StopIntent;
  readonly phase: RuntimeStopPhase;
  readonly reason: string;
}

interface BackgroundJobWait {
  readonly completionEvent: string;
  readonly jobIds: readonly number[];
}

interface BackgroundGuestProcess {
  readonly command:
    "basic" | "micropython" | "python" | "qbasic" | "run" | "sleep";
  readonly commandLine: string;
  readonly detached: boolean;
  readonly compileCycles: number;
  cpuCycles: number;
  executedInstructions: number;
  readonly instructionLimit?: number;
  readonly jobId: number;
  readonly kind: "cs486" | "python" | "sleep";
  limitReached?: boolean;
  readonly memoryGrant?: GuestProcessMemoryGrant;
  readonly osPid: number;
  readonly process: CpuProcess;
  readonly runtimeId: number;
  readonly startedHostMilliseconds?: number;
  readonly stats: boolean;
  terminationSignal?: OsProcessSignal;
}

interface CompileJob {
  readonly completionEvent: string;
  readonly continuation?: CompileJobContinuation;
  readonly memoryBytes: number;
  readonly memoryLease: GuestMemoryReservation;
  readonly onComplete?: (result: DebugShellCommandCompletion) => void;
  readonly osPid: number;
  makeIoCompletion?: {
    readonly code?: string;
    readonly outcome: string;
  };
  makeIoWaitEvent?: string;
  readonly request: Extract<
    ShellForegroundRequest,
    { readonly kind: "compile" }
  >;
}

function compileMemoryOwner(
  request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
): GuestRamOwner {
  if (request.task.kind === "program-list") return "program-list";
  if (request.task.kind === "link") return "linker";
  if (request.task.kind === "make") {
    return {
      category: "compiler",
      displayName: "CS Make",
      moduleId: "make",
    };
  }
  switch (request.task.language) {
    case "asm":
      return "compiler-asm";
    case "basic":
      return "compiler-basic";
    case "c":
      return "compiler-c";
    case "cpp":
      return "compiler-cpp";
  }
}

function currentCompileJob(entry: RuntimeEntry): CompileJob | undefined {
  return entry.compileJob;
}

interface DebugGuestJob {
  readonly compileCycles: number;
  cpuCycles: number;
  executedInstructions: number;
  readonly instructionLimit?: number;
  readonly kind: "cs486" | "debugger" | "python";
  readonly memoryGrant?: GuestProcessMemoryGrant;
  readonly onComplete: (result: DebugShellCommandCompletion) => void;
  readonly osPid: number;
  readonly process: CpuProcess;
  readonly runtimeId: number;
  readonly startedHostMilliseconds?: number;
  readonly shellCompletion?: () => ShellCommandResult;
  readonly stats: boolean;
  readonly terminal?: TerminalBuffer;
  termination?: "cpu_limit" | "instruction_limit" | "unsupported_wait";
  terminationSignal?: OsProcessSignal;
}

interface ForegroundGuestProcess {
  readonly command:
    | "basic"
    | "csasm"
    | "cscc"
    | "csdb"
    | "debug"
    | "micropython"
    | "pipeline"
    | "python"
    | "qbasic"
    | "run"
    | "sleep"
    | "watch";
  readonly commandLine?: string;
  readonly compileCycles: number;
  readonly csAbi?: CsAbiRuntime;
  readonly completionEvent: string;
  readonly completionTranscriptPrefix?: GuestToolchainTranscript;
  cpuCycles: number;
  readonly debuggerCompletion?: () => ShellCommandResult;
  executedInstructions: number;
  readonly instructionLimit?: number;
  readonly jobId?: number;
  readonly kind: "cs486" | "debugger" | "pipeline" | "python" | "sleep";
  lastPagerRevision?: number;
  limitReached?: boolean;
  readonly memoryGrant?: GuestProcessMemoryGrant;
  readonly osPid: number;
  readonly osPids?: readonly number[];
  readonly pipelineCompletion?: () => ShellCommandResult;
  readonly pipelineStageExitCodes?: () => readonly number[];
  readonly process: CpuProcess;
  readonly runtimeId: number;
  readonly startedHostMilliseconds?: number;
  readonly stats: boolean;
  terminationSignal?: OsProcessSignal;
}

interface OsGuestProcessOwner {
  readonly command: string;
  readonly credentials: ProcessCredentials;
  readonly osPid?: number;
}

const foregroundCompletionEvent = "__cs_foreground_complete";
const internalBootManagedMemoryBytes = 64 * 1_024;
const maximumUserBootManagedMemoryBytes = 1_024 * 1_024;

/**
 * A long-lived user startup process retains at most one quarter of physical
 * RAM, capped at the historical 1 MiB Python quota. This leaves deterministic
 * admission room for one ordinary foreground process on the 2 MiB desktop.
 */
function userBootManagedMemoryBytes(physicalMemoryBytes: number): number {
  return Math.min(
    maximumUserBootManagedMemoryBytes,
    Math.max(1, Math.floor(physicalMemoryBytes / 4)),
  );
}
const maximumStopPhaseTicks = 200;
const maximumStoppingEntriesPerTick = 16;

function debugTerminalDisconnected(cpuCycles = 1): DebugShellCommandCompletion {
  return {
    outcome: "completed",
    exitCode: 130,
    stderr: "debug: terminal session disconnected\n",
    stdout: "",
    cpuCycles,
  };
}

function osSignalExitCode(signal: OsProcessSignal): number {
  switch (signal) {
    case "SIGHUP":
      return 129;
    case "SIGINT":
      return 130;
    case "SIGKILL":
      return 137;
    case "SIGTERM":
      return 143;
    case "SIGSTOP":
    case "SIGCONT":
      throw new Error(`${signal} does not terminate a process`);
  }
}

type StopIntent = "reboot" | "shutdown";

function pythonStats(
  instructions: number,
  cpuCycles: number,
  state: string,
  hardware: ComputerHardwareProfile,
  hostElapsedMilliseconds?: number,
): string {
  const microseconds = cpuCyclesToMicroseconds(cpuCycles, hardware.clockHz);
  const runtimeName = cpuModelSpecification(hardware.cpuModel).runtimeName;
  const hostStats = hostElapsedStats(
    cpuCycles,
    hardware.clockHz,
    hostElapsedMilliseconds,
  );
  return `Python/${runtimeName}: ${String(instructions)} machine instructions, ${String(cpuCycles)} CPU cycles, ${microseconds.toFixed(3)} us at ${formatClock(hardware.clockHz)}, ${state}\n${hostStats === undefined ? "" : `${hostStats}\n`}`;
}

function observableCs486Process(process: CpuProcess): ObservableCs486Process {
  const candidate = process as Partial<ObservableCs486Process>;
  if (
    typeof candidate.output !== "string" ||
    typeof candidate.microarchitectureStatsEnabled !== "boolean"
  ) {
    throw new Error("CS486 process observation is unavailable");
  }
  return candidate as ObservableCs486Process;
}

function cs486Stats(
  instructions: number,
  cpuCycles: number,
  state: string,
  hardware: ComputerHardwareProfile,
  process: ObservableCs486Process,
  hostElapsedMilliseconds?: number,
): readonly string[] {
  const microseconds = cpuCyclesToMicroseconds(cpuCycles, hardware.clockHz);
  const runtimeName = cpuModelSpecification(hardware.cpuModel).runtimeName;
  const stats = process.microarchitectureStats;
  const lines = [
    `${runtimeName}: ${String(instructions)} instructions, ${String(cpuCycles)} CPU cycles, ${microseconds.toFixed(3)} us at ${formatClock(hardware.clockHz)}, ${state}`,
    `memory: L1 ${String(stats.l1Hits)} hit/${String(stats.l1Misses)} miss, L2 ${String(stats.l2Hits)} hit/${String(stats.l2Misses)} miss, ${String(stats.busTransfers)} bus transfers, ${String(stats.unalignedAccesses)} unaligned, ${String(stats.pipelineFlushes)} pipeline flushes`,
  ];
  const hostStats = hostElapsedStats(
    cpuCycles,
    hardware.clockHz,
    hostElapsedMilliseconds,
  );
  return hostStats === undefined ? lines : [...lines, hostStats];
}

function hostElapsedStats(
  cpuCycles: number,
  clockHz: number,
  elapsedMilliseconds: number | undefined,
): string | undefined {
  if (elapsedMilliseconds === undefined) return undefined;
  if (elapsedMilliseconds === 0) {
    return "host: 0.000 ms wall elapsed, guest cycle rate unavailable";
  }
  const elapsedSeconds = elapsedMilliseconds / 1_000;
  const guestCyclesPerSecond = cpuCycles / elapsedSeconds;
  const modeledRealtimeRatio = guestCyclesPerSecond / clockHz;
  return `host: ${elapsedMilliseconds.toFixed(3)} ms wall elapsed, ${guestCyclesPerSecond.toFixed(3)} guest CPU cycles/s, ${modeledRealtimeRatio.toFixed(6)}x modeled real-time`;
}

function cs486RunResultStats(
  result: Cs486RunObservation,
  hardware: ComputerHardwareProfile,
): readonly string[] {
  const microseconds = cpuCyclesToMicroseconds(result.cycles, hardware.clockHz);
  const runtimeName = cpuModelSpecification(hardware.cpuModel).runtimeName;
  const stats = result.microarchitecture;
  if (stats === null) {
    throw new Error(
      "CS486 statistics were requested without microarchitecture collection",
    );
  }
  return [
    `${runtimeName}: ${String(result.executedInstructions)} instructions, ${String(result.cycles)} CPU cycles, ${microseconds.toFixed(3)} us at ${formatClock(hardware.clockHz)}, ${result.state}`,
    `memory: L1 ${String(stats.l1Hits)} hit/${String(stats.l1Misses)} miss, L2 ${String(stats.l2Hits)} hit/${String(stats.l2Misses)} miss, ${String(stats.busTransfers)} bus transfers, ${String(stats.unalignedAccesses)} unaligned, ${String(stats.pipelineFlushes)} pipeline flushes`,
  ];
}

function terminalStdout(terminal: TerminalBuffer): string {
  const output = terminal.snapshot().rows.join("\n").trimEnd();
  return output.length === 0 ? "" : `${output}\n`;
}

function isTerminalProcessState(state: CpuProcessState): boolean {
  return (
    state.kind === "completed" ||
    state.kind === "crashed" ||
    state.kind === "terminated"
  );
}

function terminalForegroundExitCode(
  foreground: ForegroundGuestProcess,
  state: CpuProcessState,
): number {
  if (foreground.limitReached === true) return 124;
  if (state.kind === "completed") return 0;
  if (state.kind === "crashed") return 1;
  if (state.kind === "terminated") return 130;
  throw new Error(`Cannot complete foreground process from ${state.kind}`);
}

function debugCompletionFromShellResult(
  result: ShellCommandResult,
  cpuCycles: number,
): Extract<DebugShellCommandResult, { readonly outcome: "completed" }> {
  return {
    outcome: "completed",
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
    cpuCycles: Math.max(1, result.cpuCycles ?? cpuCycles),
  };
}

function writeShellCommandOutput(
  terminal: TerminalBuffer,
  result: ShellCommandResult,
): void {
  const events = result.outputEvents ?? [
    ...(result.stderr.length === 0
      ? []
      : [{ descriptor: 2 as const, text: result.stderr }]),
    ...(result.stdout.length === 0
      ? []
      : [{ descriptor: 1 as const, text: result.stdout }]),
  ];
  for (const { text } of events) {
    if (text.length === 0) continue;
    const normalized = text.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
    const withoutFinalNewline = normalized.endsWith("\n")
      ? normalized.slice(0, -1)
      : normalized;
    writeTerminalLines(terminal, withoutFinalNewline.split("\n"));
  }
}

function formatClock(clockHz: number): string {
  return clockHz >= 1_000_000
    ? `${(clockHz / 1_000_000).toFixed(2).replace(/\.00$/u, "")} MHz`
    : `${String(clockHz)} Hz`;
}

function compileJobUnits(
  request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
): number {
  if (request.task.kind === "program-list") return 256;
  if (request.task.kind === "make") return 256;
  if (request.task.kind === "source") {
    // Assembly may expand bounded guest includes and macros that are not
    // represented by the root source length. Reserve the lane maximum so the
    // admission decision covers that hidden work before preprocessing starts.
    return request.task.language === "asm" ||
      request.task.language === "c" ||
      request.task.language === "cpp"
      ? 256
      : Math.max(1, Math.min(256, Math.ceil(request.task.source.length / 512)));
  }
  return Math.max(1, Math.min(256, request.task.objects.length * 4));
}

function compileTaskCycles(
  request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
  output?: ReturnType<typeof assembleCs486Object> | Cs486Executable,
  includedSourceCharacters = 0,
): number {
  if (request.task.kind === "program-list") return 1;
  if (request.task.kind === "make") return 1;
  if (request.task.kind === "link") {
    return Math.min(
      1_000_000,
      request.task.objects.reduce(
        (total, object) =>
          total + object.symbols.length * 4 + object.relocations.length * 4,
        1,
      ),
    );
  }
  const outputWork =
    output === undefined
      ? 0
      : output.format === "cs486-object"
        ? output.assembly.split("\n").length * 2
        : output.instructions.length * 4;
  return Math.max(
    1,
    Math.ceil((request.task.source.length + includedSourceCharacters) / 4) +
      outputWork,
  );
}

/** Scheduler-owned bounded timer process used by `sleep N &`. */
class BackgroundSleepProcess implements CpuProcess {
  readonly hasPendingCpuCycles = false;
  readonly memoryLimitBytes = 0;
  readonly memoryUsageBytes = 0;
  private stateValue: CpuProcessState;

  constructor(private readonly wakeTick: number) {
    this.stateValue = { kind: "sleeping", wakeTick };
  }

  get state(): CpuProcessState {
    return this.stateValue;
  }

  advanceTick(tick: number): CpuProcessState {
    if (this.stateValue.kind === "sleeping" && tick >= this.wakeTick) {
      this.stateValue = { kind: "completed", value: null };
    }
    return this.stateValue;
  }

  deliverEvent(): boolean {
    return false;
  }

  fail(error: VmRuntimeError): CpuProcessState {
    if (
      this.stateValue.kind !== "completed" &&
      this.stateValue.kind !== "crashed" &&
      this.stateValue.kind !== "terminated"
    ) {
      this.stateValue = { error, kind: "crashed" };
    }
    return this.stateValue;
  }

  runCpuSlice(): CpuProcessSliceResult {
    return {
      cpuCycles: 0,
      executedInstructions: 0,
      state: this.stateValue,
    };
  }

  terminate(reason = "terminated"): CpuProcessState {
    if (
      this.stateValue.kind !== "completed" &&
      this.stateValue.kind !== "crashed" &&
      this.stateValue.kind !== "terminated"
    ) {
      this.stateValue = { kind: "terminated", reason };
    }
    return this.stateValue;
  }
}

function debugLoginRequired(): DebugShellCommandCompletion {
  return {
    outcome: "completed",
    exitCode: 2,
    stdout: "",
    stderr: "debug: CS-Linux login is required before MCP command execution\n",
    cpuCycles: 1,
  };
}

function niceCpuCyclesPerTick(base: number, niceValue = 0): number {
  const normalized = Math.max(-20, Math.min(19, niceValue));
  // Four deterministic weight bands keep admission bounded and starvation-free.
  const numerator =
    normalized <= -10 ? 2 : normalized <= 0 ? 1 : normalized <= 10 ? 1 : 1;
  const denominator =
    normalized <= -10 ? 1 : normalized <= 0 ? 1 : normalized <= 10 ? 2 : 4;
  return Math.max(1, Math.floor((base * numerator) / denominator));
}

function linuxStartupCredentials(record: ComputerRecord): ProcessCredentials {
  const accounts = openLinuxAccountDatabase(record.filesystem);
  const user = accounts.getUserByUid(initialUserId);
  if (user === undefined) {
    throw new Error(
      `CS-Linux startup account UID ${String(initialUserId)} is missing`,
    );
  }
  return createLoginCredentials({
    groupId: user.gid,
    loginName: user.name,
    supplementaryGroupIds: accounts
      .groupsForUser(user.name)
      .map(({ gid }) => gid)
      .filter((gid) => gid !== user.gid),
    userId: user.uid,
  });
}

function guestFilesystemForEntry(
  entry: RuntimeEntry,
  credentials: ProcessCredentials,
  umask: number,
): GuestFilesystem {
  const profile = activeOsProfile(entry);
  const filesystem = activeFilesystem(entry);
  const base =
    profile === "linux"
      ? credentialedFilesystem(filesystem, credentials, umask)
      : unrestrictedGuestFilesystem(filesystem, umask);
  return new FloppyGuestFilesystem(base, entry.floppyDrive, profile);
}

function activeFilesystem(entry: RuntimeEntry): InMemoryFilesystem {
  return entry.activeFilesystem ?? entry.record.filesystem;
}

function grantExecutableProcessMemory(
  entry: RuntimeEntry,
  executable: Cs486Executable,
  command: string,
  instanceId: string,
): GuestProcessMemoryGrant {
  return grantCs486ExecutableMemory(
    executable,
    guestProcessMemoryAdmission(entry, command, instanceId),
  );
}

interface GuestMemoryReservation {
  readonly released: boolean;
  bindProcess(pid: number): void;
  release(): void;
}

function unboundGuestMemoryReservation(reservation: {
  readonly released: boolean;
  release(): void;
}): GuestMemoryReservation {
  return {
    get released(): boolean {
      return reservation.released;
    },
    bindProcess(pid: number): void {
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        throw new RangeError("pid must be a positive safe integer");
      }
    },
    release(): void {
      if (!reservation.released) reservation.release();
    },
  };
}

const rejectCsAbiSyscallHandler: Cs486SyscallHandler = (_name, context) => {
  context.writeRegister("eax", -csAbiErrno.eperm);
  return { kind: "continue" };
};

function createGrantedCs486Process(
  entry: RuntimeEntry,
  executable: Cs486Executable,
  command: string,
  runtimeId: number,
  options: {
    readonly collectMicroarchitectureStats: boolean;
    readonly remoteFactory?: RemoteCs486ProcessFactory;
    readonly syscallHandler?: Cs486SyscallHandler;
  },
): {
  readonly grant: GuestProcessMemoryGrant;
  readonly process: ObservableCs486Process;
} {
  const grant = grantExecutableProcessMemory(
    entry,
    executable,
    command,
    `runtime-${String(runtimeId)}`,
  );
  try {
    return {
      grant,
      process:
        options.remoteFactory === undefined
          ? new Cs486Process(executable, {
              collectMicroarchitectureStats:
                options.collectMicroarchitectureStats,
              cpuModel: entry.record.hardware.cpuModel,
              memoryBytes: grant.memoryBytes,
              ...(options.syscallHandler === undefined
                ? {}
                : { syscallHandler: options.syscallHandler }),
            })
          : createRemoteGrantedCs486Process(
              options.remoteFactory,
              entry,
              executable,
              runtimeId,
              grant.memoryBytes,
              options,
            ),
    };
  } catch (error: unknown) {
    releaseGuestProcessMemory(grant);
    throw error;
  }
}

function createRemoteGrantedCs486Process(
  factory: RemoteCs486ProcessFactory,
  entry: RuntimeEntry,
  executable: Cs486Executable,
  runtimeId: number,
  memoryBytes: number,
  options: {
    readonly collectMicroarchitectureStats: boolean;
    readonly syscallHandler?: Cs486SyscallHandler;
  },
): ObservableCs486Process {
  if (options.syscallHandler !== rejectCsAbiSyscallHandler) {
    throw new Error(
      "Companion execution requires the isolated CS486 syscall policy",
    );
  }
  return factory.create({
    collectMicroarchitectureStats: options.collectMicroarchitectureStats,
    computerId: entry.record.computerId,
    cpuModel: entry.record.hardware.cpuModel,
    executable,
    memoryBytes,
    runtimeId,
  });
}

function guestProcessMemoryAdmission(
  entry: RuntimeEntry,
  command: string,
  instanceId: string,
  displayName = command,
): GuestProcessMemoryAdmission {
  const identity = {
    displayName: displayName.slice(0, 96) || "Guest process",
    instanceId,
    moduleId: guestProcessModuleId(command),
  };
  if (activeOsProfile(entry) === "dos") {
    const manager = entry.dosGuestMemoryManager;
    if (manager === undefined) {
      throw new Error("DOS guest memory manager is unavailable");
    }
    return { identity, kind: "dos", manager };
  }
  return {
    identity,
    kind: "linux",
    manager: requireLinuxGuestMemoryManager(entry),
  };
}

function guestProcessModuleId(command: string): string {
  const normalized = command
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "")
    .slice(0, 64);
  return /^[a-z0-9]/u.test(normalized) ? normalized : "guest-process";
}

function requireGuestRamLedger(entry: RuntimeEntry): GuestRamLedger {
  const ledger = entry.guestRamLedger;
  if (ledger === undefined) {
    throw new Error("Guest RAM ledger is unavailable");
  }
  return ledger;
}

function requireLinuxGuestMemoryManager(
  entry: RuntimeEntry,
): LinuxGuestMemoryManager {
  const manager = entry.linuxGuestMemoryManager;
  if (manager === undefined) {
    throw new Error("Linux guest memory manager is unavailable");
  }
  return manager;
}

function activeOsProfile(entry: RuntimeEntry): ComputerOsProfile {
  return entry.activeOsProfile ?? entry.record.osProfile;
}

function activeDosRuntimeState(
  entry: RuntimeEntry,
): DosRuntimeState | undefined {
  return entry.transientDosRuntimeState ?? entry.dosRuntimeState;
}

function compileJobFallbackSource(
  request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
): string {
  return request.task.kind === "source"
    ? (request.task.sourceName ?? request.command)
    : request.command;
}

function compileJobErrorTranscript(
  command: string,
  error: Error,
  profile: OsProfile,
  fallbackSource: string,
): GuestToolchainTranscript {
  if (error instanceof Cs486CompileError) {
    return guestToolchainTranscriptFromCompileError(error, fallbackSource);
  }
  if (error instanceof Cs486LinkError) {
    return createGuestToolchainTranscript([
      {
        diagnostic: {
          code: "CSLINK001",
          message: error.message,
          notes: [],
          severity: "error",
          source: profile.id === "dos" ? "LINK" : command,
        },
        kind: "diagnostic",
      },
    ]);
  }
  return guestToolchainTranscriptFromFailure(
    `${profile.id === "dos" ? command.toUpperCase() : command}: ${error.name}: ${error.message}\n`,
  );
}

function guestParentPath(path: string): string {
  return path === "/" ? "/" : path.slice(0, path.lastIndexOf("/")) || "/";
}

function renderCompilerDependencies(
  target: string,
  paths: readonly string[],
): string {
  return `${escapeMakeDependency(target)}: ${paths
    .map(escapeMakeDependency)
    .join(" ")}\n`;
}

function escapeMakeDependency(path: string): string {
  return path
    .replaceAll("\\", "\\\\")
    .replaceAll("$", () => "$$")
    .replaceAll("#", "\\#")
    .replaceAll(" ", "\\ ");
}

function terminateAndDisposeRejectedProcess(
  process: CpuProcess | undefined,
  reason: string,
): void {
  if (process === undefined) return;
  try {
    process.terminate(reason);
  } catch {
    // The original admission error remains authoritative, but disposal below
    // still owns final release of an isolated worker actor.
  }
  process.dispose?.();
}

function failure(error: unknown): RuntimeCommandResult {
  return {
    outcome: "failed",
    error: error instanceof Error ? error : new Error(String(error)),
  };
}
