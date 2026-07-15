import {
  createNativeEnvironment,
  renderTerminalScreen,
  writeTerminalLines,
  type ForegroundProcessStartResult,
} from "../runtime/nativeModules.js";
import { createPythonCs486Program } from "../runtime/pythonCs486.js";
import {
  RoundRobinScheduler,
  type SchedulerLimits,
  type SchedulerWorkObserver,
} from "../runtime/scheduler.js";
import type {
  ComputerWorkLane,
  TickWorkScope,
} from "../runtime/computerWorkMonitor.js";
import type {
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../domain/runtime/cpuProcess.js";
import type { CpuProcess } from "../../domain/runtime/cpuProcess.js";
import { Cs486Process, runCs486 } from "../../domain/cpu/cs486.js";
import type { ComputerRecord } from "../../domain/computer/computer.js";
import { numericComputerId } from "../../domain/computer/identity.js";
import type { RuntimeValue } from "../../domain/runtime/value.js";
import { VmRuntimeError } from "../../domain/runtime/errors.js";
import { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { defaultSystemBootSource } from "../os/systemPrograms.js";
import type { ShellClockSource } from "../os/clock.js";
import type { ShellCompletionResult } from "../os/shellCommands.js";
import type { ShellSession } from "../os/shellSession.js";
import type { ShellForegroundRequest } from "../os/shellTypes.js";
import {
  hardwareCpuCyclesPerTick,
  type ComputerHardwareProfile,
} from "../../domain/computer/hardware.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import { cpuCyclesToMicroseconds } from "../../domain/cpu/timing.js";
import { clearCsBiosForOs, renderCsBiosPost } from "./csBios.js";
import { SerialLinkBroker } from "../io/serialLinkBroker.js";
import { PeripheralBusBroker } from "../io/peripheralBusBroker.js";
import {
  assembleCs486,
  assembleCs486Object,
} from "../toolchain/cs486Assembler.js";
import {
  compileCs486Object,
  compileCs486Source,
} from "../toolchain/highLevelCompilers.js";
import { linkCs486Objects } from "../toolchain/cs486Linker.js";

export interface ComputerRuntimeOptions {
  readonly clock?: ShellClockSource;
  readonly schedulerLimits?: SchedulerLimits;
  readonly defaultBootSource?: string;
  readonly ticksPerSecond?: number;
  readonly requireLinuxLogin?: boolean;
  readonly serial?: SerialLinkBroker;
  readonly peripherals?: PeripheralBusBroker;
}

export type RuntimeCommandResult =
  | { readonly outcome: "accepted"; readonly state: string }
  | {
      readonly outcome: "ignored";
      readonly reason: "already_registered" | "not_running";
    }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error };

export type DebugShellCommandResult =
  | {
      readonly outcome: "completed";
      readonly exitCode: number;
      readonly stderr: string;
      readonly stdout: string;
      readonly cpuCycles: number;
    }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "ignored"; readonly reason: "not_running" }
  | { readonly outcome: "failed"; readonly error: Error };

export type DebugShellCommandCompletion = Extract<
  DebugShellCommandResult,
  { readonly outcome: "completed" | "failed" | "ignored" | "missing" }
>;

export class ComputerRuntime {
  readonly serial: SerialLinkBroker;
  readonly peripherals: PeripheralBusBroker;
  private readonly scheduler: RoundRobinScheduler;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly runtimeOwners = new Map<number, RuntimeEntry>();
  private readonly runtimeLanes = new Map<number, ComputerWorkLane>();
  private readonly pendingBootHandoffs = new Set<RuntimeEntry>();
  private readonly compileReady = new Set<RuntimeEntry>();
  private activeWorkScope: TickWorkScope | undefined;
  private readonly defaultBootSource: string;
  private readonly clock: ShellClockSource | undefined;
  private readonly ticksPerSecond: number;
  private readonly requireLinuxLogin: boolean;
  private filesystemIoRequester:
    | ((
        computerId: string,
        operation: "read" | "write",
        bytes: number,
      ) => string | undefined)
    | undefined;
  private nextRuntimeId = 1;

  constructor(options: ComputerRuntimeOptions = {}) {
    this.serial = options.serial ?? new SerialLinkBroker();
    this.peripherals = options.peripherals ?? new PeripheralBusBroker();
    this.scheduler = new RoundRobinScheduler(options.schedulerLimits);
    this.defaultBootSource =
      options.defaultBootSource ?? defaultSystemBootSource;
    this.clock = options.clock;
    this.ticksPerSecond = options.ticksPerSecond ?? 20;
    this.requireLinuxLogin = options.requireLinuxLogin ?? false;
  }

  get tickNumber(): number {
    return this.scheduler.tickNumber;
  }

  configureFilesystemIo(
    requester: (
      computerId: string,
      operation: "read" | "write",
      bytes: number,
    ) => string | undefined,
  ): void {
    this.filesystemIoRequester = requester;
  }

  register(record: ComputerRecord): RuntimeCommandResult {
    if (this.entries.has(record.computerId)) {
      return { outcome: "ignored", reason: "already_registered" };
    }
    this.entries.set(record.computerId, {
      record,
      runtimeId: this.nextRuntimeId++,
    });
    return { outcome: "accepted", state: record.lifecycle.state.kind };
  }

  powerOn(computerId: string): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    const transition = entry.record.lifecycle.transition({ kind: "power_on" });
    if (transition.outcome !== "changed") {
      return { outcome: "ignored", reason: "not_running" };
    }
    return this.boot(entry);
  }

  shutdown(computerId: string, reason = "shutdown"): RuntimeCommandResult {
    return this.requestStop(computerId, "shutdown", reason);
  }

  reboot(computerId: string): RuntimeCommandResult {
    return this.requestStop(computerId, "reboot", "reboot");
  }

  terminate(computerId: string): RuntimeCommandResult {
    return this.requestStop(computerId, "shutdown", "terminated");
  }

  interrupt(computerId: string): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.foreground !== undefined) {
      entry.foreground.process.terminate("interrupted");
      return { outcome: "accepted", state: "foreground_interrupted" };
    }
    if (entry.compileJob !== undefined) {
      this.completeCompileJob(entry, 130, "^C\n");
      return { outcome: "accepted", state: "compile_interrupted" };
    }
    return this.requestStop(computerId, "shutdown", "terminated");
  }

  queueEvent(
    computerId: string,
    name: string,
    ...arguments_: readonly RuntimeValue[]
  ): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.vm === undefined)
      return { outcome: "ignored", reason: "not_running" };
    try {
      this.scheduler.queueEvent(
        entry.foreground?.runtimeId ?? entry.runtimeId,
        name,
        ...arguments_,
      );
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    } catch (error: unknown) {
      return failure(error);
    }
  }

  runTick(scope?: TickWorkScope): void {
    this.activeWorkScope = scope;
    this.peripherals.setWorkScope(scope);
    try {
      this.completePendingBootHandoffs(scope);
      this.runCompileJobs(scope);
      const observer: SchedulerWorkObserver | undefined =
        scope === undefined
          ? undefined
          : {
              prepare: (_computerId, operation) =>
                scope.tryRun(
                  { lane: "event_delivery", deterministicUnits: 1 },
                  operation,
                ).outcome === "ran",
              runCpuSlice: (
                computerId,
                operation,
              ): CpuProcessSliceResult | undefined => {
                const attempt = scope.tryRun(
                  {
                    lane: this.runtimeLanes.get(computerId) ?? "guest_cpu",
                    deterministicUnits: 1,
                  },
                  operation,
                );
                return attempt.outcome === "ran" ? attempt.value : undefined;
              },
            };
      const tick = this.scheduler.runTick(observer);
      const scheduled = new Map(
        tick.computers.map((computer) => [computer.id, computer] as const),
      );
      const reboot: RuntimeEntry[] = [];
      const activeEntries = new Set<RuntimeEntry>();
      for (const computer of tick.computers) {
        const owner = this.runtimeOwners.get(computer.id);
        if (owner !== undefined) activeEntries.add(owner);
      }
      for (const entry of activeEntries) {
        const foreground = entry.foreground;
        if (foreground !== undefined) {
          const measured = scheduled.get(foreground.runtimeId);
          if (measured !== undefined) {
            foreground.cpuCycles = Math.min(
              1_000_000,
              foreground.compileCycles + measured.cpuCycles,
            );
            foreground.executedInstructions = measured.executedInstructions;
          }
          if (
            foreground.instructionLimit !== undefined &&
            foreground.executedInstructions >= foreground.instructionLimit &&
            foreground.process.state.kind === "ready"
          ) {
            foreground.limitReached = true;
            foreground.process.terminate("execution limit reached");
          }
          const foregroundState = foreground.process.state;
          if (
            !foreground.process.hasPendingCpuCycles &&
            (foregroundState.kind === "completed" ||
              foregroundState.kind === "crashed" ||
              foregroundState.kind === "terminated")
          ) {
            this.completeForegroundProcess(entry, foreground, foregroundState);
          }
        }
        this.updateDebugJob(
          entry,
          scheduled.get(entry.debugJob?.runtimeId ?? -1),
        );
        if (entry.vm === undefined) continue;
        const state = entry.vm.state;
        if (
          entry.vm.hasPendingCpuCycles &&
          (state.kind === "completed" ||
            state.kind === "crashed" ||
            state.kind === "terminated")
        )
          continue;
        if (state.kind === "ready") {
          this.syncReady(entry);
        } else if (state.kind === "sleeping") {
          this.syncSleep(entry, state.wakeTick);
        } else if (state.kind === "waiting_event") {
          this.syncEventWait(entry, state.filter);
        } else if (state.kind === "crashed") {
          entry.record.display.transition({
            kind: "fault",
            message: state.error.message.slice(0, 256) || "guest runtime fault",
          });
          entry.record.lifecycle.transition({
            kind: "crash",
            message: state.error.message,
          });
          this.detach(entry);
        } else if (state.kind === "completed") {
          entry.record.lifecycle.transition({
            kind: "shutdown",
            reason: "program_completed",
          });
          this.detach(entry);
          entry.record.lifecycle.transition({ kind: "stopped" });
          entry.record.display.transition({ kind: "power_off" });
        } else if (state.kind === "terminated") {
          const intent = entry.stopIntent ?? "shutdown";
          this.detach(entry);
          entry.record.display.transition({ kind: "power_off" });
          if (intent === "reboot") {
            entry.record.lifecycle.transition({ kind: "reboot_ready" });
            reboot.push(entry);
          } else {
            entry.record.lifecycle.transition({ kind: "stopped" });
          }
        }
      }
      for (const entry of reboot) this.boot(entry);
    } finally {
      this.peripherals.setWorkScope(undefined);
      this.activeWorkScope = undefined;
    }
  }

  vmState(computerId: string): CpuProcessState | undefined {
    const entry = this.entries.get(computerId);
    return entry?.foreground?.process.state ?? entry?.vm?.state;
  }

  completeShellInput(
    computerId: string,
    line: string,
    cursor: number,
  ): ShellCompletionResult | undefined {
    return this.entries.get(computerId)?.shell?.complete(line, cursor);
  }

  isShellSecretInput(computerId: string): boolean {
    return this.entries.get(computerId)?.shell?.isSecretInput() ?? false;
  }

  executeDebugShellCommand(
    computerId: string,
    line: string,
  ): DebugShellCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.shell === undefined)
      return { outcome: "ignored", reason: "not_running" };
    if (entry.foreground !== undefined || entry.compileJob !== undefined) {
      return {
        outcome: "completed",
        exitCode: 2,
        stdout: "",
        stderr: "debug: a foreground process is already running\n",
        cpuCycles: 1,
      };
    }
    try {
      const trimmed = line.trim();
      const inlinePython = /^(?:micropython|python)\s+-c\s+([\s\S]+)$/u.exec(
        trimmed,
      );
      if (inlinePython !== null) {
        return this.executeDebugPython(
          entry,
          "/tmp/__mcp_inline__.py",
          inlinePython[1] ?? "",
        );
      }
      const python = /^(?:micropython|python)\s+(\S+)$/u.exec(trimmed);
      if (python !== null)
        return this.executeDebugPython(entry, python[1] ?? "");
      const result = entry.shell.submitDebugCommand(line);
      if (result.foreground?.kind === "compile") {
        let completion: DebugShellCommandCompletion | undefined;
        this.startCompileJob(entry, result.foreground, (value) => {
          completion = value;
        });
        const job = entry.compileJob;
        if (job === undefined) throw new Error("Unable to start compile job");
        this.executeCompileJob(entry, job);
        if (completion !== undefined) return completion;
        return {
          outcome: "failed",
          error: new Error("Synchronous BASIC execution is not supported"),
        };
      }
      if (result.foreground?.kind === "cs486") {
        const request = result.foreground;
        const executed = runCs486(request.executable, {
          cpuModel: entry.record.hardware.cpuModel,
          instructionLimit: 100_000,
          memoryBytes: entry.record.hardware.memoryBytes,
        });
        const cpuCycles = Math.min(
          1_000_000,
          request.compileCycles + executed.cycles,
        );
        return {
          outcome: "completed",
          exitCode: executed.state === "halted" ? 0 : 124,
          stdout: executed.output,
          stderr: request.stats
            ? `${cs486RunResultStats(executed, entry.record.hardware).join("\n")}\n`
            : executed.state === "yielded"
              ? `${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: execution limit reached\n`
              : "",
          cpuCycles,
        };
      }
      return {
        outcome: "completed",
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        cpuCycles: result.cpuCycles ?? 1,
      };
    } catch (error: unknown) {
      return {
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Starts MCP-facing guest execution without running a guest loop on the
   * Script API callback stack. The completion callback is owned by this
   * runtime and is invoked exactly once after the scheduler reaches a terminal
   * state. Non-guest commands complete immediately through the same callback.
   */
  enqueueDebugShellCommand(
    computerId: string,
    line: string,
    onComplete: (result: DebugShellCommandCompletion) => void,
  ): void {
    const entry = this.entries.get(computerId);
    if (entry === undefined) {
      onComplete({ outcome: "missing", computerId });
      return;
    }
    if (entry.shell === undefined) {
      onComplete({ outcome: "ignored", reason: "not_running" });
      return;
    }
    if (
      entry.foreground !== undefined ||
      entry.compileJob !== undefined ||
      entry.debugJob !== undefined
    ) {
      onComplete({
        outcome: "completed",
        exitCode: 2,
        stdout: "",
        stderr: "debug: a foreground process is already running\n",
        cpuCycles: 1,
      });
      return;
    }
    try {
      const trimmed = line.trim();
      const inlinePython = /^(?:micropython|python)\s+-c\s+([\s\S]+)$/u.exec(
        trimmed,
      );
      if (inlinePython !== null) {
        this.enqueueDebugPython(
          entry,
          "/tmp/__mcp_inline__.py",
          inlinePython[1] ?? "",
          onComplete,
        );
        return;
      }
      const python = /^(?:micropython|python)\s+(\S+)$/u.exec(trimmed);
      if (python !== null) {
        this.enqueueDebugPython(entry, python[1] ?? "", undefined, onComplete);
        return;
      }
      const result = entry.shell.submitDebugCommand(line);
      if (result.foreground?.kind === "compile") {
        this.startCompileJob(entry, result.foreground, onComplete);
        return;
      }
      if (result.foreground?.kind === "cs486") {
        this.enqueueDebugCs486(entry, result.foreground, onComplete);
        return;
      }
      onComplete({
        outcome: "completed",
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        cpuCycles: result.cpuCycles ?? 1,
      });
    } catch (error: unknown) {
      onComplete({
        outcome: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  private enqueueDebugPython(
    entry: RuntimeEntry,
    path: string,
    inlineSource: string | undefined,
    onComplete: (result: DebugShellCommandCompletion) => void,
  ): void {
    const cpu = cpuModelSpecification(entry.record.hardware.cpuModel);
    if (!cpu.supportsMicroPython) {
      onComplete({
        outcome: "completed",
        exitCode: 127,
        stdout: "",
        stderr: `MicroPython is not available on ${cpu.runtimeName}\n`,
        cpuCycles: 1,
      });
      return;
    }
    const source = inlineSource ?? entry.record.filesystem.readFile(path);
    const terminal = new TerminalBuffer(80, 25);
    const runtimeId = this.nextRuntimeId++;
    const environment = createNativeEnvironment({
      clock: this.clock,
      computerId: numericComputerId(entry.record.computerId),
      computerName: entry.record.computerId,
      osProfile: entry.record.osProfile,
      filesystem: entry.record.filesystem,
      terminal,
      hardware: entry.record.hardware,
      memoryUsageBytes: () => entry.debugJob?.process.memoryUsageBytes ?? 0,
      currentTick: () => this.scheduler.tickNumber,
      ticksPerSecond: this.ticksPerSecond,
      serial: this.serial,
      peripherals: this.peripherals,
      runHostWork: (lane, units, operation) =>
        this.runHostWork(lane, units, entry.record.computerId, operation),
    });
    const process = createPythonCs486Program({
      cpuModel: entry.record.hardware.cpuModel,
      environment,
      filesystem: entry.record.filesystem,
      memoryBytes: entry.record.hardware.memoryBytes,
      path,
      source,
    }).process;
    this.startDebugJob(entry, {
      compileCycles: 0,
      kind: "python",
      onComplete,
      process,
      runtimeId,
      stats: true,
      terminal,
    });
  }

  private enqueueDebugCs486(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "cs486" }>,
    onComplete: (result: DebugShellCommandCompletion) => void,
  ): void {
    this.startDebugJob(entry, {
      compileCycles: request.compileCycles,
      instructionLimit: 100_000,
      kind: "cs486",
      onComplete,
      process: new Cs486Process(request.executable, {
        cpuModel: entry.record.hardware.cpuModel,
        memoryBytes: entry.record.hardware.memoryBytes,
      }),
      runtimeId: this.nextRuntimeId++,
      stats: request.stats,
    });
  }

  private startDebugJob(
    entry: RuntimeEntry,
    job: Omit<DebugGuestJob, "cpuCycles" | "executedInstructions">,
  ): void {
    const active: DebugGuestJob = {
      ...job,
      cpuCycles: 0,
      executedInstructions: 0,
    };
    entry.debugJob = active;
    this.scheduler.add(
      active.runtimeId,
      active.process,
      hardwareCpuCyclesPerTick(
        entry.record.hardware.clockHz,
        this.ticksPerSecond,
      ),
    );
    this.runtimeOwners.set(active.runtimeId, entry);
    this.runtimeLanes.set(active.runtimeId, "mcp_debug");
  }

  private updateDebugJob(
    entry: RuntimeEntry,
    measured:
      | {
          readonly cpuCycles: number;
          readonly executedInstructions: number;
        }
      | undefined,
  ): void {
    const job = entry.debugJob;
    if (job === undefined) return;
    if (measured !== undefined) {
      job.cpuCycles = Math.min(
        100_000_000,
        job.compileCycles + measured.cpuCycles,
      );
      job.executedInstructions = measured.executedInstructions;
    }
    const state = job.process.state;
    if (state.kind === "sleeping" || state.kind === "waiting_event") {
      job.termination = "unsupported_wait";
      job.process.terminate(
        "MCP debug execution does not support waits or long-running work",
      );
    } else if (
      job.instructionLimit !== undefined &&
      job.executedInstructions >= job.instructionLimit &&
      state.kind === "ready"
    ) {
      job.termination = "instruction_limit";
      job.process.terminate("execution limit reached");
    } else if (job.cpuCycles >= 100_000_000 && state.kind === "ready") {
      job.termination = "cpu_limit";
      job.process.terminate("MCP debug CPU cycle limit reached");
    }
    const terminalState = job.process.state;
    if (
      !job.process.hasPendingCpuCycles &&
      (terminalState.kind === "completed" ||
        terminalState.kind === "crashed" ||
        terminalState.kind === "terminated")
    ) {
      this.completeDebugJob(entry, job, terminalState);
    }
  }

  private completeDebugJob(
    entry: RuntimeEntry,
    job: DebugGuestJob,
    state: Extract<
      CpuProcessState,
      { readonly kind: "completed" | "crashed" | "terminated" }
    >,
  ): void {
    this.unschedule(job.runtimeId);
    entry.debugJob = undefined;
    const stdout =
      job.kind === "python"
        ? terminalStdout(job.terminal!)
        : job.process.output;
    let result: DebugShellCommandCompletion;
    if (job.termination === "instruction_limit") {
      result = {
        outcome: "completed",
        exitCode: 124,
        stdout,
        stderr: `${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: execution limit reached\n`,
        cpuCycles: job.cpuCycles,
      };
    } else if (
      job.termination === "unsupported_wait" ||
      job.termination === "cpu_limit"
    ) {
      result = {
        outcome: "completed",
        exitCode: 2,
        stdout,
        stderr:
          "MCP debug execution does not support waits or long-running work\n",
        cpuCycles: job.cpuCycles,
      };
    } else if (state.kind === "crashed") {
      result = {
        outcome: "completed",
        exitCode: 1,
        stdout,
        stderr: `${state.error.name}: ${state.error.message}\n`,
        cpuCycles: job.cpuCycles,
      };
    } else if (state.kind === "terminated") {
      result = {
        outcome: "completed",
        exitCode: 130,
        stdout,
        stderr: "debug: execution terminated\n",
        cpuCycles: job.cpuCycles,
      };
    } else {
      result = {
        outcome: "completed",
        exitCode: 0,
        stdout,
        stderr:
          job.kind === "python"
            ? pythonStats(
                job.executedInstructions,
                job.cpuCycles,
                "completed",
                entry.record.hardware,
              )
            : job.stats
              ? `${cs486Stats(
                  job.executedInstructions,
                  job.cpuCycles,
                  "halted",
                  entry.record.hardware,
                  job.process,
                ).join("\n")}\n`
              : "",
        cpuCycles: job.cpuCycles,
      };
    }
    entry.shell?.completeForegroundProcess(result.exitCode);
    job.onComplete(result);
  }

  private executeDebugPython(
    entry: RuntimeEntry,
    path: string,
    inlineSource?: string,
  ): DebugShellCommandResult {
    const cpu = cpuModelSpecification(entry.record.hardware.cpuModel);
    if (!cpu.supportsMicroPython) {
      return {
        outcome: "completed",
        exitCode: 127,
        stdout: "",
        stderr: `MicroPython is not available on ${cpu.runtimeName}\n`,
        cpuCycles: 1,
      };
    }
    const source = inlineSource ?? entry.record.filesystem.readFile(path);
    const terminal = new TerminalBuffer(80, 25);
    const environment = createNativeEnvironment({
      clock: this.clock,
      computerId: numericComputerId(entry.record.computerId),
      computerName: entry.record.computerId,
      osProfile: entry.record.osProfile,
      filesystem: entry.record.filesystem,
      terminal,
      hardware: entry.record.hardware,
      memoryUsageBytes: () => 0,
      currentTick: () => this.scheduler.tickNumber,
      shell: entry.shell,
      ticksPerSecond: this.ticksPerSecond,
      serial: this.serial,
      peripherals: this.peripherals,
      runHostWork: (lane, units, operation) =>
        this.runHostWork(lane, units, entry.record.computerId, operation),
    });
    const vm = createPythonCs486Program({
      cpuModel: entry.record.hardware.cpuModel,
      environment,
      filesystem: entry.record.filesystem,
      memoryBytes: entry.record.hardware.memoryBytes,
      path,
      source,
    }).process;
    const maximumCpuCycles = 100_000_000;
    let cpuCycles = 0;
    let instructions = 0;
    while (
      (vm.state.kind === "ready" || vm.hasPendingCpuCycles) &&
      cpuCycles < maximumCpuCycles
    ) {
      const slice = vm.runCpuSlice(
        Math.min(1_000_000, maximumCpuCycles - cpuCycles),
      );
      if (slice.cpuCycles === 0) break;
      cpuCycles += slice.cpuCycles;
      instructions += slice.executedInstructions;
    }
    const output = terminal.snapshot().rows.join("\n").trimEnd();
    const stdout = output.length === 0 ? "" : `${output}\n`;
    if (vm.state.kind === "completed") {
      return {
        outcome: "completed",
        exitCode: 0,
        stdout,
        stderr: pythonStats(
          instructions,
          cpuCycles,
          "completed",
          entry.record.hardware,
        ),
        cpuCycles,
      };
    }
    if (vm.state.kind === "crashed") {
      return {
        outcome: "completed",
        exitCode: 1,
        stdout,
        stderr: `${vm.state.error.name}: ${vm.state.error.message}\n`,
        cpuCycles,
      };
    }
    vm.terminate(
      "MCP debug execution does not support waits or long-running work",
    );
    return {
      outcome: "completed",
      exitCode: 2,
      stdout,
      stderr:
        cpuCycles >= maximumCpuCycles
          ? `Python/${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: CPU cycle limit ${String(maximumCpuCycles)} exceeded\n`
          : `Python/${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: waits and asynchronous work are not supported through MCP\n`,
      cpuCycles,
    };
  }

  resizeTerminal(computerId: string, width: number, height: number): boolean {
    const entry = this.entries.get(computerId);
    if (
      entry === undefined ||
      entry.shell === undefined ||
      width !== 80 ||
      height !== 25
    ) {
      return false;
    }
    entry.record.terminal.resize(width, height);
    const screen = entry.shell.resize(width, height);
    if (screen !== undefined)
      renderTerminalScreen(entry.record.terminal, screen);
    return true;
  }

  private boot(entry: RuntimeEntry): RuntimeCommandResult {
    try {
      entry.record.faceIo.powerOn();
      if (entry.record.display.state.kind === "faulted") {
        entry.record.display.transition({ kind: "reset" });
      } else if (entry.record.display.state.kind !== "off") {
        entry.record.display.transition({ kind: "power_off" });
      }
      const post = entry.record.display.transition({ kind: "enter_post" });
      if (post.outcome !== "changed") {
        throw new Error(`Unable to start CSBIOS POST: ${post.outcome}`);
      }
      renderCsBiosPost(entry.record);
      const supportsMicroPython = cpuModelSpecification(
        entry.record.hardware.cpuModel,
      ).supportsMicroPython;
      const source =
        supportsMicroPython && entry.record.filesystem.exists("/startup.py")
          ? entry.record.filesystem.readFile("/startup.py")
          : this.defaultBootSource;
      const environment = createNativeEnvironment({
        clock: this.clock,
        computerId: numericComputerId(entry.record.computerId),
        computerName: entry.record.computerId,
        osProfile: entry.record.osProfile,
        filesystem: entry.record.filesystem,
        terminal: entry.record.terminal,
        hardware: entry.record.hardware,
        memoryUsageBytes: () =>
          entry.foreground?.process.memoryUsageBytes ??
          entry.vm?.memoryUsageBytes ??
          0,
        redstone: entry.record.redstone,
        currentTick: () => this.scheduler.tickNumber,
        queueEvent: (name, ...arguments_) =>
          this.scheduler.queueEvent(entry.runtimeId, name, ...arguments_),
        startTimer: (delay) =>
          this.scheduler.startTimer(entry.runtimeId, delay),
        cancelTimer: (timerId) =>
          this.scheduler.cancelTimer(entry.runtimeId, timerId),
        shutdown: () => this.requestEntryStop(entry, "shutdown", "shutdown"),
        reboot: () => this.requestEntryStop(entry, "reboot", "reboot"),
        startForegroundProcess: (request) =>
          this.startForegroundProcess(entry, request),
        ticksPerSecond: this.ticksPerSecond,
        requireLinuxLogin: this.requireLinuxLogin,
        serial: this.serial,
        peripherals: this.peripherals,
        requestFilesystemIo: (operation, bytes) =>
          this.filesystemIoRequester?.(
            entry.record.computerId,
            operation,
            bytes,
          ),
        runHostWork: (lane, units, operation) =>
          this.runHostWork(lane, units, entry.record.computerId, operation),
      });
      const vm = createPythonCs486Program({
        cpuModel: entry.record.hardware.cpuModel,
        environment,
        filesystem: entry.record.filesystem,
        memoryBytes: entry.record.hardware.memoryBytes,
        path: "/startup.py",
        source,
      }).process;
      entry.vm = vm;
      entry.shell = environment.shell;
      entry.stopIntent = undefined;
      entry.pendingBootHandoff = true;
      this.pendingBootHandoffs.add(entry);
      this.scheduler.add(
        entry.runtimeId,
        vm,
        hardwareCpuCyclesPerTick(
          entry.record.hardware.clockHz,
          this.ticksPerSecond,
        ),
      );
      this.runtimeOwners.set(entry.runtimeId, entry);
      this.runtimeLanes.set(entry.runtimeId, "guest_cpu");
      entry.record.lifecycle.transition({ kind: "boot_complete" });
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    } catch (error: unknown) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      entry.record.lifecycle.transition({
        kind: "crash",
        message: normalized.message,
      });
      entry.pendingBootHandoff = false;
      entry.record.faceIo.powerOff("boot_failed");
      entry.record.display.transition({
        kind: "fault",
        message: normalized.message.slice(0, 256) || "CSBIOS boot failure",
      });
      return { outcome: "failed", error: normalized };
    }
  }

  private startForegroundProcess(
    entry: RuntimeEntry,
    request: ShellForegroundRequest,
  ): ForegroundProcessStartResult {
    if (entry.foreground !== undefined || entry.compileJob !== undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: a foreground process is already running\n`,
      };
    }
    if (entry.vm === undefined || entry.shell === undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: shell runtime is not running\n`,
      };
    }
    if (request.kind === "compile") {
      return this.startCompileJob(entry, request);
    }
    const cpu = cpuModelSpecification(entry.record.hardware.cpuModel);
    if (request.kind === "python" && !cpu.supportsMicroPython) {
      return {
        outcome: "failed",
        exitCode: 127,
        stderr: `${request.command}: MicroPython is not available on ${cpu.runtimeName}\n`,
      };
    }
    try {
      const runtimeId = this.nextRuntimeId++;
      const completionEvent = `${foregroundCompletionEvent}:${String(runtimeId)}`;
      const process =
        request.kind === "python"
          ? this.createForegroundPythonProcess(entry, request, runtimeId)
          : new Cs486Process(request.executable, {
              cpuModel: entry.record.hardware.cpuModel,
              memoryBytes: entry.record.hardware.memoryBytes,
            });
      const foreground: ForegroundGuestProcess = {
        command: request.command,
        compileCycles: request.kind === "cs486" ? request.compileCycles : 0,
        completionEvent,
        cpuCycles: 0,
        executedInstructions: 0,
        instructionLimit: request.kind === "cs486" ? 100_000 : undefined,
        kind: request.kind,
        process,
        runtimeId,
        stats: request.stats,
      };
      this.scheduler.add(
        runtimeId,
        process,
        hardwareCpuCyclesPerTick(
          entry.record.hardware.clockHz,
          this.ticksPerSecond,
        ),
      );
      this.runtimeOwners.set(runtimeId, entry);
      this.runtimeLanes.set(runtimeId, "guest_cpu");
      entry.foreground = foreground;
      return { completionEvent, outcome: "started" };
    } catch (error: unknown) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      return {
        outcome: "failed",
        exitCode: 1,
        stderr: `${request.command}: ${normalized.name}: ${normalized.message}\n`,
      };
    }
  }

  private startCompileJob(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
    onComplete?: (result: DebugShellCommandCompletion) => void,
  ): ForegroundProcessStartResult {
    if (entry.compileJob !== undefined || entry.foreground !== undefined) {
      return {
        outcome: "failed",
        exitCode: 2,
        stderr: `${request.command}: a foreground process is already running\n`,
      };
    }
    const completionEvent = `${foregroundCompletionEvent}:compile:${String(this.nextRuntimeId++)}`;
    entry.compileJob = { completionEvent, onComplete, request };
    this.compileReady.add(entry);
    return { completionEvent, outcome: "started" };
  }

  private runCompileJobs(scope?: TickWorkScope): void {
    let processed = 0;
    for (const entry of this.compileReady) {
      if (processed >= 4) break;
      const job = entry.compileJob;
      if (job === undefined) {
        this.compileReady.delete(entry);
        continue;
      }
      const units = compileJobUnits(job.request);
      try {
        if (scope === undefined) {
          this.executeCompileJob(entry, job);
        } else {
          const attempt = scope.tryRun(
            {
              lane: "guest_compile",
              deterministicUnits: units,
              computerId: entry.record.computerId,
            },
            () => this.executeCompileJob(entry, job),
          );
          if (attempt.outcome === "deferred") break;
        }
      } catch (error: unknown) {
        const normalized =
          error instanceof Error ? error : new Error(String(error));
        this.completeCompileJob(
          entry,
          1,
          `${job.request.command}: ${normalized.name}: ${normalized.message}\n`,
        );
      }
      processed += 1;
    }
  }

  private executeCompileJob(entry: RuntimeEntry, job: CompileJob): void {
    const task = job.request.task;
    if (task.kind === "link") {
      const executable = linkCs486Objects(task.objects, { entry: task.entry });
      entry.shell?.writeCompilerOutput(
        task.outputPath,
        `CS486\n${JSON.stringify(executable)}`,
      );
      this.completeCompileJob(entry, 0, "", compileTaskCycles(job.request));
      return;
    }
    const output = task.compileOnly
      ? task.language === "asm"
        ? assembleCs486Object(task.source)
        : compileCs486Object(task.language, task.source)
      : task.language === "asm"
        ? assembleCs486(task.source)
        : compileCs486Source(task.language, task.source);
    const compileCycles = compileTaskCycles(job.request, output);
    if (task.runAfterCompile) {
      if (output.format !== "cs486-executable") {
        throw new Error("Compiled BASIC program did not produce an executable");
      }
      this.compileReady.delete(entry);
      entry.compileJob = undefined;
      if (job.onComplete !== undefined) {
        this.startDebugJob(entry, {
          compileCycles,
          instructionLimit: 100_000,
          kind: "cs486",
          onComplete: job.onComplete,
          process: new Cs486Process(output, {
            cpuModel: entry.record.hardware.cpuModel,
            memoryBytes: entry.record.hardware.memoryBytes,
          }),
          runtimeId: this.nextRuntimeId++,
          stats: false,
        });
      } else {
        this.startCompiledForeground(
          entry,
          output,
          job.completionEvent,
          compileCycles,
        );
      }
      return;
    }
    if (task.outputPath === undefined)
      throw new Error("Compiler output is missing");
    entry.shell?.writeCompilerOutput(
      task.outputPath,
      `${output.format === "cs486-object" ? "CS486OBJ" : "CS486"}\n${JSON.stringify(output)}`,
    );
    this.completeCompileJob(entry, 0, "", compileCycles);
  }

  private startCompiledForeground(
    entry: RuntimeEntry,
    executable: Parameters<typeof runCs486>[0],
    completionEvent: string,
    compileCycles: number,
  ): void {
    const runtimeId = this.nextRuntimeId++;
    const process = new Cs486Process(executable, {
      cpuModel: entry.record.hardware.cpuModel,
      memoryBytes: entry.record.hardware.memoryBytes,
    });
    entry.foreground = {
      command: "basic",
      compileCycles,
      completionEvent,
      cpuCycles: 0,
      executedInstructions: 0,
      instructionLimit: 100_000,
      kind: "cs486",
      process,
      runtimeId,
      stats: false,
    };
    this.scheduler.add(
      runtimeId,
      process,
      hardwareCpuCyclesPerTick(
        entry.record.hardware.clockHz,
        this.ticksPerSecond,
      ),
    );
    this.runtimeOwners.set(runtimeId, entry);
    this.runtimeLanes.set(runtimeId, "guest_cpu");
  }

  private completeCompileJob(
    entry: RuntimeEntry,
    exitCode: number,
    stderr: string,
    cpuCycles = 1,
  ): void {
    const job = entry.compileJob;
    if (job === undefined) return;
    this.compileReady.delete(entry);
    entry.compileJob = undefined;
    if (job.onComplete !== undefined) {
      job.onComplete({
        outcome: "completed",
        exitCode,
        stderr,
        stdout: "",
        cpuCycles,
      });
      return;
    }
    if (stderr.length > 0) {
      writeTerminalLines(entry.record.terminal, stderr.trimEnd().split("\n"));
    }
    entry.shell?.completeForegroundProcess(exitCode);
    if (entry.vm !== undefined) {
      this.scheduler.queueEvent(entry.runtimeId, job.completionEvent, exitCode);
    }
  }

  private createForegroundPythonProcess(
    entry: RuntimeEntry,
    request: Extract<ShellForegroundRequest, { readonly kind: "python" }>,
    runtimeId: number,
  ): Cs486Process {
    const source = entry.record.filesystem.readFile(request.path);
    const environment = createNativeEnvironment({
      clock: this.clock,
      computerId: numericComputerId(entry.record.computerId),
      computerName: entry.record.computerId,
      osProfile: entry.record.osProfile,
      filesystem: entry.record.filesystem,
      terminal: entry.record.terminal,
      hardware: entry.record.hardware,
      memoryUsageBytes: () => entry.foreground?.process.memoryUsageBytes ?? 0,
      redstone: entry.record.redstone,
      currentTick: () => this.scheduler.tickNumber,
      queueEvent: (name, ...arguments_) =>
        this.scheduler.queueEvent(runtimeId, name, ...arguments_),
      startTimer: (delay) => this.scheduler.startTimer(runtimeId, delay),
      cancelTimer: (timerId) => this.scheduler.cancelTimer(runtimeId, timerId),
      shutdown: () => this.requestEntryStop(entry, "shutdown", "shutdown"),
      reboot: () => this.requestEntryStop(entry, "reboot", "reboot"),
      ticksPerSecond: this.ticksPerSecond,
      shell: entry.shell,
      serial: this.serial,
      peripherals: this.peripherals,
      runHostWork: (lane, units, operation) =>
        this.runHostWork(lane, units, entry.record.computerId, operation),
    });
    return createPythonCs486Program({
      cpuModel: entry.record.hardware.cpuModel,
      environment,
      filesystem: entry.record.filesystem,
      memoryBytes: entry.record.hardware.memoryBytes,
      path: request.path,
      source,
    }).process;
  }

  private completeForegroundProcess(
    entry: RuntimeEntry,
    foreground: ForegroundGuestProcess,
    state: CpuProcessState,
  ): void {
    this.unschedule(foreground.runtimeId);
    entry.foreground = undefined;
    if (entry.stopIntent !== undefined || entry.vm === undefined) return;

    let exitCode: number;
    let stateName: string;
    if (foreground.limitReached === true) {
      exitCode = 124;
      stateName = "yielded";
      writeTerminalLines(entry.record.terminal, [
        `${cpuModelSpecification(entry.record.hardware.cpuModel).runtimeName}: execution limit reached`,
      ]);
    } else if (state.kind === "completed") {
      exitCode = 0;
      stateName = foreground.kind === "cs486" ? "halted" : "completed";
    } else if (state.kind === "crashed") {
      exitCode = 1;
      stateName = "crashed";
      writeTerminalLines(entry.record.terminal, [
        `${state.error.name}: ${state.error.message}`,
      ]);
    } else if (state.kind === "terminated") {
      exitCode = 130;
      stateName = "terminated";
      writeTerminalLines(entry.record.terminal, ["^C"]);
    } else {
      throw new Error(`Cannot complete foreground process from ${state.kind}`);
    }
    if (foreground.kind === "cs486" && foreground.process.output.length > 0) {
      writeTerminalLines(
        entry.record.terminal,
        foreground.process.output
          .replaceAll("\r\n", "\n")
          .replace(/\n$/u, "")
          .split("\n"),
      );
    }
    if (foreground.stats) {
      writeTerminalLines(entry.record.terminal, [
        ...(foreground.kind === "python"
          ? pythonStats(
              foreground.executedInstructions,
              foreground.cpuCycles,
              stateName,
              entry.record.hardware,
            )
              .trimEnd()
              .split("\n")
          : cs486Stats(
              foreground.executedInstructions,
              foreground.cpuCycles,
              stateName,
              entry.record.hardware,
              foreground.process,
            )),
      ]);
    }
    entry.shell?.completeForegroundProcess(exitCode);
    this.scheduler.queueEvent(
      entry.runtimeId,
      foreground.completionEvent,
      exitCode,
    );
  }

  private requestStop(
    computerId: string,
    intent: StopIntent,
    reason: string,
  ): RuntimeCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.vm === undefined)
      return { outcome: "ignored", reason: "not_running" };
    this.requestEntryStop(entry, intent, reason);
    return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
  }

  private requestEntryStop(
    entry: RuntimeEntry,
    intent: StopIntent,
    reason: string,
  ): void {
    const event =
      intent === "reboot"
        ? { kind: "reboot" as const }
        : { kind: "shutdown" as const, reason };
    const transition = entry.record.lifecycle.transition(event);
    if (transition.outcome !== "changed") return;
    entry.record.faceIo.powerOff(reason);
    entry.stopIntent = intent;
    if (entry.compileJob !== undefined) this.completeCompileJob(entry, 130, "");
    entry.foreground?.process.terminate(reason);
    entry.debugJob?.process.terminate(reason);
    entry.vm?.terminate(reason);
  }

  private syncReady(entry: RuntimeEntry): void {
    if (entry.record.lifecycle.state.kind !== "running") {
      entry.record.lifecycle.transition({ kind: "vm_ready" });
    }
  }

  private syncSleep(entry: RuntimeEntry, wakeTick: number): void {
    const state = entry.record.lifecycle.state;
    if (state.kind !== "sleeping" || state.wakeTick !== wakeTick) {
      entry.record.lifecycle.transition({ kind: "vm_sleep", wakeTick });
    }
  }

  private syncEventWait(entry: RuntimeEntry, filter?: string): void {
    const state = entry.record.lifecycle.state;
    if (state.kind !== "waiting_event" || state.filter !== filter) {
      entry.record.lifecycle.transition({ kind: "vm_wait_event", filter });
    }
  }

  private detach(entry: RuntimeEntry): void {
    entry.record.faceIo.powerOff("runtime_detached");
    if (entry.compileJob !== undefined) {
      const compileJob = entry.compileJob;
      this.compileReady.delete(entry);
      entry.compileJob = undefined;
      compileJob.onComplete?.({
        outcome: "failed",
        error: new Error("compile job ended because the runtime detached"),
      });
    }
    if (entry.foreground !== undefined) {
      this.unschedule(entry.foreground.runtimeId);
      entry.foreground = undefined;
    }
    if (entry.debugJob !== undefined) {
      const debugJob = entry.debugJob;
      this.unschedule(debugJob.runtimeId);
      entry.debugJob = undefined;
      debugJob.onComplete({
        outcome: "failed",
        error: new Error(
          "debug guest execution ended because the runtime detached",
        ),
      });
    }
    this.unschedule(entry.runtimeId);
    entry.vm = undefined;
    entry.shell = undefined;
    entry.stopIntent = undefined;
    entry.pendingBootHandoff = false;
    this.pendingBootHandoffs.delete(entry);
  }

  private completePendingBootHandoffs(scope?: TickWorkScope): void {
    let completed = 0;
    for (const entry of this.pendingBootHandoffs) {
      if (completed >= 64) break;
      const operation = (): void => {
        this.pendingBootHandoffs.delete(entry);
        completed += 1;
        if (entry.pendingBootHandoff !== true) return;
        try {
          clearCsBiosForOs(entry.record.terminal, entry.record.display);
          entry.pendingBootHandoff = false;
        } catch (error: unknown) {
          const normalized =
            error instanceof Error ? error : new Error(String(error));
          entry.pendingBootHandoff = false;
          entry.record.display.transition({
            kind: "fault",
            message:
              normalized.message.slice(0, 256) || "CSBIOS handoff failure",
          });
          entry.record.lifecycle.transition({
            kind: "crash",
            message: normalized.message,
          });
          this.detach(entry);
        }
      };
      if (scope === undefined) {
        operation();
      } else if (
        scope.tryRun(
          {
            lane: "control",
            deterministicUnits: 1,
            computerId: entry.record.computerId,
          },
          operation,
        ).outcome === "deferred"
      ) {
        break;
      }
    }
  }

  private unschedule(runtimeId: number): void {
    this.scheduler.remove(runtimeId);
    this.runtimeOwners.delete(runtimeId);
    this.runtimeLanes.delete(runtimeId);
  }

  private runHostWork<T>(
    lane: ComputerWorkLane,
    deterministicUnits: number,
    computerId: string,
    operation: () => T,
  ): T {
    if (this.activeWorkScope === undefined) return operation();
    const attempt = this.activeWorkScope.tryRun(
      { lane, deterministicUnits, computerId },
      operation,
    );
    if (attempt.outcome === "ran") return attempt.value;
    throw new VmRuntimeError(
      "BlockingIOError",
      `${lane} host work budget exhausted; retry after tick ${String(attempt.retryTick)}`,
    );
  }
}

interface RuntimeEntry {
  readonly record: ComputerRecord;
  readonly runtimeId: number;
  vm?: CpuProcess;
  shell?: ShellSession;
  stopIntent?: StopIntent;
  pendingBootHandoff?: boolean;
  foreground?: ForegroundGuestProcess;
  debugJob?: DebugGuestJob;
  compileJob?: CompileJob;
}

interface CompileJob {
  readonly completionEvent: string;
  readonly onComplete?: (result: DebugShellCommandCompletion) => void;
  readonly request: Extract<
    ShellForegroundRequest,
    { readonly kind: "compile" }
  >;
}

interface DebugGuestJob {
  readonly compileCycles: number;
  cpuCycles: number;
  executedInstructions: number;
  readonly instructionLimit?: number;
  readonly kind: "cs486" | "python";
  readonly onComplete: (result: DebugShellCommandCompletion) => void;
  readonly process: Cs486Process;
  readonly runtimeId: number;
  readonly stats: boolean;
  readonly terminal?: TerminalBuffer;
  termination?: "cpu_limit" | "instruction_limit" | "unsupported_wait";
}

interface ForegroundGuestProcess {
  readonly command: "basic" | "micropython" | "python" | "run";
  readonly compileCycles: number;
  readonly completionEvent: string;
  cpuCycles: number;
  executedInstructions: number;
  readonly instructionLimit?: number;
  readonly kind: "cs486" | "python";
  limitReached?: boolean;
  readonly process: Cs486Process;
  readonly runtimeId: number;
  readonly stats: boolean;
}

const foregroundCompletionEvent = "__cs_foreground_complete";

type StopIntent = "reboot" | "shutdown";

function pythonStats(
  instructions: number,
  cpuCycles: number,
  state: string,
  hardware: ComputerHardwareProfile,
): string {
  const microseconds = cpuCyclesToMicroseconds(cpuCycles, hardware.clockHz);
  const runtimeName = cpuModelSpecification(hardware.cpuModel).runtimeName;
  return `Python/${runtimeName}: ${String(instructions)} machine instructions, ${String(cpuCycles)} CPU cycles, ${microseconds.toFixed(3)} us at ${formatClock(hardware.clockHz)}, ${state}\n`;
}

function cs486Stats(
  instructions: number,
  cpuCycles: number,
  state: string,
  hardware: ComputerHardwareProfile,
  process: Cs486Process,
): readonly string[] {
  const microseconds = cpuCyclesToMicroseconds(cpuCycles, hardware.clockHz);
  const runtimeName = cpuModelSpecification(hardware.cpuModel).runtimeName;
  const stats = process.microarchitectureStats;
  return [
    `${runtimeName}: ${String(instructions)} instructions, ${String(cpuCycles)} CPU cycles, ${microseconds.toFixed(3)} us at ${formatClock(hardware.clockHz)}, ${state}`,
    `memory: L1 ${String(stats.l1Hits)} hit/${String(stats.l1Misses)} miss, L2 ${String(stats.l2Hits)} hit/${String(stats.l2Misses)} miss, ${String(stats.busTransfers)} bus transfers, ${String(stats.unalignedAccesses)} unaligned, ${String(stats.pipelineFlushes)} pipeline flushes`,
  ];
}

function cs486RunResultStats(
  result: ReturnType<typeof runCs486>,
  hardware: ComputerHardwareProfile,
): readonly string[] {
  const microseconds = cpuCyclesToMicroseconds(result.cycles, hardware.clockHz);
  const runtimeName = cpuModelSpecification(hardware.cpuModel).runtimeName;
  const stats = result.microarchitecture;
  return [
    `${runtimeName}: ${String(result.executedInstructions)} instructions, ${String(result.cycles)} CPU cycles, ${microseconds.toFixed(3)} us at ${formatClock(hardware.clockHz)}, ${result.state}`,
    `memory: L1 ${String(stats.l1Hits)} hit/${String(stats.l1Misses)} miss, L2 ${String(stats.l2Hits)} hit/${String(stats.l2Misses)} miss, ${String(stats.busTransfers)} bus transfers, ${String(stats.unalignedAccesses)} unaligned, ${String(stats.pipelineFlushes)} pipeline flushes`,
  ];
}

function terminalStdout(terminal: TerminalBuffer): string {
  const output = terminal.snapshot().rows.join("\n").trimEnd();
  return output.length === 0 ? "" : `${output}\n`;
}

function formatClock(clockHz: number): string {
  return clockHz >= 1_000_000
    ? `${(clockHz / 1_000_000).toFixed(2).replace(/\.00$/u, "")} MHz`
    : `${String(clockHz)} Hz`;
}

function compileJobUnits(
  request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
): number {
  return request.task.kind === "source"
    ? Math.max(1, Math.min(256, Math.ceil(request.task.source.length / 512)))
    : Math.max(1, Math.min(256, request.task.objects.length * 4));
}

function compileTaskCycles(
  request: Extract<ShellForegroundRequest, { readonly kind: "compile" }>,
  output?:
    ReturnType<typeof assembleCs486Object> | ReturnType<typeof assembleCs486>,
): number {
  if (request.task.kind === "link") {
    return Math.min(
      1_000_000,
      request.task.objects.reduce(
        (total, object) =>
          total + object.symbols.length * 4 + object.relocations.length * 4,
        1,
      ),
    );
  }
  const outputWork =
    output === undefined
      ? 0
      : output.format === "cs486-object"
        ? output.assembly.split("\n").length * 2
        : output.instructions.length * 4;
  return Math.max(1, Math.ceil(request.task.source.length / 4) + outputWork);
}

function failure(error: unknown): RuntimeCommandResult {
  return {
    outcome: "failed",
    error: error instanceof Error ? error : new Error(String(error)),
  };
}
