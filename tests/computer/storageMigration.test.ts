import { describe, expect, it } from "vitest";

import { DynamicPropertyComputerRepository } from "../../src/adapters/storage/dynamicPropertyComputerRepository.js";
import { DynamicPropertyIdentityRepository } from "../../src/adapters/storage/dynamicPropertyIdentityRepository.js";
import { DynamicPropertyStorageMigrationRepository } from "../../src/adapters/storage/dynamicPropertyStorageMigrationRepository.js";
import { ComputerPersistenceService } from "../../src/application/computer/persistence.js";
import {
  ComputerStorageMigrationCoordinator,
  type ComputerStorageMigrationStatus,
} from "../../src/application/computer/storageMigration.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("ComputerStorageMigrationCoordinator", (): void => {
  it("migrates legacy identities and Computers one property operation at a time", (): void => {
    const owner = legacyWorld();
    const coordinator = migration(owner);

    const status = runToTerminal(coordinator, owner);

    expect(status).toEqual({
      state: "complete",
      migratedComputers: 1,
      missingComputers: 0,
      skippedComputers: 0,
      totalComputers: 1,
    });
    expect(owner.values.get("computer_system:identities:head")).toBe("2");
    expect(owner.values.get("computer_system:computer:computer-301:head")).toBe(
      "2",
    );
    expect([...owner.values.keys()].some((key) => key.includes(":blob:"))).toBe(
      true,
    );

    const identities = new DynamicPropertyIdentityRepository(owner).load();
    expect(identities?.observations).toEqual([identityObservation]);
    const restored = new ComputerPersistenceService(
      new DynamicPropertyComputerRepository(owner),
    ).load("computer-301");
    expect(restored.outcome).toBe("loaded");
    if (restored.outcome !== "loaded") return;
    expect(restored.record.filesystem.readFile("/home/data.txt")).toBe(
      "legacy contents",
    );
    expect(restored.record.label).toBe("Legacy portable");
    expect(restored.record.displayProfileId).toBe("portable-vga-256k");
  });

  it("keeps the legacy identity head when a Computer page is corrupt", (): void => {
    const owner = legacyWorld();
    owner.values.set(
      "computer_system:computer:computer-301:page:1:0",
      "corrupt",
    );

    const status = runToTerminal(migration(owner), owner);

    expect(status.state).toBe("failed");
    expect(owner.values.get("computer_system:identities:head")).toBe("1");
    expect(
      owner.values.get("computer_system:identities:manifest:2"),
    ).toBeUndefined();
  });

  it("resumes idempotently after a staged Computer generation commits", (): void => {
    const owner = legacyWorld();
    const first = migration(owner);
    for (let step = 0; step < 2_000; step += 1) {
      const before = owner.operations;
      first.step(1);
      expect(owner.operations - before).toBeLessThanOrEqual(1);
      if (
        owner.values.get("computer_system:computer:computer-301:head") ===
          "2" &&
        owner.values.get("computer_system:identities:head") === "1"
      ) {
        break;
      }
    }
    expect(owner.values.get("computer_system:computer:computer-301:head")).toBe(
      "2",
    );
    expect(owner.values.get("computer_system:identities:head")).toBe("1");

    const resumed = migration(owner);
    const status = runToTerminal(resumed, owner);

    expect(status.state).toBe("complete");
    if (status.state !== "complete") return;
    expect(status.migratedComputers).toBe(0);
    expect(status.skippedComputers).toBe(1);
    expect(owner.values.get("computer_system:identities:head")).toBe("2");
  });

  it("completes a fresh world without creating storage properties", (): void => {
    const owner = new MemoryDynamicProperties();

    const status = runToTerminal(migration(owner), owner);

    expect(status).toEqual({
      state: "complete",
      migratedComputers: 0,
      missingComputers: 0,
      skippedComputers: 0,
      totalComputers: 0,
    });
    expect(owner.values.size).toBe(0);
  });
});

const identityObservation = {
  computerId: "computer-301",
  family: "advanced" as const,
  form: "item" as const,
  physicalKey: "detached:computer-301",
};

function migration(
  owner: MemoryDynamicProperties,
): ComputerStorageMigrationCoordinator {
  return new ComputerStorageMigrationCoordinator(
    new DynamicPropertyStorageMigrationRepository(owner, {
      pageCharacterLimit: 96,
    }),
  );
}

function legacyWorld(): MemoryDynamicProperties {
  const owner = new MemoryDynamicProperties();
  const terminal = new ComputerRecord(
    "computer-301",
    "advanced",
  ).terminal.snapshot();
  seedLegacy(owner, "computer_system:identities", {
    schema: 2,
    observations: [identityObservation],
  });
  seedLegacy(owner, "computer_system:computer:computer-301", {
    schema: 1,
    computerId: "computer-301",
    family: "advanced",
    label: "Legacy portable",
    filesystem: {
      directories: ["/home"],
      files: [["/home/data.txt", "legacy contents"]],
    },
    terminal,
    redstoneOutputMask: 5,
    osProfile: "dos",
    hardware: {
      clockHz: 16_000_000,
      cpuModel: "cs386sx",
      memoryBytes: 2 * 1_048_576,
    },
    displayProfileId: "portable-vga-256k",
  });
  owner.operations = 0;
  return owner;
}

function seedLegacy(
  owner: MemoryDynamicProperties,
  prefix: string,
  value: unknown,
): void {
  const json = JSON.stringify(value);
  const pages: string[] = [];
  for (let offset = 0; offset < json.length; offset += 96) {
    pages.push(json.slice(offset, offset + 96));
  }
  owner.values.set(`${prefix}:head`, "1");
  owner.values.set(
    `${prefix}:manifest:1`,
    JSON.stringify({
      characterLength: json.length,
      checksum: checksum(json),
      generation: 1,
      pageCount: pages.length,
      schema: 1,
    }),
  );
  pages.forEach((page, index) => {
    owner.values.set(`${prefix}:page:1:${String(index)}`, page);
  });
}

function runToTerminal(
  coordinator: ComputerStorageMigrationCoordinator,
  owner: MemoryDynamicProperties,
): ComputerStorageMigrationStatus {
  for (let step = 0; step < 10_000; step += 1) {
    const before = owner.operations;
    const status = coordinator.step(1);
    expect(owner.operations - before).toBeLessThanOrEqual(1);
    if (status.state !== "pending") return status;
  }
  throw new Error("Storage migration did not terminate");
}

function checksum(value: string): string {
  let hash = 0x81_1c_9d_c5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

class MemoryDynamicProperties {
  readonly values = new Map<string, unknown>();
  operations = 0;

  getDynamicProperty(identifier: string): unknown {
    this.operations += 1;
    return this.values.get(identifier);
  }

  getDynamicPropertyIds(): string[] {
    return [...this.values.keys()];
  }

  setDynamicProperty(identifier: string, value: string | undefined): void {
    this.operations += 1;
    if (value === undefined) this.values.delete(identifier);
    else this.values.set(identifier, value);
  }
}
