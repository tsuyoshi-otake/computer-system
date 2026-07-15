import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import type { ShellCommandResult } from "./shellTypes.js";

export interface ShellTextPolicy {
  readonly newline: "\n" | "\r\n";
  commandNotFound(command: string): ShellCommandResult;
  displayName(name: string): string;
  environmentName(name: string): string;
  option(argument: string): string;
}

class LinuxShellTextPolicy implements ShellTextPolicy {
  readonly newline = "\n" as const;

  commandNotFound(command: string): ShellCommandResult {
    return {
      exitCode: 127,
      stderr: `bash: ${command}: command not found\n`,
      stdout: "",
    };
  }

  displayName(name: string): string {
    return name;
  }

  environmentName(name: string): string {
    return name;
  }

  option(argument: string): string {
    return argument;
  }
}

class DosShellTextPolicy implements ShellTextPolicy {
  readonly newline = "\r\n" as const;

  commandNotFound(): ShellCommandResult {
    return {
      exitCode: 127,
      stderr: "Bad command or file name\r\n",
      stdout: "",
    };
  }

  displayName(name: string): string {
    return name.toUpperCase();
  }

  environmentName(name: string): string {
    return name.toUpperCase();
  }

  option(argument: string): string {
    return argument.startsWith("-") ? argument.toLowerCase() : argument;
  }
}

const policies: Readonly<Record<ComputerOsProfile, ShellTextPolicy>> = {
  dos: new DosShellTextPolicy(),
  linux: new LinuxShellTextPolicy(),
};

export function shellTextPolicyFor(
  profile: ComputerOsProfile,
): ShellTextPolicy {
  return policies[profile];
}
