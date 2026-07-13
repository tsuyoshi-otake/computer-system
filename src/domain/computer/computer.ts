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

export interface ComputerSnapshot {
  readonly schema: 1;
  readonly computerId: string;
  readonly family: ComputerFamily;
  readonly label?: string;
  readonly filesystem: InMemoryFilesystemSnapshot;
  readonly terminal: TerminalBufferSnapshot;
  readonly redstoneOutputMask: number;
}

export interface ComputerRecordOptions {
  readonly filesystemLimits?: FilesystemLimits;
  readonly terminalWidth?: number;
  readonly terminalHeight?: number;
  readonly label?: string;
}

export class ComputerRecord {
  readonly lifecycle = new ComputerLifecycle();
  readonly filesystem: InMemoryFilesystem;
  readonly terminal: TerminalBuffer;
  readonly redstone = new RedstoneState();
  private labelValue: string | undefined;

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
    this.setLabel(options.label);
  }

  get label(): string | undefined {
    return this.labelValue;
  }

  get redstoneOutputMask(): number {
    return this.redstone.outputMask;
  }

  setLabel(label: string | undefined): void {
    if (label !== undefined && (label.length === 0 || label.length > 32)) {
      throw new Error("Computer label must contain 1..32 characters");
    }
    this.labelValue = label;
  }

  setRedstoneOutputMask(mask: number): void {
    if (!Number.isInteger(mask) || mask < 0 || mask > 63) {
      throw new RangeError(
        "Computer redstone output mask must be between 0 and 63",
      );
    }
    this.redstone.setOutputMask(mask);
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
    });
    record.filesystem.restore(snapshot.filesystem);
    record.terminal.restore(snapshot.terminal);
    record.setRedstoneOutputMask(snapshot.redstoneOutputMask);
    return record;
  }
}
