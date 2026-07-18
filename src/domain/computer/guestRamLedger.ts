const memoryLeaseBrand: unique symbol = Symbol("MemoryLease");

export type GuestRamOwner =
  | "compiler-asm"
  | "compiler-basic"
  | "compiler-c"
  | "compiler-cpp"
  | "dos-editor"
  | "dos-qbasic"
  | "dos-resident"
  | "dos-toolchain-ide"
  | "linker"
  | "program-list"
  | "vi";

export interface MemoryLease {
  readonly [memoryLeaseBrand]: true;
  readonly bytes: number;
  readonly owner: GuestRamOwner;
  readonly released: boolean;
  release(): void;
  resize(bytes: number): void;
}

export interface GuestRamOwnerBreakdown {
  readonly bytes: number;
  readonly leases: number;
  readonly owner: GuestRamOwner;
}

export interface GuestRamSnapshot {
  readonly availableBytes: number;
  readonly breakdown: readonly GuestRamOwnerBreakdown[];
  readonly leaseCount: number;
  readonly totalBytes: number;
  readonly usedBytes: number;
}

interface LeaseRecord {
  bytes: number;
  readonly owner: GuestRamOwner;
}

export class GuestRamOutOfMemoryError extends Error {
  override readonly name = "GuestRamOutOfMemoryError";

  constructor(
    readonly requestedBytes: number,
    readonly availableBytes: number,
    readonly owner: GuestRamOwner,
  ) {
    super(
      `Out of Memory: ${owner} requested ${String(requestedBytes)} bytes with ${String(availableBytes)} bytes available`,
    );
  }
}

/**
 * Transient per-boot accounting for host-implemented guest-resident components.
 *
 * Executable data and stacks remain owned by Cs486Process. This ledger reserves
 * the RAM that those processes must not see because DOS, editors, and compiler
 * frontends are implemented as host objects rather than bytes inside CS486.
 */
export class GuestRamLedger {
  private readonly leases = new Map<number, LeaseRecord>();
  private nextLeaseId = 1;
  private usedBytesValue = 0;

  constructor(readonly totalBytes: number) {
    requireNonNegativeSafeInteger(totalBytes, "totalBytes");
    if (totalBytes === 0) throw new RangeError("totalBytes must be positive");
  }

  get availableBytes(): number {
    return this.totalBytes - this.usedBytesValue;
  }

  get usedBytes(): number {
    return this.usedBytesValue;
  }

  acquire(bytes: number, owner: GuestRamOwner): MemoryLease {
    requireNonNegativeSafeInteger(bytes, "bytes");
    if (bytes === 0)
      throw new RangeError("Memory lease bytes must be positive");
    this.requireAvailable(bytes, owner);
    const id = this.nextLeaseId;
    this.nextLeaseId =
      this.nextLeaseId === Number.MAX_SAFE_INTEGER ? 1 : this.nextLeaseId + 1;
    if (this.leases.has(id)) {
      throw new Error("Guest RAM lease identifier space is exhausted");
    }
    this.leases.set(id, { bytes, owner });
    this.usedBytesValue += bytes;
    return new LedgerMemoryLease(
      () => this.leaseBytes(id),
      () => this.release(id),
      (nextBytes) => this.resize(id, nextBytes),
      owner,
    );
  }

  breakdown(): readonly GuestRamOwnerBreakdown[] {
    const owners = new Map<GuestRamOwner, { bytes: number; leases: number }>();
    for (const record of this.leases.values()) {
      const current = owners.get(record.owner) ?? { bytes: 0, leases: 0 };
      current.bytes += record.bytes;
      current.leases += 1;
      owners.set(record.owner, current);
    }
    return Object.freeze(
      [...owners]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([owner, value]) =>
          Object.freeze({ owner, bytes: value.bytes, leases: value.leases }),
        ),
    );
  }

  snapshot(): GuestRamSnapshot {
    return Object.freeze({
      availableBytes: this.availableBytes,
      breakdown: this.breakdown(),
      leaseCount: this.leases.size,
      totalBytes: this.totalBytes,
      usedBytes: this.usedBytesValue,
    });
  }

  private leaseBytes(id: number): number {
    return this.requireLease(id).bytes;
  }

  private release(id: number): void {
    const record = this.requireLease(id);
    this.leases.delete(id);
    this.usedBytesValue -= record.bytes;
  }

  private resize(id: number, bytes: number): void {
    requireNonNegativeSafeInteger(bytes, "bytes");
    const record = this.requireLease(id);
    const delta = bytes - record.bytes;
    if (delta > 0) this.requireAvailable(delta, record.owner);
    record.bytes = bytes;
    this.usedBytesValue += delta;
  }

  private requireAvailable(bytes: number, owner: GuestRamOwner): void {
    if (bytes > this.availableBytes) {
      throw new GuestRamOutOfMemoryError(bytes, this.availableBytes, owner);
    }
  }

  private requireLease(id: number): LeaseRecord {
    const record = this.leases.get(id);
    if (record === undefined)
      throw new Error("Memory lease is already released");
    return record;
  }
}

class LedgerMemoryLease implements MemoryLease {
  readonly [memoryLeaseBrand] = true as const;
  private releasedValue = false;

  constructor(
    private readonly readBytes: () => number,
    private readonly releaseLease: () => void,
    private readonly resizeLease: (bytes: number) => void,
    readonly owner: GuestRamOwner,
  ) {}

  get bytes(): number {
    return this.releasedValue ? 0 : this.readBytes();
  }

  get released(): boolean {
    return this.releasedValue;
  }

  release(): void {
    if (this.releasedValue) throw new Error("Memory lease is already released");
    this.releaseLease();
    this.releasedValue = true;
  }

  resize(bytes: number): void {
    if (this.releasedValue) throw new Error("Memory lease is already released");
    this.resizeLease(bytes);
  }
}

function requireNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}
