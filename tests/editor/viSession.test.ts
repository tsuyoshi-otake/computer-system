import { describe, expect, it } from "vitest";

import {
  ViSession,
  type ViResult,
} from "../../src/application/editor/viSession.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("ViSession", (): void => {
  it("moves through normal, insert, and command modes and saves explicitly", (): void => {
    const vi = new ViSession("/home/cs/demo.py", "print('old')");

    expect(vi.mode).toBe("normal");
    vi.key("i");
    for (const key of "# ") vi.key(key);
    expect(vi.mode).toBe("insert");
    vi.key("Escape");
    expect(vi.mode).toBe("normal");
    vi.key(":");
    expect(vi.mode).toBe("command");
    vi.key("w");
    const save = vi.key("Enter");

    expect(save).toMatchObject({ kind: "save", closeAfter: false });
    if (save.kind !== "save") return;
    expect(save.contents).toBe("# print('old')");
    expect(vi.completeSave(false).kind).toBe("continue");
    vi.key(":");
    vi.key("q");
    expect(vi.key("Enter")).toMatchObject({
      kind: "closed",
      discardedChanges: false,
    });
  });

  it("blocks ordinary quit when dirty, supports forced discard, dd, and bounded undo", (): void => {
    const vi = new ViSession("demo.txt", "one\ntwo\nthree");
    vi.key("d");
    vi.key("d");
    expect(vi.contents).toBe("two\nthree");
    vi.key("u");
    expect(vi.contents).toBe("one\ntwo\nthree");

    vi.key("i");
    vi.key("X");
    vi.key("Escape");
    vi.key(":");
    vi.key("q");
    const blocked = vi.key("Enter");
    expect(blocked.kind).toBe("continue");
    expect(
      blocked.screen.rows.some((row) =>
        row
          .map((cell) => cell.character)
          .join("")
          .includes("No write"),
      ),
    ).toBe(true);
    vi.key(":");
    vi.key("q");
    vi.key("!");
    expect(vi.key("Enter")).toMatchObject({
      kind: "closed",
      discardedChanges: true,
    });
  });

  it("renders content first with stateful status, command line, and block cursors", (): void => {
    const editor = new ViSession(undefined, "");
    let screen = editor.screen();
    let status = screen.rows[screen.rows.length - 2]!;

    expect(rowText(screen.rows[0]!).trimEnd()).toBe("");
    expect(rowText(screen.rows[1]!).startsWith("~")).toBe(true);
    expect(screen.cursor).toEqual({ x: 1, y: 1 });
    expect(screen.rows[0]![0]).toMatchObject({
      background: 0,
      character: " ",
      foreground: 15,
    });
    expect(rowText(status)).toContain("[No Name]");
    expect(rowText(status)).not.toContain("[+]");
    expect(rowText(status).endsWith("1,1  All")).toBe(true);
    expect(
      status.every(
        ({ background, foreground }) => background === 0 && foreground === 15,
      ),
    ).toBe(true);
    expect(rowText(screen.rows[screen.rows.length - 1]!).trim()).toBe("");
    expect(screenRowsText(screen)).not.toContain("VI  ");
    expect(screenRowsText(screen)).not.toContain("-- NORMAL --");
    expect(screenRowsText(screen)).not.toContain("Esc normal");

    editor.key("i");
    editor.key("x");
    screen = editor.screen();
    status = screen.rows[screen.rows.length - 2]!;
    expect(rowText(status)).toContain("[No Name] [+]");
    expect(rowText(screen.rows[screen.rows.length - 1]!).trim()).toBe(
      "-- INSERT --",
    );
    expect(screen.cursor).toEqual({ x: 2, y: 1 });
    expect(screen.rows[0]![1]).toMatchObject({
      background: 0,
      character: " ",
      foreground: 15,
    });

    editor.key("Escape");
    screen = editor.screen();
    expect(rowText(screen.rows[screen.rows.length - 1]!).trim()).toBe("");
    editor.key(":");
    screen = editor.screen();
    expect(screen.cursor).toEqual({ x: 2, y: screen.rows.length });
    expect(rowText(screen.rows[screen.rows.length - 1]!).startsWith(":")).toBe(
      true,
    );
    editor.key("w");
    screen = editor.screen();
    expect(screen.cursor).toEqual({ x: 3, y: screen.rows.length });
    expect(rowText(screen.rows[screen.rows.length - 1]!).startsWith(":w")).toBe(
      true,
    );
    expect(editor.key("Enter")).toMatchObject({
      closeAfter: false,
      kind: "save",
    });
    screen = editor.completeSave(false, "note.txt").screen;
    status = screen.rows[screen.rows.length - 2]!;
    expect(rowText(status)).toContain("note.txt");
    expect(rowText(status)).not.toContain("[+]");
  });

  it("supports forced write-quit and the normal-mode ZZ shortcut", (): void => {
    const forced = new ViSession("forced.txt", "before");
    forced.key("i");
    forced.key("X");
    forced.key("Escape");
    forced.key(":");
    forced.key("w");
    forced.key("q");
    forced.key("!");
    expect(forced.key("Enter")).toMatchObject({
      kind: "save",
      closeAfter: true,
      contents: "Xbefore",
    });

    const shortcut = new ViSession("shortcut.txt", "contents");
    expect(shortcut.key("Z").kind).toBe("continue");
    expect(shortcut.key("Z")).toMatchObject({
      kind: "save",
      closeAfter: true,
      contents: "contents",
    });
  });

  it("renders only a fixed viewport for large files", (): void => {
    const vi = new ViSession(
      "large.py",
      Array.from(
        { length: 999 },
        (_, index) => `line_${index} = ${index}`,
      ).join("\n"),
    );

    const screen = vi.screen();
    expect(screen.rows).toHaveLength(19);
    expect(screen.rows.every((row) => row.length === 51)).toBe(true);
    expect(
      rowText(screen.rows[screen.rows.length - 2]!).endsWith("1,1  Top"),
    ).toBe(true);
    vi.key("ArrowDown");
    expect(vi.screen().rows).toHaveLength(19);
    const expanded = vi.resize(100, 40);
    expect(expanded.rows).toHaveLength(40);
    expect(expanded.rows.every((row) => row.length === 100)).toBe(true);
    const bottom = vi.key("G").screen;
    expect(
      rowText(bottom.rows[bottom.rows.length - 2]!).endsWith("999,1  Bot"),
    ).toBe(true);
  });

  it("integrates save and reopen with the sandbox filesystem", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("vi demo.py").terminalScreen).toBeDefined();
    shell.keys(["i", "p", "a", "s", "s", "Escape"]);
    const saved = shell.keys([":", "w", "q", "Enter"]);
    expect(saved.resetTerminal).toBe(true);
    expect(filesystem.readFile("/home/cs/demo.py")).toBe("pass");

    expect(shell.submit("vi demo.py").terminalScreen).toBeDefined();
    expect(
      shell
        .keys([":", "q", "Enter"])
        .lines.some((line) => line.includes("vi closed")),
    ).toBe(true);
  });

  it("opens without a path, leaves an empty command line with Backspace, and names on write", (): void => {
    const direct = new ViSession(undefined, "");
    direct.key(":");
    direct.key("Backspace");
    expect(direct.mode).toBe("normal");

    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    const opened = shell.submit("vi");
    expect(opened.terminalScreen).toBeDefined();
    expect(screenText(opened)).toContain("[No Name]");
    shell.keys([":"]);
    expect(shell.keys(["Backspace"]).terminalScreen).toBeDefined();
    shell.keys(["i", "h", "e", "l", "l", "o", "Escape"]);
    const unnamed = shell.keys([":", "w", "Enter"]);
    expect(screenText(unnamed)).toContain("No file name");

    const saved = shell.keys([
      ":",
      "w",
      "q",
      " ",
      "n",
      "o",
      "t",
      "e",
      ".",
      "t",
      "x",
      "t",
      "Enter",
    ]);
    expect(saved.resetTerminal).toBe(true);
    expect(filesystem.readFile("/home/cs/note.txt")).toBe("hello");
  });

  it("supports common normal-mode entry, navigation, discard, and insert line joining", (): void => {
    const vi = new ViSession("demo.txt", "  one\ntwo");
    vi.key("I");
    vi.key("X");
    vi.key("Escape");
    vi.key("G");
    vi.key("A");
    vi.key("!");
    vi.key("Escape");
    vi.key("0");
    vi.key("i");
    vi.key("Backspace");
    expect(vi.contents).toBe("  Xonetwo!");
    vi.key("Escape");
    vi.key("g");
    vi.key("g");
    vi.key("O");
    vi.key("Escape");
    expect(vi.contents.startsWith("\n")).toBe(true);
    vi.key("Z");
    expect(vi.key("Q")).toMatchObject({
      kind: "closed",
      discardedChanges: true,
    });
  });

  it("keeps display features off by default and toggles each independently", (): void => {
    const editor = new ViSession("demo.py", "    if value == 42:");
    const plain = editor.screen().rows[0]!;
    expect(rowText(plain).startsWith("    if")).toBe(true);
    expect(plain.slice(1).every(({ background }) => background === 15)).toBe(
      true,
    );
    expect(plain.slice(1).every(({ foreground }) => foreground === 0)).toBe(
      true,
    );

    submitEx(editor, "syntax on");
    const syntax = editor.screen().rows[0]!;
    expect(
      syntax.slice(4, 6).every(({ foreground }) => foreground === 10),
    ).toBe(true);
    expect(syntax.slice(1).every(({ background }) => background === 15)).toBe(
      true,
    );

    submitEx(editor, "set rainbow");
    expect(
      editor
        .screen()
        .rows[0]!.slice(1, 4)
        .map(({ background }) => background),
    ).toEqual([11, 10, 10]);
    submitEx(editor, "set number");
    expect(rowText(editor.screen().rows[0]!).startsWith("  1 ")).toBe(true);

    submitEx(editor, "syntax off");
    submitEx(editor, "set norainbow nonumber");
    expect(editor.options).toMatchObject({
      number: false,
      rainbow: false,
      syntax: false,
    });
  });

  it("applies autoindent, tab, shift, list, and wrap options", (): void => {
    const editor = new ViSession(
      "demo.txt",
      "  one",
      20,
      6,
      "set autoindent tabstop=4 shiftwidth=3 expandtab",
    );
    editor.key("A");
    editor.key("Enter");
    editor.key("Tab");
    expect(editor.contents).toBe("  one\n    ");
    editor.key("Escape");
    editor.key(">");
    editor.key(">");
    expect(editor.contents).toBe("  one\n       ");

    editor.key("o");
    expect(editor.contents).toBe("  one\n       \n       ");
    editor.key("Escape");
    editor.key("O");
    expect(editor.contents).toBe("  one\n       \n       \n       ");

    const literalTab = new ViSession(
      "tabs.txt",
      "",
      20,
      6,
      "set noexpandtab list",
    );
    literalTab.key("i");
    literalTab.key("Tab");
    literalTab.key("v");
    literalTab.key("Escape");
    expect(literalTab.contents).toBe("\tv");
    expect(rowText(literalTab.screen().rows[0]!).startsWith("→v$")).toBe(true);

    const wrapped = new ViSession("wrap.txt", "abcdefghijklmnopqrstuv", 20, 6);
    expect(rowText(wrapped.screen().rows[1]!).startsWith("~")).toBe(true);
    submitEx(wrapped, "set wrap list");
    expect(rowText(wrapped.screen().rows[1]!).startsWith("uv$")).toBe(true);
    submitEx(wrapped, "set number");
    expect(rowText(wrapped.screen().rows[0]!).startsWith("  1 ")).toBe(true);
    expect(rowText(wrapped.screen().rows[1]!).startsWith("    qrstuv$")).toBe(
      true,
    );
    wrapped.key("$");
    expect(wrapped.screen().cursor).toEqual({ x: 11, y: 2 });
  });

  it("applies set atomically and reports all options without truncating state", (): void => {
    const editor = new ViSession("demo.txt", "text");
    submitEx(editor, "set number tabstop=0");
    expect(editor.options.number).toBe(false);
    expect(screenRowsText(editor.screen())).toContain(
      "tabstop must be an integer from 1 to 16",
    );
    editor.key("Enter");

    submitEx(editor, "set all");
    expect(screenRowsText(editor.screen())).toContain("noautoindent");
    expect(screenRowsText(editor.screen())).toContain("tabstop=2");
    editor.key("Enter");
    expect(editor.mode).toBe("normal");
  });

  it("returns bounded shell requests and inserts bounded command output", (): void => {
    const editor = new ViSession("demo.txt", "one");
    expect(submitEx(editor, "!echo hello")).toMatchObject({
      command: "echo hello",
      insertOutput: false,
      kind: "shell",
    });
    const shown = editor.completeShellCommand(0, "hello\n", "", false);
    expect(screenRowsText(shown.screen)).toContain("hello");
    expect(rowText(shown.screen.rows[0]!).trimEnd()).toBe("hello");
    expect(rowText(shown.screen.rows[shown.screen.rows.length - 2]!)).toContain(
      "Output",
    );
    expect(
      rowText(shown.screen.rows[shown.screen.rows.length - 1]!).startsWith(
        "Press any key to return",
      ),
    ).toBe(true);
    expect(shown.screen.cursor.y).toBe(shown.screen.rows.length);
    expect(screenRowsText(shown.screen)).not.toContain("VI  ");
    editor.key("Enter");
    expect(submitEx(editor, "!!")).toMatchObject({
      command: "echo hello",
      insertOutput: false,
      kind: "shell",
    });
    editor.completeShellCommand(0, "hello\n", "", false);
    editor.key("Enter");

    expect(submitEx(editor, "r !echo inserted")).toMatchObject({
      command: "echo inserted",
      insertOutput: true,
      kind: "shell",
    });
    editor.completeShellCommand(0, "inserted\n", "", true);
    expect(editor.contents).toBe("one\ninserted");
    const before = editor.contents;
    editor.completeShellCommand(0, "x".repeat(4_097), "", true);
    expect(editor.contents).toBe(before);
  });

  it("loads vimrc and executes only bounded guest-shell commands", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/home/cs/.vimrc",
      "syntax on\nset number rainbow wrap\n",
    );
    filesystem.writeFile("/home/cs/demo.py", "if True:");

    const opened = shell.submit("vi demo.py");
    expect(rowText(opened.terminalScreen!.rows[0]!).startsWith("  1 ")).toBe(
      true,
    );
    expect(
      opened
        .terminalScreen!.rows[0]!.slice(5, 6)
        .every(({ foreground }) => foreground === 10),
    ).toBe(true);

    expect(screenText(shell.submit(":!echo hello"))).toContain("hello");
    shell.keys(["Enter"]);
    expect(screenText(shell.submit(":!vi nested.txt"))).toContain(
      "cannot run in a pipeline or redirect",
    );
    shell.keys(["Enter"]);
    expect(
      screenText(shell.submit(":!sleep 1")).replaceAll(/\s+/gu, " "),
    ).toContain(
      "asynchronous, session-control, and TUI commands are unavailable",
    );
    shell.keys(["Enter"]);
    shell.submit(":!cd /");
    shell.keys(["Enter"]);
    shell.submit(":r !echo inserted");
    expect(shell.submit(":wq").resetTerminal).toBe(true);
    expect(filesystem.readFile("/home/cs/demo.py")).toBe("if True:\ninserted");
    expect(shell.submit("pwd").stdout).toBe("/home/cs\n");
  });

  it("rejects an invalid vimrc without opening a partial editor", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/home/cs/.vimrc",
      "set number\nset tabstop=99\nset wrap\n",
    );

    const opened = shell.submit("vi");
    expect(opened.exitCode).toBe(1);
    expect(opened.terminalScreen).toBeUndefined();
    expect(opened.stderr).toContain(".vimrc line 2");
  });

  it("loads the DOS C:\\_VIMRC profile through DOS path rules", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem, { osProfile: "dos" });
    filesystem.writeFile("/drives/c/_vimrc", "syntax on\r\nset number\r\n");
    filesystem.writeFile("/drives/c/demo.py", "if True:");

    const opened = shell.submit("vi demo.py");
    expect(rowText(opened.terminalScreen!.rows[0]!).startsWith("  1 ")).toBe(
      true,
    );
    expect(
      opened
        .terminalScreen!.rows[0]!.slice(5, 6)
        .every(({ foreground }) => foreground === 10),
    ).toBe(true);
  });

  it("completes current words and keywords with Ctrl+N and cancels with Ctrl+E", (): void => {
    const current = new ViSession("demo.py", "alphaValue\nal");
    current.key("G");
    current.key("A");
    expect(current.key("Ctrl+N").kind).toBe("continue");
    expect(current.contents).toBe("alphaValue\nalphaValue");
    current.key("Ctrl+E");
    expect(current.contents).toBe("alphaValue\nal");

    const keyword = new ViSession(
      "demo.py",
      "ret",
      51,
      19,
      "set completesources=keywords completeprefix=2",
    );
    keyword.key("A");
    keyword.key("Ctrl+N");
    expect(keyword.contents).toBe("return");
    expect(keyword.options.syntax).toBe(false);
  });

  it("indexes symbols on demand and jumps within the current file", (): void => {
    const editor = new ViSession("demo.py", "def target():\n  pass\ntarget()");
    editor.key("G");
    editor.key("g");
    expect(editor.key("d").screen.cursor.y).toBe(1);
    expect(editor.key("Ctrl+O").screen.cursor.y).toBe(3);
    expect(screenRowsText(submitEx(editor, "symbols").screen)).toContain(
      "function target",
    );
  });

  it("returns bounded external definition requests and preserves jump history", (): void => {
    const provider = (): readonly {
      readonly contents: string;
      readonly path: string;
    }[] => [{ contents: "def thing():\n  pass", path: "/helper.py" }];
    const editor = new ViSession(
      "/main.py",
      "from helper import thing\nthing()",
      51,
      19,
      "set definitionsources=current,buffers,includes completesources=includes",
      provider,
    );
    editor.key("G");
    editor.key("g");
    const jump = editor.key("d");
    expect(jump).toMatchObject({
      kind: "navigate",
      line: 0,
      path: "/helper.py",
    });
    if (jump.kind !== "navigate") throw new Error("navigation expected");
    editor.completeNavigation(
      jump.path,
      "def thing():\n  pass",
      jump.line,
      jump.column,
    );
    expect(editor.key("Ctrl+O")).toMatchObject({
      kind: "navigate",
      line: 1,
      path: "/main.py",
    });

    const dirty = new ViSession(
      "/main.py",
      "from helper import thing\nthing()",
      51,
      19,
      "set definitionsources=current,includes",
      provider,
    );
    dirty.key("i");
    dirty.key(" ");
    dirty.key("Escape");
    dirty.key("G");
    dirty.key("g");
    expect(screenRowsText(dirty.key("d").screen)).toContain(
      "Write changes before leaving",
    );
  });

  it("reads optional include candidates and definitions through the guest filesystem", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);
    filesystem.writeFile(
      "/home/cs/.vimrc",
      "set completesources=includes definitionsources=current,buffers,includes\n",
    );
    filesystem.writeFile("/home/cs/main.py", "from helper import thing\nthi");
    filesystem.writeFile("/home/cs/helper.py", "def thing():\n  pass");

    shell.submit("vi main.py");
    shell.keys(["G", "A", "Ctrl+N", "Escape"]);
    expect(shell.submit(":w").terminalScreen).toBeDefined();
    expect(filesystem.readFile("/home/cs/main.py")).toBe(
      "from helper import thing\nthing",
    );
    shell.keys(["g", "g", "j", "g", "d"]);
    expect(screenText(shell.keys([]))).toContain("helper.py");
    shell.keys(["Ctrl+O"]);
    expect(screenText(shell.keys([]))).toContain("main.py");
  });

  it("keeps line numbers at three digits and rejects line 1000", (): void => {
    const maximum = Array.from({ length: 999 }, (_, index) =>
      String(index + 1),
    ).join("\n");
    const vi = new ViSession("/home/cs/max.txt", maximum, 51, 19, "set number");

    vi.key("G");
    const active = vi
      .screen()
      .rows.find((row) => rowText(row).startsWith("999 "));
    expect(
      active?.slice(0, 4).every(({ foreground }) => foreground === 0),
    ).toBe(true);
    vi.key("A");
    expect(screenRowsText(vi.key("Enter").screen)).toContain(
      "Document line limit reached",
    );
    expect(vi.contents.split("\n")).toHaveLength(999);

    const oversized = Array.from({ length: 1_000 }, () => "line").join("\n");
    expect(() => new ViSession("/home/cs/too-many.txt", oversized)).toThrow(
      "vi document line limit exceeded",
    );
  });
});

function submitEx(editor: ViSession, command: string): ViResult {
  editor.key(":");
  for (const character of command) editor.key(character);
  return editor.key("Enter");
}

function rowText(row: readonly { readonly character: string }[]): string {
  return row.map(({ character }) => character).join("");
}

function screenRowsText(screen: {
  readonly rows: readonly (readonly { readonly character: string }[])[];
}): string {
  return screen.rows.map(rowText).join("\n");
}

function screenText(result: ReturnType<ShellSession["submit"]>): string {
  return (
    result.terminalScreen?.rows
      .map((row) => row.map((cell) => cell.character).join(""))
      .join("\n") ?? ""
  );
}
