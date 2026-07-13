import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import {
  ShellCommandRuntime,
  type ShellAction,
  type ShellCommandResult,
} from "./shellCommands.js";
import {
  parseShellProgram,
  ShellSyntaxError,
  type ShellCommandNode,
  type ShellPipelineNode,
} from "./shellSyntax.js";

export interface ShellResult {
  readonly action?: ShellAction;
  readonly exitCode: number;
  readonly lines: readonly string[];
  readonly stderr: string;
  readonly stdout: string;
}

const maximumScriptDepth = 8;
const maximumScriptLines = 256;
const maximumPipelineBuffer = 256_000;
const variableMarkerStart = "\u{e000}";
const variableMarkerEnd = "\u{e001}";

export class ShellSession {
  private editor: { path: string; lines: string[] } | undefined;
  private readonly commands: ShellCommandRuntime;
  private lastExitCode = 0;

  constructor(private readonly filesystem: InMemoryFilesystem) {
    this.commands = new ShellCommandRuntime(filesystem);
  }

  prompt(): string {
    return this.editor === undefined ? "~$ " : `edit:${this.editor.path}> `;
  }

  submit(line: string): ShellResult {
    if (this.editor !== undefined) return this.submitEditor(line);
    return this.executeLine(line, 0);
  }

  private executeLine(line: string, depth: number): ShellResult {
    let program;
    try {
      program = parseShellProgram(
        line,
        (name) => `${variableMarkerStart}${name}${variableMarkerEnd}`,
      );
    } catch (error: unknown) {
      const detail =
        error instanceof ShellSyntaxError ? error.message : message(error);
      this.lastExitCode = 2;
      return resultFromStreams("", `bash: syntax error: ${detail}\n`, 2);
    }
    if (program.chains.length === 0) {
      this.lastExitCode = 0;
      return resultFromStreams("", "", 0);
    }

    let stdout = "";
    let stderr = "";
    let action: ShellAction | undefined;
    let exitCode = this.lastExitCode;
    for (const chain of program.chains) {
      const shouldRun =
        chain.operator === undefined ||
        chain.operator === ";" ||
        (chain.operator === "&&" && exitCode === 0) ||
        (chain.operator === "||" && exitCode !== 0);
      if (!shouldRun) continue;
      const executed = this.executePipeline(chain.pipeline, depth);
      stdout += executed.stdout;
      stderr += executed.stderr;
      exitCode = executed.exitCode;
      this.lastExitCode = exitCode;
      if (executed.action !== undefined) {
        action = executed.action;
        break;
      }
    }
    this.lastExitCode = exitCode;
    return resultFromStreams(stdout, stderr, exitCode, action);
  }

  private executePipeline(
    pipeline: ShellPipelineNode,
    depth: number,
  ): ShellCommandResult {
    let stdin = "";
    let stderr = "";
    let exitCode = 0;
    let action: ShellAction | undefined;
    for (const command of pipeline.commands) {
      const expanded = this.expandCommand(command);
      const inputRedirect = expanded.redirects.find(
        ({ mode }) => mode === "read",
      );
      if (inputRedirect !== undefined) {
        try {
          stdin = this.filesystem.readFile(
            this.commands.resolvePath(inputRedirect.path),
          );
        } catch (error: unknown) {
          return {
            exitCode: 1,
            stderr: `${expanded.words[0] ?? "bash"}: ${message(error)}\n`,
            stdout: "",
          };
        }
      }

      const executed = this.executeCommand(
        expanded,
        stdin,
        depth,
        pipeline.commands.length === 1,
      );
      stderr += executed.stderr;
      exitCode = executed.exitCode;
      action = executed.action;
      let stdout = executed.stdout;
      const outputRedirect = expanded.redirects.find(
        ({ mode }) => mode === "write" || mode === "append",
      );
      if (outputRedirect !== undefined) {
        try {
          const path = this.commands.resolvePath(outputRedirect.path);
          if (outputRedirect.mode === "append") {
            this.filesystem.appendFile(path, stdout);
          } else this.filesystem.writeFile(path, stdout);
          stdout = "";
        } catch (error: unknown) {
          stderr += `${expanded.words[0] ?? "bash"}: ${message(error)}\n`;
          exitCode = 1;
          stdout = "";
        }
      }
      stdin = stdout;
      if (stdin.length > maximumPipelineBuffer) {
        return {
          exitCode: 1,
          stderr: `${stderr}bash: pipeline buffer limit exceeded\n`,
          stdout: "",
        };
      }
      if (action !== undefined) break;
    }
    return {
      ...(action === undefined ? {} : { action }),
      exitCode,
      stderr,
      stdout: stdin,
    };
  }

  private expandCommand(command: ShellCommandNode): ShellCommandNode {
    const expand = (value: string): string =>
      value.replace(
        /\u{e000}([A-Za-z_][A-Za-z0-9_]*|\?)\u{e001}/gu,
        (_match, name: string) =>
          this.commands.resolveVariable(name, this.lastExitCode) ?? "",
      );
    return {
      words: command.words.map(expand),
      redirects: command.redirects.map((redirect) => ({
        ...redirect,
        path: expand(redirect.path),
      })),
    };
  }

  private executeCommand(
    command: ShellCommandNode,
    stdin: string,
    depth: number,
    interactiveAllowed: boolean,
  ): ShellCommandResult {
    const [name = "", ...arguments_] = command.words;
    if (name === "edit") {
      if (!interactiveAllowed || command.redirects.length > 0) {
        return commandFailure("edit", "cannot run in a pipeline or redirect");
      }
      return this.startEditor(arguments_);
    }
    if (name === "sh" || name === "bash" || name === "source") {
      return this.executeScript(name, arguments_, stdin, depth);
    }
    return this.commands.execute(command.words, stdin);
  }

  private executeScript(
    command: "bash" | "sh" | "source",
    arguments_: readonly string[],
    stdin: string,
    depth: number,
  ): ShellCommandResult {
    if (arguments_.length === 1 && arguments_[0] === "--version") {
      return commandSuccess(
        "Computer System bash 0.2 (BusyBox-compatible subset)\n",
      );
    }
    if (depth >= maximumScriptDepth) {
      return commandFailure(command, "maximum script depth exceeded");
    }
    let source: string;
    let label: string;
    if (arguments_[0] === "-c") {
      if (arguments_.length !== 2)
        return commandUsage(`${command} -c <command>`);
      source = arguments_[1]!;
      label = "-c";
    } else if (arguments_.length === 0 && command !== "source") {
      source = stdin;
      label = "stdin";
    } else if (arguments_.length === 1) {
      label = arguments_[0]!;
      try {
        source = this.filesystem.readFile(this.commands.resolvePath(label));
      } catch (error: unknown) {
        return commandFailure(command, message(error));
      }
    } else return commandUsage(`${command} [-c command | file]`);

    const lines = source.replaceAll("\r\n", "\n").split("\n");
    if (lines.length > maximumScriptLines) {
      return commandFailure(command, `${label}: script line limit exceeded`);
    }
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    let action: ShellAction | undefined;
    for (const line of lines) {
      const result = this.executeLine(line, depth + 1);
      stdout += result.stdout;
      stderr += result.stderr;
      exitCode = result.exitCode;
      if (result.action !== undefined) {
        action = result.action;
        break;
      }
      if (stdout.length > maximumPipelineBuffer) {
        return commandFailure(command, `${label}: output limit exceeded`);
      }
    }
    return {
      ...(action === undefined ? {} : { action }),
      exitCode,
      stderr,
      stdout,
    };
  }

  private startEditor(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 1) return commandUsage("edit <path>");
    const path = this.commands.resolvePath(arguments_[0]!);
    try {
      const existing = this.filesystem.exists(path)
        ? this.filesystem.readFile(path)
        : "";
      this.editor = {
        path,
        lines: existing.length === 0 ? [] : existing.split("\n"),
      };
      return commandSuccess(`Editing ${path}; enter .save when finished\n`);
    } catch (error: unknown) {
      return commandFailure("edit", message(error));
    }
  }

  private submitEditor(line: string): ShellResult {
    const editor = this.editor;
    if (editor === undefined) throw new Error("Editor state is unavailable");
    if (line === ".cancel") {
      this.editor = undefined;
      this.lastExitCode = 0;
      return resultFromStreams("Edit cancelled\n", "", 0);
    }
    if (line === ".clear") {
      editor.lines.length = 0;
      this.lastExitCode = 0;
      return resultFromStreams("Buffer cleared\n", "", 0);
    }
    if (line === ".save") {
      try {
        this.filesystem.writeFile(editor.path, editor.lines.join("\n"));
        this.editor = undefined;
        this.lastExitCode = 0;
        return resultFromStreams(`Saved ${editor.path}\n`, "", 0);
      } catch (error: unknown) {
        this.lastExitCode = 1;
        return resultFromStreams("", `${message(error)}\n`, 1);
      }
    }
    editor.lines.push(line);
    this.lastExitCode = 0;
    return resultFromStreams("", "", 0);
  }
}

function resultFromStreams(
  stdout: string,
  stderr: string,
  exitCode: number,
  action?: ShellAction,
): ShellResult {
  const normalized = `${stderr}${stdout}`.replaceAll("\r\n", "\n");
  const lines = normalized.length === 0 ? [] : normalized.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return {
    ...(action === undefined ? {} : { action }),
    exitCode,
    lines,
    stderr,
    stdout,
  };
}

function commandSuccess(stdout = ""): ShellCommandResult {
  return { exitCode: 0, stderr: "", stdout };
}

function commandFailure(command: string, detail: string): ShellCommandResult {
  return { exitCode: 1, stderr: `${command}: ${detail}\n`, stdout: "" };
}

function commandUsage(usage: string): ShellCommandResult {
  return { exitCode: 2, stderr: `Usage: ${usage}\n`, stdout: "" };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
