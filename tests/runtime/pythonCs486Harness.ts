import {
  createPythonCs486Program,
  type PythonCs486Program,
} from "../../src/application/runtime/pythonCs486.js";
import {
  createNativeEnvironment,
  type NativeEnvironment,
} from "../../src/application/runtime/nativeModules.js";
import type { PythonRuntimeLimits } from "../../src/application/runtime/pythonLimits.js";
import type {
  CpuProcess,
  CpuProcessSliceResult,
  CpuProcessState,
} from "../../src/domain/runtime/cpuProcess.js";
import type { VmRuntimeError } from "../../src/domain/runtime/errors.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";
import type { RuntimeValue } from "../../src/domain/runtime/value.js";
import { TerminalBuffer } from "../../src/domain/terminal/terminalBuffer.js";

export interface PythonCs486HarnessOptions {
  readonly environment?: NativeEnvironment;
  readonly filesystem?: InMemoryFilesystem;
  readonly limits?: PythonRuntimeLimits;
  readonly memoryBytes?: number;
  readonly path?: string;
  readonly terminal?: TerminalBuffer;
}

export class PythonCs486Harness implements CpuProcess {
  readonly filesystem: InMemoryFilesystem;
  readonly terminal: TerminalBuffer;
  readonly program: PythonCs486Program;

  constructor(source: string, options: PythonCs486HarnessOptions = {}) {
    this.filesystem = options.filesystem ?? new InMemoryFilesystem();
    this.terminal = options.terminal ?? new TerminalBuffer();
    const environment =
      options.environment ??
      createNativeEnvironment({
        computerId: 1,
        filesystem: this.filesystem,
        terminal: this.terminal,
      });
    this.program = createPythonCs486Program({
      environment,
      filesystem: this.filesystem,
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

  runCpuSlice(cpuCycleBudget: number): CpuProcessSliceResult {
    return this.program.process.runCpuSlice(cpuCycleBudget);
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

export function runPythonCs486(
  source: string,
  options: PythonCs486HarnessOptions = {},
): PythonCs486Harness {
  const machine = new PythonCs486Harness(source, options);
  for (
    let slices = 0;
    slices < 1_000 &&
    (machine.state.kind === "ready" || machine.hasPendingCpuCycles);
    slices += 1
  )
    machine.runCpuSlice(100_000);
  return machine;
}
