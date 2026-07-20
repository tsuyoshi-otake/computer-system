import { ComputerRecord } from "../../domain/computer/computer.js";
import {
  GUEST_MAKE_STATE_MARKER,
  GUEST_MAKE_TOOLCHAIN_ID,
} from "../toolchain/guestMake.js";
import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
  type RuntimeCommandResult,
} from "./computerRuntime.js";

const probeComputerId = "c-900118";
const maximumProbeTicks = 256;

export interface LinuxMakeProbeResult {
  readonly built: true;
  readonly failureStopped: true;
  readonly finalized: true;
  readonly missingStateRecovered: true;
  readonly noOp: true;
  readonly rebuilt: true;
  readonly stateV2: true;
  readonly ticks: number;
}

/**
 * Exercises CS Make through the production synchronous MCP command path. The
 * probe owns an isolated Computer aggregate and always drives it to an explicit
 * off state before publishing a result.
 */
export function runLinuxMakeProbe(): LinuxMakeProbeResult {
  const record = new ComputerRecord(probeComputerId, "standard");
  const runtime = new ComputerRuntime();
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: (): number => 0,
    stopDevices: (): void => undefined,
    syncPersistence: () => ({ outcome: "unchanged" as const }),
  });
  let ticks = 0;
  let result: Omit<LinuxMakeProbeResult, "finalized" | "ticks"> | undefined;
  let probeError: Error | undefined;

  try {
    requireAccepted(runtime.register(record), "register");
    requireAccepted(runtime.powerOn(record.computerId), "power on");
    ticks += completeBoot(runtime, record);

    record.filesystem.makeDirectory("/work");
    record.filesystem.writeFile(
      "/work/Makefile",
      [
        "app: main.o",
        "\tld main.o -o app",
        "main.o: main.c",
        "\tcc -c main.c -o main.o",
      ].join("\n"),
    );
    record.filesystem.writeFile("/work/main.c", "int main() { return 0; }\n");

    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "make -C /work"),
      0,
      "initial build",
    );
    const firstExecutable = record.filesystem.readFile("/work/app");
    if (
      !record.filesystem.exists("/work/main.o") ||
      !record.filesystem.exists("/work/.cs-make-state")
    ) {
      throw new Error("CS Make probe did not install its build outputs");
    }
    const initialState = record.filesystem.readFile("/work/.cs-make-state");
    if (
      !initialState.startsWith(GUEST_MAKE_STATE_MARKER) ||
      !initialState.includes(GUEST_MAKE_TOOLCHAIN_ID)
    ) {
      throw new Error("CS Make probe did not persist CSMAKE2 toolchain state");
    }

    const noOp = requireExit(
      runtime.executeDebugShellCommand(record.computerId, "make -C /work"),
      0,
      "no-op build",
    );
    if (noOp.stdout !== "make: 'app' is up to date.\n") {
      throw new Error("CS Make probe did not report an unchanged target");
    }

    record.filesystem.writeFile("/work/main.c", "int main() { return 1; }\n");
    record.filesystem.setModifiedTime("/work/main.c", 1);
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "make -C /work"),
      0,
      "content-fingerprint rebuild",
    );
    if (record.filesystem.readFile("/work/app") === firstExecutable) {
      throw new Error("CS Make probe did not rebuild changed source content");
    }

    record.filesystem.delete("/work/.cs-make-state");
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "make -C /work"),
      0,
      "missing-state recovery",
    );
    if (!record.filesystem.exists("/work/.cs-make-state")) {
      throw new Error("CS Make probe did not recover missing state");
    }

    record.filesystem.writeFile(
      "/work/Badfile",
      "bad:\n\tsh unsupported\n\ttouch should-not-run",
    );
    requireExit(
      runtime.executeDebugShellCommand(
        record.computerId,
        "make -C /work -f Badfile",
      ),
      126,
      "rejected recipe",
    );
    if (record.filesystem.exists("/work/should-not-run")) {
      throw new Error("CS Make probe continued after a rejected recipe");
    }

    result = {
      built: true,
      failureStopped: true,
      missingStateRecovered: true,
      noOp: true,
      rebuilt: true,
      stateV2: true,
    };
  } catch (error: unknown) {
    probeError = error instanceof Error ? error : new Error(String(error));
  }

  const finalizationError = finalizeRuntime(runtime, record);
  ticks += finalizationError.ticks;
  if (probeError !== undefined) throw probeError;
  if (finalizationError.error !== undefined) throw finalizationError.error;
  if (result === undefined) throw new Error("CS Make probe produced no result");

  return {
    ...result,
    finalized: true,
    ticks,
  };
}

function requireAccepted(
  result: RuntimeCommandResult,
  operation: string,
): void {
  if (result.outcome !== "accepted") {
    throw new Error(`CS Make probe could not ${operation}`);
  }
}

function requireExit(
  result: DebugShellCommandCompletion,
  expectedExitCode: number,
  phase: string,
): Extract<DebugShellCommandCompletion, { readonly outcome: "completed" }> {
  if (result.outcome !== "completed" || result.exitCode !== expectedExitCode) {
    throw new Error(`CS Make probe failed during ${phase}`);
  }
  return result;
}

function completeBoot(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): number {
  for (let tick = 0; tick < maximumProbeTicks; tick += 1) {
    if (
      record.lifecycle.state.kind !== "booting" &&
      record.display.state.kind !== "post"
    ) {
      return tick;
    }
    runtime.runTick();
  }
  throw new Error("CS Make probe did not complete CSBIOS");
}

function finalizeRuntime(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): { readonly error?: Error; readonly ticks: number } {
  const shutdown = runtime.shutdown(record.computerId, "make probe complete");
  if (shutdown.outcome === "failed") {
    return { error: shutdown.error, ticks: 0 };
  }
  if (shutdown.outcome === "missing") {
    return {
      error: new Error(
        "CS Make probe Computer disappeared before finalization",
      ),
      ticks: 0,
    };
  }
  for (let tick = 0; tick < maximumProbeTicks; tick += 1) {
    if (record.lifecycle.state.kind === "off") return { ticks: tick };
    runtime.runTick();
  }
  return {
    error: new Error("CS Make probe did not reach the off state"),
    ticks: maximumProbeTicks,
  };
}
