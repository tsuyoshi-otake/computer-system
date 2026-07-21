import {
  createPythonCs486Program,
  type PythonCs486Program,
} from "../../src/application/runtime/pythonCs486.js";
import type { NativeEnvironment } from "../../src/application/runtime/nativeModules.js";
import type { GuestFilesystem } from "../../src/application/os/guestFilesystem.js";
import type { PythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import type {
  CpuProcess,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../src/domain/runtime/cpuProcess.js";
import type { VmRuntimeError } from "../../src/domain/runtime/errors.js";
import type { RuntimeValue } from "../../src/domain/runtime/value.js";

export interface PythonCs486CoreHarnessOptions {
  readonly filesystem?: InMemoryFilesystem;
  readonly limits?: PythonRuntimeLimits;
  readonly memoryBytes?: number;
  readonly path?: string;
}

/**
 * Runs core Python semantics without importing the OS-native module registry.
 * Tests that exercise guest modules or native globals must use PythonCs486Harness.
 */
export class PythonCs486CoreHarness implements CpuProcess {
  readonly filesystem: InMemoryFilesystem;
  readonly program: PythonCs486Program;

  constructor(source: string, options: PythonCs486CoreHarnessOptions = {}) {
    this.filesystem = options.filesystem ?? new InMemoryFilesystem();
    const guestFilesystem = this.filesystem as unknown as GuestFilesystem;
    const environment = {
      filesystem: guestFilesystem,
      globals: new Map<string, RuntimeValue>(),
      modules: new Map(),
    } as unknown as NativeEnvironment;
    this.program = createPythonCs486Program({
      environment,
      filesystem: guestFilesystem,
      limits: options.limits,
      memoryBytes: options.memoryBytes ?? 1_048_576,
      path: options.path ?? "/main.py",
      source,
    });
  }

  get globals(): ReadonlyMap<string, RuntimeValue> {
    return this.program.runtime.globals;
  }

  get state(): CpuProcessState {
    return this.program.process.state;
  }

  get hasPendingCpuCycles(): boolean {
    return this.program.process.hasPendingCpuCycles;
  }

  get memoryUsageBytes(): number {
    return this.program.process.memoryUsageBytes;
  }

  get memoryLimitBytes(): number {
    return this.program.process.memoryLimitBytes;
  }

  runSlice(instructionBudget: number): CpuProcessSliceResult {
    return this.program.process.runInstructionSlice(instructionBudget);
  }

  runCpuSlice(
    cpuCycleBudget: number,
    instructionBudget?: number,
  ): CpuProcessSliceResult {
    return this.program.process.runCpuSlice(cpuCycleBudget, instructionBudget);
  }

  advanceTick(tick: number): CpuProcessState {
    return this.program.process.advanceTick(tick);
  }

  deliverEvent(name: string, ...arguments_: readonly RuntimeValue[]): boolean {
    return this.program.process.deliverEvent(name, ...arguments_);
  }

  fail(error: VmRuntimeError): CpuProcessState {
    return this.program.process.fail(error);
  }

  terminate(reason?: string): CpuProcessState {
    return this.program.process.terminate(reason);
  }
}

export function runPythonCs486Core(
  source: string,
  options: PythonCs486CoreHarnessOptions = {},
): PythonCs486CoreHarness {
  const machine = new PythonCs486CoreHarness(source, options);
  for (
    let slices = 0;
    slices < 1_000 &&
    (machine.state.kind === "ready" || machine.hasPendingCpuCycles);
    slices += 1
  )
    machine.runCpuSlice(100_000);
  return machine;
}
