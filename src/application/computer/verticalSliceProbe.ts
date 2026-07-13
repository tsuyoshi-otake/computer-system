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
  runtime.terminate(record.computerId);
  runtime.runTick();
  const terminatedOff = record.lifecycle.state.kind === "off";
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
