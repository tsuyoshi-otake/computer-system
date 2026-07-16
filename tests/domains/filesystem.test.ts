import { describe, expect, it } from "vitest";

import {
  FilesystemError,
  InMemoryFilesystem,
  migrateLegacyInMemoryFilesystemSnapshot,
  type FilesystemLimits,
  type SynchronousTransactionOperation,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

const limits: FilesystemLimits = {
  capacityBytes: 20,
  maxEntries: 6,
  maxFileBytes: 12,
  maxPathLength: 30,
};

describe("in-memory filesystem", (): void => {
  it("normalizes paths and supports deterministic directory and file operations", (): void => {
    const filesystem = new InMemoryFilesystem(limits);
    filesystem.makeDirectory("/programs/examples");
    filesystem.writeFile("programs/examples/hello.py", "print(1)");
    filesystem.appendFile("/programs/examples/hello.py", "\n");

    expect(filesystem.normalize("/programs/./examples/../examples")).toBe(
      "/programs/examples",
    );
    expect(filesystem.list("/")).toEqual(["programs"]);
    expect(filesystem.list("/programs/examples")).toEqual(["hello.py"]);
    expect(filesystem.readFile("/programs/examples/hello.py")).toBe(
      "print(1)\n",
    );
    expect(filesystem.getSize("/programs/examples/hello.py")).toBe(9);
    expect(filesystem.getFreeSpace()).toBe(11);
  });

  it("copies, moves, and recursively deletes without partial mutations", (): void => {
    const filesystem = new InMemoryFilesystem(limits);
    filesystem.makeDirectory("/data");
    filesystem.writeFile("/data/a", "abc");
    filesystem.copy("/data/a", "/data/b");
    filesystem.move("/data/b", "/data/c");

    expect(filesystem.list("/data")).toEqual(["a", "c"]);
    expect(filesystem.readFile("/data/c")).toBe("abc");
    filesystem.delete("/data");
    expect(filesystem.exists("/data")).toBe(false);
    expect(filesystem.getFreeSpace()).toBe(20);
  });

  it("copies and moves complete directory trees atomically", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 40,
      maxEntries: 12,
    });
    filesystem.makeDirectory("/source/nested");
    filesystem.makeDirectory("/target");
    filesystem.writeFile("/source/nested/a", "abc");

    filesystem.copy("/source", "/copy");
    filesystem.move("/copy", "/target/moved");

    expect(filesystem.readFile("/source/nested/a")).toBe("abc");
    expect(filesystem.readFile("/target/moved/nested/a")).toBe("abc");
    expect(filesystem.exists("/copy")).toBe(false);
    expect(() => filesystem.copy("/source", "/source/inside")).toThrow(
      /inside source/u,
    );
    expect(filesystem.exists("/source/inside")).toBe(false);
  });

  it("moves internal and external hard links on a full disk without recreating inodes", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 20,
      maxEntries: 20,
      maxFileBytes: 20,
    });
    filesystem.makeDirectory("/source");
    filesystem.makeDirectory("/outside");
    filesystem.writeFile("/source/internal", "four");
    filesystem.createHardLink("/source/internal", "/source/internal-2");
    filesystem.writeFile("/source/shared", "share");
    filesystem.createHardLink("/source/shared", "/outside/shared");
    filesystem.writeFile("/outside/fill", "12345678901");
    expect(filesystem.getFreeSpace()).toBe(0);
    const revision = filesystem.revision;

    filesystem.move("/source", "/moved");

    expect(filesystem.getFreeSpace()).toBe(0);
    expect(filesystem.revision).toBe(revision + 1);
    expect(filesystem.exists("/source")).toBe(false);
    expect(filesystem.getLinkCount("/moved/internal")).toBe(2);
    expect(filesystem.getLinkCount("/moved/internal-2")).toBe(2);
    expect(filesystem.getLinkCount("/moved/shared")).toBe(2);
    expect(filesystem.getLinkCount("/outside/shared")).toBe(2);
    filesystem.writeFile("/moved/internal", "next");
    filesystem.writeFile("/moved/shared", "other");
    expect(filesystem.readFile("/moved/internal-2")).toBe("next");
    expect(filesystem.readFile("/outside/shared")).toBe("other");
    expect(filesystem.getFreeSpace()).toBe(0);

    const restored = new InMemoryFilesystem(filesystem.limits);
    restored.restore(filesystem.snapshot());
    expect(restored.getFreeSpace()).toBe(0);
    expect(restored.getLinkCount("/moved/internal")).toBe(2);
    expect(restored.getLinkCount("/outside/shared")).toBe(2);
    expect(restored.readFile("/moved/internal-2")).toBe("next");
    expect(restored.readFile("/outside/shared")).toBe("other");
  });

  it("leaves source, destination, capacity, and revision unchanged when move validation fails", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 10,
      maxEntries: 20,
      maxPathLength: 20,
    });
    filesystem.makeDirectory("/s");
    filesystem.writeFile("/s/long-name", "full-disk!");
    const before = filesystem.snapshot();
    const revision = filesystem.revision;
    const freeSpace = filesystem.getFreeSpace();

    expect(() => filesystem.move("/s", "/destination")).toThrow(
      /Path is too long/u,
    );

    expect(filesystem.snapshot()).toEqual(before);
    expect(filesystem.revision).toBe(revision);
    expect(filesystem.getFreeSpace()).toBe(freeSpace);
    expect(filesystem.readFile("/s/long-name")).toBe("full-disk!");
    expect(filesystem.exists("/destination")).toBe(false);
  });

  it("keeps copied hard-link groups independent from their source group", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 6,
      maxEntries: 20,
    });
    filesystem.makeDirectory("/source");
    filesystem.writeFile("/source/first", "one");
    filesystem.createHardLink("/source/first", "/source/second");

    filesystem.copy("/source", "/copy");
    filesystem.writeFile("/copy/first", "two");

    expect(filesystem.getLinkCount("/source/first")).toBe(2);
    expect(filesystem.getLinkCount("/copy/first")).toBe(2);
    expect(filesystem.readFile("/copy/second")).toBe("two");
    expect(filesystem.readFile("/source/first")).toBe("one");
    expect(filesystem.getFreeSpace()).toBe(0);
  });

  it("rejects invalid and missing paths explicitly", (): void => {
    const filesystem = new InMemoryFilesystem(limits);
    expect(() => filesystem.normalize("../escape")).toThrow(FilesystemError);
    expect(() => filesystem.readFile("/missing")).toThrow(/not a file/u);
    expect(() => filesystem.writeFile("/missing/file", "x")).toThrow(
      /Parent directory/u,
    );
    expect(() => filesystem.delete("/")).toThrow(/delete root/u);
    expect(() => filesystem.list("/missing")).toThrow(/not a directory/u);
  });

  it("rejects directories at or below symbolic links without partial mutation", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 100,
      maxEntries: 20,
    });
    filesystem.makeDirectory("/target");
    filesystem.createSymbolicLink("/target", "/link");
    const before = filesystem.snapshot();
    const revision = filesystem.revision;
    const freeSpace = filesystem.getFreeSpace();

    expect(() => filesystem.makeDirectory("/link")).toThrow(/symbolic link/u);
    expect(() => filesystem.makeDirectory("/link/child")).toThrow(
      /symbolic link/u,
    );

    expect(filesystem.snapshot()).toEqual(before);
    expect(filesystem.revision).toBe(revision);
    expect(filesystem.getFreeSpace()).toBe(freeSpace);
    expect(filesystem.isSymbolicLink("/link")).toBe(true);
    expect(filesystem.exists("/link/child")).toBe(false);
  });

  it("preflights all base-image directories before mutating around a symbolic-link ancestor", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 100,
      maxEntries: 20,
    });
    filesystem.makeDirectory("/target");
    filesystem.createSymbolicLink("/target", "/blocked");
    const before = filesystem.snapshot();
    const revision = filesystem.revision;
    const freeSpace = filesystem.getFreeSpace();

    expect(() =>
      filesystem.attachBaseImage({
        directories: ["/first", "/blocked/child"],
        files: [{ contents: "data", path: "/first/file" }],
        id: "test-symbolic-directory-conflict-v1",
      }),
    ).toThrow(/\/blocked is a symbolic link/u);

    expect(filesystem.snapshot()).toEqual(before);
    expect(filesystem.revision).toBe(revision);
    expect(filesystem.getFreeSpace()).toBe(freeSpace);
    expect(filesystem.baseImageId).toBeUndefined();
    expect(filesystem.exists("/first")).toBe(false);
    expect(filesystem.readLink("/blocked")).toBe("/target");
  });

  it("preserves base-entry type replacements through snapshot restore and image upgrade", (): void => {
    const replacementLimits: FilesystemLimits = {
      capacityBytes: 10_000,
      maxEntries: 100,
      maxFileBytes: 1_000,
      maxPathLength: 100,
    };
    const oldImage = {
      directories: ["/bin", "/replace-dir"],
      files: [
        { contents: "old-tool", path: "/bin/tool" },
        { contents: "old-file", path: "/bin/dir-overlay" },
      ],
      id: "test-type-replacement-old-v1",
    } as const;
    const upgradedImage = {
      directories: ["/bin", "/replace-dir", "/replace-dir/sub"],
      files: [
        { contents: "new-tool", path: "/bin/tool" },
        { contents: "new-file", path: "/bin/dir-overlay" },
        { contents: "must-stay-hidden", path: "/replace-dir/sub/base" },
      ],
      id: "test-type-replacement-new-v1",
    } as const;
    const filesystem = new InMemoryFilesystem(replacementLimits);
    filesystem.attachBaseImage(oldImage);
    const toolBaseMetadata = filesystem.getMetadata("/bin/tool");
    const fileBaseMetadata = filesystem.getMetadata("/bin/dir-overlay");
    const directoryBaseMetadata = filesystem.getMetadata("/replace-dir");

    filesystem.delete("/bin/tool");
    filesystem.makeDirectory("/custom");
    filesystem.writeFile("/custom/tool", "custom-tool");
    filesystem.createSymbolicLink("/custom/tool", "/bin/tool");
    filesystem.setMetadata(
      "/bin/tool",
      {
        gid: toolBaseMetadata.gid,
        mode: toolBaseMetadata.mode,
        uid: toolBaseMetadata.uid,
      },
      false,
    );
    filesystem.setModifiedTime(
      "/bin/tool",
      toolBaseMetadata.modifiedAtMilliseconds,
      false,
    );
    filesystem.delete("/bin/dir-overlay");
    filesystem.makeDirectory("/bin/dir-overlay");
    filesystem.setMetadata("/bin/dir-overlay", {
      gid: fileBaseMetadata.gid,
      mode: fileBaseMetadata.mode,
      uid: fileBaseMetadata.uid,
    });
    filesystem.setModifiedTime(
      "/bin/dir-overlay",
      fileBaseMetadata.modifiedAtMilliseconds,
    );
    filesystem.delete("/replace-dir");
    filesystem.writeFile("/replace-dir", "overlay-file");
    filesystem.setMetadata("/replace-dir", {
      gid: directoryBaseMetadata.gid,
      mode: directoryBaseMetadata.mode,
      uid: directoryBaseMetadata.uid,
    });
    filesystem.setModifiedTime(
      "/replace-dir",
      directoryBaseMetadata.modifiedAtMilliseconds,
    );

    const oldSnapshot = filesystem.snapshot();
    expect(oldSnapshot.tombstones).toEqual(
      expect.arrayContaining(["/bin/tool", "/bin/dir-overlay", "/replace-dir"]),
    );
    expect(
      oldSnapshot.metadata?.find(([path]) => path === "/bin/tool")?.[1],
    ).toEqual(toolBaseMetadata);

    const restored = new InMemoryFilesystem(replacementLimits);
    restored.restore(oldSnapshot);
    expect(restored.readLink("/bin/tool")).toBe("/custom/tool");
    expect(restored.getMetadata("/bin/tool", false)).toEqual(toolBaseMetadata);
    expect(restored.isDirectory("/bin/dir-overlay")).toBe(true);
    expect(restored.getMetadata("/bin/dir-overlay")).toEqual(fileBaseMetadata);
    expect(restored.readFile("/replace-dir")).toBe("overlay-file");
    expect(restored.getMetadata("/replace-dir")).toEqual(directoryBaseMetadata);
    const revisionBeforeUpgrade = restored.revision;

    restored.attachBaseImage(upgradedImage);

    expect(restored.revision).toBe(revisionBeforeUpgrade + 1);
    expect(restored.baseImageId).toBe(upgradedImage.id);
    expect(restored.readLink("/bin/tool")).toBe("/custom/tool");
    expect(restored.getMetadata("/bin/tool", false)).toEqual(toolBaseMetadata);
    expect(restored.isDirectory("/bin/dir-overlay")).toBe(true);
    expect(restored.getMetadata("/bin/dir-overlay")).toEqual(fileBaseMetadata);
    expect(restored.readFile("/replace-dir")).toBe("overlay-file");
    expect(restored.getMetadata("/replace-dir")).toEqual(directoryBaseMetadata);
    expect(restored.exists("/replace-dir/sub")).toBe(false);

    const upgradedSnapshot = restored.snapshot();
    expect(upgradedSnapshot.tombstones).toEqual(
      expect.arrayContaining(["/bin/tool", "/bin/dir-overlay", "/replace-dir"]),
    );
    const restarted = new InMemoryFilesystem(replacementLimits);
    restarted.restore(upgradedSnapshot);
    expect(restarted.readLink("/bin/tool")).toBe("/custom/tool");
    expect(restarted.getMetadata("/bin/tool", false)).toEqual(toolBaseMetadata);
    expect(restarted.isDirectory("/bin/dir-overlay")).toBe(true);
    expect(restarted.getMetadata("/bin/dir-overlay")).toEqual(fileBaseMetadata);
    expect(restarted.readFile("/replace-dir")).toBe("overlay-file");
    expect(restarted.getMetadata("/replace-dir")).toEqual(
      directoryBaseMetadata,
    );
    expect(restarted.exists("/replace-dir/sub")).toBe(false);
  });

  it("enforces byte, file, entry, and path limits before committing", (): void => {
    const filesystem = new InMemoryFilesystem({ ...limits, maxEntries: 5 });
    filesystem.makeDirectory("/d");
    filesystem.writeFile("/d/safe", "unchanged");

    expect(() => filesystem.writeFile("/d/safe", "1234567890123")).toThrow(
      /File is too large/u,
    );
    expect(filesystem.readFile("/d/safe")).toBe("unchanged");
    expect(() => filesystem.writeFile("/d/emoji", "😀😀😀")).toThrow(
      /capacity/u,
    );
    expect(filesystem.exists("/d/emoji")).toBe(false);
    expect(() => filesystem.normalize(`/${"x".repeat(31)}`)).toThrow(
      /too long/u,
    );

    filesystem.writeFile("/d/a", "a");
    filesystem.writeFile("/d/b", "b");
    filesystem.writeFile("/d/c", "c");
    expect(() => filesystem.writeFile("/d/overflow", "d")).toThrow(
      /entry limit/u,
    );
    expect(filesystem.exists("/d/overflow")).toBe(false);
  });

  it("bounds and accounts for symbolic-link targets across copy, move, delete, and restore", (): void => {
    const symbolicLimits: FilesystemLimits = {
      capacityBytes: 16,
      maxEntries: 8,
      maxFileBytes: 12,
      maxPathLength: 10,
    };
    const filesystem = new InMemoryFilesystem(symbolicLimits);
    filesystem.createSymbolicLink("😀😀", "/emoji");
    expect(filesystem.getFreeSpace()).toBe(8);

    filesystem.move("/emoji", "/moved");
    expect(filesystem.getFreeSpace()).toBe(8);
    filesystem.copy("/moved", "/copied");
    expect(filesystem.getFreeSpace()).toBe(0);
    expect(() => filesystem.createSymbolicLink("x", "/full")).toThrow(
      /capacity/u,
    );
    filesystem.delete("/moved");
    expect(filesystem.getFreeSpace()).toBe(8);

    const snapshot = filesystem.snapshot();
    const restored = new InMemoryFilesystem(symbolicLimits);
    restored.restore(snapshot);
    expect(restored.readLink("/copied")).toBe("😀😀");
    expect(restored.getFreeSpace()).toBe(8);
    restored.delete("/copied");
    expect(restored.getFreeSpace()).toBe(16);
  });

  it("rejects overlong UTF-8 link targets for new links but grandfathers schema-2 restore", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 20,
      maxEntries: 10,
      maxPathLength: 12,
    });
    const before = filesystem.snapshot();
    expect(() =>
      filesystem.createSymbolicLink("😀😀😀😀", "/too-long"),
    ).toThrow(/Link target is too long/u);
    expect(filesystem.snapshot()).toEqual(before);
    expect(filesystem.getFreeSpace()).toBe(20);

    filesystem.createSymbolicLink("😀😀", "/valid");
    const snapshot = filesystem.snapshot();
    const constrained = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 7,
      maxEntries: 10,
      maxPathLength: 12,
    });
    constrained.writeFile("/keep", "safe");
    constrained.restore(snapshot);
    expect(constrained.exists("/keep")).toBe(false);
    expect(constrained.readLink("/valid")).toBe("😀😀");
    expect(constrained.getFreeSpace()).toBe(0);

    const shortTargetLimit = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 20,
      maxEntries: 10,
      maxPathLength: 7,
    });
    shortTargetLimit.restore(snapshot);
    expect(shortTargetLimit.readLink("/valid")).toBe("😀😀");

    const restarted = new InMemoryFilesystem(shortTargetLimit.limits);
    restarted.restore(shortTargetLimit.snapshot());
    expect(restarted.readLink("/valid")).toBe("😀😀");
  });

  it("restores a legacy full-capacity disk with an uncharged symbolic link without data loss", (): void => {
    const grandfathered = migrateLegacyInMemoryFilesystemSnapshot({
      directories: ["/data"],
      files: [["/data/full", "12345"]],
      symbolicLinks: [["/link", "/data/full"]],
    });
    const legacyLimits: FilesystemLimits = {
      capacityBytes: 5,
      maxEntries: 4,
      maxFileBytes: 5,
      maxPathLength: 30,
    };
    const filesystem = new InMemoryFilesystem(legacyLimits);

    filesystem.restore(grandfathered);

    expect(filesystem.readFile("/data/full")).toBe("12345");
    expect(filesystem.readLink("/link")).toBe("/data/full");
    expect(filesystem.getFreeSpace()).toBe(0);
    const restarted = new InMemoryFilesystem(legacyLimits);
    restarted.restore(filesystem.snapshot());
    expect(restarted.readFile("/data/full")).toBe("12345");
    expect(restarted.readLink("/link")).toBe("/data/full");
    expect(restarted.getFreeSpace()).toBe(0);
    expect(() => restarted.writeFile("/new", "x")).toThrow(/capacity/u);
    restarted.writeFile("/data/full", "1234");
    expect(restarted.readFile("/data/full")).toBe("1234");
    restarted.delete("/link");
    expect(restarted.getFreeSpace()).toBe(1);
  });

  it("restores legacy symbolic links above the old file-and-directory entry ceiling", (): void => {
    const grandfathered = migrateLegacyInMemoryFilesystemSnapshot({
      directories: ["/data"],
      files: [["/data/file", "x"]],
      symbolicLinks: [
        ["/first", "/data/file"],
        ["/second", "/data/file"],
      ],
    });
    const legacyLimits: FilesystemLimits = {
      capacityBytes: 100,
      maxEntries: 2,
      maxFileBytes: 10,
      maxPathLength: 30,
    };
    const filesystem = new InMemoryFilesystem(legacyLimits);

    filesystem.restore(grandfathered);

    expect(filesystem.list("/")).toEqual(["data", "first", "second"]);
    expect(filesystem.readLink("/first")).toBe("/data/file");
    expect(filesystem.readLink("/second")).toBe("/data/file");
    const restarted = new InMemoryFilesystem(legacyLimits);
    restarted.restore(filesystem.snapshot());
    expect(restarted.readLink("/first")).toBe("/data/file");
    expect(restarted.readLink("/second")).toBe("/data/file");
    expect(() => restarted.createSymbolicLink("x", "/third")).toThrow(
      /entry limit/u,
    );
  });

  it("preserves legacy link targets longer than maxPathLength across restart", (): void => {
    const exactTarget = `/${"long-segment/".repeat(4)}target`;
    const grandfathered = migrateLegacyInMemoryFilesystemSnapshot({
      directories: [],
      files: [],
      symbolicLinks: [["/long", exactTarget]],
    });
    const legacyLimits: FilesystemLimits = {
      capacityBytes: 1_000,
      maxEntries: 4,
      maxFileBytes: 10,
      maxPathLength: 10,
    };
    const filesystem = new InMemoryFilesystem(legacyLimits);

    filesystem.restore(grandfathered);

    expect(filesystem.readLink("/long")).toBe(exactTarget);
    const restarted = new InMemoryFilesystem(legacyLimits);
    restarted.restore(filesystem.snapshot());
    expect(restarted.readLink("/long")).toBe(exactTarget);
    expect(() => restarted.createSymbolicLink(exactTarget, "/new")).toThrow(
      /Link target is too long/u,
    );
  });

  it("rejects corrupt hard-link groups without mutating the target filesystem", (): void => {
    const source = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 100,
      maxEntries: 20,
    });
    source.makeDirectory("/data");
    source.writeFile("/data/first", "one");
    source.writeFile("/data/second", "two");
    const sourceSnapshot = source.snapshot();
    const corruptSnapshots = [
      {
        ...sourceSnapshot,
        hardLinks: [["/data/first", "/data/second"]],
      },
      {
        ...sourceSnapshot,
        hardLinks: [["/data/first", "/missing"]],
      },
      {
        ...sourceSnapshot,
        hardLinks: [["/data/first", "/data"]],
      },
    ];
    const target = new InMemoryFilesystem(source.limits);
    target.writeFile("/keep", "safe");
    const before = target.snapshot();

    for (const corrupt of corruptSnapshots) {
      expect(() => target.restore(corrupt)).toThrow(
        /Invalid filesystem hard-link group/u,
      );
      expect(target.snapshot()).toEqual(before);
      expect(target.readFile("/keep")).toBe("safe");
    }
  });

  it("tracks revisions, indexed children, and cached capacity without changing on no-ops", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 10_000,
      maxEntries: 200,
    });
    filesystem.makeDirectory("/target");
    for (let index = 0; index < 100; index += 1) {
      filesystem.makeDirectory(`/unrelated-${index}`);
    }
    filesystem.writeFile("/target/value", "abc");
    const revision = filesystem.revision;

    expect(filesystem.list("/target")).toEqual(["value"]);
    expect(filesystem.getFreeSpace()).toBe(9_997);
    filesystem.writeFile("/target/value", "abc");
    filesystem.makeDirectory("/target");
    expect(filesystem.revision).toBe(revision);
  });

  it("persists Linux metadata, symbolic links, and shared hard-link contents", (): void => {
    const filesystem = new InMemoryFilesystem({
      ...limits,
      capacityBytes: 1_000,
      maxEntries: 20,
    });
    filesystem.makeDirectory("/data");
    filesystem.writeFile("/data/original", "one");
    filesystem.setMetadata("/data/original", { mode: 0o640 });
    filesystem.createSymbolicLink("/data/original", "/data/symbolic");
    filesystem.createHardLink("/data/original", "/data/hard");
    const freeAfterHardLink = filesystem.getFreeSpace();
    expect(freeAfterHardLink).toBe(983);

    filesystem.writeFile("/data/hard", "two");
    expect(filesystem.getFreeSpace()).toBe(983);
    expect(filesystem.readFile("/data/original")).toBe("two");
    expect(filesystem.readFile("/data/symbolic")).toBe("two");
    expect(filesystem.readLink("/data/symbolic")).toBe("/data/original");
    expect(filesystem.getLinkCount("/data/original")).toBe(2);
    expect(filesystem.getMetadata("/data/original").mode).toBe(0o640);
    filesystem.copy("/data/symbolic", "/data/symbolic-copy");
    expect(filesystem.readLink("/data/symbolic-copy")).toBe("/data/original");
    filesystem.move("/data/hard", "/data/hard-moved");
    expect(filesystem.getLinkCount("/data/hard-moved")).toBe(2);
    filesystem.writeFile("/data/hard-moved", "three");
    expect(filesystem.readFile("/data/original")).toBe("three");
    filesystem.delete("/data/hard-moved");
    expect(filesystem.readFile("/data/original")).toBe("three");
    expect(filesystem.getLinkCount("/data/original")).toBe(1);
    filesystem.createHardLink("/data/original", "/data/hard2");
    filesystem.setMetadata("/data/hard2", { mode: 0o600 });
    expect(filesystem.getMetadata("/data/original").mode).toBe(0o600);

    filesystem.makeDirectory("/data/relative");
    filesystem.writeFile("/data/relative/source", "relative");
    filesystem.createSymbolicLink("source", "/data/relative/link");
    filesystem.move("/data/relative", "/moved");
    expect(filesystem.readFile("/moved/link")).toBe("relative");
    expect(filesystem.readLink("/moved/link")).toBe("source");

    const restored = new InMemoryFilesystem(filesystem.limits);
    restored.restore(filesystem.snapshot());
    expect(restored.readFile("/data/symbolic")).toBe("three");
    expect(restored.getLinkCount("/data/hard2")).toBe(2);
    expect(restored.getMetadata("/data/original").mode).toBe(0o600);
  });

  it("rejects explicit async transaction callbacks before they can execute", async (): Promise<void> => {
    const filesystem = new InMemoryFilesystem(limits);
    const stages: string[] = [];
    const operation = async (): Promise<void> => {
      stages.push("before-await");
      filesystem.writeFile("/before", "unsafe");
      await Promise.resolve();
      stages.push("after-await");
      filesystem.writeFile("/after", "unsafe");
    };

    expect(() =>
      filesystem.transaction(
        operation as unknown as SynchronousTransactionOperation<void>,
      ),
    ).toThrow("Filesystem transactions require a synchronous callback");
    await Promise.resolve();

    expect(stages).toEqual([]);
    expect(filesystem.exists("/before")).toBe(false);
    expect(filesystem.exists("/after")).toBe(false);
  });

  it("rolls back pre-await work and guards post-await work from a disguised Promise", async (): Promise<void> => {
    const filesystem = new InMemoryFilesystem(limits);
    const otherFilesystem = new InMemoryFilesystem(limits);
    filesystem.writeFile("/value", "before");
    otherFilesystem.writeFile("/other", "before");
    const before = structuredClone(filesystem.snapshot());
    const otherBefore = structuredClone(otherFilesystem.snapshot());
    const beforeRevision = filesystem.revision;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pending!: Promise<void>;
    let postAwaitError: unknown;
    let postAwaitOtherError: unknown;
    const operation = (): Promise<void> => {
      pending = (async (): Promise<void> => {
        filesystem.writeFile("/value", "before-await");
        await gate;
        try {
          filesystem.writeFile("/value", "after-await");
        } catch (error: unknown) {
          postAwaitError = error;
        }
        try {
          otherFilesystem.writeFile("/other", "escaped");
        } catch (error: unknown) {
          postAwaitOtherError = error;
        }
      })();
      return pending;
    };

    expect(() =>
      filesystem.transaction(
        operation as unknown as SynchronousTransactionOperation<void>,
      ),
    ).toThrow("Filesystem transactions require a synchronous callback");
    expect(filesystem.snapshot()).toEqual(before);
    expect(filesystem.revision).toBe(beforeRevision);
    expect(() => filesystem.writeFile("/blocked", "pending")).toThrow(
      "rejected asynchronous transaction is pending",
    );
    expect(() => otherFilesystem.writeFile("/blocked", "pending")).toThrow(
      "rejected asynchronous transaction is pending",
    );

    release();
    await pending;
    expect(postAwaitError).toMatchObject({
      code: "transaction_async",
    });
    expect(postAwaitOtherError).toMatchObject({
      code: "transaction_async",
    });
    expect(filesystem.snapshot()).toEqual(before);
    expect(otherFilesystem.snapshot()).toEqual(otherBefore);
    expect(filesystem.revision).toBe(beforeRevision);

    filesystem.writeFile("/value", "released");
    otherFilesystem.writeFile("/other", "released");
    expect(filesystem.readFile("/value")).toBe("released");
    expect(otherFilesystem.readFile("/other")).toBe("released");
  });

  it("synchronously rejects a bare thenable result and rolls back its callback", async (): Promise<void> => {
    const filesystem = new InMemoryFilesystem(limits);
    filesystem.writeFile("/value", "before");
    const before = structuredClone(filesystem.snapshot());
    let assimilated = false;
    const operation = (): object => {
      filesystem.writeFile("/value", "changed");
      return {
        then(resolve: (value: undefined) => void): void {
          assimilated = true;
          resolve(undefined);
        },
      };
    };

    expect(() =>
      filesystem.transaction(
        operation as unknown as SynchronousTransactionOperation<void>,
      ),
    ).toThrow("Filesystem transactions require a synchronous callback");
    expect(filesystem.snapshot()).toEqual(before);

    await Promise.resolve();
    await Promise.resolve();
    expect(assimilated).toBe(true);
    filesystem.writeFile("/value", "released");
    expect(filesystem.readFile("/value")).toBe("released");
  });
});
