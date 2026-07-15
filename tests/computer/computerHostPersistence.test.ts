import { describe, expect, it, vi } from "vitest";

import { ComputerHost } from "../../src/application/computer/computerHost.js";
import {
  ComputerPersistenceService,
  type ComputerSnapshotRepository,
} from "../../src/application/computer/persistence.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import type { ComputerStorageMigrationStatus } from "../../src/application/computer/storageMigration.js";
import { ComputerWorkMonitor } from "../../src/application/runtime/computerWorkMonitor.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";

describe("ComputerHost persistence bridge", (): void => {
  it("bounds persistence work and visits registered computers round-robin", (): void => {
    const repository = new MemoryRepository();
    const host = hostWith(repository, { maxPersistenceChecksPerTick: 1 });
    host.register(new ComputerRecord("computer-20", "standard"));
    host.register(new ComputerRecord("computer-21", "advanced"));

    host.runTick();
    expect(repository.savedIds).toEqual(["computer-20"]);
    host.runTick();
    expect(repository.savedIds).toEqual(["computer-20", "computer-21"]);
    host.runTick();
    expect(repository.savedIds).toHaveLength(2);
  });

  it("restores records and reports storage failures without stopping ticks", (): void => {
    const repository = new MemoryRepository();
    repository.snapshots.set(
      "computer-22",
      new ComputerRecord("computer-22", "standard").snapshot(),
    );
    const onFailure = vi.fn();
    const host = hostWith(repository, { onPersistenceFailure: onFailure });
    expect(host.restore("computer-22").outcome).toBe("registered");
    repository.failSave = true;
    host.get("computer-22")?.setLabel("dirty");

    expect(() => host.runTick()).not.toThrow();
    expect(onFailure).toHaveBeenCalledWith("computer-22", expect.any(Error));
    expect(host.runtime.tickNumber).toBe(1);
  });

  it("accounts runtime, RS-232C, and persistence in one finished host scope", (): void => {
    const repository = new MemoryRepository();
    let microseconds = 10;
    const monitor = new ComputerWorkMonitor({
      nowMicroseconds: (): number => microseconds++,
    });
    const host = hostWith(repository, {
      maxPersistenceChecksPerTick: 1,
      workMonitor: monitor,
    });
    host.register(new ComputerRecord("computer-23", "standard"));
    expect(host.runtime.powerOn("computer-23").outcome).toBe("accepted");

    host.runTick();

    expect(host.lastWorkSummary).toMatchObject({ tick: 1 });
    expect(host.workMetrics()).toMatchObject({
      completedTicks: 1,
      lanes: {
        guest_cpu: { admitted: 1 },
        event_delivery: { admitted: 1 },
        persistence: { admitted: 1 },
        rs232: { admitted: 0 },
      },
    });
  });

  it("advances storage migration once per host tick in the persistence lane", (): void => {
    let completedSteps = 0;
    const migration = {
      get status(): ComputerStorageMigrationStatus {
        return completedSteps < 2
          ? {
              state: "pending",
              phase: "identity_load",
              completedComputers: 0,
              totalComputers: 1,
            }
          : {
              state: "complete",
              migratedComputers: 1,
              missingComputers: 0,
              skippedComputers: 0,
              totalComputers: 1,
            };
      },
      step: vi.fn((maximumOperations = 1): ComputerStorageMigrationStatus => {
        void maximumOperations;
        completedSteps += 1;
        return migration.status;
      }),
    };
    const host = hostWith(new MemoryRepository(), {
      storageMigration: migration,
      workMonitor: new ComputerWorkMonitor({
        nowMicroseconds: (): number => 0,
      }),
    });

    host.runTick();
    host.runTick();
    host.runTick();

    expect(migration.step).toHaveBeenCalledTimes(2);
    expect(migration.step).toHaveBeenNthCalledWith(1, 1);
    expect(migration.step).toHaveBeenNthCalledWith(2, 1);
    expect(host.storageMigrationStatus()?.state).toBe("complete");
    expect(host.workMetrics()?.lanes.persistence.admitted).toBe(2);
  });

  it("selects fixed-disk profiles and exposes real HDD/FDD activity", (): void => {
    const host = hostWith(new MemoryRepository());
    host.register(new ComputerRecord("c-000410", "standard"));
    host.register(new ComputerRecord("c-000411", "advanced"));
    host.register(
      new ComputerRecord("c-000412", "standard", {
        displayProfileId: "portable-vga-256k",
      }),
    );

    expect(host.storageStatus("c-000410")).toMatchObject({
      capacityBytes: 40 * 1_048_576,
      diskProfileId: "desktop-ide-40m",
      fdd: { state: "absent" },
      hdd: { state: "idle" },
    });
    expect(host.storageStatus("c-000411")?.capacityBytes).toBe(80 * 1_048_576);
    expect(host.storageStatus("c-000412")?.capacityBytes).toBe(20 * 1_048_576);

    expect(
      host.submitBlockIo("c-000410", "hdd", {
        id: "read-boot-sector",
        lba: 0,
        operation: "read",
        sectorCount: 1,
      }),
    ).toMatchObject({ outcome: "accepted" });
    expect(host.storageStatus("c-000410")?.hdd).toMatchObject({
      pendingRequests: 1,
      state: "read",
    });
    host.runTick();
    expect(host.storageStatus("c-000410")?.hdd).toMatchObject({
      pendingRequests: 0,
      state: "idle",
    });
  });

  it("holds the guest in block_io wait until the modeled HDD request completes", (): void => {
    const host = hostWith(new MemoryRepository(), {
      workMonitor: new ComputerWorkMonitor({
        nowMicroseconds: (): number => 0,
      }),
    });
    const record = new ComputerRecord("c-000413", "standard");
    host.register(record);
    host.runtime.powerOn(record.computerId);
    for (let tick = 0; tick < 3; tick += 1) host.runTick();

    host.runtime.queueEvent(record.computerId, "terminal_line", "ls /");
    host.runTick();
    expect(record.lifecycle.state.kind).toBe("waiting_event");
    if (record.lifecycle.state.kind === "waiting_event") {
      expect(record.lifecycle.state.filter).toMatch(/^block_io:fs-/u);
    }
    expect(host.storageStatus(record.computerId)?.hdd).toMatchObject({
      pendingRequests: 1,
      state: "read",
    });

    for (let tick = 0; tick < 4; tick += 1) host.runTick();
    expect(host.storageStatus(record.computerId)?.hdd).toMatchObject({
      pendingRequests: 0,
      state: "idle",
    });
    if (record.lifecycle.state.kind === "waiting_event") {
      expect(record.lifecycle.state.filter ?? "").not.toMatch(/^block_io:/u);
    }
    expect(host.workMetrics()).toMatchObject({
      lanes: { block_io: { admitted: 1 } },
    });
  });

  it("accounts compile, MCP, terminal, buses, redstone, and topology on production paths", (): void => {
    const repository = new MemoryRepository();
    let microseconds = 0;
    const monitor = new ComputerWorkMonitor({
      nowMicroseconds: (): number => microseconds++,
    });
    const host = hostWith(repository, { workMonitor: monitor });
    const record = new ComputerRecord("c-000401", "standard");
    const peer = new ComputerRecord("c-000402", "standard");
    host.register(record);
    host.register(peer);
    host.runtime.powerOn(record.computerId);
    peer.faceIo.powerOn();
    host.serial.connect(
      { computerId: record.computerId, face: "right" },
      { computerId: peer.computerId, face: "left" },
    );
    host.serial.write(
      { computerId: record.computerId, face: "right" },
      Uint8Array.of(1, 2, 3),
    );
    host.peripherals.attachSpi(
      { computerId: record.computerId, face: "right" },
      0,
      { id: "spi", transfer: (bytes) => bytes },
    );
    host.peripherals.attachI2c(
      { computerId: record.computerId, face: "right" },
      {
        address: 0x48,
        id: "i2c",
        transact: ({ readLength }) => new Uint8Array(readLength),
      },
    );
    record.filesystem.writeFile("/tmp/main.c", "int main(){return 0;}");
    record.filesystem.writeFile(
      "/tmp/io.py",
      'import term, redstone\nterm.write("io")\nredstone.set_output("right", True)\nprint(redstone.get_input("left"))\n',
    );
    host.submitBlockIo(record.computerId, "hdd", {
      id: "production-read",
      lba: 0,
      operation: "read",
      sectorCount: 1,
    });

    for (let index = 0; index < 3; index += 1) host.runTick();
    host.runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "cc /tmp/main.c -o /tmp/main",
    );
    host.runTick();
    expect(host.workMetrics()?.lanes.guest_compile.admitted).toBe(0);
    host.runTick();
    expect(record.filesystem.exists("/tmp/main")).toBe(true);
    host.runtime.queueEvent(record.computerId, "terminal_line", "spi 1 0 01");
    for (let index = 0; index < 4; index += 1) host.runTick();
    host.runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "i2c 1 0x48 00 1",
    );
    for (let index = 0; index < 4; index += 1) host.runTick();
    host.runtime.queueEvent(
      record.computerId,
      "terminal_line",
      "python /tmp/io.py",
    );
    for (let index = 0; index < 5; index += 1) host.runTick();
    let debugComplete = false;
    host.runtime.enqueueDebugShellCommand(
      record.computerId,
      "python -c print(42)",
      () => {
        debugComplete = true;
      },
    );
    for (let index = 0; index < 4; index += 1) host.runTick();
    host.observeExternalWork(
      { lane: "topology", deterministicUnits: 6 },
      () => undefined,
    );

    const lanes = host.workMetrics()!.lanes;
    expect(debugComplete).toBe(true);
    for (const lane of [
      "control",
      "event_delivery",
      "guest_cpu",
      "guest_compile",
      "mcp_debug",
      "rs232",
      "i2c",
      "spi",
      "redstone_input",
      "redstone_output",
      "topology",
      "terminal",
      "block_io",
      "persistence",
    ] as const) {
      expect(lanes[lane].admitted, lane).toBeGreaterThan(0);
    }
  });
});

function hostWith(
  repository: MemoryRepository,
  options: ConstructorParameters<typeof ComputerHost>[2] = {},
): ComputerHost {
  return new ComputerHost(
    new ComputerRuntime(),
    new ComputerPersistenceService(repository),
    options,
  );
}

class MemoryRepository implements ComputerSnapshotRepository {
  readonly snapshots = new Map<string, ComputerSnapshot>();
  readonly savedIds: string[] = [];
  failSave = false;

  load(computerId: string): ComputerSnapshot | undefined {
    return this.snapshots.get(computerId);
  }

  save(snapshot: ComputerSnapshot): number {
    if (this.failSave) throw new Error("write failed");
    this.snapshots.set(snapshot.computerId, structuredClone(snapshot));
    this.savedIds.push(snapshot.computerId);
    return this.savedIds.length;
  }
}
