import { describe, expect, it } from "vitest";

import {
  ComputerIdAllocator,
  ComputerIdentityRegistry,
  numericComputerId,
} from "../../src/domain/computer/identity.js";

const computerIdSpace = 32 ** 6;

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

  it("allocates compact IDs and retries registry collisions", (): void => {
    const samples = [1, 1, 2];
    const allocator = new ComputerIdAllocator(
      () => samples.shift()! / computerIdSpace,
    );
    expect(allocator.next(() => false)).toBe("c-000001");
    expect(allocator.next((computerId) => computerId === "c-000001")).toBe(
      "c-000002",
    );
  });

  it("keeps 500 generated IDs unique and exactly decodes their 30-bit value", (): void => {
    let value = 0;
    const allocator = new ComputerIdAllocator(() => value++ / computerIdSpace);
    const ids = Array.from({ length: 500 }, () => allocator.next(() => false));
    expect(new Set(ids).size).toBe(500);
    expect(
      ids.every((computerId) => /^c-[0-9a-hjkmnp-tv-z]{6}$/u.test(computerId)),
    ).toBe(true);
    expect(numericComputerId(ids[0]!)).toBe(0);
    expect(numericComputerId(ids[499]!)).toBe(499);
  });

  it("fails explicitly when the random source is invalid or collisions are exhausted", (): void => {
    expect(() => new ComputerIdAllocator(() => 1).next(() => false)).toThrow(
      /random source/u,
    );
    expect(() => new ComputerIdAllocator(() => 0, 2).next(() => true)).toThrow(
      /after 2 attempts/u,
    );
  });
});
