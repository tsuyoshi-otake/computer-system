import { describe, expect, it } from "vitest";

import { runVerticalSliceProbe } from "../../src/application/computer/verticalSliceProbe.js";
import type {
  ComputerIdentityRepository,
  ComputerIdentitySnapshot,
} from "../../src/application/computer/identityPersistence.js";
import type { ComputerSnapshotRepository } from "../../src/application/computer/persistence.js";
import type { ComputerSnapshot } from "../../src/domain/computer/computer.js";

describe("Phase 2 vertical-slice headless probe", (): void => {
  it("proves startup, redstone, terminate, identity, and snapshot reload", (): void => {
    const identities = new MemoryIdentityRepository();
    const snapshots = new MemorySnapshotRepository();
    const first = runVerticalSliceProbe(identities, snapshots);
    const second = runVerticalSliceProbe(identities, snapshots);
    expect(first).toMatchObject({
      loadedSnapshot: false,
      identityStable: true,
      outputMask: 2,
      startupPresent: true,
      terminatedOff: true,
    });
    expect(second).toMatchObject({
      loadedSnapshot: true,
      identityStable: true,
      outputMask: 2,
      startupPresent: true,
      terminatedOff: true,
    });
    expect(second.computerId).toBe(first.computerId);
  });
});

class MemoryIdentityRepository implements ComputerIdentityRepository {
  value: ComputerIdentitySnapshot | undefined;
  generation = 0;
  load(): ComputerIdentitySnapshot | undefined {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }
  save(snapshot: ComputerIdentitySnapshot): number {
    this.value = structuredClone(snapshot);
    return ++this.generation;
  }
}

class MemorySnapshotRepository implements ComputerSnapshotRepository {
  value: ComputerSnapshot | undefined;
  generation = 0;
  load(): ComputerSnapshot | undefined {
    return this.value === undefined ? undefined : structuredClone(this.value);
  }
  save(snapshot: ComputerSnapshot): number {
    this.value = structuredClone(snapshot);
    return ++this.generation;
  }
}
