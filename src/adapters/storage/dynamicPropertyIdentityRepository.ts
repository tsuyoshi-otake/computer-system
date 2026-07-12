import type {
  ComputerIdentityRepository,
  ComputerIdentitySnapshot,
} from "../../application/computer/identityPersistence.js";
import type { DynamicPropertyOwner } from "./dynamicPropertyComputerRepository.js";
import { TransactionalPagedStore } from "./transactionalPagedStore.js";

export class DynamicPropertyIdentityRepository implements ComputerIdentityRepository {
  private readonly store: TransactionalPagedStore;

  constructor(owner: DynamicPropertyOwner, pageCharacterLimit = 24_000) {
    this.store = new TransactionalPagedStore(
      {
        get: (key): string | undefined => {
          const value = owner.getDynamicProperty(key);
          if (value === undefined) return undefined;
          if (typeof value !== "string")
            throw new TypeError(`${key} is not a string`);
          return value;
        },
        set: (key, value): void => owner.setDynamicProperty(key, value),
      },
      "computer_system:identities",
      pageCharacterLimit,
    );
  }

  load(): ComputerIdentitySnapshot | undefined {
    return this.store.load(isIdentitySnapshot)?.value;
  }

  save(snapshot: ComputerIdentitySnapshot): number {
    return this.store.save(snapshot);
  }
}

function isIdentitySnapshot(value: unknown): value is ComputerIdentitySnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ComputerIdentitySnapshot>;
  return (
    candidate.schema === 1 &&
    Number.isSafeInteger(candidate.nextId) &&
    (candidate.nextId ?? 0) > 0 &&
    Array.isArray(candidate.observations)
  );
}
