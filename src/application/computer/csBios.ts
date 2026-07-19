import type { ComputerRecord } from "../../domain/computer/computer.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import type { DisplayDevice } from "../../domain/display/displayDevice.js";
import type { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { formatOsIdentity, getOsIdentity } from "../os/osIdentity.js";
import type { ComputerOsProfile } from "../../domain/computer/computer.js";

const biosColumns = 80;
const biosRows = 25;
const innerColumns = biosColumns - 2;
const leftColumns = 38;
const rightColumns = innerColumns - leftColumns - 1;
const textAttribute = 0x07;

/** Render one deterministic, real-profile CSBIOS POST frame in VGA text mode. */
export function renderCsBiosPost(
  record: ComputerRecord,
  options: {
    readonly bootProfile?: ComputerOsProfile;
    readonly floppyPresent?: boolean;
  } = {},
): void {
  const { display, terminal } = record;
  if (display.state.kind !== "post") {
    throw new Error("CSBIOS POST requires the display post state");
  }
  terminal.resize(biosColumns, biosRows);
  terminal.setTextColor(0);
  terminal.setBackgroundColor(15);
  terminal.clear();

  const cpu = cpuModelSpecification(record.hardware.cpuModel);
  const displayProfile = display.profile;
  const memoryKiB = Math.floor(record.hardware.memoryBytes / 1_024);
  const baseMemoryKiB = Math.min(memoryKiB, 640);
  const extendedKiB = Math.max(0, memoryKiB - 640);
  const videoMemoryKiB = displayProfile.videoMemoryBytes / 1_024;
  const diskKiB = Math.floor(record.filesystem.limits.capacityBytes / 1_024);
  const bootProfile = options.bootProfile ?? record.osProfile;
  const panel =
    displayProfile.panel.kind === "integrated_lcd"
      ? `${String(displayProfile.panel.width)}x480 LCD`
      : "640x480 built-in CRT";
  const lines = [
    border(),
    row("CSBIOS System Configuration (C) 1992 Computer System"),
    splitBorder(),
    splitRow(
      `Main Processor : ${cpu.runtimeName}`,
      `Base Memory Size : ${String(baseMemoryKiB)} KB`,
    ),
    splitRow(
      `CPU Clock      : ${formatClock(record.hardware.clockHz)}`,
      `Ext. Memory Size  : ${String(extendedKiB)} KB`,
    ),
    splitRow(
      `Numeric Proc.  : ${cpu.id === "cs386sx" ? "Not Present" : "Present"}`,
      `System Memory     : ${String(memoryKiB)} KB`,
    ),
    splitRow(
      `Data Bus       : ${String(cpu.dataBusBits)} bit`,
      `Video Adapter    : ${displayProfile.displayName}`,
    ),
    splitRow(
      `Address Bus    : ${String(cpu.addressBits)} bit`,
      `Video Memory     : ${String(videoMemoryKiB)} KB`,
    ),
    splitRow("Display Mode   : VGA text 80x25", `Display Panel    : ${panel}`),
    splitRow(
      `Operating Sys. : ${formatOsIdentity(getOsIdentity(bootProfile))}`,
      `Maximum Graphics: 640x480`,
    ),
    splitRow(
      `Floppy Drive A : ${options.floppyPresent === false ? "Not Present" : "1.44 MB, 3.5 in"}`,
      `Fixed Disk C     : ${String(diskKiB)} KB`,
    ),
    splitBorder(),
    row(
      `Cache: L1 ${formatCache(cpu.microarchitecture.l1CacheBytes)}, L2 ${formatCache(cpu.microarchitecture.externalCacheBytes)}, ${String(cpu.microarchitecture.cacheLineBytes)} byte line`,
    ),
    row(`Memory Test: ${String(memoryKiB)} KB OK`),
    row(`Video Memory Test: ${String(videoMemoryKiB)} KB OK`),
    row(`Initializing ${displayProfile.displayName}... 80x25 text`),
    row(`Detecting Primary Master... CS-DISK ${String(diskKiB)} KB`),
    row("Keyboard Controller... OK"),
    row(`Memory Modules: ${cpu.microarchitecture.memoryModules}`),
    row("CSBIOS Date 07/14/26  Revision 1.0"),
    row(""),
    row(
      `Starting ${formatOsIdentity(getOsIdentity(bootProfile))}${bootProfile !== record.osProfile ? " from Floppy A:" : ""}...`,
    ),
    row(""),
    row(""),
    border(),
  ];
  for (let index = 0; index < biosRows; index += 1) {
    writeLine(
      terminal,
      display,
      index + 1,
      lines[index] ?? "".padEnd(biosColumns),
    );
  }
  terminal.setCursorPosition(1, biosRows);
  terminal.setCursorBlink(false);
}

export function clearCsBiosForOs(
  terminal: TerminalBuffer,
  display: DisplayDevice,
): void {
  const transition = display.transition({
    kind: "select_mode",
    modeId: "text-80x25",
  });
  if (transition.outcome === "rejected") {
    throw new Error(`CSBIOS display handoff failed: ${transition.reason}`);
  }
  terminal.resize(biosColumns, biosRows);
  terminal.setTextColor(0);
  terminal.setBackgroundColor(15);
  terminal.clear();
  terminal.setCursorPosition(1, 1);
  terminal.setCursorBlink(false);
}

function border(): string {
  return `+${"-".repeat(innerColumns)}+`;
}

function splitBorder(): string {
  return `+${"-".repeat(leftColumns)}+${"-".repeat(rightColumns)}+`;
}

function row(value: string): string {
  return `|${fit(value, innerColumns)}|`;
}

function splitRow(left: string, right: string): string {
  return `|${fit(left, leftColumns)}|${fit(right, rightColumns)}|`;
}

function fit(value: string, width: number): string {
  return value.slice(0, width).padEnd(width, " ");
}

function formatClock(clockHz: number): string {
  if (clockHz % 1_000_000 === 0) {
    return `${String(clockHz / 1_000_000)} MHz`;
  }
  if (clockHz % 1_000 === 0) return `${String(clockHz / 1_000)} kHz`;
  return `${String(clockHz)} Hz`;
}

function formatCache(bytes: number): string {
  return bytes === 0 ? "none" : `${String(bytes / 1_024)} KB`;
}

function writeLine(
  terminal: TerminalBuffer,
  display: DisplayDevice,
  rowNumber: number,
  value: string,
): void {
  const line = value.slice(0, biosColumns).padEnd(biosColumns, " ");
  terminal.setCursorPosition(1, rowNumber);
  terminal.write(line);
  for (let column = 1; column <= biosColumns; column += 1) {
    display.writeTextCell(
      column,
      rowNumber,
      line.charCodeAt(column - 1),
      textAttribute,
    );
  }
}
