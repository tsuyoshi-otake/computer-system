import type { ShellCommandResult } from "./shellTypes.js";

export interface DosCommandHost {
  cat(arguments_: readonly string[], stdin: string): ShellCommandResult;
  changeDirectory(arguments_: readonly string[]): ShellCommandResult;
  copy(arguments_: readonly string[]): ShellCommandResult;
  currentDirectoryDisplay(): string;
  dosAttrib(arguments_: readonly string[]): ShellCommandResult;
  dosCheckDisk(arguments_: readonly string[]): ShellCommandResult;
  dosCpu(arguments_: readonly string[]): ShellCommandResult;
  dosCopy(arguments_: readonly string[]): ShellCommandResult;
  dosDate(arguments_: readonly string[]): ShellCommandResult;
  dosDelete(arguments_: readonly string[]): ShellCommandResult;
  dosDirectory(arguments_: readonly string[]): ShellCommandResult;
  dosEchoCommand(value: string): ShellCommandResult;
  dosHelp(arguments_: readonly string[]): ShellCommandResult;
  dosLabel(arguments_: readonly string[]): ShellCommandResult;
  dosMemory(arguments_: readonly string[]): ShellCommandResult;
  dosPath(value: string): ShellCommandResult;
  dosPrompt(value: string): ShellCommandResult;
  dosRemoveDirectory(arguments_: readonly string[]): ShellCommandResult;
  dosRename(arguments_: readonly string[]): ShellCommandResult;
  dosSet(value: string): ShellCommandResult;
  dosSystemInfo(arguments_: readonly string[]): ShellCommandResult;
  dosTime(arguments_: readonly string[]): ShellCommandResult;
  dosTree(arguments_: readonly string[]): ShellCommandResult;
  dosVolume(arguments_: readonly string[]): ShellCommandResult;
  dosFormat(arguments_: readonly string[]): ShellCommandResult;
  dosSystemDisk(arguments_: readonly string[]): ShellCommandResult;
  dosEject(arguments_: readonly string[]): ShellCommandResult;
  makeDirectories(arguments_: readonly string[]): ShellCommandResult;
  move(arguments_: readonly string[]): ShellCommandResult;
  remove(arguments_: readonly string[]): ShellCommandResult;
}

export class DosCommandAdapter {
  constructor(private readonly host: DosCommandHost) {}

  execute(
    command: string,
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult | undefined {
    switch (command.toLowerCase()) {
      case "attrib":
        return this.host.dosAttrib(arguments_);
      case "cd":
      case "chdir":
        if (arguments_.length === 0)
          return dosSuccess(`${this.host.currentDirectoryDisplay()}\r\n`);
        return dosResult(
          "The system cannot find the path specified.",
          this.host.changeDirectory(arguments_),
        );
      case "cls":
        return arguments_.length === 0
          ? dosSuccess("", { action: "clear" })
          : dosStatus(2, "Invalid number of parameters.\r\n");
      case "chkdsk":
        return this.host.dosCheckDisk(arguments_);
      case "copy":
        if (arguments_.some((value) => value.startsWith("/")))
          return dosStatus(2, "Invalid switch.\r\n");
        return this.host.dosCopy(arguments_);
      case "date":
        return this.host.dosDate(arguments_);
      case "del":
      case "erase":
        return this.host.dosDelete(arguments_);
      case "dir":
        return this.host.dosDirectory(arguments_);
      case "echo":
        return this.host.dosEchoCommand(arguments_.join(" "));
      case "exit":
        return arguments_.length === 0
          ? dosSuccess("", { action: "shutdown" })
          : dosStatus(2, "Invalid number of parameters.\r\n");
      case "format":
        return this.host.dosFormat(arguments_);
      case "sys":
        return this.host.dosSystemDisk(arguments_);
      case "eject":
        return this.host.dosEject(arguments_);
      case "help":
        return this.host.dosHelp(arguments_);
      case "label":
        return this.host.dosLabel(arguments_);
      case "md":
      case "mkdir":
        return dosResult(
          "Unable to create directory.",
          this.host.makeDirectories(arguments_),
        );
      case "mem":
        return this.host.dosMemory(arguments_);
      case "move":
        return dosResult(
          "The system cannot find the file specified.",
          this.host.move(arguments_),
          "        1 file(s) moved.\r\n",
        );
      case "path":
        return this.host.dosPath(arguments_.join(" "));
      case "prompt":
        return this.host.dosPrompt(arguments_.join(" "));
      case "rd":
      case "rmdir":
        return this.host.dosRemoveDirectory(arguments_);
      case "ren":
      case "rename":
        return this.host.dosRename(arguments_);
      case "rem":
        return dosSuccess();
      case "set":
        return this.host.dosSet(arguments_.join(" "));
      case "systeminfo":
        return this.host.dosSystemInfo(arguments_);
      case "time":
        return this.host.dosTime(arguments_);
      case "tree":
        return this.host.dosTree(arguments_);
      case "type":
        return dosResult("File not found.", this.host.cat(arguments_, stdin));
      case "ver":
        return arguments_.length === 0
          ? dosSuccess("Computer System DOS Version 6.20\r\n")
          : dosStatus(2, "Invalid number of parameters.\r\n");
      case "vol":
        return this.host.dosVolume(arguments_);
      case "cpu":
        return this.host.dosCpu(arguments_);
      default:
        return undefined;
    }
  }

  failureMessage(command: string): string {
    switch (command.toLowerCase()) {
      case "cd":
      case "chdir":
      case "rd":
      case "rmdir":
        return "The system cannot find the path specified.";
      case "copy":
      case "del":
      case "dir":
      case "erase":
      case "type":
        return "File not found.";
      case "md":
      case "mkdir":
        return "Unable to create directory.";
      case "move":
      case "ren":
      case "rename":
        return "The system cannot find the file specified.";
      default:
        return "Command failed.";
    }
  }
}

function dosResult(
  errorMessage: string,
  result: ShellCommandResult,
  successOutput = "",
): ShellCommandResult {
  if (result.exitCode === 0) {
    return {
      ...result,
      stdout: successOutput || normalizeDosNewlines(result.stdout),
    };
  }
  return dosStatus(result.exitCode, `${errorMessage}\r\n`);
}

function dosSuccess(
  stdout = "",
  extra: Partial<ShellCommandResult> = {},
): ShellCommandResult {
  return { exitCode: 0, stderr: "", stdout, ...extra };
}

function dosStatus(exitCode: number, stderr: string): ShellCommandResult {
  return { exitCode, stderr, stdout: "" };
}

function normalizeDosNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
}
