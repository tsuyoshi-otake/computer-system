import { describe, expect, it } from "vitest";

import { DynamicPropertyComputerRepository } from "../../src/adapters/storage/dynamicPropertyComputerRepository.js";
import { DynamicPropertyIdentityRepository } from "../../src/adapters/storage/dynamicPropertyIdentityRepository.js";
import { DynamicPropertyStorageMigrationRepository } from "../../src/adapters/storage/dynamicPropertyStorageMigrationRepository.js";
import type { ComputerIdentitySnapshot } from "../../src/application/computer/identityPersistence.js";
import { ComputerPersistenceService } from "../../src/application/computer/persistence.js";
import {
  ComputerStorageMigrationCoordinator,
  type ComputerStorageMigrationStatus,
  type MigrationLoadStepResult,
  type MigrationLoadTransaction,
} from "../../src/application/computer/storageMigration.js";
import { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
import {
  ComputerRecord,
  type ComputerSnapshot,
} from "../../src/domain/computer/computer.js";

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

  it("scans current identities, resumes payload migration, and leaves the identity generation unchanged", (): void => {
    const owner = currentIdentityWorld();
    const first = migration(owner);
    for (let step = 0; step < 2_000; step += 1) {
      const before = owner.operations;
      first.step(1);
      expect(owner.operations - before).toBeLessThanOrEqual(1);
      if (
        owner.values.get("computer_system:computer:computer-302:head") === "2"
      ) {
        break;
      }
    }
    expect(owner.values.get("computer_system:computer:computer-302:head")).toBe(
      "2",
    );
    expect(owner.values.get("computer_system:identities:head")).toBe("1");
    expect(
      owner.values.get("computer_system:identities:manifest:2"),
    ).toBeUndefined();

    const resumedStatus = runToTerminal(migration(owner), owner);

    expect(resumedStatus).toEqual({
      state: "complete",
      migratedComputers: 1,
      missingComputers: 0,
      skippedComputers: 1,
      totalComputers: 2,
    });
    expect(owner.values.get("computer_system:identities:head")).toBe("1");
    expect(owner.values.get("computer_system:computer:computer-303:head")).toBe(
      "2",
    );

    const persistence = new ComputerPersistenceService(
      new DynamicPropertyComputerRepository(owner),
    );
    const dos = persistence.load("computer-302");
    expect(dos.outcome).toBe("loaded");
    if (dos.outcome !== "loaded") return;
    expect(dos.record.dosRuntimeSnapshot).toMatchObject({
      fatMetadata: [],
      schema: 1,
    });
    const linux = persistence.load("computer-303");
    expect(linux.outcome).toBe("loaded");
    if (linux.outcome !== "loaded") return;
    expect(linux.record.osRuntimeSnapshot).toMatchObject({
      lifecycle: { phase: "off" },
      processes: [],
      schema: 1,
    });

    const idempotentStatus = runToTerminal(migration(owner), owner);
    expect(idempotentStatus).toEqual({
      state: "complete",
      migratedComputers: 0,
      missingComputers: 0,
      skippedComputers: 2,
      totalComputers: 2,
    });
    expect(owner.values.get("computer_system:identities:head")).toBe("1");
    expect(owner.values.get("computer_system:computer:computer-302:head")).toBe(
      "2",
    );
    expect(owner.values.get("computer_system:computer:computer-303:head")).toBe(
      "2",
    );
  });

  it("repairs a corrupt current-format Computer head from its valid previous generation", (): void => {
    const { identities, owner, snapshot } = corruptCurrentComputerHeadWorld();

    const status = runToTerminal(migration(owner), owner);

    expect(status).toEqual({
      state: "complete",
      migratedComputers: 1,
      missingComputers: 0,
      skippedComputers: 0,
      totalComputers: 1,
    });
    expect(owner.values.get("computer_system:computer:computer-305:head")).toBe(
      "2",
    );
    expect(computerManifestGenerations(owner, snapshot.computerId)).toEqual([
      1, 2,
    ]);
    const repaired = runLoadToTerminal(
      new DynamicPropertyStorageMigrationRepository(owner, {
        pageCharacterLimit: 96,
      }).beginLoadComputer(snapshot.computerId),
      owner,
    );
    expect(repaired).toMatchObject({
      generation: 2,
      outcome: "complete",
      recovered: false,
      sourceFormat: "content_addressed_blobs",
    });
    expect(repaired.value).toEqual(snapshot);
    expect(new DynamicPropertyIdentityRepository(owner, 96).load()).toEqual(
      identities,
    );

    owner.writes.length = 0;
    const idempotentStatus = runToTerminal(migration(owner), owner);
    expect(idempotentStatus).toEqual({
      state: "complete",
      migratedComputers: 0,
      missingComputers: 0,
      skippedComputers: 1,
      totalComputers: 1,
    });
    expect(owner.writes).toEqual([]);
    expect(
      new DynamicPropertyComputerRepository(owner, {
        pageCharacterLimit: 96,
      }).load(snapshot.computerId),
    ).toEqual(snapshot);
  });

  it("repairs a corrupt current-format identity head before activation", (): void => {
    const { identities, owner, snapshot } = corruptCurrentIdentityHeadWorld();

    const status = runToTerminal(migration(owner), owner);

    expect(status).toEqual({
      state: "complete",
      migratedComputers: 0,
      missingComputers: 0,
      skippedComputers: 1,
      totalComputers: 1,
    });
    expect(owner.values.get("computer_system:identities:head")).toBe("2");
    expect(identityManifestGenerations(owner)).toEqual([1, 2]);
    const repaired = runLoadToTerminal(
      new DynamicPropertyStorageMigrationRepository(owner, {
        pageCharacterLimit: 96,
      }).beginLoadIdentities(),
      owner,
    );
    expect(repaired).toMatchObject({
      generation: 2,
      outcome: "complete",
      recovered: false,
      sourceFormat: "content_addressed_blobs",
    });
    expect(repaired.value).toEqual(identities);
    expect(
      (repaired.value as ComputerIdentitySnapshot).observations.map(
        ({ computerId }) => computerId,
      ),
    ).toEqual([snapshot.computerId]);
    expect(
      new DynamicPropertyComputerRepository(owner, {
        pageCharacterLimit: 96,
      }).load(snapshot.computerId),
    ).toEqual(snapshot);

    owner.writes.length = 0;
    const idempotentStatus = runToTerminal(migration(owner), owner);
    expect(idempotentStatus).toEqual({
      state: "complete",
      migratedComputers: 0,
      missingComputers: 0,
      skippedComputers: 1,
      totalComputers: 1,
    });
    expect(owner.writes).toEqual([]);
    expect(new DynamicPropertyIdentityRepository(owner, 96).load()).toEqual(
      identities,
    );
  });

  it("repairs a corrupt previous manifest without changing the canonical head", (): void => {
    const { currentManifest, owner, snapshot } =
      corruptPreviousComputerManifestWorld();
    expect(computerManifestGenerations(owner, snapshot.computerId)).toEqual([
      1, 2, 3,
    ]);

    const status = runToTerminal(migration(owner), owner);

    expect(status).toEqual({
      state: "complete",
      migratedComputers: 0,
      missingComputers: 0,
      skippedComputers: 1,
      totalComputers: 1,
    });
    expect(
      owner.values.get(`computer_system:computer:${snapshot.computerId}:head`),
    ).toBe("3");
    expect(
      owner.values.get(
        `computer_system:computer:${snapshot.computerId}:manifest:3`,
      ),
    ).toBe(currentManifest);
    expect(computerManifestGenerations(owner, snapshot.computerId)).toEqual([
      2, 3,
    ]);
    expect(
      [...owner.values.keys()].some((key) =>
        key.startsWith(
          `computer_system:computer:${snapshot.computerId}:page:2:`,
        ),
      ),
    ).toBe(false);
    const canonical = runLoadToTerminal(
      new DynamicPropertyStorageMigrationRepository(owner, {
        pageCharacterLimit: 96,
      }).beginLoadComputer(snapshot.computerId),
      owner,
    );
    expect(canonical).toMatchObject({
      generation: 3,
      recovered: false,
    });
    expect(JSON.stringify(canonical.value)).toBe(JSON.stringify(snapshot));

    owner.values.set(
      `computer_system:computer:${snapshot.computerId}:manifest:3`,
      "corrupt",
    );
    const fallback = runLoadToTerminal(
      new DynamicPropertyStorageMigrationRepository(owner, {
        pageCharacterLimit: 96,
      }).beginLoadComputer(snapshot.computerId),
      owner,
    );
    expect(fallback).toMatchObject({
      generation: 2,
      recovered: true,
    });
    expect(JSON.stringify(fallback.value)).toBe(JSON.stringify(snapshot));
    owner.values.set(
      `computer_system:computer:${snapshot.computerId}:manifest:3`,
      currentManifest,
    );

    owner.writes.length = 0;
    const idempotentStatus = runToTerminal(migration(owner), owner);
    expect(idempotentStatus).toEqual(status);
    expect(owner.writes).toEqual([]);
    expect(
      owner.values.get(`computer_system:computer:${snapshot.computerId}:head`),
    ).toBe("3");
  });

  it("resumes post-commit cleanup without rewriting a canonical generation", (): void => {
    const owner = cleanupRestartWorld();
    const first = migration(owner);
    for (let step = 0; step < 2_000; step += 1) {
      const before = owner.operations;
      first.step(1);
      expect(owner.operations - before).toBeLessThanOrEqual(1);
      if (
        owner.values.get("computer_system:computer:computer-304:head") === "3"
      ) {
        break;
      }
    }
    expect(owner.values.get("computer_system:computer:computer-304:head")).toBe(
      "3",
    );
    expect(
      owner.values.get("computer_system:computer:computer-304:manifest:1"),
    ).toBeDefined();
    expect(
      owner.values.get("computer_system:identities:manifest:1"),
    ).toBeDefined();
    const committedManifest = owner.values.get(
      "computer_system:computer:computer-304:manifest:3",
    );
    const retainedPageIds = new Set([
      ...manifestPageIds(owner, "computer-304", 2),
      ...manifestPageIds(owner, "computer-304", 3),
    ]);
    const obsoleteBlobIds = manifestPageIds(owner, "computer-304", 1).filter(
      (pageId) => !retainedPageIds.has(pageId),
    );
    expect(obsoleteBlobIds.length).toBeGreaterThan(0);
    owner.writes.length = 0;

    const resumedStatus = runToTerminal(migration(owner), owner);

    expect(resumedStatus).toEqual({
      state: "complete",
      migratedComputers: 0,
      missingComputers: 0,
      skippedComputers: 1,
      totalComputers: 1,
    });
    expect(owner.values.get("computer_system:computer:computer-304:head")).toBe(
      "3",
    );
    expect(
      owner.values.get("computer_system:computer:computer-304:manifest:3"),
    ).toBe(committedManifest);
    expect(computerManifestGenerations(owner, "computer-304")).toEqual([2, 3]);
    expect(identityManifestGenerations(owner)).toEqual([2, 3]);
    expect(owner.writes).not.toContain(
      "computer_system:computer:computer-304:head",
    );
    expect(owner.writes).not.toContain(
      "computer_system:computer:computer-304:manifest:3",
    );
    expect(owner.writes).toContain(
      "computer_system:computer:computer-304:manifest:1",
    );
    expect(owner.writes).toContain("computer_system:identities:manifest:1");
    for (const pageId of obsoleteBlobIds) {
      expect(
        owner.values.get(
          `computer_system:computer:computer-304:blob:${pageId}`,
        ),
      ).toBeUndefined();
    }

    owner.writes.length = 0;
    const idempotentStatus = runToTerminal(migration(owner), owner);
    expect(idempotentStatus).toEqual(resumedStatus);
    expect(computerManifestGenerations(owner, "computer-304")).toEqual([2, 3]);
    expect(identityManifestGenerations(owner)).toEqual([2, 3]);
    expect(owner.writes).toEqual([]);
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

function currentIdentityWorld(): MemoryDynamicProperties {
  const owner = new MemoryDynamicProperties();
  const computerRepository = new DynamicPropertyComputerRepository(owner, {
    pageCharacterLimit: 96,
  });
  const dos = new ComputerRecord("computer-302", "standard", {
    osProfile: "dos",
  }).snapshot();
  const linux = new ComputerRecord("computer-303", "standard", {
    osProfile: "linux",
  }).snapshot();
  const runtime = new OsRuntimeState(linux.computerId);
  runtime.transitionLifecycle({ kind: "begin_boot", tick: 1 });
  runtime.createInitProcess({
    command: "/sbin/cs-init",
    gid: 0,
    startTick: 1,
    state: "running",
    uid: 0,
  });
  runtime.transitionLifecycle({ kind: "boot_complete", tick: 2 });
  computerRepository.save(dos);
  computerRepository.save({ ...linux, osRuntime: runtime.snapshot() });
  new DynamicPropertyIdentityRepository(owner, 96).save({
    schema: 2,
    observations: [
      {
        computerId: dos.computerId,
        family: dos.family,
        form: "block",
        physicalKey: "overworld:1:2:3",
      },
      {
        computerId: linux.computerId,
        family: linux.family,
        form: "block",
        physicalKey: "overworld:4:5:6",
      },
    ],
  });
  owner.operations = 0;
  return owner;
}

function corruptCurrentComputerHeadWorld(): {
  readonly identities: ComputerIdentitySnapshot;
  readonly owner: MemoryDynamicProperties;
  readonly snapshot: ComputerSnapshot;
} {
  const owner = new MemoryDynamicProperties();
  const computerRepository = new DynamicPropertyComputerRepository(owner, {
    pageCharacterLimit: 96,
  });
  const snapshot = new ComputerRecord("computer-305", "advanced", {
    label: "Recovered Computer payload",
  }).snapshot();
  computerRepository.save(snapshot);
  computerRepository.save({
    ...snapshot,
    label: "Discarded corrupt-head payload",
  });
  const identities: ComputerIdentitySnapshot = {
    schema: 2,
    observations: [
      {
        computerId: snapshot.computerId,
        family: snapshot.family,
        form: "block",
        physicalKey: "overworld:10:11:12",
      },
    ],
  };
  new DynamicPropertyIdentityRepository(owner, 96).save(identities);
  owner.values.set(
    `computer_system:computer:${snapshot.computerId}:manifest:2`,
    "corrupt",
  );
  owner.operations = 0;
  owner.writes.length = 0;
  return { identities, owner, snapshot };
}

function corruptCurrentIdentityHeadWorld(): {
  readonly identities: ComputerIdentitySnapshot;
  readonly owner: MemoryDynamicProperties;
  readonly snapshot: ComputerSnapshot;
} {
  const owner = new MemoryDynamicProperties();
  const snapshot = new ComputerRecord("computer-306", "standard", {
    label: "Identity recovery Computer",
  }).snapshot();
  new DynamicPropertyComputerRepository(owner, {
    pageCharacterLimit: 96,
  }).save(snapshot);
  const identities: ComputerIdentitySnapshot = {
    schema: 2,
    observations: [
      {
        computerId: snapshot.computerId,
        family: snapshot.family,
        form: "item",
        physicalKey: `detached:${snapshot.computerId}`,
      },
    ],
  };
  const identityRepository = new DynamicPropertyIdentityRepository(owner, 96);
  identityRepository.save(identities);
  identityRepository.save({
    schema: 2,
    observations: [
      {
        ...identities.observations[0]!,
        physicalKey: "overworld:13:14:15",
      },
    ],
  });
  owner.values.set("computer_system:identities:manifest:2", "corrupt");
  owner.operations = 0;
  owner.writes.length = 0;
  return { identities, owner, snapshot };
}

function corruptPreviousComputerManifestWorld(): {
  readonly currentManifest: string;
  readonly owner: MemoryDynamicProperties;
  readonly snapshot: ComputerSnapshot;
} {
  const owner = new MemoryDynamicProperties();
  const computerRepository = new DynamicPropertyComputerRepository(owner, {
    pageCharacterLimit: 96,
  });
  const first = new ComputerRecord("computer-307", "standard", {
    label: "Generation one",
  }).snapshot();
  computerRepository.save(first);
  computerRepository.save({ ...first, label: "Generation two" });
  const snapshot = { ...first, label: "Canonical generation three" };
  const stagedSave = computerRepository.beginSave(snapshot);
  for (let step = 0; step < 10_000; step += 1) {
    stagedSave.step(1);
    if (
      owner.values.get(
        `computer_system:computer:${snapshot.computerId}:head`,
      ) === "3"
    ) {
      break;
    }
    if (step === 9_999) throw new Error("Test generation three did not commit");
  }
  const manifestKey = `computer_system:computer:${snapshot.computerId}:manifest:3`;
  const currentManifest = owner.values.get(manifestKey);
  if (typeof currentManifest !== "string") {
    throw new Error("Test generation three manifest is missing");
  }
  owner.values.set(
    `computer_system:computer:${snapshot.computerId}:manifest:2`,
    "corrupt",
  );
  for (let index = 0; index < 5; index += 1) {
    owner.values.set(
      `computer_system:computer:${snapshot.computerId}:page:2:${String(index)}`,
      `unreachable legacy page ${String(index)}`,
    );
  }
  new DynamicPropertyIdentityRepository(owner, 96).save({
    schema: 2,
    observations: [
      {
        computerId: snapshot.computerId,
        family: snapshot.family,
        form: "block",
        physicalKey: "overworld:16:17:18",
      },
    ],
  });
  owner.operations = 0;
  owner.writes.length = 0;
  return { currentManifest, owner, snapshot };
}

function cleanupRestartWorld(): MemoryDynamicProperties {
  const owner = new MemoryDynamicProperties();
  const computerRepository = new DynamicPropertyComputerRepository(owner, {
    pageCharacterLimit: 96,
  });
  const first = new ComputerRecord("computer-304", "standard", {
    label: "Generation one",
    osProfile: "dos",
  }).snapshot();
  computerRepository.save(first);
  computerRepository.save({ ...first, label: "Generation two" });
  const identitySnapshot = {
    schema: 2,
    observations: [
      {
        computerId: first.computerId,
        family: first.family,
        form: "block",
        physicalKey: "overworld:7:8:9",
      },
    ],
  } as const;
  const identityRepository = new DynamicPropertyIdentityRepository(owner, 96);
  identityRepository.save(identitySnapshot);
  identityRepository.save(identitySnapshot);
  const stagedIdentitySave = new DynamicPropertyStorageMigrationRepository(
    owner,
    { pageCharacterLimit: 96 },
  ).beginSaveIdentities(identitySnapshot, 2);
  for (let step = 0; step < 2_000; step += 1) {
    stagedIdentitySave.step(1);
    if (owner.values.get("computer_system:identities:head") === "3") break;
  }
  if (owner.values.get("computer_system:identities:head") !== "3") {
    throw new Error("Test identity save did not reach its commit window");
  }
  owner.operations = 0;
  owner.writes.length = 0;
  return owner;
}

function computerManifestGenerations(
  owner: MemoryDynamicProperties,
  computerId: string,
): number[] {
  const prefix = `computer_system:computer:${computerId}:manifest:`;
  return [...owner.values.keys()]
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
    .sort((left, right) => left - right);
}

function identityManifestGenerations(owner: MemoryDynamicProperties): number[] {
  const prefix = "computer_system:identities:manifest:";
  return [...owner.values.keys()]
    .filter((key) => key.startsWith(prefix))
    .map((key) => Number(key.slice(prefix.length)))
    .sort((left, right) => left - right);
}

function manifestPageIds(
  owner: MemoryDynamicProperties,
  computerId: string,
  generation: number,
): string[] {
  const text = owner.values.get(
    `computer_system:computer:${computerId}:manifest:${String(generation)}`,
  );
  if (typeof text !== "string") throw new Error("Test manifest is missing");
  const manifest = JSON.parse(text) as { readonly pageIds?: unknown };
  if (
    !Array.isArray(manifest.pageIds) ||
    !manifest.pageIds.every((pageId) => typeof pageId === "string")
  ) {
    throw new Error("Test manifest has no page IDs");
  }
  return manifest.pageIds;
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

type CompletedMigrationLoad = Extract<
  MigrationLoadStepResult<unknown>,
  { readonly outcome: "complete" }
>;

function runLoadToTerminal(
  transaction: MigrationLoadTransaction<unknown>,
  owner: MemoryDynamicProperties,
): CompletedMigrationLoad {
  for (let step = 0; step < 10_000; step += 1) {
    const before = owner.operations;
    const result = transaction.step(1);
    expect(owner.operations - before).toBeLessThanOrEqual(1);
    if (result.outcome === "complete") return result;
    if (result.outcome === "missing") {
      throw new Error("Migration test load unexpectedly found no value");
    }
  }
  throw new Error("Migration test load did not terminate");
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
  readonly writes: string[] = [];
  operations = 0;

  getDynamicProperty(identifier: string): unknown {
    this.operations += 1;
    return this.values.get(identifier);
  }

  getDynamicPropertyIds(): string[] {
    this.operations += 1;
    return [...this.values.keys()];
  }

  setDynamicProperty(identifier: string, value: string | undefined): void {
    this.operations += 1;
    this.writes.push(identifier);
    if (value === undefined) this.values.delete(identifier);
    else this.values.set(identifier, value);
  }
}
