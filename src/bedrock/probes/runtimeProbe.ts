import { type Player, system } from "@minecraft/server";

import { ProbeScheduler } from "../../phase0/schedulerProbe.js";

const activeRuns = new Map<string, number>();

export function startRuntimeProbe(player: Player): void {
  const previousRun = activeRuns.get(player.id);
  if (previousRun !== undefined) {
    system.clearRun(previousRun);
    activeRuns.delete(player.id);
  }

  const scheduler = new ProbeScheduler(
    Array.from({ length: 20 }, (_, id) => ({ id, instructions: null })),
    {
      globalInstructionsPerTick: 1_000,
      instructionsPerSlice: 200,
    },
  );
  let ticks = 0;

  const runId = system.runInterval((): void => {
    scheduler.runTick();
    ticks += 1;
    if (ticks < 40) {
      return;
    }

    system.clearRun(runId);
    activeRuns.delete(player.id);

    const executionCounts = scheduler
      .snapshot()
      .map((computer) => computer.executedInstructions);
    const minimum = Math.min(...executionCounts);
    const maximum = Math.max(...executionCounts);
    const passed = minimum === 2_000 && maximum === 2_000;
    player.sendMessage(
      `Runtime probe ${passed ? "PASS" : "FAIL"}: 20 computers, 40 ticks, min=${minimum}, max=${maximum}.`,
    );
  }, 1);

  activeRuns.set(player.id, runId);
  player.sendMessage("Runtime probe started for 20 simulated computers.");
}
