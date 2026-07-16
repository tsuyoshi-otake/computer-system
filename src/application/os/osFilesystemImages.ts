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
const linuxImageId = "cs-linux-1.0-rootfs-v4";
const legacyDosImageId = "cs-dos-6.2-rootfs-v1";
const previousDosImageId = "cs-dos-6.2-rootfs-v2";
const dosImageId = "cs-dos-6.2-rootfs-v3";

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

const toolchainCommands = new Set([
  "as",
  "basic",
  "basicc",
  "c++",
  "cc",
  "csdb",
  "ld",
  "nm",
  "objdump",
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

export const linuxFilesystemImage: FilesystemBaseImage = Object.freeze({
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

const previousLinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: previousLinuxImageId,
  directories: previousLinuxImageDirectories,
  files: Object.freeze([
    ...commandFiles(
      "linux",
      commandExecutableNamesFor("linux").filter(
        (command) => !osPresenceCommands.has(command),
      ),
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
      commandExecutableNamesFor("linux").filter(
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

export const dosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: dosImageId,
  directories: Object.freeze([
    "/drives",
    "/drives/c",
    "/drives/c/command",
    "/drives/c/dos",
    "/drives/c/temp",
  ]),
  files: Object.freeze([
    ...commandFiles("dos"),
    imageFile("/drives/c/command.com", "command", 55_968),
    dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
    dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
  ]),
});

const previousDosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: previousDosImageId,
  directories: dosFilesystemImage.directories,
  files: Object.freeze([
    ...commandFiles(
      "dos",
      commandExecutableNamesFor("dos").filter(
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
  directories: dosFilesystemImage.directories,
  files: Object.freeze([
    ...commandFiles(
      "dos",
      commandExecutableNamesFor("dos").filter(
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
  registerFilesystemBaseImage(linuxFilesystemImage);
  registerFilesystemBaseImage(legacyDosFilesystemImage);
  registerFilesystemBaseImage(previousDosFilesystemImage);
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
  return /^[A-Za-z0-9+_[\]-]{1,32}$/u.test(command) ? command : undefined;
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
                  ? command === "edit"
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

function dosExecutableName(command: string): string {
  if (command === "c++") return "cpp.com";
  if (command === "csdb") return "debug.exe";
  if (command === "systeminfo") return "sysinfo.com";
  return `${command.toLowerCase()}.com`;
}
