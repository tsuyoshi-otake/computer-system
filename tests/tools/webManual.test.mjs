import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  manualChapters,
  manualParts,
  manualPaths,
  searchManual,
} from "../../web/manual.js";

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
      "terminal-editor",
      "io-files",
      "shell",
      "micropython",
      "redstone-peripherals",
      "worked-project",
      "api-reference",
      "architecture",
      "assembly",
      "basic",
      "c-family",
      "optimization",
      "dos-profile",
      "faults",
      "limits-glossary",
    ]);
    const partIds = new Set(manualParts.map(({ id }) => id));
    const sectionIds = new Set();
    for (const chapter of manualChapters) {
      expect(chapter.title.length).toBeGreaterThan(2);
      expect(chapter.summary.length).toBeGreaterThan(8);
      expect(partIds.has(chapter.partId)).toBe(true);
      expect(["tutorial", "how-to", "concept", "reference"]).toContain(
        chapter.kind,
      );
      expect(chapter.appliesTo.length).toBeGreaterThan(0);
      expect(chapter.sections.length).toBeGreaterThan(0);
      expect(chapter.html).toContain("manual-page-header");
      expect(chapter.html).toContain("manual-section");
      expect(chapter.html).toContain(`Chapter ${chapter.number}`);
      for (const section of chapter.sections) {
        expect(section.id.length).toBeGreaterThan(2);
        expect(section.title.length).toBeGreaterThan(2);
        expect(sectionIds.has(section.id)).toBe(false);
        sectionIds.add(section.id);
        expect(chapter.html).toContain(`id="${section.id}"`);
      }
    }
  });

  it("defines valid goal paths with a Python-free Portable route", () => {
    const chapterIds = new Set(manualChapters.map(({ id }) => id));

    expect(manualParts.map(({ id }) => id)).toEqual([
      "start-operate",
      "build-connect",
      "understand-compile",
      "profiles-support",
    ]);
    expect(manualPaths.map(({ id }) => id)).toEqual([
      "first-program",
      "python-redstone",
      "linux-operator",
      "native-development",
      "portable-dos",
      "diagnostics",
    ]);
    for (const path of manualPaths) {
      expect(path.chapterIds.length).toBeGreaterThan(1);
      expect(new Set(path.chapterIds).size).toBe(path.chapterIds.length);
      expect(path.chapterIds.every((id) => chapterIds.has(id))).toBe(true);
    }

    const portable = manualPaths.find(({ id }) => id === "portable-dos");
    expect(portable?.chapterIds).toContain("dos-profile");
    expect(portable?.chapterIds).not.toContain("micropython");
    expect(portable?.chapterIds).not.toContain("api-reference");
  });

  it("returns bounded section-level search results with stable targets", () => {
    for (const query of [
      "instruction",
      "fault",
      "BASIC",
      "EDIT",
      "CS386SX",
      "redstone",
    ]) {
      const results = searchManual(query);
      expect(results.length).toBeGreaterThan(0);
      for (const result of results) {
        expect(result.chapterId.length).toBeGreaterThan(2);
        expect(result.sectionId.length).toBeGreaterThan(2);
        expect(result.sectionTitle.length).toBeGreaterThan(2);
        expect(result.snippet.length).toBeGreaterThan(0);
        expect(result.snippet.length).toBeLessThanOrEqual(180);
      }
    }
    expect(searchManual("")).toEqual([]);
    expect(searchManual("a", { limit: 3 }).length).toBeLessThanOrEqual(3);
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
      "CSBIOS System Configuration",
      "256 KiB",
      "512 KiB",
      "640x480",
      "320x200",
      "80x25",
      "four VGA planes",
      "Computer-scoped broker",
      "O(D+S)",
      "operand early-out",
      "30-pin SIMM",
      "72-pin SIMM",
      "four-way unified L1",
      "unaligned dwords",
      "pipeline flushes",
      "Assembly language",
      "MicroPython",
      "Computer System Bash",
      "Computer System Linux 1.0",
      "CS-Linux 1.0",
      "UID/GID 1000",
      "sha256sum",
      "/proc/loadavg",
      "symbolic links",
      "hard-link",
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
      "[No Name]",
      "Ctrl+Home / Ctrl+End",
      "Copy button beside Manual",
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
      "strict 8.3 form",
      "C:\\&gt;",
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
    const startup = ["orientation", "terminal-editor", "shell"]
      .map(
        (id) => manualChapters.find((chapter) => chapter.id === id)?.html ?? "",
      )
      .join("\n");

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
      expect(startup).toContain(required);
    }
  });

  it("keeps the live benchmark and cross-profile limits explicit", () => {
    const optimization =
      manualChapters.find(({ id }) => id === "optimization")?.html ?? "";
    const toolchain =
      manualChapters.find(({ id }) => id === "c-family")?.html ?? "";
    const python =
      manualChapters.find(({ id }) => id === "micropython")?.html ?? "";

    for (const required of [
      "live BDS measurements captured through the Computer System MCP on 2026-07-15",
      "sum(i*i + 3*i + 7)",
      "1129513000",
      "9367",
      "c-hvq8k7",
      "42,106 · 637.970 µs",
      "12,084 · 183.091 µs",
      "1272",
      "c-s33g1r",
      "638,083 · 19,335.848 µs",
      "551,195 · 16,702.879 µs",
      "2985",
      "c-cqvhcs",
      "365,061 · 22,816.313 µs",
      "276,173 · 17,260.813 µs",
      "status 127",
      "Bad command or file name",
      "13.3 Cost priorities",
      "13.4 Alignment and cache locality",
      "13.5 Branches and pipelines",
    ]) {
      expect(optimization).toContain(required);
    }
    for (const required of [
      "Computer System CS486 executable",
      "not Linux ELF",
      "valid DOS 8.3 path",
      "no guest command for copying a file between two different Computer identities",
      "not a demonstration of an operator-visible cross-machine transfer",
    ]) {
      expect(toolchain).toContain(required);
    }
    expect(python).toContain("python /tmp/program.py");
    expect(python).toContain("python --stats /tmp/program.py");
    expect(python).toContain("restores the prompt after completion");
  });

  it("keeps every captured live benchmark optimization lower than its baseline", () => {
    const capture = JSON.parse(
      readFileSync(
        new URL(
          "../../docs/benchmarks/strength-reduction/results-2026-07-15.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );

    expect(capture.measurement).toBe("live-bds-mcp");
    expect(capture.checksum).toBe("1129513000");
    expect(capture.machines).toHaveLength(3);
    for (const machine of capture.machines) {
      for (const language of ["ASM", "BASIC", "C", "C++", "Python"]) {
        const baseline = machine.results.find(
          (result) =>
            result.language === language && result.variant === "baseline",
        );
        const optimized = machine.results.find(
          (result) =>
            result.language === language && result.variant === "optimized",
        );
        expect(baseline).toBeDefined();
        expect(optimized).toBeDefined();
        if (machine.cpu === "CS386SX" && language === "Python") {
          expect([baseline.exitCode, optimized.exitCode]).toEqual([127, 127]);
        } else {
          expect([baseline.exitCode, optimized.exitCode]).toEqual([0, 0]);
          expect(optimized.cycles).toBeLessThan(baseline.cycles);
        }
      }
    }
  });
});
