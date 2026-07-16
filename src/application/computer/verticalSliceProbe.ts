import { ComputerRecord } from "../../domain/computer/computer.js";
import {
  PersistentComputerIdentityService,
  type ComputerIdentityRepository,
} from "./identityPersistence.js";
import {
  ComputerPersistenceService,
  type ComputerSnapshotRepository,
} from "./persistence.js";
import { ComputerRuntime } from "./computerRuntime.js";

const probeComputerId = "computer-900000";
const probePhysicalKey = "probe:computer-block";
const startupSource = `
import redstone
redstone.set_output("right", redstone.get_input("left"))
while True:
    pass
`;

export interface VerticalSliceProbeResult {
  readonly computerId: string;
  readonly identityStable: boolean;
  readonly loadedSnapshot: boolean;
  readonly outputMask: number;
  readonly startupPresent: boolean;
  readonly terminatedOff: boolean;
}

export function runVerticalSliceProbe(
  identityRepository: ComputerIdentityRepository,
  snapshotRepository: ComputerSnapshotRepository,
): VerticalSliceProbeResult {
  const identities = new PersistentComputerIdentityService(identityRepository);
  const previous = identities.observation(probeComputerId);
  const placed =
    previous?.form === "block"
      ? { outcome: "placed" as const, computerId: probeComputerId }
      : identities.place(
          probePhysicalKey,
          "standard",
          previous === undefined ? probeComputerId : previous.computerId,
        );
  if (placed.outcome !== "placed") {
    throw new Error(
      "Vertical-slice probe identity was rejected as a duplicate",
    );
  }

  const persistence = new ComputerPersistenceService(snapshotRepository);
  const loaded = persistence.load(probeComputerId);
  const loadedSnapshot = loaded.outcome === "loaded";
  if (loaded.outcome === "failed") throw loaded.error;
  const record =
    loaded.outcome === "loaded"
      ? loaded.record
      : new ComputerRecord(probeComputerId, "standard");
  if (!record.filesystem.exists("/startup.py")) {
    record.filesystem.writeFile("/startup.py", startupSource);
  }
  record.redstone.setInput("left", 15);

  const runtime = new ComputerRuntime();
  runtime.configureLifecycleBoundaries({
    pendingFilesystemIo: (): number => 0,
    stopDevices: (): void => undefined,
    syncPersistence: (computerId) => {
      if (computerId !== record.computerId) {
        return { outcome: "missing" as const, computerId };
      }
      const result = persistence.saveIfDirty(record);
      if (result.outcome === "failed") {
        return { outcome: "failed" as const, error: result.error };
      }
      if (result.outcome === "saved") {
        return { outcome: "saved" as const, generation: result.generation };
      }
      if (result.outcome === "unchanged") {
        return { outcome: "unchanged" as const };
      }
      return {
        outcome: "failed" as const,
        error: new Error(
          `probe persistence returned unexpected ${result.outcome} outcome`,
        ),
      };
    },
  });
  runtime.register(record);
  const power = runtime.powerOn(record.computerId);
  if (power.outcome !== "accepted") {
    const reason =
      power.outcome === "failed"
        ? power.error.message
        : power.outcome === "ignored"
          ? power.reason
          : `missing ${power.computerId}`;
    throw new Error(`Probe computer did not boot: ${reason}`);
  }
  runtime.runTick();
  const outputMask = record.redstone.outputMask;
  const termination = runtime.terminate(record.computerId);
  const terminatedOff =
    termination.outcome === "accepted" && runUntilOff(runtime, record, 64);
  const saved = persistence.saveIfDirty(record);
  if (saved.outcome === "failed") throw saved.error;

  const broken = identities.break(probePhysicalKey);
  if (broken.outcome !== "placed")
    throw new Error("Probe computer identity did not return to item form");
  return {
    computerId: record.computerId,
    identityStable: broken.computerId === probeComputerId,
    loadedSnapshot,
    outputMask,
    startupPresent: record.filesystem.exists("/startup.py"),
    terminatedOff,
  };
}

function runUntilOff(
  runtime: ComputerRuntime,
  record: ComputerRecord,
  maximumTicks: number,
): boolean {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    if (
      record.lifecycle.state.kind === "off" &&
      record.display.state.kind === "off"
    ) {
      return true;
    }
    runtime.runTick();
  }
  return (
    record.lifecycle.state.kind === "off" && record.display.state.kind === "off"
  );
}
