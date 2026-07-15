import {
  EntityComponentTypes,
  ItemStack,
  system,
  world,
  type Player,
} from "@minecraft/server";

import { DynamicPropertyIdentityRepository } from "../adapters/storage/dynamicPropertyIdentityRepository.js";
import { PersistentComputerIdentityService } from "../application/computer/identityPersistence.js";
import {
  applyPortableComputerProfile,
  applyStationaryComputerProfile,
} from "../application/computer/hardwareProfiles.js";
import { ComputerRecord } from "../domain/computer/computer.js";
import { portableComputerHardware } from "../domain/computer/hardware.js";
import type { ComputerFamily } from "../domain/computer/identity.js";
import {
  computerHost,
  registerComputer,
  storageMigration,
} from "./computerHost.js";

export const computerIdentityProperty = "computer_system:computer_id";

let identities: PersistentComputerIdentityService | undefined;
let storageBreakGuardStarted = false;
const storageNotices = new Map<string, string>();
const maximumStorageNotices = 128;

export function identityService(): PersistentComputerIdentityService {
  const status = storageMigration.status;
  if (status.state !== "complete") {
    throw new Error(storageMigrationMessage());
  }
  identities ??= new PersistentComputerIdentityService(
    new DynamicPropertyIdentityRepository(world),
  );
  return identities;
}

export function computerStorageReady(): boolean {
  return storageMigration.status.state === "complete";
}

export function notifyComputerStorageUnavailable(player: Player): boolean {
  const status = storageMigration.status;
  if (status.state === "complete") return false;
  const message = storageMigrationMessage();
  if (storageNotices.get(player.id) !== message) {
    storageNotices.set(player.id, message);
    while (storageNotices.size > maximumStorageNotices) {
      const oldest = storageNotices.keys().next().value;
      if (typeof oldest !== "string") break;
      storageNotices.delete(oldest);
    }
    player.sendMessage(message);
  }
  return true;
}

export function clearComputerStorageNotice(playerId: string): void {
  storageNotices.delete(playerId);
}

/**
 * Reconciles an air block whose physical key is still owned by an older block
 * observation. The displaced Computer is returned as an identity-bearing item
 * before the caller claims the position for the item being placed.
 */
export function recoverStaleComputerPosition(
  player: Player,
  physicalKey: string,
  incomingComputerId: string | undefined,
): boolean {
  const stale = identityService().atPhysicalKey(physicalKey);
  if (stale === undefined) return true;
  if (stale.computerId === incomingComputerId) {
    player.sendMessage("Duplicate computer identity rejected.");
    return false;
  }

  const existing = computerHost.get(stale.computerId);
  const restored =
    existing === undefined ? computerHost.restore(stale.computerId) : undefined;
  const record =
    existing ??
    (restored?.outcome === "registered" ? restored.record : undefined);
  if (record === undefined) {
    const detail =
      restored?.outcome === "failed" ? `: ${restored.error.message}` : "";
    player.sendMessage(
      `Stale Computer ${stale.computerId} could not be recovered${detail}.`,
    );
    return false;
  }

  const released = identityService().break(physicalKey);
  if (released.outcome !== "placed") {
    player.sendMessage(
      `Stale Computer ${stale.computerId} could not release this position.`,
    );
    return false;
  }
  computerHost.serial.disconnectComputer(stale.computerId, "stale_position");
  computerHost.peripherals.clearComputer(stale.computerId);
  giveRecoveredComputerItem(player, record, released.family);
  player.sendMessage(
    `Recovered stale Computer ${stale.computerId} as an item.`,
  );
  return true;
}

export function startComputerStorageBreakGuard(): void {
  if (storageBreakGuardStarted) return;
  storageBreakGuardStarted = true;
  world.beforeEvents.playerBreakBlock.subscribe((event): void => {
    if (
      computerStorageReady() ||
      !isComputerSystemMachine(event.block.typeId)
    ) {
      return;
    }
    event.cancel = true;
    const player = event.player;
    system.run((): void => {
      if (player.isValid) notifyComputerStorageUnavailable(player);
    });
  });
}

function storageMigrationMessage(): string {
  const status = storageMigration.status;
  if (status.state === "failed") {
    return `Computer System storage migration failed: ${status.error.message}`;
  }
  if (status.state === "complete") return "Computer System storage is ready.";
  return `Computer System storage migration in progress (${String(status.completedComputers)}/${String(status.totalComputers)}, ${status.phase}).`;
}

function isComputerSystemMachine(typeId: string): boolean {
  return (
    typeId === "computer_system:portable_computer_block" ||
    typeId.startsWith("computer_system:computer_") ||
    typeId.startsWith("computer_system:advanced_computer_")
  );
}

function giveRecoveredComputerItem(
  player: Player,
  record: ComputerRecord,
  family: ComputerFamily,
): void {
  const portable = record.displayProfileId === "portable-vga-256k";
  const typeId = portable
    ? "computer_system:portable_computer"
    : `computer_system:${family === "advanced" ? "advanced_computer" : "computer"}_item`;
  const item = new ItemStack(typeId, 1);
  item.setDynamicProperty(computerIdentityProperty, record.computerId);
  const inventory = player.getComponent(
    EntityComponentTypes.Inventory,
  )?.container;
  const remainder = inventory === undefined ? item : inventory.addItem(item);
  if (remainder !== undefined) {
    player.dimension.spawnItem(remainder, player.location);
  }
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
    displayProfileId: "portable-vga-256k",
    hardware: portableComputerHardware,
    osProfile: "dos",
  });
  registerComputer(record);
  return record;
}
