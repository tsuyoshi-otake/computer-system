import type { EditorScreen } from "../editor/editorScreen.js";
import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import type { Cs486Object } from "../../domain/cpu/cs486Object.js";
import type { CpuProcess } from "../../domain/runtime/cpuProcess.js";
import type { ProcessCredentials } from "./linuxCredentials.js";

interface ShellProcessContext {
  /** Immutable credentials captured when the shell admits the process. */
  readonly credentials: ProcessCredentials;
  /** Process umask captured with the credentials. */
  readonly umask: number;
}

export type ShellAction = "clear" | "reboot" | "shutdown";

export interface ShellForegroundPython extends ShellProcessContext {
  readonly command: "micropython" | "python";
  readonly kind: "python";
  readonly path: string;
  readonly stats: boolean;
}

export interface ShellForegroundCs486 extends ShellProcessContext {
  readonly command: "basic" | "csasm" | "cscc" | "qbasic" | "run";
  readonly compileCycles: number;
  readonly executable: Cs486Executable;
  readonly kind: "cs486";
  readonly stats: boolean;
}

/**
 * One debugger operation admitted by the shell but started by ComputerRuntime.
 *
 * Keeping process construction behind `start` means a rejected foreground
 * admission cannot accidentally leave the stateful debugger in an active
 * execution state. `complete` owns the one-time conversion of the debugger
 * outcome (including newly produced guest output) back into shell text.
 */
export interface ShellForegroundDebugger extends ShellProcessContext {
  readonly command: "csdb" | "debug";
  readonly complete: () => ShellCommandResult;
  readonly kind: "debugger";
  readonly start: () => CpuProcess;
}

export type ShellCompileTask =
  | {
      readonly kind: "source";
      readonly language: "asm" | "basic" | "c" | "cpp";
      readonly source: string;
      /** Canonical guest path used for diagnostics and relative includes. */
      readonly sourceName?: string;
      /** Selects only OS-facing assembler syntax; the object ABI stays shared. */
      readonly assemblerDialect?: "dos" | "linux";
      /** Process HOME captured when the compile request is admitted. */
      readonly assemblerHome?: string;
      /** Bounded command-line and profile definitions for C/C++ preprocessing. */
      readonly cDefinitions?: readonly {
        readonly name: string;
        readonly replacement?: string;
      }[];
      /** Canonical credentialed guest directories searched before system headers. */
      readonly cIncludePaths?: readonly string[];
      /** Bounded command-line names removed after built-in definitions. */
      readonly cUndefines?: readonly string[];
      readonly outputPath?: string;
      readonly compileOnly: boolean;
      readonly runAfterCompile: boolean;
    }
  | {
      /**
       * Scheduler-owned CS-DOS WorkBench project operation. The closure is
       * bounded to guest-only ShellCommandRuntime state captured by its owning
       * session and must return one terminal result.
       */
      readonly execute: () => ShellCommandResult;
      readonly kind: "program-list";
    }
  | {
      readonly kind: "link";
      readonly objects: readonly Cs486Object[];
      readonly outputPath: string;
      readonly entry?: string;
    };

export interface ShellForegroundCompile extends ShellProcessContext {
  readonly command: "as" | "c" | "c++" | "ld" | "pwb" | "qbasic";
  readonly kind: "compile";
  readonly task: ShellCompileTask;
}

export type ShellForegroundRequest =
  | ShellForegroundCompile
  | ShellForegroundCs486
  | ShellForegroundDebugger
  | ShellForegroundPython;

/**
 * A background task admitted by the interactive Linux shell.
 *
 * Only the deliberately bounded sleep, Python, and already-linked CS486 forms
 * cross this boundary. Compilation, debuggers, TUI programs, authentication,
 * pipelines, redirects, and lifecycle commands are rejected before execution.
 */
export type ShellBackgroundRequest =
  | (Omit<ShellForegroundCs486, "command"> & {
      readonly command: "run";
      readonly commandLine: string;
    })
  | (ShellForegroundPython & { readonly commandLine: string })
  | (ShellProcessContext & {
      readonly command: "sleep";
      readonly commandLine: string;
      readonly kind: "sleep";
      readonly sleepTicks: number;
    });

/** One shell wait/foreground operation over an already admitted job. */
export type ShellJobControlRequest =
  | {
      readonly jobId: number;
      readonly kind: "foreground";
    }
  | {
      readonly jobIds: readonly number[];
      readonly kind: "wait";
    };

export interface ShellCommandResult {
  readonly action?: ShellAction;
  readonly background?: ShellBackgroundRequest;
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  readonly sleepTicks?: number;
  readonly terminalScreen?: EditorScreen;
  readonly resetTerminal?: boolean;
  readonly cpuCycles?: number;
  readonly foreground?: ShellForegroundRequest;
  readonly ioWaitEvent?: string;
  readonly jobControl?: ShellJobControlRequest;
}

export interface ShellCompletionResult {
  readonly candidates: readonly string[];
  readonly cursor: number;
  readonly value: string;
}
