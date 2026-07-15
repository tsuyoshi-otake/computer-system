import { DosPathError } from "./osProfile.js";
import type { ShellCommandRuntime } from "./shellCommands.js";
import type {
  PreparedShellLine,
  SessionCommandKind,
  ShellFrontend,
  ShellLineContext,
} from "./shellFrontend.js";
import {
  dosShellSyntaxFeatures,
  parseShellProgram,
  type ShellProgram,
} from "./shellSyntax.js";

const dosBackslashMarker = "\u{e002}";

export class DosShellFrontend implements ShellFrontend {
  readonly id = "dos" as const;

  prepare(
    line: string,
    commands: ShellCommandRuntime,
    context: ShellLineContext,
  ): PreparedShellLine {
    const expanded = commands.expandDosVariables(
      line,
      context.scriptName,
      context.arguments,
      context.lastExitCode,
    );
    const control = commands.executeDosControlLine(expanded);
    if (control !== undefined)
      return { kind: "command-result", result: control };
    return {
      kind: "source",
      source: expanded
        .trimStart()
        .replace(/^@/u, "")
        .replaceAll("\\", dosBackslashMarker),
    };
  }

  parse(source: string): ShellProgram {
    return parseShellProgram(source, () => undefined, dosShellSyntaxFeatures);
  }

  restore(value: string): string {
    return value.replaceAll(dosBackslashMarker, "\\");
  }

  resolveProgram(
    name: string,
    commands: ShellCommandRuntime,
  ):
    | { readonly kind: "batch" | "executable"; readonly path: string }
    | undefined {
    return commands.resolveDosProgram(name);
  }

  sessionCommand(name: string): SessionCommandKind | undefined {
    if (name === "doskey") return "dos-history";
    if (name === "timer") return "dos-timer";
    if (name === "edit") return "dos-editor";
    if (name === "vi") return "vi";
    return undefined;
  }

  syntaxError(detail: string): string {
    return `Syntax error: ${detail}\r\n`;
  }

  commandError(_command: string, error: unknown): string {
    return error instanceof DosPathError
      ? "Invalid filename or extension.\r\n"
      : "The system cannot find the file specified.\r\n";
  }

  pipelineLimitError(stderr: string): string {
    return `${normalizeDosNewlines(stderr)}Pipeline buffer limit exceeded.\r\n`;
  }
}

function normalizeDosNewlines(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
}
