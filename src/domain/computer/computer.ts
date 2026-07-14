import {
  InMemoryFilesystem,
  type FilesystemLimits,
  type InMemoryFilesystemSnapshot,
} from "../filesystem/inMemoryFilesystem.js";
import {
  TerminalBuffer,
  type TerminalBufferSnapshot,
} from "../terminal/terminalBuffer.js";
import { requireComputerId, type ComputerFamily } from "./identity.js";
import { ComputerLifecycle } from "./lifecycle.js";
import { RedstoneState } from "../redstone/redstoneState.js";
import {
  defaultComputerHardware,
  requireComputerHardware,
  restoreComputerHardware,
  type ComputerHardwareProfile,
  type ComputerHardwareSnapshot,
} from "./hardware.js";

const legacyDefaultClockHz = 20_000;

export type ComputerOsProfile = "dos" | "linux";

export interface ComputerSnapshot {
  readonly schema: 1;
  readonly computerId: string;
  readonly family: ComputerFamily;
  readonly label?: string;
  readonly filesystem: InMemoryFilesystemSnapshot;
  readonly terminal: TerminalBufferSnapshot;
  readonly redstoneOutputMask: number;
  readonly osProfile?: ComputerOsProfile;
  readonly hardware?: ComputerHardwareSnapshot;
}

export interface ComputerRecordOptions {
  readonly filesystemLimits?: FilesystemLimits;
  readonly terminalWidth?: number;
  readonly terminalHeight?: number;
  readonly label?: string;
  readonly osProfile?: ComputerOsProfile;
  readonly hardware?: ComputerHardwareProfile;
}

export class ComputerRecord {
  readonly lifecycle = new ComputerLifecycle();
  readonly filesystem: InMemoryFilesystem;
  readonly terminal: TerminalBuffer;
  readonly redstone = new RedstoneState();
  private osProfileValue: ComputerOsProfile;
  private hardwareValue: ComputerHardwareProfile;
  private labelValue: string | undefined;
  private metadataRevision = 0;

  constructor(
    readonly computerId: string,
    readonly family: ComputerFamily,
    options: ComputerRecordOptions = {},
  ) {
    requireComputerId(computerId);
    this.filesystem = new InMemoryFilesystem(options.filesystemLimits);
    this.terminal = new TerminalBuffer(
      options.terminalWidth ?? 51,
      options.terminalHeight ?? 19,
    );
    this.osProfileValue = options.osProfile ?? "linux";
    this.hardwareValue = requireComputerHardware(
      options.hardware ?? defaultComputerHardware,
    );
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

  configureHardware(hardware: ComputerHardwareProfile): void {
    this.configureSystemProfile({
      hardware,
      osProfile: this.osProfileValue,
    });
  }

  configureOsProfile(osProfile: ComputerOsProfile): void {
    this.configureSystemProfile({ hardware: this.hardwareValue, osProfile });
  }

  configureSystemProfile(profile: {
    readonly hardware: ComputerHardwareProfile;
    readonly osProfile: ComputerOsProfile;
  }): void {
    const next = requireComputerHardware(profile.hardware);
    if (
      profile.osProfile === this.osProfileValue &&
      next.cpuModel === this.hardwareValue.cpuModel &&
      next.clockHz === this.hardwareValue.clockHz &&
      next.memoryBytes === this.hardwareValue.memoryBytes
    ) {
      return;
    }
    this.osProfileValue = profile.osProfile;
    this.hardwareValue = next;
    this.metadataRevision += 1;
  }

  snapshot(): ComputerSnapshot {
    return {
      schema: 1,
      computerId: this.computerId,
      family: this.family,
      label: this.labelValue,
      filesystem: this.filesystem.snapshot(),
      terminal: this.terminal.snapshot(),
      redstoneOutputMask: this.redstone.outputMask,
      osProfile: this.osProfileValue,
      hardware: this.hardwareValue,
    };
  }

  static restore(
    snapshot: ComputerSnapshot,
    options: Pick<ComputerRecordOptions, "filesystemLimits"> = {},
  ): ComputerRecord {
    if (snapshot.schema !== 1)
      throw new Error("Unsupported computer snapshot schema");
    const record = new ComputerRecord(snapshot.computerId, snapshot.family, {
      ...options,
      label: snapshot.label,
      terminalWidth: snapshot.terminal.width,
      terminalHeight: snapshot.terminal.height,
      osProfile: snapshot.osProfile ?? "linux",
      hardware: restoreSnapshotHardware(snapshot.hardware),
    });
    record.filesystem.restore(snapshot.filesystem);
    record.terminal.restore(snapshot.terminal);
    record.setRedstoneOutputMask(snapshot.redstoneOutputMask);
    return record;
  }
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
