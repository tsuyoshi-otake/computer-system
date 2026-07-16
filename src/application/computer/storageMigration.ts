import type { ComputerSnapshot } from "../../domain/computer/computer.js";
import {
  ComputerIdentityRegistry,
  isComputerId,
  type ComputerIdentityObservation,
} from "../../domain/computer/identity.js";
import type { ComputerIdentitySnapshot } from "./identityPersistence.js";
import { migrateComputerSnapshot } from "./snapshotMigration.js";

export type MigrationStorageFormat =
  "legacy_indexed_pages" | "content_addressed_blobs";

export type MigrationLoadStepResult<T> =
  | { readonly outcome: "pending"; readonly stage: string }
  | { readonly outcome: "missing" }
  | {
      readonly outcome: "complete";
      readonly generation: number;
      readonly recovered: boolean;
      readonly sourceFormat: MigrationStorageFormat;
      readonly value: T;
    };

export interface MigrationLoadTransaction<T> {
  step(maxOperations?: number): MigrationLoadStepResult<T>;
}

export type MigrationSaveStepResult =
  | { readonly outcome: "pending"; readonly stage: string }
  | { readonly outcome: "complete"; readonly generation: number };

export interface MigrationSaveTransaction {
  step(maxOperations?: number): MigrationSaveStepResult;
}

export interface MigrationCleanupTransaction {
  step(maxOperations?: number): MigrationSaveStepResult;
}

export interface ComputerStorageMigrationRepository {
  beginCleanupComputer(
    computerId: string,
    generation: number,
  ): MigrationCleanupTransaction;
  beginCleanupIdentities(generation: number): MigrationCleanupTransaction;
  beginLoadComputer(computerId: string): MigrationLoadTransaction<unknown>;
  beginLoadIdentities(): MigrationLoadTransaction<unknown>;
  beginSaveComputer(
    snapshot: ComputerSnapshot,
    sourceGeneration: number,
  ): MigrationSaveTransaction;
  beginSaveIdentities(
    snapshot: ComputerIdentitySnapshot,
    sourceGeneration: number,
  ): MigrationSaveTransaction;
}

export type ComputerStorageMigrationPhase =
  | "identity_load"
  | "computer_load"
  | "computer_save"
  | "computer_verify"
  | "computer_cleanup"
  | "identity_save"
  | "identity_verify"
  | "identity_cleanup";

export type ComputerStorageMigrationStatus =
  | {
      readonly state: "pending";
      readonly phase: ComputerStorageMigrationPhase;
      readonly completedComputers: number;
      readonly currentComputerId?: string;
      readonly totalComputers: number;
    }
  | {
      readonly state: "complete";
      readonly migratedComputers: number;
      readonly missingComputers: number;
      readonly skippedComputers: number;
      readonly totalComputers: number;
    }
  | {
      readonly state: "failed";
      readonly error: Error;
      readonly phase: ComputerStorageMigrationPhase;
      readonly completedComputers: number;
      readonly currentComputerId?: string;
      readonly totalComputers: number;
    };

export interface ComputerStorageMigrationOptions {
  readonly maximumComputers?: number;
}

const currentStorageFormat: MigrationStorageFormat = "content_addressed_blobs";

/**
 * Scans every referenced Computer independently from the identity storage
 * format. Changed Computer generations are committed and verified first; a
 * legacy identity generation remains the final activation point, while an
 * already-current identity generation is never rewritten just for scanning.
 */
export class ComputerStorageMigrationCoordinator {
  private readonly maximumComputers: number;
  private phase: ComputerStorageMigrationPhase = "identity_load";
  private identityLoad: MigrationLoadTransaction<unknown>;
  private identitySave: MigrationSaveTransaction | undefined;
  private identitySavedGeneration: number | undefined;
  private identityVerify: MigrationLoadTransaction<unknown> | undefined;
  private identityCleanup: MigrationCleanupTransaction | undefined;
  private identitySnapshot: ComputerIdentitySnapshot | undefined;
  private identitySourceGeneration: number | undefined;
  private identityRequiresSave = false;
  private identityRecovered = false;
  private observations: readonly ComputerIdentityObservation[] = [];
  private computerIndex = 0;
  private computerLoad: MigrationLoadTransaction<unknown> | undefined;
  private computerSave: MigrationSaveTransaction | undefined;
  private computerSavedGeneration: number | undefined;
  private computerVerify: MigrationLoadTransaction<unknown> | undefined;
  private computerCleanup: MigrationCleanupTransaction | undefined;
  private pendingSnapshot: ComputerSnapshot | undefined;
  private computerSourceGeneration: number | undefined;
  private migratedComputers = 0;
  private missingComputers = 0;
  private skippedComputers = 0;
  private terminalStatus: ComputerStorageMigrationStatus | undefined;

  constructor(
    private readonly repository: ComputerStorageMigrationRepository,
    options: ComputerStorageMigrationOptions = {},
  ) {
    this.maximumComputers = options.maximumComputers ?? 4_096;
    if (
      !Number.isSafeInteger(this.maximumComputers) ||
      this.maximumComputers <= 0
    ) {
      throw new RangeError("Migration Computer limit must be positive");
    }
    this.identityLoad = repository.beginLoadIdentities();
  }

  get status(): ComputerStorageMigrationStatus {
    if (this.terminalStatus !== undefined) return this.terminalStatus;
    return {
      state: "pending",
      phase: this.phase,
      completedComputers: this.computerIndex,
      currentComputerId: this.currentComputerId,
      totalComputers: this.observations.length,
    };
  }

  step(maxOperations = 1): ComputerStorageMigrationStatus {
    if (!Number.isSafeInteger(maxOperations) || maxOperations <= 0) {
      throw new RangeError("Migration operations must be positive");
    }
    if (maxOperations > 64) {
      throw new RangeError("Migration operations may not exceed 64 per step");
    }
    if (this.terminalStatus !== undefined) return this.terminalStatus;

    let operations = 0;
    let transitions = 0;
    try {
      while (operations < maxOperations && this.terminalStatus === undefined) {
        transitions += 1;
        if (transitions > 64) {
          throw new Error("Storage migration made no observable progress");
        }
        switch (this.phase) {
          case "identity_load":
            operations += 1;
            this.advanceIdentityLoad(this.identityLoad.step(1));
            break;
          case "computer_load":
            if (this.computerIndex >= this.observations.length) {
              this.finishComputerScan();
              break;
            }
            this.computerLoad ??= this.repository.beginLoadComputer(
              this.currentComputerId!,
            );
            operations += 1;
            this.advanceComputerLoad(this.computerLoad.step(1));
            break;
          case "computer_save":
            operations += 1;
            this.advanceComputerSave(this.computerSave!.step(1));
            break;
          case "computer_verify":
            operations += 1;
            this.advanceComputerVerify(this.computerVerify!.step(1));
            break;
          case "computer_cleanup":
            operations += 1;
            this.advanceComputerCleanup(this.computerCleanup!.step(1));
            break;
          case "identity_save":
            operations += 1;
            this.advanceIdentitySave(this.identitySave!.step(1));
            break;
          case "identity_verify":
            operations += 1;
            this.advanceIdentityVerify(this.identityVerify!.step(1));
            break;
          case "identity_cleanup":
            operations += 1;
            this.advanceIdentityCleanup(this.identityCleanup!.step(1));
            break;
        }
      }
    } catch (error: unknown) {
      this.terminalStatus = {
        state: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
        phase: this.phase,
        completedComputers: this.computerIndex,
        currentComputerId: this.currentComputerId,
        totalComputers: this.observations.length,
      };
    }
    return this.status;
  }

  private get currentComputerId(): string | undefined {
    return this.observations[this.computerIndex]?.computerId;
  }

  private advanceIdentityLoad(result: MigrationLoadStepResult<unknown>): void {
    if (result.outcome === "pending") return;
    if (result.outcome === "missing") {
      this.complete();
      return;
    }

    const snapshot = requireIdentitySnapshot(
      result.value,
      this.maximumComputers,
    );
    this.identitySourceGeneration = result.generation;
    this.identitySnapshot = snapshot;
    this.observations = snapshot.observations;
    this.identityRequiresSave =
      result.sourceFormat !== currentStorageFormat || result.recovered;
    this.identityRecovered = result.recovered;
    this.phase = "computer_load";
  }

  private advanceComputerLoad(result: MigrationLoadStepResult<unknown>): void {
    if (result.outcome === "pending") return;
    this.computerLoad = undefined;
    if (result.outcome === "missing") {
      this.missingComputers += 1;
      this.advanceComputer();
      return;
    }

    const snapshot = migrateComputerSnapshot(result.value);
    this.computerSourceGeneration = result.generation;
    if (snapshot.computerId !== this.currentComputerId) {
      throw new Error(
        `Stored Computer ${snapshot.computerId} does not match ${String(this.currentComputerId)}`,
      );
    }
    const requiresSave =
      result.sourceFormat !== currentStorageFormat ||
      result.recovered ||
      snapshot !== result.value;
    if (result.sourceFormat === currentStorageFormat && !result.recovered) {
      this.pendingSnapshot = requiresSave ? snapshot : undefined;
      this.computerCleanup = this.repository.beginCleanupComputer(
        snapshot.computerId,
        result.generation,
      );
      this.phase = "computer_cleanup";
      return;
    }
    if (!requiresSave) {
      this.skippedComputers += 1;
      this.advanceComputer();
      return;
    }

    this.pendingSnapshot = snapshot;
    this.computerSave = this.repository.beginSaveComputer(
      snapshot,
      this.computerSourceGeneration,
    );
    this.phase = "computer_save";
  }

  private advanceComputerSave(result: MigrationSaveStepResult): void {
    if (result.outcome === "pending") return;
    this.computerSavedGeneration = result.generation;
    this.computerSave = undefined;
    this.computerVerify = this.repository.beginLoadComputer(
      this.currentComputerId!,
    );
    this.phase = "computer_verify";
  }

  private advanceComputerCleanup(result: MigrationSaveStepResult): void {
    if (result.outcome === "pending") return;
    if (result.generation !== this.computerSourceGeneration) {
      throw new Error(
        `Computer ${String(this.currentComputerId)} cleanup changed generation`,
      );
    }
    this.computerCleanup = undefined;
    if (this.pendingSnapshot !== undefined) {
      this.computerSave = this.repository.beginSaveComputer(
        this.pendingSnapshot,
        this.computerSourceGeneration,
      );
      this.phase = "computer_save";
      return;
    }
    this.skippedComputers += 1;
    this.advanceComputer();
  }

  private advanceComputerVerify(
    result: MigrationLoadStepResult<unknown>,
  ): void {
    if (result.outcome === "pending") return;
    if (result.outcome === "missing") {
      throw new Error(
        `Migrated Computer ${String(this.currentComputerId)} is missing`,
      );
    }
    if (result.sourceFormat !== currentStorageFormat) {
      throw new Error(
        `Migrated Computer ${String(this.currentComputerId)} retained a legacy storage format`,
      );
    }
    if (
      result.recovered ||
      result.generation !== this.computerSavedGeneration
    ) {
      throw new Error(
        `Migrated Computer ${String(this.currentComputerId)} did not verify its committed generation`,
      );
    }
    const verified = migrateComputerSnapshot(result.value);
    if (
      verified.computerId !== this.currentComputerId ||
      JSON.stringify(verified) !== JSON.stringify(this.pendingSnapshot)
    ) {
      throw new Error(
        `Migrated Computer ${String(this.currentComputerId)} failed verification`,
      );
    }
    this.computerVerify = undefined;
    this.pendingSnapshot = undefined;
    this.computerSourceGeneration = undefined;
    this.computerSavedGeneration = undefined;
    this.migratedComputers += 1;
    this.advanceComputer();
  }

  private advanceComputer(): void {
    this.computerIndex += 1;
    this.computerLoad = undefined;
    this.computerCleanup = undefined;
    this.computerSave = undefined;
    this.pendingSnapshot = undefined;
    this.computerSourceGeneration = undefined;
    this.phase = "computer_load";
  }

  private beginIdentitySave(): void {
    this.identitySave = this.repository.beginSaveIdentities(
      this.identitySnapshot!,
      this.identitySourceGeneration!,
    );
    this.phase = "identity_save";
  }

  private finishComputerScan(): void {
    if (this.identityRecovered) {
      this.beginIdentitySave();
      return;
    }
    this.identityCleanup = this.repository.beginCleanupIdentities(
      this.identitySourceGeneration!,
    );
    this.phase = "identity_cleanup";
  }

  private advanceIdentityCleanup(result: MigrationSaveStepResult): void {
    if (result.outcome === "pending") return;
    if (result.generation !== this.identitySourceGeneration) {
      throw new Error("Identity cleanup changed generation");
    }
    this.identityCleanup = undefined;
    if (this.identityRequiresSave) this.beginIdentitySave();
    else this.complete();
  }

  private advanceIdentitySave(result: MigrationSaveStepResult): void {
    if (result.outcome === "pending") return;
    this.identitySavedGeneration = result.generation;
    this.identitySave = undefined;
    this.identityVerify = this.repository.beginLoadIdentities();
    this.phase = "identity_verify";
  }

  private advanceIdentityVerify(
    result: MigrationLoadStepResult<unknown>,
  ): void {
    if (result.outcome === "pending") return;
    if (result.outcome === "missing") {
      throw new Error("Migrated identity registry is missing");
    }
    if (result.sourceFormat !== currentStorageFormat) {
      throw new Error("Migrated identity registry retained a legacy format");
    }
    if (
      result.recovered ||
      result.generation !== this.identitySavedGeneration
    ) {
      throw new Error(
        "Migrated identity registry did not verify its committed generation",
      );
    }
    const verified = requireIdentitySnapshot(
      result.value,
      this.maximumComputers,
    );
    if (JSON.stringify(verified) !== JSON.stringify(this.identitySnapshot)) {
      throw new Error("Migrated identity registry failed verification");
    }
    this.identityVerify = undefined;
    this.complete();
  }

  private complete(): void {
    this.terminalStatus = {
      state: "complete",
      migratedComputers: this.migratedComputers,
      missingComputers: this.missingComputers,
      skippedComputers: this.skippedComputers,
      totalComputers: this.observations.length,
    };
  }
}

function requireIdentitySnapshot(
  value: unknown,
  maximumComputers: number,
): ComputerIdentitySnapshot {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Identity snapshot must be an object");
  }
  if (!hasOnlyKeys(value, ["schema", "observations"])) {
    throw new TypeError("Identity snapshot contains unsupported fields");
  }
  const candidate = value as Partial<ComputerIdentitySnapshot>;
  if (candidate.schema !== 2 || !Array.isArray(candidate.observations)) {
    throw new TypeError("Unsupported identity snapshot schema");
  }
  if (candidate.observations.length > maximumComputers) {
    throw new RangeError("Identity snapshot exceeds the migration limit");
  }
  const observations = candidate.observations.map((observation) => {
    if (!isIdentityObservation(observation)) {
      throw new TypeError("Identity snapshot contains an invalid observation");
    }
    return observation;
  });
  const registry = new ComputerIdentityRegistry();
  registry.restore(observations);
  return { schema: 2, observations: registry.snapshot() };
}

function isIdentityObservation(
  value: unknown,
): value is ComputerIdentityObservation {
  if (typeof value !== "object" || value === null) return false;
  if (!hasOnlyKeys(value, ["computerId", "family", "form", "physicalKey"])) {
    return false;
  }
  const candidate = value as Partial<ComputerIdentityObservation>;
  return (
    isComputerId(candidate.computerId) &&
    (candidate.family === "standard" || candidate.family === "advanced") &&
    (candidate.form === "block" || candidate.form === "item") &&
    typeof candidate.physicalKey === "string" &&
    candidate.physicalKey.length > 0 &&
    candidate.physicalKey.length <= 256
  );
}

function hasOnlyKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}
