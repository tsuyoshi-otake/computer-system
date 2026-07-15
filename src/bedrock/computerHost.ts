import { system, world } from "@minecraft/server";

import { DynamicPropertyComputerRepository } from "../adapters/storage/dynamicPropertyComputerRepository.js";
import { ComputerHost } from "../application/computer/computerHost.js";
import { ComputerPersistenceService } from "../application/computer/persistence.js";
import { ComputerRuntime } from "../application/computer/computerRuntime.js";
import { ComputerWorkMonitor } from "../application/runtime/computerWorkMonitor.js";
import type { GameClockSnapshot } from "../application/os/clock.js";
import type { ComputerRecord } from "../domain/computer/computer.js";

const repository = new DynamicPropertyComputerRepository(world);
const persistence = new ComputerPersistenceService(repository);
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
    workMonitor,
  },
);

let started = false;
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

export function registerComputer(record: ComputerRecord): void {
  const result = computerHost.register(record);
  if (result.outcome !== "registered" && result.outcome !== "duplicate") {
    throw result.outcome === "failed"
      ? result.error
      : new Error(`Unable to register ${record.computerId}`);
  }
}
