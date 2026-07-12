import { describe, expect, it } from "vitest";

import {
  ComputerIdSequence,
  ComputerIdentityRegistry,
} from "../../src/domain/computer/identity.js";

describe("Computer identity registry", (): void => {
  it("preserves identity across block and item round trips", (): void => {
    const registry = new ComputerIdentityRegistry();
    expect(
      registry.claim({
        computerId: "computer-1",
        family: "standard",
        form: "block",
        physicalKey: "overworld:1,2,3",
      }),
    ).toMatchObject({ outcome: "claimed" });
    expect(
      registry.transfer("computer-1", "overworld:1,2,3", {
        family: "standard",
        form: "item",
        physicalKey: "item:drop-7",
      }),
    ).toMatchObject({ outcome: "transferred" });
    expect(
      registry.transfer("computer-1", "item:drop-7", {
        family: "standard",
        form: "item",
        physicalKey: "inventory:alex:4",
      }),
    ).toMatchObject({ outcome: "transferred" });
    expect(
      registry.transfer("computer-1", "inventory:alex:4", {
        family: "standard",
        form: "block",
        physicalKey: "nether:9,8,7",
      }),
    ).toMatchObject({ outcome: "transferred" });
    expect(registry.get("computer-1")).toEqual({
      computerId: "computer-1",
      family: "standard",
      form: "block",
      physicalKey: "nether:9,8,7",
    });
  });

  it("rejects duplicates without replacing the established physical owner", (): void => {
    const registry = new ComputerIdentityRegistry();
    registry.claim({
      computerId: "computer-2",
      family: "advanced",
      form: "item",
      physicalKey: "container:a:0",
    });
    expect(
      registry.claim({
        computerId: "computer-2",
        family: "advanced",
        form: "item",
        physicalKey: "container:b:0",
      }),
    ).toMatchObject({ outcome: "duplicate" });
    expect(registry.get("computer-2")?.physicalKey).toBe("container:a:0");
    expect(
      registry.transfer("computer-2", "wrong-source", {
        family: "advanced",
        form: "block",
        physicalKey: "overworld:0,0,0",
      }),
    ).toMatchObject({ outcome: "duplicate" });
  });

  it("restores deterministic snapshots and supports administrative removal", (): void => {
    const registry = new ComputerIdentityRegistry();
    registry.restore([
      {
        computerId: "computer-4",
        family: "advanced",
        form: "item",
        physicalKey: "drop:4",
      },
      {
        computerId: "computer-3",
        family: "standard",
        form: "block",
        physicalKey: "overworld:3,3,3",
      },
    ]);
    expect(registry.snapshot().map(({ computerId }) => computerId)).toEqual([
      "computer-3",
      "computer-4",
    ]);
    expect(registry.remove("computer-3")).toMatchObject({ outcome: "removed" });
    expect(registry.remove("computer-3")).toEqual({
      outcome: "missing",
      computerId: "computer-3",
    });
    expect(() =>
      registry.restore([
        {
          computerId: "computer-4",
          family: "advanced",
          form: "item",
          physicalKey: "same",
        },
        {
          computerId: "computer-5",
          family: "standard",
          form: "item",
          physicalKey: "same",
        },
      ]),
    ).toThrow(/Duplicate restored/u);
  });

  it("allocates stable monotonic IDs and persists the next value", (): void => {
    const sequence = new ComputerIdSequence();
    expect([sequence.next(), sequence.next()]).toEqual([
      "computer-1",
      "computer-2",
    ]);
    const restored = new ComputerIdSequence(sequence.snapshot());
    expect(restored.next()).toBe("computer-3");
  });
});
