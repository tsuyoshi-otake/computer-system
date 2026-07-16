import type { ComputerOsProfile } from "../../domain/computer/computer.js";

export interface OsIdentity {
  readonly fullName: string;
  readonly shortName: string;
  readonly version: string;
}

const identities: Readonly<Record<ComputerOsProfile, OsIdentity>> = {
  linux: {
    fullName: "Computer System Linux",
    shortName: "CS-Linux",
    version: "1.0",
  },
  dos: {
    fullName: "Computer System DOS",
    shortName: "CS-DOS",
    version: "6.2",
  },
};

export function getOsIdentity(profile: ComputerOsProfile): OsIdentity {
  return identities[profile];
}

export function formatOsIdentity(identity: OsIdentity): string {
  return `${identity.fullName} ${identity.version}`;
}

export function formatShortOsIdentity(identity: OsIdentity): string {
  return `${identity.shortName} ${identity.version}`;
}
