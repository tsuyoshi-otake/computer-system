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
      const numberedSections = chapter.sections
        .map(({ number }) => number)
        .filter((number) => number !== null);
      expect(numberedSections).toEqual(
        Array.from(
          { length: numberedSections.length },
          (_unused, index) => `${Number(chapter.number)}.${index + 1}`,
        ),
      );
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
      "structured relocations",
      "static-data floor",
      "macro expansion",
      "OMF",
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
      "/sbin/cs-init",
      "ps -f",
      "service --status-all",
      "/proc/self/status",
      ".bash_history",
      "graceful stop",
      "sha256sum",
      "/proc/loadavg",
      "symbolic links",
      "hard-link",
      "Computer System DOS 6.2",
      "CS-DOS 6.2",
      "ATTRIB",
      "CHKDSK</code> reports actual",
      "GOTO :EOF",
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
      "PWR, HDD, and FDD indicators",
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
      "expected versioned CS-DOS driver capsule",
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
      "Bounded process table; no paging, swap, or MMU page emulation",
    );
  });

  it("documents the bounded CS486 assembler v2 and shared stack contract", () => {
    const architecture =
      manualChapters.find(({ id }) => id === "architecture")?.html ?? "";
    const assembly =
      manualChapters.find(({ id }) => id === "assembly")?.html ?? "";
    const cFamily =
      manualChapters.find(({ id }) => id === "c-family")?.html ?? "";
    const dos =
      manualChapters.find(({ id }) => id === "dos-profile")?.html ?? "";
    const faults = manualChapters.find(({ id }) => id === "faults")?.html ?? "";

    for (const required of [
      "dedicated tokenizer",
      "constant-expression evaluator",
      "Source-span diagnostics",
      "CS486OBJ</code> v2",
      "structured relocations",
      "Existing v1 objects remain readable",
      "section .text",
      "not runtime page protection",
      "1,000,000 source characters",
      "100,000 lexical tokens",
      "64 include files at depth 8",
      "256 macro definitions",
      "32 arguments per call",
      "macro expansion depth 16",
      "100,000 expanded tokens",
      "ld fast.o -o fast -e start",
    ]) {
      expect(assembly).toContain(required);
    }
    for (const required of [
      "ASM /C ANSWER.ASM /OUT:ANSWER.O",
      "LINK ANSWER.O /OUT:ANSWER /ENTRY:START",
      "relative <code>INCLUDE</code>",
      "native OMF, COM, EXE",
      "typed-symbol, structured-relocation",
      "CRLF source",
    ]) {
      expect(dos).toContain(required);
    }
    for (const required of [
      "ordered <code>.text</code>",
      "typed local/global/undefined symbols",
      "aligned end of all static data becomes the stack floor",
      "not Linux ELF or OMF",
      "native DOS <code>.COM</code>/<code>.EXE</code>",
      "Dynamic linking",
    ]) {
      expect(cFamily).toContain(required);
    }
    expect(architecture).toContain("Checked stack/static-data boundary");
    expect(architecture).toContain(
      "may not cross the aligned static-data floor",
    );
    expect(faults).toContain("PUSH/CALL crosses the aligned static-data floor");
    expect(faults).toContain("not stack-word provenance");
    expect(faults).toContain(
      "RET additionally validates the popped instruction target",
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
      "root-readable <code>/etc/shadow</code>",
      "User startup files run only after authentication succeeds",
      "plaintext is never stored",
    ]) {
      expect(startup).toContain(required);
    }
    expect(startup).not.toContain("boot banner, first-boot notice");
  });

  it("documents state-backed OS presence without inventing missing adapters", () => {
    const linuxChapter = manualChapters.find(({ id }) => id === "shell");
    const storageChapter = manualChapters.find(({ id }) => id === "io-files");
    const dosChapter = manualChapters.find(({ id }) => id === "dos-profile");
    const linux = linuxChapter?.html ?? "";
    const storage = storageChapter?.html ?? "";
    const dos = dosChapter?.html ?? "";
    const faultsChapter = manualChapters.find(({ id }) => id === "faults");
    const limitsChapter = manualChapters.find(
      ({ id }) => id === "limits-glossary",
    );
    const faults = faultsChapter?.html ?? "";
    const limits = limitsChapter?.html ?? "";

    for (const required of [
      "PID 1 is <code>/sbin/cs-init</code>",
      "sleep 30 &amp;",
      "Only one interactive",
      "/proc/&lt;pid&gt;/cmdline",
      "/var/log/auth.log",
      "256 records and 32 KiB",
      "Start, stop, and restart remain owned by <code>cs-init</code>",
      "Each phase has a 200-tick deadline",
      "final sync requested",
      "no unsaved success line",
      "provisional markers are removed before the fault is published",
      "cannot turn the failed final boundary into apparent success",
      "sneak while opening it to safe boot",
      "the crashed-state power control changes to safe boot",
      "Safe boot is unavailable from the guest shell and MCP command path",
    ]) {
      expect(`${linux}\n${faults}`).toContain(required);
    }
    for (const required of [
      "at most eight interfaces, 32 addresses, and 64 sockets",
      "no default <code>lo</code> or <code>eth0</code>",
      "Interfaces</td><td>8; name at most 15 UTF-8 bytes",
      "empty-by-default state is reserved for a future network adapter",
      "routes no packets",
    ]) {
      expect(`${faults}\n${limits}`).toContain(required);
    }
    expect(storage).toContain("cold OS-runtime projection");
    expect(storage).toContain("never resurrect a stale process");
    expect(faults).toContain("identity pages are already current");
    expect(faults).toContain("must reload without fallback");
    expect(faults).toContain("previous manifest is corrupt");
    expect(faults).toContain(
      "target-only content blobs, legacy indexed pages, and stray manifests",
    );
    expect(faults).toContain(
      "ordinary saves never enumerate every stored page",
    );
    expect(faults).toContain(
      "Page-count or manifest-length overflow is rejected before a generation changes storage",
    );

    for (const required of [
      "exactly A: and C:",
      "ATTRIB +R +H SECRET.TXT",
      "DIR /A:H",
      "cold restore always returns to C:",
      "CHKDSK</code> reports actual",
      "GOTO</code>/<code>GOTO :EOF",
      "1,024 / 4,096",
      "native COMMAND.COM binary behavior",
      "<b>DOS update boundary</b>",
      "multi-entry wildcard <code>COPY</code>",
      "every operand of <code>MD C:\\FIRST C:\\SECOND</code>",
      "injected post-mutation write, delete, rename, move",
      "inode and hard-link identities",
      "prior drive, per-drive current directory, prompt, label",
      "declared async callbacks never run",
      "cannot mutate that state after <code>await</code>",
      "blocks a second filesystem instance",
    ]) {
      expect(dos).toContain(required);
    }
    expect(dos).toContain("future Bedrock media adapter inserts a Floppy Disk");
    expect(dos).toContain("performs no repair");
    expect(linuxChapter?.sections.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "shell-prompt-motd-and-persistent-history",
        "shell-processes-signals-and-jobs",
        "shell-services-proc-devices-and-journals",
        "shell-sync-graceful-stop-and-safe-recovery",
      ]),
    );
    expect(dosChapter?.sections.map(({ id }) => id)).toContain(
      "dos-profile-drives-wildcards-fat-metadata-and-floppy-limits",
    );
    expect(faultsChapter?.sections.map(({ id }) => id)).toContain(
      "faults-future-network-state-migration",
    );
    expect(limitsChapter?.sections.map(({ id }) => id)).toContain(
      "limits-glossary-future-network-state-limits",
    );
    const terminalChapter = manualChapters.find(
      ({ id }) => id === "terminal-editor",
    );
    expect(terminalChapter?.sections.map(({ id }) => id)).toContain(
      "terminal-editor-static-github-pages-reference",
    );
    expect(terminalChapter?.html).toContain(
      "publishes this same canonical 16-chapter field manual as a static reference",
    );
    expect(terminalChapter?.html).toContain(
      "The Pages site is documentation only",
    );
    expect(terminalChapter?.html).toContain("cannot connect to BDS");
    expect(terminalChapter?.html).toContain(
      "Never enter a Computer connection number or terminal credential into the Pages site",
    );
    expect(searchManual("static GitHub Pages reference")[0]).toMatchObject({
      chapterId: "terminal-editor",
      sectionId: "terminal-editor-static-github-pages-reference",
    });
  });

  it("documents the cs account, scoped elevation, DAC, and complete legacy migration", () => {
    const linux = ["shell", "io-files", "diagnostics"]
      .map(
        (id) => manualChapters.find((chapter) => chapter.id === id)?.html ?? "",
      )
      .join("\n");

    for (const required of [
      "Initial administrator and protected boot-service identity, UID/GID 1000",
      "Its password starts locked",
      "sudo useradd alice",
      "sudo usermod -aG sudo alice",
      "sudo -n command",
      "MCP accepts only that non-interactive",
      "Owner, group, and other bits",
      "mode-1777",
      "no alias and no compatibility symlink",
      "exact password payload",
      "hard-link identities",
      "Restarting is idempotent",
      "permanently reserved for both users and groups",
      "at most 32 supplementary groups",
      "one all-or-nothing operation",
      "cancels foreground, compiler, and queued MCP work",
    ]) {
      expect(linux).toContain(required);
    }
  });

  it("keeps the historical benchmark boundary and cross-profile limits explicit", () => {
    const optimization =
      manualChapters.find(({ id }) => id === "optimization")?.html ?? "";
    const toolchain =
      manualChapters.find(({ id }) => id === "c-family")?.html ?? "";
    const python =
      manualChapters.find(({ id }) => id === "micropython")?.html ?? "";

    for (const required of [
      "historical live BDS measurements captured through the Computer System MCP on 2026-07-15",
      "retained as pre-CSIR provenance",
      "must not be used as current compiler measurements",
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
      "Not re-measured after the CSIR backend; authoritative guest MCP rerun pending.",
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
    expect(python).toContain("internal to that built-in empty-startup program");
    expect(python).toContain(
      "unavailable to user-authored <code>/startup.py</code>, foreground Python, and MCP Python",
    );
    expect(python).not.toContain("<tr><td>shell</td>");
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
