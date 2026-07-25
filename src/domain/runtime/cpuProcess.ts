import type { VmRuntimeError } from "./errors.js";
import type { RuntimeValue } from "./value.js";

/**
 * Observable states shared by every sandboxed Computer CPU process.
 *
 * A process may only execute while ready or while paying already incurred
 * cycle debt. Waiting and terminal states are explicit so callers never have
 * to infer finalization from an empty queue or a missing callback.
 */
export type CpuProcessState =
  | { readonly kind: "ready" }
  | { readonly kind: "completed"; readonly value: RuntimeValue }
  | { readonly kind: "crashed"; readonly error: VmRuntimeError }
  | { readonly kind: "sleeping"; readonly wakeTick: number }
  | { readonly kind: "terminated"; readonly reason: string }
  | { readonly kind: "waiting_event"; readonly filter?: string };

export interface CpuProcessSliceResult {
  /**
   * Host admission reserved for this dispatch. Local processes omit these
   * fields because their completed work is also their admission. An
   * asynchronous executor reports completed work in `cpuCycles` and
   * `executedInstructions`, while reserving a newly dispatched slice here.
   */
  readonly admittedCpuCycles?: number;
  readonly admittedInstructions?: number;
  readonly cpuCycles: number;
  readonly executedInstructions: number;
  readonly state: CpuProcessState;
}

export type CpuProcessExecutionLocation =
  | { readonly backend: "bedrock" }
  | {
      readonly backend: "worker";
      readonly workerCount: number;
      readonly workerIndex: number;
    };

/** Stable scheduler boundary for Python and CS486 machine-code processes. */
export interface CpuProcess {
  /**
   * Processes sharing this identifier consume one aggregate scheduler budget.
   * Omitted identifiers use the Bedrock main-thread resource.
   */
  readonly schedulerResourceId?: string;
  /** Host execution placement exposed only for truthful operator telemetry. */
  readonly executionLocation?: CpuProcessExecutionLocation;
  /**
   * True when one `runCpuSlice` call dispatches work that does not run inside
   * that call. Such a process must be offered its whole slice budget at once:
   * dividing the budget would only shrink the dispatched batch, because the
   * calling host operation was never where the work happened.
   */
  readonly dispatchesWorkAsynchronously?: boolean;
  readonly hasPendingCpuCycles: boolean;
  readonly memoryLimitBytes: number;
  readonly memoryUsageBytes: number;
  readonly state: CpuProcessState;

  advanceTick(tick: number): CpuProcessState;
  deliverEvent(name: string, ...arguments_: readonly RuntimeValue[]): boolean;
  /** Releases an optional external execution actor. Must be idempotent. */
  dispose?(): void;
  fail(error: VmRuntimeError): CpuProcessState;
  runCpuSlice(
    cpuCycleBudget: number,
    instructionBudget?: number,
  ): CpuProcessSliceResult;
  terminate(reason?: string): CpuProcessState;
}

export function isTerminalCpuProcessState(state: CpuProcessState): boolean {
  return (
    state.kind === "completed" ||
    state.kind === "crashed" ||
    state.kind === "terminated"
  );
}
