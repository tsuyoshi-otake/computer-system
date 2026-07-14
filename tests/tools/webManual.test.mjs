import { describe, expect, it } from "vitest";

import { manualChapters } from "../../web/manual.js";

describe("Web terminal field manual", () => {
  it("provides a complete, uniquely indexed sixteen-chapter publication", () => {
    expect(manualChapters).toHaveLength(16);
    expect(new Set(manualChapters.map(({ id }) => id)).size).toBe(16);
    expect(manualChapters.map(({ number }) => number)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
      "08",
      "09",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
      "16",
    ]);
    expect(manualChapters.map(({ id }) => id)).toEqual([
      "orientation",
      "architecture",
      "terminal-editor",
      "shell",
      "io-files",
      "micropython",
      "api-reference",
      "redstone-peripherals",
      "worked-project",
      "assembly",
      "basic",
      "c-family",
      "optimization",
      "dos-profile",
      "faults",
      "limits-glossary",
    ]);
    for (const chapter of manualChapters) {
      expect(chapter.title.length).toBeGreaterThan(2);
      expect(chapter.summary.length).toBeGreaterThan(8);
      expect(chapter.html).toContain("manual-page-header");
      expect(chapter.html).toContain("manual-section");
      expect(chapter.html).toContain(`Chapter ${chapter.number}`);
    }
  });

  it("documents every runtime, the machine, optimization, and terminal faults", () => {
    const publication = manualChapters
      .map(({ title, html }) => `${title}\n${html}`)
      .join("\n");

    for (const required of [
      "CS486DX",
      "CS486DX2",
      "CS386SX",
      "33 MHz",
      "66 MHz",
      "8 MiB",
      "386SX 16 MHz",
      "2 MB RAM",
      "3,300,000 cycles/tick",
      "800,000 cycles/tick",
      "16-bit data bus",
      "operand early-out",
      "Assembly language",
      "MicroPython",
      "Computer System Bash",
      "Computer System Linux 1.0",
      "CS-Linux 1.0",
      "Computer System DOS 6.2",
      "CS-DOS 6.2",
      "BASIC",
      "C and C++",
      "CS486OBJ",
      "static linking",
      "Restricted inline assembly",
      "run --stats",
      "MemoryAccessError",
      "Amdahl / Gustafson",
      "Terminal control and source editing",
      "DOS-style EDIT",
      "Save, Discard, or Cancel",
      "Connecting programs to Minecraft",
      "Requires exactly one adjacent Monitor",
      "held or placed",
      "Breaking it returns an identity-carrying Portable Computer System item",
      "/?computer=NNNN",
      "out_of_range",
      "rotates the bearer token",
      "Operating CS-DOS 6.2 on the CS386SX portable",
      "2000-02-29",
      "2038 boundary",
      "Build a signal threshold controller",
      "Runtime function reference",
      "Limits, units, and terminology",
    ]) {
      expect(publication).toContain(required);
    }
  });

  it("places accessible machine illustrations in the matching chapters", () => {
    const architecture = manualChapters.find(({ id }) => id === "architecture");
    const dos = manualChapters.find(({ id }) => id === "dos-profile");

    expect(architecture?.html).toContain(
      'src="/assets/manual/desktop-computer-system.png"',
    );
    expect(architecture?.html).toContain(
      'alt="Desktop Computer System with a 486DX 33 MHz system unit',
    );
    for (const image of [
      "/assets/machines/cs-computer.png",
      "/assets/machines/cs-advanced-computer.png",
      "/assets/machines/cs-monitor.png",
      "/assets/machines/cs-portable-computer.png",
      "/assets/cpu/CS386SX.png",
      "/assets/cpu/CS486DX.png",
      "/assets/cpu/CS486DX2.png",
    ]) {
      expect(architecture?.html).toContain(`src="${image}"`);
    }
    expect(architecture?.html).toContain(
      'alt="CS386SX processor identification plate"',
    );
    expect(architecture?.html).toContain(
      'alt="CS486DX processor identification plate"',
    );
    expect(architecture?.html).toContain(
      'alt="CS486DX2 processor identification plate"',
    );
    expect(dos?.html).toContain(
      'src="/assets/manual/portable-computer-system.png"',
    );
    expect(dos?.html).toContain(
      'alt="Portable 386SX 16 MHz Computer System with 2 MB RAM',
    );
  });

  it("documents the bounded DOS 6.2-style runtime without claiming native emulation", () => {
    const dos =
      manualChapters.find(({ id }) => id === "dos-profile")?.html ?? "";

    for (const required of [
      "CONFIG.SYS",
      "AUTOEXEC.BAT",
      "HIMEM.SYS",
      "EMM386.EXE NOEMS",
      "DOS=HIGH,UMB",
      "Conventional",
      "Upper memory blocks",
      "Extended / XMS",
      "protected sandbox",
      "virtual-8086",
      "%ERRORLEVEL%",
      "C++",
      "MicroPython commands",
      "BIOS interrupts",
      "TSR",
      "256",
    ]) {
      expect(dos).toContain(required);
    }
    expect(dos).toContain(
      "A downloaded DOS <code>.COM</code> or <code>.EXE</code> cannot run",
    );
    expect(dos).toContain(
      "No paging, swap, process table, or MMU page emulation",
    );
  });

  it("documents CS-Linux boot reset and password storage semantics", () => {
    const shell = manualChapters.find(({ id }) => id === "shell")?.html ?? "";

    for (const required of [
      "Boot and first login",
      "Reset the display",
      "does not format the guest disk",
      "boot banner",
      "appear once",
      "512-round one-way SHA-256",
      "computer:cs-sha256-v1:512:",
      "plaintext is never stored",
    ]) {
      expect(shell).toContain(required);
    }
  });
});
