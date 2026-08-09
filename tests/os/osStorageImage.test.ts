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
    // The guest-built NetHack executable is charged as a real rootfs blob.
    expect(linuxUsed).toBeLessThan(12 * 1_048_576);
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
    expect(snapshot.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(second.filesystem.exists("/home/cs")).toBe(true);
    expect(second.filesystem.exists("/home/computer")).toBe(false);
    expect(snapshot.files.some(([path]) => path.startsWith("/usr/bin/"))).toBe(
      false,
    );
    expect(
      snapshot.blobs.reduce((sum, [, contents]) => sum + contents.length, 0),
    ).toBeLessThan(64 * 1_024);
  });

  it("migrates modified and deleted v7 Linux command overlays to v8 paths", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v7",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    filesystem.writeFile("/usr/bin/mount", "custom mount wrapper");
    filesystem.delete("/usr/bin/service");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.readFile("/sbin/mount")).toBe("custom mount wrapper");
    expect(filesystem.exists("/usr/bin/mount")).toBe(false);
    expect(filesystem.exists("/sbin/service")).toBe(false);
    expect(filesystem.snapshot().tombstones).toContain("/sbin/service");
  });

  it("provisions the SysV rc.d symlink farm for a Computer restored from v8, idempotently", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v8",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.exists("/etc/inittab")).toBe(true);
    expect(filesystem.exists("/etc/init.d/syslog")).toBe(true);
    expect(filesystem.exists("/etc/init.d/cron")).toBe(true);
    expect(filesystem.readLink("/etc/rc2.d/S10syslog")).toBe(
      "../init.d/syslog",
    );
    expect(filesystem.readLink("/etc/rc6.d/K80cron")).toBe("../init.d/cron");

    const rc2Before = [...filesystem.list("/etc/rc2.d")].sort();
    new ShellSession(filesystem, { osProfile: "linux" });
    expect([...filesystem.list("/etc/rc2.d")].sort()).toEqual(rc2Before);
    expect(filesystem.readLink("/etc/rc2.d/S10syslog")).toBe(
      "../init.d/syslog",
    );
    expect(filesystem.isSymbolicLink("/etc/rc2.d/S10syslog")).toBe(true);
  });

  it("migrates v7 DOS command overlays and user files into C:\\DOS", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-dos-1.0-rootfs-v7",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    filesystem.writeFile("/drives/c/command/edit.com", "custom editor wrapper");
    filesystem.writeFile("/drives/c/command/user.com", "user command");
    filesystem.delete("/drives/c/command/tree.com");

    new ShellSession(filesystem, { osProfile: "dos" });

    expect(filesystem.readFile("/drives/c/dos/edit.com")).toBe(
      "custom editor wrapper",
    );
    expect(filesystem.readFile("/drives/c/dos/user.com")).toBe("user command");
    expect(filesystem.exists("/drives/c/dos/tree.com")).toBe(false);
    expect(filesystem.exists("/drives/c/command")).toBe(false);
  });

  it("migrates v8 DOS overlays to the current image without replacing custom files or tombstones", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-dos-1.0-rootfs-v8",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    filesystem.writeFile("/drives/c/dos/user.com", "user command");
    filesystem.delete("/drives/c/dos/tree.com");

    new ShellSession(filesystem, { osProfile: "dos" });

    expect(filesystem.baseImageId).toBe("cs-dos-1.0-rootfs-v10");
    expect(filesystem.readFile("/drives/c/dos/user.com")).toBe("user command");
    expect(filesystem.exists("/drives/c/dos/tree.com")).toBe(false);
    expect(filesystem.exists("/drives/c/dos/more.com")).toBe(true);
    expect(filesystem.exists("/drives/c/dos/choice.com")).toBe(true);
    expect(filesystem.exists("/drives/c/dos/comp.com")).toBe(true);
    expect(filesystem.exists("/drives/c/dos/fc.exe")).toBe(true);
    expect(filesystem.exists("/drives/c/dos/find.exe")).toBe(true);
    expect(filesystem.exists("/drives/c/dos/pause.com")).toBe(true);
    expect(filesystem.exists("/drives/c/dos/sort.exe")).toBe(true);

    const customized = new InMemoryFilesystem();
    customized.restore({
      baseImageId: "cs-dos-1.0-rootfs-v8",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    customized.writeFile("/drives/c/dos/more.com", "custom MORE wrapper");
    new ShellSession(customized, { osProfile: "dos" });
    expect(customized.readFile("/drives/c/dos/more.com")).toBe(
      "custom MORE wrapper",
    );

    const deleted = new InMemoryFilesystem();
    new ShellSession(deleted, { osProfile: "dos" });
    deleted.delete("/drives/c/dos/more.com");
    new ShellSession(deleted, { osProfile: "dos" });
    expect(deleted.exists("/drives/c/dos/more.com")).toBe(false);
    expect(deleted.snapshot().tombstones).toContain("/drives/c/dos/more.com");
  });

  it("upgrades the v9 DOS image without replacing a custom text utility", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-dos-1.0-rootfs-v9",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/drives/c/dos/find.exe")).toBe(false);
    filesystem.writeFile("/drives/c/dos/find.exe", "custom FIND wrapper");

    new ShellSession(filesystem, { osProfile: "dos" });

    expect(filesystem.baseImageId).toBe("cs-dos-1.0-rootfs-v10");
    expect(filesystem.readFile("/drives/c/dos/find.exe")).toBe(
      "custom FIND wrapper",
    );
    expect(filesystem.exists("/drives/c/dos/choice.com")).toBe(true);
    expect(filesystem.exists("/drives/c/dos/sort.exe")).toBe(true);
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

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
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

    expect(linux.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(linux.exists("/usr/bin/basic")).toBe(false);
    expect(linux.exists("/usr/bin/basicc")).toBe(false);
    expect(linuxShell.submit("basic C:/DEMO.BAS").exitCode).toBe(127);
    expect(linuxShell.submit("basicc C:/DEMO.BAS").exitCode).toBe(127);

    expect(linux.readFile("/usr/include/stdio.h")).toContain(
      "#define CS_STDIO_H 1\n",
    );
    expect(linux.exists("/usr/include/cstdio")).toBe(true);
    expect(linux.exists("/usr/include/iostream")).toBe(true);
    expect(linux.exists("/usr/include/cs/syscall.h")).toBe(true);
    expect(linux.exists("/usr/include/string.h")).toBe(true);
    expect(linux.exists("/usr/src/cs-libc/libc.c")).toBe(true);
    expect(linux.readFile("/usr/include/stdint.h")).toContain(
      "#ifdef __CS_BYTE8__",
    );
    expect(linux.readFile("/usr/include/stdint.h")).toContain(
      "typedef unsigned char uint8_t;",
    );

    expect(dos.baseImageId).toBe("cs-dos-1.0-rootfs-v10");
    expect(dos.exists("/drives/c/command")).toBe(false);
    expect(dos.exists("/drives/c/dos/basic.com")).toBe(false);
    expect(dos.exists("/drives/c/dos/basicc.com")).toBe(false);
    expect(dos.exists("/drives/c/dos/qbasic.exe")).toBe(true);
    expect(dos.getSize("/drives/c/dos/qbasic.exe")).toBe(194_309);
    expect(dos.getSize("/drives/c/dos/more.com")).toBe(10_240);
    expect(dos.exists("/drives/c/dos/choice.com")).toBe(true);
    expect(dos.exists("/drives/c/dos/comp.com")).toBe(true);
    expect(dos.exists("/drives/c/dos/fc.exe")).toBe(true);
    expect(dos.exists("/drives/c/dos/find.exe")).toBe(true);
    expect(dos.exists("/drives/c/dos/pause.com")).toBe(true);
    expect(dos.exists("/drives/c/dos/sort.exe")).toBe(true);
    for (const launcher of ["csasm", "cscc", "cscpp", "pwb"]) {
      expect(dos.exists(`/drives/c/dos/${launcher}.exe`)).toBe(true);
    }
    expect(dos.exists("/drives/c/io.sys")).toBe(true);
    expect(dos.exists("/drives/c/msdos.sys")).toBe(true);
    expect(
      dos.getMetadata("/drives/c/io.sys").modifiedAtMilliseconds,
    ).toBeGreaterThan(0);
    expect(linux.exists("/usr/bin/cd")).toBe(false);
    expect(linux.exists("/sbin/cs-init")).toBe(true);
    expect(linux.exists("/sbin/reboot")).toBe(true);
    expect(linux.exists("/usr/sbin/useradd")).toBe(true);
    expect(linux.exists("/etc/fstab")).toBe(true);
    expect(linux.exists("/etc/issue")).toBe(true);
    expect(linux.exists("/mnt")).toBe(true);
    expect(linux.exists("/etc/inittab")).toBe(true);
    expect(linux.exists("/etc/crontab")).toBe(true);
    expect(linux.exists("/etc/init.d/syslog")).toBe(true);
    expect(linux.exists("/etc/init.d/cron")).toBe(true);
    expect(linux.getMetadata("/etc/init.d/syslog").mode & 0o111).not.toBe(0);
    expect(linux.exists("/sbin/cs-init-ctl")).toBe(true);
    expect(linux.exists("/sbin/telinit")).toBe(true);
    expect(linux.exists("/sbin/runlevel")).toBe(true);
    for (const runlevel of ["0", "1", "2", "3", "4", "5", "6"]) {
      expect(linux.isDirectory(`/etc/rc${runlevel}.d`)).toBe(true);
    }
    expect(linux.readLink("/etc/rc3.d/S10syslog")).toBe("../init.d/syslog");
    expect(linux.readLink("/etc/rc3.d/S20cron")).toBe("../init.d/cron");
    expect(linux.readLink("/etc/rc0.d/K90syslog")).toBe("../init.d/syslog");
    expect(linux.readLink("/etc/rc0.d/K80cron")).toBe("../init.d/cron");
    expect(dos.readFile("/drives/c/include/stdio.h")).toContain(
      "#define CS_STDIO_H 1\r\n",
    );
    expect(dos.exists("/drives/c/include/cstdio")).toBe(true);
    expect(dos.exists("/drives/c/include/iostream")).toBe(true);
    expect(dosShell.submit("BASIC C:\\DEMO.BAS").exitCode).toBe(127);
  });

  it("installs Git only in Linux v12 while keeping v11 immutable", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v11",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });

    expect(filesystem.exists("/usr/bin/git")).toBe(false);
    expect(filesystem.exists("/usr/bin/make")).toBe(true);

    new ShellSession(filesystem, { osProfile: "linux" });
    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.exists("/usr/bin/git")).toBe(true);
  });

  it("upgrades a v12 overlay to the v13 hosted libc image without copying it", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v12",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/usr/include/cs/syscall.h")).toBe(false);
    filesystem.writeFile("/root/preserved", "overlay\n");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.readFile("/root/preserved")).toBe("overlay\n");
    expect(filesystem.exists("/usr/include/cs/syscall.h")).toBe(true);
    expect(filesystem.exists("/usr/src/cs-libc/libc.c")).toBe(true);
    expect(
      filesystem
        .snapshot()
        .files.some(([path]) => path === "/usr/src/cs-libc/libc.c"),
    ).toBe(false);
  });

  it("keeps v13 free of NetHack and mounts it in the current image", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v13",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/usr/games/nethack")).toBe(false);
    expect(filesystem.exists("/usr/src/nethack/main.c")).toBe(false);
    filesystem.writeFile("/root/preserved-v13", "overlay\n");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.readFile("/root/preserved-v13")).toBe("overlay\n");
    expect(filesystem.exists("/usr/games/nethack")).toBe(true);
    expect(filesystem.exists("/usr/src/nethack/main.c")).toBe(true);
    expect(
      filesystem
        .snapshot()
        .files.some(([path]) => path === "/usr/games/nethack"),
    ).toBe(false);
  });

  it("keeps v14 immutable and adds bounded stdarg only in v15", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v14",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/usr/games/nethack")).toBe(true);
    expect(filesystem.exists("/usr/include/stdarg.h")).toBe(false);
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).not.toContain(
      "__cs_va_arg",
    );
    filesystem.writeFile("/root/preserved-v14", "overlay\n");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.readFile("/root/preserved-v14")).toBe("overlay\n");
    expect(filesystem.exists("/usr/include/stdarg.h")).toBe(true);
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).toContain(
      "__cs_va_arg",
    );
    expect(
      filesystem
        .snapshot()
        .files.some(([path]) => path === "/usr/include/stdarg.h"),
    ).toBe(false);
  });

  it("keeps v15 headers immutable and installs the completed integer model in v16", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v15",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.readFile("/usr/include/stdbool.h")).toContain(
      "#define bool int",
    );
    expect(filesystem.readFile("/usr/include/limits.h")).not.toContain(
      "UINT_MAX",
    );
    expect(filesystem.readFile("/usr/include/stdint.h")).not.toContain(
      "uint64_t",
    );
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).not.toContain(
      "return cs_write(1, (void *)0, 0)",
    );
    filesystem.writeFile("/root/preserved-v15", "overlay\n");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.readFile("/root/preserved-v15")).toBe("overlay\n");
    expect(filesystem.readFile("/usr/include/stdbool.h")).toContain(
      "#define bool _Bool",
    );
    expect(filesystem.readFile("/usr/include/limits.h")).toContain(
      "#define ULLONG_MAX 18446744073709551615ULL",
    );
    expect(filesystem.readFile("/usr/include/stdint.h")).toContain(
      "typedef unsigned long long uint64_t;",
    );
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).toContain(
      "return cs_write(1, (void *)0, 0)",
    );
    expect(
      filesystem
        .snapshot()
        .files.some(([path]) => path === "/usr/include/stdint.h"),
    ).toBe(false);
  });

  it("keeps v16 libc immutable and installs POSIX/curses sources in v17", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v16",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/usr/include/dirent.h")).toBe(false);
    expect(filesystem.exists("/usr/include/curses.h")).toBe(false);
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).not.toContain(
      "cs_opendir",
    );
    filesystem.writeFile("/root/preserved-v16", "overlay\n");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.readFile("/root/preserved-v16")).toBe("overlay\n");
    expect(filesystem.exists("/usr/include/dirent.h")).toBe(true);
    expect(filesystem.exists("/usr/include/curses.h")).toBe(true);
    expect(filesystem.exists("/usr/src/libcs-curses/curses.c")).toBe(true);
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).toContain(
      "cs_opendir",
    );
  });

  it("keeps the v17 word libc immutable and installs byte profiles in v18", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v17",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/usr/include/cs/byte.h")).toBe(false);
    expect(filesystem.exists("/usr/lib/cs-byte8-v1/libc.csa")).toBe(false);
    expect(filesystem.readFile("/usr/include/limits.h")).toContain(
      "#define CHAR_BIT 32",
    );
    expect(filesystem.readFile("/usr/include/limits.h")).not.toContain(
      "__CS_BYTE8__",
    );
    filesystem.writeFile("/root/preserved-v17", "overlay\n");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.readFile("/root/preserved-v17")).toBe("overlay\n");
    expect(filesystem.exists("/usr/include/cs/byte.h")).toBe(true);
    expect(filesystem.exists("/usr/lib/cs-byte8-v1/libc.csa")).toBe(true);
    expect(filesystem.exists("/usr/lib/cs-word32-v1/libc.csa")).toBe(true);
  });

  it("keeps the v18 byte-profile libc immutable and installs float support in v19", (): void => {
    registerOsFilesystemImages();
    const filesystem = new InMemoryFilesystem();
    filesystem.restore({
      baseImageId: "cs-linux-1.0-rootfs-v18",
      blobs: [],
      directories: [],
      files: [],
      schema: 2,
    });
    expect(filesystem.exists("/usr/include/cs/byte.h")).toBe(true);
    expect(filesystem.exists("/usr/include/float.h")).toBe(false);
    expect(filesystem.exists("/usr/include/math.h")).toBe(false);
    expect(filesystem.exists("/usr/lib/cs-byte8-v1/libm.csa")).toBe(false);
    expect(filesystem.readFile("/usr/include/stdarg.h")).not.toContain(
      "__CS_VA_WORDS",
    );
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).not.toContain(
      "cs_format_float",
    );
    filesystem.writeFile("/root/preserved-v18", "overlay\n");

    new ShellSession(filesystem, { osProfile: "linux" });

    expect(filesystem.baseImageId).toBe("cs-linux-1.0-rootfs-v20");
    expect(filesystem.readFile("/root/preserved-v18")).toBe("overlay\n");
    expect(filesystem.exists("/usr/include/float.h")).toBe(true);
    expect(filesystem.exists("/usr/include/math.h")).toBe(true);
    expect(filesystem.exists("/usr/lib/cs-byte8-v1/libm.csa")).toBe(true);
    expect(filesystem.readFile("/usr/include/stdarg.h")).toContain(
      "__CS_VA_WORDS",
    );
    expect(filesystem.readFile("/usr/src/cs-libc/libc.c")).toContain(
      "cs_format_float",
    );
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
    // Keep the fixture above the current charged base image, then consume every
    // remaining byte so the migration still proves hard-link preservation at
    // an actually full filesystem.
    const capacityBytes = 12 * 1_048_576;
    const filesystem = new InMemoryFilesystem({
      capacityBytes,
      maxEntries: 4_096,
      maxFileBytes: capacityBytes,
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
