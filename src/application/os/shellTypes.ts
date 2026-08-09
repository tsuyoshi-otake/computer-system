import type { EditorScreen } from "../editor/editorScreen.js";
import type { Cs486Executable } from "../../domain/cpu/cs486.js";
import type { Cs486Object } from "../../domain/cpu/cs486Object.js";
import type { CpuProcess } from "../../domain/runtime/cpuProcess.js";
import type { ProcessCredentials } from "./linuxCredentials.js";
import type { GuestToolchainResult } from "../toolchain/guestToolchainTranscript.js";
import type { Cs486LinkInput } from "../toolchain/cs486Archive.js";
import type { Cs486DataModel } from "../../domain/cpu/cs486Compatibility.js";
import type { CsAbiStandardIo } from "../runtime/csAbi.js";
import type {
  LinuxPerlCommandPreparation,
  LinuxPerlExecutionInput,
  LinuxPerlIo,
} from "./linuxPerl.js";

interface ShellProcessContext {
  /** Immutable credentials captured when the shell admits the process. */
  readonly credentials: ProcessCredentials;
  /** Process umask captured with the credentials. */
  readonly umask: number;
  /** Linux nice value captured at admission (-20..19). */
  readonly niceValue?: number;
  /** Ignores terminal SIGHUP; shutdown remains the final owner. */
  readonly detached?: boolean;
}

export type ShellAction = "clear" | "reboot" | "shutdown";

export interface ShellForegroundPython extends ShellProcessContext {
  readonly command: "micropython" | "python";
  readonly kind: "python";
  readonly path: string;
  /** Returns true when stdout still targets the controlling terminal. */
  readonly routeOutput?: (descriptor: 1 | 2, text: string) => boolean;
  readonly stats: boolean;
}

/** One bounded Perl invocation compiled onto the production CS486 process. */
export interface ShellForegroundPerl extends ShellProcessContext {
  readonly command: "perl";
  readonly input: LinuxPerlExecutionInput;
  readonly io: LinuxPerlIo;
  readonly kind: "perl";
  readonly prepared: LinuxPerlCommandPreparation;
  readonly stats: boolean;
}

/** One terminal-owned persistent Python session on a single CS486 process. */
export interface ShellForegroundPythonRepl extends ShellProcessContext {
  readonly command: "micropython" | "python";
  readonly kind: "python-repl";
  /** Synthetic source origin used only for relative import resolution. */
  readonly path: string;
}

export interface ShellForegroundCs486 extends ShellProcessContext {
  /**
   * The guest declared with `run --batch` that this program uses no OS service.
   * Only the isolated CS ABI subset (`exit`, `heapInfo`, and `fsWrite` on fd 1
   * and fd 2) is serviced; anything else fails explicitly. Present only
   * alongside `hostedStartup`.
   */
  readonly batch?: true;
  readonly command: "basic" | "csasm" | "cscc" | "qbasic" | "run";
  readonly compileCycles: number;
  readonly executable: Cs486Executable;
  /** Immutable CS ABI startup data, present only for Linux foreground `run`. */
  readonly hostedStartup?: {
    readonly argv: readonly string[];
    readonly cwd: string;
    readonly environment: readonly (readonly [name: string, value: string])[];
  };
  readonly kind: "cs486";
  /** Redirected fd 0 contents; undefined preserves interactive terminal input. */
  readonly standardInput?: string;
  /** Live scheduler-owned fd 0/1/2 endpoints for a pipeline stage. */
  readonly standardIo?: CsAbiStandardIo;
  /** Returns true when this write still targets the terminal. */
  readonly routeOutput?: (descriptor: 1 | 2, text: string) => boolean;
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
  readonly command: "csdb" | "debug" | "watch";
  readonly complete: () => ShellCommandResult;
  readonly kind: "debugger";
  readonly start: () => CpuProcess;
}

/** One Linux foreground pipeline admitted as a scheduler-owned state machine. */
export interface ShellForegroundPipeline extends ShellProcessContext {
  readonly command: "pipeline";
  readonly complete: () => ShellCommandResult;
  readonly kind: "pipeline";
  readonly stageCommands: readonly string[];
  readonly stageExitCodes: () => readonly number[];
  readonly start: (startStage?: ShellPipelineStageStarter) => CpuProcess;
}

export interface ShellPipelineStageProcess {
  readonly finalize: () => void;
  readonly process: CpuProcess;
}

export type ShellPipelineStageStarter = (
  request: ShellForegroundCs486 | ShellForegroundPython,
) => ShellPipelineStageProcess;

export interface ShellMakeIoCompletion {
  readonly code?: string;
  readonly outcome: string;
}

export type ShellMakeStepResult =
  | { readonly kind: "continue" }
  | { readonly ioWaitEvent: string; readonly kind: "wait" }
  | {
      readonly kind: "complete";
      readonly result: ShellToolchainCommandResult;
    };

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
      /** Selects the bounded raw or optimized CSIR pipeline. */
      readonly cOptimizationLevel?: 0 | 1;
      /** Versioned C addressable-byte layout selected by the guest driver. */
      readonly cDataModel?: Cs486DataModel;
      /** Guest path installed atomically with a successful compiler output. */
      readonly dependencyOutputPath?: string;
      readonly dependencyTarget?: string;
      /** Ordered object/archive inputs linked before this translation unit. */
      readonly linkInputsBefore?: readonly Cs486LinkInput[];
      /** Ordered object/archive inputs linked after this translation unit. */
      readonly linkInputs?: readonly Cs486LinkInput[];
      readonly outputPath?: string;
      readonly compileOnly: boolean;
      readonly runAfterCompile: boolean;
    }
  | {
      /** One bounded guest recipe step. ComputerRuntime remains finalization owner. */
      readonly kind: "make";
      readonly step: (
        completion?: ShellMakeIoCompletion,
      ) => ShellMakeStepResult;
    }
  | {
      /**
       * Scheduler-owned CS-DOS WorkBench project operation. The closure is
       * bounded to guest-only ShellCommandRuntime state captured by its owning
       * session and must return one terminal result.
       */
      readonly execute: () => ShellToolchainCommandResult;
      readonly kind: "program-list";
    }
  | {
      readonly kind: "link";
      readonly objects: readonly Cs486Object[];
      readonly outputPath: string;
      readonly entry?: string;
    };

export interface ShellForegroundCompile extends ShellProcessContext {
  readonly command: "as" | "c" | "c++" | "ld" | "make" | "pwb" | "qbasic";
  readonly kind: "compile";
  readonly task: ShellCompileTask;
}

export type ShellForegroundRequest =
  | ShellForegroundCompile
  | ShellForegroundCs486
  | ShellForegroundDebugger
  | ShellForegroundPipeline
  | ShellForegroundPerl
  | ShellForegroundPython
  | ShellForegroundPythonRepl;

export interface ShellToolchainCommandResult extends GuestToolchainResult {
  readonly foreground?: ShellForegroundRequest;
}

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
  /**
   * A non-screen terminal key prompt owns input until it completes or cancels.
   * It is distinct from a full-screen editor/pager terminalScreen state.
   */
  readonly terminalInput?: boolean;
  readonly terminalScreen?: EditorScreen;
  readonly resetTerminal?: boolean;
  readonly cpuCycles?: number;
  readonly foreground?: ShellForegroundRequest;
  readonly ioWaitEvent?: string;
  readonly jobControl?: ShellJobControlRequest;
  /** Chronological writes before descriptor routing; absent on legacy producers. */
  readonly outputEvents?: readonly ShellOutputEvent[];
}

export interface ShellOutputEvent {
  readonly descriptor: 1 | 2;
  readonly text: string;
}

export type ShellCompletionCandidateKind =
  "command" | "device" | "directory" | "file";

export interface ShellCompletionCandidate {
  readonly displayText: string;
  readonly insertText: string;
  readonly kind: ShellCompletionCandidateKind;
}

export interface ShellCompletionResult {
  readonly candidates: readonly ShellCompletionCandidate[];
  readonly cursor: number;
  readonly replaceEnd: number;
  readonly replaceStart: number;
  readonly truncated: boolean;
  readonly value: string;
}

export type ShellTerminalCompletionOutcome = "applied" | "listed" | "none";

export interface ShellTerminalCompletionResponse {
  readonly cursor: number;
  readonly outcome: ShellTerminalCompletionOutcome;
  readonly truncated: boolean;
  readonly value: string;
}

export interface ShellTerminalCompletion {
  readonly lines: readonly string[];
  readonly response: ShellTerminalCompletionResponse;
}
