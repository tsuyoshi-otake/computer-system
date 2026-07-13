import { system, TimeOfDay, world } from "@minecraft/server";

const reconciliationIntervalTicks = 200;
const dayTime = 1_000;
let failureReported = false;

export interface AlwaysDayState {
  readonly daylightCycleEnabled: boolean;
  readonly passed: boolean;
  readonly timeOfDay: number;
}

/** Keeps the managed Computer System world at the start of daytime. */
export function startAlwaysDayController(): void {
  reconcileDaylight();
  system.runInterval(reconcileDaylight, reconciliationIntervalTicks);
}

export function inspectAlwaysDayState(): AlwaysDayState {
  const daylightCycleEnabled = world.gameRules.doDayLightCycle;
  const timeOfDay = world.getTimeOfDay();
  return {
    daylightCycleEnabled,
    passed: !daylightCycleEnabled && timeOfDay === dayTime,
    timeOfDay,
  };
}

function reconcileDaylight(): void {
  try {
    if (world.gameRules.doDayLightCycle) {
      world.gameRules.doDayLightCycle = false;
    }
    if (world.getTimeOfDay() !== dayTime) {
      world.setTimeOfDay(TimeOfDay.Day);
    }
    failureReported = false;
  } catch (error: unknown) {
    // Avoid a log storm if Bedrock temporarily rejects world writes during
    // startup or shutdown. The bounded interval remains the retry owner.
    if (!failureReported) {
      console.warn(
        `[Computer System] Always-day reconciliation failed: ${errorMessage(error)}`,
      );
      failureReported = true;
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
