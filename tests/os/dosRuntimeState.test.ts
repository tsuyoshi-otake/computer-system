import { describe, expect, it } from "vitest";

import {
  DosDriveTable,
  DosRuntimeState,
  dosFatAttribute,
  expandDosFileSpec,
  hasDosFatAttribute,
  isValidDosCreatedName,
  matchesDosFileSpec,
  migrateDosFatMetadata,
  normalizeDosCreatedName,
  packDosFatTimestamp,
  truncateToDosFatTimestamp,
  unpackDosFatTimestamp,
} from "../../src/application/os/dosRuntimeState.js";

describe("DOS drive runtime state", (): void => {
  it("persists active/per-drive state and rejects stale or absent media", (): void => {
    const drives = DosDriveTable.create({
      activeDrive: "C",
      drives: [
        { letter: "A", mediaGeneration: 0 },
        {
          currentDirectory: "\\WORK",
          letter: "C",
          media: { generation: 1, volumeLabel: "CS-DOS" },
        },
      ],
    });

    expect(drives.activeState(1)).toMatchObject({
      currentDirectory: "\\WORK",
      letter: "C",
      volumeLabel: "CS-DOS",
    });
    expect(() => drives.requireMedia("A", 0)).toThrowError(
      expect.objectContaining({ code: "no_media", drive: "A" }),
    );

    drives.mountMedia("A:", {
      generation: 1,
      readOnly: false,
      volumeLabel: "TOOLS",
    });
    drives.selectDrive("a", 1);
    drives.setCurrentDirectory("A", "\\SRC\\..\\BIN", 1);
    const restored = DosDriveTable.restore(drives.snapshot());

    expect(restored.activeDrive).toBe("A");
    expect(restored.activeState(1)).toMatchObject({
      currentDirectory: "\\BIN",
      volumeLabel: "TOOLS",
    });
    expect(restored.ejectMedia("A", 1)).toBe(2);
    expect(() => restored.requireMedia("A", 1)).toThrowError(
      expect.objectContaining({
        actualGeneration: 2,
        code: "media_changed",
        expectedGeneration: 1,
      }),
    );
    expect(() => restored.requireMedia("A", 2)).toThrowError(
      expect.objectContaining({ code: "no_media" }),
    );
  });

  it("keeps read-only media and generation changes explicit", (): void => {
    const drives = DosDriveTable.create({
      activeDrive: "C",
      drives: [
        { letter: "A", mediaGeneration: 4 },
        { letter: "C", media: { generation: 1, volumeLabel: "SYSTEM" } },
      ],
    });

    drives.mountMedia("A", {
      generation: 5,
      readOnly: true,
      volumeLabel: "INSTALL",
    });
    expect(() => drives.assertWritable("A", 5)).toThrowError(
      expect.objectContaining({ code: "read_only" }),
    );
    expect(() => drives.mountMedia("A", { generation: 6 })).toThrowError(
      expect.objectContaining({ code: "media_changed" }),
    );
    expect(() => drives.setVolumeLabel("A", "NEW", 5)).toThrowError(
      expect.objectContaining({ code: "read_only" }),
    );
  });

  it("validates a mount completely before changing exported drive state", (): void => {
    const drives = DosDriveTable.create({
      activeDrive: "C",
      drives: [
        { letter: "A", mediaGeneration: 0 },
        { letter: "C", media: { generation: 1 } },
      ],
    });
    const before = drives.snapshot();

    expect(() =>
      drives.mountMedia("A", { generation: 1, volumeLabel: "BAD*LABEL" }),
    ).toThrowError(/Invalid DOS volume label/u);
    expect(drives.snapshot()).toEqual(before);
  });

  it("strictly restores canonical snapshots and cold-drive invariants", (): void => {
    expect(() =>
      DosDriveTable.create({
        activeDrive: "C",
        drives: [
          { currentDirectory: "\\STALE", letter: "A", mediaGeneration: 0 },
          { letter: "C", media: { generation: 1 } },
        ],
      }),
    ).toThrowError(/cannot retain a current directory/u);

    const snapshot = DosDriveTable.create({
      activeDrive: "C",
      drives: [
        { letter: "A", mediaGeneration: 0 },
        {
          currentDirectory: "\\WORK",
          letter: "C",
          media: { generation: 1, volumeLabel: "SYSTEM" },
        },
      ],
    }).snapshot();
    const a = snapshot.drives[0]!;
    const c = snapshot.drives[1]!;

    for (const invalid of [
      { ...snapshot, activeDrive: "c" },
      { ...snapshot, drives: [{ ...a, letter: "a" }, c] },
      { ...snapshot, drives: [a, { ...c, currentDirectory: "\\work" }] },
      { ...snapshot, drives: [a, { ...c, volumeLabel: "system" }] },
    ]) {
      expect(() => DosDriveTable.restore(invalid)).toThrowError(/canonical/u);
    }
    expect(() =>
      DosDriveTable.restore({ ...snapshot, unexpected: true }),
    ).toThrowError(/Invalid DOS drive-table snapshot/u);
    expect(() =>
      DosDriveTable.restore({
        ...snapshot,
        drives: [{ ...a, unexpected: true }, c],
      }),
    ).toThrowError(/Invalid DOS drive-table entry/u);
    expect(() =>
      DosDriveTable.restore({
        ...snapshot,
        drives: [{ ...a, currentDirectory: "\\STALE" }, c],
      }),
    ).toThrowError(/Absent DOS media cannot retain directory/u);
    expect(() =>
      DosDriveTable.restore({ ...snapshot, drives: [c, a] }),
    ).toThrowError(/canonically ordered/u);
  });
});

describe("bounded aggregate DOS runtime state", (): void => {
  it("round-trips drive, label, attributes, timestamps, and revision", (): void => {
    const state = DosRuntimeState.create();
    const firstTime = Date.UTC(2026, 6, 16, 12, 34, 57, 987);
    const secondTime = Date.UTC(2026, 6, 16, 12, 35, 1, 999);

    expect(state.revision).toBe(0);
    expect(state.activeDrive).toBe("C");
    expect(state.volumeLabel("C", 1)).toBe("CS-DOS");
    state.setFatMetadata(
      "/drives/c/work",
      undefined,
      {
        kind: "directory",
        modifiedAtMilliseconds: firstTime,
      },
      1,
    );
    state.setFatMetadata(
      "c:\\work\\readme.txt",
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds: firstTime,
      },
      1,
    );
    state.setFatAttribute(
      "C:\\WORK\\README.TXT",
      dosFatAttribute.hidden,
      true,
      1,
    );
    state.setFatAttributes(
      "C:\\WORK\\README.TXT",
      state.fatAttributes("C:\\WORK\\README.TXT", 1) | dosFatAttribute.system,
      1,
    );
    state.setFatModifiedTime("C:\\WORK\\README.TXT", secondTime, 1);
    state.setVolumeLabel("C", "SYSTEM", 1);
    const revision = state.revision;
    state.setVolumeLabel("c:", "system", 1);

    expect(state.revision).toBe(revision);
    expect(state.fatMetadataCount).toBe(2);
    expect(state.volumeLabel("C", 1)).toBe("SYSTEM");
    expect(
      hasDosFatAttribute(
        state.fatAttributes("c:\\work\\readme.txt", 1),
        dosFatAttribute.hidden,
      ),
    ).toBe(true);
    expect(
      hasDosFatAttribute(
        state.fatAttributes("c:\\work\\readme.txt", 1),
        dosFatAttribute.system,
      ),
    ).toBe(true);
    expect(
      state.fatMetadata("C:\\WORK\\README.TXT", 1)?.modifiedAtMilliseconds,
    ).toBe(Date.UTC(2026, 6, 16, 12, 35));
    expect(state.snapshot().fatMetadata.map(([path]) => path)).toEqual([
      "C:\\WORK",
      "C:\\WORK\\README.TXT",
    ]);

    const restored = DosRuntimeState.restore(state.snapshot());
    expect(restored.snapshot()).toEqual(state.snapshot());
    expect(restored.revision).toBe(revision);
  });

  it("copies, moves, and deletes complete metadata subtrees atomically", (): void => {
    const state = DosRuntimeState.create();
    const timestamp = Date.UTC(2026, 0, 1);
    for (const [path, kind] of [
      ["C:\\SRC", "directory"],
      ["C:\\SRC\\ONE.TXT", "file"],
      ["C:\\SRC\\SUB", "directory"],
      ["C:\\SRC\\SUB\\TWO.TXT", "file"],
    ] as const) {
      state.setFatMetadata(
        path,
        undefined,
        {
          kind,
          modifiedAtMilliseconds: timestamp,
        },
        1,
      );
    }

    const copyRevision = state.revision;
    expect(state.copyFatMetadata("c:\\src", "C:\\COPY", 1, 1)).toBe(4);
    expect(state.revision).toBe(copyRevision + 1);
    expect(state.fatMetadata("C:\\COPY\\SUB\\TWO.TXT", 1)).toMatchObject({
      attributes: dosFatAttribute.archive,
    });

    const collisionSnapshot = state.snapshot();
    expect(() =>
      state.copyFatMetadata("C:\\SRC", "C:\\COPY", 1, 1),
    ).toThrowError(expect.objectContaining({ code: "destination_exists" }));
    expect(state.snapshot()).toEqual(collisionSnapshot);

    const moveRevision = state.revision;
    expect(state.moveFatMetadata("C:\\COPY", "C:\\MOVED", 1, 1)).toBe(4);
    expect(state.revision).toBe(moveRevision + 1);
    expect(state.fatMetadata("C:\\COPY", 1)).toBeUndefined();
    expect(state.fatMetadata("C:\\MOVED\\SUB\\TWO.TXT", 1)).toBeDefined();

    const deleteRevision = state.revision;
    expect(state.deleteFatMetadata("C:\\SRC", 1)).toBe(4);
    expect(state.revision).toBe(deleteRevision + 1);
    expect(state.fatMetadataCount).toBe(4);
  });

  it("preflights path and metadata capacity without partial mutation", (): void => {
    const state = DosRuntimeState.create({
      limits: { maximumFatMetadataEntries: 3, maximumPathLength: 16 },
    });
    const timestamp = Date.UTC(2026, 0, 1);
    state.setFatMetadata(
      "C:\\SRC",
      undefined,
      {
        kind: "directory",
        modifiedAtMilliseconds: timestamp,
      },
      1,
    );
    state.setFatMetadata(
      "C:\\SRC\\A.TXT",
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds: timestamp,
      },
      1,
    );
    state.setFatMetadata(
      "C:\\B.TXT",
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds: timestamp,
      },
      1,
    );
    const before = state.snapshot();

    expect(() =>
      state.copyFatMetadata("C:\\SRC", "C:\\DST", 1, 1),
    ).toThrowError(expect.objectContaining({ code: "capacity" }));
    expect(() =>
      state.moveFatMetadata("C:\\SRC", "C:\\LONGDEST", 1, 1),
    ).toThrowError(/exceeds 16 characters/u);
    expect(() =>
      state.setFatMetadata(
        "C:\\C.TXT",
        undefined,
        {
          kind: "file",
          modifiedAtMilliseconds: timestamp,
        },
        1,
      ),
    ).toThrowError(expect.objectContaining({ code: "capacity" }));
    expect(() => state.fatMetadata("C:\\TOOLONG\\NAME.TXT", 1)).toThrowError(
      /exceeds 16 characters/u,
    );
    expect(state.snapshot()).toEqual(before);
  });

  it("cold-persistent snapshots keep C but force A to absent", (): void => {
    const timestamp = Date.UTC(2026, 0, 1);
    const drives = DosDriveTable.create({
      activeDrive: "A",
      drives: [
        {
          currentDirectory: "\\TOOLS",
          letter: "A",
          media: { generation: 7, volumeLabel: "INSTALL" },
        },
        {
          currentDirectory: "\\WORK",
          letter: "C",
          media: { generation: 3, volumeLabel: "SYSTEM" },
        },
      ],
    });
    const live = DosRuntimeState.create({ driveTable: drives });
    live.setFatMetadata(
      "C:\\KEEP.TXT",
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds: timestamp,
      },
      3,
    );
    live.setFatMetadata(
      "A:\\DROP.TXT",
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds: timestamp,
      },
      7,
    );

    const persistent = live.persistentSnapshot();
    const persistentA = persistent.drives.drives.find(
      ({ letter }) => letter === "A",
    );
    const persistentC = persistent.drives.drives.find(
      ({ letter }) => letter === "C",
    );

    expect(persistent.drives.activeDrive).toBe("C");
    expect(persistentA).toEqual({
      currentDirectory: "\\",
      letter: "A",
      mediaGeneration: 7,
      mediaPresent: false,
      readOnly: false,
      volumeLabel: "",
    });
    expect(persistentC).toEqual(live.driveState("C"));
    expect(persistent.fatMetadata.map(([path]) => path)).toEqual([
      "C:\\KEEP.TXT",
    ]);
    expect(live.activeDrive).toBe("A");
    expect(live.driveState("A").mediaPresent).toBe(true);
    expect(live.fatMetadata("A:\\DROP.TXT", 7)).toBeDefined();
    expect(DosRuntimeState.restore(persistent).snapshot()).toEqual(persistent);
  });

  it("owns media transitions, clears stale A metadata, and tracks one revision", (): void => {
    const state = DosRuntimeState.create();
    state.mountMedia("A", { generation: 1, volumeLabel: "TOOLS" });
    state.setFatMetadata(
      "A:\\ONE.TXT",
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds: Date.UTC(2026, 0, 1),
      },
      1,
    );
    state.selectDrive("A", 1);
    state.setCurrentDirectory("A", "\\WORK", 1);
    const beforeEject = state.revision;

    expect(state.ejectMedia("A", 1)).toBe(2);
    expect(state.revision).toBe(beforeEject + 1);
    expect(state.activeDrive).toBe("C");
    expect(state.driveState("A")).toMatchObject({
      currentDirectory: "\\",
      mediaGeneration: 2,
      mediaPresent: false,
    });
    expect(state.fatMetadataCount).toBe(0);

    state.mountMedia("A", {
      generation: 3,
      readOnly: true,
      volumeLabel: "INSTALL",
    });
    const readOnlyRevision = state.revision;
    expect(() => state.setVolumeLabel("A", "NEW", 3)).toThrowError(
      expect.objectContaining({ code: "read_only" }),
    );
    expect(state.revision).toBe(readOnlyRevision);
  });

  it("binds FAT reads and mutations to the observed media generation", (): void => {
    const state = DosRuntimeState.create();
    const timestamp = Date.UTC(2026, 0, 1);
    state.setFatMetadata(
      "C:\\SOURCE.TXT",
      undefined,
      { kind: "file", modifiedAtMilliseconds: timestamp },
      1,
    );
    state.mountMedia("A", { generation: 1, volumeLabel: "FIRST" });
    state.setFatMetadata(
      "A:\\OLD.TXT",
      undefined,
      { kind: "file", modifiedAtMilliseconds: timestamp },
      1,
    );
    state.ejectMedia("A", 1);
    state.mountMedia("A", { generation: 3, volumeLabel: "SECOND" });
    const before = state.snapshot();

    const staleOperations: readonly (() => unknown)[] = [
      (): unknown => state.fatMetadata("A:\\OLD.TXT", 1),
      (): unknown => state.fatAttributes("A:\\OLD.TXT", 1),
      (): unknown =>
        state.setFatMetadata(
          "A:\\NEW.TXT",
          undefined,
          { kind: "file", modifiedAtMilliseconds: timestamp },
          1,
        ),
      (): unknown =>
        state.setFatAttributes("A:\\OLD.TXT", dosFatAttribute.archive, 1),
      (): unknown =>
        state.setFatAttribute("A:\\OLD.TXT", dosFatAttribute.hidden, true, 1),
      (): unknown => state.setFatModifiedTime("A:\\OLD.TXT", timestamp, 1),
      (): unknown => state.deleteFatMetadata("A:\\OLD.TXT", 1),
      (): unknown =>
        state.copyFatMetadata("C:\\SOURCE.TXT", "A:\\COPY.TXT", 1, 1),
      (): unknown => state.copyFatMetadata("A:\\OLD.TXT", "C:\\COPY.TXT", 1, 1),
      (): unknown =>
        state.moveFatMetadata("C:\\SOURCE.TXT", "A:\\MOVED.TXT", 1, 1),
    ];
    for (const operation of staleOperations) {
      expect(operation).toThrowError(
        expect.objectContaining({
          actualGeneration: 3,
          code: "media_changed",
          drive: "A",
          expectedGeneration: 1,
        }),
      );
      expect(state.snapshot()).toEqual(before);
    }

    const untypedState = state as unknown as {
      copyFatMetadata(
        source: string,
        destination: string,
        sourceExpectedGeneration?: number,
        destinationExpectedGeneration?: number,
      ): number;
      deleteFatMetadata(path: string, expectedGeneration?: number): number;
      fatMetadata(path: string, expectedGeneration?: number): unknown;
    };
    const generationlessOperations: readonly (() => unknown)[] = [
      (): unknown => untypedState.fatMetadata("C:\\SOURCE.TXT"),
      (): unknown =>
        untypedState.deleteFatMetadata("C:\\SOURCE.TXT", undefined),
      (): unknown =>
        untypedState.copyFatMetadata(
          "C:\\SOURCE.TXT",
          "A:\\COPY.TXT",
          undefined,
          3,
        ),
      (): unknown =>
        untypedState.copyFatMetadata(
          "C:\\SOURCE.TXT",
          "A:\\COPY.TXT",
          1,
          undefined,
        ),
    ];
    for (const operation of generationlessOperations) {
      expect(operation).toThrowError(
        /DOS media generation must be a non-negative integer/u,
      );
      expect(state.snapshot()).toEqual(before);
    }

    state.setFatMetadata(
      "A:\\NEW.TXT",
      undefined,
      { kind: "file", modifiedAtMilliseconds: timestamp },
      3,
    );
    expect(state.fatMetadata("A:\\NEW.TXT", 3)).toBeDefined();
  });

  it("rejects non-canonical, duplicate, and structurally invalid snapshots", (): void => {
    const state = DosRuntimeState.create();
    state.setFatMetadata(
      "C:\\ONE.TXT",
      undefined,
      {
        kind: "file",
        modifiedAtMilliseconds: Date.UTC(2026, 0, 1),
      },
      1,
    );
    const snapshot = state.snapshot();
    const metadata = snapshot.fatMetadata[0]![1];

    expect(() =>
      DosRuntimeState.restore({
        ...snapshot,
        fatMetadata: [["c:\\one.txt", metadata]],
      }),
    ).toThrowError(/canonical and unique/u);
    expect(() =>
      DosRuntimeState.restore({
        ...snapshot,
        fatMetadata: [snapshot.fatMetadata[0], snapshot.fatMetadata[0]],
      }),
    ).toThrowError(/canonical and unique/u);
    expect(() =>
      DosRuntimeState.restore({
        ...snapshot,
        extra: true,
      }),
    ).toThrowError(/Invalid DOS runtime-state snapshot/u);
    expect(() =>
      DosRuntimeState.restore({
        ...snapshot,
        fatMetadata: [
          [
            "C:\\ONE.TXT",
            {
              ...metadata,
              modifiedAtMilliseconds: Date.UTC(2026, 0, 1, 0, 0, 1),
            },
          ],
        ],
      }),
    ).toThrowError(/timestamp is not canonical/u);
    expect(() =>
      DosRuntimeState.restore({
        ...snapshot,
        fatMetadata: [
          ["C:\\PARENT.TXT", metadata],
          ["C:\\PARENT.TXT\\CHILD.TXT", metadata],
        ],
      }),
    ).toThrowError(/ancestor is not a directory/u);

    const exhausted = DosRuntimeState.restore({
      ...snapshot,
      revision: Number.MAX_SAFE_INTEGER,
    });
    const exhaustedSnapshot = exhausted.snapshot();
    expect(() => exhausted.setVolumeLabel("C", "SYSTEM")).toThrowError(
      expect.objectContaining({ code: "revision_exhausted" }),
    );
    expect(exhausted.snapshot()).toEqual(exhaustedSnapshot);
  });
});

describe("bounded DOS file specs", (): void => {
  it("matches and expands wildcard specs without accepting them as creation names", (): void => {
    expect(isValidDosCreatedName("README.TXT")).toBe(true);
    expect(isValidDosCreatedName("*.TXT")).toBe(false);
    expect(() => normalizeDosCreatedName("*.TXT")).toThrowError(
      expect.objectContaining({ code: "invalid_name" }),
    );

    expect(matchesDosFileSpec("README.TXT", "*.TXT")).toBe(true);
    expect(matchesDosFileSpec("README", "*.*")).toBe(true);
    expect(matchesDosFileSpec("A1.C", "A?.?")).toBe(true);
    expect(matchesDosFileSpec("A.C", "A?.?")).toBe(false);
    expect(
      expandDosFileSpec(
        ["ZETA.TXT", "README", "ALPHA.TXT", "IMAGE.PCX"],
        "*.TXT",
      ),
    ).toEqual(["ALPHA.TXT", "ZETA.TXT"]);
  });

  it("terminates entry, duplicate, and match overflow explicitly", (): void => {
    expect(() =>
      expandDosFileSpec(["A.TXT", "B.TXT"], "*.*", {
        maximumEntries: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "entry_limit" }));
    expect(() => expandDosFileSpec(["A.TXT", "a.txt"], "*.*")).toThrowError(
      expect.objectContaining({ code: "duplicate_entry" }),
    );
    expect(() =>
      expandDosFileSpec(["A.TXT", "B.TXT"], "*.TXT", {
        maximumMatches: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: "match_limit" }));
  });
});

describe("DOS FAT metadata", (): void => {
  it("uses UTC FAT words and two-second timestamp precision", (): void => {
    const source = Date.UTC(2026, 6, 16, 12, 34, 57, 987);
    const normalized = Date.UTC(2026, 6, 16, 12, 34, 56);

    expect(truncateToDosFatTimestamp(source)).toBe(normalized);
    expect(unpackDosFatTimestamp(packDosFatTimestamp(source))).toBe(normalized);
  });

  it("migrates legacy metadata with deterministic FAT attribute defaults", (): void => {
    const modifiedAtMilliseconds = Date.UTC(2026, 0, 1, 0, 0, 1);
    const file = migrateDosFatMetadata(
      { mode: 0o444, modifiedAtMilliseconds },
      { kind: "file", modifiedAtMilliseconds: 0 },
    );
    const directory = migrateDosFatMetadata(undefined, {
      kind: "directory",
      modifiedAtMilliseconds,
    });

    expect(hasDosFatAttribute(file.attributes, dosFatAttribute.archive)).toBe(
      true,
    );
    expect(hasDosFatAttribute(file.attributes, dosFatAttribute.readOnly)).toBe(
      true,
    );
    expect(
      hasDosFatAttribute(directory.attributes, dosFatAttribute.directory),
    ).toBe(true);
    expect(directory.modifiedAtMilliseconds % 2_000).toBe(0);
    expect(() =>
      migrateDosFatMetadata(
        { attributes: 0, modifiedAtMilliseconds, schema: 2 },
        { kind: "file", modifiedAtMilliseconds },
      ),
    ).toThrowError(/Unsupported DOS FAT metadata schema/u);
    expect(() =>
      migrateDosFatMetadata(
        { modifiedAtMilliseconds, schema: 1 },
        { kind: "file", modifiedAtMilliseconds },
      ),
    ).toThrowError(/Invalid DOS FAT metadata/u);
    expect(() =>
      migrateDosFatMetadata(
        {
          attributes: dosFatAttribute.directory,
          modifiedAtMilliseconds,
          schema: 1,
        },
        { kind: "file", modifiedAtMilliseconds },
      ),
    ).toThrowError(/do not describe a file/u);
  });
});
