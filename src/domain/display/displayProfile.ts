export const displayModeIds = [
  "text-80x25",
  "vga-320x200x8",
  "vga-640x480x4",
  "vga-640x480x8",
] as const;

export type DisplayModeId = (typeof displayModeIds)[number];
export type DisplayPixelFormat = "indexed8" | "planar4" | "text";

export interface DisplayModeSpecification {
  readonly bitsPerPixel: 4 | 8;
  readonly colorCount: 16 | 256;
  readonly frameBytes: number;
  readonly height: number;
  readonly id: DisplayModeId;
  readonly pixelFormat: DisplayPixelFormat;
  readonly tileHeight: number;
  readonly tileWidth: number;
  readonly width: number;
  readonly text?: {
    readonly columns: 80;
    readonly fontHeight: 16;
    readonly fontWidth: 8;
    readonly rows: 25;
  };
}

const modes: Readonly<Record<DisplayModeId, DisplayModeSpecification>> = {
  "text-80x25": {
    bitsPerPixel: 4,
    colorCount: 16,
    frameBytes: 80 * 25 * 2,
    height: 400,
    id: "text-80x25",
    pixelFormat: "text",
    text: { columns: 80, fontHeight: 16, fontWidth: 8, rows: 25 },
    tileHeight: 16,
    tileWidth: 8,
    width: 640,
  },
  "vga-320x200x8": {
    bitsPerPixel: 8,
    colorCount: 256,
    frameBytes: 320 * 200,
    height: 200,
    id: "vga-320x200x8",
    pixelFormat: "indexed8",
    tileHeight: 16,
    tileWidth: 16,
    width: 320,
  },
  "vga-640x480x4": {
    bitsPerPixel: 4,
    colorCount: 16,
    frameBytes: (640 * 480) / 2,
    height: 480,
    id: "vga-640x480x4",
    pixelFormat: "planar4",
    tileHeight: 16,
    tileWidth: 16,
    width: 640,
  },
  "vga-640x480x8": {
    bitsPerPixel: 8,
    colorCount: 256,
    frameBytes: 640 * 480,
    height: 480,
    id: "vga-640x480x8",
    pixelFormat: "indexed8",
    tileHeight: 16,
    tileWidth: 16,
    width: 640,
  },
};

export const displayProfileIds = [
  "portable-vga-256k",
  "desktop-vga-512k",
  "advanced-vga-512k",
] as const;

export type DisplayProfileId = (typeof displayProfileIds)[number];

export interface DisplayProfileSpecification {
  readonly byteWriteCycles: number;
  readonly displayName: string;
  readonly id: DisplayProfileId;
  readonly panel: {
    readonly height: 480;
    readonly kind: "external_monitor" | "integrated_lcd";
    readonly width: 640 | 800;
  };
  readonly supportedModes: readonly DisplayModeId[];
  readonly videoMemoryBytes: number;
}

const commonVgaModes = [
  "text-80x25",
  "vga-320x200x8",
  "vga-640x480x4",
] as const;

const profiles: Readonly<
  Record<DisplayProfileId, DisplayProfileSpecification>
> = {
  "portable-vga-256k": {
    byteWriteCycles: 4,
    displayName: "CS-VGA Portable",
    id: "portable-vga-256k",
    panel: { height: 480, kind: "integrated_lcd", width: 800 },
    supportedModes: commonVgaModes,
    videoMemoryBytes: 256 * 1_024,
  },
  "desktop-vga-512k": {
    byteWriteCycles: 2,
    displayName: "CS-VGA",
    id: "desktop-vga-512k",
    panel: { height: 480, kind: "external_monitor", width: 640 },
    supportedModes: [...commonVgaModes, "vga-640x480x8"],
    videoMemoryBytes: 512 * 1_024,
  },
  "advanced-vga-512k": {
    byteWriteCycles: 1,
    displayName: "CS-VGA/2",
    id: "advanced-vga-512k",
    panel: { height: 480, kind: "external_monitor", width: 640 },
    supportedModes: [...commonVgaModes, "vga-640x480x8"],
    videoMemoryBytes: 512 * 1_024,
  },
};

export function displayModeSpecification(
  modeId: DisplayModeId,
): DisplayModeSpecification {
  return modes[modeId];
}

export function displayProfileSpecification(
  profileId: DisplayProfileId,
): DisplayProfileSpecification {
  return profiles[profileId];
}

export function isDisplayProfileId(value: unknown): value is DisplayProfileId {
  return (
    typeof value === "string" &&
    displayProfileIds.includes(value as DisplayProfileId)
  );
}

export function requireDisplayProfileId(value: unknown): DisplayProfileId {
  if (!isDisplayProfileId(value)) {
    throw new TypeError("unsupported display profile");
  }
  return value;
}

export function supportsDisplayMode(
  profileId: DisplayProfileId,
  modeId: DisplayModeId,
): boolean {
  return displayProfileSpecification(profileId).supportedModes.includes(modeId);
}
