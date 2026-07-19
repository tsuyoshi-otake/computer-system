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

export interface GuestProcessMemoryIdentity {
  readonly displayName: string;
  readonly instanceId?: string;
  readonly moduleId: string;
}

export interface GuestProcessMemoryGrant {
  readonly memoryBytes: number;
  readonly physicalReservationBytes: number;
  readonly released: boolean;
  release(): void;
}

export interface GuestProcessMemoryAdmission {
  readonly dosMemoryManager?: DosGuestMemoryManager;
  readonly identity: GuestProcessMemoryIdentity;
  readonly ledger: GuestRamLedger;
}

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
    if (admission.dosMemoryManager !== undefined) {
      return admission.dosMemoryManager.grantLegacyProcess(admission.identity);
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

  if (admission.dosMemoryManager !== undefined) {
    return admission.dosMemoryManager.grantProcess({
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
    release(): void {
      if (!lease.released) lease.release();
    },
  });
}
