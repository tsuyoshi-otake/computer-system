import { system, world } from "@minecraft/server";

import { DynamicPropertyComputerRepository } from "../adapters/storage/dynamicPropertyComputerRepository.js";
import { DynamicPropertyStorageMigrationRepository } from "../adapters/storage/dynamicPropertyStorageMigrationRepository.js";
import { ComputerHost } from "../application/computer/computerHost.js";
import { ComputerPersistenceService } from "../application/computer/persistence.js";
import { ComputerStorageMigrationCoordinator } from "../application/computer/storageMigration.js";
import { ComputerRuntime } from "../application/computer/computerRuntime.js";
import { ComputerWorkMonitor } from "../application/runtime/computerWorkMonitor.js";
import type { GameClockSnapshot } from "../application/os/clock.js";
import type { ComputerRecord } from "../domain/computer/computer.js";

const repository = new DynamicPropertyComputerRepository(world);
const persistence = new ComputerPersistenceService(repository);
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
    requireLinuxLogin: true,
    clock: {
      currentGameTime: (): GameClockSnapshot => ({
        absoluteTicks: world.getAbsoluteTime(),
        timeOfDay: world.getTimeOfDay(),
      }),
      currentWallTimeMilliseconds: (): number => Date.now(),
    },
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
  },
);

let started = false;
let storageBootstrapStarted = false;
let workMonitorLogTick = 0;
const workMonitorLogIntervalTicks = 20;
const workMonitorLogPrefix = "CS_WORK_MONITOR ";

export function startComputerHost(): void {
  if (started) return;
  started = true;
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
