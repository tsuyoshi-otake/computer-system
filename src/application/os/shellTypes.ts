import type { EditorScreen } from "../editor/editorScreen.js";
import type { Cs486Executable } from "../../domain/cpu/cs486.js";

export type ShellAction = "clear" | "reboot" | "shutdown";

export interface ShellForegroundPython {
  readonly command: "micropython" | "python";
  readonly kind: "python";
  readonly path: string;
  readonly stats: boolean;
}

export interface ShellForegroundCs486 {
  readonly command: "basic" | "run";
  readonly compileCycles: number;
  readonly executable: Cs486Executable;
  readonly kind: "cs486";
  readonly stats: boolean;
}

export type ShellForegroundRequest =
  ShellForegroundCs486 | ShellForegroundPython;

export interface ShellCommandResult {
  readonly action?: ShellAction;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly sleepTicks?: number;
  readonly terminalScreen?: EditorScreen;
  readonly resetTerminal?: boolean;
  readonly cpuCycles?: number;
  readonly foreground?: ShellForegroundRequest;
}

export interface ShellCompletionResult {
  readonly candidates: readonly string[];
  readonly cursor: number;
  readonly value: string;
}
