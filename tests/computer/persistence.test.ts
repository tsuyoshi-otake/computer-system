import { describe, expect, it, vi } from "vitest";

import {
  ComputerPersistenceService,
  type ComputerSnapshotRepository,
} from "../../src/application/computer/persistence.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";

describe("Computer persistence boundary", (): void => {
  it("round-trips identity, filesystem, terminal, label, and redstone without live VM state", (): void => {
    const repository = new MemoryRepository();
    const persistence = new ComputerPersistenceService(repository);
    const record = new ComputerRecord("computer-7", "advanced", {
      label: "Mining",
    });
    record.filesystem.makeDirectory("/programs");
    record.filesystem.writeFile("/startup.py", "print('boot')");
    record.filesystem.writeFile("/programs/mine.py", "pass");
    record.terminal.setTextColor(3);
    record.terminal.setBackgroundColor(12);
    record.terminal.write("Ready");
    record.terminal.setCursorPosition(2, 2);
    record.terminal.setCursorBlink(true);
    record.setRedstoneOutputMask(34);
    record.configureHardware({
      clockHz: 10_000,
      cpuModel: "cs486dx",
      memoryBytes: 2_097_152,
    });

    expect(persistence.saveIfDirty(record)).toEqual({
      outcome: "saved",
      generation: 1,
    });
    const loaded = new ComputerPersistenceService(repository).load(
      "computer-7",
    );
    expect(loaded.outcome).toBe("loaded");
    if (loaded.outcome !== "loaded") return;
    expect(loaded.record.computerId).toBe("computer-7");
    expect(loaded.record.family).toBe("advanced");
    expect(loaded.record.label).toBe("Mining");
    expect(loaded.record.lifecycle.state).toEqual({ kind: "off" });
    expect(loaded.record.filesystem.readFile("/startup.py")).toBe(
      "print('boot')",
    );
    expect(loaded.record.terminal.line(1)).toMatch(/^Ready/u);
    expect(loaded.record.terminal.cell(1, 1)).toMatchObject({
      foreground: 3,
      background: 12,
    });
    expect(loaded.record.terminal.cursorBlink).toBe(true);
    expect(loaded.record.redstoneOutputMask).toBe(34);
    expect(loaded.record.hardware).toEqual({
      clockHz: 10_000,
      cpuModel: "cs486dx",
      memoryBytes: 2_097_152,
    });
    expect(Object.keys(repository.load("computer-7")!)).not.toContain("vm");
  });

  it("deduplicates clean saves and writes exactly once after a mutation", (): void => {
    const repository = new MemoryRepository();
    const save = vi.spyOn(repository, "save");
    const persistence = new ComputerPersistenceService(repository);
    const record = new ComputerRecord("computer-8", "standard");

    expect(persistence.saveIfDirty(record).outcome).toBe("saved");
    const snapshot = vi.spyOn(record, "snapshot");
    expect(persistence.saveIfDirty(record)).toEqual({ outcome: "unchanged" });
    expect(snapshot).not.toHaveBeenCalled();
    record.filesystem.writeFile("/startup.py", "pass");
    expect(persistence.saveIfDirty(record).outcome).toBe("saved");
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("restores a cursor that advanced beyond the visible terminal width", (): void => {
    const repository = new MemoryRepository();
    const persistence = new ComputerPersistenceService(repository);
    const record = new ComputerRecord("computer-10", "standard", {
      terminalWidth: 4,
      terminalHeight: 2,
    });
    record.terminal.write("clipped output");

    expect(persistence.saveIfDirty(record).outcome).toBe("saved");
    const loaded = new ComputerPersistenceService(repository).load(
      "computer-10",
    );
    expect(loaded.outcome).toBe("loaded");
    if (loaded.outcome !== "loaded") return;
    expect(loaded.record.terminal.cursorX).toBe(15);
    expect(loaded.record.terminal.line(1)).toBe("clip");
  });

  it("migrates the persisted legacy shell prompt and green theme", (): void => {
    const repository = new MemoryRepository();
    const persistence = new ComputerPersistenceService(repository);
    const record = new ComputerRecord("computer-11", "standard");
    record.terminal.setTextColor(5);
    record.terminal.write("user@computer-11:~$ ");
    record.terminal.setCursorPosition(1, 2);
    record.terminal.write("legacy output");
    record.terminal.setCursorPosition("user@computer-11:~$ ".length + 1, 1);

    expect(persistence.saveIfDirty(record).outcome).toBe("saved");
    const loaded = new ComputerPersistenceService(repository).load(
      "computer-11",
    );
    expect(loaded.outcome).toBe("loaded");
    if (loaded.outcome !== "loaded") return;

    expect(loaded.record.terminal.line(1).trimEnd()).toBe("~$");
    expect(loaded.record.terminal.cell(1, 1).foreground).toBe(0);
    expect(loaded.record.terminal.cell(1, 2).foreground).toBe(0);
    expect(loaded.record.terminal.cursorX).toBe(4);
    expect(loaded.record.terminal.cursorY).toBe(1);
  });

  it("returns explicit missing and failed outcomes", (): void => {
    const repository = new MemoryRepository();
    const persistence = new ComputerPersistenceService(repository);
    expect(persistence.load("computer-99")).toEqual({
      outcome: "missing",
      computerId: "computer-99",
    });
    repository.fail = true;
    const failed = persistence.saveIfDirty(
      new ComputerRecord("computer-9", "standard"),
    );
    expect(failed.outcome).toBe("failed");
    if (failed.outcome === "failed") expect(failed.error).toBeInstanceOf(Error);
  });

  it("persists DOS selection and defaults legacy snapshots to Linux", (): void => {
    const repository = new MemoryRepository();
    const dos = new ComputerRecord("computer-14", "standard", {
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    repository.save(dos.snapshot());
    const loadedDos = new ComputerPersistenceService(repository).load(
      "computer-14",
    );
    expect(loadedDos.outcome).toBe("loaded");
    if (loadedDos.outcome === "loaded") {
      expect(loadedDos.record.osProfile).toBe("dos");
      expect(loadedDos.record.hardware).toEqual(portableComputerHardware);
    }

    const linux = new ComputerRecord("computer-15", "standard").snapshot();
    repository.save({ ...linux, hardware: undefined, osProfile: undefined });
    const loadedLegacy = new ComputerPersistenceService(repository).load(
      "computer-15",
    );
    expect(loadedLegacy.outcome).toBe("loaded");
    if (loadedLegacy.outcome === "loaded") {
      expect(loadedLegacy.record.osProfile).toBe("linux");
      expect(loadedLegacy.record.hardware).toEqual({
        clockHz: 33_000_000,
        cpuModel: "cs486dx",
        memoryBytes: 1_048_576,
      });
    }
  });
});

class MemoryRepository implements ComputerSnapshotRepository {
  private readonly snapshots = new Map<string, ComputerSnapshot>();
  private generation = 0;
  fail = false;

  load(computerId: string): ComputerSnapshot | undefined {
    if (this.fail) throw new Error("storage unavailable");
    return this.snapshots.get(computerId);
  }

  save(snapshot: ComputerSnapshot): number {
    if (this.fail) throw new Error("storage unavailable");
    this.snapshots.set(snapshot.computerId, structuredClone(snapshot));
    return ++this.generation;
  }
}
