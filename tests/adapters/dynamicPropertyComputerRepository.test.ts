import { describe, expect, it } from "vitest";

import { DynamicPropertyComputerRepository } from "../../src/adapters/storage/dynamicPropertyComputerRepository.js";
import { ComputerPersistenceService } from "../../src/application/computer/persistence.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

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
});

class MemoryDynamicProperties {
  readonly values = new Map<string, unknown>();

  getDynamicProperty(identifier: string): unknown {
    return this.values.get(identifier);
  }

  setDynamicProperty(identifier: string, value: string): void {
    this.values.set(identifier, value);
  }
}
