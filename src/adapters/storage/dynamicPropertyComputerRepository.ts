import type { ComputerSnapshotRepository } from "../../application/computer/persistence.js";
import type { ComputerSnapshot } from "../../domain/computer/computer.js";
import { requireComputerId } from "../../domain/computer/identity.js";
import { TransactionalPagedStore } from "./transactionalPagedStore.js";

export interface DynamicPropertyOwner {
  getDynamicProperty(identifier: string): unknown;
  setDynamicProperty(identifier: string, value: string): void;
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

  private store(computerId: string): TransactionalPagedStore {
    requireComputerId(computerId);
    return new TransactionalPagedStore(
      {
        get: (key): string | undefined => {
          const value = this.owner.getDynamicProperty(key);
          if (value === undefined) return undefined;
          if (typeof value !== "string") {
            throw new TypeError(`Dynamic property ${key} is not a string.`);
          }
          return value;
        },
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
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ComputerSnapshot>;
  return (
    candidate.schema === 1 &&
    typeof candidate.computerId === "string" &&
    (candidate.family === "standard" || candidate.family === "advanced") &&
    (candidate.label === undefined || typeof candidate.label === "string") &&
    typeof candidate.filesystem === "object" &&
    candidate.filesystem !== null &&
    typeof candidate.terminal === "object" &&
    candidate.terminal !== null &&
    typeof candidate.redstoneOutputMask === "number"
  );
}
