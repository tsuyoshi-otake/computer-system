import { describe, expect, it, vi } from "vitest";

import {
  ComputerPersistenceService,
  type ComputerSnapshotRepository,
} from "../../src/application/computer/persistence.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";

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
    expect(Object.keys(repository.load("computer-7")!)).not.toContain("vm");
  });

  it("deduplicates clean saves and writes exactly once after a mutation", (): void => {
    const repository = new MemoryRepository();
    const save = vi.spyOn(repository, "save");
    const persistence = new ComputerPersistenceService(repository);
    const record = new ComputerRecord("computer-8", "standard");

    expect(persistence.saveIfDirty(record).outcome).toBe("saved");
    expect(persistence.saveIfDirty(record)).toEqual({ outcome: "unchanged" });
    record.filesystem.writeFile("/startup.py", "pass");
    expect(persistence.saveIfDirty(record).outcome).toBe("saved");
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
