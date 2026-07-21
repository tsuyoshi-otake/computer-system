import type {
  GuestRamLedger,
  MemoryLease,
} from "../../domain/computer/guestRamLedger.js";
import {
  cs486ExecutableMemoryRequirements,
  type Cs486Executable,
  type Cs486ExecutableMemoryRequirements,
} from "../../domain/cpu/cs486.js";
import type { DosGuestMemoryManager } from "../os/dosGuestMemoryManager.js";
import type { LinuxGuestMemoryManager } from "../os/linuxGuestMemoryManager.js";

export interface GuestProcessMemoryIdentity {
  readonly displayName: string;
  readonly instanceId?: string;
  readonly moduleId: string;
}

export interface GuestProcessMemoryGrant {
  readonly memoryBytes: number;
  readonly physicalReservationBytes: number;
  readonly released: boolean;
  bindProcess(pid: number): void;
  release(): void;
}

export type GuestProcessMemoryAdmission =
  | {
      readonly identity: GuestProcessMemoryIdentity;
      readonly kind: "dos";
      readonly manager: DosGuestMemoryManager;
    }
  | {
      readonly identity: GuestProcessMemoryIdentity;
      readonly kind: "ledger";
      readonly ledger: GuestRamLedger;
    }
  | {
      readonly identity: GuestProcessMemoryIdentity;
      readonly kind: "linux";
      readonly manager: LinuxGuestMemoryManager;
    };

/**
 * Reserves physical guest RAM before constructing a CS486 process.
 *
 * Version 1/2 executables keep their historical single-program behaviour by
 * taking every currently allocatable byte as an exclusive lease. Version 3
 * executables reserve only their declared physical working set while receiving
 * their declared flat linear address-space size.
 */
export function grantCs486ExecutableMemory(
  executable: Cs486Executable,
  admission: GuestProcessMemoryAdmission,
): GuestProcessMemoryGrant {
  return grantCs486MemoryRequirements(
    cs486ExecutableMemoryRequirements(executable),
    admission,
  );
}

export function grantCs486MemoryRequirements(
  requirements: Cs486ExecutableMemoryRequirements,
  admission: GuestProcessMemoryAdmission,
): GuestProcessMemoryGrant {
  if (requirements.kind === "legacy") {
    if (admission.kind === "dos") {
      return adaptUnboundGrant(
        admission.manager.grantLegacyProcess(admission.identity),
      );
    }
    if (admission.kind === "linux") {
      return admission.manager.grantLegacyProcess(admission.identity);
    }
    const availableBytes = admission.ledger.availableBytes;
    if (availableBytes <= 0) {
      throw new Error("Out of Memory: no guest process memory remains");
    }
    return leaseGrant(
      admission.ledger.acquire(availableBytes, {
        category: "process",
        ...admission.identity,
      }),
      availableBytes,
    );
  }

  if (admission.kind === "dos") {
    return adaptUnboundGrant(
      admission.manager.grantProcess({
        ...admission.identity,
        linearAddressSpaceBytes: requirements.linearAddressSpaceBytes,
        physicalReservationBytes: requirements.physicalReservationBytes,
      }),
    );
  }
  if (admission.kind === "linux") {
    return admission.manager.grantProcess({
      ...admission.identity,
      linearAddressSpaceBytes: requirements.linearAddressSpaceBytes,
      physicalReservationBytes: requirements.physicalReservationBytes,
    });
  }
  const lease = admission.ledger.acquire(
    requirements.physicalReservationBytes,
    {
      category: "process",
      ...admission.identity,
    },
  );
  return leaseGrant(lease, requirements.linearAddressSpaceBytes);
}

export function releaseGuestProcessMemory(
  grant: GuestProcessMemoryGrant | undefined,
): void {
  if (grant?.released === false) grant.release();
}

function leaseGrant(
  lease: MemoryLease,
  memoryBytes: number,
): GuestProcessMemoryGrant {
  return Object.freeze({
    get memoryBytes(): number {
      return memoryBytes;
    },
    get physicalReservationBytes(): number {
      return lease.bytes;
    },
    get released(): boolean {
      return lease.released;
    },
    bindProcess(pid: number): void {
      requirePositivePid(pid);
    },
    release(): void {
      if (!lease.released) lease.release();
    },
  });
}

function adaptUnboundGrant(grant: {
  readonly memoryBytes: number;
  readonly physicalReservationBytes: number;
  readonly released: boolean;
  release(): void;
}): GuestProcessMemoryGrant {
  return Object.freeze({
    get memoryBytes(): number {
      return grant.memoryBytes;
    },
    get physicalReservationBytes(): number {
      return grant.physicalReservationBytes;
    },
    get released(): boolean {
      return grant.released;
    },
    bindProcess(pid: number): void {
      requirePositivePid(pid);
    },
    release(): void {
      if (!grant.released) grant.release();
    },
  });
}

function requirePositivePid(pid: number): void {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new RangeError("pid must be a positive safe integer");
  }
}
