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
      "33 MHz",
      "386SX 16 MHz",
      "2 MB RAM",
      "Assembly language",
      "MicroPython",
      "Computer System Bash",
      "BASIC",
      "C and C++",
      "CS486OBJ",
      "static linking",
      "Restricted inline assembly",
      "run --stats",
      "MemoryAccessError",
      "Amdahl / Gustafson",
      "Terminal control and source editing",
      "Connecting programs to Minecraft",
      "Operating in the DOS environment",
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
    expect(dos?.html).toContain(
      'src="/assets/manual/portable-computer-system.png"',
    );
    expect(dos?.html).toContain(
      'alt="Portable 386SX 16 MHz Computer System with 2 MB RAM',
    );
  });
});
