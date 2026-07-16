import {
  isFloppyMediaCatalogSnapshot,
  type FloppyMediaCatalogSnapshot,
  type FloppyMediaRepository,
} from "../../application/computer/floppyMediaService.js";
import {
  isFloppyMediaSnapshot,
  requireMediaId,
  type FloppyMediaSnapshot,
} from "../../domain/storage/floppyMedia.js";
import type { DynamicPropertyOwner } from "./dynamicPropertyComputerRepository.js";
import { TransactionalPagedStore } from "./transactionalPagedStore.js";

export class DynamicPropertyFloppyRepository implements FloppyMediaRepository {
  private readonly catalog: TransactionalPagedStore;

  constructor(
    private readonly owner: DynamicPropertyOwner,
    private readonly pageCharacterLimit = 24_000,
    private readonly prefix = "computer_system:floppy",
  ) {
    this.catalog = this.store("catalog");
  }

  load(mediaId: string): FloppyMediaSnapshot | undefined {
    requireMediaId(mediaId);
    return this.store(mediaId).load(isFloppyMediaSnapshot)?.value;
  }

  loadCatalog(): FloppyMediaCatalogSnapshot | undefined {
    return this.catalog.load(isFloppyMediaCatalogSnapshot)?.value;
  }

  save(snapshot: FloppyMediaSnapshot): number {
    requireMediaId(snapshot.mediaId);
    return this.store(snapshot.mediaId).save(snapshot);
  }

  saveCatalog(snapshot: FloppyMediaCatalogSnapshot): number {
    if (!isFloppyMediaCatalogSnapshot(snapshot))
      throw new TypeError("Invalid Floppy media catalog");
    return this.catalog.save(snapshot);
  }

  private store(id: string): TransactionalPagedStore {
    return new TransactionalPagedStore(
      {
        delete: (key): void => this.owner.setDynamicProperty(key, undefined),
        get: (key): string | undefined => {
          const value = this.owner.getDynamicProperty(key);
          if (value === undefined) return undefined;
          if (typeof value !== "string")
            throw new TypeError(`${key} is not a string`);
          return value;
        },
        keys: (prefix): readonly string[] =>
          this.owner
            .getDynamicPropertyIds?.()
            .filter((key) => key.startsWith(prefix)) ?? [],
        set: (key, value): void => this.owner.setDynamicProperty(key, value),
      },
      `${this.prefix}:${id}`,
      this.pageCharacterLimit,
    );
  }
}
