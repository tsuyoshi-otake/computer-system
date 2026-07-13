import { describe, expect, it } from "vitest";

import { ViSession } from "../../src/application/editor/viSession.js";
import { ShellSession } from "../../src/application/os/shellSession.js";
import { InMemoryFilesystem } from "../../src/domain/filesystem/inMemoryFilesystem.js";

describe("ViSession", (): void => {
  it("moves through normal, insert, and command modes and saves explicitly", (): void => {
    const vi = new ViSession("/home/computer/demo.py", "print('old')");

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

  it("renders only a fixed viewport for large files", (): void => {
    const vi = new ViSession(
      "large.py",
      Array.from(
        { length: 10_000 },
        (_, index) => `line_${index} = ${index}`,
      ).join("\n"),
    );

    const screen = vi.screen();
    expect(screen.rows).toHaveLength(19);
    expect(screen.rows.every((row) => row.length === 51)).toBe(true);
    vi.key("ArrowDown");
    expect(vi.screen().rows).toHaveLength(19);
    const expanded = vi.resize(100, 40);
    expect(expanded.rows).toHaveLength(40);
    expect(expanded.rows.every((row) => row.length === 100)).toBe(true);
  });

  it("integrates save and reopen with the sandbox filesystem", (): void => {
    const filesystem = new InMemoryFilesystem();
    const shell = new ShellSession(filesystem);

    expect(shell.submit("vi demo.py").terminalScreen).toBeDefined();
    shell.keys(["i", "p", "a", "s", "s", "Escape"]);
    const saved = shell.keys([":", "w", "q", "Enter"]);
    expect(saved.resetTerminal).toBe(true);
    expect(filesystem.readFile("/home/computer/demo.py")).toBe("pass");

    expect(shell.submit("vi demo.py").terminalScreen).toBeDefined();
    expect(
      shell
        .keys([":", "q", "Enter"])
        .lines.some((line) => line.includes("vi closed")),
    ).toBe(true);
  });
});
