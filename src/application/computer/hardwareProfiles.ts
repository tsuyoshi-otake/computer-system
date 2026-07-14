import type { ComputerRecord } from "../../domain/computer/computer.js";
import {
  defaultComputerHardware,
  portableComputerHardware,
} from "../../domain/computer/hardware.js";

export type PortableProfileResult = "configured" | "migrated" | "unchanged";

/**
 * Applies the portable DOS profile to new records and performs one conservative
 * migration for records that still match every former desktop default. Any
 * customized OS, CPU, clock, or RAM value remains authoritative.
 */
export function applyPortableComputerProfile(
  record: ComputerRecord,
  newlyCreated = false,
): PortableProfileResult {
  if (hasPortableProfile(record)) return "unchanged";
  if (!newlyCreated && !hasLegacyPortableDefaults(record)) return "unchanged";
  record.configureSystemProfile({
    hardware: portableComputerHardware,
    osProfile: "dos",
  });
  return newlyCreated ? "configured" : "migrated";
}

function hasPortableProfile(record: ComputerRecord): boolean {
  return (
    record.osProfile === "dos" &&
    sameHardware(record.hardware, portableComputerHardware)
  );
}

function hasLegacyPortableDefaults(record: ComputerRecord): boolean {
  return (
    record.osProfile === "linux" &&
    sameHardware(record.hardware, defaultComputerHardware)
  );
}

function sameHardware(
  left: ComputerRecord["hardware"],
  right: ComputerRecord["hardware"],
): boolean {
  return (
    left.clockHz === right.clockHz &&
    left.cpuModel === right.cpuModel &&
    left.memoryBytes === right.memoryBytes
  );
}
