import { describe, expect, it } from "vitest";

import { applyPortableComputerProfile } from "../../src/application/computer/hardwareProfiles.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import {
  defaultComputerHardware,
  hardwareCpuCyclesPerTick,
  portableComputerHardware,
  requireComputerHardware,
} from "../../src/domain/computer/hardware.js";

describe("Computer hardware profiles", (): void => {
  it("configures new portable records as DOS CS386SX machines", (): void => {
    const record = new ComputerRecord("c-000101", "advanced");

    expect(applyPortableComputerProfile(record, true)).toBe("configured");
    expect(record.osProfile).toBe("dos");
    expect(record.hardware).toEqual(portableComputerHardware);
    expect(record.hardware).toEqual({
      clockHz: 16_000_000,
      cpuModel: "cs386sx",
      memoryBytes: 2_097_152,
    });
    expect(hardwareCpuCyclesPerTick(record.hardware.clockHz, 20)).toBe(800_000);
  });

  it("migrates former defaults once and preserves customized records", (): void => {
    const legacy = new ComputerRecord("c-000102", "advanced");
    expect(legacy.hardware).toEqual(defaultComputerHardware);

    expect(applyPortableComputerProfile(legacy)).toBe("migrated");
    const migratedRevision = legacy.persistenceRevision;
    expect(applyPortableComputerProfile(legacy)).toBe("unchanged");
    expect(legacy.persistenceRevision).toBe(migratedRevision);

    const customized = new ComputerRecord("c-000103", "advanced", {
      hardware: {
        clockHz: 20_000_000,
        cpuModel: "cs486dx",
        memoryBytes: 3_145_728,
      },
    });
    expect(applyPortableComputerProfile(customized)).toBe("unchanged");
    expect(customized.osProfile).toBe("linux");
    expect(customized.hardware.clockHz).toBe(20_000_000);
  });

  it("recognizes a persisted pre-model Pocket snapshot as the former default", (): void => {
    const snapshot = new ComputerRecord("c-000104", "advanced").snapshot();
    const restored = ComputerRecord.restore({
      ...snapshot,
      hardware: { clockHz: 33_000_000, memoryBytes: 1_048_576 },
      osProfile: "linux",
    });

    expect(restored.hardware.cpuModel).toBe("cs486dx");
    expect(applyPortableComputerProfile(restored)).toBe("migrated");
    expect(restored.osProfile).toBe("dos");
    expect(restored.hardware).toEqual(portableComputerHardware);
  });

  it("enforces the 386SX 24-bit physical address ceiling", (): void => {
    expect(() =>
      requireComputerHardware({
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 16 * 1_048_576 + 1,
      }),
    ).toThrow(/16777216 bytes for cs386sx/u);
  });
});
