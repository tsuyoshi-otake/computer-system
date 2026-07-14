import {
  createNativeEnvironment,
  renderTerminalScreen,
} from "../runtime/nativeModules.js";
import { createPythonCs486Program } from "../runtime/pythonCs486.js";
import {
  RoundRobinScheduler,
  type SchedulerLimits,
} from "../runtime/scheduler.js";
import type { CpuProcessState } from "../../domain/runtime/cpuProcess.js";
import type { CpuProcess } from "../../domain/runtime/cpuProcess.js";
import type { ComputerRecord } from "../../domain/computer/computer.js";
import { numericComputerId } from "../../domain/computer/identity.js";
import type { RuntimeValue } from "../../domain/runtime/value.js";
import { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { defaultSystemBootSource } from "../os/systemPrograms.js";
import type { ShellClockSource } from "../os/clock.js";
import type { ShellCompletionResult } from "../os/shellCommands.js";
import type { ShellSession } from "../os/shellSession.js";
import {
  hardwareCpuCyclesPerTick,
  type ComputerHardwareProfile,
} from "../../domain/computer/hardware.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import { cpuCyclesToMicroseconds } from "../../domain/cpu/timing.js";

export interface ComputerRuntimeOptions {
  readonly clock?: ShellClockSource;
  readonly schedulerLimits?: SchedulerLimits;
  readonly defaultBootSource?: string;
  readonly ticksPerSecond?: number;
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

export class ComputerRuntime {
  private readonly scheduler: RoundRobinScheduler;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly defaultBootSource: string;
  private readonly clock: ShellClockSource | undefined;
  private readonly ticksPerSecond: number;
  private nextRuntimeId = 1;

  constructor(options: ComputerRuntimeOptions = {}) {
    this.scheduler = new RoundRobinScheduler(options.schedulerLimits);
    this.defaultBootSource =
      options.defaultBootSource ?? defaultSystemBootSource;
    this.clock = options.clock;
    this.ticksPerSecond = options.ticksPerSecond ?? 20;
  }

  get tickNumber(): number {
    return this.scheduler.tickNumber;
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
      this.scheduler.queueEvent(entry.runtimeId, name, ...arguments_);
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    } catch (error: unknown) {
      return failure(error);
    }
  }

  runTick(): void {
    this.scheduler.runTick();
    const reboot: RuntimeEntry[] = [];
    for (const entry of this.entries.values()) {
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
      } else if (state.kind === "terminated") {
        const intent = entry.stopIntent ?? "shutdown";
        this.detach(entry);
        if (intent === "reboot") {
          entry.record.lifecycle.transition({ kind: "reboot_ready" });
          reboot.push(entry);
        } else {
          entry.record.lifecycle.transition({ kind: "stopped" });
        }
      }
    }
    for (const entry of reboot) this.boot(entry);
  }

  vmState(computerId: string): CpuProcessState | undefined {
    return this.entries.get(computerId)?.vm?.state;
  }

  completeShellInput(
    computerId: string,
    line: string,
    cursor: number,
  ): ShellCompletionResult | undefined {
    return this.entries.get(computerId)?.shell?.complete(line, cursor);
  }

  executeDebugShellCommand(
    computerId: string,
    line: string,
  ): DebugShellCommandResult {
    const entry = this.entries.get(computerId);
    if (entry === undefined) return { outcome: "missing", computerId };
    if (entry.shell === undefined)
      return { outcome: "ignored", reason: "not_running" };
    try {
      const python = /^(?:micropython|python)\s+(\S+)$/u.exec(line.trim());
      if (python !== null)
        return this.executeDebugPython(entry, python[1] ?? "");
      const result = entry.shell.submitDebugCommand(line);
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

  private executeDebugPython(
    entry: RuntimeEntry,
    path: string,
  ): DebugShellCommandResult {
    const source = entry.record.filesystem.readFile(path);
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
    if (entry === undefined || entry.shell === undefined) return false;
    entry.record.terminal.resize(width, height);
    const screen = entry.shell.resize(width, height);
    if (screen !== undefined)
      renderTerminalScreen(entry.record.terminal, screen);
    return true;
  }

  private boot(entry: RuntimeEntry): RuntimeCommandResult {
    try {
      const source = entry.record.filesystem.exists("/startup.py")
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
        memoryUsageBytes: () => entry.vm?.memoryUsageBytes ?? 0,
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
        ticksPerSecond: this.ticksPerSecond,
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
      this.scheduler.add(
        entry.runtimeId,
        vm,
        hardwareCpuCyclesPerTick(
          entry.record.hardware.clockHz,
          this.ticksPerSecond,
        ),
      );
      entry.record.lifecycle.transition({ kind: "boot_complete" });
      return { outcome: "accepted", state: entry.record.lifecycle.state.kind };
    } catch (error: unknown) {
      const normalized =
        error instanceof Error ? error : new Error(String(error));
      entry.record.lifecycle.transition({
        kind: "crash",
        message: normalized.message,
      });
      return { outcome: "failed", error: normalized };
    }
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
    entry.stopIntent = intent;
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
    this.scheduler.remove(entry.runtimeId);
    entry.vm = undefined;
    entry.shell = undefined;
    entry.stopIntent = undefined;
  }
}

interface RuntimeEntry {
  readonly record: ComputerRecord;
  readonly runtimeId: number;
  vm?: CpuProcess;
  shell?: ShellSession;
  stopIntent?: StopIntent;
}

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

function formatClock(clockHz: number): string {
  return clockHz >= 1_000_000
    ? `${(clockHz / 1_000_000).toFixed(2).replace(/\.00$/u, "")} MHz`
    : `${String(clockHz)} Hz`;
}

function failure(error: unknown): RuntimeCommandResult {
  return {
    outcome: "failed",
    error: error instanceof Error ? error : new Error(String(error)),
  };
}
