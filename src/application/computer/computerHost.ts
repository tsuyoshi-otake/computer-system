import type { ComputerRecord } from "../../domain/computer/computer.js";
import type {
  ComputerRuntime,
  RuntimeCommandResult,
} from "./computerRuntime.js";
import type {
  ComputerPersistenceService,
  PersistenceResult,
} from "./persistence.js";
import type { SerialLinkBroker } from "../io/serialLinkBroker.js";
import type { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import {
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
      scope.tryRun(
        {
          lane: "guest_cpu",
          deterministicUnits: this.workMonitor!.laneLimit("guest_cpu"),
        },
        () => this.runtime.runTick(),
      );
      scope.tryRun(
        {
          lane: "rs232",
          deterministicUnits: this.workMonitor!.laneLimit("rs232"),
        },
        () => this.serial.runTick(),
      );
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
        this.persist(computerId);
        this.persistenceCursor =
          (this.persistenceCursor + 1) % this.order.length;
        continue;
      }
      const attempt = scope.tryRun(
        { lane: "persistence", deterministicUnits: 1, computerId },
        () => this.persist(computerId),
      );
      if (attempt.outcome === "deferred") break;
      this.persistenceCursor = (this.persistenceCursor + 1) % this.order.length;
    }
  }

  flush(computerId: string): PersistenceResult {
    if (!this.records.has(computerId))
      return { outcome: "missing", computerId };
    return this.persist(computerId);
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
