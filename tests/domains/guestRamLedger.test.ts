import { describe, expect, it } from "vitest";

import {
  GuestRamLedger,
  GuestRamOutOfMemoryError,
} from "../../src/domain/computer/guestRamLedger.js";

describe("GuestRamLedger", (): void => {
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
      { bytes: 320 * 1_024, leases: 1, owner: "dos-qbasic" },
      { bytes: 64 * 1_024, leases: 1, owner: "dos-resident" },
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
