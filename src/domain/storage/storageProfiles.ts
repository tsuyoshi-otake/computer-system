export type BlockDeviceProfileId = "fixed-ide-pio-v1" | "floppy-1440k-v1";

export type ComputerDiskProfileId =
  "portable-ide-20m" | "desktop-ide-40m" | "advanced-ide-80m";

export interface BlockGeometry {
  readonly cylinders: number;
  readonly heads: number;
  readonly sectorsPerTrack: number;
}

export interface BlockDeviceProfile {
  readonly id: BlockDeviceProfileId;
  readonly sectorBytes: number;
  readonly sectorCount: number;
  readonly geometry: BlockGeometry;
  readonly rpm: number;
  readonly controllerNanoseconds: bigint;
  readonly trackToTrackSeekNanoseconds: bigint;
  readonly fullStrokeSeekNanoseconds: bigint;
  readonly headSwitchNanoseconds: bigint;
  readonly headSettleNanoseconds: bigint;
  readonly transferBytesPerSecond: number;
  readonly writeSettleNanoseconds: bigint;
  readonly queueDepth: number;
  readonly maximumRequestSectors: number;
  readonly removable: boolean;
  readonly motorSpinUpNanoseconds: bigint;
  readonly motorIdleNanoseconds: bigint;
  readonly writeThrough: boolean;
  readonly transferMode: "dma" | "pio";
}

export interface ComputerDiskProfile {
  readonly id: ComputerDiskProfileId;
  readonly capacityBytes: number;
  readonly device: BlockDeviceProfile;
}

const sectorBytes = 512;
const fixedHeads = 16;
const fixedSectorsPerTrack = 32;

export const portableDiskProfile = fixedDiskProfile(
  "portable-ide-20m",
  20 * 1_048_576,
);

export const desktopDiskProfile = fixedDiskProfile(
  "desktop-ide-40m",
  40 * 1_048_576,
);

export const advancedDiskProfile = fixedDiskProfile(
  "advanced-ide-80m",
  80 * 1_048_576,
);

export const floppy1440kProfile: BlockDeviceProfile = Object.freeze({
  id: "floppy-1440k-v1",
  sectorBytes,
  sectorCount: 2_880,
  geometry: Object.freeze({ cylinders: 80, heads: 2, sectorsPerTrack: 18 }),
  rpm: 300,
  controllerNanoseconds: 100_000n,
  trackToTrackSeekNanoseconds: 3_000_000n,
  fullStrokeSeekNanoseconds: 237_000_000n,
  headSwitchNanoseconds: 2_000_000n,
  headSettleNanoseconds: 15_000_000n,
  transferBytesPerSecond: 62_500,
  writeSettleNanoseconds: 15_000_000n,
  queueDepth: 1,
  maximumRequestSectors: 36,
  removable: true,
  motorSpinUpNanoseconds: 500_000_000n,
  motorIdleNanoseconds: 2_000_000_000n,
  writeThrough: true,
  transferMode: "dma",
});

export const computerDiskProfiles: Readonly<
  Record<ComputerDiskProfileId, ComputerDiskProfile>
> = Object.freeze({
  "portable-ide-20m": portableDiskProfile,
  "desktop-ide-40m": desktopDiskProfile,
  "advanced-ide-80m": advancedDiskProfile,
});

export function computerDiskProfile(
  id: ComputerDiskProfileId,
): ComputerDiskProfile {
  return computerDiskProfiles[id];
}

function fixedDiskProfile(
  id: ComputerDiskProfileId,
  capacityBytes: number,
): ComputerDiskProfile {
  const sectorCount = capacityBytes / sectorBytes;
  const cylinders = sectorCount / (fixedHeads * fixedSectorsPerTrack);
  if (!Number.isSafeInteger(cylinders)) {
    throw new Error(`${id} capacity does not map to its fixed CHS geometry`);
  }
  return Object.freeze({
    id,
    capacityBytes,
    device: Object.freeze({
      id: "fixed-ide-pio-v1",
      sectorBytes,
      sectorCount,
      geometry: Object.freeze({
        cylinders,
        heads: fixedHeads,
        sectorsPerTrack: fixedSectorsPerTrack,
      }),
      rpm: 3_600,
      controllerNanoseconds: 40_000n,
      trackToTrackSeekNanoseconds: 3_000_000n,
      fullStrokeSeekNanoseconds: 20_000_000n,
      headSwitchNanoseconds: 1_000_000n,
      headSettleNanoseconds: 0n,
      transferBytesPerSecond: 2 * 1_048_576,
      writeSettleNanoseconds: 1_000_000n,
      queueDepth: 1,
      maximumRequestSectors: 128,
      removable: false,
      motorSpinUpNanoseconds: 0n,
      motorIdleNanoseconds: 0n,
      writeThrough: true,
      transferMode: "pio",
    }),
  });
}
