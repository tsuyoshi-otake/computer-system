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
  "basename",
  "bg",
  "bash",
  "cat",
  "cd",
  "clear",
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
  "head",
  "help",
  "hostname",
  "id",
  "ls",
  "jobs",
  "kill",
  "last",
  "man",
  "apropos",
  "mkdir",
  "mv",
  "printf",
  "ps",
  "python",
  "micropython",
  "pwd",
  "quota",
  "reboot",
  "rm",
  "sh",
  "shutdown",
  "sort",
  "service",
  "sleep",
  "seq",
  "stat",
  "source",
  "tail",
  "top",
  "touch",
  "tr",
  "true",
  "tty",
  "uname",
  "type",
  "uptime",
  "uniq",
  "unset",
  "wc",
  "w",
  "wait",
  "which",
  "who",
  "whoami",
  "vi",
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
  ...sharedToolchainCommands,
] as const;

const dosCommands: readonly CommandRegistration[] = [
  "attrib",
  "cd",
  "chkdsk",
  "chdir",
  "cls",
  "copy",
  "date",
  "del",
  "dir",
  "doskey",
  "echo",
  "edit",
  "erase",
  "eject",
  "exit",
  "format",
  "help",
  "label",
  "md",
  "mem",
  "mkdir",
  "move",
  "path",
  "prompt",
  "pwb",
  "qbasic",
  "rd",
  "ren",
  "rename",
  "rem",
  "rmdir",
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
  linux: new CommandRegistry(false, linuxCommands),
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
