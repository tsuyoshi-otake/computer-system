import {
  BoundedBytePipe,
  type PipeReader,
  type PipeWriter,
} from "../../domain/io/boundedBytePipe.js";
import type {
  CpuProcess,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../domain/runtime/cpuProcess.js";
import type { VmRuntimeError } from "../../domain/runtime/errors.js";
import {
  cs486Byte8DataModel,
  type Cs486DataModel,
} from "../../domain/cpu/cs486Compatibility.js";
import {
  decodeUtf8,
  decodeUtf8Chunk,
  encodeUtf8,
  utf8ByteLength,
} from "../../domain/text/utf8.js";
import type {
  PipelineOperator,
  ShellCommandNode,
  ShellOpenRedirect,
} from "./shellSyntax.js";
import type {
  ShellCommandResult,
  ShellForegroundCs486,
  ShellForegroundPython,
  ShellOutputEvent,
  ShellPipelineStageProcess,
  ShellPipelineStageStarter,
} from "./shellTypes.js";
import type {
  CsAbiStandardInputResult,
  CsAbiStandardIo,
  CsAbiStandardOutputResult,
} from "../runtime/csAbi.js";

export const linuxPipelineLimits = Object.freeze({
  aggregateCollectedBytes: 256_000,
  aggregatePendingBytes: 256_000,
  bytesPerStep: 512,
  cpuCyclesPerStep: 8,
  maximumSteps: 1_000_000,
  pipeCapacityBytes: 4_096,
  stageResidentBytes: 2_048,
  stepsPerSlice: 64,
});

export interface LinuxPipelineMemoryLease {
  release(): void;
}

export interface LinuxPipelineHost {
  readonly commandAvailable: (name: string) => boolean;
  readonly commandAllowed?: (command: ShellCommandNode) => string | undefined;
  readonly execute: (
    command: ShellCommandNode,
    stdin: string,
  ) => ShellCommandResult;
  readonly prepareExternal?: (
    command: ShellCommandNode,
  ) => ShellForegroundCs486 | ShellForegroundPython | undefined;
  readonly livePager?: {
    readonly append: (text: string) => void;
    readonly closed: () => boolean;
    readonly finish: () => void;
  };
  readonly openRedirect: (redirect: ShellOpenRedirect) => void;
  readonly readRedirectBytes: (redirect: ShellOpenRedirect) => Uint8Array;
  readonly reserveMemory: (bytes: number) => LinuxPipelineMemoryLease;
  readonly transaction: (operation: () => void) => void;
  readonly writeRedirectBytes: (path: string, bytes: Uint8Array) => void;
}

export interface StreamingLinuxPipeline {
  readonly bindStageStarter: (starter: ShellPipelineStageStarter) => void;
  readonly process: CpuProcess;
  readonly result: () => ShellCommandResult;
  readonly stageExitCodes: () => readonly number[];
}

interface PipeSink {
  readonly kind: "pipe";
  readonly writer: PipeWriter;
}

interface CaptureSink {
  readonly descriptor: 1 | 2;
  readonly kind: "capture";
  remainder: Uint8Array;
}

interface FileSink {
  bytes: number;
  chunks: Uint8Array[];
  flushed: boolean;
  readonly kind: "file";
  readonly path: string;
}

type Sink = CaptureSink | FileSink | PipeSink;

interface PendingWrite {
  readonly bytes: Uint8Array;
  offset: number;
  readonly sink: Sink;
}

interface Stage {
  readonly command: ShellCommandNode;
  readonly input?: PipeReader;
  readonly initialInput: string;
  readonly initialInputBytes: Uint8Array;
  external?: ShellPipelineStageProcess;
  externalBrokenPipe: boolean;
  externalFinalized: boolean;
  externalInputCursor: number;
  externalInputRemainder: Uint8Array;
  externalInputUnitCursor: number;
  externalInputUnits: number[];
  readonly externalRequest?: ShellForegroundCs486 | ShellForegroundPython;
  readonly mode: "cat" | "external" | "generic" | "head" | "pager" | "yes";
  readonly stderr: Sink;
  readonly stdout: Sink;
  readonly sinks: readonly Sink[];
  readonly collected: Uint8Array[];
  collectedBytes: number;
  done: boolean;
  exitCode: number;
  headLines: number;
  inputWaitGeneration?: number;
  outputWaitGeneration?: number;
  pending: PendingWrite[];
  pendingIndex: number;
  pagerRemainder: Uint8Array;
  started: boolean;
}

/**
 * Creates one scheduler-owned pipeline process. Every CPU slice advances a
 * bounded number of runnable stages in round-robin order; pipe capacity and
 * all retained input/output are covered by the single pipeline RAM lease.
 */
export function createStreamingLinuxPipeline(
  commands: readonly ShellCommandNode[],
  operators: readonly PipelineOperator[],
  host: LinuxPipelineHost,
): StreamingLinuxPipeline {
  const process = new StreamingLinuxPipelineProcess(commands, operators, host);
  return {
    bindStageStarter: (starter): void => process.bindStageStarter(starter),
    process,
    result: () => process.result(),
    stageExitCodes: () => process.stageExitCodes,
  };
}

/** Host-test adapter; production shells admit the same process to the CPU scheduler. */
export function executeStreamingLinuxPipeline(
  commands: readonly ShellCommandNode[],
  operators: readonly PipelineOperator[],
  host: LinuxPipelineHost,
): ShellCommandResult {
  const pipeline = createStreamingLinuxPipeline(commands, operators, host);
  for (let slice = 0; slice < linuxPipelineLimits.maximumSteps; slice += 1) {
    const state = pipeline.process.runCpuSlice(
      linuxPipelineLimits.stepsPerSlice * linuxPipelineLimits.cpuCyclesPerStep,
      linuxPipelineLimits.stepsPerSlice,
    ).state;
    if (isPipelineTerminal(state)) return pipeline.result();
  }
  pipeline.process.terminate("pipeline host-test slice limit exceeded");
  return pipeline.result();
}

class StreamingLinuxPipelineProcess implements CpuProcess {
  readonly hasPendingCpuCycles = false;
  readonly memoryLimitBytes: number;
  readonly memoryUsageBytes: number;

  private readonly host: LinuxPipelineHost;
  private readonly lease: LinuxPipelineMemoryLease;
  private readonly readers: readonly PipeReader[];
  private readonly writers: readonly PipeWriter[];
  private readonly stages: readonly Stage[];
  private readonly terminalEvents: ShellOutputEvent[] = [];
  private stateValue: CpuProcessState = { kind: "ready" };
  private collectedBytes = 0;
  private pendingBytes = 0;
  private capturedBytes = 0;
  private fileBytes = 0;
  private remainingStages: number;
  private steps = 0;
  private finalized = false;
  private stageStarter: ShellPipelineStageStarter | undefined;

  constructor(
    commands: readonly ShellCommandNode[],
    operators: readonly PipelineOperator[],
    host: LinuxPipelineHost,
  ) {
    if (commands.length < 2 || operators.length !== commands.length - 1) {
      throw new Error("Linux pipeline requires matching stages and edges");
    }
    this.host = host;
    const externalRequests = new Map<
      ShellCommandNode,
      ShellForegroundCs486 | ShellForegroundPython
    >();
    for (const command of commands) {
      const name = command.words[0] ?? "";
      if (!host.commandAvailable(name)) {
        throw new Error(`${name || "shell"}: command not found`);
      }
      const rejection = host.commandAllowed?.(command);
      if (rejection !== undefined) throw new Error(`${name}: ${rejection}`);
      const external = host.prepareExternal?.(command);
      if (external !== undefined) externalRequests.set(command, external);
    }
    this.memoryLimitBytes =
      Math.max(0, commands.length - 1) * linuxPipelineLimits.pipeCapacityBytes +
      commands.length * linuxPipelineLimits.stageResidentBytes +
      linuxPipelineLimits.aggregateCollectedBytes +
      linuxPipelineLimits.aggregatePendingBytes * 2;
    this.memoryUsageBytes = this.memoryLimitBytes;
    this.lease = host.reserveMemory(this.memoryLimitBytes);

    const pipes = Array.from(
      { length: commands.length - 1 },
      () => new BoundedBytePipe(linuxPipelineLimits.pipeCapacityBytes),
    );
    this.readers = pipes.map((pipe) => pipe.reader());
    this.writers = pipes.map((pipe) => pipe.writer());

    try {
      const redirectedInput = new Map<ShellOpenRedirect, Uint8Array>();
      let redirectedInputBytes = 0;
      const inputRedirects: ShellOpenRedirect[] = [];
      for (const command of commands) {
        for (const redirect of command.redirects) {
          if (
            redirect.kind === "open" &&
            redirect.descriptor === 0 &&
            redirect.mode === "read"
          ) {
            const value = host.readRedirectBytes(redirect);
            redirectedInputBytes += value.byteLength;
            if (
              redirectedInputBytes > linuxPipelineLimits.aggregateCollectedBytes
            ) {
              throw new Error("bash: redirected pipeline input limit exceeded");
            }
            inputRedirects.push(redirect);
          }
        }
      }
      host.transaction(() => {
        for (const command of commands) {
          for (const redirect of command.redirects) {
            if (redirect.kind === "open" && redirect.descriptor !== 0) {
              host.openRedirect(redirect);
            }
          }
        }
      });
      // Validation above is deliberately separate from this read. Shell-owned
      // output descriptions are opened (and `>` targets truncated) first, so
      // `<file >file` observes the already-truncated object just like a real
      // shell rather than replaying a pre-setup snapshot.
      for (const redirect of inputRedirects) {
        redirectedInput.set(redirect, host.readRedirectBytes(redirect));
      }
      this.stages = commands.map((command, index) =>
        this.createStage(
          command,
          index,
          operators,
          redirectedInput,
          externalRequests.get(command),
        ),
      );
      this.remainingStages = this.stages.length;
    } catch (error: unknown) {
      for (const reader of this.readers) reader.close();
      for (const writer of this.writers) writer.close();
      this.lease.release();
      this.finalized = true;
      throw error;
    }
  }

  get state(): CpuProcessState {
    return this.stateValue;
  }

  get stageExitCodes(): readonly number[] {
    return this.stages.map(({ exitCode }) => exitCode);
  }

  bindStageStarter(starter: ShellPipelineStageStarter): void {
    if (this.stageStarter !== undefined) {
      throw new Error("pipeline stage starter is already bound");
    }
    this.stageStarter = starter;
    const admitted: Stage[] = [];
    try {
      for (const stage of this.stages) {
        const request = stage.externalRequest;
        if (request === undefined) continue;
        stage.external = starter(
          request.kind === "cs486"
            ? { ...request, standardIo: this.standardIo(stage) }
            : {
                ...request,
                routeOutput: (descriptor: 1 | 2, text: string): boolean => {
                  this.enqueue(
                    stage,
                    encodeUtf8(text),
                    descriptor === 1 ? stage.stdout : stage.stderr,
                  );
                  return false;
                },
              },
        );
        admitted.push(stage);
      }
    } catch (error: unknown) {
      for (const stage of admitted) {
        stage.external?.process.terminate("pipeline admission rolled back");
        if (stage.external !== undefined && !stage.externalFinalized) {
          stage.externalFinalized = true;
          stage.external.finalize();
        }
      }
      throw error;
    }
  }

  advanceTick(tick: number): CpuProcessState {
    for (const stage of this.stages) stage.external?.process.advanceTick(tick);
    return this.stateValue;
  }

  deliverEvent(): boolean {
    return false;
  }

  fail(error: VmRuntimeError): CpuProcessState {
    if (!isPipelineTerminal(this.stateValue)) {
      this.stateValue = { error, kind: "crashed" };
      this.finalize();
    }
    return this.stateValue;
  }

  runCpuSlice(
    cpuCycleBudget: number,
    instructionBudget = linuxPipelineLimits.stepsPerSlice,
  ): CpuProcessSliceResult {
    if (isPipelineTerminal(this.stateValue)) {
      return { cpuCycles: 0, executedInstructions: 0, state: this.stateValue };
    }
    if (
      cpuCycleBudget < linuxPipelineLimits.cpuCyclesPerStep ||
      instructionBudget < 1
    ) {
      return { cpuCycles: 0, executedInstructions: 0, state: this.stateValue };
    }
    const budget = Math.max(
      1,
      Math.min(
        linuxPipelineLimits.stepsPerSlice,
        Math.floor(cpuCycleBudget / linuxPipelineLimits.cpuCyclesPerStep),
        instructionBudget,
      ),
    );
    let executed = 0;
    let progress = false;
    for (; executed < budget; executed += 1) {
      const stage = this.stages[this.steps % this.stages.length]!;
      this.steps += 1;
      try {
        if (!stage.done && this.stepStage(stage)) progress = true;
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : String(error);
        stage.exitCode = 1;
        this.appendTerminalError(
          `${stage.command.words[0] ?? "pipeline"}: ${detail}\n`,
        );
        this.finishStage(stage);
        progress = true;
      }
      if (this.remainingStages === 0) {
        this.stateValue = {
          kind: "completed",
          value: this.stages.at(-1)?.exitCode ?? 0,
        };
        this.finalize();
        executed += 1;
        break;
      }
      if (this.steps >= linuxPipelineLimits.maximumSteps) {
        this.appendTerminalError("bash: pipeline step limit exceeded\n");
        this.stateValue = { kind: "completed", value: 1 };
        this.finalize();
        executed += 1;
        break;
      }
      if (this.steps % this.stages.length === 0) {
        if (!progress) {
          executed += 1;
          break;
        }
        progress = false;
      }
    }
    return {
      cpuCycles: executed * linuxPipelineLimits.cpuCyclesPerStep,
      executedInstructions: executed,
      state: this.stateValue,
    };
  }

  terminate(reason = "pipeline terminated"): CpuProcessState {
    if (!isPipelineTerminal(this.stateValue)) {
      this.stateValue = { kind: "terminated", reason };
      this.finalize();
    }
    return this.stateValue;
  }

  result(): ShellCommandResult {
    const exitCode =
      this.stateValue.kind === "completed" &&
      typeof this.stateValue.value === "number"
        ? this.stateValue.value
        : this.stateValue.kind === "terminated"
          ? 130
          : 1;
    return commandResult(this.terminalEvents, exitCode);
  }

  private createStage(
    command: ShellCommandNode,
    index: number,
    operators: readonly PipelineOperator[],
    redirectedInput: ReadonlyMap<ShellOpenRedirect, Uint8Array>,
    externalRequest?: ShellForegroundCs486 | ShellForegroundPython,
  ): Stage {
    const inputRedirect = command.redirects.findLast(
      (redirect): redirect is ShellOpenRedirect =>
        redirect.kind === "open" && redirect.descriptor === 0,
    );
    const input = index === 0 ? undefined : this.readers[index - 1];
    if (inputRedirect !== undefined) input?.close();
    const basePipe = this.writers[index];
    let stdout: Sink =
      basePipe === undefined
        ? captureSink(1)
        : { kind: "pipe", writer: basePipe };
    let stderr: Sink = captureSink(2);
    for (const redirect of command.redirects) {
      if (redirect.kind === "duplicate") stderr = stdout;
      else if (redirect.descriptor === 1) stdout = fileSink(redirect.path);
      else if (redirect.descriptor === 2) stderr = fileSink(redirect.path);
    }
    if (operators[index] === "pipe-stdout-and-stderr") {
      if (basePipe === undefined) throw new Error("missing |& pipe endpoint");
      stderr = { kind: "pipe", writer: basePipe };
    }
    const baseUsed =
      basePipe === undefined ||
      (stdout.kind === "pipe" && stdout.writer === basePipe) ||
      (stderr.kind === "pipe" && stderr.writer === basePipe);
    if (!baseUsed) basePipe.close();
    const name = command.words[0] ?? "";
    const hasFileArguments = command.words
      .slice(1)
      .some((word) => word !== "-");
    const mode =
      index === this.readers.length &&
      (name === "less" || name === "more") &&
      this.host.livePager !== undefined
        ? "pager"
        : externalRequest !== undefined
          ? "external"
          : name === "yes"
            ? "yes"
            : name === "cat" && !hasFileArguments
              ? "cat"
              : name === "head" &&
                  headLimit(command.words.slice(1)) !== undefined
                ? "head"
                : "generic";
    const initialInputBytes =
      inputRedirect === undefined
        ? new Uint8Array()
        : (redirectedInput.get(inputRedirect) ?? new Uint8Array());
    return {
      collected: [],
      collectedBytes: 0,
      command,
      done: false,
      ...(externalRequest === undefined ? {} : { externalRequest }),
      externalFinalized: false,
      externalBrokenPipe: false,
      externalInputCursor: 0,
      externalInputRemainder: new Uint8Array(),
      externalInputUnitCursor: 0,
      externalInputUnits: [],
      exitCode: 0,
      headLines: 0,
      ...(inputRedirect === undefined && input !== undefined ? { input } : {}),
      initialInput:
        mode === "generic" || mode === "pager"
          ? decodeUtf8(initialInputBytes)
          : "",
      initialInputBytes,
      mode,
      pending: [],
      pendingIndex: 0,
      pagerRemainder: new Uint8Array(),
      sinks: stdout === stderr ? [stdout] : [stdout, stderr],
      started: false,
      stderr,
      stdout,
    };
  }

  private stepStage(stage: Stage): boolean {
    if (stage.pendingIndex < stage.pending.length) {
      const sink = stage.pending[stage.pendingIndex]!.sink;
      if (
        sink.kind === "pipe" &&
        stage.outputWaitGeneration === sink.writer.writableGeneration
      ) {
        return false;
      }
      stage.outputWaitGeneration = undefined;
      return this.flushPending(stage);
    }
    if (
      stage.input !== undefined &&
      stage.inputWaitGeneration === stage.input.readableGeneration
    ) {
      return false;
    }
    stage.inputWaitGeneration = undefined;
    if (stage.mode === "yes") {
      this.enqueue(
        stage,
        encodeUtf8(`${stage.command.words.slice(1).join(" ") || "y"}\n`),
        stage.stdout,
      );
      return true;
    }
    if (stage.mode === "pager") return this.stepPagerInput(stage);
    if (stage.mode === "external") return this.stepExternal(stage);
    if (stage.mode === "cat" || stage.mode === "head") {
      return this.stepStreamingInput(stage);
    }
    if (!stage.started) {
      if (stage.input !== undefined) {
        const read = stage.input.read(linuxPipelineLimits.bytesPerStep);
        if (read.kind === "would-block") {
          stage.inputWaitGeneration = stage.input.readableGeneration;
          return false;
        }
        if (read.kind === "data") {
          stage.collected.push(read.bytes);
          stage.collectedBytes += read.bytes.byteLength;
          this.collectedBytes += read.bytes.byteLength;
          if (
            this.collectedBytes > linuxPipelineLimits.aggregateCollectedBytes
          ) {
            stage.exitCode = 1;
            this.enqueue(
              stage,
              encodeUtf8("bash: pipeline input limit exceeded\n"),
              stage.stderr,
            );
            stage.input.close();
            stage.started = true;
          }
          return true;
        }
        stage.input.close();
      }
      stage.started = true;
      const stdin =
        stage.collected.length === 0
          ? stage.initialInput
          : decodeUtf8(concatenate(stage.collected, stage.collectedBytes));
      this.collectedBytes -= stage.collectedBytes;
      stage.collected.length = 0;
      stage.collectedBytes = 0;
      const result = this.host.execute(stage.command, stdin);
      stage.exitCode = result.exitCode;
      const asynchronous =
        result.foreground !== undefined ||
        result.background !== undefined ||
        result.jobControl !== undefined ||
        result.action !== undefined ||
        result.sleepTicks !== undefined ||
        result.terminalScreen !== undefined;
      if (asynchronous) {
        stage.exitCode = 2;
        this.enqueue(
          stage,
          encodeUtf8(
            `${stage.command.words[0] ?? "shell"}: cannot run asynchronously in a pipeline\n`,
          ),
          stage.stderr,
        );
      } else {
        for (const event of result.outputEvents ?? legacyEvents(result)) {
          this.enqueue(
            stage,
            encodeUtf8(event.text),
            event.descriptor === 1 ? stage.stdout : stage.stderr,
          );
        }
      }
    }
    if (stage.pendingIndex >= stage.pending.length) this.finishStage(stage);
    return true;
  }

  private stepStreamingInput(stage: Stage): boolean {
    if (
      stage.mode === "head" &&
      headLimit(stage.command.words.slice(1)) === 0
    ) {
      stage.input?.close();
      stage.started = true;
      this.finishStage(stage);
      return true;
    }
    if (stage.input === undefined) {
      let bytes = stage.initialInputBytes;
      if (stage.mode === "head") {
        const limit = headLimit(stage.command.words.slice(1)) ?? 10;
        let end = bytes.byteLength;
        for (let index = 0; index < bytes.byteLength; index += 1) {
          if (bytes[index] !== 0x0a) continue;
          stage.headLines += 1;
          if (stage.headLines >= limit) {
            end = index + 1;
            break;
          }
        }
        bytes = bytes.slice(0, end);
      }
      if (bytes.byteLength > 0) this.enqueue(stage, bytes, stage.stdout);
      stage.started = true;
      if (stage.pendingIndex >= stage.pending.length) this.finishStage(stage);
      return true;
    }
    const read = stage.input.read(linuxPipelineLimits.bytesPerStep);
    if (read.kind === "would-block") {
      stage.inputWaitGeneration = stage.input.readableGeneration;
      return false;
    }
    if (read.kind === "eof") {
      stage.input.close();
      stage.started = true;
      if (stage.pendingIndex >= stage.pending.length) this.finishStage(stage);
      return true;
    }
    let bytes = read.bytes;
    if (stage.mode === "head") {
      const limit = headLimit(stage.command.words.slice(1)) ?? 10;
      let end = bytes.byteLength;
      for (let index = 0; index < bytes.byteLength; index += 1) {
        if (bytes[index] !== 0x0a) continue;
        stage.headLines += 1;
        if (stage.headLines >= limit) {
          end = index + 1;
          stage.input.close();
          stage.started = true;
          break;
        }
      }
      bytes = bytes.slice(0, end);
    }
    if (bytes.byteLength > 0) this.enqueue(stage, bytes, stage.stdout);
    return true;
  }

  private stepExternal(stage: Stage): boolean {
    if (stage.pendingIndex < stage.pending.length)
      return this.flushPending(stage);
    if (stage.external === undefined) {
      if (this.stageStarter === undefined) {
        throw new Error("pipeline external stage starter is not bound");
      }
      const request = stage.externalRequest;
      if (request === undefined)
        throw new Error("pipeline external request is missing");
      stage.external = this.stageStarter(
        request.kind === "cs486"
          ? { ...request, standardIo: this.standardIo(stage) }
          : {
              ...request,
              routeOutput: (descriptor: 1 | 2, text: string): boolean => {
                this.enqueue(
                  stage,
                  encodeUtf8(text),
                  descriptor === 1 ? stage.stdout : stage.stderr,
                );
                return false;
              },
            },
      );
    }
    stage.started = true;
    const process = stage.external.process;
    if (process.state.kind === "waiting_event") {
      const filter = process.state.filter;
      if (filter === "csabi_fd0" && this.standardInputReady(stage)) {
        process.deliverEvent(filter);
      } else if (
        (filter === "csabi_fd1" || filter === "csabi_fd2") &&
        this.standardOutputReady(stage, filter === "csabi_fd1" ? 1 : 2)
      ) {
        process.deliverEvent(filter);
      } else {
        return false;
      }
    }
    const slice = process.runCpuSlice(
      linuxPipelineLimits.cpuCyclesPerStep,
      linuxPipelineLimits.bytesPerStep,
    );
    if (stage.externalBrokenPipe) {
      process.terminate("SIGPIPE");
      stage.exitCode = 141;
      this.finishStage(stage);
      return true;
    }
    if (
      slice.state.kind === "completed" ||
      slice.state.kind === "crashed" ||
      slice.state.kind === "terminated"
    ) {
      stage.exitCode =
        slice.state.kind === "completed" &&
        typeof slice.state.value === "number"
          ? slice.state.value
          : slice.state.kind === "terminated"
            ? 130
            : 1;
      if (stage.pendingIndex >= stage.pending.length) this.finishStage(stage);
    }
    return slice.cpuCycles > 0 || slice.executedInstructions > 0 || stage.done;
  }

  private standardIo(stage: Stage): CsAbiStandardIo {
    return {
      inputReady: (): boolean => this.standardInputReady(stage),
      outputReady: (descriptor): boolean =>
        this.standardOutputReady(stage, descriptor),
      read: (dataModel, maximumUnits): CsAbiStandardInputResult =>
        this.readStandardInput(stage, dataModel, maximumUnits),
      write: (descriptor, dataModel, units): CsAbiStandardOutputResult =>
        this.writeStandardOutput(stage, descriptor, dataModel, units),
    };
  }

  private standardInputReady(stage: Stage): boolean {
    return (
      stage.externalInputUnitCursor < stage.externalInputUnits.length ||
      stage.input?.ready === true ||
      (stage.input === undefined &&
        stage.externalInputCursor < stage.initialInputBytes.byteLength) ||
      (stage.input === undefined &&
        stage.externalInputCursor >= stage.initialInputBytes.byteLength)
    );
  }

  private standardOutputReady(stage: Stage, descriptor: 1 | 2): boolean {
    const sink = descriptor === 1 ? stage.stdout : stage.stderr;
    return sink.kind !== "pipe" || sink.writer.ready;
  }

  private readStandardInput(
    stage: Stage,
    dataModel: Cs486DataModel,
    maximumUnits: number,
  ): CsAbiStandardInputResult {
    if (stage.externalInputUnitCursor < stage.externalInputUnits.length) {
      return {
        kind: "data",
        units: this.takeExternalInputUnits(stage, maximumUnits),
      };
    }
    const readBytes = (): ReturnType<PipeReader["read"]> => {
      if (stage.input !== undefined) {
        return stage.input.read(
          dataModel === cs486Byte8DataModel
            ? maximumUnits
            : Math.max(4, maximumUnits * 4),
        );
      }
      const source = stage.initialInputBytes;
      if (stage.externalInputCursor >= source.byteLength)
        return { kind: "eof" };
      const end = Math.min(
        source.byteLength,
        stage.externalInputCursor +
          (dataModel === cs486Byte8DataModel
            ? maximumUnits
            : Math.max(4, maximumUnits * 4)),
      );
      const bytes = source.slice(stage.externalInputCursor, end);
      stage.externalInputCursor = end;
      return { bytes, kind: "data" };
    };
    const read = readBytes();
    if (read.kind === "would-block") {
      if (stage.input !== undefined) {
        stage.inputWaitGeneration = stage.input.readableGeneration;
      }
      return read;
    }
    if (dataModel === cs486Byte8DataModel) {
      return read.kind === "eof"
        ? read
        : { kind: "data", units: [...read.bytes] };
    }
    if (read.kind === "eof") {
      if (stage.externalInputRemainder.byteLength === 0) return read;
      stage.externalInputUnits.push(
        ...[...decodeUtf8(stage.externalInputRemainder)].map((character) =>
          character.codePointAt(0)!,
        ),
      );
      stage.externalInputRemainder = new Uint8Array();
    } else {
      const combined = concatenate(
        [stage.externalInputRemainder, read.bytes],
        stage.externalInputRemainder.byteLength + read.bytes.byteLength,
      );
      const decoded = decodeUtf8Chunk(combined);
      stage.externalInputRemainder = decoded.remainder;
      stage.externalInputUnits.push(
        ...[...decoded.value].map((character) => character.codePointAt(0)!),
      );
    }
    if (stage.externalInputUnitCursor >= stage.externalInputUnits.length) {
      return { kind: "would-block" };
    }
    return {
      kind: "data",
      units: this.takeExternalInputUnits(stage, maximumUnits),
    };
  }

  private takeExternalInputUnits(stage: Stage, maximumUnits: number): number[] {
    const end = Math.min(
      stage.externalInputUnits.length,
      stage.externalInputUnitCursor + maximumUnits,
    );
    const result = stage.externalInputUnits.slice(
      stage.externalInputUnitCursor,
      end,
    );
    stage.externalInputUnitCursor = end;
    if (end === stage.externalInputUnits.length) {
      stage.externalInputUnits.length = 0;
      stage.externalInputUnitCursor = 0;
    }
    return result;
  }

  private writeStandardOutput(
    stage: Stage,
    descriptor: 1 | 2,
    dataModel: Cs486DataModel,
    units: readonly number[],
  ): CsAbiStandardOutputResult {
    const sink = descriptor === 1 ? stage.stdout : stage.stderr;
    if (sink.kind !== "pipe") {
      const bytes =
        dataModel === cs486Byte8DataModel
          ? Uint8Array.from(units)
          : encodeUtf8(String.fromCodePoint(...units));
      this.writeTextSink(sink, bytes);
      return { kind: "written", unitsWritten: units.length };
    }
    if (dataModel === cs486Byte8DataModel) {
      const written = sink.writer.write(Uint8Array.from(units));
      if (written.kind === "broken-pipe") stage.externalBrokenPipe = true;
      if (written.kind !== "written") return written;
      return { kind: "written", unitsWritten: written.bytesWritten };
    }
    let unitsWritten = 0;
    for (const unit of units) {
      const bytes = encodeUtf8(String.fromCodePoint(unit));
      if (sink.writer.freeBytes < bytes.byteLength) break;
      const written = sink.writer.write(bytes);
      if (written.kind === "broken-pipe") {
        stage.externalBrokenPipe = true;
        return unitsWritten === 0 ? written : { kind: "written", unitsWritten };
      }
      if (written.kind === "would-block") break;
      unitsWritten += 1;
    }
    return unitsWritten === 0
      ? { kind: "would-block" }
      : { kind: "written", unitsWritten };
  }

  private stepPagerInput(stage: Stage): boolean {
    const pager = this.host.livePager!;
    if (pager.closed()) {
      stage.input?.close();
      stage.started = true;
      this.finishStage(stage);
      return true;
    }
    if (stage.input === undefined) {
      if (stage.initialInput.length > 0) pager.append(stage.initialInput);
      pager.finish();
      stage.started = true;
      this.finishStage(stage);
      return true;
    }
    const read = stage.input.read(linuxPipelineLimits.bytesPerStep);
    if (read.kind === "would-block") {
      stage.inputWaitGeneration = stage.input.readableGeneration;
      return false;
    }
    if (read.kind === "eof") {
      if (stage.pagerRemainder.byteLength > 0) {
        pager.append(decodeUtf8(stage.pagerRemainder));
        stage.pagerRemainder = new Uint8Array();
      }
      pager.finish();
      stage.input.close();
      stage.started = true;
      this.finishStage(stage);
      return true;
    }
    const combined = concatenate(
      [stage.pagerRemainder, read.bytes],
      stage.pagerRemainder.byteLength + read.bytes.byteLength,
    );
    const decoded = decodeUtf8Chunk(combined);
    stage.pagerRemainder = decoded.remainder;
    if (decoded.value.length > 0) pager.append(decoded.value);
    return true;
  }

  private enqueue(stage: Stage, bytes: Uint8Array, sink: Sink): void {
    if (bytes.byteLength === 0) return;
    if (
      this.pendingBytes + bytes.byteLength >
      linuxPipelineLimits.aggregatePendingBytes
    ) {
      stage.exitCode = 1;
      stage.input?.close();
      this.pendingBytes -= remainingPendingBytes(stage);
      stage.pending = [
        {
          bytes: encodeUtf8("bash: pipeline output limit exceeded\n"),
          offset: 0,
          sink: stage.stderr,
        },
      ];
      stage.pendingIndex = 0;
      this.pendingBytes += stage.pending[0]!.bytes.byteLength;
      stage.started = true;
      return;
    }
    stage.pending.push({ bytes, offset: 0, sink });
    this.pendingBytes += bytes.byteLength;
  }

  private flushPending(stage: Stage): boolean {
    const pending = stage.pending[stage.pendingIndex]!;
    const remaining = pending.bytes.subarray(pending.offset);
    let consumed = 0;
    if (pending.sink.kind === "pipe") {
      const written = pending.sink.writer.write(remaining);
      if (written.kind === "would-block") {
        stage.outputWaitGeneration = pending.sink.writer.writableGeneration;
        return false;
      }
      if (written.kind === "broken-pipe") {
        this.pendingBytes -= pending.bytes.byteLength - pending.offset;
        stage.exitCode = 141;
        stage.pending = [];
        stage.pendingIndex = 0;
        stage.input?.close();
        this.finishStage(stage);
        return true;
      }
      consumed = written.bytesWritten;
      pending.offset += written.bytesWritten;
    } else {
      this.writeTextSink(pending.sink, remaining);
      consumed = remaining.byteLength;
      pending.offset = pending.bytes.byteLength;
    }
    this.pendingBytes -= consumed;
    if (pending.offset >= pending.bytes.byteLength) {
      stage.pendingIndex += 1;
      if (stage.pendingIndex >= stage.pending.length) {
        stage.pending = [];
        stage.pendingIndex = 0;
      }
    }
    if (stage.started && stage.pending.length === 0 && stage.mode !== "yes") {
      this.finishStage(stage);
    }
    return true;
  }

  private writeTextSink(sink: CaptureSink | FileSink, bytes: Uint8Array): void {
    if (sink.kind === "file") {
      if (
        this.fileBytes + bytes.byteLength >
        linuxPipelineLimits.aggregatePendingBytes
      ) {
        throw new Error("pipeline redirected output limit exceeded");
      }
      const retained = new Uint8Array(bytes);
      sink.chunks.push(retained);
      sink.bytes += retained.byteLength;
      this.fileBytes += retained.byteLength;
      return;
    }
    const combined = concatenate(
      [sink.remainder, bytes],
      sink.remainder.length + bytes.length,
    );
    const decoded = decodeUtf8Chunk(combined);
    sink.remainder = decoded.remainder;
    if (decoded.value.length === 0) return;
    this.appendTerminal(sink.descriptor, decoded.value);
  }

  private appendTerminal(descriptor: 1 | 2, text: string): void {
    const bytes = utf8ByteLength(text);
    if (
      this.capturedBytes + bytes >
      linuxPipelineLimits.aggregatePendingBytes
    ) {
      if (
        !this.terminalEvents.some(({ text: value }) =>
          value.includes("pipeline terminal output limit exceeded"),
        )
      ) {
        this.terminalEvents.push({
          descriptor: 2,
          text: "bash: pipeline terminal output limit exceeded\n",
        });
      }
      return;
    }
    this.capturedBytes += bytes;
    this.terminalEvents.push({ descriptor, text });
  }

  private appendTerminalError(text: string): void {
    this.appendTerminal(2, text);
  }

  private finishStage(stage: Stage): void {
    if (stage.done) return;
    const fileSinks = new Set(
      stage.sinks.filter((sink): sink is FileSink => sink.kind === "file"),
    );
    for (const sink of fileSinks) {
      if (sink.flushed) continue;
      sink.flushed = true;
      const contents = concatenate(sink.chunks, sink.bytes);
      sink.chunks.length = 0;
      this.fileBytes -= sink.bytes;
      sink.bytes = 0;
      try {
        this.host.writeRedirectBytes(sink.path, contents);
      } catch (error: unknown) {
        stage.exitCode = 1;
        this.appendTerminalError(
          `${stage.command.words[0] ?? "pipeline"}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
    stage.done = true;
    this.remainingStages -= 1;
    if (stage.external !== undefined && !stage.externalFinalized) {
      stage.externalFinalized = true;
      stage.external.finalize();
    }
    stage.input?.close();
    for (const sink of stage.sinks) {
      if (sink.kind === "pipe") sink.writer.close();
    }
  }

  private finalize(): void {
    if (this.finalized) return;
    this.finalized = true;
    for (const stage of this.stages) {
      if (stage.external !== undefined && !stage.done) {
        stage.external.process.terminate("pipeline finalized");
      }
      this.finishStage(stage);
    }
    for (const reader of this.readers) reader.close();
    for (const writer of this.writers) writer.close();
    const textSinks = new Set<CaptureSink>();
    for (const stage of this.stages) {
      for (const sink of stage.sinks) {
        if (sink.kind === "capture") textSinks.add(sink);
      }
    }
    for (const sink of textSinks) {
      if (sink.remainder.byteLength === 0) continue;
      const tail = decodeUtf8(sink.remainder);
      sink.remainder = new Uint8Array();
      this.appendTerminal(sink.descriptor, tail);
    }
    this.lease.release();
  }
}

function captureSink(descriptor: 1 | 2): CaptureSink {
  return { descriptor, kind: "capture", remainder: new Uint8Array() };
}

function fileSink(path: string): FileSink {
  return { bytes: 0, chunks: [], flushed: false, kind: "file", path };
}

function headLimit(arguments_: readonly string[]): number | undefined {
  if (arguments_.length === 0) return 10;
  if (arguments_.length === 1 && /^-\d+$/u.test(arguments_[0]!))
    return Number(arguments_[0]!.slice(1));
  if (
    arguments_.length === 2 &&
    arguments_[0] === "-n" &&
    /^\d+$/u.test(arguments_[1]!)
  ) {
    return Number(arguments_[1]);
  }
  return undefined;
}

function legacyEvents(result: ShellCommandResult): ShellOutputEvent[] {
  return [
    ...(result.stderr.length === 0
      ? []
      : [{ descriptor: 2 as const, text: result.stderr }]),
    ...(result.stdout.length === 0
      ? []
      : [{ descriptor: 1 as const, text: result.stdout }]),
  ];
}

function commandResult(
  outputEvents: readonly ShellOutputEvent[],
  exitCode: number,
): ShellCommandResult {
  return {
    exitCode,
    outputEvents,
    stderr: outputEvents
      .filter(({ descriptor }) => descriptor === 2)
      .map(({ text }) => text)
      .join(""),
    stdout: outputEvents
      .filter(({ descriptor }) => descriptor === 1)
      .map(({ text }) => text)
      .join(""),
  };
}

function concatenate(
  chunks: readonly Uint8Array[],
  length: number,
): Uint8Array {
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isPipelineTerminal(state: CpuProcessState): boolean {
  return (
    state.kind === "completed" ||
    state.kind === "crashed" ||
    state.kind === "terminated"
  );
}

function remainingPendingBytes(stage: Stage): number {
  let bytes = 0;
  for (
    let index = stage.pendingIndex;
    index < stage.pending.length;
    index += 1
  ) {
    const pending = stage.pending[index]!;
    bytes +=
      pending.bytes.byteLength -
      (index === stage.pendingIndex ? pending.offset : 0);
  }
  return bytes;
}
