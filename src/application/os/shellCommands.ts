import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import type { OsProfile } from "./osProfile.js";
import type { EditorScreen } from "../editor/editorScreen.js";
import type { ShellClockSource } from "./clock.js";
import type { ComputerHardwareProfile } from "../../domain/computer/hardware.js";
import type { VirtualDevice } from "./osProfile.js";
import { formatOsIdentity } from "./osIdentity.js";
import {
  runCs486,
  validateCs486Executable,
  type Cs486Executable,
} from "../../domain/cpu/cs486.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import { cpuCyclesToMicroseconds } from "../../domain/cpu/timing.js";
import {
  assembleCs486,
  assembleCs486Object,
} from "../toolchain/cs486Assembler.js";
import {
  validateCs486Object,
  type Cs486Object,
} from "../../domain/cpu/cs486Object.js";
import {
  compileCs486Object,
  compileCs486Source,
  type Cs486SourceLanguage,
} from "../toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../toolchain/cs486Linker.js";
import { sha256Hex } from "./passwordHash.js";

export type ShellAction = "clear" | "reboot" | "shutdown";

export interface ShellCommandResult {
  readonly action?: ShellAction;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly sleepTicks?: number;
  readonly terminalScreen?: EditorScreen;
  readonly resetTerminal?: boolean;
  readonly cpuCycles?: number;
}

export interface ShellCompletionResult {
  readonly candidates: readonly string[];
  readonly cursor: number;
  readonly value: string;
}

export interface ShellCommandRuntimeOptions {
  readonly clock: ShellClockSource;
  readonly computerId: number;
  readonly computerName: string;
  readonly currentTick: () => number;
  readonly profile: OsProfile;
  readonly ticksPerSecond: number;
  readonly hardware: ComputerHardwareProfile;
  readonly memoryUsageBytes: () => number;
}

interface MemoryRegion {
  readonly free: number;
  readonly total: number;
  readonly used: number;
}

interface DosMemoryLayout {
  readonly commandBytes: number;
  readonly conventional: MemoryRegion;
  readonly dosHigh: boolean;
  readonly emm386: boolean;
  readonly extended: MemoryRegion;
  readonly reserved: MemoryRegion;
  readonly runtimeBytes: number;
  readonly systemBytes: number;
  readonly total: MemoryRegion;
  readonly umb: boolean;
  readonly upper: MemoryRegion;
  readonly xms: boolean;
}

export const shellCommandNames = [
  "basename",
  "bash",
  "cat",
  "cd",
  "clear",
  "cp",
  "dirname",
  "du",
  "date",
  "echo",
  "edit",
  "env",
  "exit",
  "export",
  "false",
  "find",
  "grep",
  "head",
  "help",
  "hostname",
  "id",
  "ls",
  "mkdir",
  "mv",
  "printf",
  "pwd",
  "quota",
  "reboot",
  "rm",
  "sh",
  "shutdown",
  "sort",
  "sleep",
  "seq",
  "stat",
  "source",
  "tail",
  "touch",
  "tr",
  "true",
  "uname",
  "type",
  "uptime",
  "uniq",
  "unset",
  "wc",
  "which",
  "whoami",
  "vi",
  "cut",
  "cpu",
  "cpuinfo",
  "df",
  "free",
  "mem",
  "systeminfo",
  "test",
  "[",
  "time",
  "timer",
  "history",
  "as",
  "cc",
  "c++",
  "basic",
  "basicc",
  "run",
  "objdump",
  "ld",
  "nm",
  "path",
  "prompt",
  "rem",
  "set",
  "doskey",
  "tree",
  "vol",
  "chmod",
  "chown",
  "chgrp",
  "cmp",
  "diff",
  "dmesg",
  "file",
  "groups",
  "hexdump",
  "ln",
  "mktemp",
  "mount",
  "od",
  "printenv",
  "readlink",
  "realpath",
  "rmdir",
  "sha256sum",
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
] as const;

const knownCommands = new Set<string>(shellCommandNames);
const maximumOutputLength = 256_000;

export class ShellCommandRuntime {
  private readonly bootTick: number;
  private currentDirectory: string;
  private previousDirectory: string;
  private readonly environment: Map<string, string>;
  private dosEcho = true;
  private temporarySequence = 0;
  private xargsDepth = 0;

  constructor(
    private readonly filesystem: InMemoryFilesystem,
    private readonly options: ShellCommandRuntimeOptions,
  ) {
    this.bootTick = options.currentTick();
    this.currentDirectory = options.profile.home;
    this.previousDirectory = options.profile.home;
    this.environment = new Map(options.profile.environment);
  }

  get cwd(): string {
    return this.currentDirectory;
  }

  complete(line: string, cursor: number): ShellCompletionResult {
    if (
      line.length > 128 ||
      !Number.isSafeInteger(cursor) ||
      cursor < 0 ||
      cursor > line.length
    ) {
      return { candidates: [], cursor, value: line };
    }
    const beforeCursor = line.slice(0, cursor);
    const tokenStart = findCompletionTokenStart(beforeCursor);
    const token = beforeCursor.slice(tokenStart);
    if (/['"]/u.test(token)) return { candidates: [], cursor, value: line };
    const commandPosition = isCommandCompletionPosition(
      beforeCursor.slice(0, tokenStart),
    );
    const candidates = commandPosition
      ? this.commandCompletions(token)
      : this.pathCompletions(token);
    if (candidates.length === 0) return { candidates, cursor, value: line };

    const common = longestCommonPrefix(candidates);
    const replacement =
      candidates.length === 1 && !candidates[0]!.endsWith("/")
        ? `${candidates[0]} `
        : common;
    const value = `${line.slice(0, tokenStart)}${replacement}${line.slice(cursor)}`;
    return {
      candidates,
      cursor: tokenStart + replacement.length,
      value,
    };
  }

  get profile(): OsProfile {
    return this.options.profile;
  }

  prompt(): string {
    if (this.options.profile.id === "dos") {
      return this.renderDosPrompt(this.environment.get("PROMPT") ?? "$P$G");
    }
    const display =
      this.currentDirectory === this.options.profile.home
        ? "~"
        : this.options.profile.pathDialect.display(this.currentDirectory);
    return `${display}$ `;
  }

  resolveVariable(name: string, lastExitCode: number): string | undefined {
    if (name === "?") return String(lastExitCode);
    if (name === "PWD") return this.currentDirectory;
    if (name === "OLDPWD") return this.previousDirectory;
    return this.environment.get(this.environmentName(name));
  }

  setVariable(name: string, value: string): void {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
      throw new Error(`${name}: invalid variable name`);
    }
    this.environment.set(this.environmentName(name), value);
  }

  isBuiltInCommand(name: string): boolean {
    return knownCommands.has(this.canonicalCommand(name));
  }

  get dosEchoEnabled(): boolean {
    return this.dosEcho;
  }

  expandDosVariables(
    value: string,
    scriptName: string,
    arguments_: readonly string[],
    lastExitCode: number,
  ): string {
    if (this.options.profile.id !== "dos") return value;
    return value.replace(
      /%([A-Za-z_][A-Za-z0-9_]*)%|%([0-9])/gu,
      (_match, variable: string | undefined, position: string | undefined) => {
        if (position !== undefined) {
          const index = Number(position);
          return index === 0 ? scriptName : (arguments_[index - 1] ?? "");
        }
        if (variable?.toUpperCase() === "ERRORLEVEL")
          return String(lastExitCode);
        return this.environment.get(this.environmentName(variable ?? "")) ?? "";
      },
    );
  }

  executeDosControlLine(line: string): ShellCommandResult | undefined {
    if (this.options.profile.id !== "dos") return undefined;
    const normalized = line.trim().replace(/^@/u, "").trimStart();
    const match = /^([A-Za-z]+)(?:\s+(.*))?$/su.exec(normalized);
    if (match === null) return undefined;
    const command = match[1]!.toLowerCase();
    const remainder = match[2] ?? "";
    switch (command) {
      case "rem":
        return success();
      case "set":
        return this.dosSet(remainder);
      case "path":
        return this.dosPath(remainder);
      case "prompt":
        return this.dosPrompt(remainder);
      case "echo":
        return remainder.length === 0 || /^(?:off|on)$/iu.test(remainder)
          ? this.dosEchoCommand(remainder)
          : undefined;
      default:
        return undefined;
    }
  }

  resolveDosProgram(
    name: string,
  ):
    | { readonly kind: "batch" | "executable"; readonly path: string }
    | undefined {
    if (this.options.profile.id !== "dos" || name.length === 0)
      return undefined;
    const hasDirectory = name.includes("/") || name.includes("\\");
    const directories = hasDirectory
      ? [""]
      : [
          this.currentDirectory,
          ...(this.environment.get("PATH") ?? "")
            .split(";")
            .filter((entry) => entry.length > 0)
            .slice(0, 16)
            .map((entry) => this.resolvePath(entry)),
        ];
    const hasExtension = /\.[^/\\]+$/u.test(name);
    const names = hasExtension ? [name] : [name, `${name}.bat`];
    for (const directory of directories) {
      for (const candidateName of names) {
        const candidate = hasDirectory
          ? this.resolvePath(candidateName)
          : this.filesystem.normalize(
              joinPath(directory, candidateName.toLowerCase()),
            );
        if (
          this.filesystem.exists(candidate) &&
          !this.filesystem.isDirectory(candidate)
        ) {
          return {
            kind: candidate.toLowerCase().endsWith(".bat")
              ? "batch"
              : "executable",
            path: candidate,
          };
        }
      }
    }
    return undefined;
  }

  execute(words: readonly string[], stdin: string): ShellCommandResult {
    const assignments = words.findIndex((word) => !isAssignment(word));
    if (assignments !== 0) {
      const count = assignments < 0 ? words.length : assignments;
      for (const assignment of words.slice(0, count)) {
        const separator = assignment.indexOf("=");
        this.environment.set(
          this.environmentName(assignment.slice(0, separator)),
          assignment.slice(separator + 1),
        );
      }
      if (assignments < 0) return success();
      words = words.slice(assignments);
    }

    const [requestedCommand = "", ...arguments_] = words;
    const command = this.canonicalCommand(requestedCommand);
    try {
      if (this.options.profile.id === "dos") {
        const dosResult = this.dispatchDosCommand(
          requestedCommand.toLowerCase(),
          arguments_,
          stdin,
        );
        if (dosResult !== undefined) return dosResult;
      }
      if (knownCommands.has(command) && !this.commandAvailable(command)) {
        return this.commandNotFound(requestedCommand);
      }
      const result = this.dispatch(command, arguments_, stdin);
      if (
        result.stdout.length > maximumOutputLength ||
        result.stderr.length > maximumOutputLength
      ) {
        return failure(command, "output limit exceeded");
      }
      return result;
    } catch (error: unknown) {
      return failure(command, message(error));
    }
  }

  resolvePath(path: string): string {
    return this.filesystem.normalize(
      this.options.profile.pathDialect.resolve(
        path,
        this.currentDirectory,
        this.environment.get("HOME") ?? this.options.profile.home,
      ),
    );
  }

  private dispatchDosCommand(
    command: string,
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult | undefined {
    switch (command) {
      case "cd":
      case "chdir":
        if (arguments_.length === 0) {
          return success(
            `${this.options.profile.pathDialect.display(this.currentDirectory)}\r\n`,
          );
        }
        return this.dosResult(
          "The system cannot find the path specified.",
          this.changeDirectory(arguments_),
        );
      case "copy":
        if (arguments_.some((value) => value.startsWith("/"))) {
          return status(2, "", "Invalid switch.\r\n");
        }
        return this.dosResult(
          "File not found.",
          this.copy(arguments_),
          "        1 file(s) copied.\r\n",
        );
      case "del":
      case "erase":
        return this.dosResult("File not found.", this.remove(arguments_));
      case "dir":
        return this.dosDirectory(arguments_);
      case "date":
        return this.dosDate(arguments_);
      case "md":
      case "mkdir":
        return this.dosResult(
          "Unable to create directory.",
          this.makeDirectories(arguments_),
        );
      case "move":
        return this.dosResult(
          "The system cannot find the file specified.",
          this.move(arguments_),
          "        1 file(s) moved.\r\n",
        );
      case "rd":
      case "rmdir":
        return this.dosRemoveDirectory(arguments_);
      case "ren":
      case "rename":
        return this.dosResult(
          "The system cannot find the file specified.",
          this.move(arguments_),
        );
      case "type":
        return this.dosResult("File not found.", this.cat(arguments_, stdin));
      case "ver":
        return arguments_.length === 0
          ? success("Computer System DOS Version 6.20\r\n")
          : status(2, "", "Invalid number of parameters.\r\n");
      default:
        return undefined;
    }
  }

  private dosResult(
    errorMessage: string,
    result: ShellCommandResult,
    successOutput = "",
  ): ShellCommandResult {
    if (result.exitCode === 0) {
      return {
        ...result,
        stdout:
          successOutput ||
          result.stdout.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"),
      };
    }
    return status(result.exitCode, "", `${errorMessage}\r\n`);
  }

  private dosRemoveDirectory(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length !== 1) {
      return status(2, "", "Required parameter missing.\r\n");
    }
    const path = this.resolvePath(arguments_[0]!);
    if (!this.filesystem.isDirectory(path)) {
      return status(1, "", "The system cannot find the path specified.\r\n");
    }
    if (this.filesystem.list(path).length > 0) {
      return status(
        1,
        "",
        "Invalid path, not directory, or directory not empty.\r\n",
      );
    }
    this.filesystem.delete(path);
    return success();
  }

  private dosDirectory(arguments_: readonly string[]): ShellCommandResult {
    let bare = false;
    let path = ".";
    for (const argument of arguments_) {
      if (argument.toUpperCase() === "/B") bare = true;
      else if (argument.startsWith("/")) {
        return status(2, "", `Invalid switch - ${argument}\r\n`);
      } else if (path === ".") path = argument;
      else return status(2, "", "Too many parameters.\r\n");
    }
    const resolved = this.resolvePath(path);
    if (!this.filesystem.exists(resolved)) {
      return status(1, "", "File not found.\r\n");
    }
    const names = this.filesystem.isDirectory(resolved)
      ? this.filesystem.list(resolved)
      : [baseName(resolved)];
    if (bare) {
      return success(
        `${names.map((name) => name.toUpperCase()).join("\r\n")}${names.length > 0 ? "\r\n" : ""}`,
      );
    }
    const directory = this.filesystem.isDirectory(resolved)
      ? resolved
      : parentPath(resolved);
    const rows: string[] = [];
    let fileCount = 0;
    let fileBytes = 0;
    let directoryCount = 0;
    const timestamp = this.dosDirectoryTimestamp();
    for (const name of names) {
      const target = this.filesystem.isDirectory(resolved)
        ? joinPath(resolved, name)
        : resolved;
      if (this.filesystem.isDirectory(target)) {
        directoryCount += 1;
        rows.push(`${timestamp}    <DIR>          ${name.toUpperCase()}`);
      } else {
        const size = this.filesystem.getSize(target);
        fileCount += 1;
        fileBytes += size;
        rows.push(
          `${timestamp}       ${String(size).padStart(10)} ${name.toUpperCase()}`,
        );
      }
    }
    const volume = this.dosVolumeLines();
    return success(
      [
        ...volume,
        ` Directory of ${this.options.profile.pathDialect.display(directory)}`,
        "",
        ...rows,
        `${String(fileCount).padStart(9)} File(s) ${String(fileBytes).padStart(14)} bytes`,
        `${String(directoryCount).padStart(9)} Dir(s)  ${String(this.filesystem.getFreeSpace()).padStart(14)} bytes free`,
        "",
      ].join("\r\n"),
    );
  }

  private dosDirectoryTimestamp(): string {
    const date = new Date(this.options.clock.currentWallTimeMilliseconds());
    const hour = date.getUTCHours();
    const hour12 = hour % 12 || 12;
    return `${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}-${String(date.getUTCFullYear()).slice(-2)}  ${String(hour12).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}${hour < 12 ? "a" : "p"}`;
  }

  isKnownCommand(name: string): boolean {
    const command = this.canonicalCommand(name);
    return knownCommands.has(command) && this.commandAvailable(command);
  }

  private dispatch(
    command: string,
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (command.includes("/") || command.startsWith(".")) {
      return this.runExecutable([command, ...arguments_]);
    }
    switch (command) {
      case "help":
        return this.options.profile.id === "dos"
          ? this.dosHelp(arguments_)
          : success(
              [
                "Computer System BusyBox shell",
                "files: pwd cd ls cat mkdir rmdir touch rm cp mv ln readlink realpath find du quota",
                "text: echo printf head tail wc grep sort uniq tr",
                "text+: tee cmp diff sha256sum od hexdump xargs",
                "shell: sh bash source env printenv export unset alias unalias command read local shift getopts",
                "system: clear vi shutdown reboot exit true false",
                "info: whoami id hostname uname date uptime stat df du quota",
                "hardware: cpuinfo free mount dmesg /proc/cpuinfo /proc/meminfo",
                "utility: history time sleep seq cut test [",
                "toolchain: as cc c++ basic basicc ld nm run objdump",
                "syntax: |  >  >>  <  &&  ||  ;  '...'  \"...\"  $VAR  $?",
              ].join("\n") + "\n",
            );
      case "pwd":
        return arguments_.length === 0
          ? success(
              `${this.options.profile.pathDialect.display(this.currentDirectory)}\n`,
            )
          : usage("pwd");
      case "cd":
        return this.changeDirectory(arguments_);
      case "ls":
        return this.list(arguments_);
      case "cat":
        return this.cat(arguments_, stdin);
      case "echo":
        return this.options.profile.id === "dos"
          ? this.dosEchoCommand(arguments_.join(" "))
          : this.echo(arguments_);
      case "printf":
        return this.printf(arguments_);
      case "mkdir":
        return this.makeDirectories(arguments_);
      case "touch":
        return this.touch(arguments_);
      case "rm":
        return this.remove(arguments_);
      case "cp":
        return this.copy(arguments_);
      case "mv":
        return this.move(arguments_);
      case "head":
        return this.headOrTail("head", arguments_, stdin);
      case "tail":
        return this.headOrTail("tail", arguments_, stdin);
      case "wc":
        return this.wordCount(arguments_, stdin);
      case "grep":
        return this.grep(arguments_, stdin);
      case "sort":
        return this.sort(arguments_, stdin);
      case "uniq":
        return this.uniq(arguments_, stdin);
      case "tr":
        return this.translate(arguments_, stdin);
      case "find":
        return this.find(arguments_);
      case "basename":
        return arguments_.length === 1
          ? success(`${baseName(this.resolvePath(arguments_[0]!))}\n`)
          : usage("basename <path>");
      case "dirname":
        return arguments_.length === 1
          ? success(`${parentPath(this.resolvePath(arguments_[0]!))}\n`)
          : usage("dirname <path>");
      case "whoami":
        return arguments_.length === 0
          ? success(`${this.options.profile.username}\n`)
          : usage("whoami");
      case "id":
        if (this.options.profile.id === "linux")
          return this.linuxId(arguments_);
        return arguments_.length === 0
          ? success("uid=0(COMPUTER) gid=0(COMPUTER) groups=0(COMPUTER)\r\n")
          : usage("id");
      case "hostname":
        return arguments_.length === 0
          ? success(`${this.options.computerName}\n`)
          : usage("hostname");
      case "uname":
        return this.uname(arguments_);
      case "date":
        return this.date(arguments_);
      case "time":
        return this.options.profile.id === "dos"
          ? this.dosTime(arguments_)
          : this.commandNotFound(command);
      case "cpuinfo":
        return this.options.profile.id === "linux"
          ? this.cpuInfo(arguments_)
          : this.commandNotFound(command);
      case "free":
        return this.options.profile.id === "linux"
          ? this.freeMemory(arguments_)
          : this.commandNotFound(command);
      case "cpu":
        return this.options.profile.id === "dos"
          ? this.dosCpu(arguments_)
          : this.commandNotFound(command);
      case "mem":
        return this.options.profile.id === "dos"
          ? this.dosMemory(arguments_)
          : this.commandNotFound(command);
      case "systeminfo":
        return this.options.profile.id === "dos"
          ? this.dosSystemInfo(arguments_)
          : this.commandNotFound(command);
      case "tree":
        return this.options.profile.id === "dos"
          ? this.dosTree(arguments_)
          : this.commandNotFound(command);
      case "vol":
        return this.options.profile.id === "dos"
          ? this.dosVolume(arguments_)
          : this.commandNotFound(command);
      case "chmod":
        return this.linuxChangeMode(arguments_);
      case "chown":
        return this.linuxChangeOwner(arguments_, true);
      case "chgrp":
        return this.linuxChangeOwner(arguments_, false);
      case "cmp":
        return this.linuxCompare(arguments_);
      case "diff":
        return this.linuxDiff(arguments_);
      case "dmesg":
        return this.linuxDmesg(arguments_);
      case "file":
        return this.linuxFile(arguments_);
      case "groups":
        return this.linuxGroups(arguments_);
      case "hexdump":
      case "od":
        return this.linuxHexDump(command, arguments_, stdin);
      case "ln":
        return this.linuxLink(arguments_);
      case "mktemp":
        return this.linuxMakeTemporary(arguments_);
      case "mount":
        return this.linuxMount(arguments_);
      case "printenv":
        return this.linuxPrintEnvironment(arguments_);
      case "readlink":
        return this.linuxReadLink(arguments_);
      case "realpath":
        return this.linuxRealPath(arguments_);
      case "rmdir":
        return this.linuxRemoveDirectory(arguments_);
      case "sha256sum":
        return this.linuxSha256Sum(arguments_, stdin);
      case "sync":
        return arguments_.length === 0 ? success() : usage("sync");
      case "tee":
        return this.linuxTee(arguments_, stdin);
      case "xargs":
        return this.linuxXargs(arguments_, stdin);
      case "yes":
        return this.linuxYes(arguments_);
      case "as":
        return this.compileExecutable("asm", arguments_);
      case "cc":
        return this.compileExecutable("c", arguments_);
      case "c++":
        return this.compileExecutable("cpp", arguments_);
      case "basicc":
        return this.compileExecutable("basic", arguments_);
      case "basic":
        return this.runBasic(arguments_);
      case "run":
        return this.runExecutable(arguments_);
      case "objdump":
        return this.objectDump(arguments_);
      case "ld":
        return this.linkObjects(arguments_);
      case "nm":
        return this.listSymbols(arguments_);
      case "path":
        return this.options.profile.id === "dos"
          ? this.dosPath(arguments_.join(" "))
          : this.commandNotFound(command);
      case "prompt":
        return this.options.profile.id === "dos"
          ? this.dosPrompt(arguments_.join(" "))
          : this.commandNotFound(command);
      case "rem":
        return this.options.profile.id === "dos"
          ? success()
          : this.commandNotFound(command);
      case "set":
        return this.options.profile.id === "dos"
          ? this.dosSet(arguments_.join(" "))
          : this.commandNotFound(command);
      case "uptime":
        return this.options.profile.id === "linux"
          ? this.linuxUptime(arguments_)
          : arguments_.length === 0
            ? success(`${this.uptimeSeconds().toFixed(2)} seconds\r\n`)
            : usage("uptime");
      case "sleep":
        return this.sleep(arguments_);
      case "seq":
        return this.sequence(arguments_);
      case "cut":
        return this.cut(arguments_, stdin);
      case "stat":
        return this.stat(arguments_);
      case "df":
        return this.diskFree(arguments_);
      case "du":
        return this.diskUsage(arguments_);
      case "quota":
        return this.quota(arguments_);
      case "test":
      case "[":
        return this.test(command, arguments_);
      case "env":
      case "export":
        return this.environmentCommand(command, arguments_);
      case "unset":
        return this.unset(arguments_);
      case "which":
      case "type":
        return this.locate(command, arguments_);
      case "clear":
        return arguments_.length === 0
          ? success("", { action: "clear" })
          : usage("clear");
      case "true":
        return arguments_.length === 0 ? success() : usage("true");
      case "false":
        return arguments_.length === 0 ? status(1) : usage("false");
      case "shutdown":
        return arguments_.length === 0
          ? success("Shutting down\n", { action: "shutdown" })
          : usage("shutdown");
      case "reboot":
        return arguments_.length === 0
          ? success("Rebooting\n", { action: "reboot" })
          : usage("reboot");
      case "exit":
        return success("logout\n", { action: "shutdown" });
      case "edit":
      case "vi":
      case "sh":
      case "bash":
      case "source":
      case "alias":
      case "command":
      case "getopts":
      case "local":
      case "read":
      case "shift":
      case "unalias":
        return failure(command, "internal dispatch is unavailable", 125);
      default:
        return this.commandNotFound(command);
    }
  }

  private changeDirectory(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) return usage("cd [directory]");
    const requested = arguments_[0] ?? this.environment.get("HOME") ?? "/";
    const destination =
      requested === "-" ? this.previousDirectory : this.resolvePath(requested);
    if (!this.filesystem.isDirectory(destination)) {
      return failure("cd", `${requested}: not a directory`);
    }
    this.previousDirectory = this.currentDirectory;
    this.currentDirectory = destination;
    return success(requested === "-" ? `${destination}\n` : "");
  }

  private list(arguments_: readonly string[]): ShellCommandResult {
    let long = false;
    let all = false;
    let human = false;
    let directoryEntry = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "--") {
        continue;
      }
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "l") long = true;
          else if (flag === "a" || flag === "1") all ||= flag === "a";
          else if (flag === "h") human = true;
          else if (flag === "d") directoryEntry = true;
          else return failure("ls", `invalid option -- '${flag}'`, 2);
        }
      } else paths.push(argument);
    }
    if (paths.length === 0) paths.push(".");
    const sections: string[] = [];
    for (const [index, path] of paths.entries()) {
      const resolved = this.resolvePath(path);
      const resolvedDevice = this.virtualDevice(resolved);
      if (!this.filesystem.exists(resolved) && resolvedDevice === undefined) {
        return failure("ls", `${path}: no such file or directory`);
      }
      const listDirectory =
        this.filesystem.isDirectory(resolved) && !directoryEntry;
      if (
        this.options.profile.id === "linux" &&
        listDirectory &&
        !this.linuxHasAccess(resolved, 0b101)
      )
        return failure(
          "ls",
          `cannot open directory '${path}': Permission denied`,
          2,
        );
      const names = listDirectory
        ? this.filesystem
            .list(resolved)
            .filter((name) => all || !name.startsWith("."))
        : [baseName(resolved)];
      if (listDirectory) {
        for (const devicePath of this.virtualDevicePaths()) {
          if (parentPath(devicePath) !== resolved) continue;
          const name = baseName(devicePath);
          if ((all || !name.startsWith(".")) && !names.includes(name)) {
            names.push(name);
          }
        }
        names.sort();
        if (all && this.options.profile.id === "linux")
          names.unshift(".", "..");
      }
      const prefix = paths.length > 1 ? `${path}:\n` : "";
      const listing = long
        ? names
            .map((name) => {
              const target = listDirectory
                ? name === "."
                  ? resolved
                  : name === ".."
                    ? parentPath(resolved)
                    : joinPath(resolved, name)
                : resolved;
              const device = this.virtualDevice(target) !== undefined;
              const symbolic = this.filesystem.isSymbolicLink(target);
              const directory =
                !symbolic && this.filesystem.isDirectory(target);
              const size = device
                ? 0
                : symbolic
                  ? utf8ByteLength(this.filesystem.readLink(target))
                  : this.filesystem.getSize(target);
              if (this.options.profile.id === "dos") {
                const kind = device ? "dev " : directory ? "dir " : "file";
                return `${kind} ${String(size).padStart(7)} ${this.displayName(name)}`;
              }
              const metadata = device
                ? {
                    gid: 0,
                    mode: 0o666,
                    modifiedAtMilliseconds: 0,
                    uid: 0,
                  }
                : this.filesystem.getMetadata(target, !symbolic);
              const renderedName = symbolic
                ? `${name} -> ${this.filesystem.readLink(target)}`
                : name;
              return `${linuxModeString(device ? "device" : symbolic ? "link" : directory ? "directory" : "file", metadata.mode)} ${String(device || symbolic ? 1 : this.filesystem.getLinkCount(target)).padStart(2)} ${linuxIdentityName(metadata.uid).padEnd(8)} ${linuxIdentityName(metadata.gid).padEnd(8)} ${formatLinuxSize(size, human).padStart(8)} ${formatLinuxTimestamp(metadata.modifiedAtMilliseconds)} ${renderedName}`;
            })
            .join("\n")
        : names.map((name) => this.displayName(name)).join("  ");
      const total =
        long && listDirectory && this.options.profile.id === "linux"
          ? `total ${String(
              names.reduce((sum, name) => {
                if (name === "." || name === "..") return sum;
                const target = joinPath(resolved, name);
                return (
                  sum +
                  (this.virtualDevice(target) === undefined
                    ? this.filesystem.getSize(target)
                    : 0)
                );
              }, 0),
            )}\n`
          : "";
      sections.push(`${index > 0 ? "\n" : ""}${prefix}${total}${listing}`);
    }
    return success(sections.join("") + "\n");
  }

  private cat(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let numbered = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-n") numbered = true;
      else if (argument.startsWith("-") && argument !== "-") {
        return failure("cat", `invalid option '${argument}'`, 2);
      } else paths.push(argument);
    }
    const sources = paths.length === 0 ? ["-"] : paths;
    let output = "";
    for (const path of sources) {
      output += path === "-" ? stdin : this.readFile(path);
    }
    if (numbered) {
      output = splitLines(output)
        .map((line, index) => `${String(index + 1).padStart(6)}\t${line}`)
        .join("\n");
      if (output.length > 0) output += "\n";
    }
    return success(output);
  }

  private echo(arguments_: readonly string[]): ShellCommandResult {
    const newline = arguments_[0] !== "-n";
    const values = newline ? arguments_ : arguments_.slice(1);
    return success(values.join(" ") + (newline ? "\n" : ""));
  }

  private printf(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0)
      return usage("printf <format> [arguments ...]");
    const [format = "", ...values] = arguments_;
    let valueIndex = 0;
    const output = decodeEscapes(format).replace(
      /%([%sd])/gu,
      (_match, specifier: string): string => {
        if (specifier === "%") return "%";
        const value = values[valueIndex++] ?? "";
        if (specifier === "d") {
          const number = Number.parseInt(value, 10);
          return Number.isNaN(number) ? "0" : String(number);
        }
        return value;
      },
    );
    return success(output);
  }

  private makeDirectories(arguments_: readonly string[]): ShellCommandResult {
    const recursive = arguments_.includes("-p");
    const paths = arguments_.filter((argument) => argument !== "-p");
    if (paths.length === 0) return usage("mkdir [-p] <directory ...>");
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (
        this.options.profile.id === "linux" &&
        !this.linuxHasAccess(this.closestExistingDirectory(resolved), 0b011)
      )
        return failure(
          "mkdir",
          `cannot create directory '${path}': Permission denied`,
        );
      if (!recursive && !this.filesystem.isDirectory(parentPath(resolved))) {
        return failure("mkdir", `${path}: parent directory does not exist`);
      }
      if (!recursive && this.filesystem.exists(resolved)) {
        return failure("mkdir", `${path}: already exists`);
      }
      this.filesystem.makeDirectory(resolved);
    }
    return success();
  }

  private touch(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0) return usage("touch <file ...>");
    for (const path of arguments_) {
      const resolved = this.resolvePath(path);
      if (this.filesystem.isDirectory(resolved)) {
        return failure("touch", `${path}: is a directory`);
      }
      if (!this.filesystem.exists(resolved)) this.writeFile(path, "");
      else if (
        this.options.profile.id === "linux" &&
        !this.linuxHasAccess(resolved, 0b010)
      )
        return failure("touch", `cannot touch '${path}': Permission denied`);
      this.filesystem.setModifiedTime(
        resolved,
        this.options.clock.currentWallTimeMilliseconds(),
      );
    }
    return success();
  }

  private remove(arguments_: readonly string[]): ShellCommandResult {
    let recursive = false;
    let force = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "r" || flag === "R") recursive = true;
          else if (flag === "f") force = true;
          else return failure("rm", `invalid option -- '${flag}'`, 2);
        }
      } else paths.push(argument);
    }
    if (paths.length === 0) return usage("rm [-rf] <path ...>");
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved)) {
        if (force) continue;
        return failure("rm", `${path}: no such file or directory`);
      }
      if (this.filesystem.isDirectory(resolved) && !recursive) {
        return failure("rm", `${path}: is a directory`);
      }
      if (
        this.options.profile.id === "linux" &&
        !this.linuxHasAccess(parentPath(resolved), 0b011)
      )
        return failure("rm", `cannot remove '${path}': Permission denied`);
      this.filesystem.delete(resolved);
    }
    return success();
  }

  private copy(arguments_: readonly string[]): ShellCommandResult {
    const recursive = arguments_.includes("-r") || arguments_.includes("-R");
    const paths = arguments_.filter(
      (argument) => argument !== "-r" && argument !== "-R",
    );
    if (paths.length !== 2) return usage("cp [-r] <source> <destination>");
    const source = this.resolvePath(paths[0]!);
    if (this.filesystem.isDirectory(source) && !recursive) {
      return failure("cp", `${paths[0]}: omitting directory`);
    }
    if (
      this.options.profile.id === "linux" &&
      !this.linuxHasAccess(source, 0b100)
    )
      return failure("cp", `cannot open '${paths[0]}': Permission denied`);
    const destination = this.transferDestination(source, paths[1]!);
    if (
      this.options.profile.id === "linux" &&
      !this.linuxHasAccess(parentPath(destination), 0b011)
    )
      return failure("cp", `cannot create '${paths[1]}': Permission denied`);
    this.filesystem.copy(source, destination);
    return success();
  }

  private move(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 2) return usage("mv <source> <destination>");
    const source = this.resolvePath(arguments_[0]!);
    const destination = this.transferDestination(source, arguments_[1]!);
    if (
      this.options.profile.id === "linux" &&
      (!this.linuxHasAccess(parentPath(source), 0b011) ||
        !this.linuxHasAccess(parentPath(destination), 0b011))
    )
      return failure("mv", "cannot move: Permission denied");
    this.filesystem.move(source, destination);
    return success();
  }

  private transferDestination(source: string, destination: string): string {
    const resolved = this.resolvePath(destination);
    return this.filesystem.isDirectory(resolved)
      ? joinPath(resolved, baseName(source))
      : resolved;
  }

  private headOrTail(
    command: "head" | "tail",
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    const parsed = parseLineCount(arguments_, command);
    if (parsed.error !== undefined) return parsed.error;
    const sources = parsed.paths.length === 0 ? ["-"] : parsed.paths;
    const sections: string[] = [];
    for (const path of sources) {
      const input = path === "-" ? stdin : this.readFile(path);
      const lines = splitLines(input);
      const selected =
        command === "head"
          ? lines.slice(0, parsed.count)
          : lines.slice(Math.max(0, lines.length - parsed.count));
      sections.push(selected.join("\n"));
    }
    const output = sections.join("\n");
    return success(output.length === 0 ? "" : `${output}\n`);
  }

  private wordCount(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let showLines = false;
    let showWords = false;
    let showBytes = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "l") showLines = true;
          else if (flag === "w") showWords = true;
          else if (flag === "c") showBytes = true;
          else return failure("wc", `invalid option -- '${flag}'`, 2);
        }
      } else paths.push(argument);
    }
    if (!showLines && !showWords && !showBytes) {
      showLines = true;
      showWords = true;
      showBytes = true;
    }
    const sources = paths.length === 0 ? ["-"] : paths;
    const rows = sources.map((path) => {
      const input = path === "-" ? stdin : this.readFile(path);
      const values = [
        ...(showLines ? [countOccurrences(input, "\n")] : []),
        ...(showWords
          ? [input.trim().length === 0 ? 0 : input.trim().split(/\s+/u).length]
          : []),
        ...(showBytes ? [utf8Size(input)] : []),
      ];
      return `${values.map((value) => String(value).padStart(7)).join("")}${path === "-" ? "" : ` ${path}`}`;
    });
    return success(`${rows.join("\n")}\n`);
  }

  private grep(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let ignoreCase = false;
    let numbered = false;
    let invert = false;
    const values: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-" && values.length === 0) {
        for (const flag of argument.slice(1)) {
          if (flag === "i") ignoreCase = true;
          else if (flag === "n") numbered = true;
          else if (flag === "v") invert = true;
          else if (flag !== "F")
            return failure("grep", `invalid option -- '${flag}'`, 2);
        }
      } else values.push(argument);
    }
    if (values.length === 0) return usage("grep [-Finv] <pattern> [file ...]");
    const [rawPattern = "", ...paths] = values;
    const pattern = ignoreCase ? rawPattern.toLocaleLowerCase() : rawPattern;
    const sources = paths.length === 0 ? ["-"] : paths;
    const matches: string[] = [];
    for (const path of sources) {
      const input = path === "-" ? stdin : this.readFile(path);
      for (const [index, line] of splitLines(input).entries()) {
        const candidate = ignoreCase ? line.toLocaleLowerCase() : line;
        if (candidate.includes(pattern) === invert) continue;
        const prefix = `${sources.length > 1 ? `${path}:` : ""}${numbered ? `${String(index + 1)}:` : ""}`;
        matches.push(`${prefix}${line}`);
      }
    }
    return matches.length === 0
      ? status(1)
      : success(`${matches.join("\n")}\n`);
  }

  private sort(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let reverse = false;
    let unique = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-r") reverse = true;
      else if (argument === "-u") unique = true;
      else if (argument.startsWith("-") && argument !== "-") {
        return failure("sort", `invalid option '${argument}'`, 2);
      } else paths.push(argument);
    }
    let lines = splitLines(this.readInputs(paths, stdin)).sort((left, right) =>
      left.localeCompare(right),
    );
    if (unique) lines = [...new Set(lines)];
    if (reverse) lines.reverse();
    return success(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  }

  private uniq(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let count = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-c") count = true;
      else if (argument.startsWith("-") && argument !== "-") {
        return failure("uniq", `invalid option '${argument}'`, 2);
      } else paths.push(argument);
    }
    if (paths.length > 1) return usage("uniq [-c] [file]");
    const lines = splitLines(this.readInputs(paths, stdin));
    const output: string[] = [];
    for (const line of lines) {
      const previous = output.at(-1);
      if (!count) {
        if (line !== previous) output.push(line);
        continue;
      }
      const match = /^(\s*\d+) (.*)$/u.exec(previous ?? "");
      if (match !== null && match[2] === line) {
        output[output.length - 1] =
          `${String(Number(match[1]) + 1).padStart(7)} ${line}`;
      } else output.push(`${String(1).padStart(7)} ${line}`);
    }
    return success(output.length === 0 ? "" : `${output.join("\n")}\n`);
  }

  private translate(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (arguments_.length !== 2) return usage("tr <set1> <set2>");
    const from = expandCharacterSet(decodeEscapes(arguments_[0]!));
    const to = expandCharacterSet(decodeEscapes(arguments_[1]!));
    if (from.length === 0 || to.length === 0)
      return failure("tr", "empty set", 2);
    const table = new Map(
      from.map((character, index) => [
        character,
        to[Math.min(index, to.length - 1)]!,
      ]),
    );
    return success(
      [...stdin].map((character) => table.get(character) ?? character).join(""),
    );
  }

  private find(arguments_: readonly string[]): ShellCommandResult {
    const root = this.resolvePath(arguments_[0] ?? ".");
    if (!this.filesystem.exists(root)) {
      return failure(
        "find",
        `${arguments_[0] ?? "."}: no such file or directory`,
      );
    }
    let namePattern: string | undefined;
    if (arguments_.length > 1) {
      if (arguments_.length !== 3 || arguments_[1] !== "-name") {
        return usage("find [path] [-name pattern]");
      }
      namePattern = arguments_[2];
    }
    const snapshot = this.filesystem.snapshot();
    const prefix = root === "/" ? "/" : `${root}/`;
    const paths = [
      ...(this.filesystem.exists(root) ? [root] : []),
      ...snapshot.directories.filter((path) => path.startsWith(prefix)),
      ...snapshot.files
        .map(([path]) => path)
        .filter((path) => path.startsWith(prefix)),
    ]
      .filter((path, index, values) => values.indexOf(path) === index)
      .filter(
        (path) =>
          namePattern === undefined || globMatches(baseName(path), namePattern),
      )
      .sort();
    return success(`${paths.join("\n")}\n`);
  }

  private dosEchoCommand(value: string): ShellCommandResult {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return success(`ECHO is ${this.dosEcho ? "on" : "off"}.\r\n`);
    }
    if (/^off$/iu.test(normalized)) {
      this.dosEcho = false;
      return success();
    }
    if (/^on$/iu.test(normalized)) {
      this.dosEcho = true;
      return success();
    }
    return success(`${value}\r\n`);
  }

  private dosSet(value: string): ShellCommandResult {
    const assignment = value.trim();
    if (assignment.length === 0) {
      return success(
        `${[...this.environment]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([name, contents]) => `${name}=${contents}`)
          .join("\r\n")}\r\n`,
      );
    }
    const separator = assignment.indexOf("=");
    if (separator < 0) {
      const prefix = this.environmentName(assignment);
      const matches = [...this.environment]
        .filter(([name]) => name.startsWith(prefix))
        .sort(([left], [right]) => left.localeCompare(right));
      return matches.length === 0
        ? status(1, "", `Environment variable ${assignment} not defined\r\n`)
        : success(
            `${matches.map(([name, contents]) => `${name}=${contents}`).join("\r\n")}\r\n`,
          );
    }
    const name = assignment.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
      return failure("set", `${name}: invalid variable name`, 2);
    const canonical = this.environmentName(name);
    const contents = assignment.slice(separator + 1);
    if (contents.length === 0) this.environment.delete(canonical);
    else this.environment.set(canonical, contents);
    return success();
  }

  private dosPath(value: string): ShellCommandResult {
    const requested = value.trim();
    if (requested.length === 0)
      return success(`PATH=${this.environment.get("PATH") ?? ""}\r\n`);
    this.environment.set("PATH", requested === ";" ? "" : requested);
    return success();
  }

  private dosPrompt(value: string): ShellCommandResult {
    const requested = value.trim();
    if (requested.length > 64)
      return failure("prompt", "prompt template limit exceeded", 2);
    this.environment.set("PROMPT", requested.length === 0 ? "$P$G" : requested);
    return success();
  }

  private renderDosPrompt(template: string): string {
    const displayPath = this.options.profile.pathDialect.display(
      this.currentDirectory,
    );
    const drive = /^[A-Za-z]:/u.exec(displayPath)?.[0]?.slice(0, 1) ?? "C";
    const replacements: Readonly<Record<string, string>> = {
      B: "|",
      G: ">",
      L: "<",
      N: drive,
      P: displayPath,
      Q: "=",
      V: formatOsIdentity(this.options.profile.identity),
      _: "\n",
      $: "$",
    };
    let rendered = "";
    for (let index = 0; index < template.length && rendered.length < 128;) {
      const character = template[index]!;
      if (character !== "$" || index + 1 >= template.length) {
        rendered += character;
        index += 1;
        continue;
      }
      const token = template[index + 1]!.toUpperCase();
      rendered += replacements[token] ?? `$${template[index + 1]!}`;
      index += 2;
    }
    return `${rendered} `;
  }

  private environmentName(name: string): string {
    return this.options.profile.id === "dos" ? name.toUpperCase() : name;
  }

  private environmentCommand(
    command: "env" | "export",
    arguments_: readonly string[],
  ): ShellCommandResult {
    for (const argument of arguments_) {
      if (!isAssignment(argument)) return usage(`${command} [NAME=value ...]`);
      const separator = argument.indexOf("=");
      this.environment.set(
        this.environmentName(argument.slice(0, separator)),
        argument.slice(separator + 1),
      );
    }
    if (arguments_.length > 0) return success();
    const entries = [
      ...this.environment,
      ["PWD", this.currentDirectory] as const,
      ["OLDPWD", this.previousDirectory] as const,
    ].sort(([left], [right]) => left.localeCompare(right));
    return success(
      `${entries.map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
    );
  }

  private unset(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0) return usage("unset <NAME ...>");
    for (const name of arguments_) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
        return failure("unset", `${name}: invalid variable name`, 2);
      }
      this.environment.delete(this.environmentName(name));
    }
    return success();
  }

  private locate(
    command: "type" | "which",
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length === 0) return usage(`${command} <command ...>`);
    const output: string[] = [];
    for (const name of arguments_) {
      const canonical = this.canonicalCommand(name);
      if (!knownCommands.has(canonical) || !this.commandAvailable(canonical))
        return status(1, "", `${name}: not found\n`);
      output.push(
        command === "type"
          ? `${name} is a shell builtin`
          : this.options.profile.id === "dos"
            ? `C:\\COMMAND\\${name.toUpperCase()}.COM`
            : `/usr/bin/${name}`,
      );
    }
    return success(`${output.join("\n")}\n`);
  }

  private readInputs(paths: readonly string[], stdin: string): string {
    if (paths.length === 0) return stdin;
    return paths
      .map((path) => (path === "-" ? stdin : this.readFile(path)))
      .join("");
  }

  readFile(path: string): string {
    const resolved = this.resolvePath(path);
    const device = this.virtualDevice(resolved);
    if (
      device === undefined &&
      this.options.profile.id === "linux" &&
      !this.linuxHasAccess(resolved, 0b100)
    ) {
      throw new Error(`${path}: Permission denied`);
    }
    return device === undefined
      ? this.filesystem.readFile(resolved)
      : device.read();
  }

  writeFile(path: string, contents: string, append = false): void {
    const resolved = this.resolvePath(path);
    const device = this.virtualDevice(resolved);
    if (device !== undefined) {
      device.write(contents);
      return;
    }
    if (this.options.profile.id === "linux") {
      const accessPath = this.filesystem.exists(resolved)
        ? resolved
        : parentPath(resolved);
      const required = this.filesystem.exists(resolved) ? 0b010 : 0b011;
      if (!this.linuxHasAccess(accessPath, required))
        throw new Error(`${path}: Permission denied`);
    }
    if (append) this.filesystem.appendFile(resolved, contents);
    else this.filesystem.writeFile(resolved, contents);
  }

  currentTick(): number {
    return this.options.currentTick();
  }

  environmentValue(name: string): string | undefined {
    return this.environment.get(this.environmentName(name));
  }

  setEnvironmentValue(name: string, value: string): void {
    this.environment.set(this.environmentName(name), value);
  }

  unsetEnvironmentValue(name: string): void {
    this.environment.delete(this.environmentName(name));
  }

  private linuxHasAccess(path: string, required: number): boolean {
    const metadata = this.filesystem.getMetadata(path);
    const shift = metadata.uid === 1_000 ? 6 : metadata.gid === 1_000 ? 3 : 0;
    return ((metadata.mode >> shift) & 0b111 & required) === required;
  }

  private closestExistingDirectory(path: string): string {
    let candidate = parentPath(path);
    while (!this.filesystem.isDirectory(candidate)) {
      if (candidate === "/") return "/";
      candidate = parentPath(candidate);
    }
    return candidate;
  }

  ticksPerSecond(): number {
    return this.options.ticksPerSecond;
  }

  canonicalCommand(name: string): string {
    const normalized =
      this.options.profile.id === "dos" ? name.toLowerCase() : name;
    return this.options.profile.aliases.get(normalized) ?? normalized;
  }

  private displayName(name: string): string {
    return this.options.profile.id === "dos" ? name.toUpperCase() : name;
  }

  private commandCompletions(prefix: string): string[] {
    return [
      ...new Set([
        ...shellCommandNames,
        ...this.options.profile.aliases.keys(),
      ]),
    ]
      .filter(
        (name) =>
          name.startsWith(prefix) &&
          this.commandAvailable(this.canonicalCommand(name)),
      )
      .sort()
      .slice(0, 64);
  }

  private pathCompletions(token: string): string[] {
    const slash = token.lastIndexOf("/");
    const directoryToken = slash < 0 ? "." : token.slice(0, slash) || "/";
    const displayPrefix = slash < 0 ? "" : token.slice(0, slash + 1);
    const namePrefix = slash < 0 ? token : token.slice(slash + 1);
    let resolvedDirectory: string;
    let names: string[];
    try {
      resolvedDirectory = this.resolvePath(directoryToken);
      names = [...this.filesystem.list(resolvedDirectory)];
    } catch {
      return [];
    }
    for (const devicePath of this.virtualDevicePaths()) {
      if (parentPath(devicePath) === resolvedDirectory)
        names.push(baseName(devicePath));
    }
    return [...new Set(names)]
      .filter((name) => name.startsWith(namePrefix))
      .sort()
      .slice(0, 64)
      .map((name) => {
        const resolved = joinPath(resolvedDirectory, name);
        const suffix =
          this.filesystem.exists(resolved) &&
          this.filesystem.isDirectory(resolved)
            ? "/"
            : "";
        return `${displayPrefix}${name}${suffix}`;
      });
  }

  private commandAvailable(command: string): boolean {
    if (command === "edit") return this.options.profile.id === "dos";
    if (
      command === "chmod" ||
      command === "alias" ||
      command === "chown" ||
      command === "chgrp" ||
      command === "cmp" ||
      command === "cpuinfo" ||
      command === "diff" ||
      command === "dmesg" ||
      command === "file" ||
      command === "free" ||
      command === "groups" ||
      command === "getopts" ||
      command === "hexdump" ||
      command === "ln" ||
      command === "local" ||
      command === "mktemp" ||
      command === "mount" ||
      command === "od" ||
      command === "printenv" ||
      command === "readlink" ||
      command === "read" ||
      command === "realpath" ||
      command === "rmdir" ||
      command === "sha256sum" ||
      command === "sync" ||
      command === "shift" ||
      command === "tee" ||
      command === "xargs" ||
      command === "yes" ||
      command === "command" ||
      command === "unalias"
    )
      return this.options.profile.id === "linux";
    if (
      command === "cpu" ||
      command === "doskey" ||
      command === "mem" ||
      command === "systeminfo" ||
      command === "timer" ||
      command === "tree" ||
      command === "vol"
    )
      return this.options.profile.id === "dos";
    if (
      command === "path" ||
      command === "prompt" ||
      command === "rem" ||
      command === "set"
    )
      return this.options.profile.id === "dos";
    return true;
  }

  private commandNotFound(command: string): ShellCommandResult {
    return {
      exitCode: 127,
      stderr:
        this.options.profile.id === "dos"
          ? "Bad command or file name\r\n"
          : `bash: ${command}: command not found\n`,
      stdout: "",
    };
  }

  private virtualDevice(path: string): VirtualDevice | undefined {
    const configured = this.options.profile.virtualDevices.get(path);
    if (configured !== undefined) return configured;
    if (this.options.profile.id !== "linux") return undefined;
    if (path === "/proc/cpuinfo")
      return this.readOnlyDevice(path, () => this.linuxCpuInfo());
    if (path === "/proc/meminfo")
      return this.readOnlyDevice(path, () => this.linuxMemoryInfo());
    if (path === "/proc/version")
      return this.readOnlyDevice(
        path,
        () =>
          "Linux version 1.0.0-cs (computer@cs-linux) #1 CS-Linux SMP i486 GNU/Linux\n",
      );
    if (path === "/proc/uptime")
      return this.readOnlyDevice(
        path,
        () =>
          `${this.uptimeSeconds().toFixed(2)} ${this.uptimeSeconds().toFixed(2)}\n`,
      );
    if (path === "/proc/loadavg")
      return this.readOnlyDevice(path, () => "0.00 0.00 0.00 1/1 1\n");
    if (path === "/proc/mounts")
      return this.readOnlyDevice(
        path,
        () =>
          "csfs / csfs rw,nosuid,nodev 0 0\nproc /proc proc ro,nosuid,nodev,noexec 0 0\ncsdev /dev csdev rw,nosuid,noexec 0 0\ntmpfs /tmp tmpfs rw,nosuid,nodev 0 0\n",
      );
    return undefined;
  }

  private virtualDevicePaths(): readonly string[] {
    return [
      ...this.options.profile.virtualDevices.keys(),
      ...(this.options.profile.id === "linux"
        ? [
            "/proc/cpuinfo",
            "/proc/loadavg",
            "/proc/meminfo",
            "/proc/mounts",
            "/proc/uptime",
            "/proc/version",
          ]
        : []),
    ];
  }

  private readOnlyDevice(path: string, read: () => string): VirtualDevice {
    return {
      path,
      read,
      write: (): never => {
        throw new Error(`${path}: read-only virtual file`);
      },
    };
  }

  private linuxCpuInfo(): string {
    const cpu = cpuModelSpecification(this.options.hardware.cpuModel);
    return (
      [
        "processor\t: 0",
        `model name\t: ${cpu.displayName}`,
        `model id\t: ${cpu.id}`,
        `address size\t: ${String(cpu.addressBits)} bit`,
        `data bus\t: ${String(cpu.dataBusBits)} bit`,
        `clock\t\t: ${formatClock(this.options.hardware.clockHz)}`,
        "execution mode\t: protected sandbox",
        "paging\t\t: unavailable",
      ].join("\n") + "\n"
    );
  }

  private linuxMemoryInfo(): string {
    const total = this.options.hardware.memoryBytes;
    const memory = this.linuxMemorySnapshot();
    const resident = memory.resident;
    const runtime = memory.guest;
    const used = memory.used;
    const free = total - used;
    return (
      [
        `MemTotal: ${total} B`,
        `MemUsed:  ${used} B`,
        `MemFree:  ${free} B`,
        `MemAvailable: ${free} B`,
        `KernelResident: ${resident.kernel} B`,
        `SystemServices: ${resident.services} B`,
        `Buffers: ${resident.buffers} B`,
        `GuestRuntime: ${runtime} B`,
        "SwapTotal: 0 B",
        "SwapFree:  0 B",
        "MemoryModel: 32-bit protected flat sandbox",
      ].join("\n") + "\n"
    );
  }

  private usedMemoryBytes(): number {
    const guest = this.guestRuntimeBytes();
    if (this.options.profile.id === "dos") return guest;
    return this.linuxMemorySnapshot(guest).used;
  }

  private guestRuntimeBytes(): number {
    return Math.min(
      this.options.hardware.memoryBytes,
      Math.max(0, Math.floor(this.options.memoryUsageBytes())),
    );
  }

  private linuxMemorySnapshot(guest = this.guestRuntimeBytes()): {
    readonly guest: number;
    readonly resident: {
      readonly buffers: number;
      readonly kernel: number;
      readonly services: number;
    };
    readonly used: number;
  } {
    const resident = this.linuxResidentMemory(guest);
    return {
      guest,
      resident,
      used: Math.min(
        this.options.hardware.memoryBytes,
        guest + resident.kernel + resident.services + resident.buffers,
      ),
    };
  }

  private linuxResidentMemory(guest: number): {
    readonly buffers: number;
    readonly kernel: number;
    readonly services: number;
  } {
    const kib = 1_024;
    const total = this.options.hardware.memoryBytes;
    let available = Math.max(0, total - guest);
    const take = (target: number): number => {
      const bytes = Math.min(available, target);
      available -= bytes;
      return bytes;
    };
    const kernel = take(384 * kib + Math.min(384 * kib, total / 16));
    const services = take(192 * kib);
    const buffers = take(Math.min(256 * kib, total / 32));
    return { buffers, kernel, services };
  }

  private uptimeSeconds(): number {
    return (
      (this.options.currentTick() - this.bootTick) / this.options.ticksPerSecond
    );
  }

  private linuxId(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0)
      return success(
        "uid=1000(computer) gid=1000(computer) groups=1000(computer)\n",
      );
    if (
      arguments_.length !== 1 ||
      !["-u", "-g", "-G", "-un", "-gn"].includes(arguments_[0]!)
    )
      return usage("id [-u|-g|-G|-un|-gn]");
    return success(arguments_[0]!.includes("n") ? "computer\n" : "1000\n");
  }

  private linuxUptime(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("uptime");
    const seconds = Math.max(0, this.uptimeSeconds());
    const days = Math.floor(seconds / 86_400);
    const hours = Math.floor((seconds % 86_400) / 3_600);
    const minutes = Math.floor((seconds % 3_600) / 60);
    const now = new Date(this.options.clock.currentWallTimeMilliseconds());
    const clock = Number.isFinite(now.getTime())
      ? formatDate(now, "%H:%M:%S")
      : "00:00:00";
    const duration =
      days > 0
        ? `${String(days)} day${days === 1 ? "" : "s"}, ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
        : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
    return success(
      ` ${clock} up ${duration},  1 user,  load average: 0.00, 0.00, 0.00\n`,
    );
  }

  private uname(arguments_: readonly string[]): ShellCommandResult {
    if (this.options.profile.id === "linux") {
      const values = new Map<string, string>([
        ["s", "Linux"],
        ["n", this.options.computerName],
        ["r", "1.0.0-cs"],
        ["v", "#1 CS-Linux SMP"],
        ["m", "i486"],
        ["p", "i486"],
        ["i", "unknown"],
        ["o", "GNU/Linux"],
      ]);
      if (arguments_.length === 0) return success("Linux\n");
      const flags = arguments_.flatMap((argument) =>
        argument === "--all"
          ? ["a"]
          : argument.startsWith("-")
            ? [...argument.slice(1)]
            : ["?"],
      );
      if (flags.some((flag) => flag !== "a" && !values.has(flag)))
        return usage("uname [-asnrvmpio]");
      const selected = flags.includes("a")
        ? ["s", "n", "r", "v", "m", "o"]
        : [...new Set(flags)];
      return success(
        `${selected.map((flag) => values.get(flag)!).join(" ")}\n`,
      );
    }
    if (
      arguments_.length > 1 ||
      (arguments_.length === 1 && arguments_[0] !== "-a")
    )
      return usage("uname [-a]");
    const name = formatOsIdentity(this.options.profile.identity);
    const system =
      this.options.profile.id === "dos"
        ? `${name} [CPU ${cpuModelSpecification(this.options.hardware.cpuModel).runtimeName} ${formatClock(this.options.hardware.clockHz)}, Memory ${formatBinaryBytes(this.options.hardware.memoryBytes)}]`
        : name;
    return success(
      arguments_[0] === "-a"
        ? `${system} ${this.options.computerName} sandbox-vm\n`
        : `${system}\n`,
    );
  }

  private date(arguments_: readonly string[]): ShellCommandResult {
    const parsed = parseDateArguments(arguments_);
    if (parsed === undefined)
      return usage("date [--real|--game|--virtual] [+FORMAT]");

    if (parsed.mode === "game") {
      const game = this.options.clock.currentGameTime();
      if (
        !Number.isFinite(game.absoluteTicks) ||
        !Number.isFinite(game.timeOfDay)
      ) {
        return failure("date", "game clock is unavailable", 1);
      }
      const day = Math.floor(Math.max(0, game.absoluteTicks) / 24_000) + 1;
      const timeOfDay =
        ((Math.floor(game.timeOfDay) % 24_000) + 24_000) % 24_000;
      const seconds = Math.floor(((timeOfDay + 6_000) % 24_000) * 3.6);
      const date = new Date(Date.UTC(2000, 0, day, 0, 0, seconds));
      if (parsed.format === undefined) {
        return success(
          `Minecraft day ${String(day)} ${formatDate(date, "%H:%M:%S")}\n`,
        );
      }
      return success(`${formatDate(date, parsed.format)}\n`);
    }

    const milliseconds =
      parsed.mode === "real"
        ? this.options.clock.currentWallTimeMilliseconds()
        : Date.UTC(2000, 0, 1) +
          (this.options.currentTick() / this.options.ticksPerSecond) * 1_000;
    const date = new Date(milliseconds);
    if (!Number.isFinite(date.getTime())) {
      return failure("date", `${parsed.mode} clock is unavailable`, 1);
    }
    if (parsed.format === undefined)
      return success(
        parsed.mode === "real"
          ? `${formatLinuxDate(date)}\n`
          : `${date.toISOString()}\n`,
      );
    return success(`${formatDate(date, parsed.format)}\n`);
  }

  private dosTime(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) {
      return status(
        2,
        "",
        "The host-backed system time cannot be changed.\r\n",
      );
    }
    const date = new Date(this.options.clock.currentWallTimeMilliseconds());
    if (!Number.isFinite(date.getTime()))
      return status(1, "", "System time is unavailable.\r\n");
    const centiseconds = String(
      Math.floor(date.getUTCMilliseconds() / 10),
    ).padStart(2, "0");
    return success(
      `Current time is ${formatDate(date, "%H:%M:%S")}.${centiseconds}\r\n`,
    );
  }

  private dosDate(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0)
      return status(
        2,
        "",
        "The host-backed system date cannot be changed.\r\n",
      );
    const date = new Date(this.options.clock.currentWallTimeMilliseconds());
    if (!Number.isFinite(date.getTime()))
      return status(1, "", "System date is unavailable.\r\n");
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return success(
      `Current date is ${weekdays[date.getUTCDay()]} ${formatDate(date, "%m-%d-%Y")}\r\n`,
    );
  }

  private dosHelp(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) {
      return status(2, "", "Invalid number of parameters.\r\n");
    }
    if (arguments_[0] !== undefined) {
      const name = arguments_[0].toUpperCase();
      if (!this.isKnownCommand(name)) {
        return status(1, "", `Help not available for ${name}.\r\n`);
      }
      return success(
        `${name} is available in Computer System DOS. Use ${name} /? where supported.\r\n`,
      );
    }
    return success(
      [
        "Computer System DOS 6.2 Command Help",
        "",
        "CD CHDIR CLS COPY DATE DEL DIR DOSKEY ECHO EDIT ERASE EXIT",
        "MD MEM MKDIR MOVE PATH PROMPT RD REN RENAME RMDIR SET TIME",
        "TIMER TREE TYPE VER VOL",
        "",
        "Development extensions: AS CC C++ BASIC BASICC LD NM OBJDUMP RUN VI",
        "Type HELP command for a short availability summary.",
        "",
      ].join("\r\n"),
    );
  }

  private sleep(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("sleep <seconds>");
    const seconds = Number(arguments_[0]);
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > 3_600) {
      return failure("sleep", "seconds must be between 0 and 3600", 2);
    }
    return {
      exitCode: 0,
      stderr: "",
      stdout: "",
      sleepTicks: Math.ceil(seconds * this.options.ticksPerSecond),
    };
  }

  private sequence(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length < 1 || arguments_.length > 3)
      return usage("seq [first [step]] last");
    const values = arguments_.map(Number);
    if (values.some((value) => !Number.isFinite(value)))
      return failure("seq", "arguments must be numbers", 2);
    const first = values.length === 1 ? 1 : values[0]!;
    const step = values.length === 3 ? values[1]! : 1;
    const last = values.at(-1)!;
    if (step === 0) return failure("seq", "step must not be zero", 2);
    const count = Math.floor((last - first) / step) + 1;
    if (count < 0) return success();
    if (count > 10_000) return failure("seq", "output limit exceeded");
    return success(
      `${Array.from({ length: count }, (_, index) => first + index * step).join("\n")}\n`,
    );
  }

  private cut(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let delimiter = "\t";
    let fields: readonly number[] | undefined;
    const paths: string[] = [];
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      if (argument === "-d") delimiter = arguments_[++index] ?? "";
      else if (argument === "-f") {
        const value = arguments_[++index] ?? "";
        fields = value.split(",").map(Number);
      } else paths.push(argument);
    }
    if (
      delimiter.length !== 1 ||
      fields === undefined ||
      fields.some(
        (field) => !Number.isSafeInteger(field) || field < 1 || field > 1_000,
      )
    ) {
      return usage("cut [-d delimiter] -f fields [file ...]");
    }
    const output = splitLines(this.readInputs(paths, stdin)).map((line) => {
      const columns = line.split(delimiter);
      return fields.map((field) => columns[field - 1] ?? "").join(delimiter);
    });
    return success(output.length === 0 ? "" : `${output.join("\n")}\n`);
  }

  private stat(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("stat <path>");
    const resolved = this.resolvePath(arguments_[0]!);
    const device = this.virtualDevice(resolved);
    if (device !== undefined)
      return success(
        `  File: ${arguments_[0]}\n  Size: 0\tBlocks: 0\tIO Block: 1 character special file\nDevice: csdev\tInode: 0\tLinks: 1\nAccess: (0666/crw-rw-rw-)  Uid: (    0/    root)   Gid: (    0/    root)\n`,
      );
    if (!this.filesystem.exists(resolved))
      return failure(
        "stat",
        `cannot statx '${arguments_[0]}': No such file or directory`,
      );
    const symbolic = this.filesystem.isSymbolicLink(resolved);
    const kind = symbolic
      ? "symbolic link"
      : this.filesystem.isDirectory(resolved)
        ? "directory"
        : "regular file";
    const metadata = this.filesystem.getMetadata(resolved, !symbolic);
    const mode = linuxModeString(
      symbolic
        ? "link"
        : this.filesystem.isDirectory(resolved)
          ? "directory"
          : "file",
      metadata.mode,
    );
    const modified = new Date(metadata.modifiedAtMilliseconds).toISOString();
    return success(
      `  File: ${arguments_[0]}${symbolic ? ` -> ${this.filesystem.readLink(resolved)}` : ""}\n` +
        `  Size: ${String(symbolic ? utf8ByteLength(this.filesystem.readLink(resolved)) : this.filesystem.getSize(resolved))}\tBlocks: 1\tIO Block: 1 ${kind}\n` +
        `Device: csfs\tInode: ${String(stablePathInode(resolved))}\tLinks: ${String(symbolic ? 1 : this.filesystem.getLinkCount(resolved))}\n` +
        `Access: (${metadata.mode.toString(8).padStart(4, "0")}/${mode})  Uid: (${String(metadata.uid).padStart(5)}/${linuxIdentityName(metadata.uid).padStart(8)})   Gid: (${String(metadata.gid).padStart(5)}/${linuxIdentityName(metadata.gid).padStart(8)})\n` +
        `Modify: ${modified}\n`,
    );
  }

  private diskFree(arguments_: readonly string[]): ShellCommandResult {
    const human = arguments_[0] === "-h";
    const paths = arguments_.filter((argument) => argument !== "-h");
    if (
      paths.length > 1 ||
      arguments_.some(
        (argument) => argument.startsWith("-") && argument !== "-h",
      )
    )
      return usage("df [-h] [path]");
    const free = this.filesystem.getFreeSpace();
    const capacity = this.filesystem.limits.capacityBytes;
    const used = capacity - free;
    const percent = capacity === 0 ? 0 : Math.ceil((used / capacity) * 100);
    const display = (value: number): string =>
      human ? formatLinuxSize(value, true) : String(Math.ceil(value / 1_024));
    return success(
      `Filesystem      Size  Used Avail Use% Mounted on\ncsfs         ${display(capacity).padStart(6)} ${display(used).padStart(5)} ${display(free).padStart(5)} ${String(percent).padStart(3)}% /\n`,
    );
  }

  private compileExecutable(
    language: Cs486SourceLanguage | "asm",
    arguments_: readonly string[],
  ): ShellCommandResult {
    const name = language === "asm" ? "as" : language;
    arguments_ = arguments_.map((argument) => this.dosOption(argument));
    const compileOnly = arguments_.filter(
      (argument) => argument === "-c",
    ).length;
    if (compileOnly > 1) return usage(`${name} [-c] <source> [-o output]`);
    const filtered = arguments_.filter((argument) => argument !== "-c");
    const outputIndex = filtered.indexOf("-o");
    if (
      filtered.length < 1 ||
      filtered.length > 3 ||
      (outputIndex >= 0 && (outputIndex !== 1 || filtered.length !== 3)) ||
      (outputIndex < 0 && filtered.length !== 1)
    )
      return usage(`${name} [-c] <source> [-o output]`);
    const sourcePath = filtered[0]!;
    const outputPath =
      outputIndex < 0 ? (compileOnly === 1 ? "a.o" : "a.out") : filtered[2]!;
    const source = this.readFile(sourcePath);
    if (source.length > 128_000)
      return failure(language, "source limit exceeded");
    const output =
      compileOnly === 1
        ? language === "asm"
          ? assembleCs486Object(source)
          : compileCs486Object(language, source)
        : language === "asm"
          ? assembleCs486(source)
          : compileCs486Source(language, source);
    const object = output.format === "cs486-object";
    this.writeFile(
      outputPath,
      `${object ? "CS486OBJ" : "CS486"}\n${JSON.stringify(output)}`,
    );
    return {
      exitCode: 0,
      stderr: "",
      stdout: "",
      cpuCycles: Math.max(
        1,
        Math.ceil(source.length / 4) +
          (object
            ? output.assembly.split("\n").length * 2
            : output.instructions.length * 4),
      ),
    };
  }

  private linkObjects(arguments_: readonly string[]): ShellCommandResult {
    arguments_ = arguments_.map((argument) => this.dosOption(argument));
    const outputIndex = arguments_.indexOf("-o");
    const entryIndex = arguments_.indexOf("--entry");
    const consumed = new Set<number>();
    let outputPath = "a.out";
    let entry: string | undefined;
    if (outputIndex >= 0) {
      if (arguments_[outputIndex + 1] === undefined)
        return usage("ld <objects...> [-o output] [--entry symbol]");
      outputPath = arguments_[outputIndex + 1]!;
      consumed.add(outputIndex);
      consumed.add(outputIndex + 1);
    }
    if (entryIndex >= 0) {
      if (arguments_[entryIndex + 1] === undefined)
        return usage("ld <objects...> [-o output] [--entry symbol]");
      entry = arguments_[entryIndex + 1]!;
      consumed.add(entryIndex);
      consumed.add(entryIndex + 1);
    }
    const paths = arguments_.filter((_argument, index) => !consumed.has(index));
    if (paths.length === 0 || paths.length > 64)
      return usage("ld <objects...> [-o output] [--entry symbol]");
    const objects = paths.map((path) => this.readCs486Object(path));
    const executable = linkCs486Objects(objects, { entry });
    this.writeFile(outputPath, `CS486\n${JSON.stringify(executable)}`);
    return {
      exitCode: 0,
      stderr: "",
      stdout: "",
      cpuCycles: Math.min(
        1_000_000,
        objects.reduce(
          (total, object) =>
            total + object.symbols.length * 4 + object.relocations.length * 4,
          executable.instructions.length * 4,
        ),
      ),
    };
  }

  private runBasic(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("basic <source.bas>");
    const source = this.readFile(arguments_[0]!);
    if (source.length > 128_000)
      return failure("basic", "source limit exceeded");
    const executable = compileCs486Source("basic", source);
    return this.executeCs486(executable, false, Math.ceil(source.length / 4));
  }

  private runExecutable(arguments_: readonly string[]): ShellCommandResult {
    arguments_ = arguments_.map((argument) => this.dosOption(argument));
    const stats = arguments_[0] === "--stats" || arguments_[0] === "-v";
    const path = arguments_[stats ? 1 : 0];
    if (path === undefined || arguments_.length !== (stats ? 2 : 1))
      return usage("run [--stats] <executable>");
    const encoded = this.readFile(path);
    if (!encoded.startsWith("CS486\n"))
      return failure(path, "not a CS486 executable");
    let executable: unknown;
    try {
      executable = JSON.parse(encoded.slice(6));
    } catch {
      return failure(path, "invalid executable encoding");
    }
    validateCs486Executable(executable);
    return this.executeCs486(executable, stats);
  }

  private executeCs486(
    executable: Cs486Executable,
    stats: boolean,
    compileCycles = 0,
  ): ShellCommandResult {
    const result = runCs486(executable, {
      cpuModel: this.options.hardware.cpuModel,
      instructionLimit: 10_000,
      memoryBytes: this.options.hardware.memoryBytes,
    });
    const runtimeName = cpuModelSpecification(
      this.options.hardware.cpuModel,
    ).runtimeName;
    const stderr = stats
      ? `${runtimeName}: ${result.executedInstructions} instructions, ${result.cycles} CPU cycles, ${cpuCyclesToMicroseconds(result.cycles, this.options.hardware.clockHz).toFixed(3)} us at ${formatClock(this.options.hardware.clockHz)}, ${result.state}\n`
      : result.state === "yielded"
        ? `${runtimeName}: execution limit reached\n`
        : "";
    return {
      exitCode: result.state === "halted" ? 0 : 124,
      stderr,
      stdout: result.output,
      cpuCycles: Math.min(1_000_000, compileCycles + result.cycles),
    };
  }

  private objectDump(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("objdump <object|executable>");
    const encoded = this.readFile(arguments_[0]!);
    if (encoded.startsWith("CS486OBJ\n")) {
      const object = this.parseCs486Object(encoded, arguments_[0]!);
      return success(
        [
          `format ${object.format} v${String(object.version)} ${object.language}`,
          `data ${String(object.dataBytes)} bytes`,
          ...object.symbols.map(
            (symbol) =>
              `symbol ${symbol.binding.padEnd(9)} ${symbol.name}${symbol.offset === undefined ? "" : ` @${String(symbol.offset)}`}`,
          ),
          ...object.relocations.map(
            (relocation) =>
              `reloc ${relocation.type} @${String(relocation.instructionOffset)} -> ${relocation.symbol}`,
          ),
          object.assembly,
        ].join("\n") + "\n",
      );
    }
    if (!encoded.startsWith("CS486\n"))
      return failure(arguments_[0]!, "not a CS486 object or executable");
    const executable: unknown = JSON.parse(encoded.slice(6));
    validateCs486Executable(executable);
    return success(
      executable.instructions
        .map(
          (instruction, index) =>
            `${index.toString(16).padStart(4, "0")} ${JSON.stringify(instruction)}`,
        )
        .join("\n") + "\n",
    );
  }

  private listSymbols(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("nm <object|executable>");
    const encoded = this.readFile(arguments_[0]!);
    if (encoded.startsWith("CS486OBJ\n")) {
      const object = this.parseCs486Object(encoded, arguments_[0]!);
      return success(
        object.symbols
          .map(
            (symbol) =>
              `${symbol.offset?.toString(16).padStart(8, "0") ?? "        "} ${symbol.binding === "global" ? "T" : symbol.binding === "local" ? "t" : "U"} ${symbol.name}`,
          )
          .join("\n") + "\n",
      );
    }
    if (!encoded.startsWith("CS486\n"))
      return failure(arguments_[0]!, "not a CS486 object or executable");
    const executable: unknown = JSON.parse(encoded.slice(6));
    validateCs486Executable(executable);
    return success(
      (executable.symbols ?? [])
        .map(
          (symbol) =>
            `${symbol.address.toString(16).padStart(8, "0")} T ${symbol.name}`,
        )
        .join("\n") + "\n",
    );
  }

  private readCs486Object(path: string): Cs486Object {
    return this.parseCs486Object(this.readFile(path), path);
  }

  private parseCs486Object(encoded: string, path: string): Cs486Object {
    if (!encoded.startsWith("CS486OBJ\n"))
      throw new TypeError(`${path}: not a CS486 object`);
    let object: unknown;
    try {
      object = JSON.parse(encoded.slice(9));
    } catch {
      throw new TypeError(`${path}: invalid object encoding`);
    }
    validateCs486Object(object);
    return object;
  }

  private cpuInfo(arguments_: readonly string[]): ShellCommandResult {
    return arguments_.length === 0
      ? success(this.linuxCpuInfo())
      : usage("cpuinfo");
  }

  private freeMemory(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && arguments_[0] !== "-h")
    ) {
      return usage("free [-h]");
    }
    const total = this.options.hardware.memoryBytes;
    const used = this.usedMemoryBytes();
    const free = total - used;
    const display = arguments_[0] === "-h" ? formatBinaryBytes : String;
    return success(
      `              total        used        free   available\nMem:     ${display(total).padStart(10)}  ${display(used).padStart(10)}  ${display(free).padStart(10)}  ${display(free).padStart(10)}\nSwap:             0           0           0           0\n`,
    );
  }

  private dosCpu(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("CPU");
    const cpu = cpuModelSpecification(this.options.hardware.cpuModel);
    return success(
      [
        cpu.displayName,
        `Model ID: ${cpu.id}`,
        `Address size: ${String(cpu.addressBits)} bit`,
        `Data bus: ${String(cpu.dataBusBits)} bit`,
        `Clock speed: ${formatClock(this.options.hardware.clockHz)}`,
        "Execution modes: real, protected, virtual-8086 compatibility",
        "Current mode: protected sandbox",
      ].join("\r\n") + "\r\n",
    );
  }

  private dosMemory(arguments_: readonly string[]): ShellCommandResult {
    const option = arguments_[0]?.toUpperCase();
    if (
      arguments_.length > 1 ||
      (option !== undefined &&
        option !== "/C" &&
        option !== "/D" &&
        option !== "/F" &&
        option !== "/P")
    )
      return usage("MEM [/C | /D | /F | /P]");
    if (option === "/P")
      return failure("MEM", "/P paging is not supported by this terminal", 2);
    const layout = this.dosMemoryLayout();
    const lines = [
      `${formatOsIdentity(this.options.profile.identity)} Memory`,
      "",
      "Memory Type        Total       Used       Free",
      "----------------  ----------  ----------  ----------",
      this.dosMemoryRow("Conventional", layout.conventional),
      this.dosMemoryRow("Upper", layout.upper),
      this.dosMemoryRow("Reserved", layout.reserved),
      this.dosMemoryRow("Extended (XMS)", layout.extended),
      "----------------  ----------  ----------  ----------",
      this.dosMemoryRow("Total memory", layout.total),
      "",
      `${String(this.options.hardware.memoryBytes).padStart(12)} bytes total memory`,
      `${String(layout.systemBytes).padStart(12)} bytes DOS system and drivers`,
      `${String(layout.runtimeBytes).padStart(12)} bytes guest runtime`,
      `${String(layout.conventional.free).padStart(12)} bytes largest executable program size`,
      `${String(layout.upper.free).padStart(12)} bytes largest free upper memory block`,
    ];
    if (option === "/C") {
      lines.push(
        "",
        "Modules using memory below 1 MB:",
        `DOS KERNEL     ${String(16 * 1_024).padStart(10)}  Conventional`,
        `COMMAND        ${String(layout.commandBytes).padStart(10)}  ${layout.dosHigh ? "Upper" : "Conventional"}`,
        `HIMEM/EMM386   ${String(16 * 1_024).padStart(10)}  Conventional`,
        `CS-RUNTIME     ${String(layout.runtimeBytes).padStart(10)}  Conventional`,
      );
    }
    if (option === "/D") {
      lines.push(
        "",
        "CPU mode: protected sandbox",
        "DOS compatibility mode: virtual-8086 model",
        "Paging: unavailable",
        `XMS driver (HIMEM.SYS): ${layout.xms ? "installed" : "not installed"}`,
        `UMB provider (EMM386.EXE): ${layout.emm386 ? "installed" : "not installed"}`,
        `DOS high: ${layout.dosHigh ? "enabled" : "disabled"}`,
        `UMB link: ${layout.umb ? "enabled" : "disabled"}`,
      );
    }
    if (option === "/F") {
      lines.push(
        "",
        "Free memory blocks:",
        `Conventional      ${String(layout.conventional.free).padStart(10)} bytes`,
        `Upper             ${String(layout.upper.free).padStart(10)} bytes`,
        `Extended (XMS)    ${String(layout.extended.free).padStart(10)} bytes`,
      );
    }
    return success(`${lines.join("\r\n")}\r\n`);
  }

  private dosVolume(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && !/^C:?$/iu.test(arguments_[0]))
    ) {
      return usage("VOL [C:]");
    }
    return success(`${this.dosVolumeLines().join("\r\n")}\r\n`);
  }

  private dosVolumeLines(): readonly string[] {
    const serial = Math.max(0, this.options.computerId)
      .toString(16)
      .toUpperCase()
      .padStart(8, "0")
      .slice(-8);
    return [
      " Volume in drive C is CS-DOS",
      ` Volume Serial Number is ${serial.slice(0, 4)}-${serial.slice(4)}`,
    ];
  }

  private dosTree(arguments_: readonly string[]): ShellCommandResult {
    let path = ".";
    let includeFiles = false;
    for (const argument of arguments_) {
      const option = argument.toUpperCase();
      if (option === "/F") includeFiles = true;
      else if (option === "/A") continue;
      else if (path === ".") path = argument;
      else return usage("TREE [path] [/F] [/A]");
    }
    const root = this.resolvePath(path);
    if (!this.filesystem.isDirectory(root)) {
      return failure("TREE", `${path}: not a directory`, 1);
    }
    const lines = [
      "Folder PATH listing",
      this.options.profile.pathDialect.display(root),
    ];
    const maximumEntries = 512;
    const maximumDepth = 32;
    let entries = 0;
    let truncated = false;
    const visit = (directory: string, prefix: string, depth: number): void => {
      if (truncated) return;
      const children = this.filesystem
        .list(directory)
        .map((name) => ({
          name,
          path: directory === "/" ? `/${name}` : `${directory}/${name}`,
        }))
        .filter(
          ({ path: child }) =>
            includeFiles || this.filesystem.isDirectory(child),
        );
      for (const [index, child] of children.entries()) {
        if (entries >= maximumEntries || depth >= maximumDepth) {
          truncated = true;
          lines.push(`${prefix}... TREE limit reached`);
          return;
        }
        entries += 1;
        const last = index === children.length - 1;
        const directoryChild = this.filesystem.isDirectory(child.path);
        lines.push(`${prefix}+---${child.name.toUpperCase()}`);
        if (directoryChild) {
          visit(child.path, `${prefix}${last ? "    " : "|   "}`, depth + 1);
        }
      }
    };
    visit(root, "", 0);
    return status(
      truncated ? 1 : 0,
      `${lines.join("\r\n")}\r\n`,
      truncated ? "TREE: output or depth limit reached\r\n" : "",
    );
  }

  private dosMemoryLayout(): DosMemoryLayout {
    const kib = 1_024;
    const totalBytes = this.options.hardware.memoryBytes;
    const conventionalTotal = Math.min(totalBytes, 640 * kib);
    const lowMemoryTotal = Math.min(totalBytes, 1_024 * kib);
    const upperPhysical = Math.max(0, lowMemoryTotal - conventionalTotal);
    const extendedTotal = Math.max(0, totalBytes - lowMemoryTotal);
    const xms = this.environment.get("CONFIG_XMS") === "ON";
    const emm386 = this.environment.get("CONFIG_EMM386") === "ON";
    const umb = emm386 && this.environment.get("CONFIG_UMB") === "ON";
    const dosHigh = xms && this.environment.get("CONFIG_DOS_HIGH") === "ON";
    const upperTotal = umb ? Math.min(upperPhysical, 128 * kib) : 0;
    const commandBytes = 32 * kib;
    const runtimeBytes = this.guestRuntimeBytes();
    const conventionalUsed = Math.min(
      conventionalTotal,
      runtimeBytes + (dosHigh ? 32 * kib : 64 * kib),
    );
    const upperUsed = Math.min(upperTotal, dosHigh ? commandBytes : 0);
    const extendedUsed = Math.min(extendedTotal, dosHigh ? 64 * kib : 0);
    const reservedTotal = upperPhysical - upperTotal;
    const regions = {
      conventional: memoryRegion(conventionalTotal, conventionalUsed),
      upper: memoryRegion(upperTotal, upperUsed),
      reserved: memoryRegion(reservedTotal, reservedTotal),
      extended: memoryRegion(extendedTotal, extendedUsed),
    };
    return {
      ...regions,
      total: memoryRegion(
        totalBytes,
        regions.conventional.used +
          regions.upper.used +
          regions.reserved.used +
          regions.extended.used,
      ),
      commandBytes,
      dosHigh,
      emm386,
      runtimeBytes,
      systemBytes:
        regions.conventional.used -
        runtimeBytes +
        regions.upper.used +
        regions.extended.used,
      umb,
      xms,
    };
  }

  private dosMemoryRow(name: string, region: MemoryRegion): string {
    const format = (bytes: number): string =>
      `${String(Math.floor(bytes / 1_024))}K`;
    return `${name.padEnd(16)}  ${format(region.total).padStart(10)}  ${format(region.used).padStart(10)}  ${format(region.free).padStart(10)}`;
  }

  private dosOption(argument: string): string {
    return this.options.profile.id === "dos" && argument.startsWith("-")
      ? argument.toLowerCase()
      : argument;
  }

  private dosSystemInfo(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("SYSTEMINFO");
    const cpu = cpuModelSpecification(this.options.hardware.cpuModel);
    const capacity = this.filesystem.limits.capacityBytes;
    const usedDisk = capacity - this.filesystem.getFreeSpace();
    return success(
      [
        `Computer ID: ${this.options.computerName}`,
        `Operating System: ${formatOsIdentity(this.options.profile.identity)}`,
        `OS Alias: ${this.options.profile.identity.shortName} ${this.options.profile.identity.version}`,
        `CPU: ${cpu.displayName}, ${formatClock(this.options.hardware.clockHz)}`,
        `Data bus: ${String(cpu.dataBusBits)} bit`,
        `Memory: ${this.options.hardware.memoryBytes} bytes`,
        `Disk: ${usedDisk} / ${capacity} bytes used`,
      ].join("\r\n") + "\r\n",
    );
  }

  private diskUsage(arguments_: readonly string[]): ShellCommandResult {
    let includeFiles = false;
    let summarize = false;
    let human = false;
    const requested: string[] = [];
    for (const argument of arguments_) {
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "a") includeFiles = true;
          else if (flag === "s") summarize = true;
          else if (flag === "h") human = true;
          else return usage("du [-a|-s] [-h] [path ...]");
        }
      } else requested.push(argument);
    }
    if (includeFiles && summarize) return usage("du [-a|-s] [-h] [path ...]");
    if (requested.length > 32) return failure("du", "too many paths", 2);

    const paths = requested.length === 0 ? ["."] : requested;
    const snapshot = this.filesystem.snapshot();
    const sizes = new Map<string, number>();
    for (const [file, contents] of snapshot.files) {
      const bytes = utf8ByteLength(contents);
      sizes.set(file, bytes);
      let directory = parentPath(file);
      for (;;) {
        sizes.set(directory, (sizes.get(directory) ?? 0) + bytes);
        if (directory === "/") break;
        directory = parentPath(directory);
      }
    }

    const output: string[] = [];
    for (const requestedPath of paths) {
      const resolved = this.resolvePath(requestedPath);
      if (!this.filesystem.exists(resolved)) {
        return failure("du", `${requestedPath}: no such file or directory`);
      }
      if (!summarize && this.filesystem.isDirectory(resolved)) {
        const prefix = resolved === "/" ? "/" : `${resolved}/`;
        const descendants = snapshot.directories
          .filter((path) => path.startsWith(prefix))
          .sort();
        if (includeFiles) {
          for (const [file] of snapshot.files) {
            if (file.startsWith(prefix))
              output.push(
                `${formatDuSize(sizes.get(file) ?? 0, human)}\t${file}`,
              );
          }
        }
        for (const directory of descendants) {
          output.push(
            `${formatDuSize(sizes.get(directory) ?? 0, human)}\t${directory}`,
          );
        }
      }
      output.push(
        `${formatDuSize(sizes.get(resolved) ?? 0, human)}\t${requestedPath}`,
      );
    }
    return success(`${output.join("\n")}\n`);
  }

  private quota(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("quota");
    const capacity = this.filesystem.limits.capacityBytes;
    const free = this.filesystem.getFreeSpace();
    const used = capacity - free;
    return success(
      `Disk quota: ${used} / ${capacity} bytes used (${free} bytes free)\n` +
        `Limits: ${this.filesystem.limits.maxFileBytes} bytes/file, ${this.filesystem.limits.maxEntries} entries\n`,
    );
  }

  private linuxChangeMode(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length < 2 || arguments_.length > 33)
      return usage("chmod <octal-mode> <path ...>");
    const [modeText = "", ...paths] = arguments_;
    if (!/^[0-7]{3,4}$/u.test(modeText))
      return failure("chmod", `invalid mode: '${modeText}'`, 1);
    const mode = Number.parseInt(modeText, 8);
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved))
        return failure(
          "chmod",
          `cannot access '${path}': No such file or directory`,
        );
      if (this.filesystem.getMetadata(resolved).uid !== 1_000)
        return failure(
          "chmod",
          `changing permissions of '${path}': Operation not permitted`,
        );
      this.filesystem.setMetadata(resolved, { mode });
    }
    return success();
  }

  private linuxChangeOwner(
    arguments_: readonly string[],
    includeOwner: boolean,
  ): ShellCommandResult {
    const command = includeOwner ? "chown" : "chgrp";
    if (arguments_.length < 2 || arguments_.length > 33)
      return usage(
        `${command} <owner${includeOwner ? "[:group]" : ""}> <path ...>`,
      );
    const [identity = "", ...paths] = arguments_;
    const [ownerName = "", groupName] = includeOwner
      ? identity.split(":", 2)
      : ["", identity];
    const uid = includeOwner ? linuxIdentityNumber(ownerName) : undefined;
    const gid =
      groupName === undefined ? undefined : linuxIdentityNumber(groupName);
    if (
      (includeOwner && uid === undefined) ||
      (groupName !== undefined && gid === undefined)
    )
      return failure(command, `invalid user or group: '${identity}'`, 1);
    for (const path of paths) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved))
        return failure(
          command,
          `cannot access '${path}': No such file or directory`,
        );
      const current = this.filesystem.getMetadata(resolved);
      if (
        current.uid !== 1_000 ||
        (includeOwner && uid !== undefined && uid !== current.uid) ||
        (gid !== undefined && gid !== 1_000)
      )
        return failure(
          command,
          `changing ownership of '${path}': Operation not permitted`,
        );
      this.filesystem.setMetadata(resolved, {
        ...(gid === undefined ? {} : { gid }),
        ...(uid === undefined ? {} : { uid }),
      });
    }
    return success();
  }

  private linuxLink(arguments_: readonly string[]): ShellCommandResult {
    let symbolic = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-s" || argument === "--symbolic") symbolic = true;
      else if (argument.startsWith("-"))
        return failure("ln", `invalid option -- '${argument}'`, 1);
      else paths.push(argument);
    }
    if (paths.length !== 2) return usage("ln [-s] <target> <link-name>");
    const target = symbolic ? paths[0]! : this.resolvePath(paths[0]!);
    const link = this.resolvePath(paths[1]!);
    if (!this.linuxHasAccess(parentPath(link), 0b011))
      return failure(
        "ln",
        `failed to create link '${paths[1]}': Permission denied`,
      );
    if (symbolic) this.filesystem.createSymbolicLink(target, link);
    else this.filesystem.createHardLink(target, link);
    return success();
  }

  private linuxReadLink(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("readlink <path>");
    const path = this.resolvePath(arguments_[0]!);
    if (!this.filesystem.isSymbolicLink(path)) return status(1);
    return success(`${this.filesystem.readLink(path)}\n`);
  }

  private linuxRealPath(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return usage("realpath <path>");
    const resolved = this.filesystem.resolveSymbolicLinks(
      this.resolvePath(arguments_[0]!),
    );
    if (!this.filesystem.exists(resolved))
      return failure(
        "realpath",
        `${arguments_[0]}: No such file or directory`,
        1,
      );
    return success(`${resolved}\n`);
  }

  private linuxRemoveDirectory(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length === 0 || arguments_.length > 32)
      return usage("rmdir <directory ...>");
    for (const path of arguments_) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.isDirectory(resolved))
        return failure("rmdir", `failed to remove '${path}': Not a directory`);
      if (this.filesystem.list(resolved).length > 0)
        return failure(
          "rmdir",
          `failed to remove '${path}': Directory not empty`,
        );
      if (!this.linuxHasAccess(parentPath(resolved), 0b011))
        return failure(
          "rmdir",
          `failed to remove '${path}': Permission denied`,
        );
      this.filesystem.delete(resolved);
    }
    return success();
  }

  private linuxGroups(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_[0] !== undefined && arguments_[0] !== "computer")
    )
      return failure("groups", `${arguments_[0] ?? ""}: no such user`, 1);
    return success("computer\n");
  }

  private linuxPrintEnvironment(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length > 1) return usage("printenv [name]");
    if (arguments_[0] !== undefined) {
      const value = this.environment.get(arguments_[0]);
      return value === undefined ? status(1) : success(`${value}\n`);
    }
    return success(
      `${[...this.environment]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\n`,
    );
  }

  private linuxFile(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length === 0 || arguments_.length > 32)
      return usage("file <path ...>");
    const lines: string[] = [];
    for (const path of arguments_) {
      const resolved = this.resolvePath(path);
      if (!this.filesystem.exists(resolved)) {
        lines.push(`${path}: cannot open (No such file or directory)`);
        continue;
      }
      if (this.filesystem.isSymbolicLink(resolved)) {
        lines.push(
          `${path}: symbolic link to ${this.filesystem.readLink(resolved)}`,
        );
      } else if (this.filesystem.isDirectory(resolved)) {
        lines.push(`${path}: directory`);
      } else {
        const contents = this.filesystem.readFile(resolved);
        const description = contents.startsWith("CS486\n")
          ? "Computer System CS486 executable"
          : contents.includes("\0")
            ? "data"
            : contents.length === 0
              ? "empty"
              : "Unicode text, UTF-8 text";
        lines.push(`${path}: ${description}`);
      }
    }
    return success(`${lines.join("\n")}\n`);
  }

  private linuxSha256Sum(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (arguments_.length > 32)
      return failure("sha256sum", "too many files", 1);
    const paths = arguments_.length === 0 ? ["-"] : arguments_;
    const lines = paths.map((path) => {
      const contents = path === "-" ? stdin : this.readFile(path);
      return `${sha256Hex(contents)}  ${path}`;
    });
    return success(`${lines.join("\n")}\n`);
  }

  private linuxTee(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    let append = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-a" || argument === "--append") append = true;
      else if (argument.startsWith("-"))
        return failure("tee", `invalid option -- '${argument}'`, 1);
      else paths.push(argument);
    }
    if (paths.length > 32) return failure("tee", "too many files", 1);
    for (const path of paths) this.writeFile(path, stdin, append);
    return success(stdin);
  }

  private linuxCompare(arguments_: readonly string[]): ShellCommandResult {
    let silent = false;
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-s" || argument === "--silent") silent = true;
      else paths.push(argument);
    }
    if (paths.length !== 2) return usage("cmp [-s] <file1> <file2>");
    const left = this.readFile(paths[0]!);
    const right = this.readFile(paths[1]!);
    if (left === right) return success();
    if (silent) return status(1);
    const length = Math.min(left.length, right.length);
    let offset = 0;
    while (offset < length && left[offset] === right[offset]) offset += 1;
    const line = left.slice(0, offset).split("\n").length;
    return status(
      1,
      `${paths[0]} ${paths[1]} differ: byte ${String(offset + 1)}, line ${String(line)}\n`,
    );
  }

  private linuxDiff(arguments_: readonly string[]): ShellCommandResult {
    const paths = arguments_.filter((argument) => argument !== "-u");
    if (
      paths.length !== 2 ||
      arguments_.some(
        (argument) => argument.startsWith("-") && argument !== "-u",
      )
    )
      return usage("diff [-u] <file1> <file2>");
    const left = splitLines(this.readFile(paths[0]!));
    const right = splitLines(this.readFile(paths[1]!));
    if (left.join("\n") === right.join("\n")) return success();
    if (left.length + right.length > 4_000)
      return failure("diff", "comparison line limit exceeded", 1);
    const lines = [`--- ${paths[0]}`, `+++ ${paths[1]}`, "@@"];
    const maximum = Math.max(left.length, right.length);
    for (let index = 0; index < maximum; index += 1) {
      if (left[index] === right[index]) lines.push(` ${left[index] ?? ""}`);
      else {
        if (left[index] !== undefined) lines.push(`-${left[index]}`);
        if (right[index] !== undefined) lines.push(`+${right[index]}`);
      }
    }
    return status(1, `${lines.join("\n")}\n`);
  }

  private linuxHexDump(
    command: "hexdump" | "od",
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    const paths = arguments_.filter(
      (argument) =>
        argument !== "-C" && argument !== "-An" && argument !== "-tx1",
    );
    if (paths.length > 1) return usage(`${command} [-C] [file]`);
    const contents = paths[0] === undefined ? stdin : this.readFile(paths[0]);
    const bytes = new TextEncoder().encode(contents);
    if (bytes.length > 65_536)
      return failure(command, "input limit exceeded", 1);
    const lines: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += 16) {
      const row = bytes.slice(offset, offset + 16);
      const hex = [...row]
        .map((value) => value.toString(16).padStart(2, "0"))
        .join(" ");
      if (command === "od") lines.push(hex);
      else {
        const ascii = [...row]
          .map((value) =>
            value >= 32 && value < 127 ? String.fromCharCode(value) : ".",
          )
          .join("");
        lines.push(
          `${offset.toString(16).padStart(8, "0")}  ${hex.padEnd(47)}  |${ascii}|`,
        );
      }
    }
    if (command === "hexdump")
      lines.push(bytes.length.toString(16).padStart(8, "0"));
    return success(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  }

  private linuxMakeTemporary(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (arguments_.length > 1) return usage("mktemp [template]");
    const template = arguments_[0] ?? "/tmp/tmp.XXXXXX";
    if (!/X{6}$/u.test(template))
      return failure("mktemp", `too few X's in template '${template}'`, 1);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const suffix = (++this.temporarySequence).toString(36).padStart(6, "0");
      const path = template.replace(/X{6}$/u, suffix);
      const resolved = this.resolvePath(path);
      if (this.filesystem.exists(resolved)) continue;
      this.filesystem.writeFile(resolved, "");
      this.filesystem.setMetadata(resolved, { mode: 0o600 });
      return success(`${path}\n`);
    }
    return failure("mktemp", "failed to create file", 1);
  }

  private linuxMount(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("mount");
    return success(
      [
        "computer-system on / type csfs (rw,nosuid,nodev)",
        "proc on /proc type proc (ro,nosuid,nodev,noexec)",
        "dev on /dev type csdev (rw,nosuid,noexec)",
        "tmpfs on /tmp type tmpfs (rw,nosuid,nodev)",
        "",
      ].join("\n"),
    );
  }

  private linuxDmesg(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 0) return usage("dmesg");
    const cpu = cpuModelSpecification(this.options.hardware.cpuModel);
    return success(
      [
        "[    0.000000] CS-Linux 1.0 sandbox kernel starting",
        `[    0.000001] CPU: ${cpu.displayName} at ${formatClock(this.options.hardware.clockHz)}`,
        `[    0.000002] Memory: ${String(this.options.hardware.memoryBytes)} bytes available`,
        "[    0.000003] csfs: mounted root filesystem",
        "[    0.000004] Run /bin/bash as uid 1000",
        "",
      ].join("\n"),
    );
  }

  private linuxYes(arguments_: readonly string[]): ShellCommandResult {
    const value = arguments_.length === 0 ? "y" : arguments_.join(" ");
    return status(
      1,
      `${Array.from({ length: 1_024 }, () => value).join("\n")}\n`,
      "yes: bounded output limit reached\n",
    );
  }

  private linuxXargs(
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    if (this.xargsDepth > 0)
      return failure("xargs", "recursive use is not supported", 1);
    if (arguments_.some((argument) => argument.startsWith("-")))
      return usage("xargs [command [initial-arguments ...]]");
    const values = stdin.trim().length === 0 ? [] : stdin.trim().split(/\s+/u);
    if (values.length > 128)
      return failure("xargs", "argument limit exceeded", 1);
    const command = arguments_.length === 0 ? ["echo"] : [...arguments_];
    this.xargsDepth += 1;
    try {
      return this.execute([...command, ...values], "");
    } finally {
      this.xargsDepth -= 1;
    }
  }

  private test(
    command: "[" | "test",
    originalArguments: readonly string[],
  ): ShellCommandResult {
    const arguments_ = [...originalArguments];
    if (command === "[") {
      if (arguments_.pop() !== "]") return failure("[", "missing ]", 2);
    }
    if (arguments_.length === 0) return status(1);
    if (arguments_.length === 1)
      return status(arguments_[0]!.length === 0 ? 1 : 0);
    if (arguments_.length === 2) {
      const [operator, value = ""] = arguments_;
      if (operator === "-n") return status(value.length > 0 ? 0 : 1);
      if (operator === "-z") return status(value.length === 0 ? 0 : 1);
      const path = this.resolvePath(value);
      if (operator === "-e")
        return status(
          this.filesystem.exists(path) || this.virtualDevice(path) !== undefined
            ? 0
            : 1,
        );
      if (operator === "-f")
        return status(
          this.filesystem.exists(path) && !this.filesystem.isDirectory(path)
            ? 0
            : 1,
        );
      if (operator === "-d")
        return status(this.filesystem.isDirectory(path) ? 0 : 1);
      if (operator === "-s")
        return status(
          this.filesystem.exists(path) && this.filesystem.getSize(path) > 0
            ? 0
            : 1,
        );
    }
    if (arguments_.length === 3) {
      const [left = "", operator, right = ""] = arguments_;
      if (operator === "=" || operator === "==")
        return status(left === right ? 0 : 1);
      if (operator === "!=") return status(left !== right ? 0 : 1);
      const leftNumber = Number(left);
      const rightNumber = Number(right);
      if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber))
        return failure("test", "integer expression expected", 2);
      const comparisons = new Map<string, boolean>([
        ["-eq", leftNumber === rightNumber],
        ["-ne", leftNumber !== rightNumber],
        ["-lt", leftNumber < rightNumber],
        ["-le", leftNumber <= rightNumber],
        ["-gt", leftNumber > rightNumber],
        ["-ge", leftNumber >= rightNumber],
      ]);
      if (comparisons.has(operator ?? ""))
        return status(comparisons.get(operator ?? "") ? 0 : 1);
    }
    return failure("test", "unsupported expression", 2);
  }
}

type DateMode = "game" | "real" | "virtual";

function linuxIdentityNumber(value: string): number | undefined {
  if (value === "computer" || value === "1000") return 1_000;
  if (value === "root" || value === "0") return 0;
  return undefined;
}

function linuxIdentityName(value: number): string {
  if (value === 1_000) return "computer";
  if (value === 0) return "root";
  return String(value);
}

function linuxModeString(
  kind: "device" | "directory" | "file" | "link",
  mode: number,
): string {
  const type =
    kind === "directory"
      ? "d"
      : kind === "link"
        ? "l"
        : kind === "device"
          ? "c"
          : "-";
  const bits = [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001];
  return (
    type +
    bits
      .map((bit, index) =>
        (mode & bit) === 0
          ? "-"
          : index % 3 === 0
            ? "r"
            : index % 3 === 1
              ? "w"
              : "x",
      )
      .join("")
  );
}

function formatLinuxSize(bytes: number, human: boolean): string {
  if (!human) return String(bytes);
  return formatBinaryBytes(bytes)
    .replace(" MiB", "M")
    .replace(" KiB", "K")
    .replace(" B", "B")
    .replace(" bytes", "B");
}

function formatLinuxTimestamp(milliseconds: number): string {
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return "Jan  1 00:00";
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2)} ${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

function formatLinuxDate(date: Date): string {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2)} ${formatDate(date, "%H:%M:%S")} UTC ${String(date.getUTCFullYear())}`;
}

function stablePathInode(path: string): number {
  let value = 2_166_136_261;
  for (const character of path) {
    value ^= character.codePointAt(0)!;
    value = Math.imul(value, 16_777_619) >>> 0;
  }
  return Math.max(1, value);
}

function formatDuSize(bytes: number, human: boolean): string {
  return human
    ? formatLinuxSize(bytes, true)
    : String(Math.ceil(bytes / 1_024));
}

function findCompletionTokenStart(value: string): number {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (/\s|[;&|<>]/u.test(value[index] ?? "")) return index + 1;
  }
  return 0;
}

function isCommandCompletionPosition(prefix: string): boolean {
  const separator = Math.max(
    prefix.lastIndexOf(";"),
    prefix.lastIndexOf("|"),
    prefix.lastIndexOf("&"),
  );
  return prefix.slice(separator + 1).trim().length === 0;
}

function longestCommonPrefix(values: readonly string[]): string {
  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    let length = 0;
    while (
      length < prefix.length &&
      length < value.length &&
      prefix[length] === value[length]
    ) {
      length += 1;
    }
    prefix = prefix.slice(0, length);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function parseDateArguments(
  arguments_: readonly string[],
): { readonly format?: string; readonly mode: DateMode } | undefined {
  if (arguments_.length > 2) return undefined;
  let mode: DateMode = "real";
  let format: string | undefined;
  for (const argument of arguments_) {
    if (argument === "--real") mode = "real";
    else if (argument === "--game") mode = "game";
    else if (argument === "--virtual") mode = "virtual";
    else if (argument.startsWith("+") && format === undefined)
      format = argument.slice(1);
    else return undefined;
  }
  return { format, mode };
}

function formatDate(date: Date, format: string): string {
  return format.replace(/%[sYmdHMS%]/gu, (specifier) => {
    switch (specifier) {
      case "%s":
        return String(Math.floor(date.getTime() / 1_000));
      case "%Y":
        return String(date.getUTCFullYear()).padStart(4, "0");
      case "%m":
        return String(date.getUTCMonth() + 1).padStart(2, "0");
      case "%d":
        return String(date.getUTCDate()).padStart(2, "0");
      case "%H":
        return String(date.getUTCHours()).padStart(2, "0");
      case "%M":
        return String(date.getUTCMinutes()).padStart(2, "0");
      case "%S":
        return String(date.getUTCSeconds()).padStart(2, "0");
      default:
        return "%";
    }
  });
}

function success(
  stdout = "",
  extra: { readonly action?: ShellAction } = {},
): ShellCommandResult {
  return { ...extra, exitCode: 0, stderr: "", stdout };
}

function status(
  exitCode: number,
  stdout = "",
  stderr = "",
): ShellCommandResult {
  return { exitCode, stderr, stdout };
}

function failure(
  command: string,
  detail: string,
  exitCode = 1,
): ShellCommandResult {
  return status(exitCode, "", `${command}: ${detail}\n`);
}

function usage(usageText: string): ShellCommandResult {
  return status(2, "", `Usage: ${usageText}\n`);
}

function isAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/u.test(value);
}

function parentPath(path: string): string {
  return path === "/" ? "/" : path.slice(0, path.lastIndexOf("/")) || "/";
}

function baseName(path: string): string {
  return path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
}

function joinPath(parent: string, child: string): string {
  return parent === "/" ? `/${child}` : `${parent}/${child}`;
}

function splitLines(value: string): string[] {
  if (value.length === 0) return [];
  const lines = value.replaceAll("\r\n", "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function decodeEscapes(value: string): string {
  return value.replace(/\\([\\nrt])/gu, (_match, escaped: string) => {
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      default:
        return "\\";
    }
  });
}

function expandCharacterSet(value: string): string[] {
  const characters = [...value];
  const expanded: string[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    const start = characters[index]!;
    const separator = characters[index + 1];
    const end = characters[index + 2];
    if (separator === "-" && end !== undefined) {
      const startCode = start.codePointAt(0)!;
      const endCode = end.codePointAt(0)!;
      if (startCode <= endCode && endCode - startCode <= 255) {
        for (let code = startCode; code <= endCode; code += 1) {
          expanded.push(String.fromCodePoint(code));
        }
        index += 2;
        continue;
      }
    }
    expanded.push(start);
  }
  return expanded;
}

function parseLineCount(
  arguments_: readonly string[],
  command: "head" | "tail",
): {
  readonly count: number;
  readonly error?: ShellCommandResult;
  readonly paths: readonly string[];
} {
  let count = 10;
  const paths: string[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "-n") {
      const value = arguments_[index + 1];
      if (value === undefined)
        return {
          count,
          error: usage(`${command} [-n count] [file ...]`),
          paths,
        };
      count = Number(value);
      index += 1;
    } else if (/^-[0-9]+$/u.test(argument)) count = Number(argument.slice(1));
    else if (argument.startsWith("-") && argument !== "-") {
      return {
        count,
        error: failure(command, `invalid option '${argument}'`, 2),
        paths,
      };
    } else paths.push(argument);
  }
  if (!Number.isSafeInteger(count) || count < 0 || count > 100_000) {
    return { count, error: failure(command, "invalid line count", 2), paths };
  }
  return { count, paths };
}

function countOccurrences(value: string, character: string): number {
  let count = 0;
  for (const candidate of value) if (candidate === character) count += 1;
  return count;
}

function utf8Size(value: string): number {
  let size = 0;
  for (const character of value) {
    const point = character.codePointAt(0)!;
    size += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return size;
}

function memoryRegion(total: number, used: number): MemoryRegion {
  const boundedTotal = Math.max(0, Math.floor(total));
  const boundedUsed = Math.min(boundedTotal, Math.max(0, Math.floor(used)));
  return {
    free: boundedTotal - boundedUsed,
    total: boundedTotal,
    used: boundedUsed,
  };
}

function formatClock(clockHz: number): string {
  if (clockHz >= 1_000_000)
    return `${(clockHz / 1_000_000).toFixed(2).replace(/\.00$/u, "")} MHz`;
  if (clockHz >= 1_000)
    return `${(clockHz / 1_000).toFixed(2).replace(/\.00$/u, "")} kHz`;
  return `${clockHz} Hz`;
}

function formatBinaryBytes(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

function globMatches(value: string, pattern: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
    .replaceAll("*", ".*")
    .replaceAll("?", ".");
  return new RegExp(`^${escaped}$`, "u").test(value);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
