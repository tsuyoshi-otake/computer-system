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
  type ComputerHardwareProfile,
} from "./hardware.js";

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
  readonly hardware?: ComputerHardwareProfile;
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
  readonly osProfile: ComputerOsProfile;
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
    this.osProfile = options.osProfile ?? "linux";
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
    const next = requireComputerHardware(hardware);
    if (
      next.clockHz === this.hardwareValue.clockHz &&
      next.memoryBytes === this.hardwareValue.memoryBytes
    ) {
      return;
    }
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
      osProfile: this.osProfile,
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
      hardware: snapshot.hardware ?? defaultComputerHardware,
    });
    record.filesystem.restore(snapshot.filesystem);
    record.terminal.restore(snapshot.terminal);
    record.setRedstoneOutputMask(snapshot.redstoneOutputMask);
    return record;
  }
}
