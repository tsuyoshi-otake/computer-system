export type ComputerFamily = "advanced" | "standard";
export type ComputerForm = "block" | "item";

const computerIdAlphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const computerIdPayloadLength = 6;
const computerIdSpace = 32 ** computerIdPayloadLength;
const shortComputerIdPattern = /^c-[0-9a-hjkmnp-tv-z]{6}$/u;
const legacyComputerIdPattern = /^computer-[1-9][0-9]*$/u;

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

export type ComputerIdRandom = () => number;

export class ComputerIdAllocator {
  constructor(
    private readonly random: ComputerIdRandom = Math.random,
    private readonly maximumAttempts = 16,
  ) {
    if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts <= 0) {
      throw new RangeError("Computer ID allocation attempts must be positive");
    }
  }

  next(isReserved: (computerId: string) => boolean): string {
    for (let attempt = 0; attempt < this.maximumAttempts; attempt += 1) {
      const sample = this.random();
      if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
        throw new RangeError(
          "Computer ID random source must return 0 <= n < 1",
        );
      }
      const computerId = encodeComputerId(Math.floor(sample * computerIdSpace));
      if (!isReserved(computerId)) return computerId;
    }
    throw new Error(
      `Unable to allocate a unique computer ID after ${String(this.maximumAttempts)} attempts`,
    );
  }
}

export function isComputerId(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (shortComputerIdPattern.test(value) || legacyComputerIdPattern.test(value))
  );
}

export function requireComputerId(computerId: string): void {
  if (!isComputerId(computerId))
    throw new Error(`Invalid computer ID ${computerId}`);
}

export function numericComputerId(computerId: string): number {
  requireComputerId(computerId);
  if (legacyComputerIdPattern.test(computerId)) {
    const value = Number.parseInt(computerId.slice("computer-".length), 10);
    if (!Number.isSafeInteger(value))
      throw new Error(`Invalid computer ID ${computerId}`);
    return value;
  }
  let value = 0;
  for (const character of computerId.slice(2)) {
    const digit = computerIdAlphabet.indexOf(character);
    if (digit < 0) throw new Error(`Invalid computer ID ${computerId}`);
    value = value * 32 + digit;
  }
  return value;
}

function encodeComputerId(value: number): string {
  let remaining = value;
  let payload = "";
  for (let index = 0; index < computerIdPayloadLength; index += 1) {
    payload = computerIdAlphabet[remaining % 32]! + payload;
    remaining = Math.floor(remaining / 32);
  }
  return `c-${payload}`;
}

function validateObservation(observation: ComputerIdentityObservation): void {
  requireComputerId(observation.computerId);
  if (
    observation.physicalKey.length === 0 ||
    observation.physicalKey.length > 256
  ) {
    throw new Error("Computer physical key must contain 1..256 characters");
  }
}
