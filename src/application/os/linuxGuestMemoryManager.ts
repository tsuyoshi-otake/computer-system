import {
  normalizeGuestRamOwner,
  type GuestRamLedger,
  type GuestRamOwnerCategory,
  type GuestRamOwnerIdentity,
  type MemoryLease,
} from "../../domain/computer/guestRamLedger.js";

const kibibyte = 1_024;

export const linuxGuestMemoryConstants = Object.freeze({
  bufferMaximumBytes: 256 * kibibyte,
  kernelBaseBytes: 384 * kibibyte,
  kernelScaledMaximumBytes: 384 * kibibyte,
  maxActiveDynamicReservations: 128,
  serviceBytes: 192 * kibibyte,
} as const);

export interface LinuxGuestMemoryIdentity {
  readonly category: GuestRamOwnerCategory;
  readonly displayName: string;
  readonly instanceId?: string;
  readonly moduleId: string;
}

export interface LinuxTransientMemoryRequest extends LinuxGuestMemoryIdentity {
  readonly residentBytes: number;
  readonly virtualBytes?: number;
}

export interface LinuxProcessGrantRequest {
  readonly displayName: string;
  readonly instanceId?: string;
  readonly linearAddressSpaceBytes: number;
  readonly moduleId: string;
  readonly physicalReservationBytes: number;
}

export interface LinuxLegacyProcessGrantRequest {
  readonly displayName: string;
  readonly instanceId?: string;
  readonly moduleId: string;
}

export interface LinuxGuestMemoryReservation {
  readonly allocationId: number;
  readonly released: boolean;
  readonly residentBytes: number;
  readonly virtualBytes: number;
  bindProcess(pid: number): void;
  release(): void;
}

export interface LinuxGuestProcessGrant extends LinuxGuestMemoryReservation {
  readonly memoryBytes: number;
  readonly physicalReservationBytes: number;
}

export interface LinuxGuestMemoryAllocationSnapshot extends LinuxGuestMemoryIdentity {
  readonly allocationId: number;
  readonly pid: number | null;
  readonly reclaimable: boolean;
  readonly residentBytes: number;
  readonly virtualBytes: number;
}

export interface LinuxGuestProcessMemorySnapshot {
  readonly pid: number;
  readonly residentBytes: number;
  readonly virtualBytes: number;
}

export interface LinuxGuestMemorySnapshot {
  /** Number of active allocation records visited while building this snapshot. */
  readonly allocationVisitCount: number;
  readonly allocations: readonly LinuxGuestMemoryAllocationSnapshot[];
  readonly physical: {
    readonly availableBytes: number;
    readonly freeBytes: number;
    readonly reclaimableBytes: number;
    readonly totalBytes: number;
    readonly usedBytes: number;
  };
  readonly processes: readonly LinuxGuestProcessMemorySnapshot[];
  readonly resident: {
    readonly buffersBytes: number;
    readonly guestRuntimeBytes: number;
    readonly kernelBytes: number;
    readonly servicesBytes: number;
  };
  readonly state: "active";
}

export interface LinuxGuestMemoryCloseResult {
  readonly alreadyClosed: boolean;
  readonly closed: true;
}

interface AllocationRecord {
  readonly allocationId: number;
  readonly dynamic: boolean;
  readonly identity: GuestRamOwnerIdentity;
  readonly lease: MemoryLease;
  pid: number | null;
  readonly reclaimable: boolean;
  released: boolean;
  readonly virtualBytes: number;
}

type ManagerLifecycle = "active" | "closed" | "constructing" | "closing";

export class LinuxGuestMemoryOutOfMemoryError extends Error {
  override readonly name = "LinuxGuestMemoryOutOfMemoryError";

  constructor(
    readonly requestedBytes: number,
    readonly availableBytes: number,
    readonly owner: GuestRamOwnerIdentity,
  ) {
    super(
      `Out of Memory: ${owner.displayName} requested ${String(requestedBytes)} bytes with ${String(availableBytes)} bytes available after buffer reclaim`,
    );
  }
}

export class LinuxGuestMemoryStateError extends Error {
  override readonly name = "LinuxGuestMemoryStateError";
}

/** Boot-scoped owner of CS-Linux physical RAM admission and observation. */
export class LinuxGuestMemoryManager {
  private readonly allocations = new Map<number, AllocationRecord>();
  private readonly allocationByIdentity = new Map<string, number>();
  private lifecycle: ManagerLifecycle = "constructing";
  private nextAllocationId = 1;
  private activeDynamicReservations = 0;
  private bufferRecord: AllocationRecord | null = null;
  private readonly bufferTargetBytes: number;
  private readonly kernelBytesValue: number;
  private readonly servicesBytesValue: number;

  constructor(private readonly ledger: GuestRamLedger) {
    if (ledger.usedBytes !== 0) {
      throw new LinuxGuestMemoryStateError(
        "Linux guest memory manager requires a clean GuestRamLedger",
      );
    }

    const totalBytes = ledger.totalBytes;
    const kernelBytes =
      linuxGuestMemoryConstants.kernelBaseBytes +
      Math.min(
        linuxGuestMemoryConstants.kernelScaledMaximumBytes,
        Math.floor(totalBytes / 16),
      );
    const servicesBytes = linuxGuestMemoryConstants.serviceBytes;
    if (kernelBytes + servicesBytes > totalBytes) {
      throw new LinuxGuestMemoryStateError(
        `CS-Linux requires at least ${String(kernelBytes + servicesBytes)} bytes for kernel and services`,
      );
    }
    const bufferTargetBytes = Math.min(
      linuxGuestMemoryConstants.bufferMaximumBytes,
      Math.floor(totalBytes / 32),
      totalBytes - kernelBytes - servicesBytes,
    );

    this.kernelBytesValue = kernelBytes;
    this.servicesBytesValue = servicesBytes;
    this.bufferTargetBytes = bufferTargetBytes;

    const committed: AllocationRecord[] = [];
    try {
      committed.push(
        this.acquireSystemRecord(
          {
            category: "os",
            displayName: "CS-Linux kernel",
            moduleId: "linux-kernel",
          },
          kernelBytes,
          false,
        ),
      );
      committed.push(
        this.acquireSystemRecord(
          {
            category: "os",
            displayName: "CS-Linux system services",
            moduleId: "linux-services",
          },
          servicesBytes,
          false,
        ),
      );
      if (bufferTargetBytes > 0) {
        this.bufferRecord = this.acquireSystemRecord(
          {
            category: "os",
            displayName: "CS-Linux reclaimable buffers",
            moduleId: "linux-buffers",
          },
          bufferTargetBytes,
          true,
        );
        committed.push(this.bufferRecord);
      }
      this.lifecycle = "active";
    } catch (error: unknown) {
      for (const record of committed.reverse()) {
        if (!record.lease.released) record.lease.release();
      }
      this.allocations.clear();
      this.allocationByIdentity.clear();
      this.bufferRecord = null;
      this.lifecycle = "closed";
      throw error;
    }
  }

  reserveTransient(
    request: LinuxTransientMemoryRequest,
  ): LinuxGuestMemoryReservation {
    const virtualBytes = request.virtualBytes ?? request.residentBytes;
    return this.acquireDynamic(
      request,
      request.residentBytes,
      virtualBytes,
      (record) =>
        new ReservationHandle(record, () => this.releaseRecord(record)),
    );
  }

  grantProcess(request: LinuxProcessGrantRequest): LinuxGuestProcessGrant {
    return this.acquireDynamic(
      {
        category: "process",
        displayName: request.displayName,
        ...(request.instanceId === undefined
          ? {}
          : { instanceId: request.instanceId }),
        moduleId: request.moduleId,
      },
      request.physicalReservationBytes,
      request.linearAddressSpaceBytes,
      (record) =>
        new ProcessGrantHandle(record, request.linearAddressSpaceBytes, () =>
          this.releaseRecord(record),
        ),
    );
  }

  grantLegacyProcess(
    request: LinuxLegacyProcessGrantRequest,
  ): LinuxGuestProcessGrant {
    this.requireActive();
    const availableBytes = this.availableBytesAfterReclaim();
    if (availableBytes <= 0) {
      const owner = normalizeGuestRamOwner({
        category: "process",
        ...request,
      });
      throw new LinuxGuestMemoryOutOfMemoryError(1, 0, owner);
    }
    return this.grantProcess({
      ...request,
      linearAddressSpaceBytes: availableBytes,
      physicalReservationBytes: availableBytes,
    });
  }

  snapshot(): LinuxGuestMemorySnapshot {
    this.requireActive();
    const allocationSnapshots: LinuxGuestMemoryAllocationSnapshot[] = [];
    const processes = new Map<
      number,
      { residentBytes: number; virtualBytes: number }
    >();
    let allocationVisitCount = 0;
    let accountedBytes = 0;
    let guestRuntimeBytes = 0;
    for (const record of this.allocations.values()) {
      if (record.released) continue;
      allocationVisitCount += 1;
      const residentBytes = record.lease.bytes;
      accountedBytes += residentBytes;
      if (record.dynamic) guestRuntimeBytes += residentBytes;
      allocationSnapshots.push(
        Object.freeze({
          allocationId: record.allocationId,
          category: record.identity.category,
          displayName: record.identity.displayName,
          ...(record.identity.instanceId === undefined
            ? {}
            : { instanceId: record.identity.instanceId }),
          moduleId: record.identity.moduleId,
          pid: record.pid,
          reclaimable: record.reclaimable,
          residentBytes,
          virtualBytes: record.virtualBytes,
        }),
      );
      if (record.pid !== null) {
        const current = processes.get(record.pid) ?? {
          residentBytes: 0,
          virtualBytes: 0,
        };
        current.residentBytes += residentBytes;
        current.virtualBytes += record.virtualBytes;
        processes.set(record.pid, current);
      }
    }
    if (accountedBytes !== this.ledger.usedBytes) {
      throw new LinuxGuestMemoryStateError(
        "Linux memory allocations and GuestRamLedger are inconsistent",
      );
    }
    const bufferBytes = this.bufferRecord?.lease.bytes ?? 0;
    const freeBytes = this.ledger.availableBytes;
    const processSnapshots = [...processes].map(([pid, memory]) =>
      Object.freeze({ pid, ...memory }),
    );
    return Object.freeze({
      allocationVisitCount,
      allocations: Object.freeze(allocationSnapshots),
      physical: Object.freeze({
        availableBytes: freeBytes + bufferBytes,
        freeBytes,
        reclaimableBytes: bufferBytes,
        totalBytes: this.ledger.totalBytes,
        usedBytes: this.ledger.usedBytes,
      }),
      processes: Object.freeze(processSnapshots),
      resident: Object.freeze({
        buffersBytes: bufferBytes,
        guestRuntimeBytes,
        kernelBytes: this.kernelBytesValue,
        servicesBytes: this.servicesBytesValue,
      }),
      state: "active" as const,
    });
  }

  close(): LinuxGuestMemoryCloseResult {
    if (this.lifecycle === "closed") {
      return Object.freeze({ alreadyClosed: true, closed: true });
    }
    if (this.lifecycle === "constructing") {
      throw new LinuxGuestMemoryStateError(
        "Linux guest memory manager construction is incomplete",
      );
    }
    this.lifecycle = "closing";
    let firstError: unknown;
    for (const record of [...this.allocations.values()].reverse()) {
      if (record.released) continue;
      try {
        this.finalizeRecord(record);
      } catch (error: unknown) {
        firstError ??= error;
      }
    }
    this.activeDynamicReservations = 0;
    this.bufferRecord = null;
    this.lifecycle = "closed";
    if (this.ledger.usedBytes !== 0) {
      firstError ??= new LinuxGuestMemoryStateError(
        `GuestRamLedger retained ${String(this.ledger.usedBytes)} bytes after Linux memory manager close`,
      );
    }
    if (firstError !== undefined) throw asError(firstError);
    return Object.freeze({ alreadyClosed: false, closed: true });
  }

  private acquireSystemRecord(
    identity: LinuxGuestMemoryIdentity,
    bytes: number,
    reclaimable: boolean,
  ): AllocationRecord {
    requirePositiveSafeInteger(bytes, "bytes");
    const normalized = normalizeGuestRamOwner(identity);
    const allocationId = this.allocateId();
    const identityKey = ownerKey(normalized);
    this.requireUniqueIdentity(identityKey);
    const lease = this.ledger.acquire(bytes, normalized);
    const record: AllocationRecord = {
      allocationId,
      dynamic: false,
      identity: normalized,
      lease,
      pid: null,
      reclaimable,
      released: false,
      virtualBytes: bytes,
    };
    this.allocations.set(allocationId, record);
    this.allocationByIdentity.set(identityKey, allocationId);
    return record;
  }

  private acquireDynamic<Result>(
    identity: LinuxGuestMemoryIdentity,
    residentBytes: number,
    virtualBytes: number,
    createHandle: (record: AllocationRecord) => Result,
  ): Result {
    this.requireActive();
    requirePositiveSafeInteger(residentBytes, "residentBytes");
    requirePositiveSafeInteger(virtualBytes, "virtualBytes");
    if (
      this.activeDynamicReservations >=
      linuxGuestMemoryConstants.maxActiveDynamicReservations
    ) {
      throw new LinuxGuestMemoryStateError(
        `Active Linux memory reservation limit of ${String(linuxGuestMemoryConstants.maxActiveDynamicReservations)} has been reached`,
      );
    }
    const normalized = normalizeGuestRamOwner(identity);
    const identityKey = ownerKey(normalized);
    this.requireUniqueIdentity(identityKey);
    const allocationId = this.allocateId();
    const lease = this.acquireWithBufferReclaim(residentBytes, normalized);
    const record: AllocationRecord = {
      allocationId,
      dynamic: true,
      identity: normalized,
      lease,
      pid: null,
      reclaimable: false,
      released: false,
      virtualBytes,
    };
    this.allocations.set(allocationId, record);
    this.allocationByIdentity.set(identityKey, allocationId);
    this.activeDynamicReservations += 1;
    return createHandle(record);
  }

  private acquireWithBufferReclaim(
    bytes: number,
    owner: GuestRamOwnerIdentity,
  ): MemoryLease {
    const freeBytes = this.ledger.availableBytes;
    const bufferLease = this.bufferRecord?.lease;
    const bufferBytes = bufferLease?.bytes ?? 0;
    const availableBytes = freeBytes + bufferBytes;
    if (bytes > availableBytes) {
      throw new LinuxGuestMemoryOutOfMemoryError(bytes, availableBytes, owner);
    }
    const shortfall = Math.max(0, bytes - freeBytes);
    if (shortfall > 0) bufferLease!.resize(bufferBytes - shortfall);
    try {
      return this.ledger.acquire(bytes, owner);
    } catch (error: unknown) {
      if (shortfall > 0) {
        try {
          bufferLease!.resize(bufferBytes);
        } catch (rollbackError: unknown) {
          throw new AggregateError(
            [error, rollbackError],
            "Linux buffer reclaim rollback failed",
          );
        }
      }
      throw error;
    }
  }

  private releaseRecord(record: AllocationRecord): void {
    this.requireActive();
    this.finalizeRecord(record);
    this.refillBuffers();
  }

  private finalizeRecord(record: AllocationRecord): void {
    if (record.released) {
      throw new LinuxGuestMemoryStateError(
        `Linux memory allocation ${String(record.allocationId)} is already released`,
      );
    }
    record.lease.release();
    record.released = true;
    this.allocations.delete(record.allocationId);
    this.allocationByIdentity.delete(ownerKey(record.identity));
    if (record.dynamic) this.activeDynamicReservations -= 1;
  }

  private refillBuffers(): void {
    const bufferLease = this.bufferRecord?.lease;
    if (bufferLease === undefined || bufferLease.released) return;
    const growth = Math.min(
      this.bufferTargetBytes - bufferLease.bytes,
      this.ledger.availableBytes,
    );
    if (growth > 0) bufferLease.resize(bufferLease.bytes + growth);
  }

  private availableBytesAfterReclaim(): number {
    return this.ledger.availableBytes + (this.bufferRecord?.lease.bytes ?? 0);
  }

  private allocateId(): number {
    const allocationId = this.nextAllocationId;
    this.nextAllocationId =
      allocationId === Number.MAX_SAFE_INTEGER ? 1 : allocationId + 1;
    if (this.allocations.has(allocationId)) {
      throw new LinuxGuestMemoryStateError(
        "Linux memory allocation identifier space is exhausted",
      );
    }
    return allocationId;
  }

  private requireUniqueIdentity(identityKey: string): void {
    if (this.allocationByIdentity.has(identityKey)) {
      throw new LinuxGuestMemoryStateError(
        "Linux memory allocation identity is already active",
      );
    }
  }

  private requireActive(): void {
    if (this.lifecycle !== "active") {
      throw new LinuxGuestMemoryStateError(
        `Linux guest memory manager is ${this.lifecycle}`,
      );
    }
  }
}

class ReservationHandle implements LinuxGuestMemoryReservation {
  constructor(
    protected readonly record: AllocationRecord,
    private readonly releaseRecord: () => void,
  ) {}

  get allocationId(): number {
    return this.record.allocationId;
  }

  get released(): boolean {
    return this.record.released;
  }

  get residentBytes(): number {
    return this.released ? 0 : this.record.lease.bytes;
  }

  get virtualBytes(): number {
    return this.released ? 0 : this.record.virtualBytes;
  }

  bindProcess(pid: number): void {
    requirePositiveSafeInteger(pid, "pid");
    if (this.released) {
      throw new LinuxGuestMemoryStateError(
        "Released Linux memory cannot be bound to a process",
      );
    }
    if (this.record.pid !== null) {
      throw new LinuxGuestMemoryStateError(
        `Linux memory allocation is already bound to PID ${String(this.record.pid)}`,
      );
    }
    this.record.pid = pid;
  }

  release(): void {
    this.releaseRecord();
  }
}

class ProcessGrantHandle
  extends ReservationHandle
  implements LinuxGuestProcessGrant
{
  constructor(
    record: AllocationRecord,
    readonly memoryBytes: number,
    releaseRecord: () => void,
  ) {
    super(record, releaseRecord);
  }

  get physicalReservationBytes(): number {
    return this.residentBytes;
  }
}

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
}

function ownerKey(owner: GuestRamOwnerIdentity): string {
  return `${owner.category}\0${owner.moduleId}\0${owner.instanceId ?? ""}`;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
