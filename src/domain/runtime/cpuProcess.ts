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
  readonly cpuCycles: number;
  readonly executedInstructions: number;
  readonly state: CpuProcessState;
}

/** Stable scheduler boundary for Python and CS486 machine-code processes. */
export interface CpuProcess {
  readonly hasPendingCpuCycles: boolean;
  readonly memoryLimitBytes: number;
  readonly memoryUsageBytes: number;
  readonly state: CpuProcessState;

  advanceTick(tick: number): CpuProcessState;
  deliverEvent(name: string, ...arguments_: readonly RuntimeValue[]): boolean;
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
