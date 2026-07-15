import type { ComputerSnapshotRepository } from "../../application/computer/persistence.js";
import type { ComputerSnapshot } from "../../domain/computer/computer.js";
import { requireComputerId } from "../../domain/computer/identity.js";
import { isCpuModel } from "../../domain/cpu/models.js";
import { isDisplayProfileId } from "../../domain/display/displayProfile.js";
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
    typeof candidate.redstoneOutputMask === "number" &&
    (candidate.hardware === undefined ||
      (typeof candidate.hardware === "object" &&
        candidate.hardware !== null &&
        Number.isSafeInteger(candidate.hardware.clockHz) &&
        (candidate.hardware.cpuModel === undefined ||
          isCpuModel(candidate.hardware.cpuModel)) &&
        Number.isSafeInteger(candidate.hardware.memoryBytes))) &&
    (candidate.osProfile === undefined ||
      candidate.osProfile === "linux" ||
      candidate.osProfile === "dos") &&
    (candidate.displayProfileId === undefined ||
      isDisplayProfileId(candidate.displayProfileId))
  );
}
