import { describe, expect, it } from "vitest";

import { renderCsBiosPost } from "../../src/application/computer/csBios.js";
import { ComputerRuntime } from "../../src/application/computer/computerRuntime.js";
import { ComputerRecord } from "../../src/domain/computer/computer.js";

describe("CSBIOS POST", (): void => {
  it("renders one exact 80x25 frame from the persisted Advanced profile", (): void => {
    const record = new ComputerRecord("computer-82", "advanced");
    const runtime = new ComputerRuntime();
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    const snapshot = record.terminal.snapshot();
    expect(snapshot.width).toBe(80);
    expect(snapshot.height).toBe(25);
    expect(snapshot.rows).toHaveLength(25);
    expect(snapshot.rows.every((line) => [...line].length === 80)).toBe(true);
    const post = snapshot.rows.join("\n");
    expect(post).toContain("CSBIOS System Configuration (C) 1992");
    expect(post).toContain("Main Processor : CS486DX2");
    expect(post).toContain("CPU Clock      : 66 MHz");
    expect(post).toContain("System Memory     : 8192 KB");
    expect(post).toContain("Video Adapter    : CS-VGA/2");
    expect(post).toContain("Video Memory     : 512 KB");
    expect(post).toContain("Display Panel    : 640x480 built-in CRT");
    expect(post).toContain("Maximum Graphics: 640x480");
    expect(post).toContain("Cache: L1 8 KB, L2 256 KB, 16 byte line");
    expect(post).toContain("Memory Modules: 2 x 4 MiB 72-pin SIMM DRAM");
    expect(record.display.dirtyTileCount).toBe(2_000);
  });

  it("rejects direct POST rendering without display state ownership", (): void => {
    const record = new ComputerRecord("computer-83", "standard");
    expect(() => renderCsBiosPost(record)).toThrow(
      /requires the display post state/u,
    );
  });

  it("reports bounded base memory and lossless units for valid low-end custom hardware", (): void => {
    const record = new ComputerRecord("computer-86", "standard", {
      hardware: {
        clockHz: 999,
        cpuModel: "cs486dx",
        memoryBytes: 65_536,
      },
    });
    const runtime = new ComputerRuntime();
    runtime.register(record);

    expect(runtime.powerOn(record.computerId).outcome).toBe("accepted");
    const post = record.terminal.snapshot().rows.join("\n");
    expect(post).toContain("CPU Clock      : 999 Hz");
    expect(post).toContain("Base Memory Size : 64 KB");
    expect(post).toContain("Ext. Memory Size  : 0 KB");
    expect(post).toContain("System Memory     : 64 KB");
    expect(post).not.toContain("0.00 MHz");
  });
});
