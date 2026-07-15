export interface StringPropertyStore {
  delete(key: string): void;
  get(key: string): string | undefined;
  keys?(prefix: string): readonly string[];
  set(key: string, value: string): void;
}

interface GenerationManifest {
  readonly characterLength: number;
  readonly checksum: string;
  readonly generation: number;
  readonly pageCount: number;
  readonly pageIds: readonly string[];
  readonly schema: 2;
}

export interface PagedLoadResult<T> {
  readonly generation: number;
  readonly recovered: boolean;
  readonly value: T;
}

export type PagedSaveStage =
  | "target_cleanup"
  | "manifest"
  | "pages"
  | "commit"
  | "obsolete_cleanup"
  | "complete";

export type PagedSaveStepResult =
  | { readonly outcome: "pending"; readonly stage: PagedSaveStage }
  | { readonly outcome: "complete"; readonly generation: number };

/** A single-generation transaction advanced by a bounded number of writes. */
export interface PagedSaveTransaction {
  readonly generation: number;
  readonly stage: PagedSaveStage;
  step(maxOperations?: number): PagedSaveStepResult;
}

export class TransactionalPagedStore {
  readonly #pageCharacterLimit: number;
  readonly #prefix: string;
  readonly #store: StringPropertyStore;

  public constructor(
    store: StringPropertyStore,
    prefix: string,
    pageCharacterLimit = 24_000,
  ) {
    if (prefix.length === 0) {
      throw new Error("A storage prefix is required.");
    }
    if (pageCharacterLimit <= 0) {
      throw new RangeError("The page character limit must be positive.");
    }

    this.#pageCharacterLimit = pageCharacterLimit;
    this.#prefix = prefix;
    this.#store = store;
  }

  public load<T>(
    isValue: (value: unknown) => value is T,
  ): PagedLoadResult<T> | undefined {
    const headText = this.#store.get(this.#headKey());
    if (headText === undefined) {
      return undefined;
    }

    const head = Number.parseInt(headText, 10);
    if (!Number.isSafeInteger(head) || head <= 0) {
      throw new Error("The storage head is invalid.");
    }

    const candidates = head === 1 ? [head] : [head, head - 1];
    const errors: Error[] = [];

    for (const generation of candidates) {
      try {
        const value = this.#loadGeneration(generation, isValue);
        return { generation, recovered: generation !== head, value };
      } catch (error: unknown) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    throw new AggregateError(
      errors,
      "No complete storage generation could be loaded.",
    );
  }

  public save(value: unknown): number {
    const transaction = this.beginSave(value);
    while (transaction.step(64).outcome !== "complete") {
      // Compatibility path for callers that explicitly request a synchronous save.
    }
    return transaction.generation;
  }

  public beginSave(value: unknown): PagedSaveTransaction {
    const currentHeadText = this.#store.get(this.#headKey());
    const currentHead =
      currentHeadText === undefined ? 0 : Number.parseInt(currentHeadText, 10);
    if (!Number.isSafeInteger(currentHead) || currentHead < 0) {
      throw new Error("The storage head is invalid.");
    }

    const generation = currentHead + 1;
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new TypeError("The supplied value is not JSON serializable.");
    }

    const pages = this.#splitPages(json);
    const pageIds = pages.map(pageBlobId);
    const manifest: GenerationManifest = {
      characterLength: json.length,
      checksum: checksum(json),
      generation,
      pageCount: pages.length,
      pageIds,
      schema: 2,
    };

    return new IncrementalPagedSave(
      this.#store,
      this.#prefix,
      generation,
      pages,
      pageIds,
      manifest,
    );
  }

  #headKey(): string {
    return `${this.#prefix}:head`;
  }

  #loadGeneration<T>(
    generation: number,
    isValue: (value: unknown) => value is T,
  ): T {
    const manifestText = this.#store.get(this.#manifestKey(generation));
    if (manifestText === undefined) {
      throw new Error(`Generation ${generation} has no manifest.`);
    }

    const manifestValue: unknown = JSON.parse(manifestText);
    if (!isGenerationManifest(manifestValue, generation)) {
      throw new Error(`Generation ${generation} has an invalid manifest.`);
    }

    const pages: string[] = [];
    for (const pageId of manifestValue.pageIds) {
      const page = this.#store.get(this.#blobKey(pageId));
      if (page === undefined) {
        throw new Error(`Generation ${generation} is missing page ${pageId}.`);
      }
      if (pageBlobId(page) !== pageId)
        throw new Error(
          `Generation ${generation} has a corrupt page ${pageId}.`,
        );
      pages.push(page);
    }

    const json = pages.join("");
    if (
      json.length !== manifestValue.characterLength ||
      checksum(json) !== manifestValue.checksum
    ) {
      throw new Error(`Generation ${generation} failed its integrity check.`);
    }

    const value: unknown = JSON.parse(json);
    if (!isValue(value)) {
      throw new Error(`Generation ${generation} contains an unexpected value.`);
    }
    return value;
  }

  #manifestKey(generation: number): string {
    return `${this.#prefix}:manifest:${generation}`;
  }

  #blobKey(pageId: string): string {
    return `${this.#prefix}:blob:${pageId}`;
  }

  #splitPages(value: string): string[] {
    if (value.length === 0) {
      return [""];
    }

    const pages: string[] = [];
    for (
      let offset = 0;
      offset < value.length;
      offset += this.#pageCharacterLimit
    ) {
      pages.push(value.slice(offset, offset + this.#pageCharacterLimit));
    }
    return pages;
  }
}

class IncrementalPagedSave implements PagedSaveTransaction {
  readonly #store: StringPropertyStore;
  readonly #prefix: string;
  readonly #pages: readonly string[];
  readonly #pageIds: readonly string[];
  readonly #manifest: GenerationManifest;
  #stage: PagedSaveStage = "target_cleanup";
  #targetManifestDeleted = false;
  #pageIndex = 0;
  #obsoleteCleanupIndex = 0;
  #obsoleteManifestDeleted = false;
  readonly #obsoleteGeneration: number;
  readonly #obsoletePageIds: readonly string[];
  readonly #retainedPageIds: ReadonlySet<string>;

  constructor(
    store: StringPropertyStore,
    prefix: string,
    readonly generation: number,
    pages: readonly string[],
    pageIds: readonly string[],
    manifest: GenerationManifest,
  ) {
    this.#store = store;
    this.#prefix = prefix;
    this.#pages = pages;
    this.#pageIds = pageIds;
    this.#manifest = manifest;
    this.#obsoleteGeneration = generation - 2;
    this.#obsoletePageIds =
      this.#obsoleteGeneration > 0
        ? (this.#readManifest(this.#obsoleteGeneration)?.pageIds ?? [])
        : [];
    const previousPageIds = this.#readManifest(generation - 1)?.pageIds ?? [];
    this.#retainedPageIds = new Set([...pageIds, ...previousPageIds]);
  }

  get stage(): PagedSaveStage {
    return this.#stage;
  }

  step(maxOperations = 1): PagedSaveStepResult {
    if (!Number.isSafeInteger(maxOperations) || maxOperations <= 0) {
      throw new RangeError("Paged save operations must be positive.");
    }
    let operations = 0;
    while (operations < maxOperations && this.#stage !== "complete") {
      switch (this.#stage) {
        case "target_cleanup":
          if (!this.#targetManifestDeleted) {
            this.#store.delete(this.manifestKey(this.generation));
            this.#targetManifestDeleted = true;
            operations += 1;
          } else {
            this.#stage = "manifest";
          }
          break;
        case "manifest":
          this.#store.set(
            this.manifestKey(this.generation),
            JSON.stringify(this.#manifest),
          );
          this.#stage = "pages";
          operations += 1;
          break;
        case "pages":
          {
            const page = this.#pages[this.#pageIndex]!;
            const pageId = this.#pageIds[this.#pageIndex]!;
            const key = this.blobKey(pageId);
            const existing = this.#store.get(key);
            if (existing === undefined) this.#store.set(key, page);
            else if (existing !== page)
              throw new Error(`Content-addressed page collision for ${pageId}`);
          }
          this.#pageIndex += 1;
          if (this.#pageIndex >= this.#pages.length) this.#stage = "commit";
          operations += 1;
          break;
        case "commit":
          this.#store.set(this.headKey(), String(this.generation));
          this.#stage = "obsolete_cleanup";
          operations += 1;
          break;
        case "obsolete_cleanup":
          if (this.#obsoleteGeneration <= 0) {
            this.#stage = "complete";
          } else if (
            this.#obsoleteCleanupIndex < this.#obsoletePageIds.length
          ) {
            const pageId = this.#obsoletePageIds[this.#obsoleteCleanupIndex++]!;
            if (!this.#retainedPageIds.has(pageId)) {
              this.#store.delete(this.blobKey(pageId));
            }
            operations += 1;
          } else if (!this.#obsoleteManifestDeleted) {
            this.#store.delete(this.manifestKey(this.#obsoleteGeneration));
            this.#obsoleteManifestDeleted = true;
            operations += 1;
          } else {
            this.#stage = "complete";
          }
          break;
      }
    }
    return this.#stage === "complete"
      ? { outcome: "complete", generation: this.generation }
      : { outcome: "pending", stage: this.#stage };
  }

  #readManifest(generation: number): GenerationManifest | undefined {
    const text = this.#store.get(this.manifestKey(generation));
    if (text === undefined) return undefined;
    try {
      const value: unknown = JSON.parse(text);
      return isGenerationManifest(value, generation) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  private headKey(): string {
    return `${this.#prefix}:head`;
  }

  private manifestKey(generation: number): string {
    return `${this.#prefix}:manifest:${String(generation)}`;
  }

  private blobKey(pageId: string): string {
    return `${this.#prefix}:blob:${pageId}`;
  }
}

function checksum(value: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function pageBlobId(value: string): string {
  return `${value.length.toString(36)}-${checksum(value)}`;
}

function isGenerationManifest(
  value: unknown,
  expectedGeneration: number,
): value is GenerationManifest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<GenerationManifest>;
  return (
    candidate.schema === 2 &&
    candidate.generation === expectedGeneration &&
    Number.isSafeInteger(candidate.pageCount) &&
    (candidate.pageCount ?? 0) > 0 &&
    Array.isArray(candidate.pageIds) &&
    candidate.pageIds.length === candidate.pageCount &&
    candidate.pageIds.every(
      (pageId) =>
        typeof pageId === "string" && /^[0-9a-z]+-[0-9a-f]{8}$/u.test(pageId),
    ) &&
    Number.isSafeInteger(candidate.characterLength) &&
    (candidate.characterLength ?? -1) >= 0 &&
    typeof candidate.checksum === "string"
  );
}
