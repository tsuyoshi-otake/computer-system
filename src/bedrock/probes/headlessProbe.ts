import { world } from "@minecraft/server";

import { formatProbeRecord } from "../../phase0/probeProtocol.js";
import {
  scheduleRuntimeProbe,
  type RuntimeProbeResult,
} from "./runtimeProbe.js";
import { executeStorageProbe } from "./storageProbe.js";

let activeRunId: string | undefined;

export function startHeadlessProbeSuite(): void {
  if (activeRunId !== undefined) {
    emit(activeRunId, "suite", "BUSY", { phase: "runtime" });
    return;
  }

  const runId = `headless-${world.getAbsoluteTime()}`;
  activeRunId = runId;

  try {
    emit(runId, "suite", "PASS", { phase: "started" });
    const storage = executeStorageProbe("dedicated-server");
    emit(runId, "storage", storage.passed ? "PASS" : "FAIL", {
      previousSequence: storage.previousSequence,
      sequence: storage.sequence,
      totalDynamicPropertyBytes: storage.totalDynamicPropertyBytes,
    });

    scheduleRuntimeProbe((runtime): void => {
      finishRuntime(runId, runtime);
    });
  } catch (error: unknown) {
    activeRunId = undefined;
    emit(runId, "suite", "FAIL", {
      phase: "exception",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function finishRuntime(runId: string, runtime: RuntimeProbeResult): void {
  activeRunId = undefined;
  emit(runId, "runtime", runtime.passed ? "PASS" : "FAIL", {
    computers: runtime.computers,
    ticks: runtime.ticks,
    minimum: runtime.minimum,
    maximum: runtime.maximum,
    ...(runtime.error === undefined ? {} : { error: runtime.error }),
  });
  emit(runId, "suite", runtime.passed ? "PASS" : "FAIL", {
    phase: "complete",
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
