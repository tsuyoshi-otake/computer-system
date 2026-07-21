import type {
  ComputerOsProfile,
  ComputerRecord,
} from "../../domain/computer/computer.js";
import { cpuModelSpecification } from "../../domain/cpu/models.js";
import type { DisplayDevice } from "../../domain/display/displayDevice.js";
import type { TerminalBuffer } from "../../domain/terminal/terminalBuffer.js";
import { formatOsIdentity, getOsIdentity } from "../os/osIdentity.js";

const biosColumns = 80;
const biosRows = 25;
const terminalForeground = 0;
const terminalBackground = 15;
const textAttribute = 0x07;
const memoryTestUpdates = 8;

export const csBiosPhases = [
  "power_on_black",
  "video_bios",
  "video_black",
  "post_header",
  "memory_test",
  "device_detection",
  "boot_selection",
  "handoff_black",
  "starting_os",
  "ready",
  "cancelled",
] as const;

export type CsBiosPhase = (typeof csBiosPhases)[number];
export type CsBiosBootSource = "fixed_disk" | "floppy";

export interface CsBiosBootSequenceOptions {
  readonly bootProfile: ComputerOsProfile;
  readonly bootSource: CsBiosBootSource;
  readonly floppyPresent: boolean;
  readonly startTick: number;
  readonly ticksPerSecond: number;
}

export type CsBiosAdvanceOutcome =
  | {
      readonly outcome: "waiting";
      readonly phase: CsBiosPhase;
      readonly ticksRemaining: number;
    }
  | {
      readonly outcome: "advanced";
      readonly phase: CsBiosPhase;
      readonly previousPhase: CsBiosPhase;
    }
  | { readonly outcome: "ready"; readonly phase: "ready" }
  | { readonly outcome: "cancelled"; readonly phase: "cancelled" };

/**
 * Deterministic CSBIOS POST. It advances at most one visible stage per call so
 * the host can bound work across many Computers without relying on wall time.
 */
export class CsBiosBootSequence {
  private readonly renderer: CsBiosRenderer;
  private readonly delays: CsBiosDelays;
  private phaseValue: CsBiosPhase = "power_on_black";
  private memoryTestStep = 0;
  private nextTick: number;

  constructor(
    private readonly record: ComputerRecord,
    private readonly options: CsBiosBootSequenceOptions,
  ) {
    requireNonNegativeSafeInteger(options.startTick, "CSBIOS start tick");
    if (
      !Number.isFinite(options.ticksPerSecond) ||
      options.ticksPerSecond <= 0
    ) {
      throw new RangeError("CSBIOS ticks per second must be positive");
    }
    this.delays = createDelays(options.ticksPerSecond);
    this.renderer = new CsBiosRenderer(record);
    this.renderer.render(blankScreen());
    this.nextTick = options.startTick + this.delays.powerOnBlack;
  }

  get phase(): CsBiosPhase {
    return this.phaseValue;
  }

  advance(currentTick: number): CsBiosAdvanceOutcome {
    requireNonNegativeSafeInteger(currentTick, "CSBIOS current tick");
    if (this.phaseValue === "cancelled") {
      return { outcome: "cancelled", phase: "cancelled" };
    }
    if (this.phaseValue === "ready") {
      return { outcome: "ready", phase: "ready" };
    }
    if (currentTick < this.nextTick) {
      return {
        outcome: "waiting",
        phase: this.phaseValue,
        ticksRemaining: this.nextTick - currentTick,
      };
    }

    const previousPhase = this.phaseValue;
    switch (this.phaseValue) {
      case "power_on_black":
        this.phaseValue = "video_bios";
        this.renderer.render(videoBiosScreen(this.record));
        this.scheduleNext(currentTick, this.delays.videoBios);
        break;
      case "video_bios":
        this.phaseValue = "video_black";
        this.renderer.render(blankScreen());
        this.scheduleNext(currentTick, this.delays.videoBlack);
        break;
      case "video_black":
        this.phaseValue = "post_header";
        this.renderer.render(
          postScreen(this.record, this.options, 0, false, false),
        );
        this.scheduleNext(currentTick, this.delays.postHeader);
        break;
      case "post_header":
        this.phaseValue = "memory_test";
        this.memoryTestStep = 1;
        this.renderMemoryTest();
        this.scheduleNext(currentTick, this.delays.memoryStep);
        break;
      case "memory_test":
        if (this.memoryTestStep < memoryTestUpdates) {
          this.memoryTestStep += 1;
          this.renderMemoryTest();
          this.scheduleNext(currentTick, this.delays.memoryStep);
        } else {
          this.phaseValue = "device_detection";
          this.renderer.render(
            postScreen(
              this.record,
              this.options,
              memoryKiB(this.record),
              true,
              false,
            ),
          );
          this.scheduleNext(currentTick, this.delays.deviceDetection);
        }
        break;
      case "device_detection":
        this.phaseValue = "boot_selection";
        this.renderer.render(
          postScreen(
            this.record,
            this.options,
            memoryKiB(this.record),
            true,
            true,
          ),
        );
        this.scheduleNext(currentTick, this.delays.bootSelection);
        break;
      case "boot_selection":
        this.phaseValue = "handoff_black";
        this.renderer.render(blankScreen());
        this.scheduleNext(currentTick, this.delays.handoffBlack);
        break;
      case "handoff_black":
        this.phaseValue = "starting_os";
        this.renderer.render(startingOsScreen(this.options.bootProfile));
        this.scheduleNext(currentTick, this.delays.startingOs);
        break;
      case "starting_os":
        this.phaseValue = "ready";
        return { outcome: "ready", phase: "ready" };
    }
    return {
      outcome: "advanced",
      phase: this.phaseValue,
      previousPhase,
    };
  }

  cancel(): void {
    if (this.phaseValue === "ready" || this.phaseValue === "cancelled") return;
    this.phaseValue = "cancelled";
  }

  private renderMemoryTest(): void {
    const totalKiB = memoryKiB(this.record);
    const testedKiB = Math.min(
      totalKiB,
      Math.ceil((totalKiB * this.memoryTestStep) / memoryTestUpdates),
    );
    this.renderer.render(
      postScreen(this.record, this.options, testedKiB, false, false),
    );
  }

  private scheduleNext(currentTick: number, delay: number): void {
    this.nextTick = currentTick + delay;
  }
}

export function startCsBiosBootSequence(
  record: ComputerRecord,
  options: CsBiosBootSequenceOptions,
): CsBiosBootSequence {
  return new CsBiosBootSequence(record, options);
}

/**
 * Compatibility helper for callers that need one complete factual POST frame.
 * Runtime boot uses CsBiosBootSequence instead.
 */
export function renderCsBiosPost(
  record: ComputerRecord,
  options: {
    readonly bootProfile?: ComputerOsProfile;
    readonly bootSource?: CsBiosBootSource;
    readonly floppyPresent?: boolean;
  } = {},
): void {
  const bootOptions: CsBiosBootSequenceOptions = {
    bootProfile: options.bootProfile ?? record.osProfile,
    bootSource: options.bootSource ?? "fixed_disk",
    floppyPresent: options.floppyPresent ?? false,
    startTick: 0,
    ticksPerSecond: 20,
  };
  const renderer = new CsBiosRenderer(record);
  renderer.render(
    postScreen(record, bootOptions, memoryKiB(record), true, true),
  );
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
  terminal.setTextColor(terminalForeground);
  terminal.setBackgroundColor(terminalBackground);
  terminal.clear();
  for (let row = 1; row <= biosRows; row += 1) {
    for (let column = 1; column <= biosColumns; column += 1) {
      display.writeTextCell(column, row, 0x20, textAttribute);
    }
  }
  terminal.setCursorPosition(1, 1);
  terminal.setCursorBlink(false);
}

interface CsBiosDelays {
  readonly bootSelection: number;
  readonly deviceDetection: number;
  readonly handoffBlack: number;
  readonly memoryStep: number;
  readonly postHeader: number;
  readonly powerOnBlack: number;
  readonly startingOs: number;
  readonly videoBios: number;
  readonly videoBlack: number;
}

class CsBiosRenderer {
  private lines: readonly string[];

  constructor(private readonly record: ComputerRecord) {
    if (record.display.state.kind !== "post") {
      throw new Error("CSBIOS POST requires the display post state");
    }
    record.terminal.resize(biosColumns, biosRows);
    record.terminal.setTextColor(terminalForeground);
    record.terminal.setBackgroundColor(terminalBackground);
    record.terminal.clear();
    record.terminal.setCursorBlink(false);
    this.lines = blankScreen();
    for (let row = 1; row <= biosRows; row += 1) {
      writeDisplayLine(record.display, row, this.lines[row - 1]!);
    }
    record.terminal.setCursorPosition(1, biosRows);
  }

  render(lines: readonly string[]): void {
    if (lines.length !== biosRows) {
      throw new Error("CSBIOS screen must contain exactly 25 rows");
    }
    for (let index = 0; index < biosRows; index += 1) {
      const line = fitLine(lines[index] ?? "");
      if (line === this.lines[index]) continue;
      writeTerminalLine(this.record.terminal, index + 1, line);
      writeDisplayLine(this.record.display, index + 1, line);
    }
    this.lines = lines.map(fitLine);
    this.record.terminal.setCursorPosition(1, biosRows);
    this.record.terminal.setCursorBlink(false);
  }
}

function videoBiosScreen(record: ComputerRecord): readonly string[] {
  const profile = record.display.profile;
  return screen({
    1: "CS-VGA Video BIOS Revision 1.0",
    2: "Copyright (C) 1992 Computer System",
    4: `Adapter       : ${profile.displayName}`,
    5: `Video Memory  : ${String(profile.videoMemoryBytes / 1_024)} KB`,
    6: "Text Mode     : VGA 80x25",
  });
}

function postScreen(
  record: ComputerRecord,
  options: Pick<
    CsBiosBootSequenceOptions,
    "bootProfile" | "bootSource" | "floppyPresent"
  >,
  testedMemoryKiB: number,
  includeDevices: boolean,
  includeBoot: boolean,
): readonly string[] {
  const cpu = cpuModelSpecification(record.hardware.cpuModel);
  const profile = record.display.profile;
  const totalMemoryKiB = memoryKiB(record);
  const tested = Math.max(0, Math.min(totalMemoryKiB, testedMemoryKiB));
  const complete = tested === totalMemoryKiB;
  const rows: Record<number, string> = {
    1: "CSBIOS Revision 1.1",
    2: "Copyright (C) 1992 Computer System",
    4: `CPU            : ${cpu.runtimeName} at ${formatClock(record.hardware.clockHz)}`,
    5: `Data/Address   : ${String(cpu.dataBusBits)}-bit / ${String(cpu.addressBits)}-bit`,
    7: `System Memory  : ${String(totalMemoryKiB)} KB`,
    8: `Memory Test    : ${String(tested)} KB${complete ? " OK" : ""}`,
  };
  if (includeDevices) {
    rows[10] = `Cache          : ${formatCache(cpu.microarchitecture.l1CacheBytes, cpu.microarchitecture.externalCacheBytes, cpu.microarchitecture.cacheLineBytes)}`;
    rows[11] = "Console Input  : Ready";
    rows[12] = "Floppy Drive A : 1.44 MB, 3.5 in";
    rows[13] = `Floppy Media A : ${options.floppyPresent ? "Present" : "Not Present"}`;
    rows[14] = `Disk Quota C   : ${String(Math.floor(record.filesystem.limits.capacityBytes / 1_024))} KB`;
    rows[15] = `Video Adapter  : ${profile.displayName}, ${String(profile.videoMemoryBytes / 1_024)} KB`;
    rows[16] = `Display        : ${formatPanel(profile.panel)} / VGA text 80x25`;
  }
  if (includeBoot) {
    rows[19] = `Boot Source    : ${options.bootSource === "floppy" ? "Floppy A:" : "Fixed Disk C:"}`;
    rows[20] = `Boot Target    : ${formatOsIdentity(getOsIdentity(options.bootProfile))}`;
  }
  return screen(rows);
}

function startingOsScreen(profile: ComputerOsProfile): readonly string[] {
  return screen({
    1: `Starting ${formatOsIdentity(getOsIdentity(profile))}...`,
  });
}

function blankScreen(): readonly string[] {
  return Array.from({ length: biosRows }, () => "".padEnd(biosColumns));
}

function screen(rows: Readonly<Record<number, string>>): readonly string[] {
  return Array.from({ length: biosRows }, (_, index) =>
    fitLine(rows[index + 1] ?? ""),
  );
}

function fitLine(value: string): string {
  return value.slice(0, biosColumns).padEnd(biosColumns);
}

function writeTerminalLine(
  terminal: TerminalBuffer,
  row: number,
  line: string,
): void {
  terminal.setCursorPosition(1, row);
  terminal.clearLine();
  terminal.setCursorPosition(1, row);
  terminal.write(fitLine(line));
}

function writeDisplayLine(
  display: DisplayDevice,
  row: number,
  line: string,
): void {
  const fitted = fitLine(line);
  for (let column = 1; column <= biosColumns; column += 1) {
    display.writeTextCell(
      column,
      row,
      fitted.charCodeAt(column - 1),
      textAttribute,
    );
  }
}

function memoryKiB(record: ComputerRecord): number {
  return Math.floor(record.hardware.memoryBytes / 1_024);
}

function formatClock(clockHz: number): string {
  if (clockHz % 1_000_000 === 0) {
    return `${String(clockHz / 1_000_000)} MHz`;
  }
  if (clockHz % 1_000 === 0) return `${String(clockHz / 1_000)} kHz`;
  return `${String(clockHz)} Hz`;
}

function formatCache(
  l1Bytes: number,
  l2Bytes: number,
  lineBytes: number,
): string {
  if (l1Bytes === 0 && l2Bytes === 0) return "None";
  return `L1 ${formatKiB(l1Bytes)}; L2 ${formatKiB(l2Bytes)}; line ${String(lineBytes)} B`;
}

function formatKiB(bytes: number): string {
  return bytes === 0 ? "None" : `${String(bytes / 1_024)} KB`;
}

function formatPanel(panel: {
  readonly height: number;
  readonly kind: "external_monitor" | "integrated_lcd";
  readonly width: number;
}): string {
  return `${String(panel.width)}x${String(panel.height)} ${panel.kind === "integrated_lcd" ? "LCD" : "monitor"}`;
}

function createDelays(ticksPerSecond: number): CsBiosDelays {
  const ticks = (milliseconds: number): number =>
    Math.max(1, Math.ceil((ticksPerSecond * milliseconds) / 1_000));
  return {
    bootSelection: ticks(300),
    deviceDetection: ticks(500),
    handoffBlack: ticks(200),
    memoryStep: ticks(100),
    postHeader: ticks(200),
    powerOnBlack: ticks(400),
    startingOs: ticks(500),
    videoBios: ticks(500),
    videoBlack: ticks(100),
  };
}

function requireNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}
