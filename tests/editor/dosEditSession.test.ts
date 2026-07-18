import { describe, expect, it, vi } from "vitest";

import {
  DosEditSession,
  dosTuiColor,
} from "../../src/application/editor/dosEditSession.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import {
  defaultComputerHardware,
  portableComputerHardware,
} from "../../src/domain/computer/hardware.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

function text(row: readonly { readonly character: string }[]): string {
  return row.map(({ character }) => character).join("");
}

describe("DosEditSession", (): void => {
  it("supports document jumps, word movement, and Ctrl+Y line deletion", (): void => {
    const editor = new DosEditSession("KEYS.TXT", "one two\nthree four");

    editor.key("Ctrl+End");
    editor.key("Ctrl+ArrowLeft");
    editor.key("Ctrl+Y");
    expect(editor.contents).toBe("one two");
    editor.key("Ctrl+Z");
    expect(editor.contents).toBe("one two\nthree four");
    editor.key("Ctrl+Home");
    editor.key("Ctrl+ArrowRight");
    editor.key("X");
    expect(editor.contents).toBe("one Xtwo\nthree four");
  });

  it("opens an untitled NONAME.TXT buffer when EDIT has no argument", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    const opened = shell.submit("EDIT");
    expect(text(opened.terminalScreen?.rows[0] ?? [])).toContain("File");
    shell.keys(["H", "I", "F2"]);
    expect(filesystem.readFile("/drives/c/noname.txt")).toBe("HI");
  });

  it("renders an original DOS-style full-screen editor with explicit status", (): void => {
    const editor = new DosEditSession("C:\\WORK\\DEMO.TXT", "ONE\nTWO");

    const screen = editor.screen();
    expect(screen.rows).toHaveLength(19);
    expect(screen.rows.every((row) => row.length === 51)).toBe(true);
    expect(text(screen.rows[0]!)).toMatch(
      /^ {2}File\s+Edit\s+Search\s+Options\s+Help\s*$/u,
    );
    expect(text(screen.rows[1]!)).toContain("DEMO.TXT");
    expect(text(screen.rows[2]!)).toContain("ONE");
    expect(
      screen.rows.slice(2, 17).every((row) => text(row).startsWith("│")),
    ).toBe(true);
    expect(
      screen.rows[2]!.slice(0, -1).every(
        ({ background }) => background === dosTuiColor.document,
      ),
    ).toBe(true);
    expect(screen.rows[2]!.at(-1)?.background).toBe(dosTuiColor.chrome);
    expect(text(screen.rows[2]!).at(-1)).toBe("↑");
    expect(text(screen.rows[16]!).at(-1)).toBe("↓");
    expect(text(screen.rows[17]!).at(0)).toBe("←");
    expect(text(screen.rows[17]!).at(-1)).toBe("→");
    expect(
      screen.rows[17]!.every(
        ({ background }) =>
          background === dosTuiColor.chrome || background === dosTuiColor.black,
      ),
    ).toBe(true);
    expect(text(screen.rows[18]!)).toContain("CS-DOS Editor");
    expect(text(screen.rows[18]!)).toContain("<F1=Help>");
    expect(text(screen.rows[18]!)).toContain("00001:001");
    expect(text(screen.rows[18]!)).not.toContain("N 00001:001");
    expect(
      screen.rows[18]!.every(
        ({ background }) => background === dosTuiColor.status,
      ),
    ).toBe(true);
  });

  it("edits, joins lines, undoes, toggles overwrite, and resizes the viewport", (): void => {
    const editor = new DosEditSession("DEMO.TXT", "alpha\nbeta");

    editor.key("End");
    editor.key("Backspace");
    editor.key("Delete");
    expect(editor.contents).toBe("alphbeta");
    editor.key("Ctrl+z");
    expect(editor.contents).toBe("alph\nbeta");
    editor.key("Insert");
    editor.key("Home");
    editor.key("X");
    expect(editor.contents).toBe("Xlph\nbeta");

    const expanded = editor.resize(100, 40);
    expect(expanded.rows).toHaveLength(40);
    expect(expanded.rows.every((row) => row.length === 100)).toBe(true);
    expect(text(expanded.rows.at(-1)!)).toContain("00001:002");
    expect(text(expanded.rows.at(-1)!)).not.toContain("O 00001:002");
  });

  it("searches forward with Ctrl+F and repeats or reports failure with F3", (): void => {
    const editor = new DosEditSession("SEARCH.TXT", "alpha\nbeta alpha\ngamma");

    editor.key("Ctrl+f");
    expect(editor.mode).toBe("search");
    for (const key of "beta") editor.key(key);
    const found = editor.key("Enter");
    expect(editor.mode).toBe("editing");
    expect(text(found.screen.rows.at(-1)!)).toContain("Found: beta");
    expect(found.screen.cursor).toEqual({ x: 2, y: 4 });

    editor.key("Ctrl+f");
    for (let index = 0; index < 4; index += 1) editor.key("Backspace");
    for (const key of "missing") editor.key(key);
    const missing = editor.key("Enter");
    expect(text(missing.screen.rows.at(-1)!)).toContain("Not found: missing");
  });

  it("shows bounded keyboard help and returns to the same buffer", (): void => {
    const editor = new DosEditSession("HELP.TXT", "unchanged");

    const help = editor.key("F1");
    expect(editor.mode).toBe("help");
    expect(
      help.screen.rows.some((row) => text(row).includes("CS-DOS Editor Help")),
    ).toBe(true);
    editor.key("Escape");
    expect(editor.mode).toBe("editing");
    expect(editor.contents).toBe("unchanged");
  });

  it("cancels menu clicks outside the visible menu box", (): void => {
    const editor = new DosEditSession("MENU.TXT", "before");
    editor.key("End");
    editor.key("!");

    editor.key("Alt+f");
    const cancelled = editor.pointerDown(51, 3);
    expect(editor.mode).toBe("editing");
    expect(cancelled.kind).toBe("continue");
    expect(text(cancelled.screen.rows.at(-1)!)).toContain("Menu cancelled");
    expect(editor.modified).toBe(true);
  });

  it("saves under a new DOS path through Save As", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    shell.submit("EDIT C:\\OLD.TXT");
    shell.keys(["N", "E", "W", "Ctrl+Shift+S"]);
    const renamed = shell.keys([
      ...Array.from({ length: 10 }, () => "Backspace"),
      ..."C:\\NEW.TXT",
      "Enter",
    ]);

    expect(renamed.terminalScreen).toBeDefined();
    expect(filesystem.readFile("/drives/c/new.txt")).toBe("NEW");
    expect(filesystem.exists("/drives/c/old.txt")).toBe(false);
  });

  it("navigates the File menu and makes dirty exit terminal states explicit", (): void => {
    const editor = new DosEditSession("DIRTY.TXT", "before");
    editor.key("End");
    editor.key("!");

    const menu = editor.key("Alt+f");
    expect(editor.mode).toBe("menu");
    expect(
      menu.screen.rows.some((row) => text(row).includes("Save As...")),
    ).toBe(true);
    editor.key("x");
    expect(editor.mode).toBe("confirm-exit");
    const cancelled = editor.key("Escape");
    expect(editor.mode).toBe("editing");
    expect(text(cancelled.screen.rows.at(-1)!)).toContain("Exit cancelled");

    editor.key("Alt+f");
    editor.key("x");
    expect(editor.key("n")).toMatchObject({
      discardedChanges: true,
      kind: "closed",
    });
    expect(editor.state).toBe("closed");
  });

  it("renders the EDIT File menu with canonical items and selectable separators", (): void => {
    const editor = new DosEditSession("C:\\MENU.TXT", "before", 80, 25);

    const menu = editor.key("Alt+f");
    const lines = menu.screen.rows.map((row) => text(row));
    expect(lines[2]).toContain("New");
    expect(lines[3]).toContain("Open...");
    expect(lines[4]).toContain("Save");
    expect(lines[5]).toContain("Save As...");
    expect(lines[1]).toContain("\u250c");
    expect(lines[6]).toContain("\u251c");
    expect(lines[8]).toContain("\u251c");
    expect(lines[10]).toContain("\u2514");
    expect(lines.slice(1, 11).join("\n")).not.toContain("+---");
    expect(lines.slice(1, 11).join("\n")).not.toContain("DOS Command");
    expect(lines.slice(1, 11).join("\n")).not.toContain("Insert Command");
    expect(lines.slice(1, 11).join("\n")).not.toContain("Ctrl+");
    expect(lines.slice(1, 11).join("\n")).not.toContain("Alt+F X");
    expect(lines.at(-1)).toMatch(
      /^ F1=Help {2}Removes currently loaded file from memory/u,
    );
    expect(lines.at(-1)).toContain("00001:001");
    expect(lines.at(-1)).not.toContain("N 00001:001");

    const unavailable = editor.key("p");
    expect(editor.mode).toBe("editing");
    expect(text(unavailable.screen.rows.at(-1)!)).toContain(
      "Print is not available in CS-DOS Editor",
    );
  });

  it("integrates save, clean exit, and discard with the sandbox filesystem", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    expect(shell.submit("EDIT C:\\DEMO.TXT").terminalScreen).toBeDefined();
    shell.keys(["O", "N", "E", "Enter", "T", "W", "O"]);
    expect(shell.keys(["F2"]).terminalScreen).toBeDefined();
    expect(filesystem.readFile("/drives/c/demo.txt")).toBe("ONE\r\nTWO");
    expect(shell.keys(["Alt+f", "x"]).resetTerminal).toBe(true);

    shell.submit("EDIT C:\\DISCARD.TXT");
    shell.keys(["X", "Alt+f", "x"]);
    const discarded = shell.keys(["n"]);
    expect(discarded.resetTerminal).toBe(true);
    expect(filesystem.exists("/drives/c/discard.txt")).toBe(false);
  });

  it("keeps ownership of a dirty buffer when save fails", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    shell.submit("EDIT C:\\COLLIDE");
    shell.keys(["X"]);
    filesystem.makeDirectory("/drives/c/collide");
    const failed = shell.keys(["Alt+f", "x", "y"]);

    expect(failed.resetTerminal).toBeUndefined();
    expect(failed.terminalScreen).toBeDefined();
    expect(
      failed.terminalScreen!.rows.some((row) =>
        text(row).includes("Save failed"),
      ),
    ).toBe(true);
    expect(shell.prompt()).toBe("");
  });

  it("returns to the saved revision after undo and writes canonical DOS CRLF", (): void => {
    const editor = new DosEditSession("C:\\CHECK.TXT", "A\r\nB");
    editor.key("End");
    editor.key("!");
    const save = editor.key("F2");
    expect(save).toMatchObject({
      contents: "A!\r\nB",
      expectedContents: "A\r\nB",
      kind: "save",
    });
    editor.completeSave(false);
    editor.key("?");
    expect(editor.modified).toBe(true);
    editor.key("Ctrl+Z");
    expect(editor.modified).toBe(false);
  });

  it("owns dirty New/Open transitions and loads a file through the DOS dialog", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile("/drives/c/next.txt", "NEXT\r\nFILE");

    shell.submit("EDIT C:\\CURRENT.TXT");
    shell.keys(["X", "Ctrl+O"]);
    const blocked = shell.keys(["F7"]);
    expect(
      blocked.terminalScreen!.rows.some((row) =>
        text(row).includes("not saved"),
      ),
    ).toBe(true);
    shell.keys(["n", "Enter"]);
    const opened = shell.keys([..."C:\\NEXT.TXT", "Enter"]);
    expect(
      opened.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("NEXT");

    shell.keys(["Ctrl+N"]);
    expect(
      shell
        .keys(["n"])
        .terminalScreen!.rows.some((row) => text(row).includes("UNTITLED")),
    ).toBe(true);
  });

  it("renders an 80-column Open dialog with selected TXT input and two bounded panes", (): void => {
    const editor = new DosEditSession(
      "/drives/c/current.txt",
      "CURRENT",
      80,
      25,
      "CURRENT.TXT",
      true,
      () => ({
        directory: "/drives/c",
        displayDirectory: "C:\\",
        drives: ["A:", "C:"],
        entries: [
          {
            displayName: "DOS",
            fileName: "/drives/c/dos",
            kind: "directory",
            size: 0,
          },
          {
            displayName: "README.TXT",
            fileName: "/drives/c/readme.txt",
            kind: "file",
            size: 42,
          },
          {
            displayName: "COMMAND.COM",
            fileName: "/drives/c/command.com",
            kind: "file",
            size: 54_645,
          },
        ],
        mediaGeneration: 1,
      }),
    );

    const opened = editor.key("Ctrl+O");
    const lines = opened.screen.rows.map((row) => text(row));
    const fieldRow = lines.findIndex((line) => line.includes("File Name:"));
    const fieldStart = lines[fieldRow]!.indexOf("*.TXT");
    expect(lines.join("\n")).toContain(" Open ");
    expect(lines[fieldRow]).toContain("File Name: [*.TXT");
    expect(opened.screen.cursor.y).toBe(fieldRow + 1);
    expect(
      opened.screen.rows[fieldRow]!.slice(
        fieldStart,
        fieldStart + "*.TXT".length,
      ).every(({ background }) => background === dosTuiColor.black),
    ).toBe(true);
    expect(lines.join("\n")).toContain("Files");
    expect(lines.join("\n")).toContain("Dirs/Drives");
    expect(lines.join("\n")).toContain("README.TXT");
    expect(lines.join("\n")).not.toContain("COMMAND.COM");
    expect(lines.join("\n")).toContain("DOS");
    expect(lines.join("\n")).toContain("[-A-]");
    expect(lines.join("\n")).toContain("[-C-]");
    expect(lines.join("\n")).toContain("↑+");
    expect(lines.join("\n")).toContain("↓+");
    expect(lines.join("\n")).toContain("←█");
    expect(lines.join("\n")).toContain("→");
    expect(lines.join("\n")).toContain("█");

    const applied = editor.key("Enter");
    expect(editor.mode).toBe("file-dialog");
    expect(text(applied.screen.rows.at(-1)!)).toContain("Filter applied");
  });

  it("renders and operates the classic Display dialog with bounded focus", (): void => {
    const editor = new DosEditSession("C:\\DISPLAY.TXT", "", 80, 25);
    editor.key("Alt+o");
    const displayed = editor.key("d");
    const lines = displayed.screen.rows.map((row) => text(row));
    const whiteRow = lines.findIndex((line) => line.includes("White"));
    const blueRow = lines.findIndex((line) => line.includes("Blue"));
    const whiteColumn = lines[whiteRow]!.indexOf("White");
    const blueColumns = [...lines[blueRow]!.matchAll(/Blue/gu)].map(
      ({ index }) => index,
    );

    expect(lines.join("\n")).toContain("Display");
    expect(lines.join("\n")).toContain("Colors");
    expect(lines.join("\n")).toContain("Foreground");
    expect(lines.join("\n")).toContain("Background");
    expect(lines.join("\n")).toContain("Set colors for");
    expect(lines.join("\n")).toContain("the CS-DOS text");
    expect(lines.join("\n")).toContain("[X] Scroll Bars");
    expect(lines.join("\n")).toContain("Tab Stops: 8");
    expect(lines.join("\n")).not.toContain("Syntax");
    expect(lines.join("\n")).toContain("\u250c");
    expect(lines.join("\n")).toContain("\u2502");
    expect(lines.join("\n")).toContain("\u2514");
    expect(lines.join("\n")).not.toContain("+---");
    expect(
      displayed.screen.rows[whiteRow]!.slice(
        whiteColumn,
        whiteColumn + "White".length,
      ).every(({ background }) => background === dosTuiColor.black),
    ).toBe(true);
    expect(blueColumns).toHaveLength(2);
    expect(
      displayed.screen.rows[blueRow]!.slice(
        blueColumns[1],
        blueColumns[1]! + "Blue".length,
      ).every(({ background }) => background === dosTuiColor.black),
    ).toBe(true);

    editor.key("Tab");
    editor.key("Tab");
    editor.key("Tab");
    const okFocused = editor.key("Tab");
    const okLines = okFocused.screen.rows.map((row) => text(row));
    const okRow = okLines.findIndex((line) => line.includes("< OK >"));
    const okColumn = okLines[okRow]!.indexOf("< OK >");
    expect(
      okFocused.screen.rows[okRow]!.slice(
        okColumn,
        okColumn + "< OK >".length,
      ).every(({ background }) => background === dosTuiColor.black),
    ).toBe(true);
    const applied = editor.key("Enter");
    expect(editor.mode).toBe("editing");
    expect(text(applied.screen.rows.at(-1)!)).toContain(
      "Display options applied",
    );

    editor.key("Alt+o");
    editor.key("d");
    editor.key("Tab");
    editor.key("Tab");
    editor.key("Tab");
    editor.key("ArrowRight");
    expect(editor.options.tabstop).toBe(9);
    editor.key("Tab");
    editor.key("Tab");
    editor.key("Enter");
    expect(editor.mode).toBe("editing");
    expect(editor.options.tabstop).toBe(8);
  });

  it("executes the Display OK button by pointer and keeps box sides continuous", (): void => {
    const editor = new DosEditSession("C:\\DISPLAY.TXT", "", 80, 25);
    editor.key("Alt+o");
    const displayed = editor.key("d");
    const lines = displayed.screen.rows.map((row) => text(row));
    const okRow = lines.findIndex((line) => line.includes("< OK >"));
    const okColumn = lines[okRow]!.indexOf("< OK >");
    const dialogRows = lines.filter(
      (line) => line.includes("\u2502") && line.includes("Display") === false,
    );

    expect(dialogRows.length).toBeGreaterThan(10);
    expect(dialogRows.every((line) => line.includes("\u2502"))).toBe(true);
    const applied = editor.pointerDown(okColumn + 2, okRow + 1);
    expect(editor.mode).toBe("editing");
    expect(text(applied.screen.rows.at(-1)!)).toContain(
      "Display options applied",
    );
  });

  it("browses the bounded guest filesystem with DOS drives, filters, and directories", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.makeDirectory("/drives/c/work");
    filesystem.writeFile(
      "/drives/c/work/hello.c",
      "int main(void) { return 0; }",
    );
    filesystem.writeFile("/drives/c/work/notes.txt", "NOTES");

    shell.submit("EDIT C:\\CURRENT.TXT");
    const root = shell.keys(["Ctrl+O"]);
    const rootText = root
      .terminalScreen!.rows.map((row) => text(row))
      .join("\n");
    expect(rootText).toContain("Open File");
    expect(rootText).toContain("Look in: C:\\");
    expect(rootText).toContain("Drives: [C:] [A:]");
    expect(rootText).toContain("[DIR] WORK");

    shell.keys(["Enter", "W", "O", "R", "K", "Enter", "Tab", "Tab"]);
    shell.keys(Array.from({ length: 5 }, () => "Backspace"));
    const filtered = shell.keys(["*", ".", "C", "Enter"]);
    const filteredText = filtered
      .terminalScreen!.rows.map((row) => text(row))
      .join("\n");
    expect(filteredText).toContain("HELLO.C");
    expect(filteredText).not.toContain("NOTES.TXT");

    const opened = shell.keys(["Enter"]);
    expect(
      opened.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("int main(void)");
  });

  it("supports mouse selection and refuses stale or oversized dialog snapshots", (): void => {
    let generation = 1;
    const entry = {
      displayName: "HELLO.TXT",
      fileName: "/drives/c/hello.txt",
      kind: "file" as const,
      size: 5,
    };
    const editor = new DosEditSession(
      "/drives/c/current.txt",
      "CURRENT",
      51,
      19,
      "CURRENT.TXT",
      true,
      () => ({
        directory: "/drives/c",
        displayDirectory: "C:\\",
        drives: ["C:", "A:"],
        entries: [entry],
        mediaGeneration: generation,
      }),
    );

    editor.key("Ctrl+O");
    generation = 2;
    const changed = editor.pointerDown(4, 16);
    expect(changed.kind).toBe("continue");
    expect(changed.screen.rows.map((row) => text(row)).join("\n")).toContain(
      "Media changed",
    );
    expect(editor.mode).toBe("file-dialog");

    editor.pointerDown(4, 7);
    const selected = editor.pointerDown(4, 16);
    expect(selected).toMatchObject({
      fileName: "/drives/c/hello.txt",
      kind: "open",
    });

    const tooMany = Array.from({ length: 257 }, (_, index) => ({
      displayName: `F${String(index).padStart(7, "0")}.TXT`,
      fileName: `/drives/c/f${String(index).padStart(7, "0")}.txt`,
      kind: "file" as const,
      size: index,
    }));
    const bounded = new DosEditSession(
      "/drives/c/current.txt",
      "SAFE",
      51,
      19,
      "CURRENT.TXT",
      true,
      () => ({
        directory: "/drives/c",
        displayDirectory: "C:\\",
        drives: ["C:"],
        entries: tooMany,
        mediaGeneration: 1,
      }),
    );
    const rejected = bounded.key("Ctrl+O");
    expect(rejected.screen.rows.map((row) => text(row)).join("\n")).toContain(
      "Directory error",
    );
    expect(bounded.contents).toBe("SAFE");
    expect(bounded.mode).toBe("file-dialog");
  });

  it("supports bounded replace, Select All, and Shift-key selection", (): void => {
    const editor = new DosEditSession("REPLACE.TXT", "Alpha alpha");
    editor.key("Ctrl+H");
    for (const key of "alpha") editor.key(key);
    editor.key("Tab");
    editor.key("X");
    editor.key("Ctrl+Enter");
    expect(editor.contents).toBe("X X");

    editor.key("Ctrl+A");
    editor.key("Z");
    expect(editor.contents).toBe("Z");
    editor.key("Ctrl+Home");
    editor.key("Shift+ArrowRight");
    editor.key("Ctrl+X");
    expect(editor.contents).toBe("");
  });

  it("keeps Replace All and mouse-owned modal decisions atomic", (): void => {
    const oversized = `${"a".repeat(4_096)}\na`;
    const editor = new DosEditSession("BOUND.TXT", oversized);
    editor.key("Ctrl+H");
    editor.key("a");
    editor.key("Tab");
    editor.key("b");
    const rejected = editor.key("Ctrl+Enter");
    expect(editor.contents).toBe(oversized);
    expect(rejected.screen.rows.map((row) => text(row)).join("\n")).toContain(
      "Replace All limit reached",
    );

    const dirty = new DosEditSession("DIRTY.TXT", "before");
    dirty.key("End");
    dirty.key("!");
    dirty.key("Ctrl+N");
    expect(dirty.mode).toBe("confirm-exit");
    dirty.pointerDown(20, 9);
    expect(dirty.contents).toBe("");
    expect(dirty.mode).toBe("editing");

    const changed = new DosEditSession("C:\\CHANGE.TXT", "before");
    changed.key("End");
    changed.key("!");
    const request = changed.key("F2");
    if (request.kind !== "save") throw new Error("expected save request");
    changed.offerSaveDecision(
      "external-change",
      request,
      "C:\\CHANGE.TXT",
      "external",
    );
    const reopen = changed.pointerDown(21, 9);
    expect(reopen).toMatchObject({
      fileName: "C:\\CHANGE.TXT",
      kind: "open",
    });
  });

  it("rejects binary input and owns external-change and Save As decisions", (): void => {
    expect(() => new DosEditSession("BINARY.DAT", "A\0B")).toThrow(
      /binary files/u,
    );

    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile("/drives/c/original.txt", "OLD");
    filesystem.writeFile("/drives/c/existing.txt", "KEEP");
    shell.submit("EDIT C:\\ORIGINAL.TXT");
    shell.keys(["End", "!"]);
    filesystem.writeFile("/drives/c/original.txt", "EXTERNAL");
    const changed = shell.keys(["F2"]);
    expect(
      changed.terminalScreen!.rows.some((row) =>
        text(row).includes("File Changed"),
      ),
    ).toBe(true);
    expect(filesystem.readFile("/drives/c/original.txt")).toBe("EXTERNAL");
    shell.keys(["Escape"]);

    shell.keys([
      "Ctrl+Shift+S",
      ...Array.from({ length: 20 }, () => "Backspace"),
    ]);
    const collision = shell.keys([..."C:\\EXISTING.TXT", "Enter"]);
    expect(
      collision.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("Confirm Replace");
    expect(filesystem.readFile("/drives/c/existing.txt")).toBe("KEEP");
    shell.keys(["Escape"]);

    shell.keys([
      "Ctrl+Shift+S",
      ...Array.from({ length: 20 }, () => "Backspace"),
    ]);
    const secondCollision = shell.keys([..."C:\\EXISTING.TXT", "Enter"]);
    expect(
      secondCollision.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("Confirm Replace");
    const replaced = shell.keys(["y"]);
    expect(
      replaced.terminalScreen!.rows.map((row) => text(row)).join("\n"),
    ).toContain("Saved");
    expect(filesystem.readFile("/drives/c/existing.txt")).toBe("OLD!");

    filesystem.writeFile("/drives/c/existing.txt", "CHANGED AGAIN");
    shell.keys(["End", "?"]);
    expect(
      shell
        .keys(["F2"])
        .terminalScreen!.rows.map((row) => text(row))
        .join("\n"),
    ).toContain("File Changed");
    shell.keys(["y"]);
    expect(filesystem.readFile("/drives/c/existing.txt")).toBe("OLD!?");

    filesystem.writeFile("/drives/c/existing.txt", "REOPENED");
    shell.keys(["End", "!"]);
    shell.keys(["F2"]);
    const reopened = shell.keys(["r"]);
    expect(
      reopened.terminalScreen!.rows.some((row) =>
        text(row).includes("REOPENED"),
      ),
    ).toBe(true);
  });
  it("coalesces a bounded key batch into one observable screen render", (): void => {
    const editor = new DosEditSession("BATCH.TXT", "");
    const initial = editor.screen();
    const initialBuilds = editor.screenBuildCount;
    const initialDecodes = editor.lineDecodeCount;
    editor.beginKeyBatch();
    let intermediate = editor.key("a");
    for (const key of "bcdefghijklmnop") intermediate = editor.key(key);

    expect(intermediate.screen).toBe(initial);
    expect(editor.contents).toBe("abcdefghijklmnop");
    const finalScreen = editor.endKeyBatch();
    expect(editor.screenBuildCount - initialBuilds).toBe(1);
    expect(editor.lineDecodeCount - initialDecodes).toBe(1);
    expect(finalScreen).not.toBe(initial);
    expect(text(finalScreen.rows[2]!)).toContain("abcdefghijklmnop");
    expect(() => editor.endKeyBatch()).toThrow(/not active/u);

    const screenSpy = vi.spyOn(DosEditSession.prototype, "screen");
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    shell.submit("EDIT C:\\BATCH.TXT");
    const liveEditor = screenSpy.mock.instances.at(-1)! as DosEditSession;
    const buildsBefore = liveEditor.screenBuildCount;
    screenSpy.mockClear();

    const applied = shell.keys([..."abcdefghijklmnop"]);

    expect(liveEditor.screenBuildCount - buildsBefore).toBe(1);
    expect(
      applied.terminalScreen!.rows.some((row) =>
        text(row).includes("abcdefghijklmnop"),
      ),
    ).toBe(true);
    screenSpy.mockRestore();
  });

  it("keeps EDIT input work independent of the modeled 386/486 clock", () => {
    const observations = [
      defaultComputerHardware,
      portableComputerHardware,
    ].map((hardware) => {
      const shell = new ShellSession(new InMemoryFilesystem(), {
        hardware,
        osProfile: "dos",
      });
      shell.submit("EDIT C:\\CPU.TXT");
      const result = shell.keys([..."abcdefghijklmnop"]);
      return {
        cpuCycles: result.cpuCycles,
        cpuModel: hardware.cpuModel,
        screen: result.terminalScreen?.rows.map((row) => text(row)),
      };
    });

    expect(observations.map(({ cpuModel }) => cpuModel)).toEqual([
      "cs486dx",
      "cs386sx",
    ]);
    expect(observations.map(({ cpuCycles }) => cpuCycles)).toEqual([16, 16]);
    expect(observations[0]!.screen).toEqual(observations[1]!.screen);
  });

  it("keeps batch redraw work independent of the maximum document line count", () => {
    const document = Array.from(
      { length: 4_096 },
      (_, index) => `row-${String(index)}`,
    ).join("\n");
    const editor = new DosEditSession("MAXLINES.TXT", document);
    editor.screen();
    const buildsBefore = editor.screenBuildCount;
    const decodesBefore = editor.lineDecodeCount;

    editor.beginKeyBatch();
    for (const key of "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx") editor.key(key);
    const screen = editor.endKeyBatch();

    expect(editor.screenBuildCount - buildsBefore).toBe(1);
    expect(editor.lineDecodeCount - decodesBefore).toBe(1);
    expect(editor.cursor).toEqual({ column: 32, line: 0 });
    expect(text(screen.rows[2]!)).toContain(
      "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxrow-0",
    );
  });
});
