import {
  ComputerIdAllocator,
  ComputerIdentityRegistry,
  type ComputerIdRandom,
  type ComputerFamily,
  type ComputerIdentityObservation,
  type IdentityResult,
} from "../../domain/computer/identity.js";

export interface ComputerIdentitySnapshot {
  readonly schema: 2;
  readonly observations: readonly ComputerIdentityObservation[];
}

export interface PersistentComputerIdentityServiceOptions {
  readonly maximumAllocationAttempts?: number;
  readonly random?: ComputerIdRandom;
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
  private readonly allocator: ComputerIdAllocator;
  private readonly blockComputerIds: string[] = [];
  private readonly blockIndexes = new Map<string, number>();

  constructor(
    private readonly repository: ComputerIdentityRepository,
    options: PersistentComputerIdentityServiceOptions = {},
  ) {
    this.allocator = new ComputerIdAllocator(
      options.random,
      options.maximumAllocationAttempts,
    );
    const snapshot = repository.load();
    if (snapshot !== undefined) {
      if (snapshot.schema !== 2) throw new Error("Unsupported identity schema");
      this.registry.restore(snapshot.observations);
      for (const observation of snapshot.observations) {
        if (observation.form === "block") {
          this.trackBlock(observation.computerId, true);
        }
      }
    }
  }

  place(
    physicalKey: string,
    family: ComputerFamily,
    carriedComputerId?: string,
  ): IdentityPlacementResult {
    const computerId = carriedComputerId ?? this.allocateComputerId();
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
    this.trackBlock(computerId, true);
    const generation = this.repository.save(this.snapshot());
    return { outcome: "placed", computerId, family, generation };
  }

  createItem(family: ComputerFamily): IdentityPlacementResult {
    const computerId = this.allocateComputerId();
    const result = this.registry.claim({
      computerId,
      family,
      form: "item",
      physicalKey: detachedKey(computerId),
    });
    if (result.outcome === "duplicate") return result;
    const generation = this.repository.save(this.snapshot());
    return { outcome: "placed", computerId, family, generation };
  }

  break(physicalKey: string): IdentityPlacementResult | IdentityResult {
    const observation = this.registry.getAtPhysicalKey(physicalKey);
    if (observation?.form !== "block") {
      return { outcome: "missing", computerId: physicalKey };
    }
    const result = this.registry.transfer(observation.computerId, physicalKey, {
      family: observation.family,
      form: "item",
      physicalKey: detachedKey(observation.computerId),
    });
    if (result.outcome !== "transferred") return result;
    this.trackBlock(observation.computerId, false);
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
    this.trackBlock(computerId, false);
    this.repository.save(this.snapshot());
  }

  observation(computerId: string): ComputerIdentityObservation | undefined {
    return this.registry.get(computerId);
  }

  atPhysicalKey(physicalKey: string): ComputerIdentityObservation | undefined {
    return this.registry.getAtPhysicalKey(physicalKey);
  }

  blockObservations(): readonly ComputerIdentityObservation[] {
    return this.registry
      .snapshot()
      .filter((observation) => observation.form === "block");
  }

  blockObservationPage(
    cursor: number,
    maximum: number,
  ): {
    readonly nextCursor: number | null;
    readonly observations: readonly ComputerIdentityObservation[];
    readonly total: number;
  } {
    if (!Number.isSafeInteger(cursor) || cursor < 0) {
      throw new RangeError(
        "Block observation page cursor must be non-negative",
      );
    }
    if (!Number.isSafeInteger(maximum) || maximum <= 0 || maximum > 64) {
      throw new RangeError(
        "Block observation page size must be between 1 and 64",
      );
    }
    const start = Math.min(cursor, this.blockComputerIds.length);
    const end = Math.min(start + maximum, this.blockComputerIds.length);
    const observations: ComputerIdentityObservation[] = [];
    for (let index = start; index < end; index += 1) {
      const computerId = this.blockComputerIds[index];
      const observation =
        computerId === undefined ? undefined : this.registry.get(computerId);
      if (observation?.form === "block") observations.push(observation);
    }
    return {
      nextCursor: end < this.blockComputerIds.length ? end : null,
      observations,
      total: this.blockComputerIds.length,
    };
  }

  blockObservationBatch(
    cursor: number,
    maximum: number,
  ): {
    readonly nextCursor: number;
    readonly observations: readonly ComputerIdentityObservation[];
  } {
    if (!Number.isSafeInteger(maximum) || maximum <= 0) {
      throw new RangeError("Block observation batch size must be positive");
    }
    if (this.blockComputerIds.length === 0) {
      return { nextCursor: 0, observations: [] };
    }
    const start =
      Number.isSafeInteger(cursor) && cursor >= 0
        ? cursor % this.blockComputerIds.length
        : 0;
    const count = Math.min(maximum, this.blockComputerIds.length);
    const observations: ComputerIdentityObservation[] = [];
    for (let offset = 0; offset < count; offset += 1) {
      const computerId =
        this.blockComputerIds[(start + offset) % this.blockComputerIds.length];
      const observation =
        computerId === undefined ? undefined : this.registry.get(computerId);
      if (observation?.form === "block") observations.push(observation);
    }
    return {
      nextCursor: (start + count) % this.blockComputerIds.length,
      observations,
    };
  }

  private snapshot(): ComputerIdentitySnapshot {
    return {
      schema: 2,
      observations: this.registry.snapshot(),
    };
  }

  private allocateComputerId(): string {
    return this.allocator.next(
      (computerId) => this.registry.get(computerId) !== undefined,
    );
  }

  private trackBlock(computerId: string, present: boolean): void {
    const existingIndex = this.blockIndexes.get(computerId);
    if (present) {
      if (existingIndex !== undefined) return;
      this.blockIndexes.set(computerId, this.blockComputerIds.length);
      this.blockComputerIds.push(computerId);
      return;
    }
    if (existingIndex === undefined) return;
    const lastIndex = this.blockComputerIds.length - 1;
    const lastComputerId = this.blockComputerIds[lastIndex]!;
    if (existingIndex !== lastIndex) {
      this.blockComputerIds[existingIndex] = lastComputerId;
      this.blockIndexes.set(lastComputerId, existingIndex);
    }
    this.blockComputerIds.pop();
    this.blockIndexes.delete(computerId);
  }
}

function detachedKey(computerId: string): string {
  return `detached:${computerId}`;
}
