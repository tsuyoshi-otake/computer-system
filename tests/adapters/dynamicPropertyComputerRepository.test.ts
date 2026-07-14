import { describe, expect, it } from "vitest";

import { DynamicPropertyComputerRepository } from "../../src/adapters/storage/dynamicPropertyComputerRepository.js";
import { ComputerPersistenceService } from "../../src/application/computer/persistence.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import type { ComputerSnapshot } from "../../src/domain/computer/computer.js";

describe("DynamicPropertyComputerRepository", (): void => {
  it("pages and restores a computer snapshot using namespaced properties", (): void => {
    const owner = new MemoryDynamicProperties();
    const repository = new DynamicPropertyComputerRepository(owner, {
      pageCharacterLimit: 64,
    });
    const record = new ComputerRecord("computer-11", "advanced");
    record.filesystem.writeFile("/startup.py", "print('persisted')".repeat(20));

    expect(
      new ComputerPersistenceService(repository).saveIfDirty(record),
    ).toEqual({
      outcome: "saved",
      generation: 1,
    });
    const loaded = new ComputerPersistenceService(repository).load(
      "computer-11",
    );
    expect(loaded.outcome).toBe("loaded");
    if (loaded.outcome !== "loaded") return;
    expect(loaded.record.filesystem.readFile("/startup.py")).toBe(
      "print('persisted')".repeat(20),
    );
    expect(loaded.record.displayProfileId).toBe("advanced-vga-512k");
    expect(
      [...owner.values.keys()].filter((key) => key.includes(":page:")).length,
    ).toBeGreaterThan(1);
  });

  it("isolates generations per computer and rejects invalid property values", (): void => {
    const owner = new MemoryDynamicProperties();
    const repository = new DynamicPropertyComputerRepository(owner);
    expect(
      repository.save(new ComputerRecord("computer-12", "standard").snapshot()),
    ).toBe(1);
    expect(
      repository.save(new ComputerRecord("computer-13", "standard").snapshot()),
    ).toBe(1);

    owner.values.set("computer_system:computer:computer-12:head", 4);
    expect(() => repository.load("computer-12")).toThrow(/not a string/u);
    expect(() => repository.load("../unsafe")).toThrow(/Invalid computer ID/u);
  });

  it("rejects an unsupported persisted display profile", (): void => {
    const owner = new MemoryDynamicProperties();
    const repository = new DynamicPropertyComputerRepository(owner);
    const invalid = {
      ...new ComputerRecord("computer-18", "standard").snapshot(),
      displayProfileId: "host-gpu-unbounded",
    } as unknown as ComputerSnapshot;

    repository.save(invalid);
    expect(() => repository.load("computer-18")).toThrow(
      /No complete storage generation/u,
    );
  });
});

class MemoryDynamicProperties {
  readonly values = new Map<string, unknown>();

  getDynamicProperty(identifier: string): unknown {
    return this.values.get(identifier);
  }

  getDynamicPropertyIds(): string[] {
    return [...this.values.keys()];
  }

  setDynamicProperty(identifier: string, value: string | undefined): void {
    if (value === undefined) this.values.delete(identifier);
    else this.values.set(identifier, value);
  }
}
