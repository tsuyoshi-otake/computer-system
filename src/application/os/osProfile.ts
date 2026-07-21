import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  commandExecutablePath,
  installOsFilesystemImage,
  legacyV7CommandFile,
  legacyV7CommandNames,
} from "./osFilesystemImages.js";
import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import { formatOsIdentity, getOsIdentity } from "./osIdentity.js";
import type { OsIdentity } from "./osIdentity.js";
import {
  initialGroupId,
  initialUserId,
  initialUserName,
} from "./linuxCredentials.js";
import { linuxAccountLimits, linuxAccountPaths } from "./linuxAccounts.js";
import {
  commandRegistryFor,
  isDosInternalCommand,
  isLinuxBuiltinCommand,
} from "./commandRegistry.js";
import type { DosRuntimeState } from "./dosRuntimeState.js";

export interface OsBootContext {
  readonly computerName: string;
  readonly dosRuntime?: DosRuntimeState;
}

export interface PathDialect {
  readonly id: "dos" | "linux";
  display(canonicalPath: string): string;
  resolve(path: string, currentDirectory: string, home: string): string;
}

export interface VirtualDevice {
  readonly path: string;
  read(): string;
  write(contents: string): void;
}

export interface OsProfile {
  readonly environment: ReadonlyMap<string, string>;
  readonly home: string;
  readonly initialDirectory: string;
  readonly id: ComputerOsProfile;
  readonly identity: OsIdentity;
  readonly pathDialect: PathDialect;
  readonly username: string;
  readonly version: number;
  readonly virtualDevices: ReadonlyMap<string, VirtualDevice>;
  boot(filesystem: InMemoryFilesystem, context: OsBootContext): void;
}

const linuxPathDialect: PathDialect = {
  id: "linux",
  display: (path) => path,
  resolve: (path, currentDirectory, home) => {
    const expanded =
      path === "~"
        ? home
        : path.startsWith("~/")
          ? `${home}${path.slice(1)}`
          : path;
    return canonicalize(
      expanded.startsWith("/")
        ? expanded
        : `${currentDirectory === "/" ? "" : currentDirectory}/${expanded}`,
      false,
    );
  },
};

const dosPathDialect: PathDialect = {
  id: "dos",
  display: (path) => {
    const match = /^\/drives\/([a-z])(?:\/(.*))?$/u.exec(path);
    if (match === null) return path.replaceAll("/", "\\").toUpperCase();
    const tail = match[2]?.replaceAll("/", "\\").toUpperCase() ?? "";
    return `${match[1]!.toUpperCase()}:\\${tail}`;
  },
  resolve: (path, currentDirectory, home) => {
    const expanded = path === "~" ? home : path.replaceAll("\\", "/");
    if (expanded.startsWith("/drives/")) return canonicalizeDosPath(expanded);
    if (/^nul$/iu.test(expanded)) return "/drives/c/nul";
    if (/^con$/iu.test(expanded)) return "/drives/c/con";
    if (/^(?:com|spi|i2c)[1-6]$/iu.test(expanded)) {
      return `/drives/c/${expanded.toLowerCase()}`;
    }
    const drive = /^([A-Za-z]):(?:\/(.*))?$/u.exec(expanded);
    const rooted =
      drive === null
        ? expanded.startsWith("/")
          ? `/drives/c${expanded}`
          : `${currentDirectory}/${expanded}`
        : `/drives/${drive[1]!.toLowerCase()}/${drive[2] ?? ""}`;
    return canonicalizeDosPath(rooted);
  },
};

const discardDevice = (path: string): VirtualDevice => ({
  path,
  read: () => "",
  write: () => undefined,
});

const legacyLinuxOsRelease =
  'NAME="Computer System OS"\nID=computer-system\nVERSION="0.3"\n';
const linuxOsRelease = [
  'NAME="Computer System Linux"',
  `PRETTY_NAME="${formatOsIdentity(getOsIdentity("linux"))}"`,
  "ID=cs-linux",
  "ID_LIKE=linux",
  'VERSION="1.0"',
  'VERSION_ID="1.0"',
  'VARIANT="CS-Linux"',
  "VARIANT_ID=cs-linux",
  "",
].join("\n");

export const linuxUserDefaultPath =
  "/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games";
export const linuxRootDefaultPath =
  "/usr/local/sbin:/usr/sbin:/sbin:/usr/local/bin:/usr/bin:/bin";
const linuxEtcProfile =
  'if [ "$USER" = "root" ]; then\n' +
  `  export PATH=${linuxRootDefaultPath}\n` +
  "else\n" +
  `  export PATH=${linuxUserDefaultPath}\n` +
  "fi\n";

const linuxProfile: OsProfile = {
  id: "linux",
  identity: getOsIdentity("linux"),
  version: 1,
  username: initialUserName,
  home: "/home/cs",
  initialDirectory: "/home/cs",
  pathDialect: linuxPathDialect,
  environment: new Map([
    ["HOME", "/home/cs"],
    ["PATH", linuxUserDefaultPath],
    ["SHELL", "/bin/bash"],
    ["TERM", "computer-system"],
    ["USER", initialUserName],
    ["LOGNAME", initialUserName],
    ["OS", "CS-Linux"],
  ]),
  virtualDevices: new Map([["/dev/null", discardDevice("/dev/null")]]),
  boot: (filesystem, context) => {
    const previousBaseImageId = filesystem.baseImageId;
    const accountDatabasePresentBeforeBoot = Object.values(
      linuxAccountPaths,
    ).some((path) => filesystem.exists(path));
    const legacyAccountPresentBeforeBoot =
      hasRecognizedLegacyLinuxAccount(filesystem);
    const initializeInitialHome =
      !accountDatabasePresentBeforeBoot || legacyAccountPresentBeforeBoot;
    const preserveExistingHomeMetadata =
      filesystem.exists("/home/computer") || filesystem.exists("/home/cs");
    const legacyHomePresentBeforeBoot = filesystem.exists("/home/computer");
    if (
      initializeInitialHome &&
      legacyHomePresentBeforeBoot &&
      filesystem.isSymbolicLink("/home/computer")
    ) {
      throw new Error(
        "CS-Linux account migration: legacy home is a symbolic link",
      );
    }
    if (
      initializeInitialHome &&
      legacyHomePresentBeforeBoot &&
      !filesystem.isDirectory("/home/computer")
    ) {
      throw new Error(
        "CS-Linux account migration: legacy home is not a directory",
      );
    }
    installOsFilesystemImage(filesystem, "linux");
    if (
      previousBaseImageId !== undefined &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v8" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v9" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v10" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v11" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v12" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v13" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v14" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v15" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v16" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v17" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v18" &&
      previousBaseImageId !== "cs-linux-1.0-rootfs-v19"
    ) {
      migrateLinuxCommandLayout(filesystem);
    }
    if (initializeInitialHome) migrateLegacyLinuxHome(filesystem);
    else if (!legacyHomePresentBeforeBoot)
      suppressImplicitLegacyBaseHome(filesystem);
    const requiredDirectories = [
      "/bin",
      "/dev",
      "/etc",
      "/etc/init.d",
      "/etc/rc0.d",
      "/etc/rc1.d",
      "/etc/rc2.d",
      "/etc/rc3.d",
      "/etc/rc4.d",
      "/etc/rc5.d",
      "/etc/rc6.d",
      "/lib/python",
      "/proc",
      "/run",
      "/root",
      "/sbin",
      "/tmp",
      "/mnt",
      "/usr/bin",
      "/usr/include",
      "/usr/lib/computer-system/python",
      "/usr/sbin",
      "/usr/share/man",
      "/var/lib/cs-os",
      "/var/log",
    ];
    if (initializeInitialHome) requiredDirectories.push("/home/cs");
    ensureDirectories(filesystem, requiredDirectories);
    resetDirectory(filesystem, "/tmp");
    resetDirectory(filesystem, "/run");
    ensureMigratedDefaultFile(filesystem, "/etc/os-release", linuxOsRelease, [
      legacyLinuxOsRelease,
    ]);
    ensureFile(filesystem, "/etc/hostname", `${context.computerName}\n`);
    ensureMigratedDefaultFile(filesystem, "/etc/profile", linuxEtcProfile, [
      `export PATH=${linuxUserDefaultPath}\n`,
      "export PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games\nexport HOME=/home/cs\n",
      "export PATH=/usr/local/bin:/usr/bin:/bin:/usr/local/games:/usr/games\nexport HOME=/home/computer\n",
    ]);
    ensureFile(
      filesystem,
      "/etc/bash.bashrc",
      "# System-wide Computer System Bash configuration\nexport HISTSIZE=100\n",
    );
    if (initializeInitialHome) {
      ensureFile(
        filesystem,
        "/home/cs/.bashrc",
        "# Personal Computer System Bash configuration\nexport EDITOR=vi\n",
      );
    }
    for (const path of [
      "/",
      "/bin",
      "/boot",
      "/dev",
      "/etc",
      "/lib",
      "/lib/python",
      "/proc",
      "/run",
      "/root",
      "/sbin",
      "/usr",
      "/usr/bin",
      "/usr/include",
      "/usr/lib",
      "/usr/lib/computer-system",
      "/usr/lib/computer-system/python",
      "/usr/share",
      "/usr/share/man",
      "/usr/sbin",
      "/var",
      "/var/lib",
      "/var/lib/cs-os",
      "/var/log",
    ]) {
      filesystem.setMetadata(path, { gid: 0, mode: 0o755, uid: 0 });
    }
    filesystem.setMetadata("/root", { gid: 0, mode: 0o700, uid: 0 });
    filesystem.setMetadata("/tmp", { gid: 0, mode: 0o1777, uid: 0 });
    filesystem.setMetadata("/home", { gid: 0, mode: 0o755, uid: 0 });
    if (initializeInitialHome && !preserveExistingHomeMetadata) {
      filesystem.setMetadata("/home/cs", {
        gid: initialGroupId,
        mode: 0o755,
        uid: initialUserId,
      });
    }
    for (const path of [
      "/etc/bash.bashrc",
      "/etc/hostname",
      "/etc/os-release",
      "/etc/profile",
    ]) {
      filesystem.setMetadata(path, { gid: 0, mode: 0o644, uid: 0 });
    }
    ensureLinuxRcSymlinks(filesystem);
  },
};

/**
 * Materializes the SysV rc.d symlink farm on every boot. The shared base
 * image cannot ship symlinks (`FilesystemBaseImageFile` has no symlink
 * field), so this idempotent, existence-guarded pass provisions fresh and
 * upgraded Computers alike from `/etc/init.d`. Runlevels 2-5 are deliberately
 * identical (no fabricated per-runlevel behavior); 0/1/6 stop everything.
 */
function ensureLinuxRcSymlinks(filesystem: InMemoryFilesystem): void {
  const services: ReadonlyArray<{
    readonly name: string;
    readonly killOrder: number;
    readonly startOrder: number;
  }> = [
    { killOrder: 90, name: "syslog", startOrder: 10 },
    { killOrder: 80, name: "cron", startOrder: 20 },
  ];
  for (const runlevel of ["0", "1", "6"]) {
    for (const service of services) {
      ensureLinuxRcSymlink(
        filesystem,
        `/etc/rc${runlevel}.d/K${String(service.killOrder)}${service.name}`,
        `../init.d/${service.name}`,
      );
    }
  }
  for (const runlevel of ["2", "3", "4", "5"]) {
    for (const service of services) {
      ensureLinuxRcSymlink(
        filesystem,
        `/etc/rc${runlevel}.d/S${String(service.startOrder)}${service.name}`,
        `../init.d/${service.name}`,
      );
    }
  }
}

function ensureLinuxRcSymlink(
  filesystem: InMemoryFilesystem,
  path: string,
  target: string,
): void {
  if (filesystem.exists(path)) return;
  filesystem.createSymbolicLink(target, path);
}

const dosProfile: OsProfile = {
  id: "dos",
  identity: getOsIdentity("dos"),
  version: 1,
  username: "COMPUTER",
  home: "/drives/c",
  initialDirectory: "/drives/c",
  pathDialect: dosPathDialect,
  environment: new Map([
    ["COMSPEC", "C:\\COMMAND.COM"],
    ["INCLUDE", "C:\\INCLUDE"],
    ["PATH", "C:\\DOS"],
    ["PROMPT", "$P$G"],
    ["TEMP", "C:\\TEMP"],
  ]),
  virtualDevices: new Map([
    ["/drives/c/con", discardDevice("/drives/c/con")],
    ["/drives/c/nul", discardDevice("/drives/c/nul")],
  ]),
  boot: (filesystem, context) => {
    const previousBaseImageId = filesystem.baseImageId;
    installOsFilesystemImage(filesystem, "dos");
    if (
      previousBaseImageId !== undefined &&
      previousBaseImageId !== "cs-dos-1.0-rootfs-v8"
    ) {
      migrateDosCommandDirectory(filesystem, context.dosRuntime);
    }
    ensureDirectories(filesystem, [
      "/drives/c/dos",
      "/drives/c/include",
      "/drives/c/temp",
    ]);
    resetDirectory(filesystem, "/drives/c/temp");
    ensureFile(
      filesystem,
      "/drives/c/autoexec.bat",
      "@ECHO OFF\r\nPATH C:\\DOS\r\nSET TEMP=C:\\TEMP\r\nSET INCLUDE=C:\\INCLUDE\r\n",
    );
    ensureFile(
      filesystem,
      "/drives/c/config.sys",
      [
        "DEVICE=C:\\DOS\\HIMEM.SYS",
        "DEVICE=C:\\DOS\\EMM386.EXE NOEMS",
        "DOS=HIGH,UMB",
        "FILES=32",
        "BUFFERS=16",
        "",
      ].join("\r\n"),
    );
    if (
      !filesystem.exists("/drives/c/command.com") ||
      filesystem.isDirectory("/drives/c/command.com") ||
      filesystem.isSymbolicLink("/drives/c/command.com")
    ) {
      throw new Error("Bad or missing Command Interpreter");
    }
  },
};

export function getOsProfile(id: ComputerOsProfile): OsProfile {
  return id === "dos" ? dosProfile : linuxProfile;
}

function ensureDirectories(
  filesystem: InMemoryFilesystem,
  paths: readonly string[],
): void {
  for (const path of paths) filesystem.makeDirectory(path);
}

function ensureFile(
  filesystem: InMemoryFilesystem,
  path: string,
  contents: string,
): void {
  if (!filesystem.exists(path)) filesystem.writeFile(path, contents);
}

function ensureMigratedDefaultFile(
  filesystem: InMemoryFilesystem,
  path: string,
  contents: string,
  legacyDefaults: readonly string[],
): void {
  if (!filesystem.exists(path)) {
    filesystem.writeFile(path, contents);
    return;
  }
  if (filesystem.isDirectory(path)) return;
  if (legacyDefaults.includes(filesystem.readFile(path))) {
    filesystem.writeFile(path, contents);
  }
}

function migrateLegacyLinuxHome(filesystem: InMemoryFilesystem): void {
  const legacyHome = "/home/computer";
  const currentHome = "/home/cs";
  if (!filesystem.exists(legacyHome)) return;
  if (filesystem.isSymbolicLink(legacyHome)) {
    throw new Error(
      "CS-Linux account migration: legacy home is a symbolic link",
    );
  }
  if (!filesystem.isDirectory(legacyHome)) {
    throw new Error(
      "CS-Linux account migration: legacy home is not a directory",
    );
  }
  if (!filesystem.exists(currentHome)) {
    filesystem.move(legacyHome, currentHome);
    return;
  }
  if (filesystem.isSymbolicLink(currentHome)) {
    throw new Error(
      "CS-Linux account migration: current home is a symbolic link",
    );
  }
  if (!filesystem.isDirectory(currentHome)) {
    throw new Error(
      "CS-Linux account migration: current home is not a directory",
    );
  }
  throw new Error(
    "CS-Linux account migration: both legacy and current homes exist",
  );
}

function migrateLinuxCommandLayout(filesystem: InMemoryFilesystem): void {
  filesystem.transaction(() => {
    for (const command of legacyV7CommandNames("linux")) {
      const legacy = legacyV7CommandFile("linux", command);
      if (isLinuxBuiltinCommand(command)) {
        if (
          filesystem.exists(legacy.path) &&
          !filesystem.isDirectory(legacy.path) &&
          !filesystem.isSymbolicLink(legacy.path) &&
          filesystem.readFile(legacy.path) === legacy.contents
        ) {
          filesystem.delete(legacy.path);
        }
        continue;
      }
      const destination = commandExecutablePath("linux", command);
      if (destination === legacy.path) continue;
      if (!filesystem.exists(legacy.path)) {
        if (filesystem.exists(destination)) filesystem.delete(destination);
        continue;
      }
      if (
        filesystem.isDirectory(legacy.path) ||
        filesystem.isSymbolicLink(legacy.path)
      ) {
        throw new Error(
          `CS-Linux command migration: ${legacy.path} is not a regular file`,
        );
      }
      if (filesystem.readFile(legacy.path) === legacy.contents) {
        filesystem.delete(legacy.path);
        continue;
      }
      if (filesystem.exists(destination)) filesystem.delete(destination);
      filesystem.move(legacy.path, destination);
    }
  });
}

function migrateDosCommandDirectory(
  filesystem: InMemoryFilesystem,
  runtime: DosRuntimeState | undefined,
): void {
  const legacyDirectory = "/drives/c/command";
  if (!filesystem.exists(legacyDirectory)) return;
  if (
    !filesystem.isDirectory(legacyDirectory) ||
    filesystem.isSymbolicLink(legacyDirectory)
  ) {
    throw new Error("CS-DOS command migration: C:\\COMMAND is not a directory");
  }
  const operation = (): void => {
    const registry = commandRegistryFor("dos");
    for (const name of legacyV7CommandNames("dos")) {
      const legacy = legacyV7CommandFile("dos", name);
      const canonical = registry.canonical(name);
      const destination = isDosInternalCommand(canonical)
        ? `/drives/c/dos/${legacy.path.split("/").at(-1)!}`
        : commandExecutablePath("dos", canonical);
      if (!filesystem.exists(legacy.path)) {
        if (
          !isDosInternalCommand(canonical) &&
          filesystem.exists(destination)
        ) {
          deleteDosPath(filesystem, runtime, destination);
        }
        continue;
      }
      if (
        filesystem.isDirectory(legacy.path) ||
        filesystem.isSymbolicLink(legacy.path)
      ) {
        throw new Error(
          `CS-DOS command migration: ${legacy.path} is not a regular file`,
        );
      }
      if (filesystem.readFile(legacy.path) === legacy.contents) {
        deleteDosPath(filesystem, runtime, legacy.path);
        continue;
      }
      if (filesystem.exists(destination)) {
        deleteDosPath(filesystem, runtime, destination);
      }
      moveDosPath(filesystem, runtime, legacy.path, destination);
    }
    for (const entry of [...filesystem.list(legacyDirectory)]) {
      const source = `${legacyDirectory}/${entry}`;
      const destination = `/drives/c/dos/${entry}`;
      if (filesystem.exists(destination)) {
        throw new Error(
          `CS-DOS command migration: destination C:\\DOS\\${entry.toUpperCase()} already exists`,
        );
      }
      moveDosPath(filesystem, runtime, source, destination);
    }
    deleteDosPath(filesystem, runtime, legacyDirectory);
  };
  if (runtime === undefined) filesystem.transaction(operation);
  else runtime.transaction(() => filesystem.transaction(operation));
}

function moveDosPath(
  filesystem: InMemoryFilesystem,
  runtime: DosRuntimeState | undefined,
  source: string,
  destination: string,
): void {
  const generation = runtime?.driveState("C").mediaGeneration;
  const hasFatMetadata =
    generation !== undefined &&
    runtime?.fatMetadata(source, generation) !== undefined;
  filesystem.move(source, destination);
  if (hasFatMetadata) {
    runtime.moveFatMetadata(source, destination, generation, generation);
  }
}

function deleteDosPath(
  filesystem: InMemoryFilesystem,
  runtime: DosRuntimeState | undefined,
  path: string,
): void {
  const generation = runtime?.driveState("C").mediaGeneration;
  const hasFatMetadata =
    generation !== undefined &&
    runtime?.fatMetadata(path, generation) !== undefined;
  filesystem.delete(path);
  if (hasFatMetadata) runtime.deleteFatMetadata(path, generation);
}

function hasRecognizedLegacyLinuxAccount(
  filesystem: InMemoryFilesystem,
): boolean {
  const path = linuxAccountPaths.passwd;
  if (
    !filesystem.exists(path) ||
    filesystem.isDirectory(path) ||
    filesystem.isSymbolicLink(path) ||
    filesystem.getSize(path) > linuxAccountLimits.maximumFileBytes.passwd
  ) {
    return false;
  }
  return filesystem
    .readFile(path)
    .split("\n")
    .some((line) => {
      const fields = line.split(":");
      return (
        fields.length === 7 &&
        fields[0] === "computer" &&
        fields[2] === String(initialUserId) &&
        fields[3] === String(initialGroupId) &&
        fields[5] === "/home/computer" &&
        fields[6] === "/bin/bash"
      );
    });
}

function suppressImplicitLegacyBaseHome(filesystem: InMemoryFilesystem): void {
  const path = "/home/computer";
  if (!filesystem.exists(path)) return;
  if (
    filesystem.isSymbolicLink(path) ||
    !filesystem.isDirectory(path) ||
    filesystem.list(path).length > 0
  ) {
    throw new Error(
      "CS-Linux account lifecycle: an unexpected legacy home appeared while mounting the OS image",
    );
  }
  filesystem.delete(path);
}

function resetDirectory(filesystem: InMemoryFilesystem, path: string): void {
  if (filesystem.exists(path)) filesystem.delete(path);
  filesystem.makeDirectory(path);
}

function canonicalize(path: string, caseInsensitive: boolean): string {
  const segments: string[] = [];
  for (const source of path.replaceAll("\\", "/").split("/")) {
    if (source.length === 0 || source === ".") continue;
    if (source === "..") {
      if (segments.length === 0) throw new Error("Path escapes root");
      segments.pop();
      continue;
    }
    segments.push(caseInsensitive ? source.toLowerCase() : source);
  }
  return `/${segments.join("/")}`;
}

const dosShortNamePattern =
  /^[A-Za-z0-9!#$%&'()@^_`{}~-]{1,8}(?:\.[A-Za-z0-9!#$%&'()@^_`{}~-]{1,3})?$/u;

function canonicalizeDosPath(path: string): string {
  const canonical = canonicalize(path, true);
  const drive = /^\/drives\/[a-z](?:\/(.*))?$/u.exec(canonical);
  if (drive === null) throw new DosPathError();
  const tail = drive[1];
  if (
    tail !== undefined &&
    tail.length > 0 &&
    tail.split("/").some((segment) => !dosShortNamePattern.test(segment))
  ) {
    throw new DosPathError();
  }
  return canonical;
}

export class DosPathError extends Error {
  constructor() {
    super("Invalid filename or extension.");
    this.name = "DosPathError";
  }
}
