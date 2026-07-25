import {
  createAttachableCsAbiBatchSyscallHandler,
  type CsAbiBatchHeapLayout,
} from "../src/application/runtime/csAbi.js";
import {
  Cs486Fault,
  Cs486Process,
  type Cs486Executable,
  type Cs486ProcessImageInitialization,
  type Cs486SyscallHandler,
} from "../src/domain/cpu/cs486.js";
import type { CpuMicroarchitectureStats } from "../src/domain/cpu/memoryHierarchy.js";
import type { CpuModel } from "../src/domain/cpu/models.js";
import type {
  CpuProcessSliceResult,
  CpuProcessState,
} from "../src/domain/runtime/cpuProcess.js";
import type { VmRuntimeError } from "../src/domain/runtime/errors.js";

/**
 * CPU engine boundary of the managed compute worker.
 *
 * The worker used to construct `Cs486Process` directly. It goes through this
 * interface so the worker's wire protocol does not depend on which engine runs
 * a process. Issue #115 removed the second engine, so `typescript` is the only
 * name today and `Cs486Process` is the single production CS486 implementation
 * again; the seam stays because engine selection remains explicit operator
 * configuration rather than inference.
 */
export const cs486ComputeEngineNames = [
  "typescript",
] as const satisfies readonly string[];

export type Cs486ComputeEngineName = (typeof cs486ComputeEngineNames)[number];

export const defaultCs486ComputeEngineName: Cs486ComputeEngineName =
  "typescript";

export function isCs486ComputeEngineName(
  value: unknown,
): value is Cs486ComputeEngineName {
  return (
    typeof value === "string" &&
    (cs486ComputeEngineNames as readonly string[]).includes(value)
  );
}

/**
 * Structural subset of `CpuProcess` the compute worker actually uses.
 * `Cs486Process` conforms without an adapter, so the TypeScript engine keeps
 * running the exact production object the worker ran before.
 */
export interface Cs486ComputeProcess {
  readonly hasPendingCpuCycles: boolean;
  readonly memoryLimitBytes: number;
  readonly memoryUsageBytes: number;
  readonly microarchitectureStats: CpuMicroarchitectureStats;
  readonly microarchitectureStatsEnabled: boolean;
  readonly output: string;
  readonly state: CpuProcessState;
  advanceTick(tick: number): CpuProcessState;
  fail(error: VmRuntimeError): CpuProcessState;
  runCpuSlice(
    cpuCycleBudget: number,
    instructionBudget: number,
  ): CpuProcessSliceResult;
  terminate(reason: string): CpuProcessState;
}

export interface Cs486ComputeProcessOptions {
  readonly collectMicroarchitectureStats: boolean;
  readonly cpuModel: CpuModel;
  /**
   * Heap placement of an admitted batch process. Present exactly when the host
   * decided this process runs with no OS services attached, which is the only
   * case where a worker may service a CS ABI syscall at all.
   */
  readonly csAbi?: CsAbiBatchHeapLayout;
  readonly memoryBytes: number;
  readonly processImage?: Cs486ProcessImageInitialization;
}

export interface Cs486ComputeCpuEngine {
  readonly name: Cs486ComputeEngineName;
  createProcess(
    executable: Cs486Executable,
    options: Cs486ComputeProcessOptions,
  ): Cs486ComputeProcess;
}

/**
 * Terminal syscall policy of the compute worker.
 *
 * The worker has no guest filesystem, terminal, or scheduler to service a
 * syscall against, so an ordinary process refuses every syscall rather than
 * approximating it. Only an admitted batch process replaces this policy, and
 * only with the isolated CS ABI subset whose whole effect stays inside the
 * process.
 */
export function rejectCs486ComputeSyscall(name: string): never {
  throw new Cs486Fault(
    "UnsupportedOperationError",
    `CS486 compute worker rejects syscall ${name}`,
  );
}

/**
 * Syscall policy of one process.
 *
 * A process without `csAbi` keeps the terminal rejection above. A batch process
 * gets the isolated CS ABI handler from `csAbi.ts`, so the operations a batch
 * process may reach have exactly one implementation, whether it runs in a
 * worker or locally.
 *
 * The output sink is late-bound by `csAbi.ts` because the handler must exist
 * before the process or session that owns the output buffer does.
 */
function createComputeSyscallHandler(options: Cs486ComputeProcessOptions): {
  readonly attach: (sink: (text: string) => void) => void;
  readonly handler: Cs486SyscallHandler;
} {
  if (options.csAbi === undefined)
    return { attach: () => {}, handler: rejectCs486ComputeSyscall };
  return createAttachableCsAbiBatchSyscallHandler(options.csAbi);
}

export function createCs486TypeScriptComputeEngine(): Cs486ComputeCpuEngine {
  return {
    createProcess(executable, options) {
      const syscalls = createComputeSyscallHandler(options);
      // Cs486Process construction performs the authoritative executable
      // validation.
      const process = new Cs486Process(executable, {
        collectMicroarchitectureStats: options.collectMicroarchitectureStats,
        cpuModel: options.cpuModel,
        memoryBytes: options.memoryBytes,
        syscallHandler: syscalls.handler,
      });
      syscalls.attach((text) => {
        process.appendOutput(text);
      });
      if (options.processImage !== undefined)
        process.initializeProcessImage(options.processImage);
      return process;
    },
    name: "typescript",
  };
}
