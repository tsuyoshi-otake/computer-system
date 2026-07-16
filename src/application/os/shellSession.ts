import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import {
  ShellCommandRuntime,
  type ShellCommandRuntimeOptions,
  type ShellAction,
  type ShellBackgroundRequest,
  type ShellCommandResult,
  type ShellCompletionResult,
  type ShellForegroundRequest,
  type ShellJobControlRequest,
  type ShellRuntimeIdentityState,
} from "./shellCommands.js";
import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import {
  defaultComputerHardware,
  type ComputerHardwareProfile,
} from "../../domain/computer/hardware.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import { createVirtualShellClock, type ShellClockSource } from "./clock.js";
import { getOsProfile } from "./osProfile.js";
import type { VirtualDevice } from "./osProfile.js";
import type { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import {
  LinuxAuthentication,
  type LinuxAuthenticationAudit,
  validatePassword,
} from "./linuxAuthentication.js";
import {
  type LinuxAccountDatabase,
  type LinuxUserRecord,
  migrateLinuxAccountDatabase,
  sudoLinuxGroup,
} from "./linuxAccounts.js";
import {
  CredentialContext,
  createEffectiveCredentials,
  initialUserCredentials,
  initialUserId,
  isSuperuser,
  unauthenticatedCredentials,
  type ProcessCredentials,
} from "./linuxCredentials.js";
import { credentialedFilesystem } from "./credentialedFilesystem.js";
import {
  type GuestFilesystem,
  unrestrictedGuestFilesystem,
} from "./guestFilesystem.js";
import { DosEditSession } from "../editor/dosEditSession.js";
import type { EditorResult, EditorScreen } from "../editor/editorScreen.js";
import { ViSession, type ViResult } from "../editor/viSession.js";
import {
  parseShellProgram,
  ShellSyntaxError,
  type ShellCommandNode,
  type ShellPipelineNode,
} from "./shellSyntax.js";
import { shellFrontendFor } from "./createShellFrontend.js";
import type { ShellFrontend } from "./shellFrontend.js";
import { shellTerminalStateOf } from "./shellTerminalState.js";
import { OsRuntimeState, type OsProcessSignal } from "./osRuntimeState.js";
import { DosBatchEngine } from "./dosBatch.js";
import {
  DosDriveError,
  DosRuntimeStateError,
  type DosRuntimeState,
} from "./dosRuntimeState.js";

export interface ShellResult {
  readonly action?: ShellAction;
  readonly background?: ShellBackgroundRequest;
  readonly exitCode: number;
  readonly lines: readonly string[];
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

export interface ShellSessionOptions {
  readonly clock?: ShellClockSource;
  readonly computerId?: number;
  readonly computerName?: string;
  readonly currentTick?: () => number;
  readonly osProfile?: ComputerOsProfile;
  readonly ticksPerSecond?: number;
  readonly terminalHeight?: number;
  readonly terminalWidth?: number;
  readonly hardware?: ComputerHardwareProfile;
  readonly memoryUsageBytes?: () => number;
  readonly requireLogin?: boolean;
  readonly passwordSalt?: () => string;
  readonly virtualDevices?: ReadonlyMap<string, VirtualDevice>;
  readonly peripherals?: PeripheralBusBroker;
  readonly deferGuestExecution?: boolean;
  readonly requestFilesystemIo?: (
    operation: "read" | "write",
    bytes: number,
  ) => string | undefined;
  readonly syncFilesystem?: () => void;
  readonly osRuntime?: OsRuntimeState;
  readonly onOsRuntimeChanged?: (state: OsRuntimeState) => void;
  readonly signalProcess?: (pid: number, signal: OsProcessSignal) => void;
  readonly dosRuntime?: DosRuntimeState;
  readonly onDosRuntimeChanged?: (state: DosRuntimeState) => void;
}

const maximumScriptDepth = 8;
const maximumScriptLines = 256;
const maximumScriptLoopIterations = 1_024;
const maximumDosConfigLines = 64;
const maximumPipelineBuffer = 256_000;
const maximumBackgroundCommandBytes = 512;
const maximumAuthenticationFailures = 3;
const maximumIdentityAliases = 128;
const maximumIdentityFunctions = 128;
const maximumHistoryEntries = 100;
const maximumHistoryLineBytes = 512;
const maximumHistoryFileBytes = 32_768;
const sudoCredentialLifetimeSeconds = 5 * 60;
const variableMarkerStart = "\u{e000}";
const variableMarkerEnd = "\u{e001}";

interface ScriptFrame {
  arguments: string[];
  readonly name: string;
}

type ScriptFlow = "break" | "continue" | "normal" | "return";

interface ScriptExecution {
  readonly flow: ScriptFlow;
  readonly result: ShellCommandResult;
}

interface IdentityFrame {
  readonly aliases: ReadonlyMap<string, string>;
  readonly credentials: ProcessCredentials;
  readonly functions: ReadonlyMap<string, readonly string[]>;
  readonly history: readonly string[];
  readonly historyPath?: string;
  readonly shellState: ShellRuntimeIdentityState;
  readonly umask: number;
}

interface PendingSudo {
  readonly arguments: readonly string[];
  readonly depth: number;
  readonly foregroundAllowed: boolean;
  readonly interactiveAllowed: boolean;
  readonly login: boolean;
  readonly stdin: string;
  readonly target: string;
}

type LinuxConversation =
  | {
      readonly failures: number;
      readonly kind: "passwd-current";
      readonly target: string;
    }
  | { readonly kind: "passwd-new"; readonly target: string }
  | {
      readonly candidate: string;
      readonly kind: "passwd-confirm";
      readonly target: string;
    }
  | {
      readonly failures: number;
      readonly kind: "su-password";
      readonly login: boolean;
      readonly target: string;
    }
  | {
      readonly failures: number;
      readonly kind: "sudo-password";
      readonly pending: PendingSudo;
      readonly username: string;
    };

export class ShellSession {
  private readonly accounts: LinuxAccountDatabase | undefined;
  private readonly authentication: LinuxAuthentication | undefined;
  private readonly credentialContext: CredentialContext;
  private readonly guestFilesystem: GuestFilesystem;
  private editor: DosEditSession | undefined;
  private vi: ViSession | undefined;
  private readonly commands: ShellCommandRuntime;
  private readonly frontend: ShellFrontend;
  private readonly hardware: ComputerHardwareProfile;
  private readonly history: string[] = [];
  private historyPath: string | undefined;
  private lastExitCode = 0;
  private readonly scriptFrames: ScriptFrame[] = [];
  private readonly shellFunctions = new Map<string, readonly string[]>();
  private readonly shellAliases = new Map<string, string>();
  private readonly localScopes: Map<string, string | undefined>[] = [];
  private aliasDepth = 0;
  private scriptLoopIterations = 0;
  private readonly startupLines: string[] = [];
  private terminalHeight: number;
  private terminalWidth: number;
  private cpuCyclesValue = 0;
  private dosBatchDepth = 0;
  private suppressFilesystemWait = false;
  private debugSubmission = false;
  private scopedElevationDepth = 0;
  private linuxConversation: LinuxConversation | undefined;
  private readonly identityFrames: IdentityFrame[] = [];
  private readonly sudoCredentialExpiry = new Map<string, number>();
  private disconnected = false;
  private readonly osRuntime: OsRuntimeState | undefined;
  private readonly onOsRuntimeChanged:
    ((state: OsRuntimeState) => void) | undefined;
  private readonly signalProcess:
    ((pid: number, signal: OsProcessSignal) => void) | undefined;
  private readonly loginSessionId = "tty1";
  private shellProcessId: number | undefined;

  constructor(
    private readonly filesystem: InMemoryFilesystem,
    options: ShellSessionOptions = {},
  ) {
    this.terminalWidth = options.terminalWidth ?? 51;
    this.terminalHeight = options.terminalHeight ?? 19;
    const profile = getOsProfile(options.osProfile ?? "linux");
    this.frontend = shellFrontendFor(profile.id);
    const currentTick = options.currentTick ?? ((): number => 0);
    const ticksPerSecond = options.ticksPerSecond ?? 20;
    this.onOsRuntimeChanged = options.onOsRuntimeChanged;
    this.signalProcess = options.signalProcess;
    this.osRuntime =
      profile.id === "linux"
        ? (options.osRuntime ??
          new OsRuntimeState(options.computerName ?? "c-000000"))
        : undefined;
    const rollbackLegacyHome =
      profile.id === "linux" &&
      filesystem.exists("/home/computer") &&
      !filesystem.exists("/home/cs");
    const restoreLegacyHome = (failure: unknown): never => {
      if (
        rollbackLegacyHome &&
        !filesystem.exists("/home/computer") &&
        filesystem.exists("/home/cs")
      ) {
        try {
          filesystem.move("/home/cs", "/home/computer");
        } catch (rollbackFailure: unknown) {
          throw new Error(
            `CS-Linux home migration failed: ${message(failure)}; rollback failed: ${message(rollbackFailure)}`,
          );
        }
      }
      throw failure;
    };
    try {
      profile.boot(filesystem, {
        computerName: options.computerName ?? "c-000000",
      });
    } catch (error: unknown) {
      restoreLegacyHome(error);
    }
    if (profile.id === "linux") {
      let accounts: LinuxAccountDatabase | undefined;
      try {
        accounts = migrateLinuxAccountDatabase(filesystem);
      } catch (error: unknown) {
        restoreLegacyHome(error);
      }
      if (accounts === undefined)
        throw new Error("CS-Linux account migration did not terminate");
      this.accounts = accounts;
      this.authentication = new LinuxAuthentication(accounts, {
        enabled: options.requireLogin === true,
        salt: options.passwordSalt,
      });
      this.credentialContext = new CredentialContext(
        this.authentication.credentials ?? unauthenticatedCredentials,
      );
      this.guestFilesystem = credentialedFilesystem(
        filesystem,
        () => this.credentialContext.current,
      );
    } else {
      this.accounts = undefined;
      this.authentication = undefined;
      this.credentialContext = new CredentialContext(initialUserCredentials);
      this.guestFilesystem = unrestrictedGuestFilesystem(filesystem);
    }
    if (this.osRuntime !== undefined) {
      ensureLinuxRuntimePresence(
        this.osRuntime,
        currentTick(),
        options.hardware ?? defaultComputerHardware,
      );
      this.notifyOsRuntimeChanged();
    }
    const runtimeOptions: ShellCommandRuntimeOptions = {
      accounts: this.accounts,
      clock:
        options.clock ?? createVirtualShellClock(currentTick, ticksPerSecond),
      computerId: options.computerId ?? 0,
      computerName: options.computerName ?? "c-000000",
      currentTick,
      credentials: () => this.credentialContext.current,
      profile,
      ticksPerSecond,
      hardware: options.hardware ?? defaultComputerHardware,
      memoryUsageBytes: options.memoryUsageBytes ?? ((): number => 0),
      virtualDevices: options.virtualDevices,
      peripherals: options.peripherals,
      deferGuestExecution: options.deferGuestExecution,
      requestFilesystemIo: options.requestFilesystemIo,
      syncFilesystem: options.syncFilesystem,
      osRuntime: this.osRuntime,
      sessionId: () =>
        this.osRuntime?.loginSession(this.loginSessionId) === undefined
          ? undefined
          : this.loginSessionId,
      selfPid: () => this.shellProcessId,
      signalProcess: options.signalProcess,
      dosRuntime: options.dosRuntime,
      onDosRuntimeChanged: options.onDosRuntimeChanged,
    };
    this.hardware = runtimeOptions.hardware;
    this.commands = new ShellCommandRuntime(
      this.guestFilesystem,
      runtimeOptions,
    );
    if (profile.id === "linux") {
      if (this.authentication?.isAuthenticated() === true)
        this.activateAuthenticatedSession(this.startupLines);
    } else {
      for (const loaded of [
        this.loadDosConfiguration("C:\\CONFIG.SYS"),
        this.executeDosBatch("C:\\AUTOEXEC.BAT", [], 0),
      ]) {
        const text = `${loaded.stderr}${loaded.stdout}`.trimEnd();
        if (text.length > 0) this.startupLines.push(...text.split(/\r?\n/u));
      }
    }
    this.startupLines.push(...(this.authentication?.startupLines() ?? []));
  }

  prompt(): string {
    if (this.vi !== undefined || this.editor !== undefined) return "";
    const conversationPrompt = this.linuxConversationPrompt();
    if (conversationPrompt !== undefined) return conversationPrompt;
    const authenticationPrompt = this.authentication?.prompt();
    if (authenticationPrompt !== undefined) return authenticationPrompt;
    return this.commands.prompt();
  }

  isSecretInput(): boolean {
    return (
      this.linuxConversation !== undefined ||
      (this.authentication?.isSecretInput() ?? false)
    );
  }

  isAuthenticated(): boolean {
    return this.authentication?.isAuthenticated() ?? true;
  }

  executionContext(): {
    readonly credentials: ProcessCredentials;
    readonly umask: number;
  } {
    return Object.freeze({
      credentials: this.credentialContext.current,
      umask: this.guestFilesystem.getUmask(),
    });
  }

  /** Live login-shell PID used as PPID for admitted guest work. */
  processId(): number | undefined {
    return this.shellProcessId;
  }

  disconnect(): readonly string[] {
    if (this.disconnected) return [];
    this.disconnected = true;
    this.vi = undefined;
    this.editor = undefined;
    this.commands.closeDebugger();
    return this.logoutAuthenticatedSession("disconnect");
  }

  writeCompilerOutput(path: string, contents: string): void {
    this.commands.writeFile(path, contents);
  }

  takeStartupLines(): readonly string[] {
    return this.startupLines.splice(0);
  }

  private activateAuthenticatedSession(
    output: string[],
    errors?: string[],
  ): void {
    const credentials = this.authentication?.credentials;
    const accounts = this.accounts;
    if (credentials === undefined || accounts === undefined) {
      throw new Error("CS-Linux authenticated session is unavailable");
    }
    const user = accounts.getUser(credentials.loginName);
    if (user === undefined) {
      throw new Error(`CS-Linux account disappeared: ${credentials.loginName}`);
    }
    this.credentialContext.replace(credentials);
    const homeWarning = this.commands.activateUser(user);
    if (homeWarning !== undefined) (errors ?? output).push(homeWarning);
    const runtimeSession = this.openRuntimeLoginSession(user);
    if (runtimeSession !== undefined) output.push(runtimeSession);
    const motd = this.readMotd();
    if (motd !== undefined) output.push(...motd);
    const historyWarning = this.loadHistory(user);
    if (historyWarning !== undefined) (errors ?? output).push(historyWarning);
    const loaded = this.loadLinuxLoginScripts(user);
    const stdout = loaded.stdout.trimEnd();
    if (stdout.length > 0) output.push(...stdout.split("\n"));
    const stderr = loaded.stderr.trimEnd();
    if (stderr.length > 0) (errors ?? output).push(...stderr.split("\n"));
  }

  submit(line: string): ShellResult {
    this.disconnected = false;
    this.cpuCyclesValue = 0;
    this.commands.beginFilesystemIo();
    let result: ShellResult;
    if (this.vi !== undefined) result = this.submitViLine(line);
    else if (this.editor !== undefined) result = this.submitEditor(line);
    else if (this.linuxConversation !== undefined)
      result = this.submitLinuxConversation(line);
    else if (this.authentication?.isAuthenticated() === false) {
      const wasAuthenticated = this.authentication.isAuthenticated();
      const authentication = this.authentication.submit(line);
      if (authentication.audit !== undefined)
        this.recordAuthenticationAudit(authentication.audit);
      result = resultFromStreams(
        authentication.stdout,
        authentication.stderr,
        authentication.exitCode,
        undefined,
        authentication.sleepTicks,
      );
      if (!wasAuthenticated && this.authentication.isAuthenticated()) {
        const loaded: string[] = [];
        const activationErrors: string[] = [];
        this.activateAuthenticatedSession(loaded, activationErrors);
        if (loaded.length > 0 || activationErrors.length > 0) {
          result = resultFromStreams(
            `${result.stdout}${loaded.length === 0 ? "" : `${loaded.join("\n")}\n`}`,
            `${result.stderr}${activationErrors.length === 0 ? "" : `${activationErrors.join("\n")}\n`}`,
            result.exitCode,
            result.action,
            result.sleepTicks,
          );
        }
      }
    } else {
      this.touchRuntimeLoginSession();
      if (line.trim().length > 0) {
        this.history.push(limitHistoryLine(line));
        if (this.history.length > maximumHistoryEntries) this.history.shift();
      }
      result = this.executeLine(line, 0);
      const historyWarning = this.saveHistory();
      if (historyWarning !== undefined) {
        result = {
          ...result,
          lines: [...result.lines, historyWarning],
          stderr: `${result.stderr}${historyWarning}\n`,
        };
      }
    }
    const ioWaitEvent = this.commands.completeFilesystemIo(
      !this.suppressFilesystemWait,
    );
    if (
      ioWaitEvent !== undefined &&
      result.foreground === undefined &&
      result.action === undefined
    ) {
      result = {
        ...result,
        ioWaitEvent,
      };
    }
    this.notifyOsRuntimeChanged();
    return this.withCpuCycles(result);
  }

  submitDebugCommand(line: string): ShellResult {
    this.disconnected = false;
    if (!this.isAuthenticated()) {
      return resultFromStreams(
        "",
        "debug: CS-Linux login is required before MCP command execution\n",
        2,
      );
    }
    if (
      /^\s*(?:micropython|python)(?:\s|$)/u.test(line) &&
      !cpuModelSpecification(this.hardware.cpuModel).supportsMicroPython
    ) {
      return resultFromStreams(
        "",
        `MicroPython is not available on ${cpuModelSpecification(this.hardware.cpuModel).runtimeName}\n`,
        127,
      );
    }
    if (this.vi !== undefined || this.editor !== undefined) {
      return resultFromStreams(
        "",
        "debug: interactive editor session is active\n",
        2,
      );
    }
    if (this.linuxConversation !== undefined) {
      return resultFromStreams(
        "",
        "debug: interactive authentication is active\n",
        2,
      );
    }
    this.suppressFilesystemWait = true;
    this.debugSubmission = true;
    let result: ShellResult;
    try {
      result = this.submit(line);
    } finally {
      this.debugSubmission = false;
      this.suppressFilesystemWait = false;
    }
    if (this.vi !== undefined || this.editor !== undefined) {
      this.vi = undefined;
      this.editor = undefined;
      return resultFromStreams(
        "",
        "debug: TUI commands are not supported through MCP\n",
        2,
      );
    }
    if (this.linuxConversation !== undefined) {
      this.linuxConversation = undefined;
      return resultFromStreams(
        "",
        "debug: interactive authentication commands are not supported through MCP\n",
        2,
      );
    }
    if (
      result.action !== undefined ||
      result.background !== undefined ||
      result.ioWaitEvent !== undefined ||
      result.jobControl !== undefined ||
      result.sleepTicks !== undefined ||
      result.terminalScreen !== undefined
    ) {
      return resultFromStreams(
        "",
        "debug: asynchronous and terminal-control commands are not supported through MCP\n",
        2,
      );
    }
    return result;
  }

  admitDebugInlinePython(command: "micropython" | "python"): ShellResult {
    this.disconnected = false;
    if (!this.isAuthenticated())
      return resultFromStreams(
        "",
        "debug: CS-Linux login is required before MCP command execution\n",
        2,
      );
    if (this.vi !== undefined || this.editor !== undefined)
      return resultFromStreams(
        "",
        "debug: interactive editor session is active\n",
        2,
      );
    if (this.linuxConversation !== undefined)
      return resultFromStreams(
        "",
        "debug: interactive authentication is active\n",
        2,
      );
    const cpu = cpuModelSpecification(this.hardware.cpuModel);
    if (!cpu.supportsMicroPython)
      return shellResultFromCommand(
        commandFailure(
          command,
          `MicroPython is not available on ${cpu.runtimeName}`,
          127,
        ),
      );
    if (!this.commands.isBuiltInCommand(command))
      return shellResultFromCommand(
        commandFailure(command, "command not found", 127),
      );
    return shellResultFromCommand({
      exitCode: 0,
      foreground: {
        command,
        credentials: this.credentialContext.current,
        kind: "python",
        path: "/tmp/__mcp_inline__.py",
        stats: false,
        umask: this.guestFilesystem.getUmask(),
      },
      stderr: "",
      stdout: "",
    });
  }

  completeForegroundProcess(exitCode: number): void {
    this.lastExitCode = exitCode;
  }

  complete(line: string, cursor: number): ShellCompletionResult {
    if (
      !this.isAuthenticated() ||
      this.linuxConversation !== undefined ||
      this.vi !== undefined ||
      this.editor !== undefined
    ) {
      return { candidates: [], cursor, value: line };
    }
    return this.commands.complete(line, cursor);
  }

  resize(width: number, height: number): EditorScreen | undefined {
    this.terminalWidth = width;
    this.terminalHeight = height;
    return this.editor?.resize(width, height) ?? this.vi?.resize(width, height);
  }

  keys(keys: readonly string[]): ShellResult {
    this.disconnected = false;
    this.cpuCyclesValue = keys.length;
    if (!this.isAuthenticated())
      return this.withCpuCycles(resultFromStreams("", "", 0));
    if (this.vi === undefined && this.editor === undefined)
      return this.withCpuCycles(resultFromStreams("", "", 0));
    if (keys.length > 32) {
      return this.withCpuCycles(
        resultFromStreams("", "editor: key batch limit exceeded\n", 2),
      );
    }
    let result: ShellResult =
      this.editor === undefined
        ? this.viResult({ kind: "continue", screen: this.vi!.screen() })
        : this.editorResult({
            kind: "continue",
            screen: this.editor.screen(),
          });
    for (const key of keys) {
      if (this.editor !== undefined)
        result = this.editorResult(this.editor.key(key));
      else if (this.vi !== undefined) result = this.viResult(this.vi.key(key));
      else break;
    }
    return this.withCpuCycles(result);
  }

  private withCpuCycles(result: ShellResult): ShellResult {
    shellTerminalStateOf(result);
    const outputBytes = utf8ByteLength(`${result.stdout}${result.stderr}`);
    return {
      ...result,
      cpuCycles: Math.max(
        1,
        Math.min(1_000_000, this.cpuCyclesValue + Math.ceil(outputBytes / 16)),
      ),
    };
  }

  private executeLine(
    line: string,
    depth: number,
    variablesExpanded = false,
  ): ShellResult {
    const frame = this.scriptFrames.at(-1);
    const prepared = this.frontend.prepare(line, this.commands, {
      arguments: frame?.arguments ?? [],
      lastExitCode: this.lastExitCode,
      scriptName: frame?.name ?? "",
      variablesExpanded,
    });
    if (prepared.kind === "command-result") {
      this.cpuCyclesValue += 4;
      this.lastExitCode = prepared.result.exitCode;
      return resultFromStreams(
        prepared.result.stdout,
        prepared.result.stderr,
        prepared.result.exitCode,
        prepared.result.action,
        prepared.result.sleepTicks,
      );
    }
    let program;
    try {
      program = this.frontend.parse(
        prepared.source,
        (name) => `${variableMarkerStart}${name}${variableMarkerEnd}`,
      );
    } catch (error: unknown) {
      const detail =
        error instanceof ShellSyntaxError ? error.message : message(error);
      this.lastExitCode = 2;
      return resultFromStreams("", this.frontend.syntaxError(detail), 2);
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
      const executed = this.executePipeline(
        chain.pipeline,
        depth,
        program.chains.length === 1,
      );
      stdout += executed.stdout;
      stderr += executed.stderr;
      exitCode = executed.exitCode;
      this.lastExitCode = exitCode;
      if (executed.foreground !== undefined) {
        return {
          ...resultFromStreams(stdout, stderr, exitCode, action),
          foreground: executed.foreground,
        };
      }
      if (executed.background !== undefined) {
        return {
          ...resultFromStreams(stdout, stderr, exitCode, action),
          background: executed.background,
        };
      }
      if (executed.jobControl !== undefined) {
        return {
          ...resultFromStreams(stdout, stderr, exitCode, action),
          jobControl: executed.jobControl,
        };
      }
      if (executed.terminalScreen !== undefined || executed.resetTerminal) {
        return {
          ...resultFromStreams(stdout, stderr, exitCode, action),
          ...(executed.terminalScreen === undefined
            ? {}
            : { terminalScreen: executed.terminalScreen }),
          ...(executed.resetTerminal ? { resetTerminal: true } : {}),
        };
      }
      if (executed.sleepTicks !== undefined) {
        return resultFromStreams(
          stdout,
          stderr,
          exitCode,
          action,
          executed.sleepTicks,
        );
      }
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
    foregroundAllowed: boolean,
  ): ShellCommandResult {
    if (pipeline.background === true) {
      return this.executeBackgroundPipeline(pipeline, depth, foregroundAllowed);
    }
    let stdin = "";
    let stderr = "";
    let exitCode = 0;
    let action: ShellAction | undefined;
    let sleepTicks: number | undefined;
    let terminalScreen: EditorScreen | undefined;
    let resetTerminal = false;
    let foreground: ShellForegroundRequest | undefined;
    let jobControl: ShellJobControlRequest | undefined;
    for (const command of pipeline.commands) {
      const expanded = this.expandCommand(command);
      const inputRedirect = expanded.redirects.find(
        ({ mode }) => mode === "read",
      );
      if (inputRedirect !== undefined) {
        try {
          stdin = this.commands.readFile(inputRedirect.path);
        } catch (error: unknown) {
          return {
            exitCode: 1,
            stderr: this.commandError(expanded.words[0] ?? "shell", error),
            stdout: "",
          };
        }
      }

      let executed: ShellCommandResult;
      try {
        executed = this.executeCommand(
          expanded,
          stdin,
          depth,
          pipeline.commands.length === 1,
          foregroundAllowed,
        );
      } catch (error: unknown) {
        return {
          exitCode: 1,
          stderr: this.commandError(expanded.words[0] ?? "shell", error),
          stdout: "",
        };
      }
      stderr += executed.stderr;
      exitCode = executed.exitCode;
      action = executed.action;
      sleepTicks = executed.sleepTicks;
      terminalScreen = executed.terminalScreen;
      resetTerminal = executed.resetTerminal ?? false;
      foreground = executed.foreground;
      jobControl = executed.jobControl;
      if (jobControl !== undefined && pipeline.commands.length > 1) {
        return commandFailure(
          expanded.words[0] ?? "shell",
          "job control cannot run in a pipeline",
          2,
        );
      }
      if (sleepTicks !== undefined && pipeline.commands.length > 1) {
        return commandFailure("sleep", "cannot run in a pipeline");
      }
      let stdout = executed.stdout;
      const outputRedirect = expanded.redirects.find(
        ({ mode }) => mode === "write" || mode === "append",
      );
      if (outputRedirect !== undefined) {
        try {
          this.commands.writeFile(
            outputRedirect.path,
            stdout,
            outputRedirect.mode === "append",
          );
          stdout = "";
        } catch (error: unknown) {
          stderr += this.commandError(expanded.words[0] ?? "shell", error);
          exitCode = 1;
          stdout = "";
        }
      }
      stdin = stdout;
      if (stdin.length > maximumPipelineBuffer) {
        return {
          exitCode: 1,
          stderr: this.frontend.pipelineLimitError(stderr),
          stdout: "",
        };
      }
      if (action !== undefined) break;
      if (sleepTicks !== undefined) break;
      if (foreground !== undefined) break;
      if (jobControl !== undefined) break;
    }
    return {
      ...(action === undefined ? {} : { action }),
      exitCode,
      stderr,
      stdout: stdin,
      ...(sleepTicks === undefined ? {} : { sleepTicks }),
      ...(terminalScreen === undefined ? {} : { terminalScreen }),
      ...(resetTerminal ? { resetTerminal: true } : {}),
      ...(foreground === undefined ? {} : { foreground }),
      ...(jobControl === undefined ? {} : { jobControl }),
    };
  }

  private executeBackgroundPipeline(
    pipeline: ShellPipelineNode,
    depth: number,
    foregroundAllowed: boolean,
  ): ShellCommandResult {
    if (
      this.debugSubmission ||
      depth !== 0 ||
      !foregroundAllowed ||
      pipeline.commands.length !== 1
    ) {
      return commandFailure(
        "shell",
        "background jobs are supported only as one interactive command",
        2,
      );
    }
    const expanded = this.expandCommand(pipeline.commands[0]!);
    if (expanded.redirects.length !== 0) {
      return commandFailure(
        "shell",
        "background redirects are not supported",
        2,
      );
    }
    const [requestedName = ""] = expanded.words;
    if (
      this.shellAliases.has(requestedName) ||
      this.shellFunctions.has(requestedName)
    ) {
      return commandFailure(
        requestedName || "shell",
        "aliases and functions cannot be background jobs",
        2,
      );
    }
    const name = this.commands.canonicalCommand(requestedName);
    if (!["micropython", "python", "run", "sleep"].includes(name)) {
      return commandFailure(
        requestedName || "shell",
        "this command is not supported as a background job",
        2,
      );
    }
    const commandLine = expanded.words.join(" ");
    if (utf8ByteLength(commandLine) > maximumBackgroundCommandBytes) {
      return commandFailure(
        requestedName || "shell",
        `background command exceeds ${String(maximumBackgroundCommandBytes)} bytes`,
        2,
      );
    }
    let executed: ShellCommandResult;
    try {
      executed = this.executeCommand(expanded, "", depth, true, true);
    } catch (error: unknown) {
      return commandFailure(requestedName || "shell", message(error));
    }
    if (executed.exitCode !== 0) return executed;
    if (executed.sleepTicks !== undefined) {
      return {
        exitCode: 0,
        stderr: executed.stderr,
        stdout: executed.stdout,
        background: {
          command: "sleep",
          commandLine,
          credentials: this.credentialContext.current,
          kind: "sleep",
          sleepTicks: executed.sleepTicks,
          umask: this.guestFilesystem.getUmask(),
        },
      };
    }
    if (
      executed.foreground?.kind === "python" ||
      executed.foreground?.kind === "cs486"
    ) {
      return {
        exitCode: 0,
        stderr: executed.stderr,
        stdout: executed.stdout,
        background: { ...executed.foreground, commandLine },
      };
    }
    return commandFailure(
      requestedName || "shell",
      "command did not produce a bounded background task",
      2,
    );
  }

  private commandError(command: string, error: unknown): string {
    if (error instanceof DosRuntimeStateError) return `${error.message}\r\n`;
    if (error instanceof DosDriveError) {
      if (error.code === "read_only")
        return `Write protect error writing drive ${error.drive}\r\n`;
      if (error.code === "no_media")
        return `Not ready writing drive ${error.drive}\r\n`;
      if (error.code === "media_changed")
        return `Disk change error on drive ${error.drive}\r\n`;
    }
    if (error instanceof Error && error.message === "Access is denied.")
      return "Access is denied.\r\n";
    return this.frontend.commandError(command, error);
  }

  private expandCommand(command: ShellCommandNode): ShellCommandNode {
    const expand = (value: string): string => {
      const expanded = value.replace(
        /\u{e000}([A-Za-z_][A-Za-z0-9_]*|[?#@*]|[0-9]+)\u{e001}/gu,
        (_match, name: string) => this.resolveVariable(name),
      );
      return this.frontend.restore(expanded);
    };
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
    foregroundAllowed: boolean,
  ): ShellCommandResult {
    this.cpuCyclesValue += 8;
    const [requestedName = "", ...arguments_] = command.words;
    const name = this.commands.canonicalCommand(requestedName);
    const alias = this.shellAliases.get(requestedName);
    if (alias !== undefined) {
      if (this.aliasDepth >= maximumScriptDepth)
        return commandFailure(
          "alias",
          "maximum alias expansion depth exceeded",
        );
      const words = [...alias.trim().split(/\s+/u), ...arguments_];
      this.aliasDepth += 1;
      try {
        return this.executeCommand(
          { words, redirects: command.redirects },
          stdin,
          depth,
          interactiveAllowed,
          foregroundAllowed,
        );
      } finally {
        this.aliasDepth -= 1;
      }
    }
    const functionBody = this.shellFunctions.get(name);
    if (functionBody !== undefined) {
      if (depth >= maximumScriptDepth)
        return commandFailure(name, "maximum function depth exceeded");
      if (this.scriptFrames.length === 0) this.scriptLoopIterations = 0;
      this.scriptFrames.push({ arguments: [...arguments_], name });
      this.localScopes.push(new Map());
      try {
        return this.executeScriptLines(functionBody, depth + 1, name).result;
      } finally {
        this.restoreLocalScope(this.localScopes.pop()!);
        this.scriptFrames.pop();
      }
    }
    if (
      this.frontend.id === "linux" &&
      this.commands.isBuiltInCommand(requestedName)
    ) {
      const identityCommand = this.executeLinuxIdentityCommand(
        name,
        arguments_,
        stdin,
        depth,
        interactiveAllowed,
        foregroundAllowed,
        command.redirects.length > 0,
      );
      if (identityCommand !== undefined) return identityCommand;
    }
    const sessionCommand = this.frontend.sessionCommand(name);
    if (
      sessionCommand !== undefined &&
      !this.commands.isBuiltInCommand(requestedName)
    ) {
      return this.commands.execute(command.words, stdin);
    }
    if (sessionCommand === "linux-python") {
      if (
        depth !== 0 ||
        !interactiveAllowed ||
        !foregroundAllowed ||
        command.redirects.length > 0
      ) {
        return commandFailure(
          name,
          "cannot run in a pipeline, redirect, script, or command chain",
          2,
        );
      }
      if (!cpuModelSpecification(this.hardware.cpuModel).supportsMicroPython) {
        return commandFailure(
          name,
          `MicroPython is not available on ${cpuModelSpecification(this.hardware.cpuModel).runtimeName}`,
          127,
        );
      }
      const stats = arguments_[0] === "--stats";
      const pathArgument = stats ? arguments_[1] : arguments_[0];
      if (pathArgument === undefined || arguments_.length !== (stats ? 2 : 1)) {
        return commandUsage(`${name} [--stats] <file>`);
      }
      this.commands.readFile(pathArgument);
      return {
        exitCode: 0,
        foreground: {
          command: name === "micropython" ? "micropython" : "python",
          credentials: this.credentialContext.current,
          kind: "python",
          path: this.commands.resolvePath(pathArgument),
          stats,
          umask: this.guestFilesystem.getUmask(),
        },
        stderr: "",
        stdout: "",
      };
    }
    if (!this.commands.isBuiltInCommand(requestedName)) {
      const program = this.frontend.resolveProgram(
        requestedName,
        this.commands,
      );
      if (program?.kind === "batch")
        return this.executeDosBatch(program.path, arguments_, depth);
      if (program?.kind === "executable")
        return this.commands.execute([program.path, ...arguments_], stdin);
      return this.commands.execute(command.words, stdin);
    }
    if (sessionCommand === "linux-builtin") {
      const shellBuiltin = this.executeLinuxShellBuiltin(
        name,
        arguments_,
        stdin,
      );
      if (shellBuiltin !== undefined) return shellBuiltin;
    }
    if (sessionCommand === "linux-history") {
      if (arguments_.length > 0) return commandUsage("history");
      return commandSuccess(
        `${this.history.map((value, index) => `${String(index + 1).padStart(5)}  ${value}`).join("\n")}\n`,
      );
    }
    if (sessionCommand === "dos-history") {
      if (arguments_.length === 0) {
        return commandSuccess("DOSKey installed. Use DOSKEY /HISTORY.\r\n");
      }
      if (
        arguments_.length !== 1 ||
        arguments_[0]?.toUpperCase() !== "/HISTORY"
      ) {
        return {
          exitCode: 2,
          stderr: "Invalid switch. Use DOSKEY /HISTORY.\r\n",
          stdout: "",
        };
      }
      return commandSuccess(`${this.history.join("\r\n")}\r\n`);
    }
    if (sessionCommand === "linux-timer" || sessionCommand === "dos-timer") {
      if (arguments_.length === 0) return commandUsage(`${name} <command ...>`);
      const startedAt = this.commands.currentTick();
      const timed = this.executeCommand(
        { words: arguments_, redirects: [] },
        stdin,
        depth,
        false,
        false,
      );
      const elapsed =
        (this.commands.currentTick() - startedAt) /
        this.commands.ticksPerSecond();
      return {
        ...timed,
        stderr:
          sessionCommand === "dos-timer"
            ? `${timed.stderr.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n")}Elapsed time: ${elapsed.toFixed(3)} seconds\r\n`
            : `${timed.stderr}real ${elapsed.toFixed(3)}s\n`,
      };
    }
    if (sessionCommand === "vi") {
      if (this.scopedElevationDepth > 0) {
        return commandFailure(
          "sudo",
          "interactive editors require a nested sudo -i shell",
          2,
        );
      }
      if (!interactiveAllowed || command.redirects.length > 0) {
        return commandFailure(name, "cannot run in a pipeline or redirect");
      }
      return this.startVi(arguments_);
    }
    if (sessionCommand === "dos-editor") {
      if (!interactiveAllowed || command.redirects.length > 0) {
        return commandFailure(name, "cannot run in a pipeline or redirect");
      }
      return this.startEditor(arguments_);
    }
    if (sessionCommand === "linux-script") {
      if (name !== "bash" && name !== "sh" && name !== "source") {
        return commandFailure(
          name,
          "invalid shell script command registration",
        );
      }
      if (name === "sh" || name === "bash" || name === "source")
        return this.executeScript(name, arguments_, stdin, depth);
      return commandFailure(name, "invalid shell script command", 2);
    }
    const result = this.commands.execute(command.words, stdin);
    this.cpuCyclesValue += result.cpuCycles ?? 0;
    return result;
  }

  private executeLinuxIdentityCommand(
    name: string,
    arguments_: readonly string[],
    stdin: string,
    depth: number,
    interactiveAllowed: boolean,
    foregroundAllowed: boolean,
    redirected: boolean,
  ): ShellCommandResult | undefined {
    if (
      this.scopedElevationDepth > 0 &&
      ["exit", "login", "logout", "su"].includes(name)
    ) {
      return commandFailure(
        "sudo",
        `${name}: session control requires a nested sudo -i shell`,
        2,
      );
    }
    if (
      this.debugSubmission &&
      ["exit", "login", "logout", "passwd", "su"].includes(name)
    ) {
      return commandFailure(
        "debug",
        `${name}: interactive session control is not supported through MCP`,
        2,
      );
    }
    switch (name) {
      case "exit":
        return this.executeSessionLogout(
          "exit",
          arguments_,
          depth,
          interactiveAllowed,
          redirected,
        );
      case "logout":
        return (
          this.executeSessionLogout(
            "logout",
            arguments_,
            depth,
            interactiveAllowed,
            redirected,
          ) ?? commandFailure("logout", "not a login shell", 1)
        );
      case "login":
        return this.executeLogin(
          arguments_,
          depth,
          interactiveAllowed,
          redirected,
        );
      case "passwd":
        return this.executePasswd(
          arguments_,
          depth,
          interactiveAllowed,
          redirected,
        );
      case "su":
        return this.executeSu(
          arguments_,
          depth,
          interactiveAllowed,
          redirected,
        );
      case "sudo":
        return this.executeSudo(
          arguments_,
          stdin,
          depth,
          interactiveAllowed,
          foregroundAllowed,
          redirected,
        );
      case "useradd":
        return this.executeUserAdd(arguments_);
      case "userdel":
        return this.executeUserDelete(arguments_);
      case "usermod":
        return this.executeUserModify(arguments_);
      case "groupadd":
        return this.executeGroupAdd(arguments_);
      case "groupdel":
        return this.executeGroupDelete(arguments_);
      case "getent":
        return this.executeGetent(arguments_);
      default:
        return undefined;
    }
  }

  private executeSessionLogout(
    command: "exit" | "logout",
    arguments_: readonly string[],
    depth: number,
    interactiveAllowed: boolean,
    redirected: boolean,
  ): ShellCommandResult | undefined {
    if (arguments_.length > 0) return commandUsage(command);
    if (depth !== 0 || !interactiveAllowed || redirected)
      return commandFailure(
        command,
        "cannot control the login session from a script or pipeline",
        2,
      );
    if (this.identityFrames.length > 0) {
      this.leaveIdentity();
      return commandSuccess("logout\n");
    }
    if (this.authentication?.enabled !== true) return undefined;
    this.logoutAuthenticatedSession();
    return commandSuccess("logout\n");
  }

  private executeLogin(
    arguments_: readonly string[],
    depth: number,
    interactiveAllowed: boolean,
    redirected: boolean,
  ): ShellCommandResult {
    if (arguments_.length > 1) return commandUsage("login [username]");
    if (depth !== 0 || !interactiveAllowed || redirected)
      return commandFailure("login", "must run from an interactive shell", 2);
    if (this.authentication?.enabled !== true)
      return commandFailure("login", "login manager is disabled", 1);
    if (this.identityFrames.length > 0)
      return commandFailure("login", "exit the privileged shell first", 1);
    this.logoutAuthenticatedSession();
    const username = arguments_[0];
    if (username === undefined) return commandSuccess();
    const accepted = this.authentication.submit(username);
    return {
      exitCode: accepted.exitCode,
      stderr: accepted.stderr,
      stdout: accepted.stdout,
      ...(accepted.sleepTicks === undefined
        ? {}
        : { sleepTicks: accepted.sleepTicks }),
    };
  }

  private executePasswd(
    arguments_: readonly string[],
    depth: number,
    interactiveAllowed: boolean,
    redirected: boolean,
  ): ShellCommandResult {
    const accounts = this.requireLinuxAccounts();
    if (arguments_[0] === "-l") {
      if (arguments_.length !== 2) return commandUsage("passwd -l <user>");
      if (!isSuperuser(this.credentialContext.current))
        return commandFailure("passwd", "Permission denied", 1);
      accounts.lockPassword(arguments_[1]!);
      return commandSuccess("passwd: password locked\n");
    }
    if (arguments_.length > 1) return commandUsage("passwd [user]");
    if (depth !== 0 || !interactiveAllowed || redirected)
      return commandFailure("passwd", "must run from an interactive shell", 2);
    const current = this.credentialContext.current;
    const target = arguments_[0] ?? current.loginName;
    const user = accounts.getUser(target);
    if (user === undefined)
      return commandFailure("passwd", `user ${target} does not exist`, 1);
    if (!isSuperuser(current) && target !== current.loginName)
      return commandFailure("passwd", "Permission denied", 1);
    const shadow = accounts.getShadowRecord(target);
    if (shadow === undefined)
      return commandFailure("passwd", "credential record is unavailable", 1);
    if (isSuperuser(current) || shadow.state === "unset") {
      this.linuxConversation = { kind: "passwd-new", target };
      return commandSuccess();
    }
    if (shadow.state === "locked")
      return commandFailure("passwd", "password is locked", 1);
    this.linuxConversation = {
      failures: 0,
      kind: "passwd-current",
      target,
    };
    return commandSuccess();
  }

  private executeSu(
    arguments_: readonly string[],
    depth: number,
    interactiveAllowed: boolean,
    redirected: boolean,
  ): ShellCommandResult {
    if (depth !== 0 || !interactiveAllowed || redirected)
      return commandFailure("su", "must run from an interactive shell", 2);
    let login = false;
    let target = "root";
    let targetSet = false;
    for (const argument of arguments_) {
      if (argument === "-" || argument === "-l") {
        if (login) return commandUsage("su [-] [user]");
        login = true;
      } else if (!targetSet) {
        target = argument;
        targetSet = true;
      } else return commandUsage("su [-] [user]");
    }
    const accounts = this.requireLinuxAccounts();
    if (accounts.getUser(target) === undefined)
      return commandFailure("su", `user ${target} does not exist`, 1);
    if (isSuperuser(this.credentialContext.current))
      return this.enterIdentity(target, login);
    if (accounts.getShadowRecord(target)?.state !== "hash")
      return commandFailure("su", "Authentication failure", 1);
    this.linuxConversation = {
      failures: 0,
      kind: "su-password",
      login,
      target,
    };
    return commandSuccess();
  }

  private executeSudo(
    arguments_: readonly string[],
    stdin: string,
    depth: number,
    interactiveAllowed: boolean,
    foregroundAllowed: boolean,
    redirected: boolean,
  ): ShellCommandResult {
    let nonInteractive = false;
    let login = false;
    let target = "root";
    let index = 0;
    for (; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      if (argument === "--") {
        index += 1;
        break;
      }
      if (argument === "-n") nonInteractive = true;
      else if (argument === "-i") login = true;
      else if (argument === "-u") {
        target = arguments_[index + 1] ?? "";
        index += 1;
        if (target.length === 0)
          return commandUsage("sudo [-n] [-u user] [-i] <command>");
      } else if (argument === "-k") {
        if (arguments_.length !== 1) return commandUsage("sudo -k");
        this.sudoCredentialExpiry.delete(
          this.credentialContext.current.loginName,
        );
        return commandSuccess();
      } else if (argument.startsWith("-"))
        return commandUsage("sudo [-n] [-u user] [-i] <command>");
      else break;
    }
    const nested = arguments_.slice(index);
    if (this.debugSubmission && (!nonInteractive || login))
      return commandFailure(
        "sudo",
        "MCP execution requires sudo -n with a non-login command",
        2,
      );
    if (login ? nested.length > 0 : nested.length === 0)
      return commandUsage("sudo [-n] [-u user] [-i] <command>");
    if (login && this.scopedElevationDepth > 0)
      return commandFailure(
        "sudo",
        "nested login shells are not allowed inside scoped sudo commands",
        2,
      );
    if (login && (depth !== 0 || !interactiveAllowed || redirected))
      return commandFailure("sudo", "login shell must be interactive", 2);
    const accounts = this.requireLinuxAccounts();
    if (accounts.getUser(target) === undefined)
      return commandFailure("sudo", `unknown user ${target}`, 1);
    const current = this.credentialContext.current;
    if (!this.mayUseSudo(current))
      return commandFailure(
        "sudo",
        `${current.loginName} is not in the sudo group`,
        1,
      );
    const pending: PendingSudo = {
      arguments: nested,
      depth,
      foregroundAllowed,
      interactiveAllowed,
      login,
      stdin,
      target,
    };
    if (isSuperuser(current) || this.hasCachedSudoCredential(current.loginName))
      return this.runPendingSudo(pending);
    if (nonInteractive || this.debugSubmission)
      return commandFailure("sudo", "a password is required", 1);
    if (depth !== 0 || !interactiveAllowed || redirected)
      return commandFailure(
        "sudo",
        "password prompt requires a single interactive command",
        2,
      );
    if (accounts.getShadowRecord(current.loginName)?.state !== "hash")
      return commandFailure(
        "sudo",
        "the current account has no usable password",
        1,
      );
    this.linuxConversation = {
      failures: 0,
      kind: "sudo-password",
      pending,
      username: current.loginName,
    };
    return commandSuccess();
  }

  private executeUserAdd(arguments_: readonly string[]): ShellCommandResult {
    if (!this.requireRoot())
      return commandFailure("useradd", "Permission denied", 1);
    let createHome = true;
    let uid: number | undefined;
    let home: string | undefined;
    let shell: string | undefined;
    let primaryGroup: string | undefined;
    let supplementaryGroups: readonly string[] | undefined;
    const positional: string[] = [];
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      if (argument === "-m") createHome = true;
      else if (argument === "-M") createHome = false;
      else if (["-u", "-d", "-s", "-g", "-G"].includes(argument)) {
        const value = arguments_[index + 1];
        if (value === undefined)
          return commandUsage(
            "useradd [-m|-M] [-u uid] [-g group] [-G groups] [-d home] [-s shell] <user>",
          );
        index += 1;
        if (argument === "-u") uid = parseLinuxId(value, "UID");
        else if (argument === "-d") home = value;
        else if (argument === "-s") shell = value;
        else if (argument === "-g") primaryGroup = value;
        else supplementaryGroups = commaSeparatedNames(value);
      } else if (argument.startsWith("-"))
        return commandUsage(
          "useradd [-m|-M] [-u uid] [-g group] [-G groups] [-d home] [-s shell] <user>",
        );
      else positional.push(argument);
    }
    if (positional.length !== 1)
      return commandUsage(
        "useradd [-m|-M] [-u uid] [-g group] [-G groups] [-d home] [-s shell] <user>",
      );
    const name = positional[0]!;
    const accounts = this.requireLinuxAccounts();
    const destination = this.filesystem.normalize(home ?? `/home/${name}`);
    if (createHome && this.filesystem.exists(destination))
      return commandFailure("useradd", `${destination}: already exists`, 1);
    const privateGroupExisted = accounts.getGroup(name) !== undefined;
    let createdHome = false;
    try {
      const user = accounts.createUser({
        home: destination,
        name,
        ...(primaryGroup === undefined ? {} : { primaryGroup }),
        ...(shell === undefined ? {} : { shell }),
        ...(supplementaryGroups === undefined ? {} : { supplementaryGroups }),
        ...(uid === undefined ? {} : { uid }),
      });
      if (createHome) {
        this.guestFilesystem.makeDirectory(user.home, 0o700);
        createdHome = true;
        this.guestFilesystem.chown(user.home, user.uid, user.gid);
        this.guestFilesystem.chmod(user.home, 0o700);
        this.guestFilesystem.writeFile(
          `${user.home}/.bashrc`,
          "# CS-Linux user shell\n",
          0o644,
        );
        this.guestFilesystem.chown(`${user.home}/.bashrc`, user.uid, user.gid);
        this.guestFilesystem.chmod(`${user.home}/.bashrc`, 0o644);
      }
      return commandSuccess();
    } catch (error: unknown) {
      const rollbackFailures: string[] = [];
      if (accounts.getUser(name) !== undefined) {
        try {
          accounts.deleteUser(name, {
            removePrimaryGroup: !privateGroupExisted,
          });
        } catch (rollbackError: unknown) {
          rollbackFailures.push(`account: ${message(rollbackError)}`);
        }
      }
      if (createdHome && this.guestFilesystem.exists(destination)) {
        try {
          this.guestFilesystem.delete(destination);
        } catch (rollbackError: unknown) {
          rollbackFailures.push(`home: ${message(rollbackError)}`);
        }
      }
      if (rollbackFailures.length > 0)
        return commandFailure(
          "useradd",
          `${message(error)}; rollback failed: ${rollbackFailures.join("; ")}`,
          1,
        );
      return commandFailure("useradd", message(error), 1);
    }
  }

  private executeUserDelete(arguments_: readonly string[]): ShellCommandResult {
    if (!this.requireRoot())
      return commandFailure("userdel", "Permission denied", 1);
    const removeHome = arguments_[0] === "-r";
    const name = arguments_[removeHome ? 1 : 0];
    if (name === undefined || arguments_.length !== (removeHome ? 2 : 1))
      return commandUsage("userdel [-r] <user>");
    if (this.activeLoginNames().has(name))
      return commandFailure("userdel", "cannot remove an active account", 1);
    const accounts = this.requireLinuxAccounts();
    const user = accounts.getUser(name);
    if (user === undefined)
      return commandFailure("userdel", `user ${name} does not exist`, 1);
    if (user.uid === initialUserId)
      return commandFailure(
        "userdel",
        "cannot remove the UID 1000 boot service account",
        1,
      );
    const privateGroup = accounts.getGroup(name);
    const removePrimaryGroup =
      privateGroup?.gid === user.gid &&
      !accounts
        .listUsers()
        .some(
          (candidate) => candidate.name !== name && candidate.gid === user.gid,
        );
    accounts.deleteUser(name, { removePrimaryGroup });
    if (removeHome && this.guestFilesystem.exists(user.home)) {
      try {
        this.guestFilesystem.delete(user.home);
      } catch (error: unknown) {
        return commandFailure(
          "userdel",
          `account removed but home retained: ${message(error)}`,
          1,
        );
      }
    }
    this.sudoCredentialExpiry.delete(name);
    return commandSuccess();
  }

  private executeUserModify(arguments_: readonly string[]): ShellCommandResult {
    if (!this.requireRoot())
      return commandFailure("usermod", "Permission denied", 1);
    let nextName: string | undefined;
    let home: string | undefined;
    let shell: string | undefined;
    let primaryGroup: string | undefined;
    let supplementaryGroups: readonly string[] | undefined;
    let appendGroups = false;
    let moveHome = false;
    const positional: string[] = [];
    for (let index = 0; index < arguments_.length; index += 1) {
      const argument = arguments_[index]!;
      if (argument === "-m") moveHome = true;
      else if (argument === "-a") appendGroups = true;
      else if (argument === "-aG") {
        appendGroups = true;
        const value = arguments_[index + 1];
        if (value === undefined)
          return commandUsage(
            "usermod [-l name] [-d home -m] [-s shell] [-g group] [-G groups] [-aG groups] <user>",
          );
        supplementaryGroups = commaSeparatedNames(value);
        index += 1;
      } else if (["-l", "-d", "-s", "-g", "-G"].includes(argument)) {
        const value = arguments_[index + 1];
        if (value === undefined)
          return commandUsage(
            "usermod [-l name] [-d home -m] [-s shell] [-g group] [-G groups] [-aG groups] <user>",
          );
        index += 1;
        if (argument === "-l") nextName = value;
        else if (argument === "-d") home = value;
        else if (argument === "-s") shell = value;
        else if (argument === "-g") primaryGroup = value;
        else supplementaryGroups = commaSeparatedNames(value);
      } else if (argument.startsWith("-"))
        return commandUsage(
          "usermod [-l name] [-d home -m] [-s shell] [-g group] [-G groups] [-aG groups] <user>",
        );
      else positional.push(argument);
    }
    if (positional.length !== 1 || (moveHome && home === undefined))
      return commandUsage(
        "usermod [-l name] [-d home -m] [-s shell] [-g group] [-G groups] [-aG groups] <user>",
      );
    const name = positional[0]!;
    const accounts = this.requireLinuxAccounts();
    const current = accounts.getUser(name);
    if (current === undefined)
      return commandFailure("usermod", `user ${name} does not exist`, 1);
    if (nextName !== undefined && this.activeLoginNames().has(name))
      return commandFailure("usermod", "cannot rename an active account", 1);
    if (appendGroups && supplementaryGroups !== undefined) {
      supplementaryGroups = [
        ...new Set([
          ...accounts
            .groupsForUser(name)
            .filter(({ gid }) => gid !== current.gid)
            .map(({ name: groupName }) => groupName),
          ...supplementaryGroups,
        ]),
      ];
    }
    const destination =
      home === undefined ? undefined : this.filesystem.normalize(home);
    if (
      destination !== undefined &&
      destination !== current.home &&
      this.activeLoginNames().has(name)
    )
      return commandFailure(
        "usermod",
        "cannot change the home of an active account",
        1,
      );
    let moved = false;
    if (moveHome && destination !== undefined && destination !== current.home) {
      if (this.guestFilesystem.exists(destination))
        return commandFailure("usermod", `${destination}: already exists`, 1);
      this.guestFilesystem.move(current.home, destination);
      moved = true;
    }
    try {
      accounts.updateUser(name, {
        ...(destination === undefined ? {} : { home: destination }),
        ...(nextName === undefined ? {} : { name: nextName }),
        ...(primaryGroup === undefined ? {} : { primaryGroup }),
        ...(shell === undefined ? {} : { shell }),
        ...(supplementaryGroups === undefined ? {} : { supplementaryGroups }),
      });
      return commandSuccess();
    } catch (error: unknown) {
      if (moved && destination !== undefined) {
        try {
          this.guestFilesystem.move(destination, current.home);
        } catch (rollbackError: unknown) {
          return commandFailure(
            "usermod",
            `${message(error)}; home rollback failed: ${message(rollbackError)}`,
            1,
          );
        }
      }
      return commandFailure("usermod", message(error), 1);
    }
  }

  private executeGroupAdd(arguments_: readonly string[]): ShellCommandResult {
    if (!this.requireRoot())
      return commandFailure("groupadd", "Permission denied", 1);
    let gid: number | undefined;
    let name: string | undefined;
    for (let index = 0; index < arguments_.length; index += 1) {
      if (arguments_[index] === "-g") {
        const value = arguments_[index + 1];
        if (value === undefined)
          return commandUsage("groupadd [-g gid] <group>");
        gid = parseLinuxId(value, "GID");
        index += 1;
      } else if (arguments_[index]!.startsWith("-") || name !== undefined)
        return commandUsage("groupadd [-g gid] <group>");
      else name = arguments_[index];
    }
    if (name === undefined) return commandUsage("groupadd [-g gid] <group>");
    this.requireLinuxAccounts().createGroup({
      name,
      ...(gid === undefined ? {} : { gid }),
    });
    return commandSuccess();
  }

  private executeGroupDelete(
    arguments_: readonly string[],
  ): ShellCommandResult {
    if (!this.requireRoot())
      return commandFailure("groupdel", "Permission denied", 1);
    if (arguments_.length !== 1) return commandUsage("groupdel <group>");
    this.requireLinuxAccounts().deleteGroup(arguments_[0]!);
    return commandSuccess();
  }

  private executeGetent(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length < 1 || arguments_.length > 2)
      return commandUsage("getent <passwd|group> [key]");
    const accounts = this.requireLinuxAccounts();
    const [database, key] = arguments_;
    if (database === "passwd") {
      const records =
        key === undefined
          ? accounts.listUsers()
          : [
              /^[0-9]+$/u.test(key)
                ? accounts.getUserByUid(Number(key))
                : accounts.getUser(key),
            ].filter(
              (record): record is LinuxUserRecord => record !== undefined,
            );
      if (records.length === 0) return { exitCode: 2, stderr: "", stdout: "" };
      return commandSuccess(
        records
          .map(
            (user) =>
              `${user.name}:x:${String(user.uid)}:${String(user.gid)}:${user.gecos}:${user.home}:${user.shell}\n`,
          )
          .join(""),
      );
    }
    if (database === "group") {
      const records =
        key === undefined
          ? accounts.listGroups()
          : [
              /^[0-9]+$/u.test(key)
                ? accounts.getGroupByGid(Number(key))
                : accounts.getGroup(key),
            ].filter((record) => record !== undefined);
      if (records.length === 0) return { exitCode: 2, stderr: "", stdout: "" };
      return commandSuccess(
        records
          .map(
            (group) =>
              `${group.name}:x:${String(group.gid)}:${group.members.join(",")}\n`,
          )
          .join(""),
      );
    }
    return commandFailure("getent", `unsupported database ${database}`, 2);
  }

  private linuxConversationPrompt(): string | undefined {
    switch (this.linuxConversation?.kind) {
      case "passwd-current":
        return "Current password: ";
      case "passwd-new":
        return "New password: ";
      case "passwd-confirm":
        return "Retype new password: ";
      case "su-password":
        return "Password: ";
      case "sudo-password":
        return `[sudo] password for ${this.linuxConversation.username}: `;
      default:
        return undefined;
    }
  }

  private submitLinuxConversation(value: string): ShellResult {
    const conversation = this.linuxConversation;
    if (conversation === undefined) return resultFromStreams("", "", 0);
    const authentication = this.requireLinuxAuthentication();
    switch (conversation.kind) {
      case "passwd-current": {
        if (authentication.verifyUserPassword(conversation.target, value)) {
          this.linuxConversation = {
            kind: "passwd-new",
            target: conversation.target,
          };
          return resultFromStreams("", "", 0);
        }
        return this.failedConversationPassword(
          "passwd-current",
          conversation.failures,
          () => ({
            failures: conversation.failures + 1,
            kind: "passwd-current",
            target: conversation.target,
          }),
          "passwd: Authentication failure\n",
        );
      }
      case "passwd-new": {
        const problem = validatePassword(value);
        if (problem !== undefined)
          return resultFromStreams("", `passwd: ${problem}\n`, 1);
        this.linuxConversation = {
          candidate: value,
          kind: "passwd-confirm",
          target: conversation.target,
        };
        return resultFromStreams("", "", 0);
      }
      case "passwd-confirm": {
        if (value !== conversation.candidate) {
          this.linuxConversation = {
            kind: "passwd-new",
            target: conversation.target,
          };
          return resultFromStreams(
            "",
            "passwd: passwords do not match; start again\n",
            1,
          );
        }
        try {
          authentication.setUserPassword(
            conversation.target,
            conversation.candidate,
          );
          this.linuxConversation = undefined;
          return resultFromStreams(
            "passwd: password updated successfully\n",
            "",
            0,
          );
        } catch (error: unknown) {
          this.linuxConversation = {
            kind: "passwd-new",
            target: conversation.target,
          };
          return resultFromStreams("", `passwd: ${message(error)}\n`, 1);
        }
      }
      case "su-password": {
        if (authentication.verifyUserPassword(conversation.target, value)) {
          this.linuxConversation = undefined;
          return shellResultFromCommand(
            this.enterIdentity(conversation.target, conversation.login),
          );
        }
        return this.failedConversationPassword(
          "su-password",
          conversation.failures,
          () => ({
            failures: conversation.failures + 1,
            kind: "su-password",
            login: conversation.login,
            target: conversation.target,
          }),
          "su: Authentication failure\n",
        );
      }
      case "sudo-password": {
        if (authentication.verifyUserPassword(conversation.username, value)) {
          this.sudoCredentialExpiry.set(
            conversation.username,
            this.commands.currentTick() +
              this.commands.ticksPerSecond() * sudoCredentialLifetimeSeconds,
          );
          this.linuxConversation = undefined;
          return shellResultFromCommand(
            this.runPendingSudo(conversation.pending),
          );
        }
        return this.failedConversationPassword(
          "sudo-password",
          conversation.failures,
          () => ({
            failures: conversation.failures + 1,
            kind: "sudo-password",
            pending: conversation.pending,
            username: conversation.username,
          }),
          "Sorry, try again.\n",
        );
      }
    }
  }

  private failedConversationPassword(
    _kind: "passwd-current" | "su-password" | "sudo-password",
    failures: number,
    retry: () => LinuxConversation,
    stderr: string,
  ): ShellResult {
    const nextFailures = failures + 1;
    if (nextFailures < maximumAuthenticationFailures) {
      this.linuxConversation = retry();
      return resultFromStreams("", stderr, 1);
    }
    this.linuxConversation = undefined;
    return resultFromStreams(
      "",
      `${stderr}Too many attempts; retrying in 2 seconds.\n`,
      1,
      undefined,
      40,
    );
  }

  private runPendingSudo(pending: PendingSudo): ShellCommandResult {
    if (pending.login) return this.enterIdentity(pending.target, true);
    if (this.scopedElevationDepth >= maximumScriptDepth)
      return commandFailure("sudo", "maximum nested sudo depth exceeded", 1);
    const authentication = this.requireLinuxAuthentication();
    const target = authentication.credentialsForUser(pending.target);
    const effective = createEffectiveCredentials(
      this.credentialContext.current,
      {
        groupId: target.effectiveGroupId,
        loginName: target.loginName,
        supplementaryGroupIds: target.supplementaryGroupIds,
        userId: target.effectiveUserId,
      },
    );
    const frame = this.captureIdentityFrame();
    const identityFrames = [...this.identityFrames];
    this.scopedElevationDepth += 1;
    try {
      return this.credentialContext.runWith(effective, () =>
        this.executeCommand(
          { redirects: [], words: pending.arguments },
          pending.stdin,
          pending.depth,
          pending.interactiveAllowed,
          pending.foregroundAllowed,
        ),
      );
    } finally {
      this.scopedElevationDepth -= 1;
      this.identityFrames.length = 0;
      this.identityFrames.push(...identityFrames);
      this.restoreIdentityFrame(frame);
    }
  }

  private enterIdentity(username: string, login: boolean): ShellCommandResult {
    if (this.identityFrames.length >= maximumScriptDepth)
      return commandFailure("su", "maximum nested identity depth exceeded", 1);
    const accounts = this.requireLinuxAccounts();
    const authentication = this.requireLinuxAuthentication();
    const user = accounts.getUser(username);
    if (user === undefined)
      return commandFailure("su", `user ${username} does not exist`, 1);
    let frame: IdentityFrame;
    try {
      frame = this.captureIdentityFrame();
    } catch (error: unknown) {
      return commandFailure("su", message(error), 1);
    }
    this.identityFrames.push(frame);
    try {
      this.credentialContext.replace(
        authentication.credentialsForUser(username),
      );
      if (login) {
        this.saveHistory();
        this.shellAliases.clear();
        this.shellFunctions.clear();
        this.history.length = 0;
        const homeWarning = this.commands.activateUser(user);
        const historyWarning = this.loadHistory(user);
        const loaded = this.loadLinuxLoginScripts(user);
        const warnings = [homeWarning, historyWarning].filter(
          (value): value is string => value !== undefined,
        );
        return warnings.length === 0
          ? loaded
          : { ...loaded, stderr: `${warnings.join("\n")}\n${loaded.stderr}` };
      } else this.commands.switchUser(user, false);
      return commandSuccess();
    } catch (error: unknown) {
      this.identityFrames.pop();
      this.restoreIdentityFrame(frame);
      return commandFailure("su", message(error), 1);
    }
  }

  private leaveIdentity(): void {
    const frame = this.identityFrames.pop();
    if (frame === undefined) throw new Error("identity frame stack is empty");
    this.restoreIdentityFrame(frame);
  }

  private captureIdentityFrame(): IdentityFrame {
    if (
      this.shellAliases.size > maximumIdentityAliases ||
      this.shellFunctions.size > maximumIdentityFunctions
    ) {
      throw new Error("shell identity state limit exceeded");
    }
    return {
      aliases: new Map(this.shellAliases),
      credentials: this.credentialContext.current,
      functions: new Map(this.shellFunctions),
      history: [...this.history],
      ...(this.historyPath === undefined
        ? {}
        : { historyPath: this.historyPath }),
      shellState: this.commands.captureIdentityState(),
      umask: this.guestFilesystem.getUmask(),
    };
  }

  private restoreIdentityFrame(frame: IdentityFrame): void {
    this.credentialContext.replace(frame.credentials);
    this.commands.restoreIdentityState(frame.shellState);
    this.shellAliases.clear();
    for (const [name, value] of frame.aliases)
      this.shellAliases.set(name, value);
    this.shellFunctions.clear();
    for (const [name, body] of frame.functions)
      this.shellFunctions.set(name, body);
    this.history.length = 0;
    this.history.push(...frame.history);
    this.historyPath = frame.historyPath;
    this.guestFilesystem.setUmask(frame.umask);
  }

  private loadLinuxLoginScripts(user: LinuxUserRecord): ShellCommandResult {
    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    for (const path of [
      "/etc/profile",
      "/etc/bash.bashrc",
      `${user.home}/.bashrc`,
    ]) {
      try {
        if (!this.guestFilesystem.exists(path)) continue;
        const loaded = this.executeScript("source", [path], "", 0);
        stdout += loaded.stdout;
        stderr += loaded.stderr;
        if (loaded.exitCode !== 0) exitCode = loaded.exitCode;
      } catch (error: unknown) {
        stderr += `source: ${path}: ${message(error)}\n`;
        exitCode = 1;
      }
    }
    return { exitCode, stderr, stdout };
  }

  private logoutAuthenticatedSession(
    reason: "disconnect" | "logout" = "logout",
  ): readonly string[] {
    const historyWarning = this.saveHistory();
    this.closeRuntimeLoginSession(reason);
    this.commands.closeDebugger();
    this.linuxConversation = undefined;
    this.identityFrames.length = 0;
    this.sudoCredentialExpiry.clear();
    this.history.length = 0;
    this.historyPath = undefined;
    this.shellAliases.clear();
    this.shellFunctions.clear();
    if (this.authentication === undefined) {
      this.credentialContext.replace(initialUserCredentials);
      this.guestFilesystem.setUmask(0o022);
      return historyWarning === undefined ? [] : [historyWarning];
    }
    this.authentication.logout();
    const credentials =
      this.authentication.credentials ?? unauthenticatedCredentials;
    this.credentialContext.replace(credentials);
    this.guestFilesystem.setUmask(0o022);
    const user = this.accounts?.getUserByUid(credentials.realUserId);
    if (user === undefined) {
      this.commands.deactivateUser();
      return historyWarning === undefined ? [] : [historyWarning];
    }
    const homeWarning = this.commands.activateUser(user);
    return [historyWarning, homeWarning].filter(
      (value): value is string => value !== undefined,
    );
  }

  private openRuntimeLoginSession(user: LinuxUserRecord): string | undefined {
    const runtime = this.osRuntime;
    if (runtime === undefined) return undefined;
    const tick = this.commands.currentTick();
    const existing = runtime.loginSession(this.loginSessionId);
    if (existing !== undefined) {
      this.closeRuntimeLoginSession("logout");
    }
    const opened = runtime.openLoginSession({
      gid: user.gid,
      sessionId: this.loginSessionId,
      terminal: "tty1",
      tick,
      uid: user.uid,
      username: user.name,
    });
    const parentPid =
      runtime
        .processes()
        .find(({ command }) => command === "/sbin/cs-getty tty1")?.pid ?? 1;
    this.shellProcessId = runtime.spawnProcess({
      command: user.shell,
      gid: user.gid,
      parentPid,
      startTick: tick,
      state: "running",
      uid: user.uid,
    }).pid;
    runtime.appendAuthJournal(
      tick,
      `session ${this.loginSessionId} opened for ${user.name}`,
    );
    runtime.appendSystemJournal(
      tick,
      `process ${String(this.shellProcessId)} started: ${user.shell}`,
    );
    this.notifyOsRuntimeChanged();
    const previous = opened.previous;
    if (previous === undefined) return undefined;
    return `Last login: tick ${String(previous.loginTick)} on ${previous.terminal}${previous.logoutReason === undefined ? "" : ` (${previous.logoutReason})`}`;
  }

  private closeRuntimeLoginSession(reason: "disconnect" | "logout"): void {
    const runtime = this.osRuntime;
    if (runtime === undefined) return;
    const tick = this.commands.currentTick();
    const session = runtime.loginSession(this.loginSessionId);
    const shellPid = this.shellProcessId;
    if (shellPid !== undefined) {
      for (const job of runtime.jobs()) {
        if (runtime.process(job.pid)?.parentPid !== shellPid) continue;
        if (job.state !== "done") {
          try {
            if (this.signalProcess === undefined) {
              runtime.signalProcess(job.pid, "SIGHUP", tick);
            } else {
              this.signalProcess(job.pid, "SIGHUP");
            }
          } catch (error: unknown) {
            runtime.appendSystemJournal(
              tick,
              `job ${String(job.jobId)} hangup failed: ${message(error)}`,
              "error",
            );
          }
        }
        const terminalJob = runtime.job(job.jobId);
        if (terminalJob?.state === "done") {
          runtime.removeJob(job.jobId);
          if (runtime.process(job.pid)?.state === "zombie")
            runtime.reapProcess(job.pid);
        }
      }
    }
    this.shellProcessId = undefined;
    if (shellPid !== undefined) {
      const process = runtime.process(shellPid);
      if (process !== undefined && process.state !== "zombie") {
        runtime.transitionProcess(shellPid, {
          ...(reason === "disconnect" ? { signal: "SIGHUP" as const } : {}),
          kind: "exit",
          status: reason === "disconnect" ? 129 : 0,
          tick,
        });
        runtime.appendSystemJournal(
          tick,
          `process ${String(shellPid)} exited with status ${reason === "disconnect" ? "129 (SIGHUP)" : "0"}`,
        );
      }
      if (runtime.process(shellPid)?.state === "zombie")
        runtime.reapProcess(shellPid);
    }
    if (session !== undefined) {
      runtime.closeLoginSession(this.loginSessionId, tick, reason);
      runtime.appendAuthJournal(
        tick,
        `session ${this.loginSessionId} closed for ${session.username}: ${reason}`,
      );
    }
    this.notifyOsRuntimeChanged();
  }

  private touchRuntimeLoginSession(): void {
    const runtime = this.osRuntime;
    if (
      runtime === undefined ||
      runtime.loginSession(this.loginSessionId) === undefined
    ) {
      return;
    }
    runtime.touchLoginSession(this.loginSessionId, this.commands.currentTick());
    this.notifyOsRuntimeChanged();
  }

  private recordAuthenticationAudit(audit: LinuxAuthenticationAudit): void {
    const runtime = this.osRuntime;
    if (runtime === undefined) return;
    const tick = this.commands.currentTick();
    switch (audit.kind) {
      case "login-failure":
        runtime.appendAuthJournal(
          tick,
          `login failed for ${audit.username} on ${this.loginSessionId}`,
          "warning",
        );
        break;
      case "login-success":
        runtime.appendAuthJournal(
          tick,
          `credentials accepted for ${audit.username} on ${this.loginSessionId}`,
        );
        break;
      case "password-configured":
        runtime.appendAuthJournal(
          tick,
          `password configured for ${audit.username}`,
        );
        break;
    }
    this.notifyOsRuntimeChanged();
  }

  private readMotd(): readonly string[] | undefined {
    const path = "/etc/motd";
    try {
      if (
        !this.guestFilesystem.exists(path) ||
        this.guestFilesystem.isDirectory(path) ||
        this.guestFilesystem.isSymbolicLink(path) ||
        !this.guestFilesystem.hasAccess(path, 0b100)
      ) {
        return undefined;
      }
      const contents = this.guestFilesystem
        .readFile(path)
        .replaceAll("\r\n", "\n")
        .replace(/\n$/u, "");
      return contents.length === 0 ? undefined : contents.split("\n");
    } catch {
      return undefined;
    }
  }

  private notifyOsRuntimeChanged(): void {
    if (this.osRuntime !== undefined) this.onOsRuntimeChanged?.(this.osRuntime);
  }

  private loadHistory(user: LinuxUserRecord): string | undefined {
    this.history.length = 0;
    this.historyPath = `${user.home}/.bash_history`;
    try {
      if (!this.guestFilesystem.exists(this.historyPath)) return undefined;
      if (
        this.guestFilesystem.isDirectory(this.historyPath) ||
        this.guestFilesystem.isSymbolicLink(this.historyPath)
      ) {
        this.historyPath = undefined;
        return "bash: history file must be a regular file";
      }
      if (
        this.guestFilesystem.getSize(this.historyPath) > maximumHistoryFileBytes
      ) {
        this.historyPath = undefined;
        return `bash: history file exceeds ${String(maximumHistoryFileBytes)} bytes`;
      }
      const lines = this.guestFilesystem
        .readFile(this.historyPath)
        .replaceAll("\r\n", "\n")
        .split("\n")
        .filter((line) => line.length > 0)
        .slice(-maximumHistoryEntries)
        .map(limitHistoryLine);
      this.history.push(...lines);
      return undefined;
    } catch (error: unknown) {
      this.historyPath = undefined;
      return `bash: cannot read history: ${message(error)}`;
    }
  }

  private saveHistory(): string | undefined {
    const path = this.historyPath;
    if (path === undefined) return undefined;
    try {
      const contents =
        this.history.length === 0 ? "" : `${this.history.join("\n")}\n`;
      if (utf8ByteLength(contents) > maximumHistoryFileBytes) {
        throw new Error("history byte limit exceeded");
      }
      const existed = this.guestFilesystem.exists(path);
      if (
        existed &&
        (this.guestFilesystem.isDirectory(path) ||
          this.guestFilesystem.isSymbolicLink(path))
      ) {
        throw new Error("history file must be a regular file");
      }
      this.guestFilesystem.writeFile(path, contents, 0o600);
      if (!existed) this.guestFilesystem.setMetadata(path, { mode: 0o600 });
      return undefined;
    } catch (error: unknown) {
      this.historyPath = undefined;
      return `bash: cannot write history: ${message(error)}`;
    }
  }

  private mayUseSudo(credentials: ProcessCredentials): boolean {
    if (isSuperuser(credentials)) return true;
    return (
      credentials.effectiveGroupId === sudoLinuxGroup.gid ||
      credentials.supplementaryGroupIds.includes(sudoLinuxGroup.gid)
    );
  }

  private hasCachedSudoCredential(username: string): boolean {
    const expiry = this.sudoCredentialExpiry.get(username);
    if (expiry !== undefined && expiry > this.commands.currentTick())
      return true;
    this.sudoCredentialExpiry.delete(username);
    return false;
  }

  private requireRoot(): boolean {
    return isSuperuser(this.credentialContext.current);
  }

  private requireLinuxAccounts(): LinuxAccountDatabase {
    if (this.accounts === undefined)
      throw new Error("CS-Linux account database is unavailable");
    return this.accounts;
  }

  private requireLinuxAuthentication(): LinuxAuthentication {
    if (this.authentication === undefined)
      throw new Error("CS-Linux authentication is unavailable");
    return this.authentication;
  }

  private activeLoginNames(): ReadonlySet<string> {
    const names = new Set([
      this.credentialContext.current.loginName,
      ...this.identityFrames.map(({ credentials }) => credentials.loginName),
    ]);
    const authenticated = this.authentication?.credentials?.loginName;
    if (authenticated !== undefined) names.add(authenticated);
    return names;
  }

  private executeLinuxShellBuiltin(
    name: string,
    arguments_: readonly string[],
    stdin: string,
  ): ShellCommandResult | undefined {
    if (name === "alias") {
      if (arguments_.length === 0) {
        return commandSuccess(
          `${[...this.shellAliases]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(
              ([aliasName, value]) =>
                `alias ${aliasName}='${value.replaceAll("'", "'\\''")}'`,
            )
            .join("\n")}${this.shellAliases.size > 0 ? "\n" : ""}`,
        );
      }
      for (const value of arguments_) {
        const separator = value.indexOf("=");
        if (separator < 1)
          return commandFailure("alias", `${value}: not found`, 1);
        const aliasName = value.slice(0, separator);
        if (!/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(aliasName))
          return commandFailure("alias", `${aliasName}: invalid alias name`, 2);
        if (
          !this.shellAliases.has(aliasName) &&
          this.shellAliases.size >= maximumIdentityAliases
        ) {
          return commandFailure("alias", "alias limit exceeded", 1);
        }
        this.shellAliases.set(aliasName, value.slice(separator + 1));
      }
      return commandSuccess();
    }
    if (name === "unalias") {
      if (arguments_.length === 0) return commandUsage("unalias <name ...>");
      for (const aliasName of arguments_) {
        if (!this.shellAliases.delete(aliasName))
          return commandFailure("unalias", `${aliasName}: not found`, 1);
      }
      return commandSuccess();
    }
    if (name === "command") {
      if (arguments_[0] === "-v") {
        if (arguments_.length !== 2) return commandUsage("command -v <name>");
        const requested = arguments_[1]!;
        if (this.shellAliases.has(requested))
          return commandSuccess(`${requested}\n`);
        return this.commands.isKnownCommand(requested)
          ? commandSuccess(`${requested}\n`)
          : { exitCode: 1, stderr: "", stdout: "" };
      }
      if (arguments_.length === 0) return commandSuccess();
      return this.commands.execute(arguments_, stdin);
    }
    if (name === "read") {
      if (arguments_.length > 1) return commandUsage("read [name]");
      const variable = arguments_[0] ?? "REPLY";
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable))
        return commandFailure("read", `${variable}: invalid identifier`, 2);
      const newline = stdin.indexOf("\n");
      const value = (newline < 0 ? stdin : stdin.slice(0, newline)).replace(
        /\r$/u,
        "",
      );
      this.commands.setEnvironmentValue(variable, value);
      return { exitCode: stdin.length === 0 ? 1 : 0, stderr: "", stdout: "" };
    }
    if (name === "shift") {
      if (arguments_.length > 1) return commandUsage("shift [count]");
      const frame = this.scriptFrames.at(-1);
      if (frame === undefined)
        return commandFailure("shift", "not in a function or script", 1);
      const count = arguments_[0] === undefined ? 1 : Number(arguments_[0]);
      if (
        !Number.isSafeInteger(count) ||
        count < 0 ||
        count > frame.arguments.length
      )
        return commandFailure("shift", "shift count out of range", 1);
      frame.arguments.splice(0, count);
      return commandSuccess();
    }
    if (name === "local") {
      const scope = this.localScopes.at(-1);
      if (scope === undefined)
        return commandFailure("local", "can only be used in a function", 1);
      for (const assignment of arguments_) {
        const separator = assignment.indexOf("=");
        const variable =
          separator < 0 ? assignment : assignment.slice(0, separator);
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable))
          return commandFailure("local", `${variable}: invalid identifier`, 2);
        if (!scope.has(variable))
          scope.set(variable, this.commands.environmentValue(variable));
        this.commands.setEnvironmentValue(
          variable,
          separator < 0 ? "" : assignment.slice(separator + 1),
        );
      }
      return commandSuccess();
    }
    if (name === "getopts") return this.executeGetopts(arguments_);
    return undefined;
  }

  private executeGetopts(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length !== 2)
      return commandUsage("getopts <optstring> <name>");
    const frame = this.scriptFrames.at(-1);
    if (frame === undefined)
      return commandFailure("getopts", "not in a function or script", 1);
    const [specification = "", variable = ""] = arguments_;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(variable))
      return commandFailure("getopts", `${variable}: invalid identifier`, 2);
    const index = Number(this.commands.environmentValue("OPTIND") ?? "1");
    const argument = frame.arguments[index - 1];
    if (argument === undefined || !/^-[^-].*/u.test(argument))
      return { exitCode: 1, stderr: "", stdout: "" };
    const option = argument[1]!;
    const location = specification.indexOf(option);
    this.commands.setEnvironmentValue("OPTIND", String(index + 1));
    if (location < 0) {
      this.commands.setEnvironmentValue(variable, "?");
      return commandSuccess();
    }
    this.commands.setEnvironmentValue(variable, option);
    if (specification[location + 1] === ":") {
      const attached = argument.slice(2);
      const optionArgument = attached || frame.arguments[index];
      if (optionArgument === undefined) {
        this.commands.setEnvironmentValue(variable, "?");
        return commandSuccess();
      }
      this.commands.setEnvironmentValue("OPTARG", optionArgument);
      if (attached.length === 0)
        this.commands.setEnvironmentValue("OPTIND", String(index + 2));
    } else this.commands.unsetEnvironmentValue("OPTARG");
    return commandSuccess();
  }

  private restoreLocalScope(
    scope: ReadonlyMap<string, string | undefined>,
  ): void {
    for (const [name, value] of scope) {
      if (value === undefined) this.commands.unsetEnvironmentValue(name);
      else this.commands.setEnvironmentValue(name, value);
    }
  }

  private executeScript(
    command: "bash" | "sh" | "source",
    arguments_: readonly string[],
    stdin: string,
    depth: number,
  ): ShellCommandResult {
    if (arguments_.length === 1 && arguments_[0] === "--version") {
      return commandSuccess("Computer System Bash 0.4 (sandboxed shell)\n");
    }
    if (depth >= maximumScriptDepth) {
      return commandFailure(command, "maximum script depth exceeded");
    }
    let source: string;
    let label: string;
    let scriptArguments: string[];
    if (arguments_[0] === "-c") {
      if (arguments_.length < 2)
        return commandUsage(`${command} -c <command> [name [argument ...]]`);
      source = arguments_[1]!;
      label = arguments_[2] ?? "-c";
      scriptArguments = arguments_.slice(3);
    } else if (arguments_.length === 0 && command !== "source") {
      source = stdin;
      label = "stdin";
      scriptArguments = [];
    } else if (arguments_.length >= 1) {
      label = arguments_[0]!;
      scriptArguments = arguments_.slice(1);
      try {
        source = this.commands.readFile(label);
      } catch (error: unknown) {
        return commandFailure(command, message(error));
      }
    } else return commandUsage(`${command} [-c command | file]`);

    const lines = source.replaceAll("\r\n", "\n").split("\n");
    if (lines.length > maximumScriptLines) {
      return commandFailure(command, `${label}: script line limit exceeded`);
    }
    if (this.scriptFrames.length === 0) this.scriptLoopIterations = 0;
    this.scriptFrames.push({ arguments: scriptArguments, name: label });
    try {
      return this.executeScriptLines(lines, depth + 1, label).result;
    } finally {
      this.scriptFrames.pop();
    }
  }

  private executeDosBatch(
    path: string,
    arguments_: readonly string[],
    depth: number,
  ): ShellCommandResult {
    if (depth >= maximumScriptDepth)
      return commandFailure(path, "maximum batch depth exceeded");
    let source: string;
    try {
      source = this.commands.readFile(path);
    } catch (error: unknown) {
      return commandFailure(path, message(error));
    }
    const lines = source.replaceAll("\r\n", "\n").split("\n");
    if (lines.length > maximumScriptLines)
      return commandFailure(path, "batch line limit exceeded");
    const engine = new DosBatchEngine({
      maximumCallDepth: Math.max(1, maximumScriptDepth - depth),
      maximumLines: maximumScriptLines,
      maximumOutputCharacters: maximumPipelineBuffer,
    });
    const displayPath = this.commands.profile.pathDialect.display(path);
    const result = engine.execute(
      {
        arguments: arguments_.slice(0, 9),
        initialEcho: this.commands.dosEchoEnabled,
        name: displayPath,
        source,
      },
      {
        execute: (commandLine) => {
          if (hasUnixBatchCompoundSyntax(commandLine)) {
            return {
              exitCode: 2,
              stderr: `${displayPath}: Unix && and || command chains are not supported in batch files\r\n`,
            };
          }
          if (dosBatchCommandRequiresInteractiveOwner(commandLine)) {
            return {
              exitCode: 125,
              stderr: `${displayPath}: asynchronous or terminal-control commands are not supported in batch files\r\n`,
            };
          }
          const executed = this.executeLine(commandLine, depth + 1, true);
          if (
            executed.action !== undefined ||
            executed.sleepTicks !== undefined ||
            executed.foreground !== undefined ||
            executed.terminalScreen !== undefined ||
            executed.ioWaitEvent !== undefined ||
            executed.resetTerminal === true
          ) {
            return {
              exitCode: 125,
              stderr: `${displayPath}: command did not terminate synchronously\r\n`,
            };
          }
          return {
            exitCode: executed.exitCode,
            stderr: executed.stderr,
            stdout: executed.stdout,
          };
        },
        exists: (candidate) => this.commands.pathExists(candidate),
        getEnvironment: (name) => this.commands.environmentValue(name),
        loadBatch: (candidate) => {
          const program = this.commands.resolveDosProgram(candidate);
          if (program?.kind !== "batch") return undefined;
          return {
            name: this.commands.profile.pathDialect.display(program.path),
            source: this.commands.readFile(program.path),
          };
        },
      },
    );
    this.commands.setDosEchoEnabled(result.echoEnabled);
    this.cpuCyclesValue += result.steps;
    this.lastExitCode = result.exitCode;
    return {
      exitCode: result.exitCode,
      stderr: result.stderr,
      stdout: result.stdout,
    };
  }

  private loadDosConfiguration(path: string): ShellCommandResult {
    let source: string;
    try {
      source = this.commands.readFile(path);
    } catch (error: unknown) {
      return commandFailure(path, message(error));
    }
    const lines = source.replaceAll("\r\n", "\n").split("\n");
    if (lines.length > maximumDosConfigLines)
      return commandFailure(path, "configuration line limit exceeded");
    let stderr = "";
    let exitCode = 0;
    for (const [index, sourceLine] of lines.entries()) {
      const line = sourceLine.trim();
      if (
        line.length === 0 ||
        line.startsWith(";") ||
        /^REM(?:\s|$)/iu.test(line)
      )
        continue;
      const numeric = /^(FILES|BUFFERS)\s*=\s*([0-9]+)$/iu.exec(line);
      if (numeric !== null) {
        const name = numeric[1]!.toUpperCase();
        const value = Number(numeric[2]);
        const maximum = name === "FILES" ? 255 : 99;
        if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
          stderr += `CONFIG.SYS line ${String(index + 1)}: ${name} must be between 1 and ${String(maximum)}\r\n`;
          exitCode = 2;
          continue;
        }
        this.commands.setVariable(`CONFIG_${name}`, String(value));
        continue;
      }

      const device = /^DEVICE(?:HIGH)?\s*=\s*([^\s]+)(?:\s+(.*))?$/iu.exec(
        line,
      );
      if (device !== null) {
        const driver = device[1]!.replaceAll("/", "\\").toUpperCase();
        const arguments_ = (device[2] ?? "").trim().toUpperCase();
        if (driver === "HIMEM.SYS" || driver.endsWith("\\HIMEM.SYS")) {
          if (!this.isInstalledDosDriver(driver, "CS-DOS XMS manager")) {
            stderr += `CONFIG.SYS line ${String(index + 1)}: HIMEM.SYS is missing or invalid\r\n`;
            exitCode = 2;
            continue;
          }
          this.commands.setVariable("CONFIG_XMS", "ON");
          continue;
        }
        if (driver === "EMM386.EXE" || driver.endsWith("\\EMM386.EXE")) {
          if (arguments_ !== "" && arguments_ !== "NOEMS") {
            stderr += `CONFIG.SYS line ${String(index + 1)}: EMM386 supports only NOEMS\r\n`;
            exitCode = 2;
            continue;
          }
          if (!this.isInstalledDosDriver(driver, "CS-DOS UMB manager")) {
            stderr += `CONFIG.SYS line ${String(index + 1)}: EMM386.EXE is missing or invalid\r\n`;
            exitCode = 2;
            continue;
          }
          this.commands.setVariable("CONFIG_EMM386", "ON");
          this.commands.setVariable(
            "CONFIG_EMM386_MODE",
            arguments_ === "NOEMS" ? "NOEMS" : "EMS",
          );
          continue;
        }
      }

      const dos = /^DOS\s*=\s*(.+)$/iu.exec(line);
      if (dos !== null) {
        const modes = new Set(
          dos[1]!
            .split(",")
            .map((value) => value.trim().toUpperCase())
            .filter((value) => value.length > 0),
        );
        if (
          modes.size === 0 ||
          [...modes].some(
            (mode) =>
              mode !== "HIGH" &&
              mode !== "LOW" &&
              mode !== "UMB" &&
              mode !== "NOUMB",
          )
        ) {
          stderr += `CONFIG.SYS line ${String(index + 1)}: DOS supports HIGH, LOW, UMB, or NOUMB\r\n`;
          exitCode = 2;
          continue;
        }
        this.commands.setVariable(
          "CONFIG_DOS_HIGH",
          modes.has("LOW") ? "OFF" : modes.has("HIGH") ? "ON" : "OFF",
        );
        this.commands.setVariable(
          "CONFIG_UMB",
          modes.has("NOUMB") ? "OFF" : modes.has("UMB") ? "ON" : "OFF",
        );
        continue;
      }

      stderr += `CONFIG.SYS line ${String(index + 1)}: unsupported directive ${line}\r\n`;
      exitCode = 2;
    }
    return { exitCode, stderr, stdout: "" };
  }

  private isInstalledDosDriver(driver: string, capsule: string): boolean {
    const path =
      /^[A-Za-z]:/u.test(driver) || driver.includes("\\")
        ? driver
        : `C:\\DOS\\${driver}`;
    try {
      return this.commands.readFile(path).startsWith(`${capsule}\n`);
    } catch {
      return false;
    }
  }

  private executeScriptLines(
    lines: readonly string[],
    depth: number,
    label: string,
    loopDepth = 0,
  ): ScriptExecution {
    let combined = commandSuccess();
    const append = (next: ShellCommandResult): boolean => {
      combined = mergeCommandResults(combined, next);
      return (
        combined.stdout.length <= maximumPipelineBuffer &&
        combined.stderr.length <= maximumPipelineBuffer &&
        next.action === undefined &&
        next.sleepTicks === undefined
      );
    };

    for (let index = 0; index < lines.length; index += 1) {
      this.cpuCyclesValue += 1;
      const rawLine = lines[index]!.trim();
      const suppressEcho = rawLine.startsWith("@");
      const line =
        this.dosBatchDepth > 0
          ? rawLine.replace(/^@/u, "").trimStart()
          : rawLine;
      if (line.length === 0 || line.startsWith("#!")) continue;
      if (
        this.dosBatchDepth > 0 &&
        this.commands.dosEchoEnabled &&
        !suppressEcho
      ) {
        if (!append(commandSuccess(`${line}\r\n`)))
          return scriptFailure(label, "script output limit exceeded");
      }
      const functionMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{$/u.exec(
        line,
      );
      if (functionMatch !== null) {
        const end = findFunctionEnd(lines, index + 1);
        if (end < 0)
          return scriptFailure(label, "unterminated function definition");
        if (
          !this.shellFunctions.has(functionMatch[1]!) &&
          this.shellFunctions.size >= maximumIdentityFunctions
        ) {
          return scriptFailure(label, "shell function limit exceeded");
        }
        this.shellFunctions.set(functionMatch[1]!, lines.slice(index + 1, end));
        index = end;
        continue;
      }
      if (line.startsWith("if ")) {
        const compound = parseIfCompound(lines, index);
        if (compound === undefined)
          return scriptFailure(label, "unterminated if statement");
        let selected: readonly string[] | undefined;
        for (const branch of compound.branches) {
          if (branch.condition === undefined) {
            selected = branch.lines;
            break;
          }
          const condition = this.executeLine(branch.condition, depth);
          if (!append(toCommandResult(condition)))
            return scriptFailure(label, "script output or wait limit exceeded");
          if (condition.exitCode === 0) {
            selected = branch.lines;
            break;
          }
        }
        if (selected !== undefined) {
          const executed = this.executeScriptLines(
            selected,
            depth,
            label,
            loopDepth,
          );
          if (!append(executed.result))
            return scriptFailure(label, "script output or wait limit exceeded");
          if (executed.flow !== "normal")
            return { flow: executed.flow, result: combined };
        }
        index = compound.end;
        continue;
      }
      const forMatch =
        /^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in(?:\s+(.*?))?\s*;?\s*do$/u.exec(
          line,
        );
      if (forMatch !== null) {
        const end = findCompoundEnd(lines, index, "done");
        if (end < 0) return scriptFailure(label, "unterminated for loop");
        const values = this.expandScriptWords(forMatch[2] ?? "");
        for (const value of values) {
          this.cpuCyclesValue += 2;
          this.scriptLoopIterations += 1;
          if (this.scriptLoopIterations > maximumScriptLoopIterations)
            return scriptFailure(label, "loop iteration limit exceeded");
          this.commands.setVariable(forMatch[1]!, value);
          const executed = this.executeScriptLines(
            lines.slice(index + 1, end),
            depth,
            label,
            loopDepth + 1,
          );
          if (!append(executed.result))
            return scriptFailure(label, "script output or wait limit exceeded");
          if (executed.flow === "break") break;
          if (executed.flow === "return")
            return { flow: "return", result: combined };
        }
        index = end;
        continue;
      }
      const whileMatch = /^while\s+(.+?)\s*;?\s*do$/u.exec(line);
      if (whileMatch !== null) {
        const end = findCompoundEnd(lines, index, "done");
        if (end < 0) return scriptFailure(label, "unterminated while loop");
        for (;;) {
          this.scriptLoopIterations += 1;
          if (this.scriptLoopIterations > maximumScriptLoopIterations)
            return scriptFailure(label, "loop iteration limit exceeded");
          const condition = this.executeLine(whileMatch[1]!, depth);
          if (!append(toCommandResult(condition)))
            return scriptFailure(label, "script output or wait limit exceeded");
          if (condition.exitCode !== 0) break;
          const executed = this.executeScriptLines(
            lines.slice(index + 1, end),
            depth,
            label,
            loopDepth + 1,
          );
          if (!append(executed.result))
            return scriptFailure(label, "script output or wait limit exceeded");
          if (executed.flow === "break") break;
          if (executed.flow === "return")
            return { flow: "return", result: combined };
        }
        index = end;
        continue;
      }
      if (line === "break" || line === "continue") {
        if (loopDepth === 0)
          return scriptFailure(label, `${line}: only meaningful in a loop`);
        return { flow: line, result: combined };
      }
      const returnMatch = /^return(?:\s+([0-9]{1,3}))?$/u.exec(line);
      if (returnMatch !== null) {
        const code = Math.min(255, Number(returnMatch[1] ?? combined.exitCode));
        return { flow: "return", result: { ...combined, exitCode: code } };
      }
      const result = this.executeLine(line, depth);
      if (!append(toCommandResult(result)))
        return scriptFailure(label, "script output or wait limit exceeded");
    }
    return { flow: "normal", result: combined };
  }

  private expandScriptWords(source: string): readonly string[] {
    if (source.trim().length === 0) return [];
    const program = parseShellProgram(
      source,
      (name) => `${variableMarkerStart}${name}${variableMarkerEnd}`,
    );
    const command = program.chains[0]?.pipeline.commands[0];
    return command === undefined ? [] : this.expandCommand(command).words;
  }

  private resolveVariable(name: string): string {
    const frame = this.scriptFrames.at(-1);
    if (frame !== undefined) {
      if (name === "0") return frame.name;
      if (name === "#") return String(frame.arguments.length);
      if (name === "@" || name === "*") return frame.arguments.join(" ");
      if (/^[0-9]+$/u.test(name))
        return frame.arguments[Number(name) - 1] ?? "";
    }
    return this.commands.resolveVariable(name, this.lastExitCode) ?? "";
  }

  private startEditor(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) return commandUsage("edit [path]");
    const untitled = arguments_.length === 0;
    const path = this.commands.resolvePath(arguments_[0] ?? "C:\\NONAME.TXT");
    try {
      const existing = this.filesystem.exists(path)
        ? this.commands.readFile(path)
        : "";
      this.editor = new DosEditSession(
        path,
        existing,
        this.terminalWidth,
        this.terminalHeight,
        untitled ? "UNTITLED" : this.commands.profile.pathDialect.display(path),
      );
      return {
        exitCode: 0,
        stderr: "",
        stdout: "",
        terminalScreen: this.editor.screen(),
      };
    } catch (error: unknown) {
      return commandFailure("edit", message(error));
    }
  }

  private startVi(arguments_: readonly string[]): ShellCommandResult {
    if (arguments_.length > 1) return commandUsage("vi [path]");
    const path =
      arguments_[0] === undefined
        ? undefined
        : this.commands.resolvePath(arguments_[0]);
    try {
      const existing =
        path !== undefined && this.guestFilesystem.exists(path)
          ? this.commands.readFile(path)
          : "";
      this.vi = new ViSession(
        path,
        existing,
        this.terminalWidth,
        this.terminalHeight,
      );
      return {
        exitCode: 0,
        stderr: "",
        stdout: "",
        terminalScreen: this.vi.screen(),
      };
    } catch (error: unknown) {
      return commandFailure("vi", message(error));
    }
  }

  private submitViLine(line: string): ShellResult {
    const keys = line.startsWith(":")
      ? [...line, "Enter"]
      : ["i", ...line, "Enter", "Escape"];
    return this.keys(keys);
  }

  private viResult(result: ViResult): ShellResult {
    const vi = this.vi;
    if (vi === undefined) throw new Error("vi state is unavailable");
    if (result.kind === "save") {
      try {
        const path =
          result.fileName === undefined
            ? vi.fileName
            : this.commands.resolvePath(result.fileName);
        if (path === undefined) throw new Error("No file name");
        this.commands.writeFile(path, result.contents);
        return this.viResult(vi.completeSave(result.closeAfter, path));
      } catch (error: unknown) {
        return this.viResult(vi.failSave(message(error)));
      }
    }
    if (result.kind === "closed") {
      this.vi = undefined;
      this.lastExitCode = 0;
      return {
        ...resultFromStreams(
          result.discardedChanges ? "Changes discarded\n" : "vi closed\n",
          "",
          0,
        ),
        resetTerminal: true,
      };
    }
    return {
      ...resultFromStreams("", "", 0),
      terminalScreen: result.screen,
    };
  }

  private submitEditor(line: string): ShellResult {
    const editor = this.editor;
    if (editor === undefined) throw new Error("Editor state is unavailable");
    const keys =
      line === ".save"
        ? ["F2"]
        : line === ".cancel"
          ? ["Alt+f", "x", "n"]
          : [...line, "Enter"];
    this.cpuCyclesValue += keys.length;
    let result: ShellResult = this.editorResult({
      kind: "continue",
      screen: editor.screen(),
    });
    for (const key of keys) {
      if (this.editor === undefined) break;
      result = this.editorResult(this.editor.key(key));
    }
    return result;
  }

  private editorResult(result: EditorResult): ShellResult {
    const editor = this.editor;
    if (editor === undefined) throw new Error("Editor state is unavailable");
    if (result.kind === "save") {
      try {
        this.commands.writeFile(editor.fileName, result.contents);
        return this.editorResult(editor.completeSave(result.closeAfter));
      } catch (error: unknown) {
        return this.editorResult(editor.failSave(message(error)));
      }
    }
    if (result.kind === "closed") {
      this.editor = undefined;
      this.lastExitCode = 0;
      return {
        ...resultFromStreams(
          result.discardedChanges ? "Changes discarded\n" : "EDIT closed\n",
          "",
          0,
        ),
        resetTerminal: true,
      };
    }
    return {
      ...resultFromStreams("", "", 0),
      terminalScreen: result.screen,
    };
  }
}

function ensureLinuxRuntimePresence(
  runtime: OsRuntimeState,
  tick: number,
  hardware: ComputerHardwareProfile,
): void {
  try {
    initializeLinuxRuntimePresence(runtime, tick, hardware);
  } catch (error: unknown) {
    if (runtime.lifecycle.phase === "booting") {
      try {
        runtime.transitionLifecycle({
          kind: "fault",
          reason: `runtime presence failed: ${message(error)}`,
          tick,
        });
      } catch (faultError: unknown) {
        throw new Error(
          `CS-Linux runtime presence failed: ${message(error)}; fault finalization failed: ${message(faultError)}`,
        );
      }
    }
    throw error;
  }
}

function initializeLinuxRuntimePresence(
  runtime: OsRuntimeState,
  tick: number,
  hardware: ComputerHardwareProfile,
): void {
  if (runtime.lifecycle.phase === "running") return;
  if (runtime.lifecycle.phase === "faulted") {
    throw new Error(
      "CS-Linux runtime is faulted; reset or safe boot is required",
    );
  }
  if (runtime.lifecycle.phase === "off") {
    runtime.transitionLifecycle({ kind: "begin_boot", tick });
  }
  if (runtime.lifecycle.phase !== "booting") {
    throw new Error(
      `CS-Linux cannot boot while OS lifecycle is ${runtime.lifecycle.phase}`,
    );
  }

  runtime.appendBootJournal(tick, "CS-Linux 1.0 kernel start");
  runtime.appendBootJournal(
    tick,
    `CPU ${hardware.cpuModel} ${String(hardware.clockHz)} Hz; memory ${String(hardware.memoryBytes)} bytes`,
  );
  if (runtime.process(1) === undefined) {
    runtime.createInitProcess({
      command: "/sbin/cs-init",
      gid: 0,
      startTick: tick,
      state: "running",
      uid: 0,
    });
    runtime.appendSystemJournal(tick, "process 1 started: /sbin/cs-init");
  }

  for (const mount of [
    {
      filesystemType: "csfs",
      options: ["nosuid", "nodev"],
      readOnly: false,
      source: "computer-system",
      target: "/",
    },
    {
      filesystemType: "proc",
      options: ["nosuid", "nodev", "noexec"],
      readOnly: true,
      source: "proc",
      target: "/proc",
    },
    {
      filesystemType: "csdev",
      options: ["nosuid", "noexec"],
      readOnly: false,
      source: "dev",
      target: "/dev",
    },
    {
      filesystemType: "tmpfs",
      options: ["nosuid", "nodev"],
      readOnly: false,
      source: "tmpfs",
      target: "/run",
    },
  ] as const) {
    if (runtime.mounts().some(({ target }) => target === mount.target))
      continue;
    runtime.mount({ ...mount, mountedTick: tick });
    runtime.appendBootJournal(
      tick,
      `${mount.filesystemType} mounted on ${mount.target}`,
    );
  }

  const devices = [
    {
      driver: "mem",
      kind: "character" as const,
      major: 1,
      minor: 3,
      path: "/dev/null",
      readOnly: false,
      state: "available" as const,
    },
    {
      driver: "mem",
      kind: "character" as const,
      major: 1,
      minor: 5,
      path: "/dev/zero",
      readOnly: true,
      state: "available" as const,
    },
    {
      driver: "tty",
      kind: "character" as const,
      major: 5,
      minor: 0,
      path: "/dev/tty",
      readOnly: false,
      state: "available" as const,
    },
    {
      driver: "console",
      kind: "character" as const,
      major: 5,
      minor: 1,
      path: "/dev/console",
      readOnly: false,
      state: "available" as const,
    },
    {
      driver: "tty",
      kind: "character" as const,
      major: 4,
      minor: 1,
      path: "/dev/tty1",
      readOnly: false,
      state: "available" as const,
    },
    {
      driver: "cs-ide",
      kind: "block" as const,
      major: 3,
      minor: 0,
      path: "/dev/hda",
      readOnly: false,
      state: "available" as const,
    },
    {
      driver: "cs-fdc",
      kind: "block" as const,
      major: 2,
      minor: 0,
      path: "/dev/fd0",
      readOnly: false,
      state: "absent" as const,
    },
  ];
  for (const device of devices) {
    const existing = runtime.devices().find(({ path }) => path === device.path);
    if (existing === undefined) {
      runtime.registerDevice({ ...device, tick });
      runtime.appendBootJournal(
        tick,
        `${device.path} ${device.state === "absent" ? "has no media" : "discovered"}`,
      );
    } else if (existing.state !== device.state) {
      runtime.setDeviceState(device.path, device.state, tick);
      runtime.appendBootJournal(
        tick,
        `${device.path} ${device.state === "absent" ? "has no media" : "online"}`,
      );
    }
  }

  let initService = runtime.service("cs-init");
  if (initService === undefined) {
    initService = runtime.registerService({
      enabled: true,
      name: "cs-init",
      tick,
    });
  }
  if (initService.state === "inactive" || initService.state === "failed") {
    initService = runtime.transitionService("cs-init", {
      kind: "start",
      tick,
    });
  }
  if (initService.state === "starting") {
    runtime.transitionService("cs-init", {
      kind: "running",
      pid: 1,
      tick,
    });
  }

  let loginService = runtime.service("cs-login");
  if (loginService === undefined) {
    loginService = runtime.registerService({
      enabled: true,
      name: "cs-login",
      tick,
    });
  }
  if (loginService.state === "inactive" || loginService.state === "failed") {
    loginService = runtime.transitionService("cs-login", {
      kind: "start",
      tick,
    });
  }
  let gettyPid = loginService.pid;
  if (gettyPid === undefined || runtime.process(gettyPid) === undefined) {
    gettyPid = runtime.spawnProcess({
      command: "/sbin/cs-getty tty1",
      gid: 0,
      parentPid: 1,
      startTick: tick,
      state: "running",
      uid: 0,
    }).pid;
    runtime.transitionProcess(gettyPid, {
      kind: "wait",
      reason: "login",
      tick,
    });
  }
  if (loginService.state === "starting") {
    runtime.transitionService("cs-login", {
      kind: "running",
      pid: gettyPid,
      tick,
    });
  }
  runtime.appendBootJournal(
    tick,
    `cs-login service started as process ${String(gettyPid)}`,
  );
  runtime.appendBootJournal(tick, "account database migration verified");
  runtime.transitionLifecycle({ kind: "boot_complete", tick });
  runtime.appendBootJournal(tick, "boot complete");
}

interface IfBranch {
  readonly condition?: string;
  readonly lines: readonly string[];
}

interface IfCompound {
  readonly branches: readonly IfBranch[];
  readonly end: number;
}

function parseIfCompound(
  lines: readonly string[],
  start: number,
): IfCompound | undefined {
  const first = /^if\s+(.+?)\s*;\s*then$/u.exec(lines[start]!.trim());
  if (first === null) return undefined;
  const branches: IfBranch[] = [];
  let condition: string | undefined = first[1];
  let branchStart = start + 1;
  let depth = 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (/^if\s+/u.test(line)) {
      depth += 1;
      continue;
    }
    if (line === "fi") {
      if (depth > 0) {
        depth -= 1;
        continue;
      }
      branches.push({
        ...(condition === undefined ? {} : { condition }),
        lines: lines.slice(branchStart, index),
      });
      return { branches, end: index };
    }
    if (depth !== 0) continue;
    const elif = /^elif\s+(.+?)\s*;\s*then$/u.exec(line);
    if (elif !== null || line === "else") {
      branches.push({
        ...(condition === undefined ? {} : { condition }),
        lines: lines.slice(branchStart, index),
      });
      condition = elif?.[1];
      branchStart = index + 1;
    }
  }
  return undefined;
}

function findCompoundEnd(
  lines: readonly string[],
  start: number,
  terminator: "done",
): number {
  let depth = 0;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!.trim();
    if (/^(?:for|while)\s+/u.test(line) && /\bdo$/u.test(line)) depth += 1;
    else if (line === terminator) {
      if (depth === 0) return index;
      depth -= 1;
    }
  }
  return -1;
}

function findFunctionEnd(lines: readonly string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index]!.trim() === "}") return index;
  }
  return -1;
}

function toCommandResult(result: ShellResult): ShellCommandResult {
  return {
    ...(result.action === undefined ? {} : { action: result.action }),
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdout: result.stdout,
    ...(result.sleepTicks === undefined
      ? {}
      : { sleepTicks: result.sleepTicks }),
    ...(result.terminalScreen === undefined
      ? {}
      : { terminalScreen: result.terminalScreen }),
    ...(result.resetTerminal ? { resetTerminal: true } : {}),
    ...(result.background === undefined
      ? {}
      : { background: result.background }),
    ...(result.foreground === undefined
      ? {}
      : { foreground: result.foreground }),
    ...(result.ioWaitEvent === undefined
      ? {}
      : { ioWaitEvent: result.ioWaitEvent }),
    ...(result.jobControl === undefined
      ? {}
      : { jobControl: result.jobControl }),
  };
}

function mergeCommandResults(
  previous: ShellCommandResult,
  next: ShellCommandResult,
): ShellCommandResult {
  return {
    ...(next.action === undefined ? {} : { action: next.action }),
    exitCode: next.exitCode,
    stderr: previous.stderr + next.stderr,
    stdout: previous.stdout + next.stdout,
    ...(next.sleepTicks === undefined ? {} : { sleepTicks: next.sleepTicks }),
    ...(next.terminalScreen === undefined
      ? {}
      : { terminalScreen: next.terminalScreen }),
    ...(next.resetTerminal ? { resetTerminal: true } : {}),
  };
}

function scriptFailure(label: string, detail: string): ScriptExecution {
  return { flow: "normal", result: commandFailure(label, detail) };
}

function resultFromStreams(
  stdout: string,
  stderr: string,
  exitCode: number,
  action?: ShellAction,
  sleepTicks?: number,
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
    ...(sleepTicks === undefined ? {} : { sleepTicks }),
  };
}

function commandSuccess(stdout = ""): ShellCommandResult {
  return { exitCode: 0, stderr: "", stdout };
}

function commandFailure(
  command: string,
  detail: string,
  exitCode = 1,
): ShellCommandResult {
  return { exitCode, stderr: `${command}: ${detail}\n`, stdout: "" };
}

function commandUsage(usage: string): ShellCommandResult {
  return { exitCode: 2, stderr: `Usage: ${usage}\n`, stdout: "" };
}

function shellResultFromCommand(result: ShellCommandResult): ShellResult {
  return {
    ...resultFromStreams(
      result.stdout,
      result.stderr,
      result.exitCode,
      result.action,
      result.sleepTicks,
    ),
    ...(result.cpuCycles === undefined ? {} : { cpuCycles: result.cpuCycles }),
    ...(result.foreground === undefined
      ? {}
      : { foreground: result.foreground }),
    ...(result.background === undefined
      ? {}
      : { background: result.background }),
    ...(result.ioWaitEvent === undefined
      ? {}
      : { ioWaitEvent: result.ioWaitEvent }),
    ...(result.jobControl === undefined
      ? {}
      : { jobControl: result.jobControl }),
    ...(result.terminalScreen === undefined
      ? {}
      : { terminalScreen: result.terminalScreen }),
    ...(result.resetTerminal ? { resetTerminal: true } : {}),
  };
}

function parseLinuxId(value: string, label: "GID" | "UID"): number {
  if (!/^(?:0|[1-9][0-9]{0,4})$/u.test(value))
    throw new Error(`${label} must be an integer from 0 to 65535`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 65_535)
    throw new Error(`${label} must be an integer from 0 to 65535`);
  return parsed;
}

function commaSeparatedNames(value: string): readonly string[] {
  const names = value.split(",");
  if (
    names.length === 0 ||
    names.length > 32 ||
    names.some((name) => !/^[a-z_][a-z0-9_-]{0,31}$/u.test(name))
  )
    throw new Error("group list is invalid or exceeds 32 groups");
  return [...new Set(names)];
}

function limitHistoryLine(value: string): string {
  const normalized = value.replace(/[\0\r\n]/gu, " ");
  let result = "";
  let bytes = 0;
  for (const character of normalized) {
    const size = utf8ByteLength(character);
    if (bytes + size > maximumHistoryLineBytes) break;
    result += character;
    bytes += size;
  }
  return result;
}

function dosBatchCommandRequiresInteractiveOwner(commandLine: string): boolean {
  const match = /^\s*@?\s*("[^"]+"|\S+)/u.exec(commandLine);
  if (match === null) return false;
  const executable = match[1]!.replace(/^"|"$/gu, "").replaceAll("/", "\\");
  const name = executable
    .slice(executable.lastIndexOf("\\") + 1)
    .replace(/\.(?:BAT|COM|EXE)$/iu, "")
    .toLowerCase();
  return new Set([
    "as",
    "basic",
    "basicc",
    "c",
    "c++",
    "cc",
    "csdb",
    "debug",
    "edit",
    "ld",
    "micropython",
    "python",
    "reboot",
    "run",
    "shutdown",
    "sleep",
    "vi",
  ]).has(name);
}

function hasUnixBatchCompoundSyntax(commandLine: string): boolean {
  let quoted = false;
  for (let index = 0; index < commandLine.length; index += 1) {
    const token = commandLine[index];
    if (token === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    const pair = commandLine.slice(index, index + 2);
    if (pair === "&&" || pair === "||") return true;
  }
  return false;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
