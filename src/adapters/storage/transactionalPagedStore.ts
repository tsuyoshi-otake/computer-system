export interface StringPropertyStore {
  delete(key: string): void;
  get(key: string): string | undefined;
  keys?(prefix: string): readonly string[];
  set(key: string, value: string): void;
}

interface LegacyGenerationManifest {
  readonly characterLength: number;
  readonly checksum: string;
  readonly generation: number;
  readonly pageCount: number;
  readonly schema: 1;
}

interface ContentAddressedGenerationManifest {
  readonly characterLength: number;
  readonly checksum: string;
  readonly generation: number;
  readonly pageCount: number;
  readonly pageIds: readonly string[];
  readonly schema: 2;
}

type GenerationManifest =
  LegacyGenerationManifest | ContentAddressedGenerationManifest;

export type PagedStorageFormat =
  "legacy_indexed_pages" | "content_addressed_blobs";

export interface PagedLoadResult<T> {
  readonly generation: number;
  readonly recovered: boolean;
  readonly sourceFormat: PagedStorageFormat;
  readonly value: T;
}

export type PagedLoadStage =
  | "head"
  | "manifest"
  | "pages"
  | "validate"
  | "complete"
  | "missing"
  | "failed";

export type PagedLoadStepResult<T> =
  | { readonly outcome: "pending"; readonly stage: PagedLoadStage }
  | { readonly outcome: "missing" }
  | ({ readonly outcome: "complete" } & PagedLoadResult<T>);

/** A read transaction advanced by a bounded number of property reads. */
export interface PagedLoadTransaction<T> {
  readonly stage: PagedLoadStage;
  step(maxOperations?: number): PagedLoadStepResult<T>;
}

export type PagedSaveStage =
  | "head"
  | "target_manifest"
  | "obsolete_manifest"
  | "previous_manifest"
  | "target_cleanup"
  | "manifest"
  | "pages"
  | "commit"
  | "obsolete_cleanup"
  | "complete";

export type PagedSaveStepResult =
  | { readonly outcome: "pending"; readonly stage: PagedSaveStage }
  | { readonly outcome: "complete"; readonly generation: number };

/** A single-generation transaction advanced by a bounded number of property operations. */
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
    if (
      !Number.isSafeInteger(pageCharacterLimit) ||
      pageCharacterLimit <= 0 ||
      pageCharacterLimit > maximumPropertyPageCharacterLength
    ) {
      throw new RangeError(
        `The page character limit must be an integer from 1 through ${String(maximumPropertyPageCharacterLength)}.`,
      );
    }

    this.#pageCharacterLimit = pageCharacterLimit;
    this.#prefix = prefix;
    this.#store = store;
  }

  public load<T>(
    isValue: (value: unknown) => value is T,
  ): PagedLoadResult<T> | undefined {
    const transaction = this.beginLoad(isValue);
    while (true) {
      const result = transaction.step(64);
      if (result.outcome === "missing") return undefined;
      if (result.outcome === "complete") {
        return {
          generation: result.generation,
          recovered: result.recovered,
          sourceFormat: result.sourceFormat,
          value: result.value,
        };
      }
    }
  }

  public beginLoad<T>(
    isValue: (value: unknown) => value is T,
  ): PagedLoadTransaction<T> {
    return new IncrementalPagedLoad(this.#store, this.#prefix, isValue);
  }

  public save(value: unknown): number {
    const transaction = this.beginSave(value);
    while (transaction.step(64).outcome !== "complete") {
      // Compatibility path for callers that explicitly request a synchronous save.
    }
    return transaction.generation;
  }

  public beginSave(
    value: unknown,
    sourceGeneration?: number,
  ): PagedSaveTransaction {
    if (
      sourceGeneration !== undefined &&
      (!Number.isSafeInteger(sourceGeneration) || sourceGeneration <= 0)
    ) {
      throw new RangeError("The source generation must be a positive integer.");
    }
    const json = JSON.stringify(value);
    if (json === undefined) {
      throw new TypeError("The supplied value is not JSON serializable.");
    }
    if (json.length > maximumSerializedCharacterLength) {
      throw new RangeError(
        "The supplied value exceeds the paged storage limit.",
      );
    }

    const pages = this.#splitPages(json);
    const pageIds = pages.map(pageBlobId);
    return new IncrementalPagedSave(
      this.#store,
      this.#prefix,
      pages,
      pageIds,
      json.length,
      checksum(json),
      sourceGeneration,
    );
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

class IncrementalPagedLoad<T> implements PagedLoadTransaction<T> {
  readonly #store: StringPropertyStore;
  readonly #prefix: string;
  readonly #isValue: (value: unknown) => value is T;
  #stage: PagedLoadStage = "head";
  #head = 0;
  #candidates: readonly number[] = [];
  #candidateIndex = 0;
  #manifest: GenerationManifest | undefined;
  #pageIndex = 0;
  #loadedCharacterLength = 0;
  #pages: string[] = [];
  readonly #errors: Error[] = [];
  #result: PagedLoadResult<T> | undefined;
  #terminalError: Error | undefined;

  constructor(
    store: StringPropertyStore,
    prefix: string,
    isValue: (value: unknown) => value is T,
  ) {
    this.#store = store;
    this.#prefix = prefix;
    this.#isValue = isValue;
  }

  get stage(): PagedLoadStage {
    return this.#stage;
  }

  step(maxOperations = 1): PagedLoadStepResult<T> {
    if (!Number.isSafeInteger(maxOperations) || maxOperations <= 0) {
      throw new RangeError("Paged load operations must be positive.");
    }
    const terminal = this.#terminalResult();
    if (terminal !== undefined) return terminal;

    let operations = 0;
    while (
      operations < maxOperations &&
      this.#stage !== "complete" &&
      this.#stage !== "missing" &&
      this.#stage !== "failed"
    ) {
      switch (this.#stage) {
        case "head": {
          const text = this.#store.get(this.headKey());
          operations += 1;
          if (text === undefined) {
            this.#stage = "missing";
            break;
          }
          try {
            this.#head = parseStorageHead(text, false);
          } catch (error: unknown) {
            this.#fail(toError(error));
          }
          this.#candidates =
            this.#head === 1 ? [this.#head] : [this.#head, this.#head - 1];
          this.#stage = "manifest";
          break;
        }
        case "manifest": {
          const generation = this.currentGeneration();
          const text = this.#store.get(this.manifestKey(generation));
          operations += 1;
          if (text === undefined) {
            this.#rejectGeneration(
              new Error(`Generation ${generation} has no manifest.`),
            );
            break;
          }
          let value: unknown;
          try {
            value = JSON.parse(text);
          } catch {
            this.#rejectGeneration(
              new Error(`Generation ${generation} has an invalid manifest.`),
            );
            break;
          }
          if (!isGenerationManifest(value, generation)) {
            this.#rejectGeneration(
              new Error(`Generation ${generation} has an invalid manifest.`),
            );
            break;
          }
          this.#manifest = value;
          this.#pageIndex = 0;
          this.#loadedCharacterLength = 0;
          this.#pages = [];
          this.#stage = "pages";
          break;
        }
        case "pages": {
          const generation = this.currentGeneration();
          const manifest = this.requireManifest();
          const pageIdentity =
            manifest.schema === 1
              ? String(this.#pageIndex)
              : manifest.pageIds[this.#pageIndex]!;
          const key =
            manifest.schema === 1
              ? this.pageKey(generation, this.#pageIndex)
              : this.blobKey(pageIdentity);
          const page = this.#store.get(key);
          operations += 1;
          if (page === undefined) {
            this.#rejectGeneration(
              new Error(
                `Generation ${generation} is missing page ${pageIdentity}.`,
              ),
            );
            break;
          }
          if (
            page.length > maximumPropertyPageCharacterLength ||
            this.#loadedCharacterLength + page.length > manifest.characterLength
          ) {
            this.#rejectGeneration(
              new Error(`Generation ${generation} has an invalid page size.`),
            );
            break;
          }
          if (manifest.schema === 2 && pageBlobId(page) !== pageIdentity) {
            this.#rejectGeneration(
              new Error(
                `Generation ${generation} has a corrupt page ${pageIdentity}.`,
              ),
            );
            break;
          }
          this.#pages.push(page);
          this.#loadedCharacterLength += page.length;
          this.#pageIndex += 1;
          if (this.#pageIndex >= manifest.pageCount) {
            this.#stage = "validate";
          }
          break;
        }
        case "validate": {
          const generation = this.currentGeneration();
          const manifest = this.requireManifest();
          const json = this.#pages.join("");
          if (
            json.length !== manifest.characterLength ||
            checksum(json) !== manifest.checksum
          ) {
            this.#rejectGeneration(
              new Error(`Generation ${generation} failed its integrity check.`),
            );
            break;
          }
          let value: unknown;
          try {
            value = JSON.parse(json);
          } catch {
            this.#rejectGeneration(
              new Error(`Generation ${generation} contains invalid JSON.`),
            );
            break;
          }
          if (!this.#isValue(value)) {
            this.#rejectGeneration(
              new Error(
                `Generation ${generation} contains an unexpected value.`,
              ),
            );
            break;
          }
          this.#result = {
            generation,
            recovered: generation !== this.#head,
            sourceFormat:
              manifest.schema === 1
                ? "legacy_indexed_pages"
                : "content_addressed_blobs",
            value,
          };
          this.#stage = "complete";
          break;
        }
      }
    }

    return this.#terminalResult() ?? { outcome: "pending", stage: this.#stage };
  }

  #terminalResult(): PagedLoadStepResult<T> | undefined {
    switch (this.#stage) {
      case "complete":
        return { outcome: "complete", ...this.requireResult() };
      case "missing":
        return { outcome: "missing" };
      case "failed":
        throw this.#terminalError ?? new Error("Paged load failed.");
      default:
        return undefined;
    }
  }

  #rejectGeneration(error: Error): void {
    this.#errors.push(error);
    if (this.#candidateIndex + 1 >= this.#candidates.length) {
      this.#fail(
        new AggregateError(
          this.#errors,
          "No complete storage generation could be loaded.",
        ),
      );
    }
    this.#candidateIndex += 1;
    this.#manifest = undefined;
    this.#pageIndex = 0;
    this.#loadedCharacterLength = 0;
    this.#pages = [];
    this.#stage = "manifest";
  }

  #fail(error: Error): never {
    this.#terminalError = error;
    this.#stage = "failed";
    throw error;
  }

  private currentGeneration(): number {
    const generation = this.#candidates[this.#candidateIndex];
    if (generation === undefined) {
      return this.#fail(new Error("Paged load has no generation candidate."));
    }
    return generation;
  }

  private requireManifest(): GenerationManifest {
    if (this.#manifest === undefined) {
      return this.#fail(new Error("Paged load has no active manifest."));
    }
    return this.#manifest;
  }

  private requireResult(): PagedLoadResult<T> {
    if (this.#result === undefined) {
      return this.#fail(new Error("Paged load completed without a result."));
    }
    return this.#result;
  }

  private headKey(): string {
    return `${this.#prefix}:head`;
  }

  private manifestKey(generation: number): string {
    return `${this.#prefix}:manifest:${String(generation)}`;
  }

  private pageKey(generation: number, index: number): string {
    return `${this.#prefix}:page:${String(generation)}:${String(index)}`;
  }

  private blobKey(pageId: string): string {
    return `${this.#prefix}:blob:${pageId}`;
  }
}

class IncrementalPagedSave implements PagedSaveTransaction {
  readonly #store: StringPropertyStore;
  readonly #prefix: string;
  readonly #pages: readonly string[];
  readonly #pageIds: readonly string[];
  readonly #characterLength: number;
  readonly #checksum: string;
  readonly #sourceGeneration: number | undefined;
  #stage: PagedSaveStage = "head";
  #generation: number | undefined;
  #manifest: ContentAddressedGenerationManifest | undefined;
  #targetCleanupIndex = 0;
  #targetManifestDeleted = false;
  #targetManifest: GenerationManifest | undefined;
  #pageIndex = 0;
  #pageNeedsWrite = false;
  #obsoleteCleanupIndex = 0;
  #obsoleteManifestDeleted = false;
  #targetLegacyPageCount = 0;
  #obsoleteGeneration = 0;
  #obsoleteManifest: GenerationManifest | undefined;
  #retainedPageIds: ReadonlySet<string> = new Set();

  constructor(
    store: StringPropertyStore,
    prefix: string,
    pages: readonly string[],
    pageIds: readonly string[],
    characterLength: number,
    checksumValue: string,
    sourceGeneration: number | undefined,
  ) {
    this.#store = store;
    this.#prefix = prefix;
    this.#pages = pages;
    this.#pageIds = pageIds;
    this.#characterLength = characterLength;
    this.#checksum = checksumValue;
    this.#sourceGeneration = sourceGeneration;
  }

  get generation(): number {
    if (this.#generation === undefined) {
      throw new Error(
        "Paged save generation is not available before the head is read.",
      );
    }
    return this.#generation;
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
        case "head": {
          const currentHeadText = this.#store.get(this.headKey());
          operations += 1;
          const currentHead =
            currentHeadText === undefined
              ? 0
              : parseStorageHead(currentHeadText, true);
          if (
            this.#sourceGeneration !== undefined &&
            currentHead !== this.#sourceGeneration &&
            currentHead !== this.#sourceGeneration + 1
          ) {
            throw new Error(
              "Paged storage changed after the source generation was loaded.",
            );
          }
          const generation =
            this.#sourceGeneration !== undefined &&
            currentHead === this.#sourceGeneration + 1
              ? currentHead
              : currentHead + 1;
          if (!Number.isSafeInteger(generation)) {
            throw new Error("The next storage generation is invalid.");
          }
          this.#generation = generation;
          this.#obsoleteGeneration = generation - 2;
          this.#manifest = {
            characterLength: this.#characterLength,
            checksum: this.#checksum,
            generation,
            pageCount: this.#pages.length,
            pageIds: this.#pageIds,
            schema: 2,
          };
          this.#stage = "target_manifest";
          break;
        }
        case "target_manifest": {
          const targetManifest = this.#readManifest(this.generation);
          operations += 1;
          this.#targetManifest = targetManifest;
          this.#targetLegacyPageCount =
            targetManifest?.schema === 1 ? targetManifest.pageCount : 0;
          this.#stage = "obsolete_manifest";
          break;
        }
        case "obsolete_manifest":
          if (this.#obsoleteGeneration > 0) {
            this.#obsoleteManifest = this.#readManifest(
              this.#obsoleteGeneration,
            );
            operations += 1;
          }
          this.#stage = "previous_manifest";
          break;
        case "previous_manifest": {
          const previousGeneration = this.generation - 1;
          const previousManifest =
            previousGeneration > 0
              ? this.#readManifest(previousGeneration)
              : undefined;
          if (previousGeneration > 0) operations += 1;
          const previousPageIds =
            previousManifest?.schema === 2 ? previousManifest.pageIds : [];
          this.#retainedPageIds = new Set([
            ...this.#pageIds,
            ...previousPageIds,
          ]);
          this.#stage = "target_cleanup";
          break;
        }
        case "target_cleanup":
          if (
            this.#targetManifest?.schema === 1 &&
            this.#targetCleanupIndex < this.#targetLegacyPageCount
          ) {
            this.#store.delete(
              this.pageKey(this.generation, this.#targetCleanupIndex++),
            );
            operations += 1;
          } else if (
            this.#targetManifest?.schema === 2 &&
            this.#targetCleanupIndex < this.#targetManifest.pageIds.length
          ) {
            const pageId =
              this.#targetManifest.pageIds[this.#targetCleanupIndex++]!;
            if (!this.#retainedPageIds.has(pageId)) {
              this.#store.delete(this.blobKey(pageId));
            }
            operations += 1;
          } else if (!this.#targetManifestDeleted) {
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
            JSON.stringify(this.requireManifest()),
          );
          this.#stage = "pages";
          operations += 1;
          break;
        case "pages":
          {
            const page = this.#pages[this.#pageIndex]!;
            const pageId = this.#pageIds[this.#pageIndex]!;
            const key = this.blobKey(pageId);
            if (this.#pageNeedsWrite) {
              this.#store.set(key, page);
              this.#pageNeedsWrite = false;
              this.#advancePage();
              operations += 1;
              break;
            }
            const existing = this.#store.get(key);
            operations += 1;
            if (existing === undefined) {
              this.#pageNeedsWrite = true;
              break;
            }
            if (existing !== page) {
              throw new Error(`Content-addressed page collision for ${pageId}`);
            }
            this.#advancePage();
          }
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
            this.#obsoleteManifest?.schema === 1 &&
            this.#obsoleteCleanupIndex < this.#obsoleteManifest.pageCount
          ) {
            this.#store.delete(
              this.pageKey(
                this.#obsoleteGeneration,
                this.#obsoleteCleanupIndex++,
              ),
            );
            operations += 1;
          } else if (
            this.#obsoleteManifest?.schema === 2 &&
            this.#obsoleteCleanupIndex < this.#obsoleteManifest.pageIds.length
          ) {
            const pageId =
              this.#obsoleteManifest.pageIds[this.#obsoleteCleanupIndex++]!;
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

  #advancePage(): void {
    this.#pageIndex += 1;
    if (this.#pageIndex >= this.#pages.length) this.#stage = "commit";
  }

  private requireManifest(): ContentAddressedGenerationManifest {
    if (this.#manifest === undefined) {
      throw new Error("Paged save manifest is not initialized.");
    }
    return this.#manifest;
  }

  private headKey(): string {
    return `${this.#prefix}:head`;
  }

  private manifestKey(generation: number): string {
    return `${this.#prefix}:manifest:${String(generation)}`;
  }

  private pageKey(generation: number, index: number): string {
    return `${this.#prefix}:page:${String(generation)}:${String(index)}`;
  }

  private blobKey(pageId: string): string {
    return `${this.#prefix}:blob:${pageId}`;
  }
}

const maximumPropertyPageCharacterLength = 32_767;
const maximumGenerationPageCount = 32_768;
const maximumSerializedCharacterLength = 512 * 1_048_576;

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

  const candidate = value as Record<string, unknown>;
  if (!hasValidManifestCommonFields(candidate, expectedGeneration)) {
    return false;
  }

  if (candidate.schema === 1) {
    return hasOnlyKeys(candidate, [
      "characterLength",
      "checksum",
      "generation",
      "pageCount",
      "schema",
    ]);
  }
  if (candidate.schema !== 2) return false;
  return (
    hasOnlyKeys(candidate, [
      "characterLength",
      "checksum",
      "generation",
      "pageCount",
      "pageIds",
      "schema",
    ]) &&
    Array.isArray(candidate.pageIds) &&
    candidate.pageIds.length === candidate.pageCount &&
    candidate.pageIds.every(
      (pageId) =>
        typeof pageId === "string" &&
        /^[0-9a-z]{1,10}-[0-9a-f]{8}$/u.test(pageId),
    )
  );
}

function hasValidManifestCommonFields(
  candidate: Readonly<Record<string, unknown>>,
  expectedGeneration: number,
): boolean {
  if (
    candidate.generation !== expectedGeneration ||
    typeof candidate.pageCount !== "number" ||
    !Number.isSafeInteger(candidate.pageCount) ||
    candidate.pageCount <= 0 ||
    candidate.pageCount > maximumGenerationPageCount ||
    typeof candidate.characterLength !== "number" ||
    !Number.isSafeInteger(candidate.characterLength) ||
    candidate.characterLength < 0 ||
    candidate.characterLength > maximumSerializedCharacterLength ||
    candidate.pageCount > Math.max(1, candidate.characterLength) ||
    candidate.characterLength >
      candidate.pageCount * maximumPropertyPageCharacterLength ||
    typeof candidate.checksum !== "string" ||
    !/^[0-9a-f]{8}$/u.test(candidate.checksum)
  ) {
    return false;
  }
  return true;
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return (
    keys.length === allowedKeys.length &&
    keys.every((key) => allowedKeys.includes(key))
  );
}

function parseStorageHead(value: string, allowZero: boolean): number {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new Error("The storage head is invalid.");
  }
  const head = Number(value);
  if (!Number.isSafeInteger(head) || head < (allowZero ? 0 : 1)) {
    throw new Error("The storage head is invalid.");
  }
  return head;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
