import { describe, expect, it } from "vitest";

import { QBasicSession } from "../../src/application/editor/qbasicSession.js";
import { parseTerminalMouseEvent } from "../../src/application/editor/qbasicSession.js";
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
      /^ File\s+Edit\s+View\s+Search\s+Run\s+Debug\s+Options\s+Help/u,
    );
    expect(welcome.rows.some((row) => text(row).includes("CS QBASIC"))).toBe(
      true,
    );
    const program = qbasic.key("Enter");
    expect(program.kind).toBe("continue");
    expect(
      program.screen.rows.some((row) => text(row).includes("CS QBASIC")),
    ).toBe(false);
  });

  it("runs from start and explicitly rejects unimplemented debugger actions", (): void => {
    const qbasic = new QBasicSession(
      "C:\\DEMO.BAS",
      "PRINT 42",
      80,
      25,
      "C:\\DEMO.BAS",
      { editorMode: false },
    );

    expect(qbasic.key("Shift+F5")).toMatchObject({
      kind: "run",
      mode: "restart",
    });
    for (const [key, label] of [
      ["F5", "Continue (F5)"],
      ["F7", "Run to cursor (F7)"],
      ["F8", "Step (F8)"],
      ["F10", "Step over (F10)"],
    ] as const) {
      const unsupported = qbasic.key(key);
      expect(unsupported.kind).toBe("continue");
      expect(text(unsupported.screen.rows.at(-1)!)).toContain(
        `${label} is not implemented`,
      );
    }
    const breakpoint = qbasic.key("F9");
    expect(text(breakpoint.screen.rows.at(-1)!)).toContain(
      "Breakpoint marker set at line 1; debugger unavailable",
    );

    qbasic.completeRun(0, "42\n");
    const output = qbasic.key("F4");
    expect(text(output.screen.rows[1]!)).toContain("42");
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

    expect(
      qbasic.mouse({ action: "down", button: 0, sequence: 1, x: 28, y: 1 }),
    ).toMatchObject({ kind: "run", mode: "restart" });
    qbasic.mouse({ action: "up", button: 0, sequence: 2, x: 28, y: 1 });
    qbasic.mouse({ action: "down", button: 0, sequence: 3, x: 1, y: 2 });
    const selected = qbasic.mouse({
      action: "move",
      button: 0,
      sequence: 4,
      x: 6,
      y: 2,
    });
    expect(
      selected.screen.rows[1]!.slice(0, 5).every(
        ({ background }) => background === 1,
      ),
    ).toBe(true);
    qbasic.mouse({ action: "up", button: 0, sequence: 5, x: 6, y: 2 });
    qbasic.key("Ctrl+C");
    qbasic.mouse({ action: "down", button: 0, sequence: 6, x: 4, y: 3 });
    qbasic.mouse({ action: "up", button: 0, sequence: 7, x: 4, y: 3 });
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

  it("cuts and pastes a multiline mouse selection as one bounded edit", (): void => {
    const qbasic = new QBasicSession(
      "C:\\DEMO.BAS",
      "ABC\nDEF",
      80,
      25,
      "C:\\DEMO.BAS",
      { editorMode: true },
    );

    qbasic.mouse({ action: "down", button: 0, sequence: 1, x: 2, y: 2 });
    qbasic.mouse({ action: "move", button: 0, sequence: 2, x: 3, y: 3 });
    qbasic.mouse({ action: "up", button: 0, sequence: 3, x: 3, y: 3 });
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
    const output = shell.keys(["F4"]);
    expect(
      output.terminalScreen!.rows.some((row) => text(row).includes("42")),
    ).toBe(true);

    shell.keys(["Alt+f", "x"]);
    const invalid = shell.submit("QBASIC /HELP");
    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("Invalid switch");
  });
});
