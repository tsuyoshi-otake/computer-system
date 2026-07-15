import { describe, expect, it } from "vitest";

import {
  PersistentComputerIdentityService,
  type ComputerIdentityRepository,
  type ComputerIdentitySnapshot,
} from "../../src/application/computer/identityPersistence.js";

const computerIdSpace = 32 ** 6;

describe("PersistentComputerIdentityService", (): void => {
  it("keeps identity through block-item-block and service reloads", (): void => {
    const repository = new MemoryRepository();
    let service = serviceWithIds(repository, 1);
    const placed = service.place("overworld:1,2,3", "standard");
    expect(placed).toMatchObject({
      outcome: "placed",
      computerId: "c-000001",
    });
    expect(service.break("overworld:1,2,3")).toMatchObject({
      outcome: "placed",
      computerId: "c-000001",
    });

    service = serviceWithIds(repository, 2);
    expect(service.place("nether:4,5,6", "standard", "c-000001")).toMatchObject(
      {
        outcome: "placed",
        computerId: "c-000001",
      },
    );
    expect(service.observation("c-000001")?.physicalKey).toBe("nether:4,5,6");
    expect(service.atPhysicalKey("nether:4,5,6")?.computerId).toBe("c-000001");
  });

  it("rejects duplicate carried IDs and family changes", (): void => {
    const repository = new MemoryRepository();
    const service = serviceWithIds(repository, 1);
    service.place("a", "advanced", "computer-9");
    expect(service.place("b", "advanced", "computer-9").outcome).toBe(
      "duplicate",
    );
    service.break("a");
    expect(service.place("c", "standard", "computer-9").outcome).toBe(
      "duplicate",
    );
  });

  it("rolls failed new and carried placements back to their prior ownership", (): void => {
    const repository = new MemoryRepository();
    const service = serviceWithIds(repository, 1);
    const fresh = service.place("failed:new", "standard");
    if (fresh.outcome !== "placed") return;
    service.rollbackPlacement("failed:new", fresh.computerId, false);
    expect(service.observation(fresh.computerId)).toBeUndefined();

    service.place("source", "advanced", "computer-40");
    service.break("source");
    service.place("failed:carried", "advanced", "computer-40");
    service.rollbackPlacement("failed:carried", "computer-40", true);
    expect(service.observation("computer-40")).toMatchObject({
      form: "item",
      physicalKey: "detached:computer-40",
    });
  });

  it("allocates persistent detached identities for portable computers", (): void => {
    const repository = new MemoryRepository();
    let service = serviceWithIds(repository, 1);
    expect(service.createItem("advanced")).toMatchObject({
      outcome: "placed",
      computerId: "c-000001",
      family: "advanced",
    });
    expect(service.observation("c-000001")).toEqual({
      computerId: "c-000001",
      family: "advanced",
      form: "item",
      physicalKey: "detached:c-000001",
    });

    service = serviceWithIds(repository, 2);
    expect(service.createItem("standard")).toMatchObject({
      outcome: "placed",
      computerId: "c-000002",
    });
    expect(repository.snapshot).toMatchObject({ schema: 2 });
    expect(repository.snapshot).not.toHaveProperty("nextId");
  });

  it("walks placed identities in fixed O(K) batches without snapshot sorting", (): void => {
    const repository = new MemoryRepository();
    const service = serviceWithIds(repository, 1, 2, 3, 4, 5);
    for (const key of ["a", "b", "c", "d", "e"]) {
      service.place(key, "standard");
    }
    const first = service.blockObservationBatch(0, 2);
    const second = service.blockObservationBatch(first.nextCursor, 2);
    const third = service.blockObservationBatch(second.nextCursor, 2);
    expect(first.observations.map(({ physicalKey }) => physicalKey)).toEqual([
      "a",
      "b",
    ]);
    expect(second.observations.map(({ physicalKey }) => physicalKey)).toEqual([
      "c",
      "d",
    ]);
    expect(third.observations.map(({ physicalKey }) => physicalKey)).toEqual([
      "e",
      "a",
    ]);

    service.break("c");
    const remaining = service.blockObservationBatch(0, 8);
    expect(
      remaining.observations.map(({ physicalKey }) => physicalKey),
    ).not.toContain("c");
    expect(remaining.observations).toHaveLength(4);
  });
});

function serviceWithIds(
  repository: ComputerIdentityRepository,
  ...values: number[]
): PersistentComputerIdentityService {
  let index = 0;
  return new PersistentComputerIdentityService(repository, {
    random: () => values[index++]! / computerIdSpace,
  });
}

class MemoryRepository implements ComputerIdentityRepository {
  snapshot: ComputerIdentitySnapshot | undefined;
  generation = 0;
  load(): ComputerIdentitySnapshot | undefined {
    return this.snapshot === undefined
      ? undefined
      : structuredClone(this.snapshot);
  }
  save(snapshot: ComputerIdentitySnapshot): number {
    this.snapshot = structuredClone(snapshot);
    return ++this.generation;
  }
}
