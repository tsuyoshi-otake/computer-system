import {
  createAttachableCsAbiBatchSyscallHandler,
  type CsAbiBatchHeapLayout,
} from "../src/application/runtime/csAbi.js";
import {
  Cs486Fault,
  Cs486Process,
  validateCs486Executable,
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
import {
  isCs486WasmFloatSyscall,
  type Cs486WasmSyscallPolicy,
} from "./cs486-wasm-cold-op-bridge.js";
import { instantiateCs486WasmModule } from "./wasm-engines/wasm-instantiation.js";
import {
  createCs486WasmExecutableSession,
  cs486WasmStackPointer,
} from "./wasm-engines/wasm-session.js";

/**
 * CPU engine boundary of the managed compute worker.
 *
 * The worker used to construct `Cs486Process` directly. It now goes through
 * this interface so the Issue #106 Rust wasm batch executor can back the same
 * wire protocol without the worker learning which engine it runs. Engine
 * selection is opt-in operator configuration: `typescript` stays the default
 * and the wasm engine never substitutes itself silently.
 *
 * Both engines are production paths from here on. Any change to executable
 * admission, guest RAM accounting, slice budget contracts, syscall policy, or
 * terminal-state semantics must land in `src/domain/cpu/cs486.ts` **and** in
 * the wasm engine (`wasm/cs486-batch-executor-rs/` plus its host bridge), or
 * the two observable behaviours drift apart.
 */
export const cs486ComputeEngineNames = [
  "typescript",
  "wasm-rust",
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
 * Terminal syscall policy of the compute worker, shared by both engines.
 *
 * The worker has no guest filesystem, terminal, or scheduler to service a
 * syscall against, so an ordinary process refuses every syscall rather than
 * approximating it. Both engines must report the identical fault, which is why
 * this lives here instead of inside either engine. Only an admitted batch
 * process replaces this policy, and only with the isolated CS ABI subset whose
 * whole effect stays inside the process.
 */
export function rejectCs486ComputeSyscall(name: string): never {
  throw new Cs486Fault(
    "UnsupportedOperationError",
    `CS486 compute worker rejects syscall ${name}`,
  );
}

/**
 * Syscall policy of one process, shared by both engines.
 *
 * A process without `csAbi` keeps the terminal rejection above. A batch process
 * gets the single isolated CS ABI handler from `csAbi.ts`, so the operations a
 * batch process may reach have exactly one implementation no matter which
 * engine the operator selected.
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
      // validation; the wasm engine below has to call the same validator
      // explicitly because it never builds a Cs486Process.
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

/**
 * Wasm-backed engine. One compiled module is shared by the whole worker and
 * each guest process gets its own instance, so every process owns a private
 * linear memory and sessions never overwrite each other's regions.
 */
export function createCs486WasmComputeEngine(
  module: WebAssembly.Module,
  name: Cs486ComputeEngineName = "wasm-rust",
): Cs486ComputeCpuEngine {
  return {
    createProcess(executable, options) {
      validateCs486Executable(executable);
      assertCs486WasmExecutableSupported(executable, options);
      const syscalls = createComputeSyscallHandler(options);
      const { exports, memory } = instantiateCs486WasmModule(module);
      const session = createCs486WasmExecutableSession(
        exports,
        memory,
        executable,
        {
          cpuModel: options.cpuModel,
          instrumentation: options.collectMicroarchitectureStats
            ? "enabled"
            : "disabled",
          memoryBytes: options.memoryBytes,
          processImage: options.processImage,
          startOffset: memory.buffer.byteLength,
          syscallPolicy: createWasmSyscallPolicy(
            options.cpuModel,
            syscalls.handler,
          ),
        },
      );
      syscalls.attach((text) => {
        session.appendOutput(text);
      });
      return createWasmComputeProcess(session, executable);
    },
    name,
  };
}

/**
 * Create-time admission for the wasm engine.
 *
 * Deterministic floating point is BigInt-rational arithmetic owned by the
 * TypeScript model and must never be delegated to wasm, so the wasm engine
 * cannot execute the `cs.fp.*` syscall family on a model that has an FPU.
 * Refusing at create time is the only honest option: approximating at dispatch
 * would produce a wrong guest result, and reporting a coprocessor fault on
 * CS486DX/DX2 would imply hardware that the profile does have.
 *
 * The scan is O(instructions) once per process, matching the predecode pass
 * that already walks the same array.
 *
 * CS386SX needs no scan: it has no 80387, so production already faults at
 * dispatch and `createWasmSyscallPolicy` reproduces that fault verbatim. A
 * program that merely links `printf`-family float formatting without reaching
 * it stays runnable there, exactly as on the TypeScript engine.
 */
function assertCs486WasmExecutableSupported(
  executable: Cs486Executable,
  options: Cs486ComputeProcessOptions,
): void {
  if (options.cpuModel === "cs386sx") return;
  for (const instruction of executable.instructions) {
    if (instruction.op !== "syscall") continue;
    if (!isCs486WasmFloatSyscall(instruction.name)) continue;
    throw new Error(
      `CS486 wasm compute engine cannot execute deterministic float syscall ${instruction.name} on ${options.cpuModel}; run this executable on the typescript engine`,
    );
  }
}

/**
 * Host syscall policy for a wasm session. Mirrors the production dispatch
 * order: `executeFloatSyscall` runs before the handler lookup, so on CS386SX a
 * `cs.fp.*` call reports the missing coprocessor rather than the worker's
 * handler rejection. Everything past that point is the same handler object the
 * TypeScript engine installs, so a batch process cannot observe a different CS
 * ABI depending on the engine.
 */
function createWasmSyscallPolicy(
  cpuModel: CpuModel,
  handler: Cs486SyscallHandler,
): Cs486WasmSyscallPolicy {
  return (name, context) => {
    if (cpuModel === "cs386sx" && isCs486WasmFloatSyscall(name))
      throw new Cs486Fault(
        "UnsupportedError",
        `${name} requires an 80387 coprocessor unavailable on CS386SX`,
      );
    return handler(name, context);
  };
}

function createWasmComputeProcess(
  session: ReturnType<typeof createCs486WasmExecutableSession>,
  executable: Cs486Executable,
): Cs486ComputeProcess {
  const dataBytes = executable.dataBytes ?? 0;
  let tick = 0;
  return {
    advanceTick(nextTick) {
      // `Cs486Process.advanceTick` also wakes sleeping guests; a wasm session
      // can never sleep because every syscall is a cold exit, so monotonicity
      // is the whole contract here.
      if (!Number.isInteger(nextTick) || nextTick < tick)
        throw new RangeError("CPU process tick must advance monotonically");
      tick = nextTick;
      return session.state;
    },
    fail(error) {
      return session.fail(error);
    },
    get hasPendingCpuCycles() {
      return session.hasPendingCpuCycles;
    },
    get memoryLimitBytes() {
      return session.memoryBytes;
    },
    get memoryUsageBytes() {
      // Mirrors `Cs486Process.memoryUsageBytes`. The worker never injects an
      // external usage source, so that term is structurally absent rather than
      // defaulted to zero.
      const stackBytes = session.memoryBytes - cs486WasmStackPointer(session);
      return Math.max(0, dataBytes + stackBytes + 32);
    },
    get microarchitectureStats() {
      return session.microarchitectureStats;
    },
    get microarchitectureStatsEnabled() {
      return session.microarchitectureStatsEnabled;
    },
    get output() {
      return session.output;
    },
    runCpuSlice(cpuCycleBudget, instructionBudget) {
      if (!Number.isSafeInteger(cpuCycleBudget) || cpuCycleBudget <= 0)
        throw new RangeError(
          "CPU cycle budget must be a positive safe integer",
        );
      if (!Number.isSafeInteger(instructionBudget) || instructionBudget <= 0)
        throw new RangeError(
          "instruction budget must be a positive safe integer",
        );
      return session.runSlice("cpu-slice", cpuCycleBudget, instructionBudget);
    },
    get state() {
      return session.state;
    },
    terminate(reason) {
      return session.terminate(reason);
    },
  };
}
