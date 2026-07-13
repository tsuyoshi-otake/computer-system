import { describe, expect, it } from "vitest";

import {
  FilesystemError,
  InMemoryFilesystem,
  type FilesystemLimits,
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
});
