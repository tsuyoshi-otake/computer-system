import { type Player, system } from "@minecraft/server";

import { ProbeScheduler } from "../../phase0/schedulerProbe.js";

const activeRuns = new Map<string, number>();

export interface RuntimeProbeResult {
  readonly passed: boolean;
  readonly computers: number;
  readonly ticks: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly averageTickDurationMs: number;
  readonly maximumTickDurationMs: number;
  readonly tickBudgetMs: number;
  readonly withinTickBudget: boolean;
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
  let totalTickDurationMs = 0;
  let maximumTickDurationMs = 0;
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
      const startedAt = Date.now();
      scheduler.runTick();
      const tickDurationMs = Date.now() - startedAt;
      totalTickDurationMs += tickDurationMs;
      maximumTickDurationMs = Math.max(maximumTickDurationMs, tickDurationMs);
      ticks += 1;
      if (ticks < 40) {
        return;
      }

      const executionCounts = scheduler
        .snapshot()
        .map((computer) => computer.executedInstructions);
      const minimum = Math.min(...executionCounts);
      const maximum = Math.max(...executionCounts);
      const tickBudgetMs = 50;
      const withinTickBudget = maximumTickDurationMs <= tickBudgetMs;
      complete({
        passed: minimum === 2_000 && maximum === 2_000 && withinTickBudget,
        computers: 20,
        ticks,
        minimum,
        maximum,
        averageTickDurationMs: totalTickDurationMs / ticks,
        maximumTickDurationMs,
        tickBudgetMs,
        withinTickBudget,
      });
    } catch (error: unknown) {
      complete({
        passed: false,
        computers: 20,
        ticks,
        minimum: 0,
        maximum: 0,
        averageTickDurationMs: ticks === 0 ? 0 : totalTickDurationMs / ticks,
        maximumTickDurationMs,
        tickBudgetMs: 50,
        withinTickBudget: false,
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
      `Runtime probe ${result.passed ? "PASS" : "FAIL"}: ${result.computers} computers, ${result.ticks} ticks, min=${result.minimum}, max=${result.maximum}, avgTickMs=${result.averageTickDurationMs}, maxTickMs=${result.maximumTickDurationMs}, budgetMs=${result.tickBudgetMs}${result.error === undefined ? "." : `, error=${result.error}.`}`,
    );
  });

  activeRuns.set(player.id, runId);
  player.sendMessage("Runtime probe started for 20 simulated computers.");
}
