import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("Linux OS boot layout", (): void => {
  it("creates the versioned layout without overwriting user configuration", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/etc");
    filesystem.writeFile("/etc/hostname", "custom-name\n");
    filesystem.writeFile("/etc/os-release", "CUSTOM=preserved\n");
    filesystem.makeDirectory("/tmp");
    filesystem.writeFile("/tmp/stale", "discard");

    new ShellSession(filesystem, { computerName: "c-linux2" });

    for (const path of [
      "/etc",
      "/dev",
      "/tmp",
      "/usr/bin",
      "/var/log",
      "/home/computer",
    ]) {
      expect(filesystem.isDirectory(path)).toBe(true);
    }
    expect(filesystem.readFile("/etc/hostname")).toBe("custom-name\n");
    expect(filesystem.readFile("/etc/os-release")).toBe("CUSTOM=preserved\n");
    expect(filesystem.exists("/tmp/stale")).toBe(false);
    expect(filesystem.readFile("/etc/passwd")).toContain("/home/computer");
  });

  it("migrates only the exact legacy OS release file to CS-Linux 1.0", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/etc");
    filesystem.writeFile(
      "/etc/os-release",
      'NAME="Computer System OS"\nID=computer-system\nVERSION="0.3"\n',
    );

    new ShellSession(filesystem, { computerName: "c-linux3" });

    expect(filesystem.readFile("/etc/os-release")).toContain(
      'PRETTY_NAME="Computer System Linux 1.0"',
    );
    expect(filesystem.readFile("/etc/os-release")).toContain("ID=cs-linux");
  });

  it("lists virtual devices without persisting them as ordinary files", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("ls /dev").lines).toEqual(["null"]);
    expect(shell.submit("cat /dev/null").lines).toEqual([]);
    expect(shell.submit("echo ignored > /dev/null").exitCode).toBe(0);
    expect(filesystem.exists("/dev/null")).toBe(false);
  });

  it("stores utilities as deletable executable files and persists only the COW delta", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(filesystem.getSize("/usr/bin/ls")).toBe(8_192);
    expect(filesystem.getMetadata("/usr/bin/ls").mode & 0o111).not.toBe(0);
    expect(shell.submit("ls /").exitCode).toBe(0);
    expect(shell.submit("rm /usr/bin/ls").exitCode).toBe(0);
    expect(shell.submit("ls /")).toMatchObject({ exitCode: 127 });

    const snapshot = filesystem.snapshot();
    expect(snapshot.baseImageId).toBe("cs-linux-1.0-rootfs-v1");
    expect(snapshot.tombstones).toContain("/usr/bin/ls");
    expect(snapshot.files.some(([path]) => path === "/usr/bin/ls")).toBe(false);

    const restored = new InMemoryFilesystem();
    restored.restore(snapshot);
    const restoredShell = new ShellSession(restored);
    expect(restored.exists("/usr/bin/ls")).toBe(false);
    expect(restoredShell.submit("ls /")).toMatchObject({ exitCode: 127 });
  });
});
