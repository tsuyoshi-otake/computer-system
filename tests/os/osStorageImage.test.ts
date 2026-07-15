import { describe, expect, it } from "vitest";

import { ShellSession } from "../../src/application/os/shellSession.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";
import { portableComputerHardware } from "../../src/domain/computer/hardware.js";
import { filesystemBlobPoolStats } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("OS filesystem images and disk profiles", (): void => {
  it("uses family-specific disk capacities and charges real initial OS files", (): void => {
    const desktop = new ComputerRecord("c-000420", "standard");
    const advanced = new ComputerRecord("c-000421", "advanced");
    const portable = new ComputerRecord("c-000422", "standard", {
      displayProfileId: "portable-vga-256k",
      hardware: portableComputerHardware,
      osProfile: "dos",
    });
    new ShellSession(desktop.filesystem, { osProfile: "linux" });
    new ShellSession(advanced.filesystem, { osProfile: "linux" });
    new ShellSession(portable.filesystem, { osProfile: "dos" });

    expect(desktop.filesystem.limits.capacityBytes).toBe(40 * 1_048_576);
    expect(advanced.filesystem.limits.capacityBytes).toBe(80 * 1_048_576);
    expect(portable.filesystem.limits.capacityBytes).toBe(20 * 1_048_576);
    const linuxUsed =
      desktop.filesystem.limits.capacityBytes -
      desktop.filesystem.getFreeSpace();
    const dosUsed =
      portable.filesystem.limits.capacityBytes -
      portable.filesystem.getFreeSpace();
    expect(linuxUsed).toBeGreaterThan(2 * 1_048_576);
    expect(linuxUsed).toBeLessThan(4 * 1_048_576);
    expect(dosUsed).toBeGreaterThan(500 * 1_024);
    expect(dosUsed).toBeLessThan(1_048_576);
    expect(desktop.filesystem.getSize("/boot/vmlinuz-cs486")).toBe(786_432);
    expect(portable.filesystem.getSize("/drives/c/command.com")).toBe(55_968);
  });

  it("shares immutable image blobs between Computers and snapshots only overlays", (): void => {
    const first = new ComputerRecord("c-000423", "standard");
    new ShellSession(first.filesystem, { osProfile: "linux" });
    const afterFirst = filesystemBlobPoolStats();
    const second = new ComputerRecord("c-000424", "standard");
    new ShellSession(second.filesystem, { osProfile: "linux" });
    const afterSecond = filesystemBlobPoolStats();

    expect(afterSecond).toEqual(afterFirst);
    const snapshot = second.filesystem.snapshot();
    expect(snapshot.baseImageId).toBe("cs-linux-1.0-rootfs-v1");
    expect(snapshot.files.some(([path]) => path.startsWith("/usr/bin/"))).toBe(
      false,
    );
    expect(
      snapshot.blobs.reduce((sum, [, contents]) => sum + contents.length, 0),
    ).toBeLessThan(64 * 1_024);
  });
});
