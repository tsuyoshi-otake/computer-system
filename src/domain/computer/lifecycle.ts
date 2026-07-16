export type ComputerLifecycleState =
  | { readonly kind: "off" }
  | { readonly kind: "booting" }
  | { readonly kind: "running" }
  | { readonly kind: "sleeping"; readonly wakeTick: number }
  | { readonly kind: "waiting_event"; readonly filter?: string }
  | { readonly kind: "stopping"; readonly reason: string }
  | { readonly kind: "rebooting" }
  | { readonly kind: "crashed"; readonly message: string }
  | { readonly kind: "orphaned" };

export type LifecycleEvent =
  | { readonly kind: "power_on" }
  | { readonly kind: "boot_complete" }
  | { readonly kind: "vm_ready" }
  | { readonly kind: "vm_sleep"; readonly wakeTick: number }
  | { readonly kind: "vm_wait_event"; readonly filter?: string }
  | { readonly kind: "shutdown"; readonly reason?: string }
  | { readonly kind: "stopped" }
  | { readonly kind: "reboot" }
  | { readonly kind: "reboot_ready" }
  | { readonly kind: "crash"; readonly message: string }
  | { readonly kind: "block_missing" }
  | { readonly kind: "block_restored" }
  | { readonly kind: "reset" };

export type LifecycleTransition =
  | {
      readonly outcome: "changed";
      readonly previous: ComputerLifecycleState;
      readonly current: ComputerLifecycleState;
      readonly owner: LifecycleOwner;
    }
  | {
      readonly outcome: "ignored";
      readonly state: ComputerLifecycleState;
      readonly reason: "already_terminal" | "duplicate_event";
    }
  | {
      readonly outcome: "rejected";
      readonly state: ComputerLifecycleState;
      readonly event: LifecycleEvent["kind"];
    };

export type LifecycleOwner = "adapter" | "scheduler" | "storage" | "none";

export class ComputerLifecycle {
  private stateValue: ComputerLifecycleState;

  constructor(initial: ComputerLifecycleState = { kind: "off" }) {
    this.stateValue = initial;
  }

  get state(): ComputerLifecycleState {
    return this.stateValue;
  }

  transition(event: LifecycleEvent): LifecycleTransition {
    const previous = this.stateValue;
    const next = nextState(previous, event);
    if (next === "duplicate") {
      return { outcome: "ignored", state: previous, reason: "duplicate_event" };
    }
    if (next === "terminal") {
      return {
        outcome: "ignored",
        state: previous,
        reason: "already_terminal",
      };
    }
    if (next === undefined) {
      return { outcome: "rejected", state: previous, event: event.kind };
    }
    this.stateValue = next;
    return {
      outcome: "changed",
      previous,
      current: next,
      owner: ownerFor(next),
    };
  }
}

function nextState(
  state: ComputerLifecycleState,
  event: LifecycleEvent,
): ComputerLifecycleState | "duplicate" | "terminal" | undefined {
  if (event.kind === "block_missing") {
    return state.kind === "orphaned" ? "duplicate" : { kind: "orphaned" };
  }
  if (state.kind === "orphaned") {
    return event.kind === "block_restored" ? { kind: "off" } : "terminal";
  }
  if (event.kind === "crash") {
    return state.kind === "crashed"
      ? "terminal"
      : { kind: "crashed", message: event.message };
  }
  if (state.kind === "crashed") {
    return event.kind === "reset" ? { kind: "off" } : "terminal";
  }
  if (state.kind === "off") {
    return event.kind === "power_on"
      ? { kind: "booting" }
      : event.kind === "stopped"
        ? "duplicate"
        : undefined;
  }
  if (state.kind === "booting") {
    if (event.kind === "boot_complete") return { kind: "running" };
    if (event.kind === "shutdown")
      return { kind: "stopping", reason: event.reason ?? "shutdown" };
    return undefined;
  }
  if (state.kind === "stopping") {
    return event.kind === "stopped"
      ? { kind: "off" }
      : event.kind === "shutdown"
        ? "duplicate"
        : undefined;
  }
  if (state.kind === "rebooting") {
    return event.kind === "reboot_ready"
      ? { kind: "booting" }
      : event.kind === "reboot"
        ? "duplicate"
        : undefined;
  }
  if (event.kind === "reboot") return { kind: "rebooting" };
  if (event.kind === "shutdown")
    return { kind: "stopping", reason: event.reason ?? "shutdown" };
  if (event.kind === "vm_ready")
    return state.kind === "running" ? "duplicate" : { kind: "running" };
  if (event.kind === "vm_sleep")
    return { kind: "sleeping", wakeTick: event.wakeTick };
  if (event.kind === "vm_wait_event")
    return { kind: "waiting_event", filter: event.filter };
  return undefined;
}

function ownerFor(state: ComputerLifecycleState): LifecycleOwner {
  if (
    state.kind === "booting" ||
    state.kind === "stopping" ||
    state.kind === "rebooting"
  ) {
    return "adapter";
  }
  if (
    state.kind === "running" ||
    state.kind === "sleeping" ||
    state.kind === "waiting_event"
  ) {
    return "scheduler";
  }
  if (state.kind === "orphaned") return "storage";
  return "none";
}
