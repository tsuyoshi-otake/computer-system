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
import type { SerialLinkBroker } from "../io/serialLinkBroker.js";
import type { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import {
  type ComputerWorkClaim,
  type ComputerWorkMonitor,
  type ComputerWorkMonitorSnapshot,
  type TickWorkScope,
  type TickWorkSummary,
} from "../runtime/computerWorkMonitor.js";

export interface ComputerHostOptions {
  readonly maxPersistenceChecksPerTick?: number;
  readonly onPersistenceFailure?: (computerId: string, error: Error) => void;
  readonly workMonitor?: ComputerWorkMonitor;
}

export type HostRegistrationResult =
  | { readonly outcome: "registered"; readonly record: ComputerRecord }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error }
  | { readonly outcome: "duplicate"; readonly computerId: string };

export class ComputerHost {
  readonly serial: SerialLinkBroker;
  readonly peripherals: PeripheralBusBroker;
  private readonly records = new Map<string, ComputerRecord>();
  private readonly persistenceJobs = new Map<string, PersistenceSaveJob>();
  private readonly order: string[] = [];
  private readonly maxPersistenceChecksPerTick: number;
  private readonly onPersistenceFailure: (
    computerId: string,
    error: Error,
  ) => void;
  private readonly workMonitor: ComputerWorkMonitor | undefined;
  private hostTick = 0;
  private lastWorkSummaryValue: TickWorkSummary | undefined;
  private persistenceCursor = 0;

  constructor(
    readonly runtime: ComputerRuntime,
    private readonly persistence: ComputerPersistenceService,
    options: ComputerHostOptions = {},
  ) {
    this.serial = runtime.serial;
    this.peripherals = runtime.peripherals;
    const budget = options.maxPersistenceChecksPerTick ?? 4;
    if (!Number.isSafeInteger(budget) || budget <= 0) {
      throw new RangeError("Persistence checks per tick must be positive.");
    }
    this.maxPersistenceChecksPerTick = budget;
    this.onPersistenceFailure =
      options.onPersistenceFailure ?? ((): void => undefined);
    this.workMonitor = options.workMonitor;
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
        this.runtime.runTick();
        this.serial.runTick();
        this.runPersistenceChecks();
        return;
      }
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
