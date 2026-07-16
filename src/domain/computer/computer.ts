import {
  InMemoryFilesystem,
  defaultFilesystemLimits,
  type FilesystemLimits,
  type InMemoryFilesystemSnapshot,
} from "../filesystem/inMemoryFilesystem.js";
import {
  advancedDiskProfile,
  desktopDiskProfile,
  portableDiskProfile,
} from "../storage/storageProfiles.js";
import {
  TerminalBuffer,
  type TerminalBufferSnapshot,
} from "../terminal/terminalBuffer.js";
import { requireComputerId, type ComputerFamily } from "./identity.js";
import { ComputerLifecycle } from "./lifecycle.js";
import { RedstoneState } from "../redstone/redstoneState.js";
import {
  defaultComputerHardwareForFamily,
  defaultComputerHardware,
  portableComputerHardware,
  requireComputerHardware,
  restoreComputerHardware,
  type ComputerHardwareProfile,
  type ComputerHardwareSnapshot,
} from "./hardware.js";
import { DisplayDevice } from "../display/displayDevice.js";
import {
  requireDisplayProfileId,
  type DisplayProfileId,
} from "../display/displayProfile.js";
import { FaceIoHardware } from "../io/faceIoHardware.js";

const legacyDefaultClockHz = 20_000;

export type ComputerOsProfile = "dos" | "linux";

/** Application-owned OS state persisted as a cold, bounded schema-1 DTO. */
export interface PersistedOsRuntimeStateSnapshot {
  readonly computerId: string;
  readonly devices: readonly unknown[];
  readonly jobs: readonly unknown[];
  readonly journal: readonly unknown[];
  readonly journalBytes: number;
  readonly lastLogins: readonly unknown[];
  readonly lifecycle: unknown;
  readonly loginSessions: readonly unknown[];
  readonly mountDefinitions: readonly unknown[];
  readonly mounts: readonly unknown[];
  readonly nextJobId: number;
  readonly nextJournalSequence: number;
  readonly nextPid: number;
  readonly processes: readonly unknown[];
  readonly revision: number;
  readonly schema: 1;
  readonly services: readonly unknown[];
}

/** Application-owned DOS drive/FAT state persisted as a cold schema-1 DTO. */
export interface PersistedDosRuntimeStateSnapshot {
  readonly drives: unknown;
  readonly fatMetadata: readonly unknown[];
  readonly revision: number;
  readonly schema: 1;
}

export interface ComputerSnapshot {
  readonly schema: 2;
  readonly computerId: string;
  readonly family: ComputerFamily;
  readonly label?: string;
  readonly filesystem: InMemoryFilesystemSnapshot;
  readonly terminal: TerminalBufferSnapshot;
  readonly redstoneOutputMask: number;
  readonly osProfile?: ComputerOsProfile;
  readonly hardware?: ComputerHardwareSnapshot;
  readonly displayProfileId?: DisplayProfileId;
  readonly osRuntime?: PersistedOsRuntimeStateSnapshot;
  readonly dosRuntime?: PersistedDosRuntimeStateSnapshot;
}

export interface ComputerRecordOptions {
  readonly filesystemLimits?: FilesystemLimits;
  readonly terminalWidth?: number;
  readonly terminalHeight?: number;
  readonly label?: string;
  readonly osProfile?: ComputerOsProfile;
  readonly hardware?: ComputerHardwareProfile;
  readonly displayProfileId?: DisplayProfileId;
  readonly osRuntime?: PersistedOsRuntimeStateSnapshot;
  readonly dosRuntime?: PersistedDosRuntimeStateSnapshot;
}

export class ComputerRecord {
  readonly lifecycle = new ComputerLifecycle();
  readonly filesystem: InMemoryFilesystem;
  readonly terminal: TerminalBuffer;
  readonly redstone = new RedstoneState();
  readonly faceIo = new FaceIoHardware();
  private osProfileValue: ComputerOsProfile;
  private hardwareValue: ComputerHardwareProfile;
  private displayProfileIdValue: DisplayProfileId;
  private displayValue: DisplayDevice;
  private labelValue: string | undefined;
  private osRuntimeValue: PersistedOsRuntimeStateSnapshot | undefined;
  private dosRuntimeValue: PersistedDosRuntimeStateSnapshot | undefined;
  private metadataRevision = 0;

  constructor(
    readonly computerId: string,
    readonly family: ComputerFamily,
    options: ComputerRecordOptions = {},
  ) {
    requireComputerId(computerId);
    this.filesystem = new InMemoryFilesystem(
      options.filesystemLimits ?? {
        ...defaultFilesystemLimits,
        capacityBytes:
          options.displayProfileId === "portable-vga-256k"
            ? portableDiskProfile.capacityBytes
            : family === "advanced"
              ? advancedDiskProfile.capacityBytes
              : desktopDiskProfile.capacityBytes,
      },
    );
    this.terminal = new TerminalBuffer(
      options.terminalWidth ?? 51,
      options.terminalHeight ?? 19,
    );
    this.osProfileValue = options.osProfile ?? "linux";
    this.hardwareValue = requireComputerHardware(
      options.hardware ?? defaultComputerHardwareForFamily(family),
    );
    this.displayProfileIdValue = requireDisplayProfileId(
      options.displayProfileId ?? defaultDisplayProfileForFamily(family),
    );
    this.displayValue = new DisplayDevice(this.displayProfileIdValue);
    this.osRuntimeValue = options.osRuntime;
    this.dosRuntimeValue = options.dosRuntime;
    this.setLabel(options.label);
  }

  get label(): string | undefined {
    return this.labelValue;
  }

  get redstoneOutputMask(): number {
    return this.redstone.outputMask;
  }

  get osProfile(): ComputerOsProfile {
    return this.osProfileValue;
  }

  get hardware(): ComputerHardwareProfile {
    return this.hardwareValue;
  }

  get display(): DisplayDevice {
    return this.displayValue;
  }

  get displayProfileId(): DisplayProfileId {
    return this.displayProfileIdValue;
  }

  get osRuntimeSnapshot(): PersistedOsRuntimeStateSnapshot | undefined {
    return this.osRuntimeValue;
  }

  get dosRuntimeSnapshot(): PersistedDosRuntimeStateSnapshot | undefined {
    return this.dosRuntimeValue;
  }

  get persistenceRevision(): string {
    return `${this.metadataRevision}:${this.filesystem.revision}:${this.terminal.revision}:${this.redstone.revision}`;
  }

  setLabel(label: string | undefined): void {
    if (label !== undefined && (label.length === 0 || label.length > 32)) {
      throw new Error("Computer label must contain 1..32 characters");
    }
    if (this.labelValue === label) return;
    this.labelValue = label;
    this.metadataRevision += 1;
  }

  setRedstoneOutputMask(mask: number): void {
    if (!Number.isInteger(mask) || mask < 0 || mask > 63) {
      throw new RangeError(
        "Computer redstone output mask must be between 0 and 63",
      );
    }
    this.redstone.setOutputMask(mask);
  }

  setOsRuntimeSnapshot(snapshot: PersistedOsRuntimeStateSnapshot): void {
    if (snapshot.schema !== 1 || snapshot.computerId !== this.computerId) {
      throw new Error("OS runtime snapshot does not belong to this Computer");
    }
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new Error("OS runtime snapshot revision is invalid");
    }
    if (this.osRuntimeValue?.revision === snapshot.revision) return;
    this.osRuntimeValue = snapshot;
    this.metadataRevision += 1;
  }

  setDosRuntimeSnapshot(snapshot: PersistedDosRuntimeStateSnapshot): void {
    if (snapshot.schema !== 1) {
      throw new Error("Unsupported DOS runtime snapshot schema");
    }
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) {
      throw new Error("DOS runtime snapshot revision is invalid");
    }
    if (this.dosRuntimeValue?.revision === snapshot.revision) return;
    this.dosRuntimeValue = snapshot;
    this.metadataRevision += 1;
  }

  configureHardware(hardware: ComputerHardwareProfile): void {
    this.configureSystemProfile({
      displayProfileId: this.displayProfileIdValue,
      hardware,
      osProfile: this.osProfileValue,
    });
  }

  configureOsProfile(osProfile: ComputerOsProfile): void {
    this.configureSystemProfile({
      displayProfileId: this.displayProfileIdValue,
      hardware: this.hardwareValue,
      osProfile,
    });
  }

  configureSystemProfile(profile: {
    readonly displayProfileId: DisplayProfileId;
    readonly hardware: ComputerHardwareProfile;
    readonly osProfile: ComputerOsProfile;
  }): void {
    const next = requireComputerHardware(profile.hardware);
    const nextDisplayProfileId = requireDisplayProfileId(
      profile.displayProfileId,
    );
    if (
      profile.osProfile === this.osProfileValue &&
      next.cpuModel === this.hardwareValue.cpuModel &&
      next.clockHz === this.hardwareValue.clockHz &&
      next.memoryBytes === this.hardwareValue.memoryBytes &&
      nextDisplayProfileId === this.displayProfileIdValue
    ) {
      return;
    }
    this.osProfileValue = profile.osProfile;
    this.hardwareValue = next;
    if (nextDisplayProfileId !== this.displayProfileIdValue) {
      this.displayProfileIdValue = nextDisplayProfileId;
      this.displayValue = new DisplayDevice(nextDisplayProfileId);
    }
    this.metadataRevision += 1;
  }

  snapshot(): ComputerSnapshot {
    return {
      schema: 2,
      computerId: this.computerId,
      family: this.family,
      label: this.labelValue,
      filesystem: this.filesystem.snapshot(),
      terminal: this.terminal.snapshot(),
      redstoneOutputMask: this.redstone.outputMask,
      osProfile: this.osProfileValue,
      hardware: this.hardwareValue,
      displayProfileId: this.displayProfileIdValue,
      ...(this.osRuntimeValue === undefined
        ? {}
        : { osRuntime: this.osRuntimeValue }),
      ...(this.dosRuntimeValue === undefined
        ? {}
        : { dosRuntime: this.dosRuntimeValue }),
    };
  }

  static restore(
    snapshot: ComputerSnapshot,
    options: Pick<ComputerRecordOptions, "filesystemLimits"> = {},
  ): ComputerRecord {
    if (snapshot.schema !== 2)
      throw new Error("Unsupported computer snapshot schema");
    const record = new ComputerRecord(snapshot.computerId, snapshot.family, {
      ...options,
      label: snapshot.label,
      terminalWidth: snapshot.terminal.width,
      terminalHeight: snapshot.terminal.height,
      osProfile: snapshot.osProfile ?? "linux",
      hardware: restoreSnapshotHardware(snapshot.hardware),
      displayProfileId:
        snapshot.displayProfileId ??
        legacyDisplayProfile(snapshot, snapshot.family),
      osRuntime: snapshot.osRuntime,
      dosRuntime: snapshot.dosRuntime,
    });
    record.filesystem.restore(snapshot.filesystem);
    record.terminal.restore(snapshot.terminal);
    record.setRedstoneOutputMask(snapshot.redstoneOutputMask);
    return record;
  }
}

function defaultDisplayProfileForFamily(
  family: ComputerFamily,
): DisplayProfileId {
  return family === "advanced" ? "advanced-vga-512k" : "desktop-vga-512k";
}

function legacyDisplayProfile(
  snapshot: ComputerSnapshot,
  family: ComputerFamily,
): DisplayProfileId {
  const hardware = snapshot.hardware;
  return snapshot.osProfile === "dos" &&
    hardware?.cpuModel === portableComputerHardware.cpuModel &&
    hardware.clockHz === portableComputerHardware.clockHz &&
    hardware.memoryBytes === portableComputerHardware.memoryBytes
    ? "portable-vga-256k"
    : defaultDisplayProfileForFamily(family);
}

function restoreSnapshotHardware(
  hardware: ComputerHardwareSnapshot | undefined,
): ComputerHardwareProfile {
  const restored = restoreComputerHardware(hardware);
  return hardware?.cpuModel === undefined &&
    restored.clockHz === legacyDefaultClockHz
    ? { ...defaultComputerHardware }
    : restored;
}
