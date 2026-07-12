export type ComputerFamily = "advanced" | "standard";
export type ComputerForm = "block" | "item";

export interface ComputerIdentityObservation {
  readonly computerId: string;
  readonly family: ComputerFamily;
  readonly form: ComputerForm;
  readonly physicalKey: string;
}

export type IdentityResult =
  | {
      readonly outcome: "claimed" | "updated" | "transferred";
      readonly observation: ComputerIdentityObservation;
    }
  | {
      readonly outcome: "duplicate";
      readonly existing: ComputerIdentityObservation;
      readonly rejected: ComputerIdentityObservation;
    }
  | { readonly outcome: "missing"; readonly computerId: string }
  | {
      readonly outcome: "removed";
      readonly observation: ComputerIdentityObservation;
    };

export class ComputerIdentityRegistry {
  private readonly observations = new Map<
    string,
    ComputerIdentityObservation
  >();

  get size(): number {
    return this.observations.size;
  }

  get(computerId: string): ComputerIdentityObservation | undefined {
    return this.observations.get(computerId);
  }

  claim(observation: ComputerIdentityObservation): IdentityResult {
    validateObservation(observation);
    const existing = this.observations.get(observation.computerId);
    if (existing === undefined) {
      this.observations.set(observation.computerId, observation);
      return { outcome: "claimed", observation };
    }
    if (
      existing.physicalKey !== observation.physicalKey ||
      existing.family !== observation.family
    ) {
      return { outcome: "duplicate", existing, rejected: observation };
    }
    this.observations.set(observation.computerId, observation);
    return { outcome: "updated", observation };
  }

  transfer(
    computerId: string,
    sourcePhysicalKey: string,
    target: Omit<ComputerIdentityObservation, "computerId">,
  ): IdentityResult {
    const existing = this.observations.get(computerId);
    if (existing === undefined) return { outcome: "missing", computerId };
    if (
      existing.physicalKey !== sourcePhysicalKey ||
      existing.family !== target.family
    ) {
      return {
        outcome: "duplicate",
        existing,
        rejected: { computerId, ...target },
      };
    }
    const observation = { computerId, ...target };
    validateObservation(observation);
    this.observations.set(computerId, observation);
    return { outcome: "transferred", observation };
  }

  remove(computerId: string): IdentityResult {
    const observation = this.observations.get(computerId);
    if (observation === undefined) return { outcome: "missing", computerId };
    this.observations.delete(computerId);
    return { outcome: "removed", observation };
  }

  restore(observations: readonly ComputerIdentityObservation[]): void {
    const next = new Map<string, ComputerIdentityObservation>();
    const physical = new Set<string>();
    for (const observation of observations) {
      validateObservation(observation);
      if (
        next.has(observation.computerId) ||
        physical.has(observation.physicalKey)
      ) {
        throw new Error(
          `Duplicate restored computer identity ${observation.computerId}`,
        );
      }
      next.set(observation.computerId, observation);
      physical.add(observation.physicalKey);
    }
    this.observations.clear();
    for (const [id, observation] of next)
      this.observations.set(id, observation);
  }

  snapshot(): readonly ComputerIdentityObservation[] {
    return [...this.observations.values()].sort((left, right) =>
      left.computerId.localeCompare(right.computerId),
    );
  }
}

export class ComputerIdSequence {
  private nextValue: number;

  constructor(nextValue = 1) {
    if (!Number.isSafeInteger(nextValue) || nextValue <= 0)
      throw new RangeError("Computer ID sequence must be positive");
    this.nextValue = nextValue;
  }

  next(): string {
    return `computer-${this.nextValue++}`;
  }

  reserve(computerId: string): void {
    if (!/^computer-[1-9][0-9]*$/u.test(computerId)) {
      throw new Error(`Invalid computer ID ${computerId}`);
    }
    const value = Number.parseInt(computerId.slice("computer-".length), 10);
    if (!Number.isSafeInteger(value))
      throw new Error(`Invalid computer ID ${computerId}`);
    this.nextValue = Math.max(this.nextValue, value + 1);
  }

  snapshot(): number {
    return this.nextValue;
  }
}

function validateObservation(observation: ComputerIdentityObservation): void {
  if (!/^computer-[1-9][0-9]*$/u.test(observation.computerId)) {
    throw new Error(`Invalid computer ID ${observation.computerId}`);
  }
  if (
    observation.physicalKey.length === 0 ||
    observation.physicalKey.length > 256
  ) {
    throw new Error("Computer physical key must contain 1..256 characters");
  }
}
