export interface ProbeComputerSnapshot {
  readonly executedInstructions: number;
  readonly id: number;
  readonly remainingInstructions: number | null;
  readonly status: "runnable" | "terminated";
}

interface ProbeComputerState {
  executedInstructions: number;
  readonly id: number;
  remainingInstructions: number | null;
  status: "runnable" | "terminated";
}

export interface ProbeSchedulerLimits {
  readonly globalInstructionsPerTick: number;
  readonly instructionsPerSlice: number;
}

export class ProbeScheduler {
  readonly #computers: ProbeComputerState[];
  readonly #limits: ProbeSchedulerLimits;
  #cursor = 0;

  public constructor(
    computers: ReadonlyArray<{
      readonly id: number;
      readonly instructions: number | null;
    }>,
    limits: ProbeSchedulerLimits,
  ) {
    if (
      limits.globalInstructionsPerTick <= 0 ||
      limits.instructionsPerSlice <= 0
    ) {
      throw new RangeError("Scheduler instruction limits must be positive.");
    }

    const ids = new Set(computers.map((computer) => computer.id));
    if (ids.size !== computers.length) {
      throw new Error("Probe computer IDs must be unique.");
    }

    this.#computers = computers.map((computer) => {
      if (computer.instructions !== null && computer.instructions < 0) {
        throw new RangeError("Instruction counts cannot be negative.");
      }

      return {
        executedInstructions: 0,
        id: computer.id,
        remainingInstructions: computer.instructions,
        status: computer.instructions === 0 ? "terminated" : "runnable",
      };
    });
    this.#limits = limits;
  }

  public runTick(): number {
    if (this.#computers.length === 0) {
      return 0;
    }

    let available = this.#limits.globalInstructionsPerTick;
    let executed = 0;
    let visited = 0;
    let index = this.#cursor;

    while (available > 0 && visited < this.#computers.length) {
      const computer = this.#computers[index];
      if (computer === undefined) {
        throw new Error("Scheduler cursor moved outside the computer list.");
      }

      if (computer.status === "runnable") {
        const remaining = computer.remainingInstructions;
        const slice = Math.min(
          available,
          this.#limits.instructionsPerSlice,
          remaining ?? this.#limits.instructionsPerSlice,
        );

        computer.executedInstructions += slice;
        executed += slice;
        available -= slice;

        if (remaining !== null) {
          computer.remainingInstructions = remaining - slice;
          if (computer.remainingInstructions === 0) {
            computer.status = "terminated";
          }
        }
      }

      index = (index + 1) % this.#computers.length;
      visited += 1;
    }

    this.#cursor = index;
    return executed;
  }

  public snapshot(): ProbeComputerSnapshot[] {
    return this.#computers.map((computer) => ({ ...computer }));
  }
}
