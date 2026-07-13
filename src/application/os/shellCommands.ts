import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";

export type ShellAction = "clear" | "reboot" | "shutdown";

export interface ShellCommandResult {
  readonly action?: ShellAction;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export const shellCommandNames = [
  "basename",
  "bash",
  "cat",
  "cd",
  "clear",
  "cp",
  "dirname",
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
  "ls",
  "mkdir",
  "mv",
  "printf",
  "pwd",
  "reboot",
  "rm",
  "sh",
  "shutdown",
  "sort",
  "source",
  "tail",
  "touch",
  "tr",
  "true",
  "type",
  "uniq",
  "unset",
  "wc",
  "which",
] as const;

const knownCommands = new Set<string>(shellCommandNames);
const maximumOutputLength = 256_000;

export class ShellCommandRuntime {
  private currentDirectory = "/";
  private previousDirectory = "/";
  private readonly environment = new Map<string, string>([
    ["HOME", "/"],
    ["PATH", "/bin"],
    ["SHELL", "/bin/bash"],
    ["TERM", "computer-system"],
  ]);

  constructor(private readonly filesystem: InMemoryFilesystem) {}

  get cwd(): string {
    return this.currentDirectory;
  }

  resolveVariable(name: string, lastExitCode: number): string | undefined {
    if (name === "?") return String(lastExitCode);
    if (name === "PWD") return this.currentDirectory;
    if (name === "OLDPWD") return this.previousDirectory;
    return this.environment.get(name);
  }

  execute(words: readonly string[], stdin: string): ShellCommandResult {
    const assignments = words.findIndex((word) => !isAssignment(word));
    if (assignments !== 0) {
      const count = assignments < 0 ? words.length : assignments;
      for (const assignment of words.slice(0, count)) {
        const separator = assignment.indexOf("=");
        this.environment.set(
          assignment.slice(0, separator),
          assignment.slice(separator + 1),
        );
      }
      if (assignments < 0) return success();
      words = words.slice(assignments);
    }

    const [command = "", ...arguments_] = words;
    try {
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
    const expanded =
      path === "~"
        ? (this.environment.get("HOME") ?? "/")
        : path.startsWith("~/")
          ? `${this.environment.get("HOME") ?? ""}${path.slice(1)}`
          : path;
    return this.filesystem.normalize(
      expanded.startsWith("/")
        ? expanded
        : `${this.currentDirectory === "/" ? "" : this.currentDirectory}/${expanded}`,
    );
  }

  isKnownCommand(name: string): boolean {
    return knownCommands.has(name);
  }

  private dispatch(
    command: string,
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult {
    switch (command) {
      case "help":
        return success(
          [
            "Computer System BusyBox shell",
            "files: pwd cd ls cat mkdir touch rm cp mv find",
            "text: echo printf head tail wc grep sort uniq tr",
            "shell: sh bash source env export unset which type",
            "system: clear edit shutdown reboot exit true false",
            "syntax: |  >  >>  <  &&  ||  ;  '...'  \"...\"  $VAR  $?",
          ].join("\n") + "\n",
        );
      case "pwd":
        return arguments_.length === 0
          ? success(`${this.currentDirectory}\n`)
          : usage("pwd");
      case "cd":
        return this.changeDirectory(arguments_);
      case "ls":
        return this.list(arguments_);
      case "cat":
        return this.cat(arguments_, stdin);
      case "echo":
        return this.echo(arguments_);
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
      case "sh":
      case "bash":
      case "source":
        return failure(command, "internal dispatch is unavailable", 125);
      default:
        return {
          exitCode: 127,
          stderr: `bash: ${command}: command not found\n`,
          stdout: "",
        };
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
      if (!this.filesystem.exists(resolved)) {
        return failure("ls", `${path}: no such file or directory`);
      }
      const names = this.filesystem.isDirectory(resolved)
        ? this.filesystem
            .list(resolved)
            .filter((name) => all || !name.startsWith("."))
        : [baseName(resolved)];
      const prefix = paths.length > 1 ? `${path}:\n` : "";
      const listing = long
        ? names
            .map((name) => {
              const target = this.filesystem.isDirectory(resolved)
                ? joinPath(resolved, name)
                : resolved;
              const kind = this.filesystem.isDirectory(target)
                ? "dir "
                : "file";
              return `${kind} ${String(this.filesystem.getSize(target)).padStart(7)} ${name}`;
            })
            .join("\n")
        : names.join("  ");
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
      output +=
        path === "-" ? stdin : this.filesystem.readFile(this.resolvePath(path));
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
      const input =
        path === "-" ? stdin : this.filesystem.readFile(this.resolvePath(path));
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
      const input =
        path === "-" ? stdin : this.filesystem.readFile(this.resolvePath(path));
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
      const input =
        path === "-" ? stdin : this.filesystem.readFile(this.resolvePath(path));
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

  private environmentCommand(
    command: "env" | "export",
    arguments_: readonly string[],
  ): ShellCommandResult {
    for (const argument of arguments_) {
      if (!isAssignment(argument)) return usage(`${command} [NAME=value ...]`);
      const separator = argument.indexOf("=");
      this.environment.set(
        argument.slice(0, separator),
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
      this.environment.delete(name);
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
      if (!knownCommands.has(name))
        return status(1, "", `${name}: not found\n`);
      output.push(
        command === "type" ? `${name} is a shell builtin` : `/bin/${name}`,
      );
    }
    return success(`${output.join("\n")}\n`);
  }

  private readInputs(paths: readonly string[], stdin: string): string {
    if (paths.length === 0) return stdin;
    return paths
      .map((path) =>
        path === "-" ? stdin : this.filesystem.readFile(this.resolvePath(path)),
      )
      .join("");
  }
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
