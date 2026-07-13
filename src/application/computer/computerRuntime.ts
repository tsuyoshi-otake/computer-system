import { compileSource } from "../runtime/compiler.js";
import { createNativeEnvironment } from "../runtime/nativeModules.js";
import {
  RoundRobinScheduler,
  type SchedulerLimits,
} from "../runtime/scheduler.js";
import { StackVm, type VmState } from "../runtime/vm.js";
import type { ComputerRecord } from "../../domain/computer/computer.js";
import { numericComputerId } from "../../domain/computer/identity.js";
import type { RuntimeValue } from "../../domain/runtime/value.js";
import { defaultSystemBootSource } from "../os/systemPrograms.js";

export interface ComputerRuntimeOptions {
  readonly schedulerLimits?: SchedulerLimits;
  readonly defaultBootSource?: string;
}

export type RuntimeCommandResult =
  | { readonly outcome: "accepted"; readonly state: string }
  | {
      readonly outcome: "ignored";
      readonly reason: "already_registered" | "not_running";
    }
  | { readonly outcome: "missing"; readonly computerId: string }
  | { readonly outcome: "failed"; readonly error: Error };

export class ComputerRuntime {
  private readonly scheduler: RoundRobinScheduler;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly defaultBootSource: string;
  private nextRuntimeId = 1;

  constructor(options: ComputerRuntimeOptions = {}) {
    this.scheduler = new RoundRobinScheduler(options.schedulerLimits);
    this.defaultBootSource =
      options.defaultBootSource ?? defaultSystemBootSource;
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

  vmState(computerId: string): VmState | undefined {
    return this.entries.get(computerId)?.vm?.state;
  }

  private boot(entry: RuntimeEntry): RuntimeCommandResult {
    try {
      const source = entry.record.filesystem.exists("/startup.py")
        ? entry.record.filesystem.readFile("/startup.py")
        : this.defaultBootSource;
      const environment = createNativeEnvironment({
        computerId: numericComputerId(entry.record.computerId),
        filesystem: entry.record.filesystem,
        terminal: entry.record.terminal,
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
      });
      const vm = new StackVm(
        {
          code: compileSource(source, "/startup.py"),
          globals: environment.globals,
        },
        environment.moduleLoader,
      );
      entry.vm = vm;
      entry.stopIntent = undefined;
      this.scheduler.add(entry.runtimeId, vm);
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
    entry.stopIntent = undefined;
  }
}

interface RuntimeEntry {
  readonly record: ComputerRecord;
  readonly runtimeId: number;
  vm?: StackVm;
  stopIntent?: StopIntent;
}

type StopIntent = "reboot" | "shutdown";

function failure(error: unknown): RuntimeCommandResult {
  return {
    outcome: "failed",
    error: error instanceof Error ? error : new Error(String(error)),
  };
}
