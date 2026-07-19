import { describe, expect, it } from "vitest";

import {
  grantCs486ExecutableMemory,
  grantCs486MemoryRequirements,
  releaseGuestProcessMemory,
} from "../../src/application/runtime/guestProcessMemory.js";
import { GuestRamLedger } from "../../src/domain/computer/guestRamLedger.js";
import {
  createCs486Flat32MemoryMetadata,
  cs486ExecutableMemoryRequirements,
  type Cs486Executable,
} from "../../src/domain/cpu/cs486.js";

describe("guest process memory admission", (): void => {
  it("preserves v1/v2 single-program behavior with an exclusive lease", (): void => {
    const ledger = new GuestRamLedger(256 * 1_024);
    const executable: Cs486Executable = {
      format: "cs486-executable",
      instructions: [{ op: "halt" }],
      version: 2,
    };
    const admission = {
      identity: {
        displayName: "Legacy demo",
        instanceId: "pid-7",
        moduleId: "legacy-demo",
      },
      ledger,
    };

    const grant = grantCs486ExecutableMemory(executable, admission);

    expect(grant).toMatchObject({
      memoryBytes: 256 * 1_024,
      physicalReservationBytes: 256 * 1_024,
      released: false,
    });
    expect(ledger.snapshot()).toMatchObject({
      availableBytes: 0,
      leaseCount: 1,
      usedBytes: 256 * 1_024,
    });
    expect(() => grantCs486ExecutableMemory(executable, admission)).toThrow(
      "Out of Memory",
    );

    releaseGuestProcessMemory(grant);
    releaseGuestProcessMemory(grant);
    expect(ledger.snapshot()).toMatchObject({
      availableBytes: 256 * 1_024,
      leaseCount: 0,
      usedBytes: 0,
    });
  });

  it("gives v3 its declared linear space and leases only its physical set", (): void => {
    const ledger = new GuestRamLedger(512 * 1_024);
    const executable: Cs486Executable = {
      dataBytes: 20,
      format: "cs486-executable",
      instructions: [{ op: "halt" }],
      memory: createCs486Flat32MemoryMetadata({
        auxiliaryResidentBytes: 8 * 1_024,
        heapBytes: 32 * 1_024,
        stackBytes: 64 * 1_024,
      }),
      version: 3,
    };
    const requirements = cs486ExecutableMemoryRequirements(executable);
    expect(requirements.kind).toBe("declared");
    if (requirements.kind !== "declared") throw new Error("expected v3");

    const grant = grantCs486MemoryRequirements(requirements, {
      identity: {
        displayName: "Declared demo",
        moduleId: "declared-demo",
      },
      ledger,
    });

    expect(grant.memoryBytes).toBe(requirements.linearAddressSpaceBytes);
    expect(grant.physicalReservationBytes).toBe(
      requirements.physicalReservationBytes,
    );
    expect(ledger.usedBytes).toBe(requirements.physicalReservationBytes);
    expect(ledger.snapshot().breakdown).toEqual([
      expect.objectContaining({
        bytes: requirements.physicalReservationBytes,
        category: "process",
        displayName: "Declared demo",
        moduleId: "declared-demo",
      }),
    ]);

    const concurrent = grantCs486MemoryRequirements(requirements, {
      identity: {
        displayName: "Concurrent demo",
        moduleId: "concurrent-demo",
      },
      ledger,
    });
    expect(ledger.snapshot()).toMatchObject({
      leaseCount: 2,
      usedBytes: requirements.physicalReservationBytes * 2,
    });

    concurrent.release();
    grant.release();
    expect(ledger.usedBytes).toBe(0);
  });
});
