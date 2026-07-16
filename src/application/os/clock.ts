export interface GameClockSnapshot {
  readonly absoluteTicks: number;
  readonly timeOfDay: number;
}

/** Clock capabilities injected into the sandbox shell by its host adapter. */
export interface ShellClockSource {
  currentGameTime(): GameClockSnapshot;
  currentWallTimeMilliseconds(): number;
}

export function createVirtualShellClock(
  currentTick: () => number,
  ticksPerSecond: number,
): ShellClockSource {
  return {
    currentGameTime: (): GameClockSnapshot => {
      const absoluteTicks = Math.max(0, Math.floor(currentTick()));
      return {
        absoluteTicks,
        timeOfDay: absoluteTicks % 24_000,
      };
    },
    currentWallTimeMilliseconds: (): number =>
      Date.UTC(2000, 0, 1) + (currentTick() / ticksPerSecond) * 1_000,
  };
}
