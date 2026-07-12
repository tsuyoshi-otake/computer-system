import type { ComputerRecord } from "../../domain/computer/computer.js";
import type {
  ComputerRuntime,
  RuntimeCommandResult,
} from "./computerRuntime.js";
import type {
  ComputerPersistenceService,
  PersistenceResult,
} from "./persistence.js";

export interface ComputerHostOptions {
  readonly maxPersistenceChecksPerTick?: number;
  readonly onPersistenceFailure?: (computerId: string, error: Error) => void;
}

export type HostRegistrationResult =
  | { readonly outcome: "registered"; readonly record: ComputerRecord }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error }
  | { readonly outcome: "duplicate"; readonly computerId: string };

export class ComputerHost {
  private readonly records = new Map<string, ComputerRecord>();
  private readonly order: string[] = [];
  private readonly maxPersistenceChecksPerTick: number;
  private readonly onPersistenceFailure: (
    computerId: string,
    error: Error,
  ) => void;
  private persistenceCursor = 0;

  constructor(
    readonly runtime: ComputerRuntime,
    private readonly persistence: ComputerPersistenceService,
    options: ComputerHostOptions = {},
  ) {
    const budget = options.maxPersistenceChecksPerTick ?? 4;
    if (!Number.isSafeInteger(budget) || budget <= 0) {
      throw new RangeError("Persistence checks per tick must be positive.");
    }
    this.maxPersistenceChecksPerTick = budget;
    this.onPersistenceFailure =
      options.onPersistenceFailure ?? ((): void => undefined);
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

  runTick(): void {
    this.runtime.runTick();
    const checks = Math.min(
      this.maxPersistenceChecksPerTick,
      this.order.length,
    );
    for (let index = 0; index < checks; index += 1) {
      const computerId = this.order[this.persistenceCursor];
      this.persistenceCursor = (this.persistenceCursor + 1) % this.order.length;
      if (computerId !== undefined) this.persist(computerId);
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
