export interface StringPropertyStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

interface GenerationManifest {
  readonly characterLength: number;
  readonly checksum: string;
  readonly generation: number;
  readonly pageCount: number;
  readonly schema: 1;
}

export interface PagedLoadResult<T> {
  readonly generation: number;
  readonly recovered: boolean;
  readonly value: T;
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
    const manifest: GenerationManifest = {
      characterLength: json.length,
      checksum: checksum(json),
      generation,
      pageCount: pages.length,
      schema: 1,
    };

    for (const [index, page] of pages.entries()) {
      this.#store.set(this.#pageKey(generation, index), page);
    }
    this.#store.set(this.#manifestKey(generation), JSON.stringify(manifest));
    this.#store.set(this.#headKey(), String(generation));

    return generation;
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
    for (let index = 0; index < manifestValue.pageCount; index += 1) {
      const page = this.#store.get(this.#pageKey(generation, index));
      if (page === undefined) {
        throw new Error(`Generation ${generation} is missing page ${index}.`);
      }
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

  #pageKey(generation: number, index: number): string {
    return `${this.#prefix}:page:${generation}:${index}`;
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

function checksum(value: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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
    candidate.schema === 1 &&
    candidate.generation === expectedGeneration &&
    Number.isSafeInteger(candidate.pageCount) &&
    (candidate.pageCount ?? 0) > 0 &&
    Number.isSafeInteger(candidate.characterLength) &&
    (candidate.characterLength ?? -1) >= 0 &&
    typeof candidate.checksum === "string"
  );
}
