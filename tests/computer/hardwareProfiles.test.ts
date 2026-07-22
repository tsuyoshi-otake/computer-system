import { describe, expect, it } from "vitest";

import {
  applyPortableComputerProfile,
  applyStationaryComputerProfile,
} from "../../src/application/computer/hardwareProfiles.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import {
  advancedComputerHardware,
  defaultComputerHardware,
  hardwareCpuCyclesPerTick,
  portableComputerHardware,
  requireComputerHardware,
} from "../../src/domain/computer/hardware.js";

describe("Computer hardware profiles", (): void => {
  it("assigns the standard and advanced desktop hardware profiles", (): void => {
    const standard = new ComputerRecord("c-000100", "standard");
    const advanced = new ComputerRecord("c-000105", "advanced");

    expect(standard.hardware).toEqual({
      clockHz: 33_000_000,
      cpuModel: "cs486dx",
      memoryBytes: 2_097_152,
    });
    expect(advanced.hardware).toEqual(advancedComputerHardware);
    expect(advanced.hardware).toEqual({
      clockHz: 66_000_000,
      cpuModel: "cs486dx2",
      memoryBytes: 8_388_608,
    });
    expect(standard.displayProfileId).toBe("desktop-vga-512k");
    expect(standard.display.videoMemoryBytes).toBe(512 * 1_024);
    expect(advanced.displayProfileId).toBe("advanced-vga-512k");
    expect(advanced.display.videoMemoryBytes).toBe(512 * 1_024);
    expect(hardwareCpuCyclesPerTick(standard.hardware.clockHz, 20)).toBe(
      1_650_000,
    );
    expect(hardwareCpuCyclesPerTick(advanced.hardware.clockHz, 20)).toBe(
      3_300_000,
    );
    expect(hardwareCpuCyclesPerTick(standard.hardware.clockHz, 20, 100)).toBe(
      16_500,
    );
    expect(hardwareCpuCyclesPerTick(advanced.hardware.clockHz, 20, 100)).toBe(
      33_000,
    );
    expect(
      hardwareCpuCyclesPerTick(portableComputerHardware.clockHz, 20, 100),
    ).toBe(8_000);
    expect(() => hardwareCpuCyclesPerTick(33_000_000, 20, 0)).toThrow(
      "realtimeDivisor must be a positive integer",
    );
  });

  it("migrates an uncustomized advanced desktop from the former standard profile", (): void => {
    const record = new ComputerRecord("c-000106", "advanced", {
      hardware: {
        clockHz: 33_000_000,
        cpuModel: "cs486dx",
        memoryBytes: 1_048_576,
      },
    });

    expect(applyStationaryComputerProfile(record)).toBe("migrated");
    expect(record.hardware).toEqual(advancedComputerHardware);
    expect(applyStationaryComputerProfile(record)).toBe("unchanged");
  });

  it("migrates the former standard default to 2 MiB without rewriting a customization", (): void => {
    const formerDefault = new ComputerRecord("c-000107", "standard", {
      hardware: {
        clockHz: 33_000_000,
        cpuModel: "cs486dx",
        memoryBytes: 1_048_576,
      },
    });
    const customized = new ComputerRecord("c-000108", "standard", {
      hardware: {
        clockHz: 33_000_000,
        cpuModel: "cs486dx",
        memoryBytes: 3_145_728,
      },
    });

    expect(applyStationaryComputerProfile(formerDefault)).toBe("migrated");
    expect(formerDefault.hardware).toEqual(defaultComputerHardware);
    expect(applyStationaryComputerProfile(formerDefault)).toBe("unchanged");
    expect(applyStationaryComputerProfile(customized)).toBe("unchanged");
    expect(customized.hardware.memoryBytes).toBe(3_145_728);
  });

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
    expect(record.displayProfileId).toBe("portable-vga-256k");
    expect(record.display.videoMemoryBytes).toBe(256 * 1_024);
    expect(hardwareCpuCyclesPerTick(record.hardware.clockHz, 20)).toBe(800_000);
  });

  it("migrates former defaults once and preserves customized records", (): void => {
    const legacy = new ComputerRecord("c-000102", "advanced", {
      hardware: defaultComputerHardware,
    });
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

  it("recognizes a persisted pre-model portable snapshot as the former default", (): void => {
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
    expect(restored.displayProfileId).toBe("portable-vga-256k");
  });

  it("preserves an explicitly customized display profile", (): void => {
    const record = new ComputerRecord("c-000109", "standard", {
      displayProfileId: "portable-vga-256k",
    });

    expect(applyStationaryComputerProfile(record)).toBe("unchanged");
    expect(record.displayProfileId).toBe("portable-vga-256k");
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
