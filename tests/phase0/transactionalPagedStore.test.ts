import { describe, expect, it } from "vitest";

import {
  TransactionalPagedStore,
  type StringPropertyStore,
} from "../../src/phase0/transactionalPagedStore.js";

interface SavedDocument {
  readonly body: string;
  readonly version: number;
}

class MemoryPropertyStore implements StringPropertyStore {
  readonly values = new Map<string, string>();
  failOnWrite: number | undefined;
  writes = 0;

  public get(key: string): string | undefined {
    return this.values.get(key);
  }

  public keys(prefix: string): readonly string[] {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }

  public delete(key: string): void {
    this.values.delete(key);
  }

  public set(key: string, value: string): void {
    this.writes += 1;
    if (this.writes === this.failOnWrite) {
      throw new Error("Injected write failure.");
    }
    this.values.set(key, value);
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

describe("TransactionalPagedStore", () => {
  it("round-trips a value split across several pages", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:7", 8);
    const document = { body: "abcdefghijklmnopqrstuvwxyz", version: 1 };

    expect(store.save(document)).toBe(1);
    expect(store.load(isSavedDocument)).toEqual({
      generation: 1,
      recovered: false,
      value: document,
    });
    expect(
      [...properties.values.keys()].filter((key) => key.includes(":page:"))
        .length,
    ).toBeGreaterThan(1);
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
      value: original,
    });
  });

  it("falls back to the previous generation when the current page is corrupt", () => {
    const properties = new MemoryPropertyStore();
    const store = new TransactionalPagedStore(properties, "computer:9", 32);
    const original = { body: "first", version: 1 };
    store.save(original);
    store.save({ body: "second", version: 2 });

    properties.values.set("computer:9:page:2:0", "corrupt");
    expect(store.load(isSavedDocument)).toEqual({
      generation: 1,
      recovered: true,
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
    expect(
      [...properties.values.keys()].some((key) => /:page:[123]:/u.test(key)),
    ).toBe(false);
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
});
