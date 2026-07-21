import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../domain/computer/computer.js";
import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
  type RuntimeCommandResult,
} from "./computerRuntime.js";

const probeComputerId = "c-900117";
const probePassword = "issue17-auth-probe";
const maximumProbeTransitionTicks = 256;

export interface LinuxAuthenticationProbeResult {
  readonly authenticatedUser: "cs";
  readonly laterLoginRequired: true;
  readonly passwordMasked: true;
  readonly preLoginRejected: true;
  readonly setupCompleted: true;
  readonly ticks: number;
}

/**
 * Exercises the production ComputerRuntime login boundary without touching a
 * persisted Computer or Bedrock world state. The fixed probe password remains
 * private to this module and is never returned or included in an error.
 */
export function runLinuxAuthenticationProbe(): LinuxAuthenticationProbeResult {
  const record = new ComputerRecord(probeComputerId, "standard");
  const runtime = new ComputerRuntime({ requireLinuxLogin: true });
  configureProbePersistence(runtime, record);
  let ticks = 0;
  let completed = false;
  let probeError: unknown;

  try {
    requireAccepted(runtime.register(record), "register");
    requireAccepted(runtime.powerOn(record.computerId), "power on");
    ticks += runUntil(
      runtime,
      () => runtime.isShellSecretInput(record.computerId),
      "first-boot setup",
    );

    requireSecretInput(runtime, record.computerId, true, "first-boot setup");
    requireLoginRejected(
      executeQueuedDebug(runtime, record.computerId, "whoami"),
      "before first-boot setup",
    );

    submitTerminalLine(runtime, record.computerId, probePassword);
    ticks += 1;
    requireSecretInput(
      runtime,
      record.computerId,
      true,
      "password confirmation",
    );
    requirePasswordMasked(record);

    submitTerminalLine(runtime, record.computerId, probePassword);
    ticks += 1;
    requireSecretInput(runtime, record.computerId, false, "completed setup");
    requirePasswordMasked(record);
    requireAuthenticatedUser(
      executeQueuedDebug(runtime, record.computerId, "whoami"),
      "first-boot setup",
    );

    requireAccepted(runtime.reboot(record.computerId), "reboot");
    ticks += runUntil(
      runtime,
      () => {
        const state = runtime.vmState(record.computerId);
        return (
          runtime.canAdmitWork(record.computerId) &&
          state?.kind === "waiting_event" &&
          state.filter === undefined &&
          !runtime.isShellSecretInput(record.computerId)
        );
      },
      "later login prompt",
    );
    requireSecretInput(runtime, record.computerId, false, "later login name");
    requireLoginRejected(
      executeQueuedDebug(runtime, record.computerId, "whoami"),
      "before later login",
    );

    submitTerminalLine(runtime, record.computerId, "cs");
    ticks += 1;
    requireSecretInput(
      runtime,
      record.computerId,
      true,
      "later login password",
    );
    submitTerminalLine(runtime, record.computerId, probePassword);
    ticks += 1;
    requireSecretInput(
      runtime,
      record.computerId,
      false,
      "authenticated session",
    );
    requirePasswordMasked(record);
    requireAuthenticatedUser(
      executeQueuedDebug(runtime, record.computerId, "whoami"),
      "later login",
    );
    completed = true;
  } catch (error: unknown) {
    probeError = error;
  }

  const finalization = finalizeRuntime(runtime, record);
  ticks += finalization.ticks;
  if (!completed) throw probeError;
  if (finalization.error !== undefined) throw finalization.error;

  return {
    authenticatedUser: "cs",
    laterLoginRequired: true,
    passwordMasked: true,
    preLoginRejected: true,
    setupCompleted: true,
    ticks,
  };
}

function configureProbePersistence(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): void {
  let generation = 0;
  const snapshots = new Map<string, ComputerSnapshot>();
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: (): number => 0,
    stopDevices: (): void => undefined,
    syncPersistence: (computerId) => {
      if (computerId !== record.computerId) {
        return { outcome: "missing" as const, computerId };
      }
      snapshots.set(computerId, record.snapshot());
      generation += 1;
      return { outcome: "saved" as const, generation };
    },
  });
}

function submitTerminalLine(
  runtime: ComputerRuntime,
  computerId: string,
  line: string,
): void {
  requireAccepted(
    runtime.queueEvent(computerId, "terminal_line", line),
    "terminal input",
  );
  runTick(runtime);
}

function executeQueuedDebug(
  runtime: ComputerRuntime,
  computerId: string,
  command: string,
): DebugShellCommandCompletion {
  let completion: DebugShellCommandCompletion | undefined;
  runtime.enqueueDebugShellCommand(computerId, command, (result): void => {
    completion = result;
  });
  if (completion === undefined) {
    throw new Error("Authentication probe debug command did not finalize");
  }
  return completion;
}

function requireAccepted(
  result: RuntimeCommandResult,
  operation: string,
): void {
  if (result.outcome !== "accepted") {
    throw new Error(`Authentication probe could not ${operation}`);
  }
}

function requireLoginRejected(
  result: DebugShellCommandCompletion,
  phase: string,
): void {
  if (
    result.outcome !== "completed" ||
    result.exitCode !== 2 ||
    result.stdout !== "" ||
    !result.stderr.includes("login is required")
  ) {
    throw new Error(`Authentication probe accepted debug execution ${phase}`);
  }
}

function requireAuthenticatedUser(
  result: DebugShellCommandCompletion,
  phase: string,
): void {
  if (
    result.outcome !== "completed" ||
    result.exitCode !== 0 ||
    result.stderr !== "" ||
    result.stdout !== "cs\n"
  ) {
    throw new Error(
      `Authentication probe did not authenticate cs after ${phase}`,
    );
  }
}

function requireSecretInput(
  runtime: ComputerRuntime,
  computerId: string,
  expected: boolean,
  phase: string,
): void {
  if (runtime.isShellSecretInput(computerId) !== expected) {
    throw new Error(
      `Authentication probe secret-input state failed during ${phase}`,
    );
  }
}

function requirePasswordMasked(record: ComputerRecord): void {
  const screen = record.terminal.snapshot().rows.join("\n");
  if (screen.includes(probePassword)) {
    throw new Error("Authentication probe rendered secret input");
  }
}

function runTick(runtime: ComputerRuntime): void {
  runtime.runTick();
}

function runUntil(
  runtime: ComputerRuntime,
  predicate: () => boolean,
  phase: string,
): number {
  for (let ticks = 0; ticks < maximumProbeTransitionTicks; ticks += 1) {
    if (predicate()) return ticks;
    runTick(runtime);
  }
  if (predicate()) return maximumProbeTransitionTicks;
  throw new Error(`Authentication probe did not reach ${phase}`);
}

function finalizeRuntime(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): { readonly error?: Error; readonly ticks: number } {
  if (runtimeIsOff(record)) return { ticks: 0 };
  try {
    const result = runtime.terminate(record.computerId);
    if (result.outcome !== "accepted") {
      return {
        error: new Error(
          "Authentication probe runtime did not accept termination",
        ),
        ticks: 0,
      };
    }
    const ticks = runUntil(runtime, () => runtimeIsOff(record), "power off");
    return { ticks };
  } catch (error: unknown) {
    return {
      error: new Error("Authentication probe runtime finalization failed", {
        cause: error,
      }),
      ticks: 0,
    };
  }
}

function runtimeIsOff(record: ComputerRecord): boolean {
  return (
    record.lifecycle.state.kind === "off" && record.display.state.kind === "off"
  );
}
