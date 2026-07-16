import { describe, expect, it } from "vitest";

import { DynamicPropertyFloppyRepository } from "../../src/adapters/storage/dynamicPropertyFloppyRepository.js";
import { FloppyMediaService } from "../../src/application/computer/floppyMediaService.js";

describe("DynamicPropertyFloppyRepository", (): void => {
  it("transactionally pages a catalog and independent FAT12 media", (): void => {
    const owner = new MemoryDynamicProperties();
    const repository = new DynamicPropertyFloppyRepository(owner, 64);
    const ids = ["f-01234567", "f-12345678"];
    const service = new FloppyMediaService(repository, () => ids.shift()!);
    const first = service.create();
    const second = service.create();
    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("created");
    if (first.outcome !== "created") return;

    first.media.format({
      bootable: true,
      modifiedAtMilliseconds: Date.UTC(2026, 0, 1),
      volumeLabel: "BOOT",
    });
    expect(service.save(first.media).outcome).toBe("loaded");

    const restored = new FloppyMediaService(
      new DynamicPropertyFloppyRepository(owner, 64),
      () => "f-23456789",
    );
    expect(restored.mediaCount()).toBe(2);
    const loaded = restored.load("f-01234567");
    expect(loaded.outcome).toBe("loaded");
    if (loaded.outcome !== "loaded") return;
    expect(loaded.media.bootable).toBe(true);
    expect(loaded.media.volumeLabel).toBe("BOOT");
    expect(
      [...owner.values.keys()].filter((key) => key.includes(":blob:")).length,
    ).toBeGreaterThan(2);
  });

  it("rejects duplicate/stale instances and rolls insertion back if persistence fails", (): void => {
    const owner = new MemoryDynamicProperties();
    const repository = new DynamicPropertyFloppyRepository(owner);
    const service = new FloppyMediaService(repository, () => "f-01234567");
    const created = service.create();
    expect(created.outcome).toBe("created");
    if (created.outcome !== "created") return;

    expect(service.insert("c-012345", created.identity).outcome).toBe(
      "inserted",
    );
    expect(service.insert("c-123456", created.identity)).toMatchObject({
      outcome: "failed",
    });
    const ejected = service.eject("c-012345", created.identity.mediaId);
    expect(ejected.outcome).toBe("ejected");
    if (ejected.outcome !== "ejected") return;
    expect(ejected.identity.instanceGeneration).toBe(2);
    expect(service.insert("c-012345", created.identity)).toMatchObject({
      outcome: "failed",
    });

    owner.failWrites = true;
    expect(service.insert("c-012345", ejected.identity)).toMatchObject({
      outcome: "failed",
    });
    expect(ejected.media.location).toEqual({ kind: "detached" });
  });

  it("fails closed on unsafe identities and malformed catalog values", (): void => {
    const owner = new MemoryDynamicProperties();
    const repository = new DynamicPropertyFloppyRepository(owner);
    expect(() => repository.load("../unsafe")).toThrow(
      /Invalid Floppy media ID/u,
    );

    repository.saveCatalog({ mediaIds: [], schema: 1 });
    const head = owner.values.get("computer_system:floppy:catalog:head");
    expect(typeof head).toBe("string");
    owner.values.set("computer_system:floppy:catalog:head", 4);
    expect(() => repository.loadCatalog()).toThrow(/not a string/u);
  });
});

class MemoryDynamicProperties {
  readonly values = new Map<string, unknown>();
  failWrites = false;

  getDynamicProperty(identifier: string): unknown {
    return this.values.get(identifier);
  }

  getDynamicPropertyIds(): string[] {
    return [...this.values.keys()];
  }

  setDynamicProperty(identifier: string, value: string | undefined): void {
    if (this.failWrites) throw new Error("simulated persistence failure");
    if (value === undefined) this.values.delete(identifier);
    else this.values.set(identifier, value);
  }
}
