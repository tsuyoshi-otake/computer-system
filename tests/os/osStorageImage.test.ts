import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { registerOsFilesystemImages } from "../../src/application/os/osFilesystemImages.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import {
  filesystemBlobPoolStats,
  InMemoryFilesystem,
} from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("OS filesystem images and disk profiles", (): void => {
  it("uses family-specific disk capacities and charges real initial OS files", (): void => {
    const desktop = new ComputerRecord("c-000420", "standard");
    const advanced = new ComputerRecord("c-000421", "advanced");
    const portable = new ComputerRecord("c-000422", "standard", {
      displayProfileId: "portable-vga-256k",
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    new ShellSession(desktop.filesystem, { osProfile: "linux" });
    new ShellSession(advanced.filesystem, { osProfile: "linux" });
    new ShellSession(portable.filesystem, { osProfile: "dos" });

    expect(desktop.filesystem.limits.capacityBytes).toBe(40 * 1_048_576);
    expect(advanced.filesystem.limits.capacityBytes).toBe(80 * 1_048_576);
    expect(portable.filesystem.limits.capacityBytes).toBe(20 * 1_048_576);
    expect(portable.filesystem.limits).toMatchObject({
      allocationUnitBytes: 2_048,
      directoryEntryBytes: 32,
      reservedBytes: 59_392,
      rootDirectoryEntries: 512,
    });
    const linuxUsed =
      desktop.filesystem.limits.capacityBytes -
      desktop.filesystem.getFreeSpace();
    const dosUsed =
      portable.filesystem.limits.capacityBytes -
      portable.filesystem.getFreeSpace();
    expect(linuxUsed).toBeGreaterThan(2 * 1_048_576);
    expect(linuxUsed).toBeLessThan(4 * 1_048_576);
    expect(dosUsed).toBeGreaterThan(500 * 1_024);
    expect(dosUsed).toBeLessThan(1_048_576);
    expect(desktop.filesystem.getSize("/boot/vmlinuz-cs486")).toBe(786_432);
    expect(portable.filesystem.getSize("/drives/c/command.com")).toBe(55_968);
  });

  it("shares immutable image blobs between Computers and snapshots only overlays", (): void => {
    const first = new ComputerRecord("c-000423", "standard");
    new ShellSession(first.filesystem, { osProfile: "linux" });
    const afterFirst = filesystemBlobPoolStats();
    const second = new ComputerRecord("c-000424", "standard");
    new ShellSession(second.filesystem, { osProfile: "linux" });
    const afterSecond = filesystemBlobPoolStats();

    expect(afterSecond).toEqual(afterFirst);
    const snapshot = second.filesystem.snapshot();
    expect(snapshot.baseImageId).toBe("cs-linux-1.0-rootfs-v7");
    expect(second.filesystem.exists("/home/cs")).toBe(true);
    expect(second.filesystem.exists("/home/computer")).toBe(false);
    expect(snapshot.files.some(([path]) => path.startsWith("/usr/bin/"))).toBe(
      false,
    );
    expect(
      snapshot.blobs.reduce((sum, [, contents]) => sum + contents.length, 0),
    ).toBeLessThan(64 * 1_024);
  });

  it("restores a hard-link group spanning an immutable base file and an overlay path", (): void => {
    const filesystem = new InMemoryFilesystem();
    new ShellSession(filesystem, { osProfile: "linux" });
    filesystem.createHardLink("/usr/bin/ls", "/home/cs/ls-hard");
    const snapshot = filesystem.snapshot();
    expect(snapshot.files.some(([path]) => path === "/usr/bin/ls")).toBe(false);
    expect(snapshot.files.some(([path]) => path === "/home/cs/ls-hard")).toBe(
      true,
    );

    const restored = new InMemoryFilesystem();
    restored.restore(snapshot);

    expect(restored.getLinkCount("/usr/bin/ls")).toBe(2);
    expect(restored.getLinkCount("/home/cs/ls-hard")).toBe(2);
    expect(restored.readFile("/home/cs/ls-hard")).toBe(
      restored.readFile("/usr/bin/ls"),
    );
    restored.writeFile("/home/cs/ls-hard", "replacement");
    expect(restored.readFile("/usr/bin/ls")).toBe("replacement");
  });

  it("upgrades v1 overlays to v2 without reviving tombstones or losing the legacy home", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v1",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/usr/bin/sudo")).toBe(false);
    filesystem.delete("/usr/bin/ls");
    filesystem.writeFile("/home/computer/project.txt", "preserved\n");
    filesystem.setMetadata("/home/computer/project.txt", {
      gid: 1000,
      mode: 0o640,
      uid: 1000,
    });
    filesystem.setModifiedTime("/home/computer/project.txt", 1_234_000);
    filesystem.createHardLink(
      "/home/computer/project.txt",
      "/home/computer/project-hard.txt",
    );
    filesystem.createSymbolicLink(
      "project.txt",
      "/home/computer/project-link.txt",
    );

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v7");
    expect(filesystem.exists("/usr/bin/sudo")).toBe(true);
    expect(filesystem.exists("/usr/bin/ls")).toBe(false);
    expect(filesystem.exists("/home/computer")).toBe(false);
    expect(filesystem.readFile("/home/cs/project.txt")).toBe("preserved\n");
    expect(filesystem.getMetadata("/home/cs/project.txt")).toMatchObject({
      gid: 1000,
      mode: 0o640,
      modifiedAtMilliseconds: 1_234_000,
      uid: 1000,
    });
    expect(filesystem.getLinkCount("/home/cs/project.txt")).toBe(2);
    expect(filesystem.readLink("/home/cs/project-link.txt")).toBe(
      "project.txt",
    );
    expect(filesystem.snapshot().tombstones).toContain("/usr/bin/ls");
  });

  it("installs CS QBASIC 1.0 and the CS ASM/C/C++ WorkBench launchers only on current DOS", (): void => {
    const linux = new InMemoryFilesystem();
    const linuxShell = new ShellSession(linux, { osProfile: "linux" });
    const dos = new InMemoryFilesystem();
    const dosShell = new ShellSession(dos, { osProfile: "dos" });

    expect(linux.baseImageId).toBe("cs-linux-1.0-rootfs-v7");
    expect(linux.exists("/usr/bin/basic")).toBe(false);
    expect(linux.exists("/usr/bin/basicc")).toBe(false);
    expect(linuxShell.submit("basic C:/DEMO.BAS").exitCode).toBe(127);
    expect(linuxShell.submit("basicc C:/DEMO.BAS").exitCode).toBe(127);

    expect(linux.readFile("/usr/include/stdio.h")).toContain(
      "#define CS_STDIO_H 1\n",
    );
    expect(linux.exists("/usr/include/cstdio")).toBe(true);
    expect(linux.exists("/usr/include/iostream")).toBe(true);

    expect(dos.baseImageId).toBe("cs-dos-1.0-rootfs-v7");
    expect(dos.exists("/drives/c/command/basic.com")).toBe(false);
    expect(dos.exists("/drives/c/command/basicc.com")).toBe(false);
    expect(dos.exists("/drives/c/command/qbasic.exe")).toBe(true);
    expect(dos.getSize("/drives/c/command/qbasic.exe")).toBe(196_608);
    for (const launcher of ["csasm", "cscc", "cscpp", "pwb"]) {
      expect(dos.exists(`/drives/c/command/${launcher}.exe`)).toBe(true);
    }
    expect(dos.readFile("/drives/c/include/stdio.h")).toContain(
      "#define CS_STDIO_H 1\r\n",
    );
    expect(dos.exists("/drives/c/include/cstdio")).toBe(true);
    expect(dos.exists("/drives/c/include/iostream")).toBe(true);
    expect(dosShell.submit("BASIC C:\\DEMO.BAS").exitCode).toBe(127);
  });

  it("keeps the pre-preprocessor Linux and DOS v6 base images immutable", (): void => {
    registerOsFilesystemImages();
    const linux = new InMemoryFilesystem();
    linux.restore({
      baseImageId: "cs-linux-1.0-rootfs-v6",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    const dos = new InMemoryFilesystem();
    dos.restore({
      baseImageId: "cs-dos-1.0-rootfs-v6",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });

    expect(linux.exists("/usr/include")).toBe(false);
    expect(dos.exists("/drives/c/include")).toBe(false);
    expect(linux.exists("/usr/bin/cc")).toBe(true);
    expect(dos.exists("/drives/c/command/cc.com")).toBe(true);
  });

  it("keeps the pre-QBASIC Linux v5 and DOS v4 base images immutable", (): void => {
    registerOsFilesystemImages();
    const linux = new InMemoryFilesystem();
    linux.restore({
      baseImageId: "cs-linux-1.0-rootfs-v5",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    const dos = new InMemoryFilesystem();
    dos.restore({
      baseImageId: "cs-dos-1.0-rootfs-v4",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });

    expect(linux.exists("/usr/bin/basic")).toBe(true);
    expect(linux.exists("/usr/bin/basicc")).toBe(true);
    expect(dos.exists("/drives/c/command/basic.com")).toBe(true);
    expect(dos.exists("/drives/c/command/basicc.com")).toBe(true);
    expect(dos.exists("/drives/c/command/qbasic.exe")).toBe(false);
  });

  it("keeps the pre-WorkBench DOS v5 base image immutable", (): void => {
    registerOsFilesystemImages();
    const dos = new InMemoryFilesystem();
    dos.restore({
      baseImageId: "cs-dos-1.0-rootfs-v5",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });

    expect(dos.exists("/drives/c/command/qbasic.exe")).toBe(true);
    for (const launcher of ["csasm", "cscc", "cscpp", "pwb"]) {
      expect(dos.exists(`/drives/c/command/${launcher}.exe`)).toBe(false);
    }
  });

  it("renames a full legacy home with internal and external hard links without duplicating bytes", (): void => {
    const capacityBytes = 4 * 1_048_576;
    const filesystem = new InMemoryFilesystem({
      capacityBytes,
      maxEntries: 4_096,
      maxFileBytes: 1_048_576,
      maxPathLength: 255,
    });
    new ShellSession(filesystem, { osProfile: "linux" });
    filesystem.move("/home/cs", "/home/computer");
    rewriteInitialAccountAsLegacy(filesystem);
    filesystem.writeFile("/home/computer/internal.txt", "internal-data\n");
    filesystem.createHardLink(
      "/home/computer/internal.txt",
      "/home/computer/internal-hard.txt",
    );
    filesystem.writeFile("/home/computer/shared.txt", "external-data\n");
    filesystem.createHardLink(
      "/home/computer/shared.txt",
      "/home/shared-hard.txt",
    );

    const accountPaths = ["/etc/passwd", "/etc/group", "/etc/shadow"];
    const legacyAccountBytes = accountPaths.reduce(
      (total, path) => total + filesystem.getSize(path),
      0,
    );
    let filler = 0;
    while (filesystem.getFreeSpace() > 0) {
      const bytes = Math.min(
        filesystem.getFreeSpace(),
        filesystem.limits.maxFileBytes,
      );
      filesystem.writeFile(`/capacity-${String(filler)}`, "x".repeat(bytes));
      filler += 1;
    }
    expect(filesystem.getFreeSpace()).toBe(0);

    new ShellSession(filesystem, { osProfile: "linux" });

    const currentAccountBytes = accountPaths.reduce(
      (total, path) => total + filesystem.getSize(path),
      0,
    );
    expect(filesystem.getFreeSpace()).toBe(
      legacyAccountBytes - currentAccountBytes,
    );
    expect(filesystem.exists("/home/computer")).toBe(false);
    expect(filesystem.getLinkCount("/home/cs/internal.txt")).toBe(2);
    expect(filesystem.getLinkCount("/home/cs/internal-hard.txt")).toBe(2);
    expect(filesystem.getLinkCount("/home/cs/shared.txt")).toBe(2);
    expect(filesystem.getLinkCount("/home/shared-hard.txt")).toBe(2);
    filesystem.writeFile("/home/cs/internal.txt", "replacement--\n");
    filesystem.writeFile("/home/cs/shared.txt", "alternate-data\n");
    expect(filesystem.readFile("/home/cs/internal-hard.txt")).toBe(
      "replacement--\n",
    );
    expect(filesystem.readFile("/home/shared-hard.txt")).toBe(
      "alternate-data\n",
    );
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
