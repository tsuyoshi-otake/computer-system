import type {
  PreparedShellLine,
  SessionCommandKind,
  ShellFrontend,
} from "./shellFrontend.js";
import {
  parseShellProgram,
  type ShellProgram,
  type ShellVariableResolver,
} from "./shellSyntax.js";

export class LinuxShellFrontend implements ShellFrontend {
  readonly id = "linux" as const;

  prepare(line: string): PreparedShellLine {
    return { kind: "source", source: line };
  }

  parse(source: string, resolveVariable: ShellVariableResolver): ShellProgram {
    return parseShellProgram(source, resolveVariable);
  }

  restore(value: string): string {
    return value;
  }

  resolveProgram(): undefined {
    return undefined;
  }

  sessionCommand(name: string): SessionCommandKind | undefined {
    if (
      name === "alias" ||
      name === "command" ||
      name === "getopts" ||
      name === "local" ||
      name === "read" ||
      name === "shift" ||
      name === "unalias"
    )
      return "linux-builtin";
    if (name === "history") return "linux-history";
    if (name === "make") return "linux-make";
    if (name === "python" || name === "micropython") return "linux-python";
    if (name === "sh" || name === "bash" || name === "source")
      return "linux-script";
    if (name === "time") return "linux-timer";
    if (name === "vi") return "vi";
    return undefined;
  }

  syntaxError(detail: string): string {
    return `bash: syntax error: ${detail}\n`;
  }

  commandError(command: string, error: unknown): string {
    return `${command}: ${errorMessage(error)}\n`;
  }

  pipelineLimitError(stderr: string): string {
    return `${stderr}bash: pipeline buffer limit exceeded\n`;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
