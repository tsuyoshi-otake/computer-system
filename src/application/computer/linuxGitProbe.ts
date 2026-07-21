import { ComputerRecord } from "../../domain/computer/computer.js";
import {
  ComputerRuntime,
  type DebugShellCommandCompletion,
  type RuntimeCommandResult,
} from "./computerRuntime.js";

const probeComputerId = "c-900160";
const maximumProbeTicks = 256;

export interface LinuxGitProbeResult {
  readonly committed: true;
  readonly finalized: true;
  readonly ignored: true;
  readonly initialized: true;
  readonly merged: true;
  readonly remoteUnavailable: true;
  readonly switched: true;
  readonly ticks: number;
}

/** Runs the local VCS workflow through the production Computer/MCP shell path. */
export function runLinuxGitProbe(): LinuxGitProbeResult {
  const record = new ComputerRecord(probeComputerId, "standard");
  const runtime = new ComputerRuntime();
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: (): number => 0,
    stopDevices: (): void => undefined,
    syncPersistence: () => ({ outcome: "unchanged" as const }),
  });
  let ticks = 0;
  let probeError: Error | undefined;
  let completed = false;

  try {
    requireAccepted(runtime.register(record), "register");
    requireAccepted(runtime.powerOn(record.computerId), "power on");
    ticks += completeBoot(runtime, record);

    record.filesystem.makeDirectory("/work/git-probe");
    record.filesystem.writeFile("/work/git-probe/.gitignore", "*.tmp\n");
    record.filesystem.writeFile("/work/git-probe/base.txt", "base\n");
    record.filesystem.writeFile("/work/git-probe/ignored.tmp", "ignore me\n");
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "cd /work/git-probe"),
      0,
      "enter repository",
    );
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git init"),
      0,
      "initialize",
    );
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git add ."),
      0,
      "stage base",
    );
    requireExit(
      runtime.executeDebugShellCommand(
        record.computerId,
        "git commit -m 'probe base'",
      ),
      0,
      "commit base",
    );
    const clean = requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git status --short"),
      0,
      "check ignore",
    );
    if (clean.stdout !== "") {
      throw new Error(
        `CS System Git probe worktree was not clean: ${clean.stdout}`,
      );
    }
    if (
      !record.filesystem.exists("/work/git-probe/.git/CS_SYSTEM_VCS") ||
      record.filesystem
        .readFile("/work/git-probe/.git/index")
        .includes("ignored.tmp")
    ) {
      throw new Error(
        "CS System Git probe did not preserve marker/ignore rules",
      );
    }

    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git branch feature"),
      0,
      "create branch",
    );
    record.filesystem.writeFile("/work/git-probe/main.txt", "main\n");
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git add main.txt"),
      0,
      "stage main",
    );
    requireExit(
      runtime.executeDebugShellCommand(
        record.computerId,
        "git commit -m 'probe main'",
      ),
      0,
      "commit main",
    );
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git switch feature"),
      0,
      "switch feature",
    );
    record.filesystem.writeFile("/work/git-probe/feature.txt", "feature\n");
    requireExit(
      runtime.executeDebugShellCommand(
        record.computerId,
        "git add feature.txt",
      ),
      0,
      "stage feature",
    );
    requireExit(
      runtime.executeDebugShellCommand(
        record.computerId,
        "git commit -m 'probe feature'",
      ),
      0,
      "commit feature",
    );
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git switch main"),
      0,
      "switch main",
    );
    requireExit(
      runtime.executeDebugShellCommand(record.computerId, "git merge feature"),
      0,
      "merge feature",
    );
    if (
      record.filesystem.readFile("/work/git-probe/main.txt") !== "main\n" ||
      record.filesystem.readFile("/work/git-probe/feature.txt") !== "feature\n"
    ) {
      throw new Error(
        "CS System Git probe merge did not materialize both sides",
      );
    }

    requireExit(
      runtime.executeDebugShellCommand(
        record.computerId,
        "git remote add origin cs+tcp://probe.invalid/team/repo",
      ),
      0,
      "store remote",
    );
    const push = requireExit(
      runtime.executeDebugShellCommand(
        record.computerId,
        "git push origin main",
      ),
      1,
      "reject unavailable push",
    );
    if (
      !push.stderr.includes(
        "authenticated guest TCP/IP transport is not available",
      )
    ) {
      throw new Error(
        "CS System Git probe did not fail remote transport explicitly",
      );
    }
    completed = true;
  } catch (error: unknown) {
    probeError = error instanceof Error ? error : new Error(String(error));
  }

  const finalization = finalizeRuntime(runtime, record);
  ticks += finalization.ticks;
  if (probeError !== undefined) throw probeError;
  if (finalization.error !== undefined) throw finalization.error;
  if (!completed) throw new Error("CS System Git probe produced no result");
  return {
    committed: true,
    finalized: true,
    ignored: true,
    initialized: true,
    merged: true,
    remoteUnavailable: true,
    switched: true,
    ticks,
  };
}

function requireAccepted(
  result: RuntimeCommandResult,
  operation: string,
): void {
  if (result.outcome !== "accepted") {
    throw new Error(`CS System Git probe could not ${operation}`);
  }
}

function requireExit(
  result: DebugShellCommandCompletion,
  expectedExitCode: number,
  phase: string,
): Extract<DebugShellCommandCompletion, { readonly outcome: "completed" }> {
  if (result.outcome !== "completed" || result.exitCode !== expectedExitCode) {
    const detail =
      result.outcome === "completed"
        ? `exit ${String(result.exitCode)}: ${result.stderr.trim() || result.stdout.trim() || "no diagnostic"}`
        : result.outcome === "failed"
          ? result.error.message
          : result.outcome;
    throw new Error(`CS System Git probe failed during ${phase}: ${detail}`);
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
  throw new Error("CS System Git probe did not complete CSBIOS");
}

function finalizeRuntime(
  runtime: ComputerRuntime,
  record: ComputerRecord,
): { readonly error?: Error; readonly ticks: number } {
  const shutdown = runtime.shutdown(record.computerId, "git probe complete");
  if (shutdown.outcome === "failed") return { error: shutdown.error, ticks: 0 };
  if (shutdown.outcome === "missing") {
    return {
      error: new Error(
        "CS System Git probe Computer disappeared before finalization",
      ),
      ticks: 0,
    };
  }
  for (let tick = 0; tick < maximumProbeTicks; tick += 1) {
    if (record.lifecycle.state.kind === "off") return { ticks: tick };
    runtime.runTick();
  }
  return {
    error: new Error("CS System Git probe did not reach the off state"),
    ticks: maximumProbeTicks,
  };
}
