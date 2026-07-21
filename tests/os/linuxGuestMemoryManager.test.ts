import { describe, expect, it } from "vitest";

import {
  LinuxGuestMemoryManager,
  LinuxGuestMemoryOutOfMemoryError,
  LinuxGuestMemoryStateError,
  linuxGuestMemoryConstants,
} from "../../src/application/os/linuxGuestMemoryManager.js";
import { GuestRamLedger } from "../../src/domain/computer/guestRamLedger.js";

const kib = 1_024;
const mib = 1_024 * kib;

describe("LinuxGuestMemoryManager", (): void => {
  it("reserves the strict 2 MiB and 8 MiB Linux resident profiles", (): void => {
    const twoMibLedger = new GuestRamLedger(2 * mib);
    const twoMib = new LinuxGuestMemoryManager(twoMibLedger);
    const twoMibSnapshot = twoMib.snapshot();

    expect(twoMibSnapshot.resident).toEqual({
      buffersBytes: 64 * kib,
      guestRuntimeBytes: 0,
      kernelBytes: 512 * kib,
      servicesBytes: 192 * kib,
    });
    expect(twoMibSnapshot.physical).toEqual({
      availableBytes: 2 * mib - 704 * kib,
      freeBytes: 2 * mib - 768 * kib,
      reclaimableBytes: 64 * kib,
      totalBytes: 2 * mib,
      usedBytes: 768 * kib,
    });
    expect(twoMibSnapshot.allocationVisitCount).toBe(3);

    const eightMibLedger = new GuestRamLedger(8 * mib);
    const eightMib = new LinuxGuestMemoryManager(eightMibLedger);
    const eightMibSnapshot = eightMib.snapshot();
    expect(eightMibSnapshot.resident).toEqual({
      buffersBytes: 256 * kib,
      guestRuntimeBytes: 0,
      kernelBytes: 768 * kib,
      servicesBytes: 192 * kib,
    });
    expect(eightMibSnapshot.physical.usedBytes).toBe(1_216 * kib);
    expect(eightMibSnapshot.physical.availableBytes).toBe(8 * mib - 960 * kib);

    twoMib.close();
    eightMib.close();
    expect(twoMibLedger.usedBytes).toBe(0);
    expect(eightMibLedger.usedBytes).toBe(0);
  });

  it("reclaims buffers transactionally and refills them after release", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new LinuxGuestMemoryManager(ledger);
    const before = manager.snapshot();
    const available = before.physical.availableBytes;

    expect(() =>
      manager.grantProcess({
        displayName: "oversized",
        instanceId: "pid-candidate-1",
        linearAddressSpaceBytes: available + 1,
        moduleId: "oversized",
        physicalReservationBytes: available + 1,
      }),
    ).toThrow(LinuxGuestMemoryOutOfMemoryError);
    expect(manager.snapshot()).toEqual(before);

    const grant = manager.grantProcess({
      displayName: "exact",
      instanceId: "pid-candidate-2",
      linearAddressSpaceBytes: available,
      moduleId: "exact",
      physicalReservationBytes: available,
    });
    const pressured = manager.snapshot();
    expect(pressured.resident.buffersBytes).toBe(0);
    expect(pressured.physical.freeBytes).toBe(0);
    expect(pressured.physical.availableBytes).toBe(0);
    expect(pressured.resident.guestRuntimeBytes).toBe(available);

    grant.release();
    expect(manager.snapshot()).toEqual(before);
    manager.close();
  });

  it("binds exact v3 virtual and resident grants to one PID", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new LinuxGuestMemoryManager(ledger);
    const grant = manager.grantProcess({
      displayName: "CS486 process",
      instanceId: "runtime-7",
      linearAddressSpaceBytes: 160 * kib,
      moduleId: "run",
      physicalReservationBytes: 96 * kib,
    });

    grant.bindProcess(7);
    expect(manager.snapshot().processes).toEqual([
      { pid: 7, residentBytes: 96 * kib, virtualBytes: 160 * kib },
    ]);
    expect(() => grant.bindProcess(8)).toThrow(LinuxGuestMemoryStateError);

    grant.release();
    expect(manager.snapshot().processes).toEqual([]);
    manager.close();
  });

  it("gives legacy processes the complete post-reclaim remainder", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new LinuxGuestMemoryManager(ledger);
    const available = manager.snapshot().physical.availableBytes;
    const grant = manager.grantLegacyProcess({
      displayName: "legacy",
      instanceId: "legacy-1",
      moduleId: "legacy",
    });

    expect(grant.memoryBytes).toBe(available);
    expect(grant.physicalReservationBytes).toBe(available);
    expect(() =>
      manager.grantLegacyProcess({
        displayName: "second legacy",
        instanceId: "legacy-2",
        moduleId: "legacy",
      }),
    ).toThrow(LinuxGuestMemoryOutOfMemoryError);

    grant.release();
    manager.close();
  });

  it("bounds active reservations and snapshots by allocation count", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new LinuxGuestMemoryManager(ledger);
    const reservations = Array.from(
      { length: linuxGuestMemoryConstants.maxActiveDynamicReservations },
      (_, index) =>
        manager.reserveTransient({
          category: "compiler",
          displayName: `compiler ${String(index)}`,
          instanceId: `compiler-${String(index)}`,
          moduleId: "compiler",
          residentBytes: 1,
        }),
    );
    expect(manager.snapshot().allocationVisitCount).toBe(
      linuxGuestMemoryConstants.maxActiveDynamicReservations + 3,
    );
    expect(() =>
      manager.reserveTransient({
        category: "compiler",
        displayName: "one too many",
        instanceId: "compiler-overflow",
        moduleId: "compiler",
        residentBytes: 1,
      }),
    ).toThrow(LinuxGuestMemoryStateError);

    for (const reservation of reservations) reservation.release();
    expect(manager.close()).toEqual({ alreadyClosed: false, closed: true });
    expect(manager.close()).toEqual({ alreadyClosed: true, closed: true });
    expect(ledger.usedBytes).toBe(0);
  });

  it("rejects non-clean ledgers and detects unowned leases on close", (): void => {
    const nonClean = new GuestRamLedger(2 * mib);
    nonClean.acquire(1, {
      category: "process",
      displayName: "bypass",
      moduleId: "bypass",
    });
    expect(() => new LinuxGuestMemoryManager(nonClean)).toThrow(
      LinuxGuestMemoryStateError,
    );

    const ledger = new GuestRamLedger(2 * mib);
    const manager = new LinuxGuestMemoryManager(ledger);
    const bypass = ledger.acquire(1, {
      category: "process",
      displayName: "bypass",
      moduleId: "bypass",
    });
    expect(() => manager.snapshot()).toThrow(LinuxGuestMemoryStateError);
    expect(() => manager.close()).toThrow(LinuxGuestMemoryStateError);
    bypass.release();
    expect(ledger.usedBytes).toBe(0);
  });
});
