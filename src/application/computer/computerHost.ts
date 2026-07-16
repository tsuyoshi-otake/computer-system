import type { ComputerRecord } from "../../domain/computer/computer.js";
import type {
  ComputerRuntime,
  RuntimeCommandResult,
} from "./computerRuntime.js";
import type {
  ComputerPersistenceService,
  PersistenceJobStepResult,
  PersistenceSaveJob,
  PersistenceResult,
} from "./persistence.js";
import type {
  ComputerStorageMigrationCoordinator,
  ComputerStorageMigrationStatus,
} from "./storageMigration.js";
import type { SerialLinkBroker } from "../io/serialLinkBroker.js";
import type { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import {
  DeterministicBlockDevice,
  type BlockDeviceActivity,
  type BlockRequest,
  type RemovableBlockMedia,
} from "../../domain/storage/blockDevice.js";
import {
  advancedDiskProfile,
  desktopDiskProfile,
  floppy1440kProfile,
  portableDiskProfile,
  type ComputerDiskProfile,
} from "../../domain/storage/storageProfiles.js";
import {
  BlockIoScheduler,
  type BlockIoTickResult,
  type ScheduledBlockSubmitResult,
} from "../runtime/blockIoScheduler.js";
import {
  type ComputerWorkClaim,
  type ComputerWorkMonitor,
  type ComputerWorkMonitorSnapshot,
  type TickWorkScope,
  type TickWorkSummary,
} from "../runtime/computerWorkMonitor.js";

export interface ComputerHostOptions {
  readonly blockIoScheduler?: BlockIoScheduler;
  readonly maxPersistenceChecksPerTick?: number;
  readonly onPersistenceFailure?: (computerId: string, error: Error) => void;
  readonly storageMigration?: Pick<
    ComputerStorageMigrationCoordinator,
    "status" | "step"
  >;
  readonly workMonitor?: ComputerWorkMonitor;
}

export type ComputerBlockDeviceKind = "fdd" | "hdd";

export interface ComputerStorageStatus {
  readonly capacityBytes: number;
  readonly diskProfileId: ComputerDiskProfile["id"];
  readonly fdd: BlockDeviceActivity;
  readonly hdd: BlockDeviceActivity;
}

interface ComputerBlockDevices {
  readonly diskProfile: ComputerDiskProfile;
  readonly fdd: DeterministicBlockDevice;
  readonly hdd: DeterministicBlockDevice;
}

export type HostRegistrationResult =
  | { readonly outcome: "registered"; readonly record: ComputerRecord }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error }
  | { readonly outcome: "duplicate"; readonly computerId: string };

export class ComputerHost {
  readonly serial: SerialLinkBroker;
  readonly peripherals: PeripheralBusBroker;
  readonly blockIo: BlockIoScheduler;
  private readonly records = new Map<string, ComputerRecord>();
  private readonly blockDevices = new Map<string, ComputerBlockDevices>();
  private readonly persistenceJobs = new Map<string, PersistenceSaveJob>();
  private readonly order: string[] = [];
  private readonly maxPersistenceChecksPerTick: number;
  private readonly onPersistenceFailure: (
    computerId: string,
    error: Error,
  ) => void;
  private readonly workMonitor: ComputerWorkMonitor | undefined;
  private readonly storageMigration:
    Pick<ComputerStorageMigrationCoordinator, "status" | "step"> | undefined;
  private hostTick = 0;
  private filesystemIoSequence = 0;
  private readonly pendingFilesystemIo = new Map<
    string,
    { readonly computerId: string; readonly event: string }
  >();
  private lastWorkSummaryValue: TickWorkSummary | undefined;
  private persistenceCursor = 0;

  constructor(
    readonly runtime: ComputerRuntime,
    private readonly persistence: ComputerPersistenceService,
    options: ComputerHostOptions = {},
  ) {
    this.serial = runtime.serial;
    this.peripherals = runtime.peripherals;
    this.blockIo = options.blockIoScheduler ?? new BlockIoScheduler();
    runtime.configureFilesystemIo((computerId, operation, bytes) =>
      this.requestFilesystemIo(computerId, operation, bytes),
    );
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: (computerId) => this.pendingBlockIo(computerId),
      stopDevices: (computerId) => this.stopBlockDevices(computerId),
      syncPersistence: (computerId) => {
        const result = this.flush(computerId);
        if (
          result.outcome === "saved" ||
          result.outcome === "unchanged" ||
          result.outcome === "failed" ||
          result.outcome === "missing"
        ) {
          return result;
        }
        return {
          outcome: "failed" as const,
          error: new Error(
            `Unexpected persistence result during sync: ${result.outcome}`,
          ),
        };
      },
    });
    const budget = options.maxPersistenceChecksPerTick ?? 4;
    if (!Number.isSafeInteger(budget) || budget <= 0) {
      throw new RangeError("Persistence checks per tick must be positive.");
    }
    this.maxPersistenceChecksPerTick = budget;
    this.onPersistenceFailure =
      options.onPersistenceFailure ?? ((): void => undefined);
    this.workMonitor = options.workMonitor;
    this.storageMigration = options.storageMigration;
  }

  register(record: ComputerRecord): HostRegistrationResult {
    if (this.records.has(record.computerId)) {
      return { outcome: "duplicate", computerId: record.computerId };
    }
    const runtimeResult = this.runtime.register(record);
    if (runtimeResult.outcome !== "accepted") {
      return runtimeRegistrationFailure(record.computerId, runtimeResult);
    }
    this.records.set(record.computerId, record);
    this.order.push(record.computerId);
    this.serial.register(record);
    this.peripherals.register(record);
    return { outcome: "registered", record };
  }

  restore(computerId: string): HostRegistrationResult {
    const result = this.persistence.load(computerId);
    if (result.outcome === "loaded") return this.register(result.record);
    if (result.outcome === "missing") return result;
    if (result.outcome === "failed") return result;
    throw new Error(`Unexpected persistence result ${result.outcome}`);
  }

  get(computerId: string): ComputerRecord | undefined {
    return this.records.get(computerId);
  }

  storageStatus(computerId: string): ComputerStorageStatus | undefined {
    const record = this.records.get(computerId);
    if (record === undefined) return undefined;
    const devices = this.ensureBlockDevices(record);
    return {
      capacityBytes: devices.diskProfile.capacityBytes,
      diskProfileId: devices.diskProfile.id,
      fdd: devices.fdd.activity,
      hdd: devices.hdd.activity,
    };
  }

  submitBlockIo(
    computerId: string,
    device: ComputerBlockDeviceKind,
    request: BlockRequest,
  ): ScheduledBlockSubmitResult {
    const record = this.records.get(computerId);
    if (record === undefined) {
      return { outcome: "rejected", reason: "unknown_device" };
    }
    if (this.runtime.isStopping(computerId)) {
      return { outcome: "rejected", reason: "stopping" };
    }
    this.ensureBlockDevices(record);
    return this.blockIo.submit(
      blockDeviceId(computerId, device),
      request,
      this.guestNanoseconds,
    );
  }

  insertFloppy(computerId: string, media: RemovableBlockMedia): number {
    const record = this.records.get(computerId);
    if (record === undefined) throw new Error(`Unknown Computer ${computerId}`);
    this.ensureBlockDevices(record);
    return this.blockIo.insertMedia(blockDeviceId(computerId, "fdd"), media);
  }

  ejectFloppy(computerId: string): void {
    const record = this.records.get(computerId);
    if (record === undefined) throw new Error(`Unknown Computer ${computerId}`);
    this.ensureBlockDevices(record);
    this.blockIo.ejectMedia(
      blockDeviceId(computerId, "fdd"),
      this.guestNanoseconds,
    );
  }

  get lastWorkSummary(): TickWorkSummary | undefined {
    return this.lastWorkSummaryValue;
  }

  workMetrics(): ComputerWorkMonitorSnapshot | undefined {
    return this.workMonitor?.snapshot();
  }

  observeExternalWork<T>(claim: ComputerWorkClaim, operation: () => T): T {
    return this.workMonitor === undefined
      ? operation()
      : this.workMonitor.observeExternal(claim, operation);
  }

  runTick(): void {
    this.hostTick += 1;
    const scope = this.workMonitor?.beginTick(this.hostTick);
    try {
      if (scope === undefined) {
        this.runStorageMigration();
        this.deliverBlockIo(this.blockIo.runDue(this.guestNanoseconds));
        this.runtime.runTick();
        this.serial.runTick();
        this.runPersistenceChecks();
        return;
      }
      this.runStorageMigration(scope);
      this.deliverBlockIo(this.blockIo.runDue(this.guestNanoseconds, scope));
      this.runtime.runTick(scope);
      if (this.serial.hasPendingWork()) {
        scope.tryRun(
          {
            lane: "rs232",
            deterministicUnits: this.workMonitor!.laneLimit("rs232"),
          },
          () => this.serial.runTick(),
        );
      }
      this.runPersistenceChecks(scope);
    } finally {
      if (scope !== undefined) this.lastWorkSummaryValue = scope.finish();
    }
  }

  storageMigrationStatus(): ComputerStorageMigrationStatus | undefined {
    return this.storageMigration?.status;
  }

  private get guestNanoseconds(): bigint {
    return BigInt(this.hostTick) * 50_000_000n;
  }

  private runStorageMigration(scope?: TickWorkScope): void {
    if (
      this.storageMigration === undefined ||
      this.storageMigration.status.state !== "pending"
    ) {
      return;
    }
    if (scope === undefined) {
      this.storageMigration.step(1);
      return;
    }
    scope.tryRun({ lane: "persistence", deterministicUnits: 1 }, () =>
      this.storageMigration!.step(1),
    );
  }

  private requestFilesystemIo(
    computerId: string,
    operation: "read" | "write",
    bytes: number,
  ): string | undefined {
    const record = this.records.get(computerId);
    if (record === undefined || bytes <= 0) return undefined;
    const devices = this.ensureBlockDevices(record);
    const sectorCount = Math.max(
      1,
      Math.min(
        devices.hdd.profile.maximumRequestSectors,
        Math.ceil(bytes / devices.hdd.profile.sectorBytes),
      ),
    );
    this.filesystemIoSequence =
      this.filesystemIoSequence === Number.MAX_SAFE_INTEGER
        ? 1
        : this.filesystemIoSequence + 1;
    const requestId = `fs-${computerId}-${this.filesystemIoSequence.toString(36)}`;
    const result = this.submitBlockIo(computerId, "hdd", {
      id: requestId,
      lba:
        this.filesystemIoSequence %
        (devices.hdd.profile.sectorCount - sectorCount),
      operation,
      sectorCount,
    });
    if (result.outcome !== "accepted") return undefined;
    const event = `block_io:${requestId}`;
    this.pendingFilesystemIo.set(requestId, { computerId, event });
    return event;
  }

  private deliverBlockIo(result: BlockIoTickResult): void {
    for (const { completion } of result.completions) {
      const pending = this.pendingFilesystemIo.get(completion.request.id);
      if (pending === undefined) continue;
      this.pendingFilesystemIo.delete(completion.request.id);
      this.runtime.queueEvent(
        pending.computerId,
        pending.event,
        completion.outcome,
        completion.code,
      );
    }
  }

  private pendingBlockIo(computerId: string): number {
    const devices = this.blockDevices.get(computerId);
    if (devices === undefined) return 0;
    return (
      devices.hdd.activity.pendingRequests +
      devices.fdd.activity.pendingRequests
    );
  }

  private stopBlockDevices(computerId: string): void {
    const devices = this.blockDevices.get(computerId);
    if (devices === undefined) return;
    const completions = [
      ...this.blockIo.unregister(
        blockDeviceId(computerId, "hdd"),
        this.guestNanoseconds,
      ),
      ...this.blockIo.unregister(
        blockDeviceId(computerId, "fdd"),
        this.guestNanoseconds,
      ),
    ];
    this.blockDevices.delete(computerId);
    this.deliverBlockIo({
      budgetDeferred: false,
      bytes: 0,
      completions,
      hostDeferred: false,
      sectors: 0,
    });
  }

  private ensureBlockDevices(record: ComputerRecord): ComputerBlockDevices {
    const existing = this.blockDevices.get(record.computerId);
    if (existing !== undefined) return existing;
    const diskProfile = diskProfileFor(record);
    const devices: ComputerBlockDevices = {
      diskProfile,
      fdd: new DeterministicBlockDevice(floppy1440kProfile),
      hdd: new DeterministicBlockDevice(diskProfile.device),
    };
    this.blockDevices.set(record.computerId, devices);
    this.blockIo.register(blockDeviceId(record.computerId, "hdd"), devices.hdd);
    this.blockIo.register(blockDeviceId(record.computerId, "fdd"), devices.fdd);
    return devices;
  }

  private runPersistenceChecks(scope?: TickWorkScope): void {
    const checks = Math.min(
      this.maxPersistenceChecksPerTick,
      this.order.length,
    );
    for (let index = 0; index < checks; index += 1) {
      const computerId = this.order[this.persistenceCursor];
      if (computerId === undefined) continue;
      if (scope === undefined) {
        this.advancePersistence(computerId);
        this.persistenceCursor =
          (this.persistenceCursor + 1) % this.order.length;
        continue;
      }
      const attempt = scope.tryRun(
        { lane: "persistence", deterministicUnits: 1, computerId },
        () => this.advancePersistence(computerId),
      );
      if (attempt.outcome === "deferred") break;
      this.persistenceCursor = (this.persistenceCursor + 1) % this.order.length;
    }
  }

  flush(computerId: string): PersistenceResult {
    if (!this.records.has(computerId))
      return { outcome: "missing", computerId };
    this.persistenceJobs.delete(computerId);
    return this.persist(computerId);
  }

  private advancePersistence(
    computerId: string,
  ): PersistenceResult | PersistenceJobStepResult {
    const record = this.records.get(computerId);
    if (record === undefined) return { outcome: "missing", computerId };
    let job = this.persistenceJobs.get(computerId);
    if (job === undefined) {
      const started = this.persistence.startSaveIfDirty(record);
      if (started.outcome !== "started") {
        if (started.outcome === "failed") {
          this.onPersistenceFailure(computerId, started.error);
        }
        return started;
      }
      job = started.job;
      this.persistenceJobs.set(computerId, job);
    }
    const result = job.step();
    if (result.outcome !== "pending") {
      this.persistenceJobs.delete(computerId);
    }
    if (result.outcome === "failed") {
      this.onPersistenceFailure(computerId, result.error);
    }
    return result;
  }

  private persist(computerId: string): PersistenceResult {
    const record = this.records.get(computerId);
    if (record === undefined) return { outcome: "missing", computerId };
    const result = this.persistence.saveIfDirty(record);
    if (result.outcome === "failed") {
      this.onPersistenceFailure(computerId, result.error);
    }
    return result;
  }
}

function runtimeRegistrationFailure(
  computerId: string,
  result: RuntimeCommandResult,
): HostRegistrationResult {
  if (result.outcome === "failed") return result;
  if (result.outcome === "missing") return result;
  return { outcome: "duplicate", computerId };
}

function blockDeviceId(
  computerId: string,
  device: ComputerBlockDeviceKind,
): string {
  return `${computerId}:${device}`;
}

function diskProfileFor(record: ComputerRecord): ComputerDiskProfile {
  if (record.displayProfileId === "portable-vga-256k")
    return portableDiskProfile;
  return record.family === "advanced"
    ? advancedDiskProfile
    : desktopDiskProfile;
}
