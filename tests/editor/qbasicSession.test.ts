import { describe, expect, it } from "vitest";

import {
  DosIdeSession,
  parseTerminalMouseEvent,
  QBasicSession,
  type QBasicSessionOptions,
} from "../../src/application/editor/qbasicSession.js";
import {
  parseQBasicCommandLine,
  QBasicCommandLineError,
} from "../../src/application/os/qbasicCommandLine.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  createGuestToolchainTranscript,
  guestToolchainTranscriptFromStreams,
} from "../../src/application/toolchain/guestToolchainTranscript.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

function text(row: readonly { readonly character: string }[]): string {
  return row.map(({ character }) => character).join("");
}

function screenText(screen: {
  readonly rows: readonly (readonly { readonly character: string }[])[];
}): string {
  return screen.rows.map((row) => text(row)).join("\n");
}

describe("CS QBASIC command line", (): void => {
  it("accepts the MS-DOS 6.22 switches without inventing /HELP", (): void => {
    expect(
      parseQBasicCommandLine([
        "/b",
        "/g",
        "/h",
        "/mbf",
        "/nohi",
        "/run",
        "C:\\DEMO.BAS",
      ]),
    ).toEqual({
      display: {
        blackAndWhite: true,
        cgaSnow: true,
        highIntensity: false,
        highResolution: true,
        monochrome: true,
      },
      editorMode: false,
      fileName: "C:\\DEMO.BAS",
      mbf: true,
      run: true,
    });
    expect(() => parseQBasicCommandLine(["/HELP"])).toThrow(
      QBasicCommandLineError,
    );
    expect(() => parseQBasicCommandLine(["/RUN"])).toThrow(
      "/RUN requires a program file",
    );
    expect(() =>
      parseQBasicCommandLine(["/EDITOR", "/RUN", "DEMO.BAS"]),
    ).toThrow("/EDITOR and /RUN cannot be combined");
    expect(() => parseQBasicCommandLine(["/B", "/b"])).toThrow(
      "Duplicate switch",
    );
  });
});

describe("QBasicSession", (): void => {
  it("keeps WorkBench build keys and mouse behind an active editor dialog", (): void => {
    const session = new DosIdeSession(
      "C:\\WORK\\MAIN.C",
      "int main(){return 0;}",
      80,
      25,
      "C:\\WORK\\MAIN.C",
      {
        editorMode: false,
        language: "c",
        product: "cs-cpp",
        showWelcome: false,
      },
    );

    session.key("X");
    session.key("Ctrl+O");
    const build = session.key("F7");
    expect(build.kind).toBe("continue");
    expect(
      build.screen.rows.some((row) => text(row).includes("not saved")),
    ).toBe(true);
    const clicked = session.mouse({
      action: "down",
      button: 0,
      sequence: 1,
      x: 2,
      y: 1,
    });
    expect(clicked.kind).toBe("continue");
    expect(
      clicked.screen.rows.some((row) => text(row).includes("not saved")),
    ).toBe(true);
  });
  it("opens an original Welcome dialog and exposes QBasic IDE menus", (): void => {
    const qbasic = new QBasicSession(
      "C:\\UNTITLED.BAS",
      "",
      80,
      25,
      "Untitled",
      { editorMode: false, showWelcome: true },
    );

    const welcome = qbasic.screen();
    expect(welcome.rows).toHaveLength(25);
    expect(text(welcome.rows[0]!)).toMatch(
      /^ {2}File\s+Edit\s+View\s+Search\s+Run\s+Options\s+Help/u,
    );
    expect(text(welcome.rows[0]!)).not.toContain("Make");
    expect(text(welcome.rows[0]!)).not.toContain("Debug");
    expect(welcome.rows.some((row) => text(row).includes("CS QBASIC"))).toBe(
      true,
    );
    const mouseFirst = new QBasicSession(
      "C:\\UNTITLED.BAS",
      "",
      80,
      25,
      "Untitled",
      { editorMode: false, showWelcome: true },
    );
    const clickedMenu = mouseFirst.mouse({
      action: "down",
      button: 0,
      sequence: 1,
      x: 3,
      y: 1,
    });
    expect(
      clickedMenu.screen.rows.some((row) => text(row).includes("New")),
    ).toBe(true);
    const program = qbasic.key("Enter");
    expect(program.kind).toBe("continue");
    expect(text(program.screen.rows.at(-1)!)).toContain("CS QBASIC 1.0");
    expect(text(program.screen.rows.at(-1)!)).toContain("<F5=Run>");
    expect(text(program.screen.rows.at(-1)!)).toContain("N 00001:001");
  });

  it("brands the bounded DOS workbench for CS ASM and CS C/C++", (): void => {
    const assembler = new DosIdeSession(
      "C:\\MAIN.ASM",
      "mov eax, 42\nprint eax\nhalt",
      80,
      25,
      "C:\\MAIN.ASM",
      { language: "asm", product: "cs-asm", showWelcome: true },
    );
    const assemblyWelcome = assembler.screen();
    expect(
      assemblyWelcome.rows.some((row) => text(row).includes("CS ASM 1.0")),
    ).toBe(true);
    expect(
      assemblyWelcome.rows.some((row) =>
        text(row).includes("CS486 Assembly WorkBench"),
      ),
    ).toBe(true);
    assembler.key("Enter");
    expect(text(assembler.screen().rows.at(-1)!)).toContain("CS ASM 1.0");
    expect(text(assembler.screen().rows.at(-1)!)).toContain("<F7=Build>");
    expect(text(assembler.screen().rows.at(-1)!)).toContain("N 00001:001");
    expect(assembler.key("Shift+F5")).toMatchObject({
      command: "build-run",
      kind: "command",
    });

    const cpp = new DosIdeSession(
      "C:\\MAIN.CPP",
      "int main() { return 0; }",
      80,
      25,
      "C:\\MAIN.CPP",
      { language: "cpp", product: "cs-cpp", showWelcome: true },
    );
    const cppWelcome = cpp.screen();
    expect(
      cppWelcome.rows.some((row) => text(row).includes("CS C/C++ 1.0")),
    ).toBe(true);
    expect(
      cppWelcome.rows.some((row) =>
        text(row).includes("CS486 Programmer's WorkBench"),
      ),
    ).toBe(true);
  });

  it("characterizes WorkBench content and overlays before state refactoring", (): void => {
    const workbench = new DosIdeSession(
      "C:\\WORK\\MAIN.C",
      "int main(){return 0;}",
      80,
      25,
      "C:\\WORK\\MAIN.C",
      {
        language: "c",
        product: "cs-cpp",
        showWelcome: false,
      },
    );

    workbench.completeCommand(
      "build",
      1,
      guestToolchainTranscriptFromStreams("OUTPUT-SENTINEL", ""),
    );
    expect(screenText(workbench.screen())).toContain("OUTPUT-SENTINEL");

    const menuFromOutput = workbench.key("F10");
    expect(screenText(menuFromOutput.screen)).toContain("New");
    expect(screenText(menuFromOutput.screen)).not.toContain("OUTPUT-SENTINEL");
    workbench.key("Escape");

    workbench.completeDebuggerCommand(
      "debug-start",
      0,
      "Paused at 00000000\nDEBUG-SENTINEL",
    );
    expect(screenText(workbench.screen())).toContain("CS Debugger 1.0");
    expect(screenText(workbench.screen())).toContain("DEBUG-SENTINEL");

    const menuFromDebugger = workbench.key("F10");
    expect(screenText(menuFromDebugger.screen)).toContain("New");

    const restoredDebugger = workbench.key("Escape");
    expect(screenText(restoredDebugger.screen)).toContain("CS Debugger 1.0");
    expect(screenText(restoredDebugger.screen)).not.toContain("New");

    workbench.key("Alt+m");
    const programListOverDebugger = workbench.key("p");
    expect(screenText(programListOverDebugger.screen)).toContain(
      "CS Debugger 1.0",
    );
    expect(screenText(programListOverDebugger.screen)).toContain(
      "Set Program List",
    );

    const cancelledProgramList = workbench.key("Escape");
    expect(screenText(cancelledProgramList.screen)).toContain(
      "CS Debugger 1.0",
    );
    expect(screenText(cancelledProgramList.screen)).not.toContain(
      "Set Program List",
    );
  });

  it("characterizes command boundaries for all four editor profiles", (): void => {
    const profiles: readonly {
      readonly expectedAltF7: "compile-file" | "continue";
      readonly expectedCtrlF7: "rebuild" | "continue";
      readonly expectedF5: "build-run" | "continue" | "debug-start";
      readonly expectedF7: "build" | "continue";
      readonly menuIncludes: readonly string[];
      readonly menuOmits: readonly string[];
      readonly name: string;
      readonly options: QBasicSessionOptions;
    }[] = [
      {
        expectedAltF7: "continue",
        expectedCtrlF7: "continue",
        expectedF5: "continue",
        expectedF7: "continue",
        menuIncludes: ["File", "Edit", "Search", "Options", "Help"],
        menuOmits: ["View", "Make", "Run", "Debug"],
        name: "EDIT",
        options: { editorMode: true },
      },
      {
        expectedAltF7: "continue",
        expectedCtrlF7: "continue",
        expectedF5: "build-run",
        expectedF7: "continue",
        menuIncludes: ["File", "Edit", "View", "Search", "Run", "Options"],
        menuOmits: ["Make", "Debug"],
        name: "QBASIC",
        options: { language: "basic", product: "qbasic" },
      },
      {
        expectedAltF7: "compile-file",
        expectedCtrlF7: "rebuild",
        expectedF5: "debug-start",
        expectedF7: "build",
        menuIncludes: ["File", "View", "Make", "Run", "Debug", "Options"],
        menuOmits: [],
        name: "CSASM",
        options: { language: "asm", product: "cs-asm" },
      },
      {
        expectedAltF7: "compile-file",
        expectedCtrlF7: "rebuild",
        expectedF5: "debug-start",
        expectedF7: "build",
        menuIncludes: ["File", "View", "Make", "Run", "Debug", "Options"],
        menuOmits: [],
        name: "PWB",
        options: { language: "c", product: "cs-cpp" },
      },
    ];

    for (const profile of profiles) {
      const createSession = (): DosIdeSession =>
        new DosIdeSession(
          "C:\\WORK\\MAIN.C",
          "int main(){return 0;}",
          80,
          25,
          "C:\\WORK\\MAIN.C",
          { ...profile.options, showWelcome: false },
        );
      const menu = text(createSession().screen().rows[0]!);
      for (const label of profile.menuIncludes) {
        expect(menu, profile.name + " menu").toContain(label);
      }
      for (const label of profile.menuOmits) {
        expect(menu, profile.name + " menu").not.toContain(label);
      }

      const f5 = createSession().key("F5");
      expect(
        f5.kind === "command" ? f5.command : f5.kind,
        profile.name + " F5",
      ).toBe(profile.expectedF5);
      const f7 = createSession().key("F7");
      expect(
        f7.kind === "command" ? f7.command : f7.kind,
        profile.name + " F7",
      ).toBe(profile.expectedF7);
      const altF7 = createSession().key("Alt+F7");
      expect(
        altF7.kind === "command" ? altF7.command : altF7.kind,
        profile.name + " Alt+F7",
      ).toBe(profile.expectedAltF7);
      const ctrlF7 = createSession().key("Ctrl+F7");
      expect(
        ctrlF7.kind === "command" ? ctrlF7.command : ctrlF7.kind,
        profile.name + " Ctrl+F7",
      ).toBe(profile.expectedCtrlF7);
    }
  });

  it("brings editor dialogs in front of the debugger view", (): void => {
    const workbench = new DosIdeSession(
      "C:\\WORK\\MAIN.C",
      "int main(){return 0;}",
      80,
      25,
      "C:\\WORK\\MAIN.C",
      {
        language: "c",
        product: "cs-cpp",
        showWelcome: false,
      },
    );
    workbench.completeDebuggerCommand(
      "debug-start",
      0,
      "Paused at 00000000\nDEBUG-SENTINEL",
    );

    workbench.key("Alt+o");
    const options = workbench.key("Enter");
    expect(screenText(options.screen)).toContain("Display Options");
    expect(screenText(options.screen)).not.toContain("DEBUG-SENTINEL");

    const closed = workbench.key("Escape");
    expect(screenText(closed.screen)).not.toContain("Display Options");
    expect(screenText(closed.screen)).not.toContain("DEBUG-SENTINEL");
  });

  it("keeps WorkBench panel hints aligned with active keys", (): void => {
    const workbench = new DosIdeSession(
      "C:\\WORK\\MAIN.C",
      "int main(){return 0;}",
      80,
      25,
      "C:\\WORK\\MAIN.C",
      {
        language: "c",
        product: "cs-cpp",
        showWelcome: false,
      },
    );
    workbench.completeCommand(
      "build",
      1,
      guestToolchainTranscriptFromStreams("", "build failed\r\n"),
    );

    const output = workbench.screen();
    expect(text(output.rows.at(-1)!)).toContain("F1=Help");
    expect(screenText(workbench.key("F1").screen)).toContain("WorkBench Help");
    workbench.key("Escape");

    workbench.key("Alt+m");
    const programList = workbench.key("p").screen;
    const footer = text(programList.rows.at(-1)!);
    expect(footer).toContain("Enter=Set Program List");
    expect(footer).not.toContain("F1=");
    expect(footer).not.toContain("Tab=");
  });

  it("runs QBASIC source transiently without build or debugger commands", (): void => {
    const qbasic = new QBasicSession(
      "C:\\DEMO.BAS",
      "PRINT 42",
      80,
      25,
      "C:\\DEMO.BAS",
      { editorMode: false },
    );

    expect(qbasic.key("Shift+F5")).toMatchObject({
      command: "build-run",
      kind: "command",
    });
    expect(qbasic.key("F7").kind).toBe("continue");
    expect(qbasic.key("F5")).toMatchObject({
      command: "build-run",
      kind: "command",
    });

    qbasic.completeCommand(
      "build-run",
      0,
      guestToolchainTranscriptFromStreams("42\n", ""),
    );
    expect(
      text(qbasic.screen().rows.at(-1)!).includes(
        "no executable was installed",
      ),
    ).toBe(true);
    const output = qbasic.key("F4");
    expect(text(output.screen.rows[2]!)).toContain("42");
    expect(qbasic.key("Escape").kind).toBe("continue");
  });

  it("supports bounded mouse drag selection and clipboard editing", (): void => {
    const qbasic = new QBasicSession(
      "C:\\DEMO.BAS",
      "PRINT 42\nEND",
      80,
      25,
      "C:\\DEMO.BAS",
      { editorMode: false },
    );

    const runMenu = qbasic.mouse({
      action: "down",
      button: 0,
      sequence: 1,
      x: 25,
      y: 1,
    });
    expect(runMenu.kind).toBe("continue");
    expect(
      runMenu.screen.rows.some((row) =>
        text(row).includes("Run / Restart Source"),
      ),
    ).toBe(true);
    qbasic.mouse({ action: "up", button: 0, sequence: 2, x: 25, y: 1 });
    qbasic.key("Escape");
    qbasic.mouse({ action: "down", button: 0, sequence: 3, x: 2, y: 3 });
    const selected = qbasic.mouse({
      action: "move",
      button: 0,
      sequence: 4,
      x: 7,
      y: 3,
    });
    expect(
      selected.screen.rows[2]!.slice(1, 6).every(
        ({ background }) => background === 1,
      ),
    ).toBe(true);
    qbasic.mouse({ action: "up", button: 0, sequence: 5, x: 7, y: 3 });
    qbasic.key("Ctrl+C");
    qbasic.mouse({ action: "down", button: 0, sequence: 6, x: 5, y: 4 });
    qbasic.mouse({ action: "up", button: 0, sequence: 7, x: 5, y: 4 });
    qbasic.key("Ctrl+V");
    expect(qbasic.contents).toBe("PRINT 42\nENDPRINT");
    expect(
      parseTerminalMouseEvent(
        '{"action":"move","button":0,"sequence":8,"x":80,"y":25}',
      ),
    ).toMatchObject({ action: "move", x: 80, y: 25 });
    expect(() =>
      parseTerminalMouseEvent(
        '{"action":"move","button":0,"sequence":9,"x":81,"y":25}',
      ),
    ).toThrow("Invalid terminal mouse event");
  });

  it("builds .CSX and drives the bounded debugger inside the C WorkBench", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/main.c",
      ["int main() {", 'printf("%d\\n", 42);', "return 0;", "}", ""].join(
        "\r\n",
      ),
    );

    shell.submit("CSCC C:\\MAIN.C");
    shell.keys(["Enter"]);
    const built = shell.keys(["F7"]);
    expect(filesystem.exists("/drives/c/main.csx")).toBe(true);
    expect(text(built.terminalScreen!.rows.at(-1)!)).toContain(
      "Built C:\\MAIN.CSX",
    );

    const debugging = shell.keys(["F5"]);
    expect(
      debugging.terminalScreen!.rows.some((row) =>
        text(row).includes("CS Debugger 1.0"),
      ),
    ).toBe(true);
    expect(
      debugging.terminalScreen!.rows.some((row) =>
        text(row).includes("EIP=00000000"),
      ),
    ).toBe(true);

    const traced = shell.keys(["F8"]);
    expect(
      traced.terminalScreen!.rows.some((row) =>
        text(row).includes("Paused at"),
      ),
    ).toBe(true);
    const breakpoint = shell.keys(["F9"]);
    expect(text(breakpoint.terminalScreen!.rows.at(-1)!)).toContain(
      "Breakpoint set",
    );
    const stopped = shell.keys(["Shift+F5"]);
    expect(text(stopped.terminalScreen!.rows.at(-1)!)).toContain(
      "Debugging stopped",
    );
  });

  it("cuts and pastes a multiline mouse selection as one bounded edit", (): void => {
    const qbasic = new QBasicSession(
      "C:\\DEMO.BAS",
      "ABC\nDEF",
      80,
      25,
      "C:\\DEMO.BAS",
      { editorMode: true },
    );

    qbasic.mouse({ action: "down", button: 0, sequence: 1, x: 3, y: 3 });
    qbasic.mouse({ action: "move", button: 0, sequence: 2, x: 4, y: 4 });
    qbasic.mouse({ action: "up", button: 0, sequence: 3, x: 4, y: 4 });
    qbasic.key("Ctrl+X");
    expect(qbasic.contents).toBe("AF");
    qbasic.key("Ctrl+V");
    expect(qbasic.contents).toBe("ABC\nDEF");
    qbasic.key("Ctrl+Z");
    expect(qbasic.contents).toBe("AF");
  });

  it("uses the same editor engine for EDIT and QBASIC /EDITOR", (): void => {
    const editFs = new InMemoryFilesystem();
    const edit = new ShellSession(editFs, { osProfile: "dos" });
    const qbasicFs = new InMemoryFilesystem();
    const qbasic = new ShellSession(qbasicFs, { osProfile: "dos" });

    const editScreen = edit.submit("EDIT C:\\DEMO.TXT").terminalScreen;
    const qbasicScreen = qbasic.submit(
      "QBASIC /EDITOR C:\\DEMO.TXT",
    ).terminalScreen;

    expect(qbasicScreen).toEqual(editScreen);
    qbasic.keys(["O", "K", "F2"]);
    expect(qbasicFs.readFile("/drives/c/demo.txt")).toBe("OK");
  });

  it("runs a DOS BASIC file through QBASIC /RUN and rejects invalid switches", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile("/drives/c/demo.bas", "PRINT 42\nEND\n");

    const run = shell.submit("QBASIC /RUN C:\\DEMO.BAS");
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("");
    expect(text(run.terminalScreen!.rows.at(-1)!)).toContain(
      "Program finished",
    );
    expect(filesystem.exists("/drives/c/demo.csx")).toBe(false);
    expect(filesystem.exists("/drives/c/demo.obj")).toBe(false);
    const output = shell.keys(["F4"]);
    expect(
      output.terminalScreen!.rows.some((row) => text(row).includes("42")),
    ).toBe(true);

    shell.keys(["Alt+f", "x"]);
    expect(shell.submit("HELP QBASIC").stdout).toContain("CS QBASIC 1.0");
    const invalid = shell.submit("QBASIC /HELP");
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("Invalid switch");
  });

  it("navigates bounded DOS compiler locations from the output pane", (): void => {
    const workbench = new QBasicSession(
      "C:\\ONE.C",
      "one\ntwo\nthree",
      80,
      25,
      "C:\\ONE.C",
      { language: "c", product: "cs-cpp" },
    );
    workbench.completeCommand(
      "build",
      1,
      createGuestToolchainTranscript([
        {
          diagnostic: {
            code: "CSCC001",
            column: 2,
            line: 2,
            message: "first",
            notes: [{ message: "first note" }],
            severity: "error",
            source: "C:\\ONE.C",
          },
          kind: "diagnostic",
        },
        {
          diagnostic: {
            code: "CSCC001",
            column: 3,
            line: 7,
            message: "second",
            notes: [],
            severity: "error",
            source: "C:\\TWO.CPP",
          },
          kind: "diagnostic",
        },
      ]),
    );
    expect(screenText(workbench.screen())).toContain("error CSCC001: first");
    expect(screenText(workbench.screen())).toContain("note: first note");

    const next = workbench.key("F3");
    expect(next).toMatchObject({
      column: 2,
      fileName: "C:\\ONE.C",
      kind: "diagnostic",
      line: 2,
    });
    workbench.completeDiagnostic("C:\\ONE.C", undefined, "C:\\ONE.C", 2, 2);
    expect(workbench.screen().cursor).toEqual({ x: 3, y: 4 });

    workbench.key("F4");
    expect(workbench.key("F3")).toMatchObject({
      fileName: "C:\\TWO.CPP",
      kind: "diagnostic",
      line: 7,
    });
    expect(workbench.key("Shift+F3")).toMatchObject({
      fileName: "C:\\ONE.C",
      kind: "diagnostic",
      line: 2,
    });
  });

  it("keeps real synchronous compiler codes and notes navigable", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile(
      "/drives/c/bad.asm",
      [".CODE", "foo:", "foo:", "ret", ""].join("\r\n"),
    );
    shell.submit("CSASM C:\\BAD.ASM");
    shell.keys(["Enter"]);

    const failed = shell.keys(["F7"]).terminalScreen!;
    const failedText = screenText(failed);
    expect(failedText).toContain("C:\\BAD.ASM(3,1): error CSASM001");
    expect(failedText).toContain("C:\\BAD.ASM(2,1): note:");
    expect(failedText).toContain("foo was first defined here");
    const navigated = shell.keys(["F3"]).terminalScreen!;
    expect(navigated.cursor).toEqual({ x: 2, y: 5 });
  });

  it("builds, reuses, rolls back, runs, and cleans a mixed Program List", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    shell.resize(80, 25);
    filesystem.makeDirectory("/drives/c/proj");
    filesystem.writeFile(
      "/drives/c/proj/main.c",
      [
        "extern int helper();",
        "int main() {",
        'printf("%d\\n", helper());',
        "return 0;",
        "}",
        "",
      ].join("\r\n"),
    );
    filesystem.writeFile(
      "/drives/c/proj/helper.cpp",
      ['#include "VALUE.H"', "int helper() { return VALUE; }", ""].join("\r\n"),
    );
    filesystem.writeFile(
      "/drives/c/proj/value.h",
      ["#define VALUE 42", ""].join("\r\n"),
    );
    filesystem.writeFile(
      "/drives/c/proj/marker.asm",
      [".CODE", "PUBLIC marker", "marker:", "mov eax, 7", "ret", ""].join(
        "\r\n",
      ),
    );
    filesystem.writeFile(
      "/drives/c/proj/user.asm",
      [".CODE", "PUBLIC userobj", "userobj:", "mov eax, 1", "ret", ""].join(
        "\r\n",
      ),
    );
    expect(
      shell.submit("ASM C:\\PROJ\\USER.ASM /C /OUT:C:\\PROJ\\USER.OBJ"),
    ).toMatchObject({ exitCode: 0 });
    filesystem.writeFile(
      "/drives/c/proj/main.csp",
      [
        "CS PROGRAM LIST 1.0",
        "SOURCE=MAIN.C",
        "SOURCE=HELPER.CPP",
        "SOURCE=MARKER.ASM",
        "OBJECT=USER.OBJ",
        "INCLUDE=.",
        "ENTRY=main",
        "OUTPUT=APP.CSX",
        "LISTING=APP.LST",
        "MAP=APP.MAP",
        "",
      ].join("\r\n"),
    );

    shell.submit("PWB C:\\PROJ\\MAIN.C");
    shell.keys(["Enter"]);
    const selected = shell.keys(["Alt+m", "p", "Enter"]);
    expect(text(selected.terminalScreen!.rows.at(-1)!)).toContain(
      "Program List: /drives/c/pr",
    );

    const built = shell.keys(["F7"]);
    expect(text(built.terminalScreen!.rows.at(-1)!)).toContain(
      "Built C:\\PROJ\\APP.CSX",
    );
    for (const path of [
      "/drives/c/proj/main.obj",
      "/drives/c/proj/helper.obj",
      "/drives/c/proj/marker.obj",
      "/drives/c/proj/app.csx",
      "/drives/c/proj/app.lst",
      "/drives/c/proj/app.map",
      "/drives/c/proj/main.cbr",
    ]) {
      expect(filesystem.exists(path), path).toBe(true);
    }
    expect(filesystem.readFile("/drives/c/proj/app.lst")).toContain(
      "CS486OBJ v4",
    );
    expect(filesystem.readFile("/drives/c/proj/app.map")).toContain(
      "CS-NATIVE-LINK-MAP 1.0",
    );
    const buildRecord = JSON.parse(
      filesystem
        .readFile("/drives/c/proj/main.cbr")
        .slice("CS-DOS-BUILD-RECORD 1.0\n".length),
    ) as { readonly generatedPaths: readonly string[] };
    expect(buildRecord.generatedPaths).toContain("/drives/c/proj/main.obj");

    const reused = shell.keys(["F7"]);
    expect(
      reused.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("Built C:\\PROJ\\APP.CSX");
    const reusePane = shell.keys(["F4"]);
    expect(
      reusePane.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("Reused");
    shell.keys(["Escape"]);

    filesystem.writeFile(
      "/drives/c/proj/value.h",
      ["#define VALUE 43", ""].join("\r\n"),
    );
    shell.keys(["F7"]);
    shell.keys(["F4"]);
    const dependencyOutput = shell.keys(["Home"]).terminalScreen!;
    expect(
      dependencyOutput.rows.some((row) =>
        text(row).includes("Compiled C:\\PROJ\\HELPER.CPP"),
      ),
    ).toBe(true);
    expect(
      dependencyOutput.rows.some((row) =>
        text(row).includes("Reused C:\\PROJ\\MAIN.OBJ"),
      ),
    ).toBe(true);
    shell.keys(["Escape"]);

    const lastGood = filesystem.readFile("/drives/c/proj/app.csx");
    filesystem.writeFile("/drives/c/proj/value.h", "#error broken\r\n");
    const failed = shell.keys(["F7"]);
    expect(
      failed.terminalScreen!.rows.some((row) =>
        text(row).includes("Build failed"),
      ),
    ).toBe(true);
    expect(filesystem.readFile("/drives/c/proj/app.csx")).toBe(lastGood);
    shell.keys(["Escape"]);
    const staleRun = shell.keys(["Ctrl+F5"]);
    expect(
      staleRun.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("missing or stale");
    shell.keys(["Escape"]);

    filesystem.writeFile(
      "/drives/c/proj/value.h",
      ["#define VALUE 44", ""].join("\r\n"),
    );
    shell.keys(["Ctrl+F7"]);
    shell.keys(["Ctrl+F5"]);
    shell.keys(["F4"]);
    expect(
      shell
        .keys(["Home"])
        .terminalScreen!.rows.some((row) => text(row).includes("44")),
    ).toBe(true);
    shell.keys(["Escape", "Alt+m", "l"]);

    for (const path of [
      "/drives/c/proj/main.obj",
      "/drives/c/proj/helper.obj",
      "/drives/c/proj/marker.obj",
      "/drives/c/proj/app.csx",
      "/drives/c/proj/app.lst",
      "/drives/c/proj/app.map",
      "/drives/c/proj/main.cbr",
    ]) {
      expect(filesystem.exists(path), path).toBe(false);
    }
    for (const path of [
      "/drives/c/proj/main.c",
      "/drives/c/proj/helper.cpp",
      "/drives/c/proj/marker.asm",
      "/drives/c/proj/user.asm",
      "/drives/c/proj/user.obj",
      "/drives/c/proj/main.csp",
    ]) {
      expect(filesystem.exists(path), path).toBe(true);
    }

    filesystem.writeFile(
      "/drives/c/proj/main.csp",
      [
        "CS PROGRAM LIST 1.0",
        "SOURCE=MAIN.C",
        "OUTPUT=.\\\\ALIAS.CSX",
        "LISTING=ALIAS.CSX",
        "",
      ].join("\r\n"),
    );
    const aliasCollision = shell.keys(["F7"]);
    expect(
      aliasCollision.terminalScreen!.rows.some((row) =>
        text(row).includes("Build failed"),
      ),
    ).toBe(true);
    expect(filesystem.exists("/drives/c/proj/alias.csx")).toBe(false);
  });
});
