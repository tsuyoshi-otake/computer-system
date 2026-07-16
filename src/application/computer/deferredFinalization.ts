export type DeferredFinalizationPhase = "prepare" | "schedule" | "finalize";

export type DeferredFinalizationResult =
  | { readonly outcome: "scheduled" }
  | { readonly outcome: "schedule_failed"; readonly error: unknown };

export interface DeferredFinalizationOptions {
  readonly prepare: readonly (() => void)[];
  readonly schedule: (callback: () => void) => void;
  readonly finalize: readonly (() => void)[];
  readonly onFailure: (
    phase: DeferredFinalizationPhase,
    error: unknown,
  ) => void;
}

export function scheduleOwnedFinalization(
  active: Set<string>,
  key: string,
  options: DeferredFinalizationOptions,
): DeferredFinalizationResult {
  if (key.length === 0) throw new Error("Deferred finalization key is empty");
  active.add(key);
  runSteps(options.prepare, "prepare", options.onFailure);

  try {
    options.schedule((): void => {
      try {
        runSteps(options.finalize, "finalize", options.onFailure);
      } finally {
        active.delete(key);
      }
    });
    return { outcome: "scheduled" };
  } catch (error: unknown) {
    active.delete(key);
    reportFailure(options.onFailure, "schedule", error);
    return { outcome: "schedule_failed", error };
  }
}

function runSteps(
  steps: readonly (() => void)[],
  phase: DeferredFinalizationPhase,
  onFailure: DeferredFinalizationOptions["onFailure"],
): void {
  for (const step of steps) {
    try {
      step();
    } catch (error: unknown) {
      reportFailure(onFailure, phase, error);
    }
  }
}

function reportFailure(
  onFailure: DeferredFinalizationOptions["onFailure"],
  phase: DeferredFinalizationPhase,
  error: unknown,
): void {
  try {
    onFailure(phase, error);
  } catch {
    // Failure reporting must never steal finalization ownership.
  }
}
