import { describe, expect, it } from "vitest";

import { CredentialedFilesystem } from "../../src/application/os/credentialedFilesystem.js";
import { rootCredentials } from "../../src/application/os/linuxCredentials.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  InMemoryFilesystem,
  migrateLegacyInMemoryFilesystemSnapshot,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

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
      "/home/cs",
    ]) {
      expect(filesystem.isDirectory(path)).toBe(true);
    }
    expect(filesystem.readFile("/etc/hostname")).toBe("custom-name\n");
    expect(filesystem.readFile("/etc/os-release")).toBe("CUSTOM=preserved\n");
    expect(filesystem.exists("/tmp/stale")).toBe(false);
    expect(filesystem.readFile("/etc/passwd")).toContain(
      "cs:x:1000:1000:Computer System administrator:/home/cs:/bin/bash",
    );
    expect(filesystem.exists("/home/computer")).toBe(false);
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

  it("rejects a legacy /etc symbolic link before base-image attachment mutates the filesystem", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.restore(
      migrateLegacyInMemoryFilesystemSnapshot({
        directories: ["/legacy"],
        files: [],
        symbolicLinks: [["/etc", "/legacy"]],
      }),
    );
    const before = filesystem.snapshot();
    const revision = filesystem.revision;
    const freeSpace = filesystem.getFreeSpace();

    expect(
      () =>
        new ShellSession(filesystem, {
          computerName: "c-linux-symlink-conflict",
        }),
    ).toThrow("/etc is a symbolic link");

    expect(filesystem.snapshot()).toEqual(before);
    expect(filesystem.revision).toBe(revision);
    expect(filesystem.getFreeSpace()).toBe(freeSpace);
    expect(filesystem.baseImageId).toBeUndefined();
    expect(filesystem.readLink("/etc")).toBe("/legacy");
    expect(filesystem.isDirectory("/legacy")).toBe(true);
  });

  it("rolls the legacy home rename back when account migration fails", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/home");
    filesystem.makeDirectory("/home/computer");
    filesystem.writeFile("/home/computer/keep.txt", "keep\n");
    filesystem.makeDirectory("/etc");
    filesystem.writeFile("/etc/passwd", "malformed\n");
    filesystem.writeFile("/etc/group", "root:x:0:\n");

    expect(
      () => new ShellSession(filesystem, { computerName: "c-linux4" }),
    ).toThrow();

    expect(filesystem.isDirectory("/home/computer")).toBe(true);
    expect(filesystem.readFile("/home/computer/keep.txt")).toBe("keep\n");
    expect(filesystem.exists("/home/cs")).toBe(false);
  });

  it("rejects two empty home directories without discarding either directory metadata", (): void => {
    const filesystem = new InMemoryFilesystem();
    new ShellSession(filesystem, { computerName: "c-linux-home-conflict" });
    filesystem.delete("/home/cs");
    filesystem.makeDirectory("/home/computer");
    filesystem.makeDirectory("/home/cs");
    filesystem.setMetadata("/home/computer", {
      gid: 41,
      mode: 0o710,
      uid: 1_000,
    });
    filesystem.setModifiedTime("/home/computer", 41_000);
    filesystem.setMetadata("/home/cs", {
      gid: 42,
      mode: 0o750,
      uid: 1_001,
    });
    filesystem.setModifiedTime("/home/cs", 42_000);
    rewriteInitialAccountAsLegacy(filesystem);
    const legacyMetadata = filesystem.getMetadata("/home/computer");
    const currentMetadata = filesystem.getMetadata("/home/cs");

    expect(
      () =>
        new ShellSession(filesystem, {
          computerName: "c-linux-home-conflict",
        }),
    ).toThrow("both legacy and current homes exist");

    expect(filesystem.list("/home/computer")).toEqual([]);
    expect(filesystem.list("/home/cs")).toEqual([]);
    expect(filesystem.getMetadata("/home/computer")).toEqual(legacyMetadata);
    expect(filesystem.getMetadata("/home/cs")).toEqual(currentMetadata);
  });

  it("rejects legacy migration when another account already owns /home/cs", (): void => {
    const filesystem = new InMemoryFilesystem();
    new ShellSession(filesystem, { computerName: "c-linux-owned-home" });
    filesystem.move("/home/cs", "/home/computer");
    filesystem.makeDirectory("/home/cs");
    filesystem.setMetadata("/home/cs", {
      gid: 1_001,
      mode: 0o750,
      uid: 1_001,
    });
    filesystem.writeFile("/home/cs/alice.txt", "alice-home\n");
    rewriteInitialAccountAsLegacy(filesystem);
    filesystem.appendFile(
      "/etc/passwd",
      "alice:x:1001:1001:Alice:/home/cs:/bin/bash\n",
    );
    filesystem.appendFile("/etc/group", "alice:x:1001:alice\n");
    filesystem.appendFile("/etc/shadow", "alice:!\n");

    expect(
      () =>
        new ShellSession(filesystem, { computerName: "c-linux-owned-home" }),
    ).toThrow("both legacy and current homes exist");
    expect(filesystem.readFile("/home/computer/.bashrc")).toContain(
      "export EDITOR=vi",
    );
    expect(filesystem.readFile("/home/cs/alice.txt")).toBe("alice-home\n");
    expect(filesystem.readFile("/etc/passwd")).toContain(
      "alice:x:1001:1001:Alice:/home/cs:/bin/bash",
    );
  });

  it("preserves the legacy home directory metadata during the complete rename", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/home/computer");
    filesystem.setMetadata("/home/computer", {
      gid: 27,
      mode: 0o710,
      uid: 1_000,
    });
    filesystem.setModifiedTime("/home/computer", 1_234_567);

    new ShellSession(filesystem, { computerName: "c-linux5" });

    expect(filesystem.exists("/home/computer")).toBe(false);
    expect(filesystem.getMetadata("/home/cs")).toEqual({
      gid: 27,
      mode: 0o710,
      modifiedAtMilliseconds: 1_234_567,
      uid: 1_000,
    });
  });

  it("does not resurrect cs home state after usermod renames and moves it", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, {
      computerName: "c-linux7",
      passwordSalt: (): string => "fixed-test-salt-01",
      requireLogin: true,
    });
    shell.submit("correct-horse");
    shell.submit("correct-horse");

    expect(shell.submit("sudo passwd root").exitCode).toBe(0);
    expect(shell.prompt()).toBe("[sudo] password for cs: ");
    expect(shell.submit("correct-horse").exitCode).toBe(0);
    expect(shell.prompt()).toBe("New password: ");
    expect(shell.submit("root-password").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Retype new password: ");
    expect(shell.submit("root-password").exitCode).toBe(0);
    expect(shell.submit("logout").exitCode).toBe(0);
    expect(shell.submit("root").exitCode).toBe(0);
    expect(shell.prompt()).toBe("Password: ");
    expect(shell.submit("root-password").stdout).toContain("Login successful");
    expect(shell.submit("whoami").stdout).toBe("root\n");
    expect(
      shell.submit("usermod -l operator -d /home/operator -m cs").exitCode,
    ).toBe(0);
    expect(filesystem.exists("/home/cs")).toBe(false);
    expect(filesystem.readFile("/home/operator/.bashrc")).toContain(
      "export EDITOR=vi",
    );
    filesystem.writeFile("/home/operator/.bashrc", "# operator config\n");
    const homeMetadata = filesystem.getMetadata("/home/operator");

    new ShellSession(filesystem, { computerName: "c-linux7" });

    expect(filesystem.exists("/home/computer")).toBe(false);
    expect(filesystem.exists("/home/cs")).toBe(false);
    expect(filesystem.readFile("/home/operator/.bashrc")).toBe(
      "# operator config\n",
    );
    expect(filesystem.getMetadata("/home/operator")).toEqual(homeMetadata);
    expect(filesystem.readFile("/etc/passwd")).toContain(
      "operator:x:1000:1000:Computer System administrator:/home/operator:/bin/bash",
    );
    expect(filesystem.readFile("/etc/passwd")).not.toContain("cs:x:");
  });

  it("rejects a symbolic-link legacy home instead of merging it", (): void => {
    const filesystem = new InMemoryFilesystem();
    filesystem.makeDirectory("/home/target");
    filesystem.createSymbolicLink("/home/target", "/home/computer");

    expect(
      () => new ShellSession(filesystem, { computerName: "c-linux6" }),
    ).toThrow("legacy home is a symbolic link");
    expect(filesystem.isSymbolicLink("/home/computer")).toBe(true);
    expect(filesystem.exists("/home/cs")).toBe(false);
  });

  it("keeps every shared system directory root-owned and non-writable by cs", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    for (const path of [
      "/",
      "/bin",
      "/boot",
      "/etc",
      "/lib",
      "/lib/python",
      "/usr/bin",
      "/usr/lib",
      "/usr/lib/computer-system/python",
      "/var/log",
    ]) {
      expect(filesystem.getMetadata(path), path).toMatchObject({
        gid: 0,
        mode: 0o755,
        uid: 0,
      });
    }
    expect(shell.submit("touch /not-allowed").stderr).toContain(
      "Permission denied",
    );
    expect(shell.submit("rm /usr/bin/ls").stderr).toContain(
      "Permission denied",
    );
    expect(filesystem.exists("/not-allowed")).toBe(false);
    expect(filesystem.exists("/usr/bin/ls")).toBe(true);
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
    new CredentialedFilesystem(filesystem, rootCredentials).delete(
      "/usr/bin/ls",
    );
    expect(shell.submit("ls /")).toMatchObject({ exitCode: 127 });

    const snapshot = filesystem.snapshot();
    expect(snapshot.baseImageId).toBe("cs-linux-1.0-rootfs-v6");
    expect(snapshot.tombstones).toContain("/usr/bin/ls");
    expect(snapshot.files.some(([path]) => path === "/usr/bin/ls")).toBe(false);

    const restored = new InMemoryFilesystem();
    restored.restore(snapshot);
    const restoredShell = new ShellSession(restored);
    expect(restored.exists("/usr/bin/ls")).toBe(false);
    expect(restoredShell.submit("ls /")).toMatchObject({ exitCode: 127 });
  });
});

function rewriteInitialAccountAsLegacy(filesystem: InMemoryFilesystem): void {
  filesystem.writeFile(
    "/etc/passwd",
    filesystem
      .readFile("/etc/passwd")
      .replace(
        "cs:x:1000:1000:Computer System administrator:/home/cs:/bin/bash",
        "computer:x:1000:1000:Computer System administrator:/home/computer:/bin/bash",
      ),
  );
  filesystem.writeFile(
    "/etc/group",
    filesystem
      .readFile("/etc/group")
      .replace("cs:x:1000:cs", "computer:x:1000:computer")
      .replace("sudo:x:27:cs", "sudo:x:27:computer"),
  );
  filesystem.writeFile(
    "/etc/shadow",
    filesystem.readFile("/etc/shadow").replace("cs:!!", "computer:!!"),
  );
}
