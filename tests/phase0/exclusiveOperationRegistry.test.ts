import { describe, expect, it } from "vitest";

import {
  ExclusiveOperationRegistry,
  OperationLease,
} from "../../src/phase0/exclusiveOperationRegistry.js";

describe("ExclusiveOperationRegistry", (): void => {
  it("rejects an overlapping operation and releases every resource", (): void => {
    const registry = new ExclusiveOperationRegistry();
    const first = registry.tryBegin("turtle-a", ["destination", "source"]);
    expect(first).toBeInstanceOf(OperationLease);

    const conflict = registry.tryBegin("turtle-b", ["destination"]);
    expect(conflict).toEqual({
      ownerId: "turtle-a",
      resource: "destination",
      status: "conflict",
    });

    expect((first as OperationLease).commit()).toBe("committed");
    expect(registry.activeResourceCount).toBe(0);
    const second = registry.tryBegin("turtle-b", ["destination"]);
    expect(second).toBeInstanceOf(OperationLease);
    expect((second as OperationLease).rollback()).toBe("rolled_back");
    expect(registry.activeResourceCount).toBe(0);
  });

  it("makes finalization idempotent but rejects a contradictory terminal", (): void => {
    const registry = new ExclusiveOperationRegistry();
    const lease = registry.tryBegin("turtle-a", ["source"]);
    expect(lease).toBeInstanceOf(OperationLease);

    expect((lease as OperationLease).rollback()).toBe("rolled_back");
    expect((lease as OperationLease).rollback()).toBe("rolled_back");
    expect(() => (lease as OperationLease).commit()).toThrow(
      "already ended as rolled_back",
    );
    expect(registry.activeResourceCount).toBe(0);
  });
});
