import { describe, expect, it } from "vitest";

import {
  PersistentComputerIdentityService,
  type ComputerIdentityRepository,
  type ComputerIdentitySnapshot,
} from "../../src/application/computer/identityPersistence.js";

describe("PersistentComputerIdentityService", (): void => {
  it("keeps identity through block-item-block and service reloads", (): void => {
    const repository = new MemoryRepository();
    let service = new PersistentComputerIdentityService(repository);
    const placed = service.place("overworld:1,2,3", "standard");
    expect(placed).toMatchObject({
      outcome: "placed",
      computerId: "computer-1",
    });
    expect(service.break("overworld:1,2,3")).toMatchObject({
      outcome: "placed",
      computerId: "computer-1",
    });

    service = new PersistentComputerIdentityService(repository);
    expect(
      service.place("nether:4,5,6", "standard", "computer-1"),
    ).toMatchObject({
      outcome: "placed",
      computerId: "computer-1",
    });
    expect(service.observation("computer-1")?.physicalKey).toBe("nether:4,5,6");
  });

  it("rejects duplicate carried IDs and family changes", (): void => {
    const repository = new MemoryRepository();
    const service = new PersistentComputerIdentityService(repository);
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
    const service = new PersistentComputerIdentityService(repository);
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
});

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
