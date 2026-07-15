import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import {
  ShellCommandRuntime,
  type ShellCommandRuntimeOptions,
  type ShellAction,
  type ShellCommandResult,
  type ShellCompletionResult,
  type ShellForegroundRequest,
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
import { LinuxAuthentication } from "./linuxAuthentication.js";
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

export interface ShellResult {
  readonly action?: ShellAction;
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
}

const maximumScriptDepth = 8;
const maximumScriptLines = 256;
const maximumScriptLoopIterations = 1_024;
const maximumDosConfigLines = 64;
const maximumPipelineBuffer = 256_000;
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

export class ShellSession {
  private readonly authentication: LinuxAuthentication;
  private editor: DosEditSession | undefined;
  private vi: ViSession | undefined;
  private readonly commands: ShellCommandRuntime;
  private readonly frontend: ShellFrontend;
  private readonly hardware: ComputerHardwareProfile;
  private readonly history: string[] = [];
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
    const runtimeOptions: ShellCommandRuntimeOptions = {
      clock:
        options.clock ?? createVirtualShellClock(currentTick, ticksPerSecond),
      computerId: options.computerId ?? 0,
      computerName: options.computerName ?? "c-000000",
      currentTick,
      profile,
      ticksPerSecond,
      hardware: options.hardware ?? defaultComputerHardware,
      memoryUsageBytes: options.memoryUsageBytes ?? ((): number => 0),
      virtualDevices: options.virtualDevices,
      peripherals: options.peripherals,
      deferGuestExecution: options.deferGuestExecution,
      requestFilesystemIo: options.requestFilesystemIo,
    };
    this.hardware = runtimeOptions.hardware;
    profile.boot(filesystem, { computerName: runtimeOptions.computerName });
    this.authentication = new LinuxAuthentication(filesystem, {
      enabled: options.requireLogin === true && profile.id === "linux",
      salt: options.passwordSalt,
    });
    this.commands = new ShellCommandRuntime(filesystem, runtimeOptions);
    if (profile.id === "linux") {
      for (const path of ["/etc/bash.bashrc", `${profile.home}/.bashrc`]) {
        const loaded = this.executeScript("source", [path], "", 0);
        const text = `${loaded.stderr}${loaded.stdout}`.trimEnd();
        if (text.length > 0) this.startupLines.push(...text.split("\n"));
      }
    } else {
      for (const loaded of [
        this.loadDosConfiguration("C:\\CONFIG.SYS"),
        this.executeDosBatch("C:\\AUTOEXEC.BAT", [], 0),
      ]) {
        const text = `${loaded.stderr}${loaded.stdout}`.trimEnd();
        if (text.length > 0) this.startupLines.push(...text.split(/\r?\n/u));
      }
    }
    this.startupLines.push(...this.authentication.startupLines());
  }

  prompt(): string {
    if (this.vi !== undefined || this.editor !== undefined) return "";
    const authenticationPrompt = this.authentication.prompt();
    if (authenticationPrompt !== undefined) return authenticationPrompt;
    return this.commands.prompt();
  }

  isSecretInput(): boolean {
    return this.authentication.isSecretInput();
  }

  writeCompilerOutput(path: string, contents: string): void {
    this.commands.writeFile(path, contents);
  }

  takeStartupLines(): readonly string[] {
    return this.startupLines.splice(0);
  }

  submit(line: string): ShellResult {
    this.cpuCyclesValue = 0;
    this.commands.beginFilesystemIo();
    let result: ShellResult;
    if (this.vi !== undefined) result = this.submitViLine(line);
    else if (this.editor !== undefined) result = this.submitEditor(line);
    else if (!this.authentication.isAuthenticated()) {
      const authentication = this.authentication.submit(line);
      result = resultFromStreams(
        authentication.stdout,
        authentication.stderr,
        authentication.exitCode,
        undefined,
        authentication.sleepTicks,
      );
    } else {
      if (line.trim().length > 0) {
        this.history.push(line);
        if (this.history.length > 100) this.history.shift();
      }
      result = this.executeLine(line, 0);
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
    return this.withCpuCycles(result);
  }

  submitDebugCommand(line: string): ShellResult {
    if (!this.authentication.isAuthenticated()) {
      return resultFromStreams(
        "",
        "debug: CS-Linux login is required before MCP command execution\n",
        2,
      );
    }
    if (this.vi !== undefined || this.editor !== undefined) {
      return resultFromStreams(
        "",
        "debug: interactive editor session is active\n",
        2,
      );
    }
    this.suppressFilesystemWait = true;
    let result: ShellResult;
    try {
      result = this.submit(line);
    } finally {
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
    if (
      result.action !== undefined ||
      result.ioWaitEvent !== undefined ||
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

  completeForegroundProcess(exitCode: number): void {
    this.lastExitCode = exitCode;
  }

  complete(line: string, cursor: number): ShellCompletionResult {
    if (
      !this.authentication.isAuthenticated() ||
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
    this.cpuCyclesValue = keys.length;
    if (!this.authentication.isAuthenticated())
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

  private executeLine(line: string, depth: number): ShellResult {
    const frame = this.scriptFrames.at(-1);
    const prepared = this.frontend.prepare(line, this.commands, {
      arguments: frame?.arguments ?? [],
      lastExitCode: this.lastExitCode,
      scriptName: frame?.name ?? "",
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
    let stdin = "";
    let stderr = "";
    let exitCode = 0;
    let action: ShellAction | undefined;
    let sleepTicks: number | undefined;
    let terminalScreen: EditorScreen | undefined;
    let resetTerminal = false;
    let foreground: ShellForegroundRequest | undefined;
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
    };
  }

  private commandError(command: string, error: unknown): string {
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
          kind: "python",
          path: this.commands.resolvePath(pathArgument),
          stats,
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
    if (this.scriptFrames.length === 0) this.scriptLoopIterations = 0;
    this.scriptFrames.push({
      arguments: arguments_.slice(0, 9),
      name: this.commands.profile.pathDialect.display(path),
    });
    this.dosBatchDepth += 1;
    try {
      return this.executeScriptLines(lines, depth + 1, path).result;
    } finally {
      this.dosBatchDepth -= 1;
      this.scriptFrames.pop();
    }
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
          this.commands.setVariable("CONFIG_XMS", "ON");
          continue;
        }
        if (driver === "EMM386.EXE" || driver.endsWith("\\EMM386.EXE")) {
          if (arguments_ !== "" && arguments_ !== "NOEMS") {
            stderr += `CONFIG.SYS line ${String(index + 1)}: EMM386 supports only NOEMS\r\n`;
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
        path !== undefined && this.filesystem.exists(path)
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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
