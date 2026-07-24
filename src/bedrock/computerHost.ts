import { system, world } from "@minecraft/server";

import { DynamicPropertyComputerRepository } from "../adapters/storage/dynamicPropertyComputerRepository.js";
import { DynamicPropertyStorageMigrationRepository } from "../adapters/storage/dynamicPropertyStorageMigrationRepository.js";
import { DynamicPropertyFloppyRepository } from "../adapters/storage/dynamicPropertyFloppyRepository.js";
import { ComputerHost } from "../application/computer/computerHost.js";
import { ComputerPersistenceService } from "../application/computer/persistence.js";
import { ComputerStorageMigrationCoordinator } from "../application/computer/storageMigration.js";
import { ComputerRuntime } from "../application/computer/computerRuntime.js";
import { ComputerWorkMonitor } from "../application/runtime/computerWorkMonitor.js";
import type { GameClockSnapshot } from "../application/os/clock.js";
import type { FloppyDriveActivity } from "../application/os/floppyDrive.js";
import type { ComputerRecord } from "../domain/computer/computer.js";
import { FloppyMediaService } from "../application/computer/floppyMediaService.js";
import { acceptanceFixtureBuild } from "./acceptanceFixture.js";
import { behaviorPackConfig } from "./behaviorPackConfig.js";
import { runtimeWorkerFactory } from "./runtimeWorkerBoundary.js";

const repository = new DynamicPropertyComputerRepository(world);
const persistence = new ComputerPersistenceService(repository);
let floppyIdentitySequence = 0;
let floppyMediaServiceValue: FloppyMediaService | undefined;
let guestFloppyEjectHandler: ((computerId: string) => void) | undefined;
let floppyActivityHandler:
  ((computerId: string, activity: FloppyDriveActivity) => void) | undefined;
export const storageMigration = new ComputerStorageMigrationCoordinator(
  new DynamicPropertyStorageMigrationRepository(world),
);
let lastWorkClockMicroseconds = 0;
const workMonitor = new ComputerWorkMonitor({
  nowMicroseconds: (): number => {
    lastWorkClockMicroseconds = Math.max(
      lastWorkClockMicroseconds,
      Date.now() * 1_000,
    );
    return lastWorkClockMicroseconds;
  },
});
export const computerHost = new ComputerHost(
  new ComputerRuntime({
    collectMicroarchitectureStatsByDefault:
      behaviorPackConfig.collectMicroarchitectureStatsByDefault,
    requireLinuxLogin: !acceptanceFixtureBuild,
    guestRealtimeDivisor: behaviorPackConfig.guestRealtimeDivisor,
    clock: {
      currentGameTime: (): GameClockSnapshot => ({
        absoluteTicks: world.getAbsoluteTime(),
        timeOfDay: world.getTimeOfDay(),
      }),
      currentWallTimeMilliseconds: (): number => Date.now(),
    },
    hostElapsedMilliseconds: (): number => Date.now(),
    remoteCs486ProcessFactory: runtimeWorkerFactory(),
  }),
  persistence,
  {
    maxPersistenceChecksPerTick: 4,
    onPersistenceFailure: (computerId, error): void => {
      console.warn(
        `Computer ${computerId} persistence failed: ${error.message}`,
      );
    },
    storageMigration,
    workMonitor,
    saveFloppy: (_computerId, media): void => {
      const result = floppyMediaService().save(media);
      if (result.outcome === "failed") throw result.error;
      if (result.outcome === "missing")
        throw new Error(`Floppy media ${result.mediaId} is not cataloged`);
    },
    onGuestFloppyEject: (computerId): void => {
      if (guestFloppyEjectHandler === undefined)
        throw new Error("Guest Floppy eject handler is unavailable");
      guestFloppyEjectHandler(computerId);
    },
    onFloppyActivity: (computerId, activity): void =>
      floppyActivityHandler?.(computerId, activity),
  },
);

export function setGuestFloppyEjectHandler(
  handler: (computerId: string) => void,
): void {
  guestFloppyEjectHandler = handler;
}

export function floppyMediaService(): FloppyMediaService {
  if (floppyMediaServiceValue === undefined)
    throw new Error("Floppy media storage is not ready");
  return floppyMediaServiceValue;
}

export function setFloppyActivityHandler(
  handler: (computerId: string, activity: FloppyDriveActivity) => void,
): void {
  floppyActivityHandler = handler;
}

function allocateFloppyMediaId(): string {
  floppyIdentitySequence =
    floppyIdentitySequence === Number.MAX_SAFE_INTEGER
      ? 1
      : floppyIdentitySequence + 1;
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let value = fnv32(`${String(Date.now())}:${String(floppyIdentitySequence)}`);
  let suffix = "";
  for (let index = 0; index < 8; index += 1) {
    suffix += alphabet[value & 31]!;
    value = (Math.imul(value, 1_664_525) + 1_013_904_223) >>> 0;
  }
  return `f-${suffix}`;
}

function fnv32(value: string): number {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

let started = false;
let storageBootstrapStarted = false;
let workMonitorLogTick = 0;
const workMonitorLogIntervalTicks = 20;
const workMonitorLogPrefix = "CS_WORK_MONITOR ";

export function startComputerHost(): void {
  if (started) return;
  started = true;
  floppyMediaServiceValue = new FloppyMediaService(
    new DynamicPropertyFloppyRepository(world),
    allocateFloppyMediaId,
  );
  system.runInterval((): void => {
    computerHost.runTick();
    workMonitorLogTick += 1;
    if (workMonitorLogTick % workMonitorLogIntervalTicks === 0) {
      const snapshot = computerHost.workMetrics();
      if (snapshot !== undefined) {
        console.warn(`${workMonitorLogPrefix}${JSON.stringify(snapshot)}`);
      }
    }
  }, 1);
}

export function startComputerStorageBootstrap(onReady: () => void): void {
  if (storageBootstrapStarted) return;
  storageBootstrapStarted = true;
  let migrationAnnounced = false;
  let lastLogSignature = "";
  const intervalId = system.runInterval((): void => {
    const status = storageMigration.status;
    const signature = JSON.stringify(status, (_key, value: unknown) =>
      value instanceof Error ? value.message : value,
    );
    if (signature !== lastLogSignature) {
      lastLogSignature = signature;
      console.warn(`CS_STORAGE_MIGRATION ${signature}`);
    }
    if (
      status.state === "pending" &&
      status.totalComputers > 0 &&
      !migrationAnnounced
    ) {
      migrationAnnounced = true;
      world.sendMessage(
        `Computer System storage migration started (0/${String(status.totalComputers)}).`,
      );
      return;
    }
    if (status.state === "pending") return;

    system.clearRun(intervalId);
    if (status.state === "failed") {
      world.sendMessage(
        `Computer System storage migration failed: ${status.error.message}`,
      );
      return;
    }
    if (migrationAnnounced) {
      world.sendMessage(
        `Computer System storage migration complete (${String(status.totalComputers)}/${String(status.totalComputers)}).`,
      );
    }
    try {
      onReady();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Computer System post-migration startup failed: ${message}`);
      world.sendMessage(`Computer System startup failed: ${message}`);
    }
  }, 1);
}

export function registerComputer(record: ComputerRecord): void {
  const result = computerHost.register(record);
  if (result.outcome !== "registered" && result.outcome !== "duplicate") {
    throw result.outcome === "failed"
      ? result.error
      : new Error(`Unable to register ${record.computerId}`);
  }
}
