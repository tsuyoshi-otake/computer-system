import { describe, expect, it } from "vitest";

import { renderCsBiosPost } from "../../src/application/computer/csBios.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("CSBIOS POST", (): void => {
  it("runs a synchronized 3.5-second cold-boot sequence before guest execution", (): void => {
    const record = new ComputerRecord("computer-82", "advanced");
    const runtime = new ComputerRuntime();
    runtime.register(record);

    expect(runtime.powerOn(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "booting",
    });
    expect(record.terminal.width).toBe(80);
    expect(record.terminal.height).toBe(25);
    expect(record.terminal.snapshot().rows).toHaveLength(25);
    expect(
      record.terminal.snapshot().rows.every((line) => line.trim() === ""),
    ).toBe(true);
    expect(record.terminal.snapshot().cursor.blink).toBe(false);
    expect(record.display.state.kind).toBe("post");
    expect(record.display.dirtyTileCount).toBe(2_000);
    expectTextVramSynchronized(record);
    expect(
      runtime.queueEvent(record.computerId, "terminal_line", "echo early"),
    ).toEqual({ outcome: "ignored", reason: "not_running" });
    expect(
      runtime.executeDebugShellCommand(record.computerId, "echo early"),
    ).toEqual({ outcome: "ignored", reason: "not_running" });
    expect(runtime.interrupt(record.computerId)).toEqual({
      outcome: "ignored",
      reason: "not_running",
    });

    runTicks(runtime, 8);
    expect(record.terminal.line(1).trim()).toBe("");
    runtime.runTick();
    expect(record.terminal.line(1)).toContain("CS-VGA Video BIOS Revision 1.0");
    expect(record.lifecycle.state.kind).toBe("booting");
    expectTextVramSynchronized(record);

    runTicks(runtime, 12);
    let post = terminalText(record);
    expect(post).toContain("CSBIOS Revision 1.1");
    expect(post).toContain("CPU            : CS486DX2 at 66 MHz");
    expect(post).toContain("System Memory  : 8192 KB");
    expect(post).toContain("Memory Test    : 0 KB");

    runTicks(runtime, 20);
    post = terminalText(record);
    expect(post).toContain("Memory Test    : 8192 KB OK");
    expect(post).toContain("Cache          : L1 8 KB; L2 256 KB; line 16 B");
    expect(post).toContain("Disk Quota C   : 81920 KB");
    expect(post).toContain("Video Adapter  : CS-VGA/2, 512 KB");
    expect(post).toContain("Display        : 640x480 monitor / VGA text 80x25");
    expectTextVramSynchronized(record);

    runTicks(runtime, 10);
    post = terminalText(record);
    expect(post).toContain("Boot Source    : Fixed Disk C:");
    expect(post).toContain("Boot Target    : Computer System Linux 1.0");
    expect(post).not.toMatch(
      /AMIBIOS|American Megatrends|Trident|MS-DOS|Windows|Numeric Proc|Keyboard Controller|Memory Modules|BIOS Date/u,
    );

    runTicks(runtime, 6);
    expect(record.terminal.line(1).trim()).toBe("");
    runTicks(runtime, 4);
    expect(record.terminal.line(1).trimEnd()).toBe(
      "Starting Computer System Linux 1.0...",
    );
    runTicks(runtime, 9);
    expect(record.lifecycle.state.kind).toBe("booting");
    expect(record.display.state.kind).toBe("post");

    runtime.runTick();
    expect(record.lifecycle.state.kind).not.toBe("booting");
    expect(record.display.state).toEqual({
      kind: "text",
      modeId: "text-80x25",
    });
    expect(record.terminal.line(1).trimEnd()).toBe("Computer System Linux 1.0");
  });

  it("renders only real Portable DOS hardware and an explicit floppy source", (): void => {
    const record = new ComputerRecord("computer-83", "advanced", {
      displayProfileId: "portable-vga-256k",
      hardware: {
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 2_097_152,
      },
      osProfile: "dos",
    });
    expect(record.display.transition({ kind: "enter_post" }).outcome).toBe(
      "changed",
    );

    renderCsBiosPost(record, {
      bootProfile: "dos",
      bootSource: "floppy",
      floppyPresent: true,
    });

    const post = terminalText(record);
    expect(post).toContain("CPU            : CS386SX at 16 MHz");
    expect(post).toContain("Data/Address   : 16-bit / 24-bit");
    expect(post).toContain("Cache          : None");
    expect(post).toContain("Floppy Media A : Present");
    expect(post).toContain("Video Adapter  : CS-VGA Portable, 256 KB");
    expect(post).toContain("Display        : 800x480 LCD / VGA text 80x25");
    expect(post).toContain("Boot Source    : Floppy A:");
    expect(post).toContain("Boot Target    : Computer System DOS 1.0");
    expectTextVramSynchronized(record);
  });

  it("rejects direct POST rendering without display state ownership", (): void => {
    const record = new ComputerRecord("computer-84", "standard");
    expect(() => renderCsBiosPost(record)).toThrow(
      /requires the display post state/u,
    );
  });

  it("cancels POST through the normal bounded shutdown owner", (): void => {
    const record = new ComputerRecord("computer-85", "standard");
    const runtime = new ComputerRuntime();
    runtime.configureLifecycleBoundaries({
      pendingFilesystemIo: (): number => 0,
      stopDevices: (): void => undefined,
      syncPersistence: () => ({ outcome: "saved", generation: 1 }),
    });
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    runTicks(runtime, 9);
    expect(record.display.state.kind).toBe("post");

    expect(runtime.shutdown(record.computerId)).toMatchObject({
      outcome: "accepted",
      state: "stopping",
    });
    expect(
      runtime.queueEvent(record.computerId, "terminal_line", "echo late"),
    ).toEqual({ outcome: "ignored", reason: "stopping" });
    runUntil(runtime, () => record.lifecycle.state.kind === "off");

    expect(record.display.state.kind).toBe("off");
    expect(runtime.vmState(record.computerId)).toBeUndefined();
  });

  it("keeps terminal-close security finalization explicit during POST", (): void => {
    const record = new ComputerRecord("computer-87", "standard");
    const runtime = new ComputerRuntime({ requireLinuxLogin: true });
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");

    expect(
      runtime.queueEvent(record.computerId, "terminal_closed"),
    ).toMatchObject({ outcome: "accepted", state: "booting" });
    runTicks(runtime, 71);

    expect(record.lifecycle.state.kind).not.toBe("booting");
    expect(record.lifecycle.state.kind).not.toBe("crashed");
    expect(record.display.state).toEqual({
      kind: "text",
      modeId: "text-80x25",
    });
  });

  it("advances at most 64 Computers per pass and rotates the deferred entry", (): void => {
    interface PendingProbeEntry {
      readonly record: { readonly computerId: string };
      readonly csBiosSequence: {
        advance(currentTick: number): {
          readonly outcome: "waiting";
          readonly phase: "power_on_black";
          readonly ticksRemaining: number;
        };
      };
    }
    const runtime = new ComputerRuntime();
    const control = runtime as unknown as {
      readonly pendingCsBiosEntries: Set<PendingProbeEntry>;
      advancePendingCsBiosSequences(): void;
    };
    const advances = Array.from({ length: 65 }, () => 0);
    for (let index = 0; index < advances.length; index += 1) {
      control.pendingCsBiosEntries.add({
        record: { computerId: `probe-${String(index).padStart(2, "0")}` },
        csBiosSequence: {
          advance: () => {
            advances[index] = advances[index]! + 1;
            return {
              outcome: "waiting",
              phase: "power_on_black",
              ticksRemaining: 1,
            };
          },
        },
      });
    }

    control.advancePendingCsBiosSequences();
    expect(advances.reduce((sum, value) => sum + value, 0)).toBe(64);
    expect(advances[64]).toBe(0);

    control.advancePendingCsBiosSequences();
    expect(advances.reduce((sum, value) => sum + value, 0)).toBe(128);
    expect(advances[64]).toBe(1);
    expect(Math.max(...advances)).toBe(2);
  });

  it("reports an explicit boot failure when Linux residency exceeds custom RAM", (): void => {
    const record = new ComputerRecord("computer-86", "standard", {
      hardware: {
        clockHz: 999,
        cpuModel: "cs486dx",
        memoryBytes: 65_536,
      },
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);

    const result = runtime.powerOn(record.computerId);
    expect(result).toMatchObject({ outcome: "failed" });
    if (result.outcome === "failed") {
      expect(result.error.message).toMatch(
        /CS-Linux requires at least \d+ bytes for kernel and services/u,
      );
    }
    expect(record.lifecycle.state.kind).toBe("crashed");
    expect(runtime.guestMemoryStatus(record.computerId)).toBeUndefined();
  });
});

function terminalText(record: ComputerRecord): string {
  return record.terminal.snapshot().rows.join("\n");
}

function runTicks(runtime: ComputerRuntime, count: number): void {
  for (let tick = 0; tick < count; tick += 1) runtime.runTick();
}

function runUntil(
  runtime: ComputerRuntime,
  predicate: () => boolean,
  maximumTicks = 200,
): void {
  for (let tick = 0; tick < maximumTicks; tick += 1) {
    if (predicate()) return;
    runtime.runTick();
  }
  throw new Error("Runtime did not reach the expected terminal state");
}

function expectTextVramSynchronized(record: ComputerRecord): void {
  const mismatches: string[] = [];
  for (let row = 1; row <= 25; row += 1) {
    for (let column = 1; column <= 80; column += 1) {
      const terminal = record.terminal.cell(column, row);
      const display = record.display.readTextCell(column, row);
      if (
        display.characterCode !== terminal.character.charCodeAt(0) ||
        display.attribute !== 0x07
      ) {
        mismatches.push(`${String(column)},${String(row)}`);
        if (mismatches.length >= 4) break;
      }
    }
    if (mismatches.length >= 4) break;
  }
  expect(mismatches).toEqual([]);
}
