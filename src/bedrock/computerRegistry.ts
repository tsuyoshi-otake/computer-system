import { world } from "@minecraft/server";

import { DynamicPropertyIdentityRepository } from "../adapters/storage/dynamicPropertyIdentityRepository.js";
import { PersistentComputerIdentityService } from "../application/computer/identityPersistence.js";
import {
  applyPortableComputerProfile,
  applyStationaryComputerProfile,
} from "../application/computer/hardwareProfiles.js";
import { ComputerRecord } from "../domain/computer/computer.js";
import { portableComputerHardware } from "../domain/computer/hardware.js";
import type { ComputerFamily } from "../domain/computer/identity.js";
import { computerHost, registerComputer } from "./computerHost.js";

export const computerIdentityProperty = "computer_system:computer_id";

let identities: PersistentComputerIdentityService | undefined;

export function identityService(): PersistentComputerIdentityService {
  identities ??= new PersistentComputerIdentityService(
    new DynamicPropertyIdentityRepository(world),
  );
  return identities;
}

export function ensureComputer(
  computerId: string,
  family: ComputerFamily,
): ComputerRecord {
  const existing = computerHost.get(computerId);
  if (existing !== undefined) {
    applyStationaryComputerProfile(existing);
    return existing;
  }
  const restored = computerHost.restore(computerId);
  if (restored.outcome === "registered") {
    applyStationaryComputerProfile(restored.record);
    return restored.record;
  }
  if (restored.outcome === "failed") throw restored.error;
  const record = new ComputerRecord(computerId, family);
  registerComputer(record);
  return record;
}

export function createPortableComputer(family: ComputerFamily): ComputerRecord {
  const created = identityService().createItem(family);
  if (created.outcome !== "placed") {
    throw new Error(`Unable to allocate portable computer identity`);
  }
  return ensurePortableComputer(created.computerId, created.family);
}

export function ensurePortableComputer(
  computerId: string,
  family: ComputerFamily,
): ComputerRecord {
  const existing = computerHost.get(computerId);
  if (existing !== undefined) {
    applyPortableComputerProfile(existing);
    return existing;
  }
  const restored = computerHost.restore(computerId);
  if (restored.outcome === "registered") {
    applyPortableComputerProfile(restored.record);
    return restored.record;
  }
  if (restored.outcome === "failed") throw restored.error;
  const record = new ComputerRecord(computerId, family, {
    hardware: portableComputerHardware,
    osProfile: "dos",
  });
  registerComputer(record);
  return record;
}
