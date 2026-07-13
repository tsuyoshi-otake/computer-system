import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../domain/computer/computer.js";
import { migrateComputerSnapshot } from "./snapshotMigration.js";

export interface ComputerSnapshotRepository {
  load(computerId: string): ComputerSnapshot | undefined;
  save(snapshot: ComputerSnapshot): number;
}

export type PersistenceResult =
  | { readonly outcome: "saved"; readonly generation: number }
  | { readonly outcome: "unchanged" }
  | { readonly outcome: "loaded"; readonly record: ComputerRecord }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error };

export class ComputerPersistenceService {
  private readonly fingerprints = new Map<string, string>();

  constructor(private readonly repository: ComputerSnapshotRepository) {}

  saveIfDirty(record: ComputerRecord): PersistenceResult {
    const snapshot = record.snapshot();
    const fingerprint = JSON.stringify(snapshot);
    if (this.fingerprints.get(record.computerId) === fingerprint) {
      return { outcome: "unchanged" };
    }
    try {
      const generation = this.repository.save(snapshot);
      this.fingerprints.set(record.computerId, fingerprint);
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
      this.fingerprints.set(computerId, JSON.stringify(snapshot));
      return { outcome: "loaded", record };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
