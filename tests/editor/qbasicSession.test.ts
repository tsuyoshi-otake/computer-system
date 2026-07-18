import { describe, expect, it } from "vitest";

import {
  DosIdeSession,
  parseTerminalMouseEvent,
  QBasicSession,
} from "../../src/application/editor/qbasicSession.js";
import {
  parseQBasicCommandLine,
  QBasicCommandLineError,
} from "../../src/application/os/qbasicCommandLine.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

function text(row: readonly { readonly character: string }[]): string {
  return row.map(({ character }) => character).join("");
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

    qbasic.completeCommand("build-run", 0, "42\n");
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
      [
        "C:\\ONE.C(2,2): error CSCC001: first",
        "C:\\TWO.CPP(7,3): error CSCC001: second",
        "",
      ].join("\r\n"),
    );

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
      "CS486OBJ v2",
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
