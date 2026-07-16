import type { ComputerSnapshotRepository } from "../../application/computer/persistence.js";
import { isMigratableComputerSnapshot } from "../../application/computer/snapshotMigration.js";
import type { ComputerSnapshot } from "../../domain/computer/computer.js";
import { requireComputerId } from "../../domain/computer/identity.js";
import {
  TransactionalPagedStore,
  type PagedSaveTransaction,
} from "./transactionalPagedStore.js";

export interface DynamicPropertyOwner {
  getDynamicProperty(identifier: string): unknown;
  getDynamicPropertyIds?(): string[];
  setDynamicProperty(identifier: string, value: string | undefined): void;
}

export interface DynamicPropertyComputerRepositoryOptions {
  readonly pageCharacterLimit?: number;
  readonly prefix?: string;
}

export class DynamicPropertyComputerRepository implements ComputerSnapshotRepository {
  private readonly pageCharacterLimit: number;
  private readonly prefix: string;

  constructor(
    private readonly owner: DynamicPropertyOwner,
    options: DynamicPropertyComputerRepositoryOptions = {},
  ) {
    this.pageCharacterLimit = options.pageCharacterLimit ?? 24_000;
    this.prefix = options.prefix ?? "computer_system:computer";
  }

  load(computerId: string): ComputerSnapshot | undefined {
    const result = this.store(computerId).load(isComputerSnapshot);
    return result?.value;
  }

  save(snapshot: ComputerSnapshot): number {
    return this.store(snapshot.computerId).save(snapshot);
  }

  beginSave(snapshot: ComputerSnapshot): PagedSaveTransaction {
    return this.store(snapshot.computerId).beginSave(snapshot);
  }

  private store(computerId: string): TransactionalPagedStore {
    requireComputerId(computerId);
    return new TransactionalPagedStore(
      {
        delete: (key): void => this.owner.setDynamicProperty(key, undefined),
        get: (key): string | undefined => {
          const value = this.owner.getDynamicProperty(key);
          if (value === undefined) return undefined;
          if (typeof value !== "string") {
            throw new TypeError(`Dynamic property ${key} is not a string.`);
          }
          return value;
        },
        keys: (prefix): readonly string[] =>
          this.owner
            .getDynamicPropertyIds?.()
            .filter((key) => key.startsWith(prefix)) ?? [],
        set: (key, value): void => {
          this.owner.setDynamicProperty(key, value);
        },
      },
      `${this.prefix}:${computerId}`,
      this.pageCharacterLimit,
    );
  }
}

function isComputerSnapshot(value: unknown): value is ComputerSnapshot {
  return isMigratableComputerSnapshot(value) && value.schema === 2;
}
