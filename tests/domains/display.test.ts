import { describe, expect, it } from "vitest";

import {
  DisplayDevice,
  DisplayError,
  type DisplayDirtyBatch,
} from "../../src/domain/display/displayDevice.js";
import {
  displayModeIds,
  displayModeSpecification,
  displayProfileSpecification,
  type DisplayModeId,
  type DisplayProfileId,
} from "../../src/domain/display/displayProfile.js";

describe("Computer System display profiles", (): void => {
  it("keeps every guest mode at or below 640x480 with exact frame sizes", (): void => {
    expect(
      displayModeIds.map((id) => {
        const mode = displayModeSpecification(id);
        return [id, mode.width, mode.height, mode.frameBytes];
      }),
    ).toEqual([
      ["text-80x25", 640, 400, 4_000],
      ["vga-320x200x8", 320, 200, 64_000],
      ["vga-640x480x4", 640, 480, 153_600],
      ["vga-640x480x8", 640, 480, 307_200],
    ]);
  });

  it("assigns 256 KiB to Portable and 512 KiB to both desktops", (): void => {
    const portable = displayProfileSpecification("portable-vga-256k");
    const desktop = displayProfileSpecification("desktop-vga-512k");
    const advanced = displayProfileSpecification("advanced-vga-512k");

    expect(portable.videoMemoryBytes).toBe(256 * 1_024);
    expect(portable.panel).toEqual({
      height: 480,
      kind: "integrated_lcd",
      width: 800,
    });
    expect(portable.supportedModes).not.toContain("vga-640x480x8");
    expect(desktop.videoMemoryBytes).toBe(512 * 1_024);
    expect(advanced.videoMemoryBytes).toBe(512 * 1_024);
    expect(desktop.supportedModes).toContain("vga-640x480x8");
    expect(advanced.supportedModes).toContain("vga-640x480x8");
  });
});

describe("DisplayDevice", (): void => {
  it("owns explicit power, POST, text, graphics, fault, and reset outcomes", (): void => {
    const display = new DisplayDevice("portable-vga-256k");

    expect(display.state).toEqual({ kind: "off" });
    expect(() => display.writeVramByte(0, 1)).toThrow(/powered off/u);
    expect(
      display.transition({ kind: "select_mode", modeId: "text-80x25" }),
    ).toMatchObject({ outcome: "rejected", reason: "powered_off" });
    expect(display.transition({ kind: "enter_post" })).toMatchObject({
      outcome: "changed",
      current: { kind: "post", modeId: "text-80x25" },
    });
    expect(
      display.transition({ kind: "select_mode", modeId: "text-80x25" }),
    ).toMatchObject({ outcome: "changed", current: { kind: "text" } });
    expect(
      display.transition({ kind: "select_mode", modeId: "text-80x25" }),
    ).toMatchObject({ outcome: "ignored", reason: "already_selected" });
    expect(
      display.transition({ kind: "select_mode", modeId: "vga-640x480x8" }),
    ).toMatchObject({ outcome: "rejected", reason: "unsupported_mode" });
    expect(
      display.transition({ kind: "fault", message: "adapter fault" }),
    ).toMatchObject({ outcome: "changed", current: { kind: "faulted" } });
    expect(display.transition({ kind: "enter_post" })).toMatchObject({
      outcome: "rejected",
      reason: "faulted",
    });
    expect(display.transition({ kind: "reset" })).toMatchObject({
      outcome: "changed",
      current: { kind: "off" },
    });
    expect(display.transition({ kind: "power_off" })).toMatchObject({
      outcome: "ignored",
      reason: "already_off",
    });
  });

  it("stores 80x25 character and attribute bytes with bounded dirty cells", (): void => {
    const display = activeDisplay("portable-vga-256k", "text-80x25", 4);
    drain(display);

    expect(display.writeTextCell(1, 1, 65, 0x1f)).toMatchObject({
      changed: true,
      cpuCycles: 8,
    });
    expect(display.writeTextCell(1, 1, 65, 0x1f)).toMatchObject({
      changed: false,
      cpuCycles: 8,
    });
    expect(display.dirtyTileCount).toBe(1);
    expect(display.readTextCell(1, 1)).toEqual({
      attribute: 0x1f,
      characterCode: 65,
    });
    expect(display.takeDirtyTiles(1)).toMatchObject({
      outcome: "complete",
      remaining: 0,
      tiles: [
        {
          format: "text-cell",
          height: 16,
          width: 8,
          x: 0,
          y: 0,
        },
      ],
    });
    expect(() => display.writeTextCell(81, 1, 65, 0)).toThrow(
      /Text column must be between 1 and 80/u,
    );
  });

  it("maps real four-plane VGA pixels at the first and last coordinates", (): void => {
    const display = activeDisplay("portable-vga-256k", "vga-640x480x4", 8);
    drain(display);

    expect(display.writePixel(0, 0, 0b1010)).toMatchObject({
      changed: true,
      cpuCycles: 16,
    });
    expect(display.writePixel(639, 479, 0b0101).changed).toBe(true);
    expect(display.readPixel(0, 0)).toBe(0b1010);
    expect(display.readPixel(639, 479)).toBe(0b0101);
    expect(display.readVramByte(0)).toBe(0);
    expect(display.readVramByte(38_400)).toBe(0x80);
    expect(display.readVramByte(76_800)).toBe(0);
    expect(display.readVramByte(115_200)).toBe(0x80);
    expect(display.dirtyTileCount).toBe(2);
    expect(() => display.writePixel(640, 0, 1)).toThrow(
      /Pixel must be within/u,
    );
    expect(() => display.writePixel(0, 0, 16)).toThrow(
      /Pixel color must be between 0 and 15/u,
    );
  });

  it("supports 640x480x8 only on the 512 KiB adapters", (): void => {
    const portable = new DisplayDevice("portable-vga-256k");
    portable.transition({ kind: "enter_post" });
    expect(
      portable.transition({
        kind: "select_mode",
        modeId: "vga-640x480x8",
      }),
    ).toMatchObject({ outcome: "rejected", reason: "unsupported_mode" });

    for (const profileId of [
      "desktop-vga-512k",
      "advanced-vga-512k",
    ] as const) {
      const display = activeDisplay(profileId, "vga-640x480x8", 8);
      expect(display.activeMode?.frameBytes).toBe(307_200);
      expect(display.writePixel(639, 479, 255).changed).toBe(true);
      expect(display.readPixel(639, 479)).toBe(255);
      expect(display.readVramByte(307_199)).toBe(255);
      expect(display.readVramByte(display.videoMemoryBytes - 1)).toBe(0);
      expect(() => display.readVramByte(display.videoMemoryBytes)).toThrow(
        /VRAM offset/u,
      );
    }
  });

  it("drains a fixed-capacity dirty ring in capped O(D) batches", (): void => {
    const display = activeDisplay("desktop-vga-512k", "vga-320x200x8", 3);

    const first = display.takeDirtyTiles(3);
    expect(first).toMatchObject({ outcome: "pending", remaining: 257 });
    expect(first.tiles).toHaveLength(3);
    expect(() => display.takeDirtyTiles(4)).toThrow(/batch limit exceeds 3/u);
    drain(display);

    for (let index = 0; index < 2_000; index += 1) {
      display.writePixel(0, 0, index % 256);
      const batch = display.takeDirtyTiles(1);
      expect(batch.remaining).toBe(0);
      expect(batch.outcome).toBe("complete");
    }
    expect(display.dirtyTileCount).toBe(0);
  });

  it("caps encoded dirty payload bytes independently from tile count", (): void => {
    const display = new DisplayDevice("desktop-vga-512k", {
      maximumPayloadBytesPerBatch: 512,
      maximumTilesPerBatch: 10,
    });
    display.transition({ kind: "enter_post" });
    display.transition({ kind: "select_mode", modeId: "vga-320x200x8" });

    const batch = display.takeDirtyTiles(10);
    expect(batch.tiles).toHaveLength(2);
    expect(batch.payloadBytes).toBe(512);
    expect(batch).toMatchObject({ outcome: "pending", remaining: 258 });
    expect(
      () =>
        new DisplayDevice("desktop-vga-512k", {
          maximumPayloadBytesPerBatch: 255,
        }),
    ).toThrow(/must fit one graphics tile/u);
  });

  it("charges deterministic model-specific VRAM write costs", (): void => {
    const portable = activeDisplay("portable-vga-256k", "vga-640x480x4", 8);
    const desktop = activeDisplay("desktop-vga-512k", "vga-640x480x4", 8);
    const advanced = activeDisplay("advanced-vga-512k", "vga-640x480x4", 8);

    expect(portable.writePixel(0, 0, 15).cpuCycles).toBe(16);
    expect(desktop.writePixel(0, 0, 15).cpuCycles).toBe(8);
    expect(advanced.writePixel(0, 0, 15).cpuCycles).toBe(4);
  });

  it("releases transient VRAM and pending work at power-off", (): void => {
    const display = activeDisplay("desktop-vga-512k", "vga-640x480x8", 8);
    display.writePixel(10, 10, 42);
    expect(display.dirtyTileCount).toBeGreaterThan(0);

    expect(display.transition({ kind: "power_off" })).toMatchObject({
      outcome: "changed",
      current: { kind: "off" },
    });
    expect(display.activeMode).toBeUndefined();
    expect(display.dirtyTileCount).toBe(0);
    expect(() => display.readVramByte(0)).toThrow(DisplayError);

    display.transition({ kind: "enter_post" });
    expect(display.readVramByte(0)).toBe(0);
  });
});

function activeDisplay(
  profileId: DisplayProfileId,
  modeId: DisplayModeId,
  maximumTilesPerBatch: number,
): DisplayDevice {
  const display = new DisplayDevice(profileId, { maximumTilesPerBatch });
  display.transition({ kind: "enter_post" });
  display.transition({ kind: "select_mode", modeId });
  return display;
}

function drain(display: DisplayDevice): DisplayDirtyBatch {
  let batch = display.takeDirtyTiles();
  while (batch.outcome === "pending") batch = display.takeDirtyTiles();
  return batch;
}
