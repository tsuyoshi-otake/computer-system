import type { InMemoryFilesystem } from "../../domain/filesystem/inMemoryFilesystem.js";
import { utf8ByteLength } from "../../domain/text/utf8.js";
import {
  ShellCommandRuntime,
  type ShellCommandRuntimeOptions,
  type ShellAction,
  type ShellCommandResult,
  type ShellCompletionResult,
} from "./shellCommands.js";
import type { ComputerOsProfile } from "../../domain/computer/computer.js";
import {
  defaultComputerHardware,
  type ComputerHardwareProfile,
} from "../../domain/computer/hardware.js";
import { createVirtualShellClock, type ShellClockSource } from "./clock.js";
import { getOsProfile } from "./osProfile.js";
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
}

const maximumScriptDepth = 8;
const maximumScriptLines = 256;
const maximumScriptLoopIterations = 1_024;
const maximumDosConfigLines = 64;
const maximumPipelineBuffer = 256_000;
const variableMarkerStart = "\u{e000}";
const variableMarkerEnd = "\u{e001}";
const dosBackslashMarker = "\u{e002}";

interface ScriptFrame {
  readonly arguments: readonly string[];
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
  private readonly history: string[] = [];
  private lastExitCode = 0;
  private readonly scriptFrames: ScriptFrame[] = [];
  private readonly shellFunctions = new Map<string, readonly string[]>();
  private scriptLoopIterations = 0;
  private readonly startupLines: string[] = [];
  private terminalHeight: number;
  private terminalWidth: number;
  private cpuCyclesValue = 0;
  private dosBatchDepth = 0;

  constructor(
    private readonly filesystem: InMemoryFilesystem,
    options: ShellSessionOptions = {},
  ) {
    this.terminalWidth = options.terminalWidth ?? 51;
    this.terminalHeight = options.terminalHeight ?? 19;
    const profile = getOsProfile(options.osProfile ?? "linux");
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
    };
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

  takeStartupLines(): readonly string[] {
    return this.startupLines.splice(0);
  }

  submit(line: string): ShellResult {
    this.cpuCyclesValue = 0;
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
    const result = this.submit(line);
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
    if (this.commands.profile.id === "dos") {
      const frame = this.scriptFrames.at(-1);
      line = this.commands.expandDosVariables(
        line,
        frame?.name ?? "",
        frame?.arguments ?? [],
        this.lastExitCode,
      );
      const control = this.commands.executeDosControlLine(line);
      if (control !== undefined) {
        this.cpuCyclesValue += 4;
        this.lastExitCode = control.exitCode;
        return resultFromStreams(
          control.stdout,
          control.stderr,
          control.exitCode,
          control.action,
          control.sleepTicks,
        );
      }
      line = line.trimStart().replace(/^@/u, "");
    }
    let program;
    try {
      const source =
        this.commands.profile.id === "dos"
          ? line.replaceAll("\\", dosBackslashMarker)
          : line;
      program = parseShellProgram(
        source,
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
  ): ShellCommandResult {
    let stdin = "";
    let stderr = "";
    let exitCode = 0;
    let action: ShellAction | undefined;
    let sleepTicks: number | undefined;
    let terminalScreen: EditorScreen | undefined;
    let resetTerminal = false;
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
      sleepTicks = executed.sleepTicks;
      terminalScreen = executed.terminalScreen;
      resetTerminal = executed.resetTerminal ?? false;
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
      if (sleepTicks !== undefined) break;
    }
    return {
      ...(action === undefined ? {} : { action }),
      exitCode,
      stderr,
      stdout: stdin,
      ...(sleepTicks === undefined ? {} : { sleepTicks }),
      ...(terminalScreen === undefined ? {} : { terminalScreen }),
      ...(resetTerminal ? { resetTerminal: true } : {}),
    };
  }

  private expandCommand(command: ShellCommandNode): ShellCommandNode {
    const expand = (value: string): string =>
      value
        .replace(
          /\u{e000}([A-Za-z_][A-Za-z0-9_]*|[?#@*]|[0-9]+)\u{e001}/gu,
          (_match, name: string) => this.resolveVariable(name),
        )
        .replaceAll(dosBackslashMarker, "\\");
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
    this.cpuCyclesValue += 8;
    const [requestedName = "", ...arguments_] = command.words;
    const name = this.commands.canonicalCommand(requestedName);
    const functionBody = this.shellFunctions.get(name);
    if (functionBody !== undefined) {
      if (depth >= maximumScriptDepth)
        return commandFailure(name, "maximum function depth exceeded");
      if (this.scriptFrames.length === 0) this.scriptLoopIterations = 0;
      this.scriptFrames.push({ arguments: arguments_, name });
      try {
        return this.executeScriptLines(functionBody, depth + 1, name).result;
      } finally {
        this.scriptFrames.pop();
      }
    }
    if (name === "history") {
      if (arguments_.length > 0) return commandUsage("history");
      return commandSuccess(
        `${this.history.map((value, index) => `${String(index + 1).padStart(5)}  ${value}`).join("\n")}\n`,
      );
    }
    if (name === "time") {
      if (arguments_.length === 0) return commandUsage("time <command ...>");
      const startedAt = this.commands.currentTick();
      const timed = this.executeCommand(
        { words: arguments_, redirects: [] },
        stdin,
        depth,
        false,
      );
      const elapsed =
        (this.commands.currentTick() - startedAt) /
        this.commands.ticksPerSecond();
      return {
        ...timed,
        stderr: `${timed.stderr}real ${elapsed.toFixed(3)}s\n`,
      };
    }
    if (name === "vi") {
      if (!interactiveAllowed || command.redirects.length > 0) {
        return commandFailure(name, "cannot run in a pipeline or redirect");
      }
      return this.startVi(arguments_);
    }
    if (name === "edit" && this.commands.profile.id === "dos") {
      if (!interactiveAllowed || command.redirects.length > 0) {
        return commandFailure(name, "cannot run in a pipeline or redirect");
      }
      return this.startEditor(arguments_);
    }
    if (name === "sh" || name === "bash" || name === "source") {
      return this.executeScript(name, arguments_, stdin, depth);
    }
    if (
      this.commands.profile.id === "dos" &&
      !this.commands.isBuiltInCommand(requestedName)
    ) {
      const program = this.commands.resolveDosProgram(requestedName);
      if (program?.kind === "batch")
        return this.executeDosBatch(program.path, arguments_, depth);
      if (program?.kind === "executable")
        return this.commands.execute([program.path, ...arguments_], stdin);
    }
    const result = this.commands.execute(command.words, stdin);
    this.cpuCyclesValue += result.cpuCycles ?? 0;
    return result;
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
    let scriptArguments: readonly string[];
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
    if (arguments_.length !== 1) return commandUsage("vi <path>");
    const path = this.commands.resolvePath(arguments_[0]!);
    try {
      const existing = this.filesystem.exists(path)
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
        this.commands.writeFile(vi.fileName, result.contents);
        return this.viResult(vi.completeSave(result.closeAfter));
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

function commandFailure(command: string, detail: string): ShellCommandResult {
  return { exitCode: 1, stderr: `${command}: ${detail}\n`, stdout: "" };
}

function commandUsage(usage: string): ShellCommandResult {
  return { exitCode: 2, stderr: `Usage: ${usage}\n`, stdout: "" };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
