import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import type { ShellCommandRuntime } from "./shellCommands.js";
import type { ShellCommandResult } from "./shellTypes.js";
import type { ShellProgram, ShellVariableResolver } from "./shellSyntax.js";

export interface ShellLineContext {
  readonly arguments: readonly string[];
  readonly lastExitCode: number;
  readonly scriptName: string;
  readonly variablesExpanded?: boolean;
}

export type PreparedShellLine =
  | { readonly kind: "command-result"; readonly result: ShellCommandResult }
  | { readonly kind: "source"; readonly source: string };

export type SessionCommandKind =
  | "dos-editor"
  | "dos-history"
  | "dos-timer"
  | "linux-builtin"
  | "linux-history"
  | "linux-python"
  | "linux-script"
  | "linux-timer"
  | "vi";

export interface ShellFrontend {
  readonly id: ComputerOsProfile;
  commandError(command: string, error: unknown): string;
  parse(source: string, resolveVariable: ShellVariableResolver): ShellProgram;
  pipelineLimitError(stderr: string): string;
  prepare(
    line: string,
    commands: ShellCommandRuntime,
    context: ShellLineContext,
  ): PreparedShellLine;
  resolveProgram(
    name: string,
    commands: ShellCommandRuntime,
  ):
    | { readonly kind: "batch" | "executable"; readonly path: string }
    | undefined;
  restore(value: string): string;
  sessionCommand(name: string): SessionCommandKind | undefined;
  syntaxError(detail: string): string;
}
