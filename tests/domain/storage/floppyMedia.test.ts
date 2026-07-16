import { describe, expect, it } from "vitest";

import {
  FloppyMedia,
  fat12Attribute,
  floppyDataStartLba,
  floppySectorCount,
  normalizeFatTime,
} from "../../../src/domain/storage/floppyMedia.js";

const mediaId = "f-01234567";
const computerId = "c-012345";
const timestamp = Date.UTC(2026, 6, 16, 12, 34, 57, 999);

describe("FloppyMedia", (): void => {
  it("formats a standard 1.44 MiB FAT12 projection and round-trips content", (): void => {
    const media = new FloppyMedia(mediaId);
    media.format({
      modifiedAtMilliseconds: timestamp,
      volumeLabel: "WORK DISK",
    });
    media.makeDirectory("/DOCS", timestamp);
    media.writeFile("/DOCS/README.TXT", "hello floppy", timestamp);

    const boot = media.sector(0);
    expect(read16(boot, 11)).toBe(512);
    expect(boot[13]).toBe(1);
    expect(read16(boot, 17)).toBe(224);
    expect(read16(boot, 19)).toBe(floppySectorCount);
    expect(read16(boot, 22)).toBe(9);
    expect(read16(boot, 24)).toBe(18);
    expect(read16(boot, 26)).toBe(2);
    expect(new TextDecoder().decode(boot.slice(43, 54))).toBe("WORK DISK  ");
    expect(new TextDecoder().decode(boot.slice(54, 62))).toBe("FAT12   ");
    expect([...boot.slice(510)]).toEqual([0x55, 0xaa]);
    expect(new TextDecoder().decode(media.sector(19).slice(0, 11))).toBe(
      "WORK DISK  ",
    );

    const restored = FloppyMedia.restore(
      JSON.parse(JSON.stringify(media.snapshot())),
    );
    expect(restored.list("/")).toEqual(["DOCS"]);
    expect(restored.readFile("/docs/readme.txt")).toBe("hello floppy");
    expect(
      restored.ioExtents("/DOCS/README.TXT")[0]!.lba,
    ).toBeGreaterThanOrEqual(floppyDataStartLba);
    expect(restored.metadata("/DOCS/README.TXT")).toEqual({
      attributes: fat12Attribute.archive,
      modifiedAtMilliseconds: normalizeFatTime(timestamp),
    });
  });

  it("creates DOS system files and a bootable sector only for /S media", (): void => {
    const plain = new FloppyMedia(mediaId);
    plain.format({ modifiedAtMilliseconds: timestamp });
    expect(plain.bootable).toBe(false);
    expect(new TextDecoder().decode(plain.sector(0).slice(62, 77))).toBe(
      "Non-system disk",
    );

    plain.installSystem(timestamp);
    expect(plain.bootable).toBe(true);
    expect(plain.list("/")).toEqual(["COMMAND.COM", "IO.SYS", "MSDOS.SYS"]);
    expect(plain.metadata("/IO.SYS").attributes).toBe(
      fat12Attribute.hidden | fat12Attribute.system | fat12Attribute.readOnly,
    );
    expect(new TextDecoder().decode(plain.sector(0).slice(62, 84))).toBe(
      "CS-DOS bootable floppy",
    );
  });

  it("rejects traversal, stale or duplicate insertion, write protection, and capacity plus one", (): void => {
    const media = new FloppyMedia(mediaId);
    media.format({ modifiedAtMilliseconds: timestamp });
    expect(() => media.writeFile("/../HOST.TXT", "no", timestamp)).toThrow(
      /traversal/u,
    );

    media.insert(computerId, 1);
    expect(() => media.insert("c-123456", 1)).toThrow(/already inserted/u);
    const nextGeneration = media.eject(computerId);
    expect(nextGeneration).toBe(2);
    expect(() => media.insert(computerId, 1)).toThrow(/generation changed/u);

    media.setWriteProtected(true);
    expect(() => media.writeFile("/LOCKED.TXT", "no", timestamp)).toThrow(
      /write-protected/u,
    );
    media.setWriteProtected(false);

    for (let index = 0; index < 224; index += 1) {
      const base = index.toString(36).toUpperCase().padStart(4, "0");
      media.writeFile(`/${base}.TXT`, "", timestamp);
    }
    expect(() => media.writeFile("/EXTRA.TXT", "", timestamp)).toThrow(
      /root directory is full/u,
    );
    expect(media.exists("/EXTRA.TXT")).toBe(false);
  });

  it("rolls back mutations when persistence or synchronous transaction work fails", (): void => {
    const media = new FloppyMedia(mediaId);
    media.format({ modifiedAtMilliseconds: timestamp });
    const before = media.snapshot();
    expect(() =>
      media.transaction(() => {
        media.writeFile("/LOST.TXT", "not committed", timestamp);
        throw new Error("persistence failed");
      }),
    ).toThrow(/persistence failed/u);
    expect(media.snapshot()).toEqual(before);
    expect(() => media.transaction(() => Promise.resolve())).toThrow(
      /must be synchronous/u,
    );
    expect(media.snapshot()).toEqual(before);
  });
});

function read16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}
