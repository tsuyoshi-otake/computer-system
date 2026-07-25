import { describe, expect, it } from "vitest";

import {
  renderCsBiosHaltScreen,
  renderCsBiosPost,
} from "../../src/application/computer/csBios.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import type { OsRuntimeState } from "../../src/application/os/osRuntimeState.js";
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

    const halt = terminalText(record);
    expect(halt).toContain("CSBIOS Revision 1.1");
    expect(halt).toContain("CPU            : CS486DX at 999 Hz");
    expect(halt).toContain("Boot Error     : native shell initialization");
    expect(halt).toMatch(
      /Reason {9}: CS-Linux requires at least \d+ bytes for kernel/u,
    );
    expect(record.terminal.line(25).trimEnd()).toBe(
      "System halted. Safe boot to retry; /startup.py is preserved and bypassed.",
    );
    expect(record.terminal.snapshot().cursor.blink).toBe(false);
    // The paced POST never ran, so the halt screen must not claim a completed
    // memory test, a device list, or a boot selection.
    expect(halt).toContain("Memory Test    : 0 KB");
    expect(halt).not.toContain("OK");
    expect(halt).not.toContain("Cache          :");
    expect(halt).not.toContain("Boot Source    :");
  });

  it("names only the recovery a CS386SX Portable actually has", (): void => {
    const record = new ComputerRecord("computer-89", "advanced", {
      displayProfileId: "portable-vga-256k",
      hardware: {
        clockHz: 16_000_000,
        cpuModel: "cs386sx",
        memoryBytes: 2_097_152,
      },
      osProfile: "dos",
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);
    (
      runtime as unknown as { prepareOsRuntimeBoot: () => never }
    ).prepareOsRuntimeBoot = (): never => {
      throw new Error("injected runtime preparation failure");
    };

    expect(runtime.powerOn(record.computerId)).toMatchObject({
      outcome: "failed",
    });

    const halt = terminalText(record);
    expect(halt).toContain("CPU            : CS386SX at 16 MHz");
    expect(halt).toContain("Boot Error     : runtime preparation");
    expect(halt).toContain(
      "Reason         : injected runtime preparation failure",
    );
    expect(record.terminal.line(25).trimEnd()).toBe(
      "System halted. Safe boot to retry.",
    );
    expect(halt).not.toContain("/startup.py");
  });

  it("faults the OS runtime and renders the halt screen when the handoff fails", (): void => {
    const record = new ComputerRecord("computer-90", "standard");
    const runtime = new ComputerRuntime();
    runtime.register(record);
    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    const state = liveOsState(runtime, record.computerId);
    rejectFirstBootComplete(record);

    runUntil(runtime, () => record.lifecycle.state.kind === "crashed");

    expect(record.lifecycle.state.kind).toBe("crashed");
    // Without the fault the detach owner would record a clean
    // runtime_detached shutdown over a failed handoff.
    expect(state.lifecycle.phase).toBe("faulted");
    expect(state.lifecycle.reason).toBe("CSBIOS Computer handoff was rejected");
    expect(state.renderMessagesLog()).not.toContain("runtime_detached");

    const halt = terminalText(record);
    expect(halt).toContain("Boot Error     : CSBIOS OS handoff");
    expect(halt).toContain(
      "Reason         : CSBIOS Computer handoff was rejected",
    );
    // POST completed here, so the halt screen keeps its factual device rows.
    expect(halt).toContain("Memory Test    : ");
    expect(halt).toContain("Boot Source    : Fixed Disk C:");
    expect(record.terminal.line(25).trimEnd()).toBe(
      "System halted. Safe boot to retry; /startup.py is preserved and bypassed.",
    );
    expect(record.terminal.snapshot().cursor.blink).toBe(false);

    // A halted handoff must stay recoverable without a reload.
    expect(runtime.safeBoot(record.computerId)).toMatchObject({
      outcome: "accepted",
    });
    expect(state.lifecycle.phase).toBe("running");
  });

  it("keeps an over-long halt reason bounded to two visible rows", (): void => {
    const record = new ComputerRecord("computer-91", "standard");
    expect(record.display.transition({ kind: "enter_post" }).outcome).toBe(
      "changed",
    );
    renderCsBiosHaltScreen(record, {
      bootPhase: "startup source selection",
      bootProfile: "dos",
      bootSource: "floppy",
      floppyPresent: true,
      postCompleted: true,
      reason: `first line detail\nsecond\tline detail ${"pad ".repeat(60)}tail`,
      startupBypassAvailable: false,
    });

    expect(record.terminal.line(23).startsWith("Reason         : first")).toBe(
      true,
    );
    // The control characters became spaces; the terminal buffer rejects them.
    expect(record.terminal.line(23)).toContain("first line detail second line");
    expect(record.terminal.line(24).slice(0, 17).trim()).toBe("");
    expect(record.terminal.line(24).trimEnd().endsWith("...")).toBe(true);
    expect(record.terminal.line(24)).not.toContain("tail");
    expect(record.terminal.line(25).trimEnd()).toBe(
      "System halted. Safe boot to retry without the disk in Floppy Drive A:.",
    );
    expect(record.terminal.line(22)).toContain(
      "Boot Error     : startup source selection",
    );
  });
});

function rejectFirstBootComplete(record: ComputerRecord): void {
  const lifecycle = record.lifecycle as unknown as {
    transition: (event: { readonly kind: string }) => unknown;
  };
  const original = lifecycle.transition.bind(record.lifecycle);
  let rejected = false;
  lifecycle.transition = (event: { readonly kind: string }): unknown => {
    if (event.kind === "boot_complete" && !rejected) {
      rejected = true;
      return { outcome: "rejected", reason: "injected handoff rejection" };
    }
    return original(event);
  };
}

function liveOsState(
  runtime: ComputerRuntime,
  computerId: string,
): OsRuntimeState {
  const state = (
    runtime as unknown as {
      readonly entries: ReadonlyMap<
        string,
        { readonly osRuntimeState: OsRuntimeState }
      >;
    }
  ).entries.get(computerId)?.osRuntimeState;
  if (state === undefined) throw new Error("missing OS runtime state");
  return state;
}

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
