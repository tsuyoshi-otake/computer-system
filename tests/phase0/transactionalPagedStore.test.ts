import { describe, expect, it } from "vitest";

import {
  TransactionalPagedStore,
  type StringPropertyStore,
} from "../../src/phase0/transactionalPagedStore.js";

interface SavedDocument {
  readonly body: string;
  readonly version: number;
}

interface TestManifest {
  readonly pageIds: readonly string[];
}

class MemoryPropertyStore implements StringPropertyStore {
  readonly values = new Map<string, string>();
  failOnWrite: number | undefined;
  keyScans = 0;
  reads = 0;
  writes = 0;
  readonly deleteKeys: string[] = [];
  readonly readKeys: string[] = [];
  readonly writeKeys: string[] = [];

  public get(key: string): string | undefined {
    this.reads += 1;
    this.readKeys.push(key);
    return this.values.get(key);
  }

  public keys(prefix: string): readonly string[] {
    this.keyScans += 1;
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  public delete(key: string): void {
    this.deleteKeys.push(key);
    this.values.delete(key);
  }

  public set(key: string, value: string): void {
    this.writes += 1;
    this.writeKeys.push(key);
    if (this.writes === this.failOnWrite) {
      throw new Error("Injected write failure.");
    }
    this.values.set(key, value);
  }
}

function legacyChecksum(value: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function writeLegacyGeneration(
  properties: MemoryPropertyStore,
  prefix: string,
  generation: number,
  value: unknown,
  pageCharacterLimit: number,
): void {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("Invalid legacy test value.");
  const pages: string[] = [];
  for (let offset = 0; offset < json.length; offset += pageCharacterLimit) {
    pages.push(json.slice(offset, offset + pageCharacterLimit));
  }
  properties.values.set(
    `${prefix}:manifest:${String(generation)}`,
    JSON.stringify({
      characterLength: json.length,
      checksum: legacyChecksum(json),
      generation,
      pageCount: pages.length,
      schema: 1,
    }),
  );
  for (const [index, page] of pages.entries()) {
    properties.values.set(
      `${prefix}:page:${String(generation)}:${String(index)}`,
      page,
    );
  }
}

function isSavedDocument(value: unknown): value is SavedDocument {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SavedDocument>;
  return (
    typeof candidate.body === "string" && typeof candidate.version === "number"
  );
}

function manifestAt(
  properties: MemoryPropertyStore,
  key: string,
): TestManifest {
  const value: unknown = JSON.parse(properties.values.get(key) ?? "{}");
  if (
    typeof value !== "object" ||
    value === null ||
    !("pageIds" in value) ||
    !Array.isArray(value.pageIds) ||
    value.pageIds.some((pageId) => typeof pageId !== "string")
  ) {
    throw new Error(`Invalid test manifest ${key}`);
  }
  return { pageIds: value.pageIds };
}

describe("TransactionalPagedStore", () => {
  it("round-trips a value split across several pages", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:7", 8);
    const document = { body: "abcdefghijklmnopqrstuvwxyz", version: 1 };

    expect(store.save(document)).toBe(1);
    expect(store.load(isSavedDocument)).toEqual({
      generation: 1,
      recovered: false,
      sourceFormat: "content_addressed_blobs",
      value: document,
    });
    expect(
      [...properties.values.keys()].filter((key) => key.includes(":blob:"))
        .length,
    ).toBeGreaterThan(1);
  });

  it("enforces the generation page limit before a save can mutate storage", () => {
    const maximumPageCount = 32_768;
    const serializedOverhead = JSON.stringify({ body: "", version: 1 }).length;
    const atCapacity = {
      body: "x".repeat(maximumPageCount - serializedOverhead),
      version: 1,
    };
    const overCapacity = {
      body: `${atCapacity.body}x`,
      version: 1,
    };
    const rejectedProperties = new MemoryPropertyStore();
    const rejectedStore = new TransactionalPagedStore(
      rejectedProperties,
      "computer:page-capacity-plus-one",
      1,
    );
    expect(() => rejectedStore.beginSave(overCapacity)).toThrow(
      "generation page limit",
    );
    expect(rejectedProperties.values.size).toBe(0);
    expect(propertyOperations(rejectedProperties)).toBe(0);

    const capacityProperties = new MemoryPropertyStore();
    const capacityStore = new TransactionalPagedStore(
      capacityProperties,
      "computer:page-capacity",
      1,
    );
    const capacitySave = capacityStore.beginSave(atCapacity);
    expect(() => capacitySave.step(1)).toThrow("generation manifest limit");
    expect(capacityProperties.values.size).toBe(0);
    expect(capacityProperties.writes).toBe(0);
    expect(capacityProperties.deleteKeys).toEqual([]);
    expect(capacityProperties.reads).toBe(1);
  });

  it("enforces the manifest property limit symmetrically", () => {
    const maximumPropertyLength = 32_767;
    const acceptsBodyLength = (bodyLength: number): boolean => {
      const properties = new MemoryPropertyStore();
      const transaction = new TransactionalPagedStore(
        properties,
        `computer:manifest-probe-${String(bodyLength)}`,
        1,
      ).beginSave({ body: "x".repeat(bodyLength), version: 1 });
      try {
        transaction.step(1);
        return true;
      } catch (error: unknown) {
        if (
          error instanceof RangeError &&
          error.message.includes("generation manifest limit")
        ) {
          return false;
        }
        throw error;
      }
    };
    let acceptedBodyLength = 0;
    let rejectedBodyLength = 4_096;
    expect(acceptsBodyLength(acceptedBodyLength)).toBe(true);
    expect(acceptsBodyLength(rejectedBodyLength)).toBe(false);
    while (rejectedBodyLength - acceptedBodyLength > 1) {
      const candidate = Math.floor(
        (acceptedBodyLength + rejectedBodyLength) / 2,
      );
      if (acceptsBodyLength(candidate)) acceptedBodyLength = candidate;
      else rejectedBodyLength = candidate;
    }

    const accepted = { body: "x".repeat(acceptedBodyLength), version: 1 };
    const properties = new MemoryPropertyStore();
    const prefix = "computer:manifest-capacity";
    const store = new TransactionalPagedStore(properties, prefix, 1);
    expect(store.save(accepted)).toBe(1);
    const manifestKey = `${prefix}:manifest:1`;
    const manifest = properties.values.get(manifestKey)!;
    expect(manifest.length).toBeLessThanOrEqual(maximumPropertyLength);
    expect(store.load(isSavedDocument)?.value).toEqual(accepted);

    const rejectedProperties = new MemoryPropertyStore();
    const rejected = new TransactionalPagedStore(
      rejectedProperties,
      "computer:manifest-capacity-plus-one",
      1,
    ).beginSave({ body: "x".repeat(rejectedBodyLength), version: 1 });
    expect(() => rejected.step(1)).toThrow("generation manifest limit");
    expect(rejectedProperties.values.size).toBe(0);
    expect(rejectedProperties.writes).toBe(0);
    expect(rejectedProperties.deleteKeys).toEqual([]);

    properties.values.set(
      manifestKey,
      manifest.padEnd(maximumPropertyLength + 1, " "),
    );
    expect(() => store.load(isSavedDocument)).toThrow(
      "No complete storage generation could be loaded.",
    );
  });

  it("reuses unchanged content-addressed pages across generations", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:reuse", 8);
    const document = { body: "same pages remain shared", version: 1 };
    store.save(document);
    const firstBlobWrites = properties.writeKeys.filter((key) =>
      key.includes(":blob:"),
    ).length;

    store.save(document);
    const allBlobWrites = properties.writeKeys.filter((key) =>
      key.includes(":blob:"),
    ).length;
    expect(allBlobWrites).toBe(firstBlobWrites);
    expect(store.load(isSavedDocument)?.value).toEqual(document);
  });

  it("does not enumerate all property keys during ordinary saves", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(
      properties,
      "computer:ordinary-save",
      8,
    );

    store.save({ body: "ordinary generation one", version: 1 });
    store.save({ body: "ordinary generation two", version: 2 });

    expect(properties.keyScans).toBe(0);
    expect(store.load(isSavedDocument)?.value.version).toBe(2);
  });

  it("keeps the previous generation readable when a staged write fails", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:8", 12);
    const original = { body: "stable", version: 1 };
    store.save(original);

    properties.failOnWrite = properties.writes + 2;
    expect(() =>
      store.save({ body: "replacement that spans pages", version: 2 }),
    ).toThrow("Injected write failure.");
    expect(store.load(isSavedDocument)).toEqual({
      generation: 1,
      recovered: false,
      sourceFormat: "content_addressed_blobs",
      value: original,
    });
  });

  it("falls back to the previous generation when the current page is corrupt", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:9", 32);
    const original = { body: "first", version: 1 };
    store.save(original);
    store.save({ body: "second", version: 2 });

    const manifest = manifestAt(properties, "computer:9:manifest:2");
    properties.values.set(
      `computer:9:blob:${String(manifest.pageIds[0])}`,
      "corrupt",
    );
    expect(store.load(isSavedDocument)).toEqual({
      generation: 1,
      recovered: true,
      sourceFormat: "content_addressed_blobs",
      value: original,
    });
  });

  it("retains only the current and previous complete generations", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:10", 8);

    for (let version = 1; version <= 5; version += 1) {
      store.save({ body: `version-${version}`.repeat(3), version });
    }

    const generationManifests = [...properties.values.keys()].filter((key) =>
      key.includes(":manifest:"),
    );
    expect(generationManifests).toEqual([
      "computer:10:manifest:4",
      "computer:10:manifest:5",
    ]);
    const retainedPageIds = new Set(
      generationManifests.flatMap((key) => manifestAt(properties, key).pageIds),
    );
    const blobIds = [...properties.values.keys()]
      .filter((key) => key.includes(":blob:"))
      .map((key) => key.slice(key.lastIndexOf(":") + 1));
    expect(new Set(blobIds)).toEqual(retainedPageIds);
  });

  it("advances an incremental save by at most one property write per step", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:11", 8);
    const original = { body: "stable", version: 1 };
    store.save(original);
    const transaction = store.beginSave({
      body: "replacement that spans several property pages",
      version: 2,
    });
    let steps = 0;
    while (true) {
      const writesBefore = properties.writes;
      const headBefore = properties.values.get("computer:11:head");
      const result = transaction.step();
      expect(properties.writes - writesBefore).toBeLessThanOrEqual(1);
      steps += 1;
      if (
        headBefore === "1" &&
        properties.values.get("computer:11:head") === "1"
      ) {
        expect(store.load(isSavedDocument)?.value).toEqual(original);
      }
      if (result.outcome === "complete") break;
    }
    expect(steps).toBeGreaterThan(4);
    expect(store.load(isSavedDocument)?.value.version).toBe(2);
  });

  it("replaces a corrupt head after fallback without deleting the last good generation", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:recovered-save";
    const store = new TransactionalPagedStore(properties, prefix, 1_024);
    const original = { body: "last known good", version: 1 };
    store.save(original);
    store.save({ body: "corrupt current generation", version: 2 });
    const corruptManifest = manifestAt(properties, `${prefix}:manifest:2`);
    properties.values.set(
      `${prefix}:blob:${String(corruptManifest.pageIds[0])}`,
      "corrupt",
    );

    const recovered = store.load(isSavedDocument)!;
    expect(recovered).toMatchObject({ generation: 1, recovered: true });
    const transaction = store.beginSave(
      { body: "replacement current generation", version: 3 },
      recovered.generation,
    );
    while (transaction.step(1).outcome !== "complete") {
      // Exercise the same bounded path used by startup migration.
    }

    expect(properties.values.get(`${prefix}:head`)).toBe("2");
    expect(store.load(isSavedDocument)).toMatchObject({
      generation: 2,
      recovered: false,
      value: { version: 3 },
    });
    const replacementManifest = manifestAt(properties, `${prefix}:manifest:2`);
    properties.values.set(
      `${prefix}:blob:${String(replacementManifest.pageIds[0])}`,
      "corrupt again",
    );
    expect(store.load(isSavedDocument)).toEqual({
      generation: 1,
      recovered: true,
      sourceFormat: "content_addressed_blobs",
      value: original,
    });
  });

  it("sweeps more than eighty target-only blobs after repairing a corrupt manifest", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:recovered-orphans";
    const store = new TransactionalPagedStore(properties, prefix, 8);
    const original = { body: "stable fallback", version: 1 };
    store.save(original);
    const previousManifest = manifestAt(properties, `${prefix}:manifest:1`);
    store.save({ body: uniquePagedBody(180), version: 2 });
    const corruptTargetManifest = manifestAt(
      properties,
      `${prefix}:manifest:2`,
    );
    const previousPageIds = new Set(previousManifest.pageIds);
    const targetOnlyPageIds = [
      ...new Set(
        corruptTargetManifest.pageIds.filter(
          (pageId) => !previousPageIds.has(pageId),
        ),
      ),
    ];
    expect(targetOnlyPageIds.length).toBeGreaterThan(80);
    properties.values.set(`${prefix}:manifest:2`, "corrupt");
    properties.values.set(`${prefix}:manifest:77`, "abandoned staged manifest");

    const recovered = store.load(isSavedDocument)!;
    expect(recovered).toMatchObject({ generation: 1, recovered: true });
    properties.reads = 0;
    properties.writes = 0;
    properties.deleteKeys.length = 0;
    const repair = store.beginSave(recovered.value, recovered.generation);
    runBoundedMutation(repair, properties);

    expect(properties.values.get(`${prefix}:head`)).toBe("2");
    expect(store.load(isSavedDocument)).toEqual({
      generation: 2,
      recovered: false,
      sourceFormat: "content_addressed_blobs",
      value: original,
    });
    for (const pageId of targetOnlyPageIds) {
      expect(properties.values.has(`${prefix}:blob:${pageId}`)).toBe(false);
    }
    expect(properties.values.has(`${prefix}:manifest:77`)).toBe(false);
    const retainedPageIds = new Set([
      ...manifestAt(properties, `${prefix}:manifest:1`).pageIds,
      ...manifestAt(properties, `${prefix}:manifest:2`).pageIds,
    ]);
    for (const pageId of retainedPageIds) {
      expect(properties.values.has(`${prefix}:blob:${pageId}`)).toBe(true);
    }

    const mutationsBefore = properties.writes + properties.deleteKeys.length;
    runBoundedMutation(store.beginCleanup(2), properties);
    expect(properties.writes + properties.deleteKeys.length).toBe(
      mutationsBefore,
    );
    expect(properties.values.get(`${prefix}:head`)).toBe("2");
  });

  it("resumes an orphan sweep after a repaired head commits", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:recovered-orphan-restart";
    const store = new TransactionalPagedStore(properties, prefix, 8);
    const original = { body: "restart fallback", version: 1 };
    store.save(original);
    const previousPageIds = new Set(
      manifestAt(properties, `${prefix}:manifest:1`).pageIds,
    );
    store.save({ body: uniquePagedBody(180), version: 2 });
    const corruptTarget = manifestAt(properties, `${prefix}:manifest:2`);
    const targetOnlyPageIds = [
      ...new Set(
        corruptTarget.pageIds.filter((pageId) => !previousPageIds.has(pageId)),
      ),
    ];
    expect(targetOnlyPageIds.length).toBeGreaterThan(80);
    properties.values.set(`${prefix}:manifest:2`, "corrupt");
    const recovered = store.load(isSavedDocument)!;
    const repair = store.beginSave(recovered.value, recovered.generation);
    const headWritesBefore = properties.writeKeys.filter(
      (key) => key === `${prefix}:head`,
    ).length;

    for (let step = 0; step < 10_000; step += 1) {
      const operationsBefore = propertyOperations(properties);
      repair.step(1);
      expect(
        propertyOperations(properties) - operationsBefore,
      ).toBeLessThanOrEqual(1);
      const headWrites = properties.writeKeys.filter(
        (key) => key === `${prefix}:head`,
      ).length;
      if (headWrites > headWritesBefore) break;
      if (step === 9_999) throw new Error("Repair did not commit its head");
    }

    properties.values.set(`${prefix}:manifest:77`, "abandoned after restart");
    runBoundedMutation(store.beginCleanup(2), properties);

    for (const pageId of targetOnlyPageIds) {
      expect(properties.values.has(`${prefix}:blob:${pageId}`)).toBe(false);
    }
    expect(properties.values.has(`${prefix}:manifest:77`)).toBe(false);
    expect(properties.values.get(`${prefix}:head`)).toBe("2");
    expect(store.load(isSavedDocument)).toMatchObject({
      generation: 2,
      recovered: false,
      value: original,
    });
  });

  it("sweeps indexed pages hidden by a corrupt legacy target manifest", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:recovered-legacy-orphans";
    const original = { body: "legacy fallback", version: 1 };
    writeLegacyGeneration(properties, prefix, 1, original, 8);
    writeLegacyGeneration(
      properties,
      prefix,
      2,
      { body: uniquePagedBody(180), version: 2 },
      8,
    );
    properties.values.set(`${prefix}:head`, "2");
    const targetPagePrefix = `${prefix}:page:2:`;
    const targetPageKeys = [...properties.values.keys()].filter((key) =>
      key.startsWith(targetPagePrefix),
    );
    expect(targetPageKeys.length).toBeGreaterThan(80);
    properties.values.set(`${prefix}:manifest:2`, "corrupt");
    const store = new TransactionalPagedStore(properties, prefix, 8);
    const recovered = store.load(isSavedDocument)!;
    expect(recovered).toMatchObject({ generation: 1, recovered: true });

    runBoundedMutation(
      store.beginSave(recovered.value, recovered.generation),
      properties,
    );

    for (const key of targetPageKeys) {
      expect(properties.values.has(key)).toBe(false);
    }
    expect(
      [...properties.values.keys()].some((key) =>
        key.startsWith(`${prefix}:page:1:`),
      ),
    ).toBe(true);
    expect(store.load(isSavedDocument)).toEqual({
      generation: 2,
      recovered: false,
      sourceFormat: "content_addressed_blobs",
      value: original,
    });
  });

  it("loads a strictly validated legacy indexed-page generation", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:legacy";
    const document = {
      body: "a schema-one document split across old indexed pages",
      version: 1,
    };
    writeLegacyGeneration(properties, prefix, 7, document, 9);
    properties.values.set(`${prefix}:head`, "7");

    const store = new TransactionalPagedStore(properties, prefix, 9);
    expect(store.load(isSavedDocument)).toEqual({
      generation: 7,
      recovered: false,
      sourceFormat: "legacy_indexed_pages",
      value: document,
    });
  });

  it("rejects a legacy manifest with unrecognized fields", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:legacy-invalid";
    writeLegacyGeneration(
      properties,
      prefix,
      1,
      { body: "legacy", version: 1 },
      12,
    );
    const manifestKey = `${prefix}:manifest:1`;
    const manifest: unknown = JSON.parse(
      properties.values.get(manifestKey) ?? "{}",
    );
    if (typeof manifest !== "object" || manifest === null) {
      throw new Error("Invalid legacy manifest fixture.");
    }
    properties.values.set(
      manifestKey,
      JSON.stringify({ ...manifest, arbitraryPayload: true }),
    );
    properties.values.set(`${prefix}:head`, "1");

    const store = new TransactionalPagedStore(properties, prefix, 12);
    expect(() => store.load(isSavedDocument)).toThrow(
      "No complete storage generation could be loaded.",
    );
  });

  it("reads at most one legacy property per incremental load step", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:legacy-incremental";
    const document = {
      body: "legacy pages must be admitted one property at a time",
      version: 1,
    };
    writeLegacyGeneration(properties, prefix, 3, document, 7);
    properties.values.set(`${prefix}:head`, "3");
    const transaction = new TransactionalPagedStore(
      properties,
      prefix,
      7,
    ).beginLoad(isSavedDocument);
    expect(properties.reads).toBe(0);

    for (let step = 0; step < 100; step += 1) {
      const readsBefore = properties.reads;
      const result = transaction.step(1);
      expect(properties.reads - readsBefore).toBeLessThanOrEqual(1);
      if (result.outcome === "complete") {
        expect(result).toEqual({
          generation: 3,
          outcome: "complete",
          recovered: false,
          sourceFormat: "legacy_indexed_pages",
          value: document,
        });
        expect(transaction.stage).toBe("complete");
        return;
      }
    }
    throw new Error("Incremental legacy load did not terminate.");
  });

  it("incrementally falls back from a corrupt current blob to legacy pages", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:mixed-fallback";
    const original = { body: "legacy fallback", version: 1 };
    writeLegacyGeneration(properties, prefix, 1, original, 11);
    properties.values.set(`${prefix}:head`, "1");
    const store = new TransactionalPagedStore(properties, prefix, 11);
    store.save({ body: "current content-addressed value", version: 2 });
    const manifest = manifestAt(properties, `${prefix}:manifest:2`);
    properties.values.set(
      `${prefix}:blob:${String(manifest.pageIds[0])}`,
      "corrupt",
    );
    properties.reads = 0;
    properties.readKeys.length = 0;
    const transaction = store.beginLoad(isSavedDocument);

    for (let step = 0; step < 100; step += 1) {
      const readsBefore = properties.reads;
      const result = transaction.step(1);
      expect(properties.reads - readsBefore).toBeLessThanOrEqual(1);
      if (result.outcome === "complete") {
        expect(result).toEqual({
          generation: 1,
          outcome: "complete",
          recovered: true,
          sourceFormat: "legacy_indexed_pages",
          value: original,
        });
        expect(properties.readKeys).toContain(`${prefix}:manifest:1`);
        return;
      }
    }
    throw new Error("Incremental mixed-format fallback did not terminate.");
  });

  it("keeps the legacy head readable when its schema-two rewrite is interrupted", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:legacy-rewrite-failure";
    const original = { body: "legacy remains committed", version: 1 };
    writeLegacyGeneration(properties, prefix, 1, original, 8);
    properties.values.set(`${prefix}:head`, "1");
    const store = new TransactionalPagedStore(properties, prefix, 8);
    properties.failOnWrite = properties.writes + 2;

    expect(() =>
      store.save({
        body: "replacement that needs several new-format blobs",
        version: 2,
      }),
    ).toThrow("Injected write failure.");
    expect(properties.values.get(`${prefix}:head`)).toBe("1");
    expect(store.load(isSavedDocument)).toEqual({
      generation: 1,
      recovered: false,
      sourceFormat: "legacy_indexed_pages",
      value: original,
    });
  });

  it("deletes obsolete legacy pages in bounded save steps", () => {
    const properties = new MemoryPropertyStore();
    const prefix = "computer:legacy-cleanup";
    writeLegacyGeneration(
      properties,
      prefix,
      1,
      { body: "obsolete legacy pages", version: 1 },
      6,
    );
    writeLegacyGeneration(
      properties,
      prefix,
      2,
      { body: "retained legacy pages", version: 2 },
      6,
    );
    properties.values.set(`${prefix}:head`, "2");
    const store = new TransactionalPagedStore(properties, prefix, 6);
    const transaction = store.beginSave({ body: "new format", version: 3 });

    for (let step = 0; step < 100; step += 1) {
      const writesBefore = properties.writes;
      const deletesBefore = properties.deleteKeys.length;
      const result = transaction.step(1);
      expect(
        properties.writes -
          writesBefore +
          (properties.deleteKeys.length - deletesBefore),
      ).toBeLessThanOrEqual(1);
      if (result.outcome === "complete") break;
      if (step === 99) throw new Error("Legacy cleanup did not terminate.");
    }

    expect(properties.values.has(`${prefix}:manifest:1`)).toBe(false);
    expect(
      [...properties.values.keys()].some((key) =>
        key.startsWith(`${prefix}:page:1:`),
      ),
    ).toBe(false);
    expect(properties.values.has(`${prefix}:manifest:2`)).toBe(true);
    expect(
      [...properties.values.keys()].some((key) =>
        key.startsWith(`${prefix}:page:2:`),
      ),
    ).toBe(true);
    expect(store.load(isSavedDocument)).toMatchObject({
      generation: 3,
      sourceFormat: "content_addressed_blobs",
      value: { version: 3 },
    });
  });
});

function propertyOperations(properties: MemoryPropertyStore): number {
  return (
    properties.keyScans +
    properties.reads +
    properties.writes +
    properties.deleteKeys.length
  );
}

function runBoundedMutation(
  transaction: {
    step(maxOperations?: number): { readonly outcome: "complete" | "pending" };
  },
  properties: MemoryPropertyStore,
): void {
  for (let step = 0; step < 10_000; step += 1) {
    const operationsBefore = propertyOperations(properties);
    const result = transaction.step(1);
    expect(
      propertyOperations(properties) - operationsBefore,
    ).toBeLessThanOrEqual(1);
    if (result.outcome === "complete") return;
  }
  throw new Error("Bounded paged-store mutation did not terminate");
}

function uniquePagedBody(parts: number): string {
  return Array.from(
    { length: parts },
    (_, index) => `${index.toString(36).padStart(6, "0")}|`,
  ).join("");
}
