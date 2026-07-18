import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import {
  registerFilesystemBaseImage,
  type FilesystemBaseImage,
  type FilesystemBaseImageFile,
  type InMemoryFilesystem,
} from "../../domain/filesystem/inMemoryFilesystem.js";
import { commandExecutableNamesFor } from "./commandRegistry.js";

const executableHeader = "CSUTIL1\n";
const legacyLinuxImageId = "cs-linux-1.0-rootfs-v1";
const olderLinuxImageId = "cs-linux-1.0-rootfs-v2";
const previousLinuxImageId = "cs-linux-1.0-rootfs-v3";
const recentLinuxImageId = "cs-linux-1.0-rootfs-v4";
const formerLinuxImageId = "cs-linux-1.0-rootfs-v5";
const linuxImageId = "cs-linux-1.0-rootfs-v6";
const currentLinuxImageId = "cs-linux-1.0-rootfs-v7";
const legacyDosImageId = "cs-dos-1.0-rootfs-v1";
const previousDosImageId = "cs-dos-1.0-rootfs-v2";
const recentDosImageId = "cs-dos-1.0-rootfs-v3";
const formerDosImageId = "cs-dos-1.0-rootfs-v4";
const priorDosImageId = "cs-dos-1.0-rootfs-v5";
const dosImageId = "cs-dos-1.0-rootfs-v6";
const currentDosImageId = "cs-dos-1.0-rootfs-v7";

const previousLinuxImageDirectories = Object.freeze([
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/home",
  "/home/computer",
  "/lib",
  "/lib/python",
  "/proc",
  "/root",
  "/tmp",
  "/usr",
  "/usr/bin",
  "/usr/lib",
  "/usr/lib/computer-system",
  "/usr/lib/computer-system/python",
  "/var",
  "/var/log",
]);

const linuxImageDirectories = Object.freeze([
  ...previousLinuxImageDirectories,
  "/run",
  "/usr/share",
  "/usr/share/man",
  "/var/lib",
  "/var/lib/cs-os",
]);

const currentLinuxImageDirectories = Object.freeze([
  ...linuxImageDirectories,
  "/usr/include",
]);

// Immutable command set shipped under cs-linux-1.0-rootfs-v1. Keep this list
// fixed so a cold persisted v1 overlay always resolves against the exact image
// it originally referenced.
const legacyLinuxCommands = Object.freeze([
  "[",
  "alias",
  "as",
  "basename",
  "bash",
  "basic",
  "basicc",
  "c++",
  "cat",
  "cc",
  "cd",
  "chgrp",
  "chmod",
  "chown",
  "clear",
  "cmp",
  "command",
  "cpuinfo",
  "cp",
  "cut",
  "date",
  "df",
  "diff",
  "dirname",
  "dmesg",
  "du",
  "echo",
  "env",
  "exit",
  "export",
  "false",
  "file",
  "find",
  "free",
  "getopts",
  "grep",
  "groups",
  "head",
  "help",
  "hexdump",
  "history",
  "hostname",
  "i2c",
  "id",
  "ld",
  "ln",
  "local",
  "ls",
  "micropython",
  "mkdir",
  "mktemp",
  "mount",
  "mv",
  "nm",
  "objdump",
  "od",
  "printenv",
  "printf",
  "pwd",
  "python",
  "quota",
  "read",
  "readlink",
  "realpath",
  "reboot",
  "rm",
  "rmdir",
  "run",
  "seq",
  "sha256sum",
  "sh",
  "shift",
  "shutdown",
  "sleep",
  "sort",
  "source",
  "spi",
  "stat",
  "sync",
  "tail",
  "tee",
  "test",
  "time",
  "touch",
  "tr",
  "true",
  "type",
  "unalias",
  "uname",
  "uniq",
  "unset",
  "uptime",
  "vi",
  "wc",
  "which",
  "whoami",
  "xargs",
  "yes",
]);

// Immutable command snapshots shipped by the immediately previous images.
// These cannot be derived from the live registry: persisted overlays may still
// name v6/v5/v4 after the current profile adds the WorkBench or replaces BASIC with QBASIC.
const formerLinuxCommands = Object.freeze([
  "[",
  "alias",
  "apropos",
  "as",
  "basename",
  "bash",
  "basic",
  "basicc",
  "bg",
  "c++",
  "cat",
  "cc",
  "cd",
  "chgrp",
  "chmod",
  "chown",
  "clear",
  "cmp",
  "command",
  "cp",
  "cpuinfo",
  "csdb",
  "cut",
  "date",
  "df",
  "diff",
  "dirname",
  "dmesg",
  "du",
  "echo",
  "eject",
  "env",
  "exit",
  "export",
  "false",
  "fg",
  "file",
  "find",
  "free",
  "getent",
  "getopts",
  "grep",
  "groupadd",
  "groupdel",
  "groups",
  "head",
  "help",
  "hexdump",
  "history",
  "hostname",
  "i2c",
  "id",
  "jobs",
  "kill",
  "last",
  "ld",
  "ln",
  "local",
  "login",
  "logout",
  "ls",
  "man",
  "micropython",
  "mkdir",
  "mkfs.fat",
  "mktemp",
  "mount",
  "mv",
  "nm",
  "objdump",
  "od",
  "passwd",
  "printenv",
  "printf",
  "ps",
  "pwd",
  "python",
  "quota",
  "read",
  "readlink",
  "realpath",
  "reboot",
  "rm",
  "rmdir",
  "run",
  "seq",
  "service",
  "sh",
  "sha256sum",
  "shift",
  "shutdown",
  "sleep",
  "sort",
  "source",
  "spi",
  "stat",
  "su",
  "sudo",
  "sync",
  "tail",
  "tee",
  "test",
  "time",
  "top",
  "touch",
  "tr",
  "true",
  "tty",
  "type",
  "umask",
  "umount",
  "unalias",
  "uname",
  "uniq",
  "unset",
  "uptime",
  "useradd",
  "userdel",
  "usermod",
  "vi",
  "w",
  "wait",
  "wc",
  "which",
  "who",
  "whoami",
  "xargs",
  "yes",
]);

const formerDosCommands = Object.freeze([
  "as",
  "attrib",
  "basic",
  "basicc",
  "c++",
  "cc",
  "cd",
  "chdir",
  "chkdsk",
  "cls",
  "copy",
  "cpu",
  "csdb",
  "date",
  "del",
  "dir",
  "doskey",
  "echo",
  "edit",
  "eject",
  "erase",
  "exit",
  "format",
  "help",
  "i2c",
  "label",
  "ld",
  "md",
  "mem",
  "mkdir",
  "move",
  "nm",
  "objdump",
  "path",
  "prompt",
  "rd",
  "rem",
  "ren",
  "rename",
  "rmdir",
  "run",
  "set",
  "spi",
  "sys",
  "systeminfo",
  "time",
  "timer",
  "tree",
  "type",
  "ver",
  "vi",
  "vol",
]);

const priorDosCommands = Object.freeze(
  [
    ...formerDosCommands.filter(
      (command) => command !== "basic" && command !== "basicc",
    ),
    "qbasic",
  ].sort(),
);

const toolchainCommands = new Set([
  "as",
  "basic",
  "basicc",
  "c++",
  "cc",
  "csasm",
  "cscc",
  "cscpp",
  "csdb",
  "ld",
  "nm",
  "objdump",
  "pwb",
  "run",
]);

const osPresenceCommands = new Set([
  "apropos",
  "bg",
  "fg",
  "jobs",
  "kill",
  "last",
  "man",
  "ps",
  "service",
  "top",
  "tty",
  "w",
  "wait",
  "who",
]);

const floppyCommands = new Set([
  "eject",
  "format",
  "mkfs.fat",
  "sys",
  "umount",
]);

export const linuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: currentLinuxImageId,
  directories: currentLinuxImageDirectories,
  files: Object.freeze([
    ...commandFiles("linux"),
    dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
    dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
    plainFile(
      "/etc/motd",
      "Welcome to CS-Linux 1.0. Type 'help' for commands or 'man cs-linux' for the field guide.\n",
    ),
    plainFile(
      "/usr/share/man/README",
      "CS-Linux manual pages are served by the versioned man/apropos command index.\n",
    ),
    plainFile("/var/log/messages", "", 0o640),
    plainFile("/var/log/auth.log", "", 0o600),
    ...cFamilyHeaders("linux"),
  ]),
});

const priorLinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxImageId,
  directories: linuxImageDirectories,
  files: Object.freeze([
    ...commandFiles("linux"),
    dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
    dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
    plainFile(
      "/etc/motd",
      "Welcome to CS-Linux 1.0. Type 'help' for commands or 'man cs-linux' for the field guide.\n",
    ),
    plainFile(
      "/usr/share/man/README",
      "CS-Linux manual pages are served by the versioned man/apropos command index.\n",
    ),
    plainFile("/var/log/messages", "", 0o640),
    plainFile("/var/log/auth.log", "", 0o600),
  ]),
});

const formerLinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: formerLinuxImageId,
  directories: linuxImageDirectories,
  files: Object.freeze([
    ...commandFiles("linux", formerLinuxCommands),
    dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
    dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
    plainFile(
      "/etc/motd",
      "Welcome to CS-Linux 1.0. Type 'help' for commands or 'man cs-linux' for the field guide.\n",
    ),
    plainFile(
      "/usr/share/man/README",
      "CS-Linux manual pages are served by the versioned man/apropos command index.\n",
    ),
    plainFile("/var/log/messages", "", 0o640),
    plainFile("/var/log/auth.log", "", 0o600),
  ]),
});

const recentLinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: recentLinuxImageId,
  directories: linuxImageDirectories,
  files: Object.freeze([
    ...commandFiles(
      "linux",
      formerLinuxCommands.filter((command) => !floppyCommands.has(command)),
    ),
    dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
    dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
    plainFile(
      "/etc/motd",
      "Welcome to CS-Linux 1.0. Type 'help' for commands or 'man cs-linux' for the field guide.\n",
    ),
    plainFile(
      "/usr/share/man/README",
      "CS-Linux manual pages are served by the versioned man/apropos command index.\n",
    ),
    plainFile("/var/log/messages", "", 0o640),
    plainFile("/var/log/auth.log", "", 0o600),
  ]),
});

const previousLinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: previousLinuxImageId,
  directories: previousLinuxImageDirectories,
  files: Object.freeze([
    ...commandFiles(
      "linux",
      formerLinuxCommands.filter((command) => !osPresenceCommands.has(command)),
    ),
    dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
    dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
  ]),
});

const olderLinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: olderLinuxImageId,
  directories: previousLinuxImageDirectories,
  files: Object.freeze([
    ...commandFiles(
      "linux",
      formerLinuxCommands.filter(
        (command) => command !== "csdb" && !osPresenceCommands.has(command),
      ),
    ),
    dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
    dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
  ]),
});

const legacyLinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: legacyLinuxImageId,
  directories: previousLinuxImageDirectories,
  files: Object.freeze([
    ...commandFiles("linux", legacyLinuxCommands),
    dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
    dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
  ]),
});

const priorDosImageDirectories = Object.freeze([
  "/drives",
  "/drives/c",
  "/drives/c/command",
  "/drives/c/dos",
  "/drives/c/temp",
]);

const currentDosImageDirectories = Object.freeze([
  ...priorDosImageDirectories,
  "/drives/c/include",
]);

export const dosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: currentDosImageId,
  directories: currentDosImageDirectories,
  files: Object.freeze([
    ...commandFiles("dos"),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
    ...cFamilyHeaders("dos"),
  ]),
});

const preprocessorPriorDosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: dosImageId,
  directories: priorDosImageDirectories,
  files: Object.freeze([
    ...commandFiles("dos"),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
  ]),
});

const priorDosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: priorDosImageId,
  directories: priorDosImageDirectories,
  files: Object.freeze([
    ...commandFiles("dos", priorDosCommands),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
  ]),
});

const formerDosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: formerDosImageId,
  directories: priorDosImageDirectories,
  files: Object.freeze([
    ...commandFiles("dos", formerDosCommands),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
  ]),
});

const recentDosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: recentDosImageId,
  directories: priorDosImageDirectories,
  files: Object.freeze([
    ...commandFiles(
      "dos",
      formerDosCommands.filter((command) => !floppyCommands.has(command)),
    ),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
  ]),
});

const previousDosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: previousDosImageId,
  directories: priorDosImageDirectories,
  files: Object.freeze([
    ...commandFiles(
      "dos",
      formerDosCommands.filter(
        (command) => !["attrib", "chkdsk", "label"].includes(command),
      ),
    ),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
  ]),
});

const legacyDosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: legacyDosImageId,
  directories: priorDosImageDirectories,
  files: Object.freeze([
    ...commandFiles(
      "dos",
      formerDosCommands.filter(
        (command) =>
          command !== "csdb" &&
          !["attrib", "chkdsk", "label"].includes(command),
      ),
    ),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
  ]),
});

/** Registers immutable OS images before any persisted overlay is restored. */
export function registerOsFilesystemImages(): void {
  registerFilesystemBaseImage(legacyLinuxFilesystemImage);
  registerFilesystemBaseImage(olderLinuxFilesystemImage);
  registerFilesystemBaseImage(previousLinuxFilesystemImage);
  registerFilesystemBaseImage(recentLinuxFilesystemImage);
  registerFilesystemBaseImage(formerLinuxFilesystemImage);
  registerFilesystemBaseImage(priorLinuxFilesystemImage);
  registerFilesystemBaseImage(linuxFilesystemImage);
  registerFilesystemBaseImage(legacyDosFilesystemImage);
  registerFilesystemBaseImage(previousDosFilesystemImage);
  registerFilesystemBaseImage(recentDosFilesystemImage);
  registerFilesystemBaseImage(formerDosFilesystemImage);
  registerFilesystemBaseImage(priorDosFilesystemImage);
  registerFilesystemBaseImage(preprocessorPriorDosFilesystemImage);
  registerFilesystemBaseImage(dosFilesystemImage);
}

export function installOsFilesystemImage(
  filesystem: InMemoryFilesystem,
  profile: ComputerOsProfile,
): void {
  filesystem.attachBaseImage(
    profile === "dos" ? dosFilesystemImage : linuxFilesystemImage,
  );
}

export function commandExecutablePath(
  profile: ComputerOsProfile,
  command: string,
): string {
  if (profile === "linux") {
    if (command === "bash") return "/bin/bash";
    if (command === "sh") return "/bin/sh";
    return `/usr/bin/${command}`;
  }
  return `/drives/c/command/${dosExecutableName(command)}`;
}

export function decodeSystemUtility(contents: string): string | undefined {
  if (!contents.startsWith(executableHeader)) return undefined;
  const newline = contents.indexOf("\n", executableHeader.length);
  if (newline < 0) return undefined;
  const command = contents.slice(executableHeader.length, newline);
  return /^[A-Za-z0-9+_.[\]-]{1,32}$/u.test(command) ? command : undefined;
}

function commandFiles(
  profile: ComputerOsProfile,
  names: readonly string[] = commandExecutableNamesFor(profile),
): FilesystemBaseImageFile[] {
  return [...names]
    .sort()
    .map((command) =>
      imageFile(
        commandExecutablePath(profile, command),
        command,
        toolchainCommands.has(command)
          ? profile === "dos"
            ? 32_768
            : 65_536
          : profile === "linux" &&
              (command === "python" || command === "micropython")
            ? 98_304
            : profile === "linux" && command === "bash"
              ? 65_536
              : profile === "linux" && command === "sh"
                ? 32_768
                : profile === "dos"
                  ? command === "qbasic"
                    ? 196_608
                    : command === "edit"
                      ? 65_536
                      : 4_096
                  : 8_192,
      ),
    );
}

function imageFile(
  path: string,
  command: string,
  size: number,
): FilesystemBaseImageFile {
  const header = `${executableHeader}${command}\n`;
  return Object.freeze({
    contents: header.padEnd(size, "\0"),
    metadata: Object.freeze({ gid: 0, mode: 0o755, uid: 0 }),
    path,
  });
}

function dataFile(
  path: string,
  description: string,
  size: number,
): FilesystemBaseImageFile {
  return Object.freeze({
    contents: `${description}\n`.padEnd(size, "\0"),
    metadata: Object.freeze({ gid: 0, mode: 0o644, uid: 0 }),
    path,
  });
}

function plainFile(
  path: string,
  contents: string,
  mode = 0o644,
): FilesystemBaseImageFile {
  return Object.freeze({
    contents,
    metadata: Object.freeze({ gid: 0, mode, uid: 0 }),
    path,
  });
}

function cFamilyHeaders(
  profile: ComputerOsProfile,
): readonly FilesystemBaseImageFile[] {
  const newline = profile === "dos" ? "\r\n" : "\n";
  const directory = profile === "dos" ? "/drives/c/include" : "/usr/include";
  const header = (
    name: string,
    lines: readonly string[],
  ): FilesystemBaseImageFile =>
    plainFile(`${directory}/${name}`, `${lines.join(newline)}${newline}`);
  return Object.freeze([
    header("stdio.h", [
      "#ifndef CS_STDIO_H",
      "#define CS_STDIO_H 1",
      "/* CS C/C++ 1.0 supports the built-in printf integer subset. */",
      "#endif",
    ]),
    header("cstdio", [
      "#ifndef CS_CSTDIO",
      "#define CS_CSTDIO 1",
      "#include <stdio.h>",
      "#endif",
    ]),
    header("iostream", [
      "#ifndef CS_IOSTREAM",
      "#define CS_IOSTREAM 1",
      "/* CS C/C++ 1.0 supports integer std::cout and std::endl only. */",
      "#endif",
    ]),
  ]);
}

function dosExecutableName(command: string): string {
  if (command === "c++") return "cpp.com";
  if (command === "csdb") return "debug.exe";
  if (command === "qbasic") return "qbasic.exe";
  if (["csasm", "cscc", "cscpp", "pwb"].includes(command)) {
    return `${command}.exe`;
  }
  if (command === "systeminfo") return "sysinfo.com";
  return `${command.toLowerCase()}.com`;
}
