import { world } from "@minecraft/server";

import { formatProbeRecord } from "../../phase0/probeProtocol.js";
import { executeItemIdentityProbe } from "./itemIdentityProbe.js";
import { executeComputerVerticalProbe } from "./computerVerticalProbe.js";
import { executeMonitorProbe } from "./monitorProbe.js";
import { executeRedstoneProbe } from "./redstoneProbe.js";
import {
  scheduleRuntimeProbe,
  type RuntimeProbeResult,
} from "./runtimeProbe.js";
import { executeStorageProbe } from "./storageProbe.js";
import { executeSpeakerProbe } from "./speakerProbe.js";
import { executeTurtleProbe } from "./turtleProbe.js";
import {
  getProbeDimension,
  prepareProbeArena,
  releaseProbeArena,
} from "./worldProbeSupport.js";

let activeRunId: string | undefined;

export function startHeadlessProbeSuite(): void {
  if (activeRunId !== undefined) {
    emit(activeRunId, "suite", "BUSY", { phase: "runtime" });
    return;
  }

  const runId = `headless-${world.getAbsoluteTime()}`;
  activeRunId = runId;
  void executeSuite(runId);
}

async function executeSuite(runId: string): Promise<void> {
  let failures = 0;
  emit(runId, "suite", "PASS", { phase: "started" });

  try {
    try {
      const storage = executeStorageProbe("dedicated-server");
      emit(runId, "storage", storage.passed ? "PASS" : "FAIL", {
        previousSequence: storage.previousSequence,
        sequence: storage.sequence,
        totalDynamicPropertyBytes: storage.totalDynamicPropertyBytes,
      });
      if (!storage.passed) {
        failures += 1;
      }
    } catch (error: unknown) {
      failures += 1;
      emitFailure(runId, "storage", error);
    }

    try {
      const computer = executeComputerVerticalProbe();
      emit(runId, "computer_vertical", "PASS", { ...computer });
    } catch (error: unknown) {
      failures += 1;
      emitFailure(runId, "computer_vertical", error);
    }

    const dimension = getProbeDimension();
    let arenaReady = false;
    try {
      await prepareProbeArena(dimension);
      arenaReady = true;
    } catch (error: unknown) {
      failures += 5;
      for (const probe of [
        "turtle",
        "item_identity",
        "monitor",
        "speaker",
        "redstone",
      ]) {
        emitFailure(runId, probe, error, "arena_setup");
      }
    }

    if (arenaReady) {
      try {
        const turtle = executeTurtleProbe(dimension);
        emit(runId, "turtle", "PASS", { ...turtle });
      } catch (error: unknown) {
        failures += 1;
        emitFailure(runId, "turtle", error);
      }

      try {
        const identity = executeItemIdentityProbe(dimension);
        emit(runId, "item_identity", "PASS", { ...identity });
      } catch (error: unknown) {
        failures += 1;
        emitFailure(runId, "item_identity", error);
      }

      try {
        const monitor = executeMonitorProbe(dimension);
        emit(runId, "monitor", "PASS", { ...monitor });
      } catch (error: unknown) {
        failures += 1;
        emitFailure(runId, "monitor", error);
      }

      try {
        const speaker = executeSpeakerProbe(dimension);
        emit(runId, "speaker", "PASS", { ...speaker });
      } catch (error: unknown) {
        failures += 1;
        emitFailure(runId, "speaker", error);
      }

      try {
        const redstone = await executeRedstoneProbe(dimension);
        emit(runId, "redstone", "PASS", { ...redstone });
      } catch (error: unknown) {
        failures += 1;
        emitFailure(runId, "redstone", error);
      }
    }
    releaseProbeArena(dimension);

    const runtime = await runRuntimeProbe();
    emit(runId, "runtime", runtime.passed ? "PASS" : "FAIL", {
      computers: runtime.computers,
      ticks: runtime.ticks,
      minimum: runtime.minimum,
      maximum: runtime.maximum,
      averageTickDurationMs: runtime.averageTickDurationMs,
      maximumTickDurationMs: runtime.maximumTickDurationMs,
      tickBudgetMs: runtime.tickBudgetMs,
      withinTickBudget: runtime.withinTickBudget,
      ...(runtime.error === undefined ? {} : { error: runtime.error }),
    });
    if (!runtime.passed) {
      failures += 1;
    }

    emit(runId, "suite", failures === 0 ? "PASS" : "FAIL", {
      failures,
      phase: "complete",
    });
  } catch (error: unknown) {
    emitFailure(runId, "suite", error, "exception");
  } finally {
    activeRunId = undefined;
  }
}

function runRuntimeProbe(): Promise<RuntimeProbeResult> {
  return new Promise((resolve): void => {
    scheduleRuntimeProbe(resolve);
  });
}

function emitFailure(
  runId: string,
  probe: string,
  error: unknown,
  phase = "execution",
): void {
  emit(runId, probe, "FAIL", {
    error: error instanceof Error ? error.message : String(error),
    phase,
  });
}

function emit(
  runId: string,
  probe: string,
  status: "BUSY" | "FAIL" | "PASS",
  details: Readonly<Record<string, boolean | number | string>>,
): void {
  console.warn(formatProbeRecord({ runId, probe, status, details }));
}
