import { describe, expect, it } from "vitest";

import {
  DosGuestMemoryManager,
  dosGuestMemoryConstants,
  type DosGuestMemorySnapshot,
} from "../../src/application/os/dosGuestMemoryManager.js";
import {
  planDosMemoryConfiguration,
  type DosConfigurationDriverResolution,
  type DosConfigurationDriverResolver,
  type DosMemoryConfigurationPlan,
} from "../../src/application/os/dosMemoryConfiguration.js";
import { GuestRamLedger } from "../../src/domain/computer/guestRamLedger.js";

const mib = 1_024 * 1_024;
const kib = 1_024;

function resolved(
  kind: "emm386" | "himem" | "resident",
  path: string,
  moduleId: string,
  displayName: string,
  residentBytes: number,
): DosConfigurationDriverResolution {
  return {
    canonicalPath: path,
    displayName,
    kind,
    moduleId,
    residentBytes,
    status: "resolved",
  };
}

function resolver(
  entries: Readonly<Record<string, DosConfigurationDriverResolution>> = {},
): DosConfigurationDriverResolver {
  return {
    resolve(request): DosConfigurationDriverResolution {
      const name = request.path.split("\\").at(-1)!;
      if (name === "HIMEM.SYS") {
        return resolved("himem", request.path, "himem", "HIMEM.SYS", 8 * kib);
      }
      if (name === "EMM386.EXE") {
        return resolved(
          "emm386",
          request.path,
          "emm386",
          "EMM386.EXE",
          8 * kib,
        );
      }
      return (
        entries[request.path] ??
        entries[name] ?? { reason: "missing", status: "rejected" }
      );
    },
  };
}

function memoryPlan(
  source: string,
  entries: Readonly<Record<string, DosConfigurationDriverResolution>> = {},
): DosMemoryConfigurationPlan {
  const result = planDosMemoryConfiguration(source, resolver(entries));
  if (!result.committable) {
    throw new Error(
      result.diagnostics.map(({ message }) => message).join("; "),
    );
  }
  return result.plan;
}

function configure(
  source: string,
  entries: Readonly<Record<string, DosConfigurationDriverResolution>> = {},
): {
  readonly ledger: GuestRamLedger;
  readonly manager: DosGuestMemoryManager;
  readonly plan: DosMemoryConfigurationPlan;
  readonly snapshot: DosGuestMemorySnapshot;
} {
  const ledger = new GuestRamLedger(2 * mib);
  const manager = new DosGuestMemoryManager(ledger);
  const plan = memoryPlan(source, entries);
  const result = manager.configure(plan);
  if (!result.configured) {
    throw new Error(
      result.diagnostics.map(({ message }) => message).join("; "),
    );
  }
  return { ledger, manager, plan, snapshot: result.snapshot };
}

describe("DosGuestMemoryManager", (): void => {
  it("boots the explicit degraded profile with exactly 64 KiB low DOS", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new DosGuestMemoryManager(ledger);
    const snapshot = manager.configureDegradedMinimal([
      { code: "invalid-config", lineNumber: 3, message: "invalid directive" },
    ]);

    expect(snapshot.state).toBe("degraded-low");
    expect(snapshot.regions.conventional.usedBytes).toBe(64 * kib);
    expect(snapshot.regions.conventional.totalBytes).toBe(640 * kib);
    expect(snapshot.regions.upper.totalBytes).toBe(0);
    expect(snapshot.regions.extended.totalBytes).toBe(0);
    expect(
      snapshot.modules.map(({ moduleId, residentBytes }) => ({
        moduleId,
        residentBytes,
      })),
    ).toEqual([
      { moduleId: "dos-kernel", residentBytes: 16 * kib },
      { moduleId: "command", residentBytes: 32 * kib },
      { moduleId: "dos-system-data", residentBytes: 16 * kib },
    ]);
    expect(snapshot.physical.reservedUnavailableBytes).toBe(
      2 * mib - 640 * kib,
    );
    expect(snapshot.physical.usedBytes).toBe(
      snapshot.physical.reservedUnavailableBytes + 64 * kib,
    );
    expect(snapshot.diagnostics.map(({ code }) => code)).toEqual([
      "invalid-config",
      "degraded-minimal",
    ]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.regions.conventional.freeExtents)).toBe(
      true,
    );
    expect(() => manager.configureDegradedMinimal()).toThrow(
      "already finalized",
    );
  });

  it("uses one extended region for HMA and XMS without double counting", (): void => {
    const { ledger, snapshot } = configure(
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=HIGH,UMB",
      ].join("\n"),
    );

    expect(snapshot.flags).toEqual({
      dosHigh: true,
      dosHighRequested: true,
      emm386NoEms: true,
      himem: true,
      hmaBytes: 64 * kib,
      umb: true,
      xms: true,
    });
    expect(snapshot.regions.conventional.totalBytes).toBe(640 * kib);
    expect(snapshot.regions.upper.totalBytes).toBe(128 * kib);
    expect(snapshot.regions.extended.totalBytes).toBe(1 * mib);
    expect(snapshot.physical.reservedUnavailableBytes).toBe(256 * kib);
    expect(
      snapshot.regions.conventional.totalBytes +
        snapshot.regions.upper.totalBytes +
        snapshot.regions.extended.totalBytes +
        snapshot.physical.reservedUnavailableBytes,
    ).toBe(snapshot.physical.totalBytes);

    const kernel = snapshot.modules.find(
      ({ moduleId }) => moduleId === "dos-kernel",
    )!;
    const system = snapshot.modules.find(
      ({ moduleId }) => moduleId === "dos-system-data",
    )!;
    const command = snapshot.modules.find(
      ({ moduleId }) => moduleId === "command",
    )!;
    expect(kernel.address).toBe(1 * mib);
    expect(system.address).toBe(1 * mib + 16 * kib);
    expect(kernel.actualPlacement).toBe("extended");
    expect(command.actualPlacement).toBe("conventional");
    expect(command.address).toBe(0);

    const breakdown = ledger.snapshot().breakdown;
    expect(
      breakdown.find(({ moduleId }) => moduleId === "physical-unavailable"),
    ).toMatchObject({
      bytes: 256 * kib,
      category: "os",
      displayName: "Reserved/unavailable physical memory",
    });
    expect(
      breakdown.find(({ moduleId }) => moduleId === "dos-kernel"),
    ).toMatchObject({ bytes: 16 * kib, category: "os" });
  });

  it("rejects an unplaceable plan atomically before explicit degraded boot", (): void => {
    const huge = resolved(
      "resident",
      "C:\\DOS\\HUGE.SYS",
      "huge",
      "HUGE.SYS",
      600 * kib,
    );
    const plan = memoryPlan("DEVICE=C:\\DOS\\HUGE.SYS", {
      "HUGE.SYS": huge,
    });
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new DosGuestMemoryManager(ledger);
    const rejected = manager.configure(plan);

    expect(rejected.configured).toBe(false);
    expect(ledger.snapshot()).toMatchObject({
      availableBytes: 2 * mib,
      leaseCount: 0,
      usedBytes: 0,
    });
    expect(() => manager.snapshot()).toThrow("not configured and active");
    expect(() => manager.configure(plan)).toThrow("already been attempted");

    const diagnostics = rejected.configured ? [] : rejected.diagnostics;
    const degraded = manager.configureDegradedMinimal(diagnostics);
    expect(degraded.state).toBe("degraded-low");
    expect(degraded.diagnostics.map(({ code }) => code)).toEqual([
      "configuration-rejected",
      "degraded-minimal",
    ]);
  });

  it("falls DEVICEHIGH back to conventional memory with an explicit diagnostic", (): void => {
    const ansi = resolved(
      "resident",
      "C:\\DOS\\ANSI.SYS",
      "ansi",
      "ANSI.SYS",
      160 * kib,
    );
    const { snapshot } = configure(
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=LOW,UMB",
        "DEVICEHIGH=C:\\DOS\\ANSI.SYS",
      ].join("\n"),
      { "ANSI.SYS": ansi },
    );

    expect(
      snapshot.modules.find(({ moduleId }) => moduleId === "ansi"),
    ).toMatchObject({
      actualPlacement: "conventional",
      requestedBytes: 160 * kib,
      requestedPlacement: "upper",
      residentBytes: 160 * kib,
    });
    expect(snapshot.diagnostics).toMatchObject([
      {
        code: "devicehigh-fallback",
        lineNumber: 4,
        message:
          "DEVICEHIGH: ANSI.SYS loaded low; no contiguous UMB block was available",
      },
    ]);
  });

  it("charges FILES and BUFFERS deterministically above the 64 KiB minimum", (): void => {
    const { snapshot } = configure(["FILES=40", "BUFFERS=30"].join("\n"));
    const fileBytes = 40 * dosGuestMemoryConstants.fileChargeBytes;
    const bufferBytes = 30 * dosGuestMemoryConstants.bufferChargeBytes;

    expect(snapshot.regions.conventional.usedBytes).toBe(
      64 * kib + fileBytes + bufferBytes,
    );
    expect(
      snapshot.modules.find(({ moduleId }) => moduleId === "dos-files"),
    ).toMatchObject({ requestedBytes: fileBytes, residentBytes: fileBytes });
    expect(
      snapshot.modules.find(({ moduleId }) => moduleId === "dos-buffers"),
    ).toMatchObject({
      requestedBytes: bufferBytes,
      residentBytes: bufferBytes,
    });
    expect(
      snapshot.modules.every(({ allocations }) =>
        allocations.every(
          ({ address, size }) =>
            address % dosGuestMemoryConstants.alignmentBytes === 0 &&
            size % dosGuestMemoryConstants.alignmentBytes === 0,
        ),
      ),
    ).toBe(true);
  });

  it("keeps COMMAND and an oversized DOS=HIGH system set low explicitly", (): void => {
    const { snapshot } = configure(
      ["FILES=255", "BUFFERS=99", "DEVICE=C:\\DOS\\HIMEM.SYS", "DOS=HIGH"].join(
        "\n",
      ),
    );

    expect(snapshot.flags).toMatchObject({
      dosHigh: false,
      dosHighRequested: true,
      himem: true,
    });
    expect(snapshot.diagnostics).toMatchObject([{ code: "dos-high-fallback" }]);
    expect(
      snapshot.modules
        .filter(({ category }) => category === "os")
        .every(({ actualPlacement }) => actualPlacement === "conventional"),
    ).toBe(true);
    expect(
      snapshot.modules.find(({ moduleId }) => moduleId === "command"),
    ).toMatchObject({
      actualPlacement: "conventional",
      residentBytes: 32 * kib,
    });
  });

  it("coalesces released conventional extents and reports the largest block", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new DosGuestMemoryManager(ledger);
    manager.configureDegradedMinimal();
    const first = manager.reserveTransientResident({
      bytes: 192 * kib,
      category: "editor",
      displayName: "First",
      moduleId: "first",
    });
    const middle = manager.reserveTransientResident({
      bytes: 192 * kib,
      category: "editor",
      displayName: "Middle",
      moduleId: "middle",
    });
    const last = manager.reserveTransientResident({
      bytes: 192 * kib,
      category: "editor",
      displayName: "Last",
      moduleId: "last",
    });
    expect(manager.snapshot().regions.conventional.freeBytes).toBe(0);

    middle.release();
    expect(manager.snapshot().regions.conventional.largestFreeBlockBytes).toBe(
      192 * kib,
    );
    first.release();
    expect(manager.snapshot().regions.conventional.largestFreeBlockBytes).toBe(
      384 * kib,
    );
    last.release();
    expect(manager.snapshot().regions.conventional.largestFreeBlockBytes).toBe(
      576 * kib,
    );
  });

  it("grants physical chunks extended then upper while preserving linear bytes", (): void => {
    const { ledger, manager, snapshot } = configure(
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=HIGH,UMB",
      ].join("\n"),
    );
    const extendedFree = snapshot.regions.extended.freeBytes;
    const beforeAvailable = ledger.availableBytes;
    const grant = manager.grantProcess({
      displayName: "CS486 process",
      instanceId: "pid-42",
      linearAddressSpaceBytes: 64 * kib,
      moduleId: "program",
      physicalReservationBytes: extendedFree + 16 * kib,
    });

    expect(grant.memoryBytes).toBe(64 * kib);
    expect(grant.physicalReservationBytes).toBe(extendedFree + 16 * kib);
    expect(grant.residentBytes).toBe(extendedFree + 16 * kib);
    expect(grant.allocations.map(({ placement }) => placement)).toEqual([
      "extended",
      "upper",
    ]);
    expect(ledger.availableBytes).toBe(beforeAvailable - grant.residentBytes);
    expect(
      ledger
        .snapshot()
        .breakdown.find(({ moduleId }) => moduleId === "program"),
    ).toMatchObject({
      bytes: grant.residentBytes,
      category: "process",
      leases: 1,
    });

    grant.release();
    expect(grant.released).toBe(true);
    expect(grant.residentBytes).toBe(0);
    expect(grant.physicalReservationBytes).toBe(0);
    expect(ledger.availableBytes).toBe(beforeAvailable);
    expect(() => grant.release()).toThrow("already released");
  });

  it("keeps instance ownership exact while aggregating snapshots by module", (): void => {
    const { ledger, manager } = configure("DEVICE=C:\\DOS\\HIMEM.SYS");
    const first = manager.grantProcess({
      displayName: "Worker",
      instanceId: "pid-1",
      linearAddressSpaceBytes: 4 * kib,
      moduleId: "worker",
      physicalReservationBytes: 4 * kib,
    });
    const second = manager.grantProcess({
      displayName: "Worker",
      instanceId: "pid-2",
      linearAddressSpaceBytes: 8 * kib,
      moduleId: "worker",
      physicalReservationBytes: 8 * kib,
    });

    expect(
      manager
        .snapshot()
        .modules.filter(({ moduleId }) => moduleId === "worker"),
    ).toMatchObject([
      {
        category: "process",
        moduleId: "worker",
        requestedBytes: 12 * kib,
        residentBytes: 12 * kib,
      },
    ]);
    expect(
      ledger.snapshot().breakdown.find(({ moduleId }) => moduleId === "worker"),
    ).toMatchObject({ bytes: 12 * kib, leases: 2 });

    first.release();
    second.release();
  });

  it("gives a legacy process one exclusive grant over all allocatable free bytes", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new DosGuestMemoryManager(ledger);
    const boot = manager.configureDegradedMinimal();
    const freeBytes = boot.physical.freeBytes;
    const grant = manager.grantLegacyProcess({
      displayName: "Legacy program",
      instanceId: "pid-legacy",
      moduleId: "legacy-program",
    });

    expect(grant.memoryBytes).toBe(freeBytes);
    expect(grant.residentBytes).toBe(freeBytes);
    expect(manager.snapshot().physical.freeBytes).toBe(0);
    expect(() =>
      manager.grantLegacyProcess({
        displayName: "Second legacy program",
        moduleId: "second-legacy",
      }),
    ).toThrow("Out of Memory");

    grant.release();
    expect(manager.snapshot().physical.freeBytes).toBe(freeBytes);
  });

  it("closes all owned reservations idempotently and supports reload-equivalent boot", (): void => {
    const plan = memoryPlan(
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=HIGH,UMB",
      ].join("\n"),
    );
    const ledger = new GuestRamLedger(2 * mib);
    const firstManager = new DosGuestMemoryManager(ledger);
    const configured = firstManager.configure(plan);
    if (!configured.configured) throw new Error("configuration failed");
    const baseline = configured.snapshot;
    const transient = firstManager.reserveTransientResident({
      bytes: 4 * kib,
      category: "compiler",
      displayName: "Compiler",
      instanceId: "compile-1",
      moduleId: "csc",
    });
    const process = firstManager.grantProcess({
      displayName: "Program",
      instanceId: "pid-7",
      linearAddressSpaceBytes: 8 * kib,
      moduleId: "program",
      physicalReservationBytes: 8 * kib,
    });

    expect(firstManager.close()).toEqual({
      alreadyClosed: false,
      closed: true,
    });
    expect(transient.released).toBe(true);
    expect(process.released).toBe(true);
    expect(ledger.snapshot()).toMatchObject({
      availableBytes: 2 * mib,
      leaseCount: 0,
      usedBytes: 0,
    });
    expect(firstManager.close()).toEqual({
      alreadyClosed: true,
      closed: true,
    });

    const secondManager = new DosGuestMemoryManager(ledger);
    const reloaded = secondManager.configure(plan);
    if (!reloaded.configured) throw new Error("reload configuration failed");
    expect(reloaded.snapshot).toEqual(baseline);
    secondManager.close();
  });

  it("reports an O(free extents) allocation visit bound", (): void => {
    const ledger = new GuestRamLedger(2 * mib);
    const manager = new DosGuestMemoryManager(ledger);
    manager.configureDegradedMinimal();
    const fillers = Array.from({ length: 4 }, (_, index) =>
      manager.reserveTransientResident({
        bytes: 144 * kib,
        category: "editor",
        displayName: `Filler ${String(index)}`,
        instanceId: `slot-${String(index)}`,
        moduleId: "filler",
      }),
    );
    fillers[0]!.release();
    fillers[2]!.release();
    const before = manager.snapshot();
    const freeExtentCount = before.regions.conventional.freeExtents.length;

    const grant = manager.grantProcess({
      displayName: "Fragment consumer",
      linearAddressSpaceBytes: 288 * kib,
      moduleId: "fragment-consumer",
      physicalReservationBytes: 288 * kib,
    });
    const after = manager.snapshot();
    expect(freeExtentCount).toBe(2);
    expect(after.allocationVisitCount - before.allocationVisitCount).toBe(
      freeExtentCount,
    );
    expect(grant.allocations).toHaveLength(2);

    grant.release();
    for (const filler of fillers) {
      if (!filler.released) filler.release();
    }
  });
});
