import {
  ComputerIdentityRegistry,
  ComputerIdSequence,
  type ComputerFamily,
  type ComputerIdentityObservation,
  type IdentityResult,
} from "../../domain/computer/identity.js";

export interface ComputerIdentitySnapshot {
  readonly schema: 1;
  readonly nextId: number;
  readonly observations: readonly ComputerIdentityObservation[];
}

export interface ComputerIdentityRepository {
  load(): ComputerIdentitySnapshot | undefined;
  save(snapshot: ComputerIdentitySnapshot): number;
}

export type IdentityPlacementResult =
  | {
      readonly outcome: "placed";
      readonly computerId: string;
      readonly family: ComputerFamily;
      readonly generation: number;
    }
  | Extract<IdentityResult, { readonly outcome: "duplicate" }>;

export class PersistentComputerIdentityService {
  private readonly registry = new ComputerIdentityRegistry();
  private sequence = new ComputerIdSequence();

  constructor(private readonly repository: ComputerIdentityRepository) {
    const snapshot = repository.load();
    if (snapshot !== undefined) {
      if (snapshot.schema !== 1) throw new Error("Unsupported identity schema");
      this.registry.restore(snapshot.observations);
      this.sequence = new ComputerIdSequence(snapshot.nextId);
    }
  }

  place(
    physicalKey: string,
    family: ComputerFamily,
    carriedComputerId?: string,
  ): IdentityPlacementResult {
    if (carriedComputerId !== undefined)
      this.sequence.reserve(carriedComputerId);
    const computerId = carriedComputerId ?? this.sequence.next();
    const result =
      carriedComputerId === undefined
        ? this.registry.claim({
            computerId,
            family,
            form: "block",
            physicalKey,
          })
        : this.registry.transfer(computerId, detachedKey(computerId), {
            family,
            form: "block",
            physicalKey,
          });
    if (result.outcome === "duplicate") return result;
    if (result.outcome === "missing") {
      const claim = this.registry.claim({
        computerId,
        family,
        form: "block",
        physicalKey,
      });
      if (claim.outcome === "duplicate") return claim;
    }
    const generation = this.repository.save(this.snapshot());
    return { outcome: "placed", computerId, family, generation };
  }

  break(physicalKey: string): IdentityPlacementResult | IdentityResult {
    const observation = this.registry
      .snapshot()
      .find(
        (candidate) =>
          candidate.form === "block" && candidate.physicalKey === physicalKey,
      );
    if (observation === undefined) {
      return { outcome: "missing", computerId: physicalKey };
    }
    const result = this.registry.transfer(observation.computerId, physicalKey, {
      family: observation.family,
      form: "item",
      physicalKey: detachedKey(observation.computerId),
    });
    if (result.outcome !== "transferred") return result;
    const generation = this.repository.save(this.snapshot());
    return {
      outcome: "placed",
      computerId: observation.computerId,
      family: observation.family,
      generation,
    };
  }

  rollbackPlacement(
    physicalKey: string,
    computerId: string,
    returnToItem: boolean,
  ): void {
    const observation = this.registry.get(computerId);
    if (
      observation?.form !== "block" ||
      observation.physicalKey !== physicalKey
    ) {
      return;
    }
    if (returnToItem) {
      this.registry.transfer(computerId, physicalKey, {
        family: observation.family,
        form: "item",
        physicalKey: detachedKey(computerId),
      });
    } else {
      this.registry.remove(computerId);
    }
    this.repository.save(this.snapshot());
  }

  observation(computerId: string): ComputerIdentityObservation | undefined {
    return this.registry.get(computerId);
  }

  atPhysicalKey(physicalKey: string): ComputerIdentityObservation | undefined {
    return this.registry
      .snapshot()
      .find((observation) => observation.physicalKey === physicalKey);
  }

  blockObservations(): readonly ComputerIdentityObservation[] {
    return this.registry
      .snapshot()
      .filter((observation) => observation.form === "block");
  }

  private snapshot(): ComputerIdentitySnapshot {
    return {
      schema: 1,
      nextId: this.sequence.snapshot(),
      observations: this.registry.snapshot(),
    };
  }
}

function detachedKey(computerId: string): string {
  return `detached:${computerId}`;
}
