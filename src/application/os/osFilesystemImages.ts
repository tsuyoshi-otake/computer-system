import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import {
  registerFilesystemBaseImage,
  type FilesystemBaseImage,
  type FilesystemBaseImageFile,
  type InMemoryFilesystem,
} from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  commandExecutableNamesFor,
  isDosInternalCommand,
  isLinuxBuiltinCommand,
} from "./commandRegistry.js";
import {
  hostedCLibcDirectories,
  hostedCLibcFiles,
  hostedCLibcV14Files,
  hostedCLibcV15Files,
  hostedCLibcV16Directories,
  hostedCLibcV16Files,
  hostedCLibcV17Directories,
  hostedCLibcV17Files,
  hostedCLibcV18Directories,
  hostedCLibcV18Files,
} from "./hostedCLibcImage.js";
import { guestNethackImageFiles } from "../toolchain/guestNethack.js";

const executableHeader = "CSUTIL1\n";
const legacyLinuxImageId = "cs-linux-1.0-rootfs-v1";
const olderLinuxImageId = "cs-linux-1.0-rootfs-v2";
const previousLinuxImageId = "cs-linux-1.0-rootfs-v3";
const recentLinuxImageId = "cs-linux-1.0-rootfs-v4";
const formerLinuxImageId = "cs-linux-1.0-rootfs-v5";
const linuxImageId = "cs-linux-1.0-rootfs-v6";
const linuxV7ImageId = "cs-linux-1.0-rootfs-v7";
const linuxV8ImageId = "cs-linux-1.0-rootfs-v8";
const linuxV9ImageId = "cs-linux-1.0-rootfs-v9";
const linuxV10ImageId = "cs-linux-1.0-rootfs-v10";
const linuxV11ImageId = "cs-linux-1.0-rootfs-v11";
const linuxV12ImageId = "cs-linux-1.0-rootfs-v12";
const linuxV13ImageId = "cs-linux-1.0-rootfs-v13";
const linuxV14ImageId = "cs-linux-1.0-rootfs-v14";
const linuxV15ImageId = "cs-linux-1.0-rootfs-v15";
const linuxV16ImageId = "cs-linux-1.0-rootfs-v16";
const linuxV17ImageId = "cs-linux-1.0-rootfs-v17";
const linuxV18ImageId = "cs-linux-1.0-rootfs-v18";
const currentLinuxImageId = "cs-linux-1.0-rootfs-v19";
const legacyDosImageId = "cs-dos-1.0-rootfs-v1";
const previousDosImageId = "cs-dos-1.0-rootfs-v2";
const recentDosImageId = "cs-dos-1.0-rootfs-v3";
const formerDosImageId = "cs-dos-1.0-rootfs-v4";
const priorDosImageId = "cs-dos-1.0-rootfs-v5";
const dosImageId = "cs-dos-1.0-rootfs-v6";
const dosV7ImageId = "cs-dos-1.0-rootfs-v7";
const dosV8ImageId = "cs-dos-1.0-rootfs-v8";
const currentDosImageId = "cs-dos-1.0-rootfs-v9";
export const installBaseImageTimestampMilliseconds = Date.UTC(2026, 6, 19);

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

const linuxV8ImageDirectories = Object.freeze([
  ...currentLinuxImageDirectories.filter((path) => path !== "/home/computer"),
  "/mnt",
  "/sbin",
  "/usr/sbin",
]);

const linuxV9ImageDirectories = Object.freeze([
  ...linuxV8ImageDirectories,
  "/etc/init.d",
  "/etc/rc0.d",
  "/etc/rc1.d",
  "/etc/rc2.d",
  "/etc/rc3.d",
  "/etc/rc4.d",
  "/etc/rc5.d",
  "/etc/rc6.d",
]);

const currentHostedLinuxImageDirectories = Object.freeze([
  ...linuxV9ImageDirectories,
  ...hostedCLibcDirectories,
]);

const currentV16HostedLinuxImageDirectories = Object.freeze([
  ...linuxV9ImageDirectories,
  ...hostedCLibcV16Directories,
]);

const currentV17HostedLinuxImageDirectories = Object.freeze([
  ...linuxV9ImageDirectories,
  ...hostedCLibcV17Directories,
]);

const currentV18HostedLinuxImageDirectories = Object.freeze([
  ...linuxV9ImageDirectories,
  ...hostedCLibcV18Directories,
]);

const currentGamesLinuxImageDirectories = Object.freeze([
  ...currentHostedLinuxImageDirectories,
  "/usr/games",
  "/usr/local",
  "/usr/local/bin",
  "/usr/local/games",
  "/usr/src/nethack",
]);

const currentV16GamesLinuxImageDirectories = Object.freeze([
  ...currentV16HostedLinuxImageDirectories,
  "/usr/games",
  "/usr/local",
  "/usr/local/bin",
  "/usr/local/games",
  "/usr/src/nethack",
]);

const currentV18GamesLinuxImageDirectories = Object.freeze([
  ...currentV18HostedLinuxImageDirectories,
  "/usr/games",
  "/usr/local",
  "/usr/local/bin",
  "/usr/local/games",
  "/usr/src/nethack",
]);

const currentV17GamesLinuxImageDirectories = Object.freeze([
  ...currentV17HostedLinuxImageDirectories,
  "/usr/games",
  "/usr/local",
  "/usr/local/bin",
  "/usr/local/games",
  "/usr/src/nethack",
]);

const guestNethackFiles = guestNethackImageFiles();

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
  "ar",
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
  "ranlib",
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

const linuxSbinCommands = new Set([
  "mkfs.fat",
  "mount",
  "reboot",
  "service",
  "shutdown",
  "umount",
  "telinit",
  "runlevel",
  "cs-init-ctl",
]);
const linuxUsrSbinCommands = new Set([
  "groupadd",
  "groupdel",
  "useradd",
  "userdel",
  "usermod",
]);

const currentV7DosCommands = Object.freeze([
  ...priorDosCommands,
  "csasm",
  "cscc",
  "cscpp",
  "pwb",
]);

const dosCommandSizes: Readonly<Record<string, number>> = Object.freeze({
  attrib: 11_112,
  chkdsk: 12_241,
  edit: 69_886,
  format: 22_974,
  label: 9_390,
  mem: 32_502,
  move: 17_575,
  more: 10_240,
  qbasic: 194_309,
  tree: 6_945,
});

const linuxCommandSizes: Readonly<Record<string, number>> = Object.freeze({
  bash: 65_536,
  ls: 13_312,
  micropython: 98_304,
  python: 98_304,
  sh: 32_768,
});

const linuxV11CommandNames = new Set([
  "awk",
  "crontab",
  "gunzip",
  "gzip",
  "nice",
  "nohup",
  "sed",
  "tar",
  "unzip",
  "vmstat",
  "watch",
  "zip",
]);
const linuxV12CommandNames = new Set(["git"]);
const preV12LinuxCommandNames = Object.freeze(
  commandExecutableNamesFor("linux").filter(
    (command) => !linuxV12CommandNames.has(command),
  ),
);
const preV11LinuxCommandNames = Object.freeze(
  preV12LinuxCommandNames.filter(
    (command) => !linuxV11CommandNames.has(command),
  ),
);
const preMakeLinuxCommandNames = Object.freeze(
  preV11LinuxCommandNames.filter((command) => command !== "make"),
);

export const linuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: currentLinuxImageId,
  directories: currentGamesLinuxImageDirectories,
  files: Object.freeze(
    withInstallTimestamp([
      ...commandFiles("linux", commandExecutableNamesFor("linux"), true),
      dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
      dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
      plainFile(
        "/etc/motd",
        "Welcome to CS-Linux 1.0.\nType 'help' for commands or 'man cs-linux' for the field guide.\n",
      ),
      plainFile("/etc/issue", "CS-Linux 1.0 console tty1\n"),
      plainFile(
        "/etc/fstab",
        "proc /proc proc defaults 0 0\ntmpfs /tmp tmpfs defaults 0 0\n",
      ),
      dataFile("/sbin/cs-init", "CS-Linux init process placeholder", 12_288),
      dataFile("/sbin/cs-getty", "CS-Linux getty process placeholder", 12_288),
      plainFile(
        "/etc/inittab",
        "# /etc/inittab: init(8) configuration for CS-Linux\n" +
          "si::sysinit:/etc/init.d/rcS\n" +
          "l0:0:wait:/etc/init.d/rc 0\n" +
          "l1:1:wait:/etc/init.d/rc 1\n" +
          "l2:2:wait:/etc/init.d/rc 2\n" +
          "l3:3:wait:/etc/init.d/rc 3\n" +
          "l4:4:wait:/etc/init.d/rc 4\n" +
          "l5:5:wait:/etc/init.d/rc 5\n" +
          "l6:6:wait:/etc/init.d/rc 6\n" +
          "1:2345:respawn:/sbin/cs-getty tty1\n" +
          "id:3:initdefault:\n",
      ),
      plainFile(
        "/etc/init.d/syslog",
        '#!/bin/sh\ncs-init-ctl syslog "$1"\n',
        0o755,
      ),
      plainFile(
        "/etc/init.d/cron",
        '#!/bin/sh\ncs-init-ctl cron "$1"\n',
        0o755,
      ),
      plainFile(
        "/etc/crontab",
        "# /etc/crontab: system crontab\n" +
          "# min hour dom month dow user command\n",
      ),
      plainFile(
        "/usr/share/man/README",
        "CS-Linux manual pages are served by the versioned man/apropos command index.\n",
      ),
      plainFile("/var/log/messages", "", 0o640),
      plainFile("/var/log/auth.log", "", 0o600),
      ...cFamilyHeaders("linux").filter(
        (file) => file.path !== "/usr/include/stdio.h",
      ),
      ...hostedCLibcFiles,
      ...guestNethackFiles,
    ]),
  ),
});

const hostedCLibcV18FilesByPath = new Map(
  withInstallTimestamp(hostedCLibcV18Files).map((file) => [file.path, file]),
);

const currentV18LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV18ImageId,
  directories: currentV18GamesLinuxImageDirectories,
  files: Object.freeze(
    linuxFilesystemImage.files.flatMap((file) => {
      const historical = hostedCLibcV18FilesByPath.get(file.path);
      if (historical !== undefined) return [historical];
      return hostedCLibcFiles.some(({ path }) => path === file.path)
        ? []
        : [file];
    }),
  ),
});

const hostedCLibcV17FilesByPath = new Map(
  withInstallTimestamp(hostedCLibcV17Files).map((file) => [file.path, file]),
);

const currentV17LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV17ImageId,
  directories: currentV17GamesLinuxImageDirectories,
  files: Object.freeze(
    currentV18LinuxFilesystemImage.files.flatMap((file) => {
      const historical = hostedCLibcV17FilesByPath.get(file.path);
      if (historical !== undefined) return [historical];
      return hostedCLibcV18Files.some(({ path }) => path === file.path)
        ? []
        : [file];
    }),
  ),
});

const hostedCLibcV15FilesByPath = new Map(
  withInstallTimestamp(hostedCLibcV15Files).map((file) => [file.path, file]),
);

const hostedCLibcV16FilesByPath = new Map(
  withInstallTimestamp(hostedCLibcV16Files).map((file) => [file.path, file]),
);

const currentV16LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV16ImageId,
  directories: currentV16GamesLinuxImageDirectories,
  files: Object.freeze(
    linuxFilesystemImage.files.flatMap((file) => {
      if (
        file.path === commandExecutablePath("linux", "ar") ||
        file.path === commandExecutablePath("linux", "ranlib")
      ) {
        return [];
      }
      const historical = hostedCLibcV16FilesByPath.get(file.path);
      if (historical !== undefined) return [historical];
      return hostedCLibcFiles.some(({ path }) => path === file.path)
        ? []
        : [file];
    }),
  ),
});

const currentV15LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV15ImageId,
  directories: currentV16GamesLinuxImageDirectories,
  files: Object.freeze(
    currentV16LinuxFilesystemImage.files.flatMap((file) => {
      const historical = hostedCLibcV15FilesByPath.get(file.path);
      if (historical !== undefined) return [historical];
      return hostedCLibcV16Files.some(({ path }) => path === file.path)
        ? []
        : [file];
    }),
  ),
});

const hostedCLibcV14FilesByPath = new Map(
  withInstallTimestamp(hostedCLibcV14Files).map((file) => [file.path, file]),
);

const currentV14LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV14ImageId,
  directories: currentV16GamesLinuxImageDirectories,
  files: Object.freeze(
    currentV15LinuxFilesystemImage.files.flatMap((file) => {
      const historical = hostedCLibcV14FilesByPath.get(file.path);
      if (historical !== undefined) return [historical];
      return hostedCLibcV15Files.some(({ path }) => path === file.path)
        ? []
        : [file];
    }),
  ),
});

const currentV13LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV13ImageId,
  directories: currentV16HostedLinuxImageDirectories,
  files: Object.freeze(
    currentV14LinuxFilesystemImage.files.filter(
      (file) => !guestNethackFiles.some(({ path }) => path === file.path),
    ),
  ),
});

const currentV12LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV12ImageId,
  directories: linuxV9ImageDirectories,
  files: Object.freeze([
    ...currentV13LinuxFilesystemImage.files.filter(
      (file) => !hostedCLibcFiles.some(({ path }) => path === file.path),
    ),
    ...withInstallTimestamp(
      cFamilyHeaders("linux").filter(
        (file) => file.path === "/usr/include/stdio.h",
      ),
    ),
  ]),
});

const currentV11LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV11ImageId,
  directories: linuxV9ImageDirectories,
  files: Object.freeze(
    currentV12LinuxFilesystemImage.files.filter(
      (file) =>
        ![...linuxV12CommandNames].some(
          (command) => file.path === commandExecutablePath("linux", command),
        ),
    ),
  ),
});

const currentV10LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV10ImageId,
  directories: linuxV9ImageDirectories,
  files: Object.freeze(
    currentV11LinuxFilesystemImage.files.filter(
      (file) =>
        ![...linuxV11CommandNames].some(
          (command) => file.path === commandExecutablePath("linux", command),
        ),
    ),
  ),
});

const currentV9LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV9ImageId,
  directories: linuxV9ImageDirectories,
  files: Object.freeze(
    currentV10LinuxFilesystemImage.files.filter(
      (file) => file.path !== "/usr/bin/make",
    ),
  ),
});

const currentV8LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV8ImageId,
  directories: linuxV8ImageDirectories,
  files: Object.freeze(
    withInstallTimestamp([
      ...commandFiles(
        "linux",
        preMakeLinuxCommandNames.filter(
          (command) =>
            command !== "telinit" &&
            command !== "runlevel" &&
            command !== "cs-init-ctl" &&
            command !== "md5sum" &&
            command !== "base64" &&
            command !== "nl" &&
            command !== "pgrep" &&
            command !== "pkill" &&
            command !== "killall",
        ),
        true,
      ),
      dataFile("/boot/vmlinuz-cs486", "CS-Linux 1.0 kernel image", 786_432),
      dataFile("/lib/libcs.so.1", "CS-Linux shared runtime", 393_216),
      plainFile(
        "/etc/motd",
        "Welcome to CS-Linux 1.0.\nType 'help' for commands or 'man cs-linux' for the field guide.\n",
      ),
      plainFile("/etc/issue", "CS-Linux 1.0 console tty1\n"),
      plainFile(
        "/etc/fstab",
        "proc /proc proc defaults 0 0\ntmpfs /tmp tmpfs defaults 0 0\n",
      ),
      dataFile("/sbin/cs-init", "CS-Linux init process placeholder", 12_288),
      dataFile("/sbin/cs-getty", "CS-Linux getty process placeholder", 12_288),
      plainFile(
        "/usr/share/man/README",
        "CS-Linux manual pages are served by the versioned man/apropos command index.\n",
      ),
      plainFile("/var/log/messages", "", 0o640),
      plainFile("/var/log/auth.log", "", 0o600),
      ...cFamilyHeaders("linux"),
    ]),
  ),
});

const currentV7LinuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxV7ImageId,
  directories: currentLinuxImageDirectories,
  files: Object.freeze([
    ...commandFiles("linux", preMakeLinuxCommandNames),
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
    ...commandFiles("linux", preMakeLinuxCommandNames),
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

const dosV8ImageDirectories = Object.freeze(
  currentDosImageDirectories.filter((path) => path !== "/drives/c/command"),
);

export const dosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: currentDosImageId,
  directories: dosV8ImageDirectories,
  files: Object.freeze(
    withInstallTimestamp([
      ...commandFiles("dos", commandExecutableNamesFor("dos"), true),
      imageFile("/drives/c/command.com", "command", 55_968),
      dataFile("/drives/c/io.sys", "CS-DOS I/O system", 40_774),
      dataFile("/drives/c/msdos.sys", "CS-DOS kernel", 38_138),
      dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
      dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
      ...cFamilyHeaders("dos"),
    ]),
  ),
});

const currentV8DosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: dosV8ImageId,
  directories: dosV8ImageDirectories,
  files: Object.freeze(
    withInstallTimestamp([
      ...commandFiles("dos", currentV7DosCommands, true),
      imageFile("/drives/c/command.com", "command", 55_968),
      dataFile("/drives/c/io.sys", "CS-DOS I/O system", 40_774),
      dataFile("/drives/c/msdos.sys", "CS-DOS kernel", 38_138),
      dataFile("/drives/c/dos/himem.sys", "CS-DOS XMS manager", 14_592),
      dataFile("/drives/c/dos/emm386.exe", "CS-DOS UMB manager", 22_528),
      ...cFamilyHeaders("dos"),
    ]),
  ),
});

const currentV7DosFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: dosV7ImageId,
  directories: currentDosImageDirectories,
  files: Object.freeze([
    ...commandFiles("dos", currentV7DosCommands),
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
  registerFilesystemBaseImage(currentV7LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV8LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV9LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV10LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV11LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV12LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV13LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV14LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV15LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV16LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV17LinuxFilesystemImage);
  registerFilesystemBaseImage(currentV18LinuxFilesystemImage);
  registerFilesystemBaseImage(linuxFilesystemImage);
  registerFilesystemBaseImage(legacyDosFilesystemImage);
  registerFilesystemBaseImage(previousDosFilesystemImage);
  registerFilesystemBaseImage(recentDosFilesystemImage);
  registerFilesystemBaseImage(formerDosFilesystemImage);
  registerFilesystemBaseImage(priorDosFilesystemImage);
  registerFilesystemBaseImage(preprocessorPriorDosFilesystemImage);
  registerFilesystemBaseImage(currentV7DosFilesystemImage);
  registerFilesystemBaseImage(currentV8DosFilesystemImage);
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
    if (isLinuxBuiltinCommand(command)) return "/bin/bash";
    if (linuxSbinCommands.has(command)) return `/sbin/${command}`;
    if (linuxUsrSbinCommands.has(command)) return `/usr/sbin/${command}`;
    return `/usr/bin/${command}`;
  }
  if (isDosInternalCommand(command)) return "/drives/c/command.com";
  return `/drives/c/dos/${dosExecutableName(command)}`;
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
  currentLayout = false,
): FilesystemBaseImageFile[] {
  return [...names]
    .sort()
    .filter(
      (command) =>
        !currentLayout ||
        (profile === "dos"
          ? !isDosInternalCommand(command)
          : !isLinuxBuiltinCommand(command)),
    )
    .map((command) =>
      imageFile(
        currentLayout
          ? commandExecutablePath(profile, command)
          : legacyCommandExecutablePath(profile, command),
        command,
        currentLayout
          ? currentCommandFileSize(profile, command)
          : toolchainCommands.has(command)
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

function legacyCommandExecutablePath(
  profile: ComputerOsProfile,
  command: string,
): string {
  if (profile === "linux") {
    if (command === "bash") return "/bin/bash";
    if (command === "sh") return "/bin/sh";
    return `/usr/bin/${command}`;
  }
  return `/drives/c/command/${legacyDosExecutableName(command)}`;
}

function currentCommandFileSize(
  profile: ComputerOsProfile,
  command: string,
): number {
  const explicit = (profile === "dos" ? dosCommandSizes : linuxCommandSizes)[
    command
  ];
  if (explicit !== undefined) return explicit;
  let hash = 0;
  for (const character of command)
    hash = (hash * 33 + character.charCodeAt(0)) >>> 0;
  return (profile === "dos" ? 6_144 : 10_240) + (hash % 17) * 512;
}

function withInstallTimestamp(
  files: readonly FilesystemBaseImageFile[],
): FilesystemBaseImageFile[] {
  return files.map((file) =>
    Object.freeze({
      ...file,
      metadata: Object.freeze({
        ...file.metadata,
        modifiedAtMilliseconds: installBaseImageTimestampMilliseconds,
      }),
    }),
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
  if (["attrib", "chkdsk", "label", "mem", "move"].includes(command)) {
    return `${command.toLowerCase()}.exe`;
  }
  return `${command.toLowerCase()}.com`;
}

function legacyDosExecutableName(command: string): string {
  if (command === "c++") return "cpp.com";
  if (command === "csdb") return "debug.exe";
  if (command === "qbasic") return "qbasic.exe";
  if (["csasm", "cscc", "cscpp", "pwb"].includes(command)) {
    return `${command}.exe`;
  }
  if (command === "systeminfo") return "sysinfo.com";
  return `${command.toLowerCase()}.com`;
}

export function legacyV7CommandFile(
  profile: ComputerOsProfile,
  command: string,
): FilesystemBaseImageFile {
  return commandFiles(profile, [command])[0]!;
}

export function legacyV7CommandNames(
  profile: ComputerOsProfile,
): readonly string[] {
  return profile === "dos" ? currentV7DosCommands : preMakeLinuxCommandNames;
}
