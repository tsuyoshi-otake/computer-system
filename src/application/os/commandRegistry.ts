import type { ComputerOsProfile } from "../../domain/computer/computer.js";

type CommandRegistration = string | readonly [name: string, command: string];

export class CommandRegistry {
  private readonly commands: ReadonlyMap<string, string>;
  private readonly publicNames: readonly string[];

  constructor(
    private readonly caseInsensitive: boolean,
    registrations: readonly CommandRegistration[],
  ) {
    const commands = new Map<string, string>();
    for (const registration of registrations) {
      const [name, command] =
        typeof registration === "string"
          ? [registration, registration]
          : registration;
      const key = this.normalize(name);
      if (commands.has(key))
        throw new Error(`duplicate shell command: ${name}`);
      commands.set(key, command);
    }
    this.commands = commands;
    this.publicNames = [...commands.keys()].sort();
  }

  canonical(name: string): string {
    return this.commands.get(this.normalize(name)) ?? this.normalize(name);
  }

  has(name: string): boolean {
    return this.commands.has(this.normalize(name));
  }

  names(prefix = ""): readonly string[] {
    const normalizedPrefix = this.normalize(prefix);
    return this.publicNames.filter((name) => name.startsWith(normalizedPrefix));
  }

  allNames(): readonly string[] {
    return this.publicNames;
  }

  executableNames(): readonly string[] {
    return [...new Set(this.commands.values())].sort();
  }

  private normalize(name: string): string {
    return this.caseInsensitive ? name.toLowerCase() : name;
  }
}

const sharedToolchainCommands = [
  "as",
  "cc",
  "c++",
  "ld",
  "nm",
  "objdump",
  "run",
] as const;

const linuxCommands = [
  "ar",
  "basename",
  "bg",
  "bash",
  "cat",
  "cd",
  "clear",
  "crontab",
  "cp",
  "dirname",
  "du",
  "date",
  "echo",
  "env",
  "exit",
  "export",
  "false",
  "find",
  "fg",
  "grep",
  "git",
  "gzip",
  "gunzip",
  "head",
  "help",
  "hostname",
  "id",
  "ls",
  "jobs",
  "kill",
  "last",
  "man",
  "make",
  "apropos",
  "mkdir",
  "mv",
  "nice",
  "nohup",
  "printf",
  "ps",
  "python",
  "micropython",
  "pwd",
  "quota",
  "ranlib",
  "reboot",
  "rm",
  "sh",
  "shutdown",
  "sed",
  "sort",
  "service",
  "sleep",
  "seq",
  "stat",
  "source",
  "tail",
  "tar",
  "top",
  "touch",
  "tr",
  "true",
  "tty",
  "uname",
  "type",
  "uptime",
  "vmstat",
  "uniq",
  "unzip",
  "unset",
  "wc",
  "watch",
  "w",
  "wait",
  "which",
  "who",
  "whoami",
  "awk",
  "zip",
  "vi",
  "more",
  "less",
  "cut",
  "cpuinfo",
  "csdb",
  "df",
  "free",
  "test",
  "[",
  "time",
  "history",
  "i2c",
  "spi",
  "chmod",
  "chown",
  "chgrp",
  "cmp",
  "diff",
  "dmesg",
  "file",
  "groups",
  "groupadd",
  "groupdel",
  "getent",
  "hexdump",
  "ln",
  "mktemp",
  "mount",
  "umount",
  "eject",
  "mkfs.fat",
  "od",
  "printenv",
  "readlink",
  "realpath",
  "rmdir",
  "sha256sum",
  "md5sum",
  "base64",
  "nl",
  "pgrep",
  "pkill",
  "killall",
  "login",
  "logout",
  "passwd",
  "su",
  "sudo",
  "sync",
  "tee",
  "xargs",
  "yes",
  "alias",
  "command",
  "getopts",
  "local",
  "read",
  "shift",
  "unalias",
  "umask",
  "useradd",
  "userdel",
  "usermod",
  "telinit",
  "runlevel",
  "cs-init-ctl",
  ...sharedToolchainCommands,
] as const;

export const linuxBuiltinCommands: ReadonlySet<string> = new Set([
  "alias",
  "bg",
  "cd",
  "command",
  "exit",
  "export",
  "fg",
  "getopts",
  "history",
  "jobs",
  "local",
  "logout",
  "read",
  "shift",
  "source",
  "type",
  "umask",
  "unalias",
  "unset",
  "wait",
]);

export const dosInternalCommands: ReadonlySet<string> = new Set([
  "cd",
  "chdir",
  "cls",
  "copy",
  "date",
  "del",
  "dir",
  "echo",
  "erase",
  "exit",
  "md",
  "mkdir",
  "path",
  "prompt",
  "rd",
  "rem",
  "ren",
  "rename",
  "rmdir",
  "set",
  "time",
  "type",
  "ver",
  "vol",
]);

const dosCommands: readonly CommandRegistration[] = [
  "attrib",
  "cd",
  "chkdsk",
  ["chdir", "cd"],
  "cls",
  "copy",
  "date",
  "del",
  "dir",
  "doskey",
  "echo",
  "edit",
  ["erase", "del"],
  "eject",
  "exit",
  "format",
  "help",
  "label",
  "md",
  "mem",
  ["mkdir", "md"],
  "move",
  "path",
  "prompt",
  "pwb",
  "qbasic",
  "rd",
  "ren",
  ["rename", "ren"],
  "rem",
  ["rmdir", "rd"],
  "set",
  "time",
  "timer",
  "tree",
  "type",
  "ver",
  "vi",
  "vol",
  "cpu",
  "csasm",
  "cscc",
  "cscpp",
  "systeminfo",
  "sys",
  "i2c",
  "spi",
  ["asm", "as"],
  ["debug", "csdb"],
  ["link", "ld"],
  ...sharedToolchainCommands,
];

const registries: Readonly<Record<ComputerOsProfile, CommandRegistry>> = {
  dos: new CommandRegistry(true, dosCommands),
  linux: new CommandRegistry(false, [
    ...linuxCommands,
    ["init", "telinit"] as const,
  ]),
};

export function commandRegistryFor(
  profile: ComputerOsProfile,
): CommandRegistry {
  return registries[profile];
}

export function commandNamesFor(profile: ComputerOsProfile): readonly string[] {
  return registries[profile].allNames();
}

export function commandExecutableNamesFor(
  profile: ComputerOsProfile,
): readonly string[] {
  return registries[profile].executableNames();
}

export function isDosInternalCommand(name: string): boolean {
  return dosInternalCommands.has(name.toLowerCase());
}

export function isLinuxBuiltinCommand(name: string): boolean {
  return linuxBuiltinCommands.has(name);
}
