import type { ComputerRecord } from "../../domain/computer/computer.js";
import {
  advancedComputerHardware,
  defaultComputerHardware,
  portableComputerHardware,
} from "../../domain/computer/hardware.js";

export type PortableProfileResult = "configured" | "migrated" | "unchanged";
export type StationaryProfileResult = "migrated" | "unchanged";

const formerDesktopComputerHardware = {
  clockHz: 33_000_000,
  cpuModel: "cs486dx" as const,
  memoryBytes: 1_048_576,
};

export function applyStationaryComputerProfile(
  record: ComputerRecord,
): StationaryProfileResult {
  if (record.family === "standard") {
    if (!sameHardware(record.hardware, formerDesktopComputerHardware)) {
      return "unchanged";
    }
    record.configureHardware(defaultComputerHardware);
    return "migrated";
  }
  if (sameHardware(record.hardware, advancedComputerHardware)) {
    return "unchanged";
  }
  if (
    !sameHardware(record.hardware, defaultComputerHardware) &&
    !sameHardware(record.hardware, formerDesktopComputerHardware)
  ) {
    return "unchanged";
  }
  record.configureHardware(advancedComputerHardware);
  return "migrated";
}

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
    (sameHardware(record.hardware, defaultComputerHardware) ||
      sameHardware(record.hardware, formerDesktopComputerHardware))
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
