import type { ShellCommandResult } from "./shellTypes.js";

export type ShellTerminalState =
  | { readonly kind: "completed" }
  | { readonly kind: "foreground" }
  | { readonly kind: "interactive" }
  | { readonly kind: "lifecycle"; readonly action: string }
  | { readonly kind: "reset-terminal" }
  | { readonly kind: "sleeping"; readonly ticks: number };

export function shellTerminalStateOf(
  result: ShellCommandResult,
): ShellTerminalState {
  const states: ShellTerminalState[] = [];
  if (result.action !== undefined)
    states.push({ action: result.action, kind: "lifecycle" });
  if (result.foreground !== undefined) states.push({ kind: "foreground" });
  if (result.sleepTicks !== undefined)
    states.push({ kind: "sleeping", ticks: result.sleepTicks });
  if (result.terminalScreen !== undefined) states.push({ kind: "interactive" });
  if (result.resetTerminal === true) states.push({ kind: "reset-terminal" });
  if (states.length > 1) {
    throw new Error(
      `shell result has competing terminal states: ${states.map(({ kind }) => kind).join(", ")}`,
    );
  }
  return states[0] ?? { kind: "completed" };
}
