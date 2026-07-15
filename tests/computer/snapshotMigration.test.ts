import { describe, expect, it } from "vitest";

import {
  isMigratableComputerSnapshot,
  migrateComputerSnapshot,
  type LegacyComputerSnapshotV1,
} from "../../src/application/computer/snapshotMigration.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import {
  isInMemoryFilesystemSnapshot,
  isLegacyInMemoryFilesystemSnapshot,
  migrateLegacyInMemoryFilesystemSnapshot,
  type FilesystemMetadata,
  type LegacyInMemoryFilesystemSnapshot,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("Computer snapshot schema migration", (): void => {
  it("returns an ordinary current snapshot unchanged", (): void => {
    const snapshot = new ComputerRecord("computer-201", "advanced", {
      label: "Current",
    }).snapshot();

    expect(isMigratableComputerSnapshot(snapshot)).toBe(true);
    expect(migrateComputerSnapshot(snapshot)).toBe(snapshot);
  });

  it("preserves every legacy Computer and filesystem field in schema 2", (): void => {
    const terminalRecord = new ComputerRecord("computer-202", "advanced");
    terminalRecord.terminal.setTextColor(3);
    terminalRecord.terminal.setBackgroundColor(12);
    terminalRecord.terminal.write("Preserved terminal");
    terminalRecord.terminal.setCursorPosition(4, 2);
    terminalRecord.terminal.setCursorBlink(true);
    const legacy = legacyComputerSnapshot(terminalRecord.terminal.snapshot());

    expect(isMigratableComputerSnapshot(legacy)).toBe(true);
    const migrated = migrateComputerSnapshot(legacy);

    expect(migrated).toMatchObject({
      schema: 2,
      computerId: "computer-202",
      family: "advanced",
      label: "Portable state",
      redstoneOutputMask: 37,
      osProfile: "dos",
      hardware: portableComputerHardware,
      displayProfileId: "portable-vga-256k",
      terminal: legacy.terminal,
    });
    expect(migrated.filesystem.schema).toBe(2);
    expect(migrated.filesystem.baseImageId).toBeUndefined();
    expect(migrated.filesystem.blobs).toHaveLength(2);

    const restored = ComputerRecord.restore(migrated);
    expect(restored.label).toBe("Portable state");
    expect(restored.redstoneOutputMask).toBe(37);
    expect(restored.osProfile).toBe("dos");
    expect(restored.hardware).toEqual(portableComputerHardware);
    expect(restored.displayProfileId).toBe("portable-vga-256k");
    expect(restored.terminal.snapshot()).toEqual(legacy.terminal);
    expect(restored.filesystem.list("/")).toEqual(["home", "root.txt"]);
    expect(restored.filesystem.list("/home")).toEqual([
      "data",
      "first.txt",
      "link",
      "second.txt",
    ]);
    expect(restored.filesystem.readFile("/home/first.txt")).toBe("same data");
    expect(restored.filesystem.readFile("/home/second.txt")).toBe("same data");
    expect(restored.filesystem.getLinkCount("/home/first.txt")).toBe(2);
    expect(restored.filesystem.getLinkCount("/home/second.txt")).toBe(2);
    expect(restored.filesystem.readLink("/home/link")).toBe("data");
    expect(restored.filesystem.getMetadata("/home/first.txt")).toEqual(
      fileMetadata,
    );
    expect(restored.filesystem.getMetadata("/home", false)).toEqual(
      directoryMetadata,
    );
  });

  it("deduplicates inline legacy contents into validated content blobs", (): void => {
    const legacy = legacyFilesystemSnapshot();

    expect(isLegacyInMemoryFilesystemSnapshot(legacy)).toBe(true);
    const migrated = migrateLegacyInMemoryFilesystemSnapshot(legacy);

    expect(isInMemoryFilesystemSnapshot(migrated)).toBe(true);
    expect(migrated.files).toHaveLength(3);
    expect(migrated.blobs).toHaveLength(2);
    expect(migrated.files[0]?.[1]).toBe(migrated.files[1]?.[1]);
    expect(migrated.metadata).toEqual(legacy.metadata);
    expect(migrated.symbolicLinks).toEqual(legacy.symbolicLinks);
    expect(migrated.hardLinks).toEqual(legacy.hardLinks);
  });

  it("strictly rejects malformed legacy and current payloads", (): void => {
    const validFilesystem = legacyFilesystemSnapshot();
    const malformedFilesystems: unknown[] = [
      { ...validFilesystem, schema: 1 },
      {
        ...validFilesystem,
        files: [...validFilesystem.files, ["/root.txt", "duplicate"]],
      },
      {
        ...validFilesystem,
        metadata: [["/missing", fileMetadata]],
      },
      {
        ...validFilesystem,
        hardLinks: [["/home/first.txt", "/root.txt"]],
      },
      { ...validFilesystem, unexpected: true },
    ];
    for (const malformed of malformedFilesystems) {
      expect(isLegacyInMemoryFilesystemSnapshot(malformed)).toBe(false);
      expect(() =>
        migrateLegacyInMemoryFilesystemSnapshot(
          malformed as LegacyInMemoryFilesystemSnapshot,
        ),
      ).toThrow("Invalid legacy filesystem snapshot");
    }

    const validComputer = legacyComputerSnapshot(
      new ComputerRecord("computer-203", "standard").terminal.snapshot(),
    );
    const malformedComputers: unknown[] = [
      { ...validComputer, schema: 0 },
      { ...validComputer, redstoneOutputMask: 64 },
      {
        ...validComputer,
        terminal: { ...validComputer.terminal, rows: [] },
      },
      { ...validComputer, unexpected: true },
      {
        ...new ComputerRecord("computer-204", "standard").snapshot(),
        filesystem: {
          schema: 2,
          blobs: [["forged", "contents"]],
          directories: [],
          files: [["/file", "forged"]],
        },
      },
    ];
    for (const malformed of malformedComputers) {
      expect(isMigratableComputerSnapshot(malformed)).toBe(false);
      expect(() => migrateComputerSnapshot(malformed)).toThrow(
        "Invalid or unsupported computer snapshot",
      );
    }
  });
});

const directoryMetadata: FilesystemMetadata = {
  gid: 1_000,
  mode: 0o750,
  modifiedAtMilliseconds: 1_700_000_000_000,
  uid: 1_000,
};

const fileMetadata: FilesystemMetadata = {
  gid: 1_001,
  mode: 0o640,
  modifiedAtMilliseconds: 1_700_000_000_001,
  uid: 1_002,
};

function legacyFilesystemSnapshot(): LegacyInMemoryFilesystemSnapshot {
  return {
    directories: ["/home", "/home/data"],
    files: [
      ["/home/first.txt", "same data"],
      ["/home/second.txt", "same data"],
      ["/root.txt", "root data"],
    ],
    metadata: [
      ["/home", directoryMetadata],
      ["/home/data", directoryMetadata],
      ["/home/first.txt", fileMetadata],
      ["/home/second.txt", fileMetadata],
      ["/home/link", fileMetadata],
      ["/root.txt", fileMetadata],
    ],
    symbolicLinks: [["/home/link", "data"]],
    hardLinks: [["/home/first.txt", "/home/second.txt"]],
  };
}

function legacyComputerSnapshot(
  terminal: LegacyComputerSnapshotV1["terminal"],
): LegacyComputerSnapshotV1 {
  return {
    schema: 1,
    computerId: "computer-202",
    family: "advanced",
    label: "Portable state",
    filesystem: legacyFilesystemSnapshot(),
    terminal,
    redstoneOutputMask: 37,
    osProfile: "dos",
    hardware: portableComputerHardware,
    displayProfileId: "portable-vga-256k",
  };
}
