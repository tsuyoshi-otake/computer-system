import type {
  ComputerStorageMigrationRepository,
  MigrationCleanupTransaction,
  MigrationLoadTransaction,
  MigrationSaveTransaction,
} from "../../application/computer/storageMigration.js";
import type { ComputerSnapshot } from "../../domain/computer/computer.js";
import { requireComputerId } from "../../domain/computer/identity.js";
import type { ComputerIdentitySnapshot } from "../../application/computer/identityPersistence.js";
import type { DynamicPropertyOwner } from "./dynamicPropertyComputerRepository.js";
import { TransactionalPagedStore } from "./transactionalPagedStore.js";

export interface DynamicPropertyStorageMigrationRepositoryOptions {
  readonly computerPrefix?: string;
  readonly identityPrefix?: string;
  readonly pageCharacterLimit?: number;
}

/** Bedrock Dynamic Property adapter for the application migration state machine. */
export class DynamicPropertyStorageMigrationRepository implements ComputerStorageMigrationRepository {
  private readonly computerPrefix: string;
  private readonly identityPrefix: string;
  private readonly pageCharacterLimit: number;

  constructor(
    private readonly owner: DynamicPropertyOwner,
    options: DynamicPropertyStorageMigrationRepositoryOptions = {},
  ) {
    this.computerPrefix = options.computerPrefix ?? "computer_system:computer";
    this.identityPrefix =
      options.identityPrefix ?? "computer_system:identities";
    this.pageCharacterLimit = options.pageCharacterLimit ?? 24_000;
  }

  beginCleanupComputer(
    computerId: string,
    generation: number,
  ): MigrationCleanupTransaction {
    requireComputerId(computerId);
    return this.store(`${this.computerPrefix}:${computerId}`).beginCleanup(
      generation,
    );
  }

  beginCleanupIdentities(generation: number): MigrationCleanupTransaction {
    return this.store(this.identityPrefix).beginCleanup(generation);
  }

  beginLoadComputer(computerId: string): MigrationLoadTransaction<unknown> {
    requireComputerId(computerId);
    return this.store(`${this.computerPrefix}:${computerId}`).beginLoad(
      isJsonValue,
    );
  }

  beginLoadIdentities(): MigrationLoadTransaction<unknown> {
    return this.store(this.identityPrefix).beginLoad(isJsonValue);
  }

  beginSaveComputer(
    snapshot: ComputerSnapshot,
    sourceGeneration: number,
  ): MigrationSaveTransaction {
    requireComputerId(snapshot.computerId);
    return this.store(
      `${this.computerPrefix}:${snapshot.computerId}`,
    ).beginSave(snapshot, sourceGeneration);
  }

  beginSaveIdentities(
    snapshot: ComputerIdentitySnapshot,
    sourceGeneration: number,
  ): MigrationSaveTransaction {
    return this.store(this.identityPrefix).beginSave(
      snapshot,
      sourceGeneration,
    );
  }

  private store(prefix: string): TransactionalPagedStore {
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
        keys: (prefixValue): readonly string[] => {
          if (this.owner.getDynamicPropertyIds === undefined) {
            throw new Error(
              "Storage migration cleanup requires Dynamic Property ID enumeration.",
            );
          }
          return this.owner
            .getDynamicPropertyIds()
            .filter((key) => key.startsWith(prefixValue));
        },
        set: (key, value): void => {
          this.owner.setDynamicProperty(key, value);
        },
      },
      prefix,
      this.pageCharacterLimit,
    );
  }
}

function isJsonValue(value: unknown): value is unknown {
  void value;
  return true;
}
