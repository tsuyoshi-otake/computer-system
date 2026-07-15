import type {
  ComputerOsProfile,
  ComputerSnapshot,
} from "../../domain/computer/computer.js";
import {
  restoreComputerHardware,
  type ComputerHardwareSnapshot,
} from "../../domain/computer/hardware.js";
import {
  isComputerId,
  type ComputerFamily,
} from "../../domain/computer/identity.js";
import {
  isDisplayProfileId,
  type DisplayProfileId,
} from "../../domain/display/displayProfile.js";
import {
  isInMemoryFilesystemSnapshot,
  isLegacyInMemoryFilesystemSnapshot,
  migrateLegacyInMemoryFilesystemSnapshot,
  type LegacyInMemoryFilesystemSnapshot,
} from "../../domain/filesystem/inMemoryFilesystem.js";
import type { TerminalBufferSnapshot } from "../../domain/terminal/terminalBuffer.js";

const legacyShellPrompt = /^user@computer-[1-9][0-9]*:~\$/u;
const legacyShellForeground = 5;
const defaultShellForeground = 0;
const maximumTerminalWidth = 200;
const maximumTerminalHeight = 100;

/** The complete Computer payload written before virtual-disk snapshot schema 2. */
export interface LegacyComputerSnapshotV1 {
  readonly schema: 1;
  readonly computerId: string;
  readonly family: ComputerFamily;
  readonly label?: string;
  readonly filesystem: LegacyInMemoryFilesystemSnapshot;
  readonly terminal: TerminalBufferSnapshot;
  readonly redstoneOutputMask: number;
  readonly osProfile?: ComputerOsProfile;
  readonly hardware?: ComputerHardwareSnapshot;
  readonly displayProfileId?: DisplayProfileId;
}

export type MigratableComputerSnapshot =
  ComputerSnapshot | LegacyComputerSnapshotV1;

export function isMigratableComputerSnapshot(
  value: unknown,
): value is MigratableComputerSnapshot {
  if (!isRecord(value) || (value.schema !== 1 && value.schema !== 2)) {
    return false;
  }
  if (
    !hasOnlyKeys(value, [
      "schema",
      "computerId",
      "family",
      "label",
      "filesystem",
      "terminal",
      "redstoneOutputMask",
      "osProfile",
      "hardware",
      "displayProfileId",
    ]) ||
    !isComputerId(value.computerId) ||
    (value.family !== "standard" && value.family !== "advanced") ||
    (value.label !== undefined &&
      (typeof value.label !== "string" ||
        value.label.length < 1 ||
        value.label.length > 32)) ||
    !isTerminalBufferSnapshot(value.terminal) ||
    !Number.isInteger(value.redstoneOutputMask) ||
    (value.redstoneOutputMask as number) < 0 ||
    (value.redstoneOutputMask as number) > 63 ||
    (value.osProfile !== undefined &&
      value.osProfile !== "linux" &&
      value.osProfile !== "dos") ||
    (value.hardware !== undefined &&
      !isComputerHardwareSnapshot(value.hardware)) ||
    (value.displayProfileId !== undefined &&
      !isDisplayProfileId(value.displayProfileId))
  ) {
    return false;
  }
  return value.schema === 1
    ? isLegacyInMemoryFilesystemSnapshot(value.filesystem)
    : isInMemoryFilesystemSnapshot(value.filesystem);
}

export function migrateComputerSnapshot(value: unknown): ComputerSnapshot {
  if (!isMigratableComputerSnapshot(value)) {
    throw new TypeError("Invalid or unsupported computer snapshot");
  }
  const snapshot = value;
  const terminal = migrateLegacyShellTerminal(snapshot.terminal);
  if (snapshot.schema === 2) {
    return terminal === snapshot.terminal
      ? snapshot
      : { ...snapshot, terminal };
  }
  return {
    ...snapshot,
    schema: 2,
    filesystem: migrateLegacyInMemoryFilesystemSnapshot(snapshot.filesystem),
    terminal,
  };
}

function migrateLegacyShellTerminal(
  snapshot: TerminalBufferSnapshot,
): TerminalBufferSnapshot {
  let changed = false;
  let cursorX = snapshot.cursor.x;
  const rows = snapshot.rows.map((row, rowIndex) => {
    const match = legacyShellPrompt.exec(row);
    if (match === null) return row;

    changed = true;
    const replacement = `~$${row.slice(match[0].length)}`
      .slice(0, snapshot.width)
      .padEnd(snapshot.width, " ");
    if (snapshot.cursor.y === rowIndex + 1 && cursorX > match[0].length) {
      cursorX -= match[0].length - 2;
    }
    return replacement;
  });
  const foreground = snapshot.foreground.map((row) =>
    row.map((color) => {
      if (color !== legacyShellForeground) return color;
      changed = true;
      return defaultShellForeground;
    }),
  );

  if (!changed) return snapshot;
  return {
    ...snapshot,
    rows,
    foreground,
    cursor: { ...snapshot.cursor, x: cursorX },
  };
}

function isTerminalBufferSnapshot(
  value: unknown,
): value is TerminalBufferSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "schema",
      "width",
      "height",
      "rows",
      "foreground",
      "background",
      "cursor",
    ]) ||
    value.schema !== 1 ||
    !Number.isInteger(value.width) ||
    (value.width as number) < 1 ||
    (value.width as number) > maximumTerminalWidth ||
    !Number.isInteger(value.height) ||
    (value.height as number) < 1 ||
    (value.height as number) > maximumTerminalHeight ||
    !Array.isArray(value.rows) ||
    !Array.isArray(value.foreground) ||
    !Array.isArray(value.background) ||
    !isRecord(value.cursor) ||
    !hasOnlyKeys(value.cursor, ["x", "y", "blink"])
  ) {
    return false;
  }
  const width = value.width as number;
  const height = value.height as number;
  const rows = value.rows as readonly unknown[];
  const foregroundRows = value.foreground as readonly unknown[];
  const backgroundRows = value.background as readonly unknown[];
  if (
    rows.length !== height ||
    foregroundRows.length !== height ||
    backgroundRows.length !== height
  ) {
    return false;
  }
  for (let row = 0; row < height; row += 1) {
    const text = rows[row];
    const foreground = foregroundRows[row];
    const background = backgroundRows[row];
    if (
      typeof text !== "string" ||
      [...text].length !== width ||
      !isColorRow(foreground, width) ||
      !isColorRow(background, width)
    ) {
      return false;
    }
  }
  return (
    Number.isSafeInteger(value.cursor.x) &&
    (value.cursor.x as number) >= 1 &&
    Number.isInteger(value.cursor.y) &&
    (value.cursor.y as number) >= 1 &&
    (value.cursor.y as number) <= height &&
    typeof value.cursor.blink === "boolean"
  );
}

function isColorRow(value: unknown, width: number): boolean {
  return (
    Array.isArray(value) &&
    value.length === width &&
    value.every((color) => Number.isInteger(color) && color >= 0 && color <= 15)
  );
}

function isComputerHardwareSnapshot(
  value: unknown,
): value is ComputerHardwareSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["clockHz", "cpuModel", "memoryBytes"]) ||
    !Number.isSafeInteger(value.clockHz) ||
    !Number.isSafeInteger(value.memoryBytes)
  ) {
    return false;
  }
  try {
    restoreComputerHardware(value as unknown as ComputerHardwareSnapshot);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: readonly string[],
): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}
