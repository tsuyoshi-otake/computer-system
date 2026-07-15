import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import {
  registerFilesystemBaseImage,
  type FilesystemBaseImage,
  type FilesystemBaseImageFile,
  type InMemoryFilesystem,
} from "../../domain/filesystem/inMemoryFilesystem.js";
import { commandNamesFor } from "./commandRegistry.js";

const executableHeader = "CSUTIL1\n";
const linuxImageId = "cs-linux-1.0-rootfs-v1";
const dosImageId = "cs-dos-6.2-rootfs-v1";

const toolchainCommands = new Set([
  "as",
  "basic",
  "basicc",
  "c++",
  "cc",
  "ld",
  "nm",
  "objdump",
  "run",
]);

export const linuxFilesystemImage: FilesystemBaseImage = Object.freeze({
  id: linuxImageId,
  directories: Object.freeze([
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
  ]),
  files: Object.freeze([
    ...commandFiles("linux"),
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

/** Registers immutable OS images before any persisted overlay is restored. */
export function registerOsFilesystemImages(): void {
  registerFilesystemBaseImage(linuxFilesystemImage);
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

function commandFiles(profile: ComputerOsProfile): FilesystemBaseImageFile[] {
  return commandNamesFor(profile).map((command) =>
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

function dosExecutableName(command: string): string {
  if (command === "c++") return "cpp.com";
  if (command === "systeminfo") return "sysinfo.com";
  return `${command.toLowerCase()}.com`;
}
