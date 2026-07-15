import type { EditorScreen } from "../editor/editorScreen.js";
import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import type { Cs486Object } from "../../domain/cpu/cs486Object.js";

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

export type ShellCompileTask =
  | {
      readonly kind: "source";
      readonly language: "asm" | "basic" | "c" | "cpp";
      readonly source: string;
      readonly outputPath?: string;
      readonly compileOnly: boolean;
      readonly runAfterCompile: boolean;
    }
  | {
      readonly kind: "link";
      readonly objects: readonly Cs486Object[];
      readonly outputPath: string;
      readonly entry?: string;
    };

export interface ShellForegroundCompile {
  readonly command: "as" | "basic" | "basicc" | "c" | "c++" | "ld";
  readonly kind: "compile";
  readonly task: ShellCompileTask;
}

export type ShellForegroundRequest =
  ShellForegroundCompile | ShellForegroundCs486 | ShellForegroundPython;

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
  readonly ioWaitEvent?: string;
}

export interface ShellCompletionResult {
  readonly candidates: readonly string[];
  readonly cursor: number;
  readonly value: string;
}
