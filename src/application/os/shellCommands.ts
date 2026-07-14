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
] as const;

const knownCommands = new Set<string>(shellCommandNames);
const maximumOutputLength = 256_000;

export class ShellCommandRuntime {
  private readonly bootTick: number;
  private currentDirectory: string;
  private previousDirectory: string;
  private readonly environment: Map<string, string>;
  private dosEcho = true;

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
        return success(
          [
            "Computer System BusyBox shell",
            "files: pwd cd ls cat mkdir touch rm cp mv find du quota",
            "text: echo printf head tail wc grep sort uniq tr",
            "shell: sh bash source env export unset which type",
            `system: clear ${this.options.profile.id === "dos" ? "edit " : ""}vi shutdown reboot exit true false`,
            "info: whoami id hostname uname date uptime stat df du quota",
            this.options.profile.id === "dos"
              ? "hardware: CPU MEM SYSTEMINFO"
              : "hardware: cpuinfo free /proc/cpuinfo /proc/meminfo",
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
        return arguments_.length === 0
          ? success(
              `uid=0(${this.options.profile.username}) gid=0(${this.options.profile.username}) groups=0(${this.options.profile.username})\n`,
            )
          : usage("id");
      case "hostname":
        return arguments_.length === 0
          ? success(`${this.options.computerName}\n`)
          : usage("hostname");
      case "uname":
        return this.uname(arguments_);
      case "date":
        return this.date(arguments_);
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
        return arguments_.length === 0
          ? success(`${this.uptimeSeconds().toFixed(2)} seconds\n`)
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
    const paths: string[] = [];
    for (const argument of arguments_) {
      if (argument === "--") {
        continue;
      }
      if (argument.startsWith("-") && argument !== "-") {
        for (const flag of argument.slice(1)) {
          if (flag === "l") long = true;
          else if (flag === "a" || flag === "1") all ||= flag === "a";
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
      const names = this.filesystem.isDirectory(resolved)
        ? this.filesystem
            .list(resolved)
            .filter((name) => all || !name.startsWith("."))
        : [baseName(resolved)];
      if (this.filesystem.isDirectory(resolved)) {
        for (const devicePath of this.virtualDevicePaths()) {
          if (parentPath(devicePath) !== resolved) continue;
          const name = baseName(devicePath);
          if ((all || !name.startsWith(".")) && !names.includes(name)) {
            names.push(name);
          }
        }
        names.sort();
      }
      const prefix = paths.length > 1 ? `${path}:\n` : "";
      const listing = long
        ? names
            .map((name) => {
              const target = this.filesystem.isDirectory(resolved)
                ? joinPath(resolved, name)
                : resolved;
              const device = this.virtualDevice(target) !== undefined;
              const kind = device
                ? "dev "
                : this.filesystem.isDirectory(target)
                  ? "dir "
                  : "file";
              const size = device ? 0 : this.filesystem.getSize(target);
              return `${kind} ${String(size).padStart(7)} ${this.displayName(name)}`;
            })
            .join("\n")
        : names.map((name) => this.displayName(name)).join("  ");
      sections.push(`${index > 0 ? "\n" : ""}${prefix}${listing}`);
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
      if (!this.filesystem.exists(resolved))
        this.filesystem.writeFile(resolved, "");
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
    this.filesystem.copy(source, this.transferDestination(source, paths[1]!));
    return success();
  }

  private move(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 2) return usage("mv <source> <destination>");
    const source = this.resolvePath(arguments_[0]!);
    this.filesystem.move(
      source,
      this.transferDestination(source, arguments_[1]!),
    );
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
    if (append) this.filesystem.appendFile(resolved, contents);
    else this.filesystem.writeFile(resolved, contents);
  }

  currentTick(): number {
    return this.options.currentTick();
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
    if (command === "cpuinfo" || command === "free")
      return this.options.profile.id === "linux";
    if (command === "cpu" || command === "mem" || command === "systeminfo")
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
    return undefined;
  }

  private virtualDevicePaths(): readonly string[] {
    return [
      ...this.options.profile.virtualDevices.keys(),
      ...(this.options.profile.id === "linux"
        ? ["/proc/cpuinfo", "/proc/meminfo"]
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
    const used = this.usedMemoryBytes();
    const free = total - used;
    return (
      [
        `MemTotal: ${total} B`,
        `MemUsed:  ${used} B`,
        `MemFree:  ${free} B`,
        `MemAvailable: ${free} B`,
        `Runtime:  ${used} B`,
        "SwapTotal: 0 B",
        "SwapFree:  0 B",
        "MemoryModel: 32-bit protected flat sandbox",
      ].join("\n") + "\n"
    );
  }

  private usedMemoryBytes(): number {
    return Math.min(
      this.options.hardware.memoryBytes,
      Math.max(0, Math.floor(this.options.memoryUsageBytes())),
    );
  }

  private uptimeSeconds(): number {
    return (
      (this.options.currentTick() - this.bootTick) / this.options.ticksPerSecond
    );
  }

  private uname(arguments_: readonly string[]): ShellCommandResult {
    if (
      arguments_.length > 1 ||
      (arguments_.length === 1 && arguments_[0] !== "-a")
    ) {
      return usage("uname [-a]");
    }
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
    if (parsed.format === undefined) return success(`${date.toISOString()}\n`);
    return success(`${formatDate(date, parsed.format)}\n`);
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
    if (device !== undefined) return success(`device 0 ${arguments_[0]}\n`);
    if (!this.filesystem.exists(resolved))
      return failure("stat", `${arguments_[0]}: no such file or directory`);
    const kind = this.filesystem.isDirectory(resolved) ? "directory" : "file";
    return success(
      `${kind} ${this.filesystem.getSize(resolved)} ${arguments_[0]}\n`,
    );
  }

  private diskFree(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) return usage("df [path]");
    const free = this.filesystem.getFreeSpace();
    const capacity = this.filesystem.limits.capacityBytes;
    return success(
      `Filesystem 1B-blocks Used Available Mounted on\ncomputer-system ${capacity} ${capacity - free} ${free} /\n`,
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
        option !== "/P")
    )
      return usage("MEM [/C | /D | /P]");
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
      `${String(layout.runtimeBytes).padStart(12)} bytes guest runtime`,
      `${String(layout.conventional.free).padStart(12)} bytes largest executable program size`,
      `${String(layout.upper.free).padStart(12)} bytes largest free upper memory block`,
    ];
    if (option === "/C") {
      lines.push(
        "",
        "Modules using memory below 1 MB:",
        `COMMAND        ${String(layout.commandBytes).padStart(10)}  ${layout.dosHigh ? "Upper" : "Conventional"}`,
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
    return success(`${lines.join("\r\n")}\r\n`);
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
    const runtimeBytes = this.usedMemoryBytes();
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
    const requested: string[] = [];
    for (const argument of arguments_) {
      if (argument === "-a") includeFiles = true;
      else if (argument === "-s") summarize = true;
      else if (argument.startsWith("-")) {
        return usage("du [-a|-s] [path ...]");
      } else requested.push(argument);
    }
    if (includeFiles && summarize) return usage("du [-a|-s] [path ...]");
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
              output.push(`${sizes.get(file) ?? 0}\t${file}`);
          }
        }
        for (const directory of descendants) {
          output.push(`${sizes.get(directory) ?? 0}\t${directory}`);
        }
      }
      output.push(`${sizes.get(resolved) ?? 0}\t${requestedPath}`);
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
