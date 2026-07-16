import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../domain/computer/computer.js";
import { migrateComputerSnapshot } from "./snapshotMigration.js";
import { registerOsFilesystemImages } from "../os/osFilesystemImages.js";

export interface ComputerSnapshotRepository {
  load(computerId: string): ComputerSnapshot | undefined;
  save(snapshot: ComputerSnapshot): number;
  beginSave?(snapshot: ComputerSnapshot): ComputerSnapshotSaveTransaction;
}

export interface ComputerSnapshotSaveTransaction {
  step(
    maxOperations?: number,
  ):
    | { readonly outcome: "pending"; readonly stage?: string }
    | { readonly outcome: "complete"; readonly generation: number };
}

export type PersistenceJobStepResult =
  | { readonly outcome: "pending"; readonly stage?: string }
  | { readonly outcome: "saved"; readonly generation: number }
  | { readonly outcome: "failed"; readonly error: Error };

export interface PersistenceSaveJob {
  readonly computerId: string;
  step(): PersistenceJobStepResult;
}

export type PersistenceStartResult =
  | { readonly outcome: "started"; readonly job: PersistenceSaveJob }
  | { readonly outcome: "unchanged" }
  | { readonly outcome: "failed"; readonly error: Error };

export type PersistenceResult =
  | { readonly outcome: "saved"; readonly generation: number }
  | { readonly outcome: "unchanged" }
  | { readonly outcome: "loaded"; readonly record: ComputerRecord }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error };

export class ComputerPersistenceService {
  private readonly savedRevisions = new Map<string, string>();

  constructor(private readonly repository: ComputerSnapshotRepository) {
    registerOsFilesystemImages();
  }

  startSaveIfDirty(record: ComputerRecord): PersistenceStartResult {
    const revision = record.persistenceRevision;
    if (this.savedRevisions.get(record.computerId) === revision) {
      return { outcome: "unchanged" };
    }
    try {
      const snapshot = record.snapshot();
      const transaction =
        this.repository.beginSave?.(snapshot) ??
        synchronousSaveTransaction(this.repository, snapshot);
      let terminal = false;
      return {
        outcome: "started",
        job: {
          computerId: record.computerId,
          step: (): PersistenceJobStepResult => {
            if (terminal) {
              return {
                outcome: "failed",
                error: new Error("Persistence job is already complete"),
              };
            }
            try {
              const result = transaction.step(1);
              if (result.outcome === "pending") return result;
              terminal = true;
              // Capture the saved revision, not the record's current revision.
              // A mutation during the save therefore remains dirty.
              this.savedRevisions.set(record.computerId, revision);
              return {
                outcome: "saved",
                generation: result.generation,
              };
            } catch (error: unknown) {
              terminal = true;
              return {
                outcome: "failed",
                error:
                  error instanceof Error ? error : new Error(String(error)),
              };
            }
          },
        },
      };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  saveIfDirty(record: ComputerRecord): PersistenceResult {
    const revision = record.persistenceRevision;
    if (this.savedRevisions.get(record.computerId) === revision) {
      return { outcome: "unchanged" };
    }
    try {
      const generation = this.repository.save(record.snapshot());
      this.savedRevisions.set(record.computerId, revision);
      return { outcome: "saved", generation };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  load(computerId: string): PersistenceResult {
    try {
      const snapshot = this.repository.load(computerId);
      if (snapshot === undefined) return { outcome: "missing", computerId };
      const record = ComputerRecord.restore(migrateComputerSnapshot(snapshot));
      this.savedRevisions.set(computerId, record.persistenceRevision);
      return { outcome: "loaded", record };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}

function synchronousSaveTransaction(
  repository: ComputerSnapshotRepository,
  snapshot: ComputerSnapshot,
): ComputerSnapshotSaveTransaction {
  let complete = false;
  return {
    step: (): ReturnType<ComputerSnapshotSaveTransaction["step"]> => {
      if (complete)
        throw new Error("Persistence transaction is already complete");
      complete = true;
      return { outcome: "complete", generation: repository.save(snapshot) };
    },
  };
}
