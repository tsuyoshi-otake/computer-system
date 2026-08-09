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
      "nethack",
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
    const nethack = manualPaths.find(({ id }) => id === "nethack");
    expect(nethack?.chapterIds).toEqual([
      "orientation",
      "terminal-editor",
      "io-files",
      "shell",
      "c-family",
    ]);
  });

  it("documents the guest-built NetHack path without adding a chapter", () => {
    expect(manualChapters).toHaveLength(16);
    const linux = manualChapters.find(({ id }) => id === "shell")?.html ?? "";
    for (const required of [
      "4.16 NetHack for CS-Linux",
      "/usr/src/nethack",
      "/usr/games/nethack",
      "man 6 nethack",
      "sudo make install PREFIX=/usr/local",
      "~/.nethack.sav",
      "#quit",
    ]) {
      expect(linux).toContain(required);
    }
  });

  it("documents standard streams and the bounded practical text-tool subset", () => {
    const shell = manualChapters.find(({ id }) => id === "shell")?.html ?? "";
    for (const required of [
      "4.17 Standard streams, pipes, redirects, and practical filters",
      "stdin",
      "stdout",
      "stderr",
      "command 2&gt;&amp;1 | rg",
      "A literal shell here-document is capped at eight documents and 64 KiB",
      "jq [-r]",
      "host JavaScript evaluation",
      "find</code>, <code>which</code>, <code>type</code>, <code>xargs</code>, and <code>tee</code>",
    ]) {
      expect(shell).toContain(required);
    }
  });

  it("documents bounded MS-DOS-style text utilities and key prompts", () => {
    const dos =
      manualChapters.find(({ id }) => id === "dos-profile")?.html ?? "";
    for (const required of [
      "Practical DOS text work and key prompts",
      "TYPE LOG.TXT | FIND /I",
      "FIND accepts at most 256,000 input bytes and 4,096 records",
      "SORT [/R] [/+n] [file]",
      "FC</code> and <code>COMP</code> compare two explicit guest files only",
      "CHOICE [/C[:]keys] [/N] [/S] [text]",
      "one-based <code>ERRORLEVEL</code>",
      "CHOICE /T",
      "CS-DOS v10 image adds",
    ]) {
      expect(dos).toContain(required);
    }
    expect(dos).not.toContain(
      "CHOICE</code> and native COMMAND.COM binary behavior are not implemented",
    );
  });

  it("documents the authoritative Linux and DOS submitted-line handoff", () => {
    const terminal =
      manualChapters.find(({ id }) => id === "terminal-editor")?.html ?? "";
    for (const required of [
      "Submitted-line handoff",
      "one non-secret CS-Linux or CS-DOS line",
      "Input admission and unrelated output alone do not erase the line",
      "NetHack, EDIT, or another full-screen program",
      "Passwords and every other secret-input line are excluded",
    ]) {
      expect(terminal).toContain(required);
    }
  });

  it("documents the bounded Python exception-group profile", () => {
    const python =
      manualChapters.find(({ id }) => id === "micropython")?.html ?? "";
    for (const required of [
      "Exception groups and except-star",
      "BaseExceptionGroup",
      "ExceptionGroup",
      "except*",
      "derive()",
      "subgroup()",
      "split()",
      "managed Python function",
      "4,096 admitted nodes",
      "pip",
      "venv",
    ]) {
      expect(python).toContain(required);
    }
  });

  it("documents the persistent Python REPL and bare Perl source boundaries", () => {
    const python =
      manualChapters.find(({ id }) => id === "micropython")?.html ?? "";
    const linux = manualChapters.find(({ id }) => id === "shell")?.html ?? "";
    for (const required of [
      "Persistent terminal REPL",
      "one PID, scheduler entry, and RAM grant",
      "blank line commits the suite",
      "bounded Python-style representation",
      "side effects do not replay",
      "CS486OBJ",
      "Ctrl</kbd>+<kbd>D",
      "512,000 UTF-8 bytes",
    ]) {
      expect(python).toContain(required);
    }
    for (const required of [
      "Bare Perl source input",
      "press <kbd>Ctrl</kbd>+<kbd>D</kbd>",
      "Ctrl</kbd>+<kbd>C",
      "64 KiB and 4,096 lines",
      "never replayed",
    ]) {
      expect(linux).toContain(required);
    }
    expect(linux).toContain("<code>\\b</code>");
    expect(linux).not.toContain("\u0008");
  });

  it("documents bounded Python 3.14 template strings", () => {
    const python =
      manualChapters.find(({ id }) => id === "micropython")?.html ?? "";
    for (const required of [
      "Template strings and string.templatelib",
      "string.templatelib",
      "Template",
      "Interpolation",
      "convert()",
      "Authored expression text",
      "256 replacements",
      "65,536 code units",
      "Custom <code>__format__</code>",
      "pip",
      "venv",
    ]) {
      expect(python).toContain(required);
    }
  });

  it("documents bounded Python 3.14 descriptors, attribute hooks, and deletion", () => {
    const python =
      manualChapters.find(({ id }) => id === "micropython")?.html ?? "";
    for (const required of [
      "Descriptors and method variants",
      "data descriptor, instance attribute, non-data descriptor",
      "<code>__set_name__</code>",
      "<code>property</code>",
      "<code>staticmethod</code>",
      "<code>classmethod</code>",
      "<code>__self__</code>",
      "Attribute hooks and deletion",
      "<code>__getattribute__</code>",
      "<code>__getattr__</code>",
      "<code>__setattr__</code>",
      "<code>__delattr__</code>",
      "<code>getattr</code>",
      "<code>setattr</code>",
      "<code>delattr</code>",
      "Targets delete left to right",
      "4,096-item namespace ceiling",
      "C3 MRO",
      "<code>__bases__</code>",
      "<code>__mro__</code>",
      "Cooperative super and class cells",
      "<code>super()</code>",
      "<code>__thisclass__</code>",
      "<code>object.__init__</code>",
      "hidden class cell",
      "implicit static method",
      "<code>object.__new__(cls)</code>",
      "returned instance",
      "returned unchanged without initialization",
      "native/asynchronous descriptor or attribute hooks",
    ]) {
      expect(python).toContain(required);
    }
    expect(python).not.toContain(
      "<code>__slots__</code>, <code>__new__</code>",
    );
  });

  it("returns bounded section-level search results with stable targets", () => {
    for (const query of [
      "instruction",
      "fault",
      "BASIC",
      "EDIT",
      "CS386SX",
      "Computer System Deskpro 486DX",
      "Computer System Deskpro 486DX2",
      "Computer System LTE 386SX",
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
    expect(searchManual("CS Make 1.0")[0]).toMatchObject({
      chapterId: "shell",
    });
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
      "2 MiB RAM",
      "1,650,000 for CS486DX2",
      "825,000 for CS486DX",
      "400,000 cycles per 20 Hz tick for CS386SX",
      "guestRealtimeDivisor",
      "16-bit data bus",
      "CSBIOS Revision 1.1",
      "256 KiB",
      "512 KiB",
      "640x480",
      "320x200",
      "80x25",
      "720x400",
      "exact 4:3 glass",
      "0.8 horizontal correction",
      "square-pixel at 1.0",
      "CS Windows is not implemented",
      "four VGA planes",
      "Computer-scoped broker",
      "O(D+S)",
      "operand early-out",
      "30-pin SIMM",
      "72-pin SIMM",
      "four-way unified L1",
      "unaligned dwords",
      "pipeline flushes",
      "CS ASM 1.0",
      "Python 3.14 CS Profile",
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
      "Computer System DOS 1.0",
      "CS-DOS 1.0",
      "ATTRIB",
      "CHKDSK</code> reports state without repair",
      "GOTO :EOF",
      "BASIC",
      "CS C/C++ 1.0",
      "CS486OBJ",
      "static linking",
      "Restricted inline assembly",
      "run --stats",
      "MemoryAccessError",
      "Amdahl / Gustafson",
      "Terminal control and source editing",
      "DOS-style EDIT",
      "IBM VGA 9x16",
      "#0000AA",
      "#00AAAA",
      "#a8a8a8",
      "#000000",
      "DOS Command, Repeat DOS Command, and Insert Command Output",
      "F1 through F12",
      "transparent keyboard textarea",
      "parenthesized mnemonic suffix",
      "[No Name]",
      ":syntax on",
      ":set number rainbow list wrap",
      ":r !command",
      "C:\\_VIMRC",
      "Ctrl+Home / Ctrl+End",
      "PWR, HDD, and FDD indicators",
      "3.5-inch floppy drive",
      "Save, Discard, or Cancel",
      "Connecting programs to Minecraft",
      "The CRT is built into the placed Computer",
      "held or placed",
      "Breaking it returns an identity-carrying Portable Computer System item",
      "/?computer=NNNN",
      "out_of_range",
      "rotates the bearer token",
      "Operating CS-DOS 1.0 on the LTE 386SX",
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
      'alt="Computer System Deskpro 486 family all-in-one computer with built-in CRT',
    );
    for (const image of [
      "/assets/machines/cs-computer.png",
      "/assets/machines/cs-advanced-computer.png",
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
      'alt="Computer System LTE 386SX with 2 MiB RAM',
    );
  });

  it("documents the bounded CS-DOS 1.0 runtime without claiming native emulation", () => {
    const dos =
      manualChapters.find(({ id }) => id === "dos-profile")?.html ?? "";

    for (const required of [
      "CONFIG.SYS",
      "Plan CONFIG.SYS atomically",
      "expected versioned CS-DOS driver capsule",
      "64 KiB degraded-low",
      "AUTOEXEC.BAT",
      "HIMEM.SYS",
      "EMM386.EXE NOEMS",
      "DOS=HIGH,UMB",
      "Conventional",
      "Reserved video aperture",
      "Upper memory blocks",
      "768–895 KiB",
      "Extended / XMS",
      "HMA is its first 64 KiB, never extra capacity",
      "immutable boot-manager snapshot",
      "protected sandbox",
      "cs-flat32-v1",
      "not DPMI",
      "No EMS paging",
      "virtual-8086",
      "strict 8.3 form",
      "C:\\&gt;",
      "%ERRORLEVEL%",
      "CS ASM 1.0",
      "CS C/C++ 1.0",
      "CS QBASIC 1.0",
      "CSASM ANSWER.ASM",
      "CSCC TOTAL.C",
      "CSCPP ANSWER.CPP",
      "PWB ANSWER.CPP",
      "F7 builds one source or the selected Program List",
      "F5/F8/F9 debug inside WorkBench",
      "run source transiently and create no OBJ, CSX, or EXE",
      "Microsoft C/C++ 7.0",
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

  it("documents the bounded CS486 assembler v3 and shared stack contract", () => {
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
      "CS486OBJ</code> v4",
      "structured relocations",
      "Existing v1-v3 word objects remain readable",
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
      "CS ASM 1.0 for the active CS486/CS386 target",
      "ASM /VERSION",
      "CSASM FAST.ASM",
      "PWB FAST.ASM",
      "Shift+F5 builds and runs",
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
      "CS C/C++ 1.0 for the active CS486/CS386 target",
      "cc --version",
      "CSCC PROGRAM.C",
      "CSCPP PROGRAM.CPP",
      "PWB PROGRAM.CPP",
      "selected Program List",
      "instruction debugger directly in WorkBench",
      "CS PROGRAM LIST 1.0",
      "#include",
      'extern "C" int fast(int, int);',
      "push arguments right-to-left",
      "CHAR_BIT=32",
      "fixed multidimensional arrays",
      "pointer-passed structs",
      "Format units, conversions, aggregate storage",
      "Word strings remain decoded 32-bit words plus a zero word",
      "byte strings are packed values plus a NUL byte",
      "worst-case output are capped before installation",
      "unmangled undefined text-function symbol",
      "legacy version-4 word executable or current version-5 model-declared executable",
      "Mouse events, sound, windows, arbitrary graphics modes",
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
      "256 records, 32 KiB total, and 1 KiB per record",
      "It is a rotating log, not a fixed table",
      "earlier record(s) dropped by journal rotation",
      "A halted machine accepts no input, so it shows no cursor",
      "only retries without bootable floppy media",
      "SysV init: inittab, runlevels, and rc.d",
      "Service mutation itself flows only through <code>/etc/init.d/NAME start|stop|restart</code>",
      "<code>service --status-all</code> and <code>service NAME status</code> remain read-only",
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
    expect(storage).toContain("Web Terminal <b>Eject</b> button");
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
      "Cold DOS persistence preserves C:",
      "current CS-DOS v10 image adds",
      "CS-Linux is rootfs v20",
      "including DOS v8",
      "guest C/C++ include roots",
      "DOS v5 retains CS QBASIC 1.0 without the WorkBench launchers",
      "CHKDSK</code> reports state without repair",
      "FORMAT A: /S",
      "temporary A:-only DOS",
      "uid=1000,gid=1000",
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
    expect(dos).toContain("removable Floppy Disk item");
    expect(dos).toContain("without repair");
    expect(linuxChapter?.sections.map(({ id }) => id)).toEqual(
      expect.arrayContaining([
        "shell-prompt-motd-and-persistent-history",
        "shell-processes-signals-and-jobs",
        "shell-sysv-init-inittab-runlevels-and-rc-d",
        "shell-proc-devices-and-journals",
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
      "Computer System CS486 format family",
      "not Linux ELF",
      "valid destination path",
      "no guest command for copying a file between two different Computer identities",
      "destination Computer supplies CPU timing",
    ]) {
      expect(toolchain).toContain(required);
    }
    expect(python).toContain("python /tmp/program.py");
    expect(python).toContain("python --stats /tmp/program.py");
    expect(python).toContain("targeting Python 3.14 syntax and core semantics");
    expect(python).toContain(
      "This is not yet a Python 3.14 compatibility claim",
    );
    expect(python).toContain("<code>pip</code>");
    expect(python).toContain("<code>venv</code>");
    expect(python).toContain("Python modules and regular packages</h3>");
    expect(python).toContain(
      "A directory containing <code>__init__.py</code> is a regular package",
    );
    expect(python).toContain(
      "Without <code>as</code>, <code>import pkg.tools</code> binds <code>pkg</code>",
    );
    expect(python).toContain(
      "Circular imports expose the exact partially initialized namespace",
    );
    expect(python).toContain(
      "The graph admits 64 modules including the main script, depth 16, and 512,000 aggregate UTF-8 source bytes",
    );
    expect(python).toContain(
      "Namespace packages, zip imports, and dynamic import hooks are unavailable",
    );
    expect(python).toContain("Classes and instances</h3>");
    expect(python).toContain(
      "each C3 MRO admits 64 classes including the class itself and <code>object</code>",
    );
    expect(python).toContain("Classes expose <code>__name__</code>");
    expect(python).toContain(
      "Function and class decorator expressions run in the containing scope from top to bottom",
    );
    expect(python).toContain("at most 4,096 decorators per definition");
    expect(python).toContain("Deferred annotations</h3>");
    expect(python).toContain(
      "The first successful <code>__annotations__</code> access evaluates them in authored order and caches one mutable dictionary",
    );
    expect(python).toContain(
      "If evaluation faults, no dictionary is cached and a later access retries",
    );
    expect(python).toContain(
      "a partially initialized module receives a fresh dictionary containing only annotation statements executed so far",
    );
    expect(python).toContain(
      "A function-local annotation only makes a simple name local; it is never evaluated or stored",
    );
    expect(python).toContain(
      "Generic functions, classes, and soft-keyword <code>type</code> aliases",
    );
    expect(python).toContain(
      "one stable authored-order <code>__type_params__</code> tuple",
    );
    expect(python).toContain(
      "Bounds, tuple constraints, defaults, and alias <code>__value__</code> evaluate on first access",
    );
    expect(python).toContain("faults publish no cache and retry");
    expect(python).toContain(
      "Generic classes and aliases support bounded subscription such as <code>Box[int]</code>",
    );
    expect(python).toContain(
      "read-only <code>__origin__</code>, <code>__args__</code>, and <code>__parameters__</code>",
    );
    expect(python).toContain("Open and nested aliases may be subscribed again");
    expect(python).toContain(
      "parameterized aliases are rejected in <code>isinstance</code>/<code>issubclass</code> checks",
    );
    expect(python).toContain(
      "The runtime-owned <code>typing</code> core is available without a guest module file or host Python",
    );
    expect(python).toContain(
      "runtime <code>TypeVar</code>, <code>ParamSpec</code>, and <code>TypeVarTuple</code> constructors",
    );
    expect(python).toContain(
      "<code>Annotated.__metadata__</code> is read-only",
    );
    expect(python).toContain(
      "<code>cast</code>/<code>assert_type</code> preserve the supplied value without enforcing its type",
    );
    expect(python).toContain(
      "<code>get_type_hints</code>/<code>ForwardRef</code> evaluation",
    );
    expect(python).toContain("Structural pattern matching</h3>");
    expect(python).toContain(
      "<code>match</code>, <code>case</code>, and <code>_</code> are soft keywords",
    );
    expect(python).toContain(
      "A failed pattern or failed OR alternative publishes no partial captures",
    );
    expect(python).toContain(
      "Successful captures are preflighted and published together before the guard",
    );
    expect(python).toContain("Patterns are limited to 4,096 nodes");
    expect(python).toContain("Iterators and generator functions</h3>");
    expect(python).toContain(
      "passing an existing iterator returns that same object at its current position",
    );
    expect(python).toContain(
      "raises catchable <code>StopIteration</code> at stable exhaustion",
    );
    expect(python).toContain(
      "resolves inherited <code>__iter__</code> and <code>__next__</code> through the class path and ignores instance-only special methods",
    );
    expect(python).toContain(
      "inherited <code>__getitem__</code> supplies the legacy sequence protocol",
    );
    expect(python).toContain(
      "Each independent cursor requests integer indexes from zero and advances only after a successful item",
    );
    expect(python).toContain(
      "Any class-level <code>__iter__</code>, including explicit <code>None</code>, takes precedence",
    );
    expect(python).toContain(
      "<code>iter(callable, sentinel)</code> evaluates both operands once",
    );
    expect(python).toContain(
      "Managed functions and lambdas, bound methods, classes, native functions including waits, and filesystem-loaded CS486 extension exports are supported",
    );
    expect(python).toContain(
      "A result equal under the current CS Profile <code>==</code> semantics is consumed as the sentinel",
    );
    expect(python).toContain(
      "Another fault propagates without exhausting the cursor",
    );
    expect(python).not.toContain(
      "The callable/sentinel form of <code>iter</code>",
    );
    expect(python).toContain(
      "A sequence-fallback cursor keeps its source instance and current index reachable",
    );
    expect(python).toContain(
      "Every <code>__getitem__</code> request uses the ordinary bounded managed-CS486 call path",
    );
    expect(python).not.toContain("<code>__getitem__</code> sequence fallback");
    expect(python).toContain(
      "synchronous comprehensions, generator expressions, and <code>yield from</code> share this path",
    );
    expect(python).toContain(
      "user-iterator exhaustion supplies the exact <code>StopIteration.value</code>",
    );
    expect(python).toContain(
      "Calling it binds arguments without running the body",
    );
    expect(python).toContain(
      "resume its compiled CS486 target and make the suspended yield expression evaluate to <code>None</code>",
    );
    expect(python).toContain(
      "<code>send(value)</code> supplies that exact managed value",
    );
    expect(python).toContain(
      "Sending non-<code>None</code> before the first yield raises <code>TypeError</code> without consuming the generator",
    );
    expect(python).toContain(
      "Yield is valid throughout <code>try</code>, <code>except</code>, and <code>finally</code>",
    );
    expect(python).toContain(
      "<code>throw(exception)</code> raises at the suspended yield",
    );
    expect(python).toContain(
      "<code>close()</code> injects <code>GeneratorExit</code>",
    );
    expect(python).toContain(
      "<code>GeneratorExit</code> derives from <code>BaseException</code>",
    );
    expect(python).toContain(
      "<code>yield from expression</code> evaluates one iterable once",
    );
    expect(python).toContain(
      "A subgenerator return becomes the expression result",
    );
    expect(python).toContain(
      "<code>send</code>, <code>throw</code>, and <code>close</code> forward to a generator delegate",
    );
    expect(python).toContain(
      "A synchronous generator expression such as <code>(value * 2 for value in values if value)</code>",
    );
    expect(python).toContain(
      "Its leftmost iterable expression and <code>iter()</code> run once when the expression is constructed",
    );
    expect(python).toContain(
      "Elements, filters, and later iterables remain lazy",
    );
    expect(python).toContain(
      "the sole argument to a call may omit one extra pair of parentheses",
    );
    expect(python).toContain("asynchronous generator expressions");
    expect(python).toContain("automatic garbage-collection close");
    expect(python).not.toContain(
      "user-defined <code>__iter__</code>/<code>__next__</code>",
    );
    expect(python).toContain(
      "Materializing consumers resume every user-iterator or generator step through ordinary bounded CS486 calls",
    );
    expect(python).toContain(
      "A callee is not invoked, unpack targets are not stored, slices are not mutated, and new results are not published",
    );
    expect(python).not.toContain("generic materialization from user iterators");
    expect(python).toContain("Synchronous context managers");
    expect(python).toContain(
      "Managers enter from left to right and successfully entered managers exit exactly once from right to left",
    );
    expect(python).toContain(
      "<code>__exit__(None, None, None)</code> and ignore its result",
    );
    expect(python).toContain("stable type, exact value");
    expect(python).toContain(
      "A truthy exit result suppresses the fault; a false result reraises that same value",
    );
    expect(python).toContain(
      "Bound exits remain reachable across generator suspension and <code>close()</code>",
    );
    expect(python).toContain(
      "preflights the implicit receiver plus all three explicit exit arguments before entering",
    );
    expect(python).toContain("Coroutines and async protocols</h3>");
    expect(python).toContain(
      "returns an unstarted coroutine without running the body",
    );
    expect(python).toContain(
      "The low-level driver surface is <code>coroutine.send(None)</code>",
    );
    expect(python).toContain(
      "There is no hidden <code>asyncio</code> event loop or second Python scheduler",
    );
    expect(python).toContain("consumes <code>StopAsyncIteration</code>");
    expect(python).toContain(
      "multiple managers enter left-to-right and exit exactly once right-to-left",
    );
    expect(python).toContain(
      "An <code>async def</code> containing <code>yield</code> returns an unstarted asynchronous generator",
    );
    expect(python).toContain(
      "<code>__anext__()</code>, <code>asend()</code>, <code>athrow()</code>, and <code>aclose()</code>",
    );
    expect(python).toContain("asynchronous generator expressions remain lazy");
    expect(python).toContain(
      "Custom awaitables that yield an external scheduler token and <code>asyncio</code>",
    );
    expect(python).toContain("<code>async with</code>");
    expect(python).not.toContain(
      "other generator consumers, context managers, and async iteration remain later phases",
    );
    expect(python).not.toContain(
      "Generator expressions, asynchronous comprehensions",
    );
    expect(python).toContain("131,072 tokens");
    expect(python).toContain("16,384 statements");
    expect(python).toContain("capacity plus one fails");
    expect(python).toContain("One <code>GuestProcessMemoryGrant</code>");
    expect(python).toContain("without a second RAM lease");
    expect(python).not.toContain("MicroPython-compatible language");
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
