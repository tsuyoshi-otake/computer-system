import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import { formatOsIdentity, getOsIdentity } from "./osIdentity.js";
import type { OsIdentity } from "./osIdentity.js";

export interface OsBootContext {
  readonly computerName: string;
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
  readonly aliases: ReadonlyMap<string, string>;
  readonly environment: ReadonlyMap<string, string>;
  readonly home: string;
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
    if (expanded.startsWith("/drives/")) return canonicalize(expanded, true);
    if (/^nul$/iu.test(expanded)) return "/drives/c/nul";
    if (/^con$/iu.test(expanded)) return "/drives/c/con";
    const drive = /^([A-Za-z]):(?:\/(.*))?$/u.exec(expanded);
    const rooted =
      drive === null
        ? expanded.startsWith("/")
          ? `/drives/c${expanded}`
          : `${currentDirectory}/${expanded}`
        : `/drives/${drive[1]!.toLowerCase()}/${drive[2] ?? ""}`;
    return canonicalize(rooted, true);
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

const linuxProfile: OsProfile = {
  id: "linux",
  identity: getOsIdentity("linux"),
  version: 1,
  username: "computer",
  home: "/home/computer",
  pathDialect: linuxPathDialect,
  aliases: new Map(),
  environment: new Map([
    ["HOME", "/home/computer"],
    ["PATH", "/usr/bin:/bin"],
    ["SHELL", "/bin/bash"],
    ["TERM", "computer-system"],
    ["USER", "computer"],
    ["LOGNAME", "computer"],
    ["OS", "CS-Linux"],
  ]),
  virtualDevices: new Map([["/dev/null", discardDevice("/dev/null")]]),
  boot: (filesystem, context) => {
    ensureDirectories(filesystem, [
      "/bin",
      "/dev",
      "/etc",
      "/home/computer",
      "/lib/python",
      "/proc",
      "/tmp",
      "/usr/bin",
      "/usr/lib/computer-system/python",
      "/var/log",
    ]);
    resetDirectory(filesystem, "/tmp");
    ensureMigratedDefaultFile(filesystem, "/etc/os-release", linuxOsRelease, [
      legacyLinuxOsRelease,
    ]);
    ensureFile(filesystem, "/etc/hostname", `${context.computerName}\n`);
    ensureFile(
      filesystem,
      "/etc/passwd",
      "computer:x:0:0:Computer System administrator:/home/computer:/bin/bash\n",
    );
    ensureFile(filesystem, "/etc/group", "computer:x:0:computer\n");
    ensureFile(
      filesystem,
      "/etc/profile",
      "export PATH=/usr/bin:/bin\nexport HOME=/home/computer\n",
    );
    ensureFile(
      filesystem,
      "/etc/bash.bashrc",
      "# System-wide Computer System Bash configuration\nexport HISTSIZE=100\n",
    );
    ensureFile(
      filesystem,
      "/home/computer/.bashrc",
      "# Personal Computer System Bash configuration\nexport EDITOR=vi\n",
    );
  },
};

const dosProfile: OsProfile = {
  id: "dos",
  identity: getOsIdentity("dos"),
  version: 1,
  username: "COMPUTER",
  home: "/drives/c/users/computer",
  pathDialect: dosPathDialect,
  aliases: new Map([
    ["chdir", "cd"],
    ["cls", "clear"],
    ["copy", "cp"],
    ["del", "rm"],
    ["dir", "ls"],
    ["erase", "rm"],
    ["md", "mkdir"],
    ["move", "mv"],
    ["rd", "rm"],
    ["ren", "mv"],
    ["rename", "mv"],
    ["rmdir", "rm"],
    ["type", "cat"],
    ["ver", "uname"],
  ]),
  environment: new Map([
    ["HOME", "/drives/c/users/computer"],
    ["PATH", "C:\\DOS;C:\\COMMAND"],
    ["PROMPT", "$P$G"],
    ["SHELL", "C:\\COMMAND.COM"],
    ["TERM", "computer-system"],
    ["USER", "COMPUTER"],
    ["LOGNAME", "COMPUTER"],
    ["OS", "CS-DOS"],
  ]),
  virtualDevices: new Map([
    ["/drives/c/con", discardDevice("/drives/c/con")],
    ["/drives/c/nul", discardDevice("/drives/c/nul")],
  ]),
  boot: (filesystem) => {
    ensureDirectories(filesystem, [
      "/drives/c/command",
      "/drives/c/dos",
      "/drives/c/temp",
      "/drives/c/users/computer",
    ]);
    resetDirectory(filesystem, "/drives/c/temp");
    ensureFile(
      filesystem,
      "/drives/c/autoexec.bat",
      "@ECHO OFF\r\nPATH C:\\DOS;C:\\COMMAND\r\n",
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
