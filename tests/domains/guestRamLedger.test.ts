import { describe, expect, it } from "vitest";

import {
  GuestRamLedger,
  GuestRamOutOfMemoryError,
  guestRamOwnerValidationLimits,
  legacyGuestRamOwners,
  normalizeGuestRamOwner,
  type GuestRamOwner,
  type GuestRamOwnerDescriptor,
  type GuestRamOwnerIdentity,
  type LegacyGuestRamOwner,
} from "../../src/domain/computer/guestRamLedger.js";

const expectedLegacyOwnerIdentities = {
  "compiler-asm": {
    category: "compiler",
    displayName: "CS ASM",
    moduleId: "csasm",
  },
  "compiler-basic": {
    category: "compiler",
    displayName: "CS BASIC",
    moduleId: "csbasic",
  },
  "compiler-c": {
    category: "compiler",
    displayName: "CS C",
    moduleId: "csc",
  },
  "compiler-cpp": {
    category: "compiler",
    displayName: "CS C++",
    moduleId: "cscpp",
  },
  "dos-editor": {
    category: "editor",
    displayName: "EDIT",
    moduleId: "edit",
  },
  "dos-qbasic": {
    category: "ide",
    displayName: "CS QBASIC",
    moduleId: "qbasic",
  },
  "dos-resident": {
    category: "os",
    displayName: "DOS system and drivers",
    moduleId: "dos-resident",
  },
  "dos-toolchain-ide": {
    category: "ide",
    displayName: "Programmer's WorkBench",
    moduleId: "pwb",
  },
  linker: {
    category: "linker",
    displayName: "CS Linker",
    moduleId: "csld",
  },
  "program-list": {
    category: "process",
    displayName: "Program List",
    moduleId: "program-list",
  },
  vi: { category: "editor", displayName: "vi", moduleId: "vi" },
} as const satisfies Readonly<
  Record<LegacyGuestRamOwner, GuestRamOwnerIdentity>
>;

describe("GuestRamLedger", (): void => {
  it("normalizes every legacy owner to its frozen identity", (): void => {
    expect(legacyGuestRamOwners).toEqual(
      Object.keys(expectedLegacyOwnerIdentities),
    );
    for (const owner of legacyGuestRamOwners) {
      const identity = normalizeGuestRamOwner(owner);
      expect(identity).toEqual(expectedLegacyOwnerIdentities[owner]);
      expect(Object.isFrozen(identity)).toBe(true);
    }
  });

  it("groups descriptors by category and module while retaining lease instances", (): void => {
    const ledger = new GuestRamLedger(128);
    const mutableOwner = {
      category: "process",
      displayName: "Worker",
      instanceId: "pid-41",
      moduleId: "worker",
    } satisfies GuestRamOwnerDescriptor;
    const first = ledger.acquire(7, mutableOwner);
    const second = ledger.acquire(11, {
      ...mutableOwner,
      instanceId: "pid-42",
    });
    ledger.acquire(1, {
      category: "process",
      displayName: "Alpha worker",
      instanceId: "pid-43",
      moduleId: "alpha-worker",
    });

    mutableOwner.displayName = "mutated after admission";
    expect(first.owner).toEqual({
      category: "process",
      displayName: "Worker",
      instanceId: "pid-41",
      moduleId: "worker",
    });
    expect(second.owner.instanceId).toBe("pid-42");
    expect(Object.isFrozen(first.owner)).toBe(true);
    expect(Object.isFrozen(second.owner)).toBe(true);
    const breakdown = ledger.breakdown();
    expect(breakdown).toEqual([
      {
        bytes: 1,
        category: "process",
        displayName: "Alpha worker",
        leases: 1,
        moduleId: "alpha-worker",
        owner: "alpha-worker",
      },
      {
        bytes: 18,
        category: "process",
        displayName: "Worker",
        leases: 2,
        moduleId: "worker",
        owner: "worker",
      },
    ]);
    expect(Object.isFrozen(breakdown)).toBe(true);
    expect(breakdown.every((entry) => Object.isFrozen(entry))).toBe(true);
  });

  it("bounds descriptor fields and preserves exact state after rejection", (): void => {
    const ledger = new GuestRamLedger(128);
    ledger.acquire(16, "dos-resident");
    const before = ledger.snapshot();
    const validBoundary = normalizeGuestRamOwner({
      category: "driver",
      displayName: "D".repeat(guestRamOwnerValidationLimits.displayNameLength),
      instanceId: "i".repeat(guestRamOwnerValidationLimits.instanceIdLength),
      moduleId: "m".repeat(guestRamOwnerValidationLimits.moduleIdLength),
    });
    expect(validBoundary.moduleId).toHaveLength(
      guestRamOwnerValidationLimits.moduleIdLength,
    );

    const invalidOwners: readonly unknown[] = [
      "not-a-legacy-owner",
      null,
      [],
      new Date(),
      {},
      { category: "unknown", displayName: "Driver", moduleId: "driver" },
      { category: "driver", displayName: "Driver", moduleId: "" },
      { category: "driver", displayName: "Driver", moduleId: "Uppercase" },
      {
        category: "driver",
        displayName: "Driver",
        moduleId: "m".repeat(guestRamOwnerValidationLimits.moduleIdLength + 1),
      },
      { category: "driver", displayName: "", moduleId: "driver" },
      {
        category: "driver",
        displayName: "D".repeat(
          guestRamOwnerValidationLimits.displayNameLength + 1,
        ),
        moduleId: "driver",
      },
      {
        category: "driver",
        displayName: "Driver\nname",
        moduleId: "driver",
      },
      {
        category: "driver",
        displayName: "Driver",
        instanceId: "",
        moduleId: "driver",
      },
      {
        category: "driver",
        displayName: "Driver",
        instanceId: "i".repeat(
          guestRamOwnerValidationLimits.instanceIdLength + 1,
        ),
        moduleId: "driver",
      },
    ];
    for (const invalidOwner of invalidOwners) {
      expect(() => ledger.acquire(1, invalidOwner as GuestRamOwner)).toThrow();
      expect(ledger.snapshot()).toEqual(before);
    }
  });

  it("keeps owner breakdown, used bytes, and available bytes reconciled", (): void => {
    const ledger = new GuestRamLedger(2 * 1_048_576);
    const resident = ledger.acquire(64 * 1_024, "dos-resident");
    const editor = ledger.acquire(256 * 1_024, "dos-qbasic");
    editor.resize(320 * 1_024);

    const snapshot = ledger.snapshot();
    expect(snapshot.usedBytes).toBe(384 * 1_024);
    expect(snapshot.availableBytes).toBe(
      snapshot.totalBytes - snapshot.usedBytes,
    );
    expect(
      snapshot.breakdown.reduce((sum, entry) => sum + entry.bytes, 0),
    ).toBe(snapshot.usedBytes);
    expect(snapshot.breakdown).toEqual([
      {
        bytes: 320 * 1_024,
        category: "ide",
        displayName: "CS QBASIC",
        leases: 1,
        moduleId: "qbasic",
        owner: "dos-qbasic",
      },
      {
        bytes: 64 * 1_024,
        category: "os",
        displayName: "DOS system and drivers",
        leases: 1,
        moduleId: "dos-resident",
        owner: "dos-resident",
      },
    ]);

    editor.release();
    resident.release();
    expect(ledger.snapshot()).toMatchObject({
      availableBytes: 2 * 1_048_576,
      leaseCount: 0,
      usedBytes: 0,
    });
  });

  it("rejects overcommit and preserves the prior lease state", (): void => {
    const ledger = new GuestRamLedger(128 * 1_024);
    const resident = ledger.acquire(64 * 1_024, "dos-resident");
    const before = ledger.snapshot();

    expect(() => ledger.acquire(64 * 1_024 + 1, "compiler-basic")).toThrow(
      GuestRamOutOfMemoryError,
    );
    expect(() => resident.resize(128 * 1_024 + 1)).toThrow(
      GuestRamOutOfMemoryError,
    );
    expect(ledger.snapshot()).toEqual(before);
  });

  it("makes finalization errors observable and does not persist lease identity", (): void => {
    const ledger = new GuestRamLedger(1_048_576);
    const lease = ledger.acquire(1, "vi");
    lease.release();
    expect(() => lease.release()).toThrow("already released");
    expect(() => lease.resize(2)).toThrow("already released");
    expect(Object.keys(ledger.snapshot())).not.toContain("leaseIds");
  });
});
