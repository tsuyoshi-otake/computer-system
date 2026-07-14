import { describe, expect, it } from "vitest";

import { DosEditSession } from "../../src/application/editor/dosEditSession.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
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
      /^ File\s+Edit\s+Search\s+Options\s+Help/u,
    );
    expect(text(screen.rows[1]!)).toContain("ONE");
    expect(screen.rows[1]!.every(({ background }) => background === 11)).toBe(
      true,
    );
    expect(text(screen.rows[17]!)).toContain("Ln 1 Col 1 INS");
    expect(text(screen.rows[18]!)).toContain("F2 Save");
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
    expect(text(expanded.rows[38]!)).toContain("OVR");
  });

  it("searches forward with Ctrl+F and repeats or reports failure with F3", (): void => {
    const editor = new DosEditSession("SEARCH.TXT", "alpha\nbeta alpha\ngamma");

    editor.key("Ctrl+f");
    expect(editor.mode).toBe("search");
    for (const key of "beta") editor.key(key);
    const found = editor.key("Enter");
    expect(editor.mode).toBe("editing");
    expect(text(found.screen.rows.at(-1)!)).toContain("Found: beta");
    expect(found.screen.cursor).toEqual({ x: 1, y: 3 });

    editor.key("Ctrl+f");
    for (let index = 0; index < 4; index += 1) editor.key("Backspace");
    for (const key of "missing") editor.key(key);
    const missing = editor.key("Enter");
    expect(text(missing.screen.rows.at(-1)!)).toContain("Not found: missing");
  });

  it("navigates the File menu and makes dirty exit terminal states explicit", (): void => {
    const editor = new DosEditSession("DIRTY.TXT", "before");
    editor.key("End");
    editor.key("!");

    const menu = editor.key("Alt+f");
    expect(editor.mode).toBe("menu");
    expect(
      menu.screen.rows.some((row) => text(row).includes("Save and Exit")),
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

  it("integrates save, clean exit, and discard with the sandbox filesystem", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });

    expect(shell.submit("EDIT C:\\DEMO.TXT").terminalScreen).toBeDefined();
    shell.keys(["O", "N", "E", "Enter", "T", "W", "O"]);
    expect(shell.keys(["F2"]).terminalScreen).toBeDefined();
    expect(filesystem.readFile("/drives/c/demo.txt")).toBe("ONE\nTWO");
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

    shell.submit("EDIT C:\\COLLISION");
    shell.keys(["X"]);
    filesystem.makeDirectory("/drives/c/collision");
    const failed = shell.keys(["Alt+f", "x", "y"]);

    expect(failed.resetTerminal).toBeUndefined();
    expect(failed.terminalScreen).toBeDefined();
    expect(text(failed.terminalScreen!.rows.at(-1)!)).toContain("Save failed");
    expect(shell.prompt()).toBe("");
  });
});
