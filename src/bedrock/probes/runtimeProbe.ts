import { type Player, system } from "@minecraft/server";

import { ProbeScheduler } from "../../phase0/schedulerProbe.js";

const activeRuns = new Map<string, number>();

export interface RuntimeProbeResult {
  readonly passed: boolean;
  readonly computers: number;
  readonly ticks: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly error?: string;
}

export function scheduleRuntimeProbe(
  onComplete: (result: RuntimeProbeResult) => void,
): number {
  const scheduler = new ProbeScheduler(
    Array.from({ length: 20 }, (_, id) => ({ id, instructions: null })),
    {
      globalInstructionsPerTick: 1_000,
      instructionsPerSlice: 200,
    },
  );
  let ticks = 0;
  let completed = false;

  const complete = (result: RuntimeProbeResult): void => {
    if (completed) {
      return;
    }
    completed = true;
    system.clearRun(runId);
    try {
      onComplete(result);
    } catch (error: unknown) {
      console.error(
        `Runtime probe completion callback failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const runId = system.runInterval((): void => {
    try {
      scheduler.runTick();
      ticks += 1;
      if (ticks < 40) {
        return;
      }

      const executionCounts = scheduler
        .snapshot()
        .map((computer) => computer.executedInstructions);
      const minimum = Math.min(...executionCounts);
      const maximum = Math.max(...executionCounts);
      complete({
        passed: minimum === 2_000 && maximum === 2_000,
        computers: 20,
        ticks,
        minimum,
        maximum,
      });
    } catch (error: unknown) {
      complete({
        passed: false,
        computers: 20,
        ticks,
        minimum: 0,
        maximum: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 1);

  return runId;
}

export function startRuntimeProbe(player: Player): void {
  const previousRun = activeRuns.get(player.id);
  if (previousRun !== undefined) {
    system.clearRun(previousRun);
    activeRuns.delete(player.id);
  }

  const runId = scheduleRuntimeProbe((result): void => {
    activeRuns.delete(player.id);
    player.sendMessage(
      `Runtime probe ${result.passed ? "PASS" : "FAIL"}: ${result.computers} computers, ${result.ticks} ticks, min=${result.minimum}, max=${result.maximum}${result.error === undefined ? "." : `, error=${result.error}.`}`,
    );
  });

  activeRuns.set(player.id, runId);
  player.sendMessage("Runtime probe started for 20 simulated computers.");
}
