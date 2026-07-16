import { describe, expect, it } from "vitest";

import { migrateComputerSnapshot } from "../../src/application/computer/snapshotMigration.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { DosRuntimeState } from "../../src/application/os/dosRuntimeState.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { unrestrictedGuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import {
  filesystemBlobPoolStats,
  InMemoryFilesystem,
  type SynchronousTransactionOperation,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("CS-DOS OS presence", (): void => {
  it("persists labels and FAT attributes and enforces read-only files", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });

    expect(shell.submit("ECHO VALUE > C:\\DATA.TXT").exitCode).toBe(0);
    expect(shell.submit("ATTRIB +H +R C:\\DATA.TXT").exitCode).toBe(0);
    expect(shell.submit("DIR C:\\ /B").stdout).not.toContain("DATA.TXT");
    expect(shell.submit("DIR C:\\ /B /A:H").stdout).toContain("DATA.TXT");
    expect(shell.submit("ECHO CHANGED > C:\\DATA.TXT")).toMatchObject({
      exitCode: 1,
    });
    expect(shell.submit("DEL C:\\DATA.TXT")).toMatchObject({ exitCode: 1 });
    expect(shell.submit("ATTRIB -R -H C:\\DATA.TXT").exitCode).toBe(0);
    expect(shell.submit("REN C:\\DATA.TXT SAVED.TXT").exitCode).toBe(0);
    expect(shell.submit("LABEL C: PROJECT").exitCode).toBe(0);

    const restored = DosRuntimeState.restore(state.persistentSnapshot());
    const nextShell = new ShellSession(filesystem, {
      dosRuntime: restored,
      osProfile: "dos",
    });
    expect(nextShell.submit("VOL C:").stdout).toContain(
      "Volume in drive C is PROJECT",
    );
    expect(nextShell.submit("ATTRIB C:\\SAVED.TXT").stdout).toContain(
      "C:\\SAVED.TXT",
    );
    const check = nextShell.submit("CHKDSK C:");
    expect(check).toMatchObject({ exitCode: 0 });
    expect(check.stdout).toContain(
      "CHKDSK found no filesystem metadata errors.",
    );
    expect(check.stdout).toContain(
      "Read-only check complete; no repairs were attempted.",
    );
  });

  it("migrates an existing schema-2 DOS Computer without renumbering it", (): void => {
    const record = new ComputerRecord("c-000845", "standard", {
      osProfile: "dos",
    });
    const legacyCurrent = record.snapshot();
    expect(legacyCurrent.dosRuntime).toBeUndefined();

    const migrated = migrateComputerSnapshot(legacyCurrent);

    expect(migrated.computerId).toBe(legacyCurrent.computerId);
    expect(migrated.schema).toBe(2);
    expect(migrated.dosRuntime).toMatchObject({ revision: 0, schema: 1 });
    expect(migrateComputerSnapshot(migrated)).toEqual(migrated);
    expect(ComputerRecord.restore(migrated).snapshot()).toEqual(migrated);
  });

  it("syncs live DOS state through Computer persistence and reboot restore", (): void => {
    const record = new ComputerRecord("c-000846", "standard", {
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    expect(runtime.register(record).outcome).toBe("accepted");
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");

    expect(
      runtime.executeDebugShellCommand(record.computerId, "LABEL C: ARCHIVE"),
    ).toMatchObject({ exitCode: 0, outcome: "completed" });
    const persisted = structuredClone(record.snapshot());
    expect(persisted.dosRuntime).toBeDefined();

    const restored = ComputerRecord.restore(persisted);
    const nextRuntime = new ComputerRuntime();
    nextRuntime.register(restored);
    nextRuntime.powerOn(restored.computerId);
    const volume = nextRuntime.executeDebugShellCommand(
      restored.computerId,
      "VOL C:",
    );
    expect(volume.outcome).toBe("completed");
    if (volume.outcome !== "completed") {
      throw new Error("restored DOS runtime did not execute VOL");
    }
    expect(volume.exitCode).toBe(0);
    expect(volume.stdout).toContain("Volume in drive C is ARCHIVE");
  });

  it("switches per-drive directories and reports media and write-protect changes", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    filesystem.makeDirectory("/drives/a");
    state.mountMedia("A", { generation: 1, volumeLabel: "WORK" });

    expect(shell.submit("A:").exitCode).toBe(0);
    expect(shell.submit("MD A:\\DOCS").exitCode).toBe(0);
    expect(shell.submit("CD A:\\DOCS").exitCode).toBe(0);
    expect(shell.submit("C:").exitCode).toBe(0);
    expect(shell.submit("CD C:\\DOS").exitCode).toBe(0);
    expect(shell.submit("A:").exitCode).toBe(0);
    expect(shell.submit("CD").stdout).toBe("A:\\DOCS\r\n");

    expect(state.ejectMedia("A", 1)).toBe(2);
    expect(shell.submit("DIR A:\\")).toMatchObject({ exitCode: 1 });
    expect(shell.submit("DIR A:\\").stderr).toContain(
      "No media in DOS drive A:",
    );
    state.mountMedia("A", {
      generation: 3,
      readOnly: true,
      volumeLabel: "LOCKED",
    });
    expect(shell.submit("A:").exitCode).toBe(0);
    expect(shell.submit("ECHO NO > A:\\NO.TXT")).toMatchObject({ exitCode: 1 });
    expect(filesystem.exists("/drives/a/no.txt")).toBe(false);
    expect(state.persistentSnapshot().drives).toMatchObject({
      activeDrive: "C",
    });
    expect(
      state
        .persistentSnapshot()
        .drives.drives.find(({ letter }) => letter === "A"),
    ).toMatchObject({ mediaPresent: false, readOnly: false });
  });

  it("renders the persisted FAT timestamp after restart instead of command time", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const writtenAt = Date.UTC(2026, 0, 2, 3, 4, 5, 900);
    const shell = new ShellSession(filesystem, {
      clock: fixedClock(writtenAt),
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("ECHO VALUE > C:\\STAMP.TXT").exitCode).toBe(0);
    const snapshot = state.persistentSnapshot();

    filesystem.setModifiedTime(
      "/drives/c/stamp.txt",
      Date.UTC(2035, 10, 12, 13, 14, 15),
    );
    const restored = new ShellSession(filesystem, {
      clock: fixedClock(Date.UTC(2040, 5, 6, 7, 8, 9)),
      dosRuntime: DosRuntimeState.restore(snapshot),
      osProfile: "dos",
    });

    expect(restored.submit("DIR C:\\STAMP.TXT").stdout).toContain(
      "01-02-26  03:04a",
    );
  });

  it("preflights FAT capacity before mutating file bytes or metadata", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create({
      limits: { maximumFatMetadataEntries: 1 },
    });
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    const before = state.snapshot();

    const result = shell.submit("ECHO VALUE > C:\\NOFILE.TXT");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("DOS FAT metadata capacity 1 exceeded");
    expect(filesystem.exists("/drives/c/nofile.txt")).toBe(false);
    expect(state.snapshot()).toEqual(before);
  });

  it("preflights a wildcard copy as one filesystem/FAT mutation plan", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create({
      limits: { maximumFatMetadataEntries: 5 },
    });
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    filesystem.writeFile("/drives/c/one.txt", "one");
    filesystem.writeFile("/drives/c/two.txt", "two");
    filesystem.makeDirectory("/drives/c/dest");
    const before = state.snapshot();

    const result = shell.submit("COPY C:\\*.TXT C:\\DEST");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("DOS FAT metadata capacity 5 exceeded");
    expect(filesystem.list("/drives/c/dest")).toEqual([]);
    expect(state.snapshot()).toEqual(before);
  });

  it("rolls back a wildcard COPY when the second filesystem write throws after mutation", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("MD C:\\DEST").exitCode).toBe(0);
    expect(shell.submit("ECHO ONE > C:\\ONE.TXT").exitCode).toBe(0);
    expect(shell.submit("ECHO TWO > C:\\TWO.TXT").exitCode).toBe(0);
    expect(shell.submit("ECHO OLD > C:\\DEST\\ONE.TXT").exitCode).toBe(0);
    filesystem.createHardLink(
      "/drives/c/dest/one.txt",
      "/drives/c/dest/peer.bak",
    );
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalTransaction = filesystem.transaction.bind(filesystem);
    let transactions = 0;
    filesystem.transaction = <Result>(
      operation: SynchronousTransactionOperation<Result>,
    ): Result => {
      transactions += 1;
      return originalTransaction(operation);
    };
    const originalWriteFile = filesystem.writeFile.bind(filesystem);
    let destinationWrites = 0;
    filesystem.writeFile = (path: string, contents: string): void => {
      originalWriteFile(path, contents);
      if (!path.startsWith("/drives/c/dest/")) return;
      destinationWrites += 1;
      if (destinationWrites === 2)
        throw new Error("injected second COPY write failure");
    };

    const result = shell.submit("COPY C:\\*.TXT C:\\DEST");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("injected second COPY write failure");
    expect(destinationWrites).toBe(2);
    expect(transactions).toBe(1);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
    expect(filesystem.readFile("/drives/c/dest/one.txt")).toBe(
      filesystem.readFile("/drives/c/dest/peer.bak"),
    );
    expect(filesystem.getLinkCount("/drives/c/dest/one.txt")).toBe(2);
  });

  it("rolls back bytes and FAT when the second wildcard COPY FAT update throws after commit", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("MD C:\\DEST").exitCode).toBe(0);
    expect(shell.submit("ECHO ONE > C:\\ONE.TXT").exitCode).toBe(0);
    expect(shell.submit("ECHO TWO > C:\\TWO.TXT").exitCode).toBe(0);
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalSetFatMetadata = state.setFatMetadata.bind(state);
    let injected = false;
    state.setFatMetadata = (
      ...arguments_: Parameters<DosRuntimeSetFatMetadata>
    ): ReturnType<DosRuntimeSetFatMetadata> => {
      const result = originalSetFatMetadata(...arguments_);
      if (arguments_[0] === "/drives/c/dest/two.txt") {
        injected = true;
        throw new Error("injected second COPY FAT failure");
      }
      return result;
    };

    const result = shell.submit("COPY C:\\*.TXT C:\\DEST");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("injected second COPY FAT failure");
    expect(injected).toBe(true);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
  });

  it("rolls back wildcard DEL when the second delete throws after unlinking", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("ECHO ONE > C:\\ONE.TXT").exitCode).toBe(0);
    expect(shell.submit("ECHO TWO > C:\\TWO.TXT").exitCode).toBe(0);
    filesystem.createHardLink("/drives/c/one.txt", "/drives/c/peer.bak");
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalDelete = filesystem.delete.bind(filesystem);
    let deletes = 0;
    filesystem.delete = (path: string): void => {
      originalDelete(path);
      if (!path.endsWith(".txt")) return;
      deletes += 1;
      if (deletes === 2) throw new Error("injected second DEL failure");
    };

    const result = shell.submit("DEL C:\\*.TXT");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("injected second DEL failure");
    expect(deletes).toBe(2);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
    expect(filesystem.getLinkCount("/drives/c/one.txt")).toBe(2);
  });

  it("rolls back wildcard REN when the second inode move throws after mutation", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("ECHO ONE > C:\\ONE.TXT").exitCode).toBe(0);
    expect(shell.submit("ECHO TWO > C:\\TWO.TXT").exitCode).toBe(0);
    filesystem.createHardLink("/drives/c/one.txt", "/drives/c/peer.bin");
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalMove = filesystem.move.bind(filesystem);
    let moves = 0;
    filesystem.move = (source: string, destination: string): void => {
      originalMove(source, destination);
      moves += 1;
      if (moves === 2) throw new Error("injected second REN failure");
    };

    const result = shell.submit("REN C:\\*.TXT *.BAK");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("injected second REN failure");
    expect(moves).toBe(2);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
    expect(filesystem.getLinkCount("/drives/c/one.txt")).toBe(2);
  });

  it("rolls back MOVE when FAT mutation throws after both aggregates changed", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("MD C:\\DEST").exitCode).toBe(0);
    expect(shell.submit("ECHO ONE > C:\\ONE.TXT").exitCode).toBe(0);
    filesystem.createHardLink("/drives/c/one.txt", "/drives/c/peer.bin");
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalMoveFatMetadata = state.moveFatMetadata.bind(state);
    let injected = false;
    state.moveFatMetadata = (
      ...arguments_: Parameters<typeof originalMoveFatMetadata>
    ): ReturnType<typeof originalMoveFatMetadata> => {
      originalMoveFatMetadata(...arguments_);
      injected = true;
      throw new Error("injected MOVE FAT failure");
    };

    const result = shell.submit("MOVE C:\\ONE.TXT C:\\DEST");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(
      "The system cannot find the file specified",
    );
    expect(injected).toBe(true);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
    expect(filesystem.getLinkCount("/drives/c/one.txt")).toBe(2);
  });

  it("rolls back wildcard ATTRIB when the second FAT mutation throws after commit", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("ECHO ONE > C:\\ONE.TXT").exitCode).toBe(0);
    expect(shell.submit("ECHO TWO > C:\\TWO.TXT").exitCode).toBe(0);
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalSetFatAttributes = state.setFatAttributes.bind(state);
    let changes = 0;
    state.setFatAttributes = (
      ...arguments_: Parameters<typeof originalSetFatAttributes>
    ): ReturnType<typeof originalSetFatAttributes> => {
      const result = originalSetFatAttributes(...arguments_);
      changes += 1;
      if (changes === 2) throw new Error("injected second ATTRIB failure");
      return result;
    };

    const result = shell.submit("ATTRIB +H C:\\*.TXT");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain("injected second ATTRIB failure");
    expect(changes).toBe(2);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
  });

  it("rolls back a single DOS write when its FAT commit throws after bytes change", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalSetFatMetadata = state.setFatMetadata.bind(state);
    let injected = false;
    state.setFatMetadata = (
      ...arguments_: Parameters<DosRuntimeSetFatMetadata>
    ): ReturnType<DosRuntimeSetFatMetadata> => {
      const result = originalSetFatMetadata(...arguments_);
      if (arguments_[0] === "/drives/c/value.txt") {
        injected = true;
        throw new Error("injected single write FAT failure");
      }
      return result;
    };

    const result = shell.submit("ECHO VALUE > C:\\VALUE.TXT");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(injected).toBe(true);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
  });

  it("rolls back MD when its FAT commit throws after directory creation", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalSetFatMetadata = state.setFatMetadata.bind(state);
    let injected = false;
    state.setFatMetadata = (
      ...arguments_: Parameters<DosRuntimeSetFatMetadata>
    ): ReturnType<DosRuntimeSetFatMetadata> => {
      const result = originalSetFatMetadata(...arguments_);
      if (arguments_[0] === "/drives/c/newdir") {
        injected = true;
        throw new Error("injected MD FAT failure");
      }
      return result;
    };

    const result = shell.submit("MD C:\\NEWDIR");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(injected).toBe(true);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
  });

  it("rolls back every MD operand when a later directory creation fails", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalTransaction = filesystem.transaction.bind(filesystem);
    let transactions = 0;
    filesystem.transaction = <Result>(
      operation: SynchronousTransactionOperation<Result>,
    ): Result => {
      transactions += 1;
      return originalTransaction(operation);
    };
    const originalMakeDirectory = filesystem.makeDirectory.bind(filesystem);
    let created = 0;
    filesystem.makeDirectory = (path: string): void => {
      originalMakeDirectory(path);
      if (!path.endsWith("/first") && !path.endsWith("/second")) return;
      created += 1;
      if (created === 2) throw new Error("injected second MD failure");
    };

    const result = shell.submit("MD C:\\FIRST C:\\SECOND");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(created).toBe(2);
    expect(transactions).toBe(1);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
  });

  it("rolls back RD when its FAT commit throws after directory deletion", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      osProfile: "dos",
    });
    expect(shell.submit("MD C:\\EMPTY").exitCode).toBe(0);
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    const originalDeleteFatMetadata = state.deleteFatMetadata.bind(state);
    let injected = false;
    state.deleteFatMetadata = (
      ...arguments_: Parameters<typeof originalDeleteFatMetadata>
    ): ReturnType<typeof originalDeleteFatMetadata> => {
      originalDeleteFatMetadata(...arguments_);
      injected = true;
      throw new Error("injected RD FAT failure");
    };

    const result = shell.submit("RD C:\\EMPTY");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(injected).toBe(true);
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
  });

  it("rolls back and re-publishes the cold aggregate when its commit observer throws", (): void => {
    const filesystem = new InMemoryFilesystem();
    const state = DosRuntimeState.create();
    let armed = false;
    const observations: ReturnType<DosRuntimeState["snapshot"]>[] = [];
    const shell = new ShellSession(filesystem, {
      dosRuntime: state,
      onDosRuntimeChanged: (current): void => {
        if (!armed) return;
        observations.push(structuredClone(current.snapshot()));
        if (observations.length === 1)
          throw new Error("injected DOS observer failure");
      },
      osProfile: "dos",
    });
    const beforeFilesystem = exactFilesystemState(filesystem);
    const beforeDos = structuredClone(state.snapshot());
    armed = true;

    const result = shell.submit("ECHO VALUE > C:\\OBSERVER.TXT");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(result.stderr).toContain(
      "The system cannot find the file specified",
    );
    expectExactAtomicState(filesystem, state, beforeFilesystem, beforeDos);
    expect(observations).toHaveLength(2);
    expect(observations[0]).not.toEqual(beforeDos);
    expect(observations[1]).toEqual(beforeDos);
  });

  it("rolls back drive selection and keeps the shell prompt coherent when its observer throws", (): void => {
    const fixture = observerFailureFixture();
    fixture.filesystem.makeDirectory("/drives/a");
    fixture.state.mountMedia("A", { generation: 1, volumeLabel: "WORK" });
    const beforeDos = structuredClone(fixture.state.snapshot());
    const beforePrompt = fixture.shell.prompt();
    fixture.arm();

    const result = fixture.shell.submit("A:");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(fixture.state.activeDrive).toBe("C");
    expect(fixture.shell.prompt()).toBe(beforePrompt);
    expectObserverRollback(fixture, beforeDos);
  });

  it("rolls back active-drive CHDIR and its shell directory when its observer throws", (): void => {
    const fixture = observerFailureFixture();
    expect(fixture.shell.submit("MD C:\\WORK").exitCode).toBe(0);
    const beforeDos = structuredClone(fixture.state.snapshot());
    const beforePrompt = fixture.shell.prompt();
    fixture.arm();

    const result = fixture.shell.submit("CD C:\\WORK");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(fixture.state.driveState("C").currentDirectory).toBe("\\");
    expect(fixture.shell.prompt()).toBe(beforePrompt);
    expectObserverRollback(fixture, beforeDos);
  });

  it("rolls back an inactive drive's remembered CHDIR when its observer throws", (): void => {
    const fixture = observerFailureFixture();
    fixture.filesystem.makeDirectory("/drives/a/docs");
    fixture.state.mountMedia("A", { generation: 1, volumeLabel: "WORK" });
    const beforeDos = structuredClone(fixture.state.snapshot());
    const beforePrompt = fixture.shell.prompt();
    fixture.arm();

    const result = fixture.shell.submit("CD A:\\DOCS");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(fixture.state.activeDrive).toBe("C");
    expect(fixture.state.driveState("A").currentDirectory).toBe("\\");
    expect(fixture.shell.prompt()).toBe(beforePrompt);
    expectObserverRollback(fixture, beforeDos);
  });

  it("rolls back LABEL and republishes the previous drive state when its observer throws", (): void => {
    const fixture = observerFailureFixture();
    const beforeDos = structuredClone(fixture.state.snapshot());
    const beforePrompt = fixture.shell.prompt();
    fixture.arm();

    const result = fixture.shell.submit("LABEL C: REJECTED");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(fixture.state.volumeLabel("C")).toBe("CS-DOS");
    expect(fixture.shell.prompt()).toBe(beforePrompt);
    expectObserverRollback(fixture, beforeDos);
  });

  it("rolls back lazily synthesized FAT metadata when a read observer throws", (): void => {
    const fixture = observerFailureFixture();
    fixture.filesystem.writeFile("/drives/c/lazy.txt", "value");
    const beforeDos = structuredClone(fixture.state.snapshot());
    const beforePrompt = fixture.shell.prompt();
    fixture.arm();

    const result = fixture.shell.submit("ATTRIB C:\\LAZY.TXT");

    expect(result).toMatchObject({ exitCode: 1 });
    expect(fixture.filesystem.readFile("/drives/c/lazy.txt")).toBe("value");
    expect(fixture.shell.prompt()).toBe(beforePrompt);
    expectObserverRollback(fixture, beforeDos);
  });

  it("preserves nested undo semantics and leaves non-DOS shell writes unchanged", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/data");
    filesystem.writeFile("/data/value", "before");
    filesystem.createHardLink("/data/value", "/data/peer");
    const before = exactFilesystemState(filesystem);

    expect(() =>
      filesystem.transaction(() => {
        filesystem.writeFile("/data/value", "outer");
        expect(() =>
          filesystem.transaction(() => {
            filesystem.writeFile("/data/value", "inner");
            throw new Error("inner failure");
          }),
        ).toThrow("inner failure");
        expect(filesystem.readFile("/data/value")).toBe("outer");
        expect(filesystem.readFile("/data/peer")).toBe("outer");
        throw new Error("outer failure");
      }),
    ).toThrow("outer failure");
    expect(exactFilesystemState(filesystem)).toEqual(before);

    const dosState = DosRuntimeState.create();
    const beforeDos = structuredClone(dosState.snapshot());
    expect(() =>
      dosState.transaction(() => {
        dosState.setVolumeLabel("C", "OUTER");
        expect(() =>
          dosState.transaction(() => {
            dosState.setVolumeLabel("C", "INNER");
            throw new Error("inner DOS failure");
          }),
        ).toThrow("inner DOS failure");
        expect(dosState.volumeLabel("C")).toBe("OUTER");
        throw new Error("outer DOS failure");
      }),
    ).toThrow("outer DOS failure");
    expect(dosState.snapshot()).toEqual(beforeDos);

    const otherFilesystem = new InMemoryFilesystem();
    const beforeOther = exactFilesystemState(otherFilesystem);
    expect(() =>
      filesystem.transaction(() => {
        otherFilesystem.writeFile("/cross-scope", "forbidden");
      }),
    ).toThrow("Cannot mutate another filesystem inside an active transaction");
    expect(exactFilesystemState(filesystem)).toEqual(before);
    expect(exactFilesystemState(otherFilesystem)).toEqual(beforeOther);

    const linuxFilesystem = new InMemoryFilesystem();
    const linux = new ShellSession(linuxFilesystem, {
      osProfile: "linux",
      requireLogin: false,
    });
    expect(linux.submit("echo linux > /tmp/atomic-boundary")).toMatchObject({
      exitCode: 0,
    });
    expect(linuxFilesystem.readFile("/tmp/atomic-boundary")).toBe("linux\n");
  });

  it("rejects explicit async DOS transactions and guards a disguised Promise through settlement", async (): Promise<void> => {
    const state = DosRuntimeState.create();
    const otherState = DosRuntimeState.create();
    const filesystem = new InMemoryFilesystem();
    const before = structuredClone(state.snapshot());
    const otherBefore = structuredClone(otherState.snapshot());
    const filesystemBefore = structuredClone(filesystem.snapshot());
    const explicitStages: string[] = [];
    const explicit = async (): Promise<void> => {
      explicitStages.push("before-await");
      state.setVolumeLabel("C", "UNSAFE1");
      await Promise.resolve();
      explicitStages.push("after-await");
      state.setVolumeLabel("C", "UNSAFE2");
    };

    expect(() =>
      state.transaction(
        explicit as unknown as SynchronousTransactionOperation<void>,
      ),
    ).toThrow("DOS runtime transactions require a synchronous callback");
    await Promise.resolve();
    expect(explicitStages).toEqual([]);
    expect(state.snapshot()).toEqual(before);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pending!: Promise<void>;
    let postAwaitError: unknown;
    let postAwaitOtherError: unknown;
    let postAwaitFilesystemError: unknown;
    const disguised = (): Promise<void> => {
      pending = (async (): Promise<void> => {
        state.setVolumeLabel("C", "BEFORE");
        await gate;
        try {
          state.setVolumeLabel("C", "AFTER");
        } catch (error: unknown) {
          postAwaitError = error;
        }
        try {
          otherState.setVolumeLabel("C", "ESCAPED");
        } catch (error: unknown) {
          postAwaitOtherError = error;
        }
        try {
          filesystem.writeFile("/escaped", "unsafe");
        } catch (error: unknown) {
          postAwaitFilesystemError = error;
        }
      })();
      return pending;
    };

    expect(() =>
      state.transaction(
        disguised as unknown as SynchronousTransactionOperation<void>,
      ),
    ).toThrow("DOS runtime transactions require a synchronous callback");
    expect(state.snapshot()).toEqual(before);
    expect(() => state.setVolumeLabel("C", "BLOCKED")).toThrow(
      "rejected asynchronous transaction is pending",
    );
    expect(() => otherState.setVolumeLabel("C", "BLOCKED")).toThrow(
      "rejected asynchronous transaction is pending",
    );
    expect(() => filesystem.writeFile("/blocked", "unsafe")).toThrow(
      "rejected asynchronous transaction is pending",
    );

    release();
    await pending;
    expect(postAwaitError).toMatchObject({ code: "transaction_async" });
    expect(postAwaitOtherError).toMatchObject({ code: "transaction_async" });
    expect(postAwaitFilesystemError).toMatchObject({
      code: "transaction_async",
    });
    expect(state.snapshot()).toEqual(before);
    expect(otherState.snapshot()).toEqual(otherBefore);
    expect(filesystem.snapshot()).toEqual(filesystemBefore);
    state.setVolumeLabel("C", "RELEASED");
    otherState.setVolumeLabel("C", "RELEASED");
    filesystem.writeFile("/released", "safe");
    expect(state.volumeLabel("C")).toBe("RELEASED");
    expect(otherState.volumeLabel("C")).toBe("RELEASED");
    expect(filesystem.readFile("/released")).toBe("safe");
  });

  it("enforces the synchronous GuestFilesystem transaction contract before and after await", async (): Promise<void> => {
    const filesystem = new InMemoryFilesystem();
    const dosState = DosRuntimeState.create();
    const guest = unrestrictedGuestFilesystem(filesystem);
    guest.writeFile("/value", "before");
    const before = structuredClone(filesystem.snapshot());
    const beforeDos = structuredClone(dosState.snapshot());
    const explicitStages: string[] = [];
    const explicit = async (): Promise<void> => {
      explicitStages.push("before-await");
      guest.writeFile("/value", "unsafe");
      await Promise.resolve();
      explicitStages.push("after-await");
      guest.writeFile("/value", "unsafe-again");
    };

    expect(() =>
      guest.transaction(
        explicit as unknown as SynchronousTransactionOperation<void>,
      ),
    ).toThrow("Filesystem transactions require a synchronous callback");
    await Promise.resolve();
    expect(explicitStages).toEqual([]);
    expect(filesystem.snapshot()).toEqual(before);

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pending!: Promise<void>;
    let postAwaitError: unknown;
    let postAwaitDosError: unknown;
    const disguised = (): Promise<void> => {
      pending = (async (): Promise<void> => {
        guest.writeFile("/value", "before-await");
        await gate;
        try {
          guest.writeFile("/value", "after-await");
        } catch (error: unknown) {
          postAwaitError = error;
        }
        try {
          dosState.setVolumeLabel("C", "ESCAPED");
        } catch (error: unknown) {
          postAwaitDosError = error;
        }
      })();
      return pending;
    };

    expect(() =>
      guest.transaction(
        disguised as unknown as SynchronousTransactionOperation<void>,
      ),
    ).toThrow("Filesystem transactions require a synchronous callback");
    expect(filesystem.snapshot()).toEqual(before);
    expect(() => guest.writeFile("/blocked", "pending")).toThrow(
      "rejected asynchronous transaction is pending",
    );
    expect(() => dosState.setVolumeLabel("C", "BLOCKED")).toThrow(
      "rejected asynchronous transaction is pending",
    );

    release();
    await pending;
    expect(postAwaitError).toMatchObject({ code: "transaction_async" });
    expect(postAwaitDosError).toMatchObject({ code: "transaction_async" });
    expect(filesystem.snapshot()).toEqual(before);
    expect(dosState.snapshot()).toEqual(beforeDos);
    guest.writeFile("/value", "released");
    dosState.setVolumeLabel("C", "RELEASED");
    expect(guest.readFile("/value")).toBe("released");
    expect(dosState.volumeLabel("C")).toBe("RELEASED");
  });

  it("surfaces the original and rollback errors if undo itself cannot complete", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.writeFile("/value", "before");
    const internalFiles = (
      filesystem as unknown as {
        readonly files: Map<string, string>;
      }
    ).files;
    internalFiles.clear = (): void => {
      throw new Error("injected rollback failure");
    };
    const originalFailure = new Error("injected operation failure");

    let observed: unknown;
    try {
      filesystem.transaction(() => {
        filesystem.writeFile("/value", "changed");
        throw originalFailure;
      });
    } catch (error: unknown) {
      observed = error;
    }

    expect(observed).toBeInstanceOf(AggregateError);
    expect(observed).toMatchObject({
      message: "Filesystem transaction rollback failed",
    });
    expect((observed as AggregateError).errors).toEqual([
      originalFailure,
      expect.objectContaining({ message: "injected rollback failure" }),
    ]);
  });
});

type DosRuntimeSetFatMetadata = DosRuntimeState["setFatMetadata"];

interface ObserverFailureFixture {
  readonly arm: () => void;
  readonly filesystem: InMemoryFilesystem;
  readonly observations: ReturnType<DosRuntimeState["snapshot"]>[];
  readonly shell: ShellSession;
  readonly state: DosRuntimeState;
}

function observerFailureFixture(): ObserverFailureFixture {
  const filesystem = new InMemoryFilesystem();
  const state = DosRuntimeState.create();
  const observations: ReturnType<DosRuntimeState["snapshot"]>[] = [];
  let armed = false;
  let injected = false;
  const shell = new ShellSession(filesystem, {
    dosRuntime: state,
    onDosRuntimeChanged: (current): void => {
      if (!armed) return;
      observations.push(structuredClone(current.snapshot()));
      if (!injected) {
        injected = true;
        throw new Error("injected DOS observer failure");
      }
    },
    osProfile: "dos",
  });
  return {
    arm: (): void => {
      armed = true;
    },
    filesystem,
    observations,
    shell,
    state,
  };
}

function expectObserverRollback(
  fixture: ObserverFailureFixture,
  beforeDos: ReturnType<DosRuntimeState["snapshot"]>,
): void {
  expect(fixture.state.snapshot()).toEqual(beforeDos);
  expect(fixture.observations).toHaveLength(2);
  expect(fixture.observations[0]).not.toEqual(beforeDos);
  expect(fixture.observations[1]).toEqual(beforeDos);
}

interface ExactFilesystemState {
  readonly blobPool: ReturnType<typeof filesystemBlobPoolStats>;
  readonly freeSpace: number;
  readonly inodeIds: readonly (readonly [string, number])[];
  readonly revision: number;
  readonly snapshot: ReturnType<InMemoryFilesystem["snapshot"]>;
}

function exactFilesystemState(
  filesystem: InMemoryFilesystem,
): ExactFilesystemState {
  const inodeIds = [
    ...(
      filesystem as unknown as {
        readonly hardLinkIds: ReadonlyMap<string, number>;
      }
    ).hardLinkIds,
  ].sort(([left], [right]) => left.localeCompare(right));
  return {
    blobPool: filesystemBlobPoolStats(),
    freeSpace: filesystem.getFreeSpace(),
    inodeIds,
    revision: filesystem.revision,
    snapshot: structuredClone(filesystem.snapshot()),
  };
}

function expectExactAtomicState(
  filesystem: InMemoryFilesystem,
  state: DosRuntimeState,
  beforeFilesystem: ExactFilesystemState,
  beforeDos: ReturnType<DosRuntimeState["snapshot"]>,
): void {
  expect(exactFilesystemState(filesystem)).toEqual(beforeFilesystem);
  expect(state.snapshot()).toEqual(beforeDos);
}

function fixedClock(milliseconds: number): {
  readonly currentGameTime: () => {
    readonly absoluteTicks: number;
    readonly timeOfDay: number;
  };
  readonly currentWallTimeMilliseconds: () => number;
} {
  return {
    currentGameTime: () => ({ absoluteTicks: 0, timeOfDay: 0 }),
    currentWallTimeMilliseconds: () => milliseconds,
  };
}
