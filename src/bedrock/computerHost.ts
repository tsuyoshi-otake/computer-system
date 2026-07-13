import { system, world } from "@minecraft/server";

import { DynamicPropertyComputerRepository } from "../adapters/storage/dynamicPropertyComputerRepository.js";
import { ComputerHost } from "../application/computer/computerHost.js";
import { ComputerPersistenceService } from "../application/computer/persistence.js";
import { ComputerRuntime } from "../application/computer/computerRuntime.js";
import type { GameClockSnapshot } from "../application/os/clock.js";
import type { ComputerRecord } from "../domain/computer/computer.js";

const repository = new DynamicPropertyComputerRepository(world);
const persistence = new ComputerPersistenceService(repository);
export const computerHost = new ComputerHost(
  new ComputerRuntime({
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
  },
);

let started = false;

export function startComputerHost(): void {
  if (started) return;
  started = true;
  system.runInterval((): void => computerHost.runTick(), 1);
}

export function registerComputer(record: ComputerRecord): void {
  const result = computerHost.register(record);
  if (result.outcome !== "registered" && result.outcome !== "duplicate") {
    throw result.outcome === "failed"
      ? result.error
      : new Error(`Unable to register ${record.computerId}`);
  }
}
