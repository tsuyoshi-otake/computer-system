import { describe, expect, it } from "vitest";

import {
  isMigratableComputerSnapshot,
  migrateComputerSnapshot,
  type LegacyComputerSnapshotV1,
} from "../../src/application/computer/snapshotMigration.js";
import {
  installOsFilesystemImage,
  registerOsFilesystemImages,
} from "../../src/application/os/osFilesystemImages.js";
import {
  linuxAccountPaths,
  migrateLinuxAccountDatabase,
  openLinuxAccountDatabase,
} from "../../src/application/os/linuxAccounts.js";
import {
  dosFatAttribute,
  DosRuntimeState,
} from "../../src/application/os/dosRuntimeState.js";
import { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
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
  it("returns an ordinary current snapshot without OS runtime state unchanged", (): void => {
    const snapshot = new ComputerRecord("computer-201", "advanced", {
      label: "Current",
    }).snapshot();

    expect(snapshot.osRuntime).toBeUndefined();
    expect(isMigratableComputerSnapshot(snapshot)).toBe(true);
    expect(migrateComputerSnapshot(snapshot)).toBe(snapshot);
  });

  it("accepts and cold-normalizes optional schema-2 OS runtime state", (): void => {
    const snapshot = new ComputerRecord("computer-205", "standard").snapshot();
    const runtime = new OsRuntimeState(snapshot.computerId);
    runtime.transitionLifecycle({ kind: "begin_boot", tick: 1 });
    runtime.createInitProcess({
      command: "/sbin/cs-init",
      gid: 0,
      startTick: 1,
      state: "running",
      uid: 0,
    });
    runtime.transitionLifecycle({ kind: "boot_complete", tick: 2 });
    const withRuntime = { ...snapshot, osRuntime: runtime.snapshot() };

    expect(isMigratableComputerSnapshot(withRuntime)).toBe(true);
    const migrated = migrateComputerSnapshot(withRuntime);
    expect(migrated).not.toBe(withRuntime);
    expect(migrated.osRuntime).toEqual(runtime.persistentSnapshot());
    expect(migrated.osRuntime).toMatchObject({
      computerId: snapshot.computerId,
      jobs: [],
      lifecycle: { phase: "off" },
      loginSessions: [],
      mounts: [],
      processes: [],
      schema: 1,
    });

    const mismatched = {
      ...withRuntime,
      osRuntime: { ...withRuntime.osRuntime, computerId: "computer-206" },
    };
    expect(isMigratableComputerSnapshot(mismatched)).toBe(false);
    expect(() => migrateComputerSnapshot(mismatched)).toThrow(
      "Invalid or unsupported computer snapshot",
    );
  });

  it("cold-migrates a customized Linux snapshot without rewriting identity, accounts, or filesystem state", (): void => {
    registerOsFilesystemImages();
    const record = new ComputerRecord("computer-207", "advanced", {
      label: "Customized Linux",
      osProfile: "linux",
    });
    installOsFilesystemImage(record.filesystem, "linux");
    const accounts = migrateLinuxAccountDatabase(record.filesystem);
    accounts.createGroup({ name: "builders" });
    accounts.createUser({
      gecos: "Alice Builder",
      name: "alice",
      primaryGroup: "builders",
      supplementaryGroups: ["sudo"],
    });

    record.filesystem.writeFile("/startup.py", "print('custom startup')\n");
    record.filesystem.writeFile("/etc/operator.conf", "mode=custom\n");
    record.filesystem.makeDirectory("/home/cs");
    record.filesystem.writeFile(
      "/home/cs/.bash_history",
      "echo preserved history\n",
    );
    record.filesystem.writeFile(
      "/var/log/messages",
      "persisted messages log\n",
    );
    record.filesystem.writeFile("/var/log/auth.log", "persisted auth log\n");
    record.filesystem.createHardLink("/startup.py", "/home/cs/startup-hard");
    record.filesystem.createSymbolicLink(
      "/startup.py",
      "/home/cs/startup-symbolic",
    );
    record.filesystem.delete("/usr/bin/ls");

    const runtime = new OsRuntimeState(record.computerId);
    runtime.transitionLifecycle({ kind: "begin_boot", tick: 1 });
    runtime.createInitProcess({
      command: "/sbin/cs-init",
      gid: 0,
      startTick: 1,
      state: "running",
      uid: 0,
    });
    runtime.registerService({ enabled: true, name: "getty", tick: 1 });
    runtime.mount({
      filesystemType: "csfs",
      mountedTick: 1,
      options: ["nosuid", "nodev"],
      readOnly: false,
      source: "computer-system",
      target: "/",
    });
    runtime.registerDevice({
      kind: "virtual",
      path: "/dev/null",
      state: "available",
      tick: 1,
    });
    runtime.transitionLifecycle({ kind: "boot_complete", tick: 2 });
    runtime.openLoginSession({
      gid: 1000,
      sessionId: "writer",
      terminal: "tty1",
      tick: 3,
      uid: 1000,
      username: "cs",
    });
    runtime.closeLoginSession("writer", 4, "logout");
    runtime.appendSystemJournal(2, "custom service ready");
    runtime.appendAuthJournal(3, "cs logged in");
    record.setOsRuntimeSnapshot(runtime.snapshot());

    const source = record.snapshot();
    const sourceFilesystem = source.filesystem;
    const sourceAccounts = accountFileContents(record);
    const migrated = migrateComputerSnapshot(source);

    expect(migrated.computerId).toBe("computer-207");
    expect(migrated.filesystem).toEqual(sourceFilesystem);
    expect(migrated.osRuntime).toEqual(runtime.persistentSnapshot());
    expect(migrated.osRuntime?.journal).toEqual(runtime.snapshot().journal);
    expect(migrateComputerSnapshot(migrated)).toBe(migrated);

    const restored = ComputerRecord.restore(migrated);
    expect(accountFileContents(restored)).toEqual(sourceAccounts);
    expect(
      openLinuxAccountDatabase(restored.filesystem).getUser("alice"),
    ).toMatchObject({
      gecos: "Alice Builder",
      gid: 1001,
      uid: 1001,
    });
    expect(restored.filesystem.readFile("/startup.py")).toBe(
      "print('custom startup')\n",
    );
    expect(restored.filesystem.readFile("/etc/operator.conf")).toBe(
      "mode=custom\n",
    );
    expect(restored.filesystem.readFile("/home/cs/.bash_history")).toBe(
      "echo preserved history\n",
    );
    expect(restored.filesystem.readFile("/var/log/messages")).toBe(
      "persisted messages log\n",
    );
    expect(restored.filesystem.getLinkCount("/startup.py")).toBe(2);
    expect(restored.filesystem.readLink("/home/cs/startup-symbolic")).toBe(
      "/startup.py",
    );
    expect(restored.filesystem.snapshot().tombstones).toContain("/usr/bin/ls");
  });

  it("adds no destructive changes while cold-migrating customized DOS FAT state", (): void => {
    registerOsFilesystemImages();
    const record = new ComputerRecord("computer-208", "advanced", {
      displayProfileId: "portable-vga-256k",
      hardware: portableComputerHardware,
      label: "Customized DOS",
      osProfile: "dos",
    });
    installOsFilesystemImage(record.filesystem, "dos");
    record.filesystem.writeFile(
      "/drives/c/config.sys",
      "DEVICE=C:\\DOS\\HIMEM.SYS\r\nDOS=HIGH,UMB\r\n",
    );
    record.filesystem.writeFile(
      "/drives/c/autoexec.bat",
      "@ECHO OFF\r\nSET SITE=CUSTOM\r\n",
    );
    record.filesystem.writeFile("/drives/c/history.txt", "DIR\r\nMEM /F\r\n");
    record.filesystem.writeFile("/drives/c/system.log", "operator log\r\n");
    record.filesystem.delete("/drives/c/dos/edit.com");

    const runtime = DosRuntimeState.create();
    const modifiedAtMilliseconds = Date.UTC(2026, 6, 16, 12, 34, 57);
    for (const path of [
      "C:\\CONFIG.SYS",
      "C:\\AUTOEXEC.BAT",
      "C:\\HISTORY.TXT",
      "C:\\SYSTEM.LOG",
    ]) {
      runtime.setFatMetadata(
        path,
        undefined,
        { kind: "file", modifiedAtMilliseconds },
        1,
      );
    }
    runtime.setFatAttributes(
      "C:\\CONFIG.SYS",
      dosFatAttribute.archive | dosFatAttribute.system,
      1,
    );
    runtime.setVolumeLabel("C", "WORKDISK", 1);
    record.setDosRuntimeSnapshot(runtime.snapshot());

    const source = record.snapshot();
    const migrated = migrateComputerSnapshot(source);

    expect(migrated).toBe(source);
    expect(migrated.computerId).toBe("computer-208");
    expect(migrated.filesystem).toEqual(source.filesystem);
    expect(migrated.dosRuntime).toEqual(runtime.persistentSnapshot());
    expect(migrateComputerSnapshot(migrated)).toBe(migrated);

    const restored = ComputerRecord.restore(migrated);
    expect(restored.filesystem.readFile("/drives/c/config.sys")).toBe(
      "DEVICE=C:\\DOS\\HIMEM.SYS\r\nDOS=HIGH,UMB\r\n",
    );
    expect(restored.filesystem.readFile("/drives/c/autoexec.bat")).toBe(
      "@ECHO OFF\r\nSET SITE=CUSTOM\r\n",
    );
    expect(restored.filesystem.readFile("/drives/c/history.txt")).toBe(
      "DIR\r\nMEM /F\r\n",
    );
    expect(restored.filesystem.snapshot().tombstones).toContain(
      "/drives/c/dos/edit.com",
    );
    const restoredRuntime = DosRuntimeState.restore(
      restored.dosRuntimeSnapshot,
    );
    expect(restoredRuntime.volumeLabel("C", 1)).toBe("WORKDISK");
    expect(restoredRuntime.fatMetadata("C:\\CONFIG.SYS", 1)).toEqual(
      runtime.fatMetadata("C:\\CONFIG.SYS", 1),
    );
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

function accountFileContents(record: ComputerRecord): Record<string, string> {
  return {
    group: record.filesystem.readFile(linuxAccountPaths.group),
    passwd: record.filesystem.readFile(linuxAccountPaths.passwd),
    shadow: record.filesystem.readFile(linuxAccountPaths.shadow),
  };
}
