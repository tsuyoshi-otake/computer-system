export interface DosBatchLimits {
  readonly maximumArguments: number;
  readonly maximumCallDepth: number;
  readonly maximumCommandCharacters: number;
  readonly maximumCommandNesting: number;
  readonly maximumJumps: number;
  readonly maximumLabels: number;
  readonly maximumLines: number;
  readonly maximumLoadedPrograms: number;
  readonly maximumOutputCharacters: number;
  readonly maximumSteps: number;
}

export const defaultDosBatchLimits: DosBatchLimits = Object.freeze({
  maximumArguments: 9,
  maximumCallDepth: 8,
  maximumCommandCharacters: 4_096,
  maximumCommandNesting: 16,
  maximumJumps: 1_024,
  maximumLabels: 256,
  maximumLines: 256,
  maximumLoadedPrograms: 64,
  maximumOutputCharacters: 256_000,
  maximumSteps: 4_096,
});

export interface DosBatchProgramInput {
  readonly arguments?: readonly string[];
  readonly initialEcho?: boolean;
  readonly name: string;
  readonly source: string;
}

export interface DosBatchCommandContext {
  readonly errorLevel: number;
  readonly lineNumber: number;
  readonly programName: string;
  readonly scriptArguments: readonly string[];
}

export interface DosBatchCommandResult {
  readonly exitCode: number;
  readonly stderr?: string;
  readonly stdout?: string;
  /**
   * The command accepted ownership of terminal input. The engine preserves its
   * exact frame and resumes only through the result object's resume function.
   */
  readonly suspended?: boolean;
}

export interface DosBatchLoadedProgram {
  readonly name?: string;
  readonly source: string;
}

export interface DosBatchCallbacks {
  execute(
    commandLine: string,
    context: DosBatchCommandContext,
  ): DosBatchCommandResult;
  exists(path: string, context: DosBatchCommandContext): boolean;
  getEnvironment?(
    name: string,
    context: DosBatchCommandContext,
  ): string | undefined;
  loadBatch?(
    path: string,
    context: DosBatchCommandContext,
  ): DosBatchLoadedProgram | undefined;
}

export type DosBatchFailureCode =
  | "argument_limit"
  | "batch_not_found"
  | "call_depth_limit"
  | "callback_error"
  | "command_length_limit"
  | "command_nesting_limit"
  | "duplicate_label"
  | "invalid_callback_result"
  | "jump_limit"
  | "label_limit"
  | "label_not_found"
  | "line_limit"
  | "loaded_program_limit"
  | "output_limit"
  | "step_limit"
  | "syntax_error";

export interface DosBatchFailure {
  readonly code: DosBatchFailureCode;
  readonly detail: string;
  readonly lineNumber: number;
  readonly programName: string;
}

export interface DosBatchMetrics {
  readonly calls: number;
  readonly echoEnabled: boolean;
  readonly jumps: number;
  readonly loadedPrograms: number;
  readonly steps: number;
}

export interface DosBatchCompletedResult extends DosBatchMetrics {
  readonly exitCode: number;
  readonly kind: "completed";
  readonly stderr: string;
  readonly stdout: string;
}

export interface DosBatchFailedResult extends DosBatchMetrics {
  readonly exitCode: number;
  readonly failure: DosBatchFailure;
  readonly kind: "failed";
  readonly stderr: string;
  readonly stdout: string;
}

export interface DosBatchSuspendedResult extends DosBatchMetrics {
  readonly exitCode: number;
  readonly kind: "suspended";
  readonly stderr: string;
  readonly stdout: string;
  resume(result: DosBatchCommandResult): DosBatchExecutionResult;
}

export type DosBatchExecutionResult =
  DosBatchCompletedResult | DosBatchFailedResult | DosBatchSuspendedResult;

interface CompiledDosBatchProgram {
  readonly labels: ReadonlyMap<string, number>;
  readonly lines: readonly string[];
  readonly name: string;
}

interface DosBatchFrame {
  readonly arguments: string[];
  readonly program: CompiledDosBatchProgram;
  instruction: number;
}

interface DosBatchExecutionState {
  readonly callbacks: DosBatchCallbacks;
  calls: number;
  echo: boolean;
  errorLevel: number;
  readonly frames: DosBatchFrame[];
  jumps: number;
  loadedPrograms: number;
  outputCharacters: number;
  readonly stderr: string[];
  readonly stdout: string[];
  steps: number;
}

interface StatementLocation {
  readonly lineNumber: number;
  readonly programName: string;
}

class DosBatchSuspension extends Error {
  constructor(readonly location: StatementLocation) {
    super("DOS batch execution suspended");
    this.name = "DosBatchSuspension";
  }
}

/**
 * Dedicated bounded COMMAND.COM-style batch control. Host commands, filesystem
 * existence checks, environment reads, and external BAT loading are explicit
 * callbacks; this engine never reaches a host shell or filesystem itself.
 */
export class DosBatchEngine {
  readonly limits: DosBatchLimits;

  constructor(limits: Partial<DosBatchLimits> = {}) {
    this.limits = Object.freeze({ ...defaultDosBatchLimits, ...limits });
    for (const [name, value] of Object.entries(this.limits)) {
      if (!Number.isSafeInteger(value) || value < 1) {
        throw new RangeError(`${name} must be a positive integer`);
      }
    }
  }

  execute(
    input: DosBatchProgramInput,
    callbacks: DosBatchCallbacks,
  ): DosBatchExecutionResult {
    const state: DosBatchExecutionState = {
      callbacks,
      calls: 0,
      echo: input.initialEcho ?? true,
      errorLevel: 0,
      frames: [],
      jumps: 0,
      loadedPrograms: 0,
      outputCharacters: 0,
      stderr: [],
      stdout: [],
      steps: 0,
    };
    const rootArguments = [...(input.arguments ?? [])];
    if (rootArguments.length > this.limits.maximumArguments) {
      return this.failed(
        state,
        failure(
          "argument_limit",
          input.name,
          0,
          `batch arguments exceed ${String(this.limits.maximumArguments)}`,
        ),
      );
    }
    const compiled = this.compile(input.name, input.source);
    if ("failure" in compiled) return this.failed(state, compiled.failure);
    state.loadedPrograms = 1;
    state.frames.push({
      arguments: rootArguments,
      instruction: 0,
      program: compiled.program,
    });

    return this.run(state);
  }

  /** Executes one COMMAND /C payload through the same bounds and callbacks. */
  executeCommand(
    commandLine: string,
    callbacks: DosBatchCallbacks,
  ): DosBatchExecutionResult {
    return this.execute(
      { name: "COMMAND.COM", source: `@COMMAND /C ${commandLine}` },
      callbacks,
    );
  }

  private run(state: DosBatchExecutionState): DosBatchExecutionResult {
    try {
      while (state.frames.length > 0) {
        const frame = state.frames.at(-1)!;
        if (frame.instruction >= frame.program.lines.length) {
          state.frames.pop();
          continue;
        }
        const lineIndex = frame.instruction;
        frame.instruction += 1;
        const location = {
          lineNumber: lineIndex + 1,
          programName: frame.program.name,
        };
        const stepFailure = this.consumeStep(state, location);
        if (stepFailure !== undefined) return this.failed(state, stepFailure);
        const lineFailure = this.executeSourceLine(
          state,
          frame,
          frame.program.lines[lineIndex]!,
          location,
        );
        if (lineFailure !== undefined) return this.failed(state, lineFailure);
      }
    } catch (error: unknown) {
      if (error instanceof DosBatchSuspension)
        return this.suspended(state, error.location);
      throw error;
    }
    return Object.freeze({
      ...this.metrics(state),
      exitCode: state.errorLevel,
      kind: "completed",
      stderr: state.stderr.join(""),
      stdout: state.stdout.join(""),
    });
  }

  private executeSourceLine(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    sourceLine: string,
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    let line = sourceLine.trim();
    if (line.length === 0 || isLabelLine(line) || line.startsWith("::")) {
      return undefined;
    }
    const suppressEcho = line.startsWith("@");
    if (suppressEcho) line = line.slice(1).trimStart();
    if (line.length === 0) return undefined;
    const expanded = this.expandVariables(state, frame, line, location);
    if ("failure" in expanded) return expanded.failure;
    if (state.echo && !suppressEcho) {
      const outputFailure = this.appendOutput(
        state,
        "stdout",
        `${expanded.value}\r\n`,
        location,
      );
      if (outputFailure !== undefined) return outputFailure;
    }
    return this.executeStatement(state, frame, expanded.value, location, 0);
  }

  private executeStatement(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    source: string,
    location: StatementLocation,
    nesting: number,
  ): DosBatchFailure | undefined {
    if (nesting >= this.limits.maximumCommandNesting) {
      return failure(
        "command_nesting_limit",
        location.programName,
        location.lineNumber,
        `inline command nesting exceeds ${String(this.limits.maximumCommandNesting)}`,
      );
    }
    const line = source.trim();
    if (line.length === 0) return undefined;
    if (line.length > this.limits.maximumCommandCharacters) {
      return failure(
        "command_length_limit",
        location.programName,
        location.lineNumber,
        `expanded command exceeds ${String(this.limits.maximumCommandCharacters)} characters`,
      );
    }
    if (/^REM(?:\s|$)/iu.test(line) || line.startsWith("::")) return undefined;
    if (hasUnixCommandChain(line)) {
      return syntaxFailure(
        location,
        "Unix && and || command chains are not supported in batch files",
      );
    }

    const echo = /^ECHO(?:\s+(ON|OFF))?\s*$/iu.exec(line);
    if (echo !== null && echo[1] !== undefined) {
      state.echo = echo[1].toUpperCase() === "ON";
      return undefined;
    }

    if (/^GOTO(?:\s|$)/iu.test(line)) {
      const parsed = /^GOTO\s+:?([^\s:]+)\s*$/iu.exec(line);
      if (parsed === null)
        return syntaxFailure(location, "invalid GOTO syntax");
      return this.goto(state, frame, parsed[1]!, location);
    }

    if (/^CALL(?:\s|$)/iu.test(line)) {
      const parsed = tokenizeDosWords(
        line.slice(4).trim(),
        this.limits.maximumArguments + 1,
      );
      if ("failure" in parsed) return syntaxFailure(location, parsed.failure);
      const target = parsed.words[0];
      if (target === undefined)
        return syntaxFailure(location, "CALL requires a target");
      const arguments_ = parsed.words.slice(1);
      if (arguments_.length > this.limits.maximumArguments) {
        return failure(
          "argument_limit",
          location.programName,
          location.lineNumber,
          `CALL arguments exceed ${String(this.limits.maximumArguments)}`,
        );
      }
      return target.startsWith(":")
        ? this.callLabel(state, frame, target.slice(1), arguments_, location)
        : this.callBatch(state, target, arguments_, location);
    }

    if (/^SHIFT(?:\s|$)/iu.test(line)) {
      if (!/^SHIFT\s*$/iu.test(line)) {
        return syntaxFailure(location, "SHIFT accepts no options");
      }
      frame.arguments.shift();
      return undefined;
    }

    if (/^IF(?:\s|$)/iu.test(line)) {
      return this.executeIf(state, frame, line, location, nesting);
    }

    const commandPayload = commandPayloadFromLine(line);
    if (commandPayload !== undefined) {
      if (commandPayload.length === 0) {
        return syntaxFailure(location, "COMMAND /C or /K requires a command");
      }
      return this.executeHostCommand(state, frame, commandPayload, location);
    }
    if (looksLikeCommandInterpreter(line)) {
      return syntaxFailure(location, "only COMMAND /C and /K are supported");
    }

    return this.executeHostCommand(state, frame, line, location);
  }

  private executeIf(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    line: string,
    location: StatementLocation,
    nesting: number,
  ): DosBatchFailure | undefined {
    const header = /^IF\s+(NOT\s+)?(.+)$/iu.exec(line);
    if (header === null) return syntaxFailure(location, "invalid IF syntax");
    const negated = header[1] !== undefined;
    const condition = header[2]!;
    const errorLevel = /^ERRORLEVEL\s+([0-9]{1,3})\s+(.+)$/iu.exec(condition);
    let matches: boolean;
    let command: string;
    if (errorLevel !== null) {
      const threshold = Number(errorLevel[1]);
      if (threshold > 255) {
        return syntaxFailure(
          location,
          "IF ERRORLEVEL must be between 0 and 255",
        );
      }
      matches = state.errorLevel >= threshold;
      command = errorLevel[2]!;
    } else {
      const exists = /^EXIST\s+("[^"]*"|\S+)\s+(.+)$/iu.exec(condition);
      if (exists === null) {
        return syntaxFailure(
          location,
          "IF supports only [NOT] ERRORLEVEL and [NOT] EXIST",
        );
      }
      const path = unquoteDosWord(exists[1]!);
      try {
        matches = state.callbacks.exists(
          path,
          this.context(state, frame, location),
        );
      } catch (error: unknown) {
        return callbackFailure(location, error);
      }
      command = exists[2]!;
    }
    if (negated) matches = !matches;
    if (!matches) return undefined;
    const stepFailure = this.consumeStep(state, location);
    if (stepFailure !== undefined) return stepFailure;
    return this.executeStatement(state, frame, command, location, nesting + 1);
  }

  private goto(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    label: string,
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    state.jumps += 1;
    if (state.jumps > this.limits.maximumJumps) {
      return failure(
        "jump_limit",
        location.programName,
        location.lineNumber,
        `batch jumps exceed ${String(this.limits.maximumJumps)}`,
      );
    }
    if (label.toUpperCase() === "EOF") {
      state.frames.pop();
      return undefined;
    }
    const destination = frame.program.labels.get(normalizeLabel(label));
    if (destination === undefined) {
      return failure(
        "label_not_found",
        location.programName,
        location.lineNumber,
        `label not found: ${label}`,
      );
    }
    frame.instruction = destination;
    return undefined;
  }

  private callLabel(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    label: string,
    arguments_: readonly string[],
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    const destination = frame.program.labels.get(normalizeLabel(label));
    if (destination === undefined) {
      return failure(
        "label_not_found",
        location.programName,
        location.lineNumber,
        `label not found: ${label}`,
      );
    }
    const depthFailure = this.consumeCall(state, location);
    if (depthFailure !== undefined) return depthFailure;
    state.frames.push({
      arguments: [...arguments_],
      instruction: destination,
      program: frame.program,
    });
    return undefined;
  }

  private callBatch(
    state: DosBatchExecutionState,
    path: string,
    arguments_: readonly string[],
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    const depthFailure = this.consumeCall(state, location);
    if (depthFailure !== undefined) return depthFailure;
    if (state.loadedPrograms >= this.limits.maximumLoadedPrograms) {
      return failure(
        "loaded_program_limit",
        location.programName,
        location.lineNumber,
        `loaded batch programs exceed ${String(this.limits.maximumLoadedPrograms)}`,
      );
    }
    let loaded: DosBatchLoadedProgram | undefined;
    try {
      loaded = state.callbacks.loadBatch?.(
        path,
        this.context(state, state.frames.at(-1)!, location),
      );
    } catch (error: unknown) {
      return callbackFailure(location, error);
    }
    if (loaded === undefined) {
      return failure(
        "batch_not_found",
        location.programName,
        location.lineNumber,
        `batch file not found: ${path}`,
      );
    }
    const compiled = this.compile(loaded.name ?? path, loaded.source);
    if ("failure" in compiled) return compiled.failure;
    state.loadedPrograms += 1;
    state.frames.push({
      arguments: [...arguments_],
      instruction: 0,
      program: compiled.program,
    });
    return undefined;
  }

  private consumeCall(
    state: DosBatchExecutionState,
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    if (state.frames.length >= this.limits.maximumCallDepth) {
      return failure(
        "call_depth_limit",
        location.programName,
        location.lineNumber,
        `batch call depth exceeds ${String(this.limits.maximumCallDepth)}`,
      );
    }
    state.calls += 1;
    return undefined;
  }

  private executeHostCommand(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    commandLine: string,
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    let result: DosBatchCommandResult;
    try {
      result = state.callbacks.execute(
        commandLine,
        this.context(state, frame, location),
      );
    } catch (error: unknown) {
      return callbackFailure(location, error);
    }
    const outputFailure = this.applyCommandResult(
      state,
      result,
      location,
      true,
    );
    if (outputFailure !== undefined) return outputFailure;
    if (result.suspended === true) throw new DosBatchSuspension(location);
    state.errorLevel = result.exitCode;
    return undefined;
  }

  private applyCommandResult(
    state: DosBatchExecutionState,
    result: DosBatchCommandResult,
    location: StatementLocation,
    allowSuspension: boolean,
  ): DosBatchFailure | undefined {
    if (
      typeof result !== "object" ||
      result === null ||
      !Number.isSafeInteger(result.exitCode) ||
      result.exitCode < 0 ||
      result.exitCode > 255 ||
      (result.stdout !== undefined && typeof result.stdout !== "string") ||
      (result.stderr !== undefined && typeof result.stderr !== "string") ||
      (result.suspended !== undefined &&
        typeof result.suspended !== "boolean") ||
      (result.suspended === true && !allowSuspension)
    ) {
      return failure(
        "invalid_callback_result",
        location.programName,
        location.lineNumber,
        "host command returned an invalid result",
      );
    }
    const stdoutFailure = this.appendOutput(
      state,
      "stdout",
      result.stdout ?? "",
      location,
    );
    if (stdoutFailure !== undefined) return stdoutFailure;
    const stderrFailure = this.appendOutput(
      state,
      "stderr",
      result.stderr ?? "",
      location,
    );
    if (stderrFailure !== undefined) return stderrFailure;
    return undefined;
  }

  private suspended(
    state: DosBatchExecutionState,
    location: StatementLocation,
  ): DosBatchSuspendedResult {
    let resumed: DosBatchExecutionResult | undefined;
    const resume = (result: DosBatchCommandResult): DosBatchExecutionResult => {
      if (resumed !== undefined) return resumed;
      const outputFailure = this.applyCommandResult(
        state,
        result,
        location,
        false,
      );
      if (outputFailure !== undefined) {
        resumed = this.failed(state, outputFailure);
        return resumed;
      }
      state.errorLevel = result.exitCode;
      resumed = this.run(state);
      return resumed;
    };
    return Object.freeze({
      ...this.metrics(state),
      exitCode: state.errorLevel,
      kind: "suspended",
      resume,
      stderr: state.stderr.join(""),
      stdout: state.stdout.join(""),
    });
  }

  private expandVariables(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    source: string,
    location: StatementLocation,
  ): { readonly failure: DosBatchFailure } | { readonly value: string } {
    let output = "";
    const append = (value: string): DosBatchFailure | undefined => {
      if (output.length + value.length > this.limits.maximumCommandCharacters) {
        return failure(
          "command_length_limit",
          location.programName,
          location.lineNumber,
          `expanded command exceeds ${String(this.limits.maximumCommandCharacters)} characters`,
        );
      }
      output += value;
      return undefined;
    };
    for (let index = 0; index < source.length;) {
      if (source[index] !== "%") {
        const next = source.indexOf("%", index);
        const end = next < 0 ? source.length : next;
        const appendFailure = append(source.slice(index, end));
        if (appendFailure !== undefined) return { failure: appendFailure };
        index = end;
        continue;
      }
      const token = source[index + 1];
      if (token === "%") {
        const appendFailure = append("%");
        if (appendFailure !== undefined) return { failure: appendFailure };
        index += 2;
        continue;
      }
      if (token !== undefined && /^[0-9*]$/u.test(token)) {
        const value =
          token === "0"
            ? frame.program.name
            : token === "*"
              ? frame.arguments.join(" ")
              : (frame.arguments[Number(token) - 1] ?? "");
        const appendFailure = append(value);
        if (appendFailure !== undefined) return { failure: appendFailure };
        index += 2;
        continue;
      }
      const close = source.indexOf("%", index + 1);
      if (close > index + 1) {
        const name = source.slice(index + 1, close);
        if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
          let value: string | undefined;
          if (name.toUpperCase() === "ERRORLEVEL") {
            value = String(state.errorLevel);
          } else {
            try {
              value = state.callbacks.getEnvironment?.(
                name.toUpperCase(),
                this.context(state, frame, location),
              );
            } catch (error: unknown) {
              return { failure: callbackFailure(location, error) };
            }
          }
          const appendFailure = append(value ?? "");
          if (appendFailure !== undefined) return { failure: appendFailure };
          index = close + 1;
          continue;
        }
      }
      const appendFailure = append("%");
      if (appendFailure !== undefined) return { failure: appendFailure };
      index += 1;
    }
    return { value: output };
  }

  private appendOutput(
    state: DosBatchExecutionState,
    channel: "stderr" | "stdout",
    value: string,
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    if (value.length === 0) return undefined;
    if (
      value.length >
      this.limits.maximumOutputCharacters - state.outputCharacters
    ) {
      return failure(
        "output_limit",
        location.programName,
        location.lineNumber,
        `batch output exceeds ${String(this.limits.maximumOutputCharacters)} characters`,
      );
    }
    state[channel].push(value);
    state.outputCharacters += value.length;
    return undefined;
  }

  private consumeStep(
    state: DosBatchExecutionState,
    location: StatementLocation,
  ): DosBatchFailure | undefined {
    state.steps += 1;
    if (state.steps <= this.limits.maximumSteps) return undefined;
    return failure(
      "step_limit",
      location.programName,
      location.lineNumber,
      `batch steps exceed ${String(this.limits.maximumSteps)}`,
    );
  }

  private context(
    state: DosBatchExecutionState,
    frame: DosBatchFrame,
    location: StatementLocation,
  ): DosBatchCommandContext {
    return Object.freeze({
      errorLevel: state.errorLevel,
      lineNumber: location.lineNumber,
      programName: location.programName,
      scriptArguments: Object.freeze([...frame.arguments]),
    });
  }

  private compile(
    name: string,
    source: string,
  ):
    | { readonly failure: DosBatchFailure }
    | { readonly program: CompiledDosBatchProgram } {
    if (
      name.length === 0 ||
      name.length > this.limits.maximumCommandCharacters
    ) {
      return {
        failure: failure(
          "command_length_limit",
          name || "<batch>",
          0,
          "batch program name is empty or too long",
        ),
      };
    }
    const lines = source
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .split("\n");
    if (lines.length > this.limits.maximumLines) {
      return {
        failure: failure(
          "line_limit",
          name,
          0,
          `batch lines exceed ${String(this.limits.maximumLines)}`,
        ),
      };
    }
    const labels = new Map<string, number>();
    for (const [index, sourceLine] of lines.entries()) {
      if (sourceLine.length > this.limits.maximumCommandCharacters) {
        return {
          failure: failure(
            "command_length_limit",
            name,
            index + 1,
            `batch line exceeds ${String(this.limits.maximumCommandCharacters)} characters`,
          ),
        };
      }
      const parsed = parseLabelLine(sourceLine);
      if (parsed === undefined) continue;
      const label = normalizeLabel(parsed);
      if (labels.has(label)) {
        return {
          failure: failure(
            "duplicate_label",
            name,
            index + 1,
            `duplicate label: ${parsed}`,
          ),
        };
      }
      if (labels.size >= this.limits.maximumLabels) {
        return {
          failure: failure(
            "label_limit",
            name,
            index + 1,
            `batch labels exceed ${String(this.limits.maximumLabels)}`,
          ),
        };
      }
      labels.set(label, index + 1);
    }
    return {
      program: Object.freeze({
        labels,
        lines: Object.freeze(lines),
        name,
      }),
    };
  }

  private failed(
    state: DosBatchExecutionState,
    batchFailure: DosBatchFailure,
  ): DosBatchFailedResult {
    const diagnostic = `${batchFailure.programName}(${String(batchFailure.lineNumber)}): ${batchFailure.code}: ${batchFailure.detail}\r\n`;
    const available =
      this.limits.maximumOutputCharacters - state.outputCharacters;
    if (available > 0) {
      const bounded = diagnostic.slice(0, available);
      state.stderr.push(bounded);
      state.outputCharacters += bounded.length;
    }
    return Object.freeze({
      ...this.metrics(state),
      exitCode: state.errorLevel === 0 ? 1 : state.errorLevel,
      failure: Object.freeze(batchFailure),
      kind: "failed",
      stderr: state.stderr.join(""),
      stdout: state.stdout.join(""),
    });
  }

  private metrics(state: DosBatchExecutionState): DosBatchMetrics {
    return {
      calls: state.calls,
      echoEnabled: state.echo,
      jumps: state.jumps,
      loadedPrograms: state.loadedPrograms,
      steps: state.steps,
    };
  }
}

function tokenizeDosWords(
  source: string,
  maximumWords: number,
): { readonly failure: string } | { readonly words: readonly string[] } {
  const words: string[] = [];
  let word = "";
  let started = false;
  let quoted = false;
  const push = (): string | undefined => {
    if (!started) return undefined;
    if (words.length >= maximumWords) return "too many CALL arguments";
    words.push(word);
    word = "";
    started = false;
    return undefined;
  };
  for (const character of source) {
    if (character === '"') {
      quoted = !quoted;
      started = true;
      continue;
    }
    if (!quoted && /\s/u.test(character)) {
      const pushFailure = push();
      if (pushFailure !== undefined) return { failure: pushFailure };
      continue;
    }
    started = true;
    word += character;
  }
  if (quoted) return { failure: "unterminated quote" };
  const pushFailure = push();
  return pushFailure === undefined
    ? { words: Object.freeze(words) }
    : { failure: pushFailure };
}

function parseLabelLine(source: string): string | undefined {
  const line = source.trim();
  if (line.startsWith("::")) return undefined;
  const match = /^:([A-Za-z0-9_.$-]{1,64})\s*$/u.exec(line);
  return match?.[1];
}

function isLabelLine(source: string): boolean {
  return parseLabelLine(source) !== undefined;
}

function normalizeLabel(label: string): string {
  return label.toUpperCase();
}

function commandPayloadFromLine(line: string): string | undefined {
  const arguments_ = commandInterpreterArguments(line);
  if (arguments_ === undefined) return undefined;
  const match = /^\/(?:C|K)(?:\s+(.*))?$/iu.exec(arguments_);
  return match === null ? undefined : (match[1] ?? "").trim();
}

function hasUnixCommandChain(line: string): boolean {
  let quoted = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    if (line[index] === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    const pair = line.slice(index, index + 2);
    if (pair === "&&" || pair === "||") return true;
  }
  return false;
}

function looksLikeCommandInterpreter(line: string): boolean {
  return commandInterpreterArguments(line) !== undefined;
}

function commandInterpreterArguments(line: string): string | undefined {
  const match = /^("[^"]+"|\S+)(?:\s+(.*))?$/u.exec(line);
  if (match === null) return undefined;
  const executable = unquoteDosWord(match[1]!).replaceAll("/", "\\");
  const separator = executable.lastIndexOf("\\");
  const baseName = executable.slice(separator + 1).toUpperCase();
  return baseName === "COMMAND" || baseName === "COMMAND.COM"
    ? (match[2] ?? "")
    : undefined;
}

function unquoteDosWord(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function failure(
  code: DosBatchFailureCode,
  programName: string,
  lineNumber: number,
  detail: string,
): DosBatchFailure {
  return { code, detail, lineNumber, programName };
}

function syntaxFailure(
  location: StatementLocation,
  detail: string,
): DosBatchFailure {
  return failure(
    "syntax_error",
    location.programName,
    location.lineNumber,
    detail,
  );
}

function callbackFailure(
  location: StatementLocation,
  error: unknown,
): DosBatchFailure {
  return failure(
    "callback_error",
    location.programName,
    location.lineNumber,
    error instanceof Error ? error.message : String(error),
  );
}
