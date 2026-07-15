import { describe, expect, it, vi } from "vitest";

import { ComputerHost } from "../../src/application/computer/computerHost.js";
import {
  ComputerPersistenceService,
  type ComputerSnapshotRepository,
} from "../../src/application/computer/persistence.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
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

    host.runTick();

    expect(host.lastWorkSummary).toMatchObject({ tick: 1 });
    expect(host.workMetrics()).toMatchObject({
      completedTicks: 1,
      lanes: {
        guest_cpu: { admitted: 1 },
        persistence: { admitted: 1 },
        rs232: { admitted: 1 },
      },
    });
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
